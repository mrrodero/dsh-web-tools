/**
 * The local corpus store: one SQLite file (built-in `node:sqlite`) holding
 * pages, a standalone FTS5 table for lexical search, and content chunks with
 * optional float32 embedding BLOBs for semantic search. All writes go
 * through this module; the index is single-writer (the DSH server process).
 * @module @deepseek-ai/dsh-web-local-index/store
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ensureModel, embed, modelReadyNow } from './model.ts'
import type { IndexPageInput, IndexStats, PruneInput, PruneResult } from './types.ts'

/** The SQL schema, applied idempotently on open. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
  url TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
  url UNINDEXED, title, content, tokenize='unicode61'
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  page_url TEXT NOT NULL,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB
);
CREATE INDEX IF NOT EXISTS idx_chunks_page ON chunks(page_url);
`

/** Default database path: `$DSH_HOME/data/web-index/index.db`. */
export function defaultDbPath(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'data', 'web-index', 'index.db')
}

let configuredPath: string | undefined
let dbPromise: Promise<import('node:sqlite').DatabaseSync> | undefined

/**
 * Point the store at a database file (default when omitted). Reconfiguring
 * closes any open handle; the store reopens lazily on next use.
 *
 * @param opts - store options.
 */
export function configureIndexStore(opts: { dbPath?: string } = {}): void {
  configuredPath = opts.dbPath ?? defaultDbPath()
  dbPromise = undefined
}

/** The configured database path (for diagnostics and stats). */
export function configuredDbPath(): string {
  return configuredPath ?? defaultDbPath()
}

/**
 * Open (or reuse) the database handle, applying the schema on first open.
 * Exported for the search module (which must not be imported by this one).
 */
export function storeDatabase(): Promise<import('node:sqlite').DatabaseSync> {
  dbPromise ??= openDatabase()
  return dbPromise
}

async function openDatabase(): Promise<import('node:sqlite').DatabaseSync> {
  const { DatabaseSync } = await import('node:sqlite')
  const path = configuredDbPath()
  mkdirSync(dirname(path), { recursive: true })
  const handle = new DatabaseSync(path)
  handle.exec('PRAGMA journal_mode = WAL;')
  handle.exec(SCHEMA)
  return handle
}

/**
 * Close the store (test hook; the server process owns the handle otherwise).
 */
export async function closeIndexStore(): Promise<void> {
  if (dbPromise === undefined) return
  const handle = await dbPromise
  dbPromise = undefined
  handle.close()
}

/**
 * Split page content into chunks on blank-line boundaries: each paragraph
 * is its own chunk, and oversized paragraphs are hard-split into ~`size`-
 * character pieces, for per-chunk embedding.
 *
 * @param text - the content to chunk.
 * @param size - the hard-split size for oversized paragraphs (chars).
 * @returns the non-empty chunks in document order.
 */
export function chunkText(text: string, size = 800): string[] {
  const chunks: string[] = []
  for (const paragraph of text.split(/\n{2,}/u)) {
    const trimmed = paragraph.trim()
    if (trimmed === '') continue
    if (trimmed.length > size) {
      for (let offset = 0; offset < trimmed.length; offset += size) {
        const piece = trimmed.slice(offset, offset + size).trim()
        if (piece !== '') chunks.push(piece)
      }
    } else {
      chunks.push(trimmed)
    }
  }
  return chunks
}

/**
 * Store one page: upsert the page row, resync its FTS row, and replace its
 * chunks (embedding each chunk when the model is loaded; lexical-only
 * otherwise). Latest index wins per URL.
 *
 * @param input - the page to store.
 */
export async function indexPage(input: IndexPageInput): Promise<void> {
  const db = await storeDatabase()
  const domain = (() => {
    try {
      return new URL(input.url).hostname
    } catch {
      return ''
    }
  })()
  const title = input.title ?? ''
  const content = input.markdown ?? input.text ?? ''

  db.prepare(
    'INSERT INTO pages (url, domain, title, fetched_at, content) VALUES (?, ?, ?, ?, ?) '
    + 'ON CONFLICT(url) DO UPDATE SET domain = excluded.domain, title = excluded.title, '
    + 'fetched_at = excluded.fetched_at, content = excluded.content',
  ).run(input.url, domain, title, input.fetchedAt, content)
  db.prepare('DELETE FROM page_fts WHERE url = ?').run(input.url)
  db.prepare('INSERT INTO page_fts (url, title, content) VALUES (?, ?, ?)').run(input.url, title, content)

  db.prepare('DELETE FROM chunks WHERE page_url = ?').run(input.url)
  const chunks = chunkText(content)
  const session = await ensureModel()
  const insert = db.prepare('INSERT INTO chunks (page_url, seq, text, embedding) VALUES (?, ?, ?, ?)')
  for (const [seq, text] of chunks.entries()) {
    let embedding: Uint8Array | null = null
    if (session !== null) {
      try {
        const vector = await embed(session, text)
        embedding = new Uint8Array(vector.buffer)
      } catch {
        embedding = null
      }
    }
    insert.run(input.url, seq, text, embedding)
  }
}

/**
 * Remove pages matching the prune criteria (and their FTS rows and chunks).
 *
 * @param input - the prune criteria.
 * @returns the removal counts.
 */
export async function pruneIndex(input: PruneInput): Promise<PruneResult> {
  const db = await storeDatabase()
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (input.olderThanDays !== undefined) {
    const cutoff = new Date(Date.now() - input.olderThanDays * 86_400_000).toISOString()
    clauses.push('fetched_at < ?')
    params.push(cutoff)
  }
  if (input.domains !== undefined && input.domains.length > 0) {
    clauses.push(`domain NOT IN (${input.domains.map(() => '?').join(',')})`)
    params.push(...input.domains)
  }
  if (clauses.length === 0) return { removedPages: 0, removedChunks: 0 }
  const where = clauses.join(' AND ')
  const rows = db.prepare(`SELECT url FROM pages WHERE ${where}`).all(...params) as Array<{ url: string }>
  let removedChunks = 0
  for (const row of rows) {
    const count = db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE page_url = ?').get(row.url) as { n: number }
    removedChunks += count.n
    db.prepare('DELETE FROM page_fts WHERE url = ?').run(row.url)
    db.prepare('DELETE FROM chunks WHERE page_url = ?').run(row.url)
    db.prepare('DELETE FROM pages WHERE url = ?').run(row.url)
  }
  return { removedPages: rows.length, removedChunks }
}

/**
 * Current index statistics.
 *
 * @returns the page/chunk counts, database path, and model state.
 */
export async function indexStats(): Promise<IndexStats> {
  const db = await storeDatabase()
  const pages = db.prepare('SELECT COUNT(*) AS n FROM pages').get() as { n: number }
  const chunks = db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }
  const embedded = db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NOT NULL').get() as { n: number }
  return {
    pages: pages.n,
    chunks: chunks.n,
    embeddedChunks: embedded.n,
    dbPath: configuredDbPath(),
    // Report state without triggering a model download.
    modelReady: modelReadyNow(),
  }
}

/**
 * Embed any chunks stored before the model became available (bounded
 * batches until none remain). Fire-and-forget; errors are swallowed.
 */
export async function backfillPendingEmbeddings(): Promise<void> {
  const session = await ensureModel()
  if (session === null) return
  const db = await storeDatabase()
  for (;;) {
    const rows = db.prepare('SELECT id, text FROM chunks WHERE embedding IS NULL LIMIT 200').all() as Array<{ id: number; text: string }>
    if (rows.length === 0) return
    for (const row of rows) {
      try {
        const vector = await embed(session, row.text)
        db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?').run(new Uint8Array(vector.buffer), row.id)
      } catch {
        // Leave the chunk lexical-only; a later backfill pass retries it.
      }
    }
  }
}
