/**
 * Shared vocabulary for the local corpus index.
 * @module @deepseek-ai/dsh-web-local-index/types
 */

/** One page to store in the local corpus index. */
export interface IndexPageInput {
  /** The page URL (primary key; latest index wins). */
  readonly url: string
  /** The page title (empty when absent). */
  readonly title?: string
  /** The page content as markdown (preferred over raw text). */
  readonly markdown?: string
  /** The page content as raw text (used when no markdown is available). */
  readonly text?: string
  /** The fetch time as an ISO-8601 string. */
  readonly fetchedAt: string
}

/** One local search hit (a page, with its best-matching evidence). */
export interface LocalSearchHit {
  /** The page URL. */
  readonly url: string
  /** The page title (empty when absent). */
  readonly title: string
  /** The page hostname. */
  readonly domain: string
  /** The fused relevance score (RRF; higher is better). */
  readonly score: number
  /** A short content snippet around the best match. */
  readonly snippet: string
}

/** The result of one `local_search` call. */
export interface LocalSearchResult {
  /** The mode that produced the hits. */
  readonly mode: LocalSearchMode
  /** Hits in rank order. */
  readonly hits: LocalSearchHit[]
  /** True when the embedding model is loaded (semantic search available). */
  readonly modelReady: boolean
  /** Wall-clock search time (ms). */
  readonly elapsedMs: number
}

/** The retrieval mode for one search. */
export type LocalSearchMode = 'hybrid' | 'lexical' | 'semantic'

/** One prune request. */
export interface PruneInput {
  /** Keep only pages fetched within this many days (when set). */
  readonly olderThanDays?: number
  /** Drop pages whose domain is in this list (when set). */
  readonly domains?: readonly string[]
}

/** The outcome of one prune. */
export interface PruneResult {
  /** Pages removed. */
  readonly removedPages: number
  /** Chunks removed. */
  readonly removedChunks: number
}

/** Index statistics. */
export interface IndexStats {
  /** Stored pages. */
  readonly pages: number
  /** Stored chunks. */
  readonly chunks: number
  /** Chunks with an embedding (semantic-searchable). */
  readonly embeddedChunks: number
  /** The database file path. */
  readonly dbPath: string
  /** True when the embedding model is loaded. */
  readonly modelReady: boolean
}
