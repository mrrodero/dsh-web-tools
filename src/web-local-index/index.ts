/**
 * @deepseek-ai/dsh-web-local-index — the local corpus index for the DeepSeek
 * Harness web capability bundle. One SQLite file (built-in `node:sqlite`)
 * stores fetched and crawled pages with FTS5 lexical search and MiniLM
 * embedding chunks for semantic search (RRF-fused in `hybrid` mode).
 * Registers the `indexed` fetch provider (every fetch auto-indexes) and the
 * model-facing `local_search` tool.
 * @module @deepseek-ai/dsh-web-local-index
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { IndexedFetchProvider, INDEXED_FETCH_PROVIDER_ID } from './provider.ts'
import { backfillPendingEmbeddings, configureIndexStore, indexPage, indexStats, pruneIndex } from './store.ts'
import { ensureModel, modelReadyNow } from './model.ts'
import { searchLocal } from './search.ts'
import { applyLocalSearchTool, LOCAL_SEARCH_MAX_RESULTS, LOCAL_SEARCH_MAX_QUERIES } from './tool.ts'

export { IndexedFetchProvider, INDEXED_FETCH_PROVIDER_ID } from './provider.ts'
export {
  configureIndexStore,
  configuredDbPath,
  defaultDbPath,
  closeIndexStore,
  indexPage,
  pruneIndex,
  indexStats,
  chunkText,
  backfillPendingEmbeddings,
} from './store.ts'
export { ensureModel, modelReadyNow, wordPieceTokenize, embed, cosine, CLS_ID, SEP_ID, UNK_ID, MAX_TOKENS } from './model.ts'
export { searchLocal, ftsMatchQuery, rrf, RRF_K } from './search.ts'
export { applyLocalSearchTool, parseLocalSearchArgs, formatLocalSearchOutput, LOCAL_SEARCH_MAX_RESULTS, LOCAL_SEARCH_MAX_QUERIES } from './tool.ts'
export type {
  IndexPageInput,
  LocalSearchHit,
  LocalSearchResult,
  LocalSearchMode,
  PruneInput,
  PruneResult,
  IndexStats,
} from './types.ts'

/** Plugin registration name (the `id` in profile/bundle patch rows). */
export const name = 'web-local-index'

/** Services this plugin requires from the host composition. */
export const inject = ['web', 'tools', 'systemPrompt']

/** Deployment configuration for the local index. */
export interface Config {
  /** The SQLite database path (default `$DSH_HOME/data/web-index/index.db`). */
  dbPath?: string
  /** Register the `indexed` fetch provider (default true). */
  registerProvider?: boolean
  /** Register the `local_search` tool (default true). */
  registerTool?: boolean
  /** Upper bound on `local_search` hits (default 8). */
  maxResults?: number
  /** Upper bound on `local_search` queries per call (default 4). */
  maxQueries?: number
}

/**
 * The deployment configuration: database location and the registrations'
 * bounds. Every field is optional with a safe default.
 */
export const Config: z<Config> = z.object({
  dbPath: z.string(),
  registerProvider: z.boolean().default(true),
  registerTool: z.boolean().default(true),
  maxResults: z.number().default(LOCAL_SEARCH_MAX_RESULTS),
  maxQueries: z.number().default(LOCAL_SEARCH_MAX_QUERIES),
})

/**
 * Wire the local index into the host composition: point the store at its
 * database, kick off the embedding model download (best-effort), register
 * the `indexed` fetch provider, and register the `local_search` tool. All
 * registrations are effect-scoped and disappear with the plugin's effect.
 *
 * @param ctx - the host context providing the `web`, `tools`, and
 *   `systemPrompt` registries.
 * @param config - the deployment configuration (validated by {@link Config}).
 */
export function apply(ctx: Context, config: Config): void {
  configureIndexStore(config.dbPath !== undefined ? { dbPath: config.dbPath } : {})
  // Best-effort model download; failures degrade to lexical-only search.
  void ensureModel().then(() => backfillPendingEmbeddings())
  if (config.registerProvider ?? true) {
    ctx.web.registerFetchProvider(new IndexedFetchProvider())
  }
  if (config.registerTool ?? true) {
    applyLocalSearchTool(ctx, config.maxResults ?? LOCAL_SEARCH_MAX_RESULTS, config.maxQueries ?? LOCAL_SEARCH_MAX_QUERIES)
  }
}
