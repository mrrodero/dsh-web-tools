/**
 * The model-facing `local_search` tool: search the locally indexed corpus
 * (fetched pages and crawled sites) with lexical (FTS5), semantic
 * (MiniLM embeddings), or hybrid (RRF-fused) retrieval. Distinct from
 * `web_search` (live SearXNG): this one answers from what has already been
 * fetched and crawled.
 * @module @deepseek-ai/dsh-web-local-index/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { searchLocal } from './search.ts'
import type { LocalSearchMode, LocalSearchResult } from './types.ts'

/**
 * The schema-inferred output value: the schema's `mode` property is a plain
 * string (the schema DSL cannot name the `LocalSearchMode` union), so
 * presentation helpers accept the widened shape.
 */
type LocalSearchOutputValue = Omit<LocalSearchResult, 'mode'> & { mode: string }

/** Default upper bound on returned hits. */
export const LOCAL_SEARCH_MAX_RESULTS = 8

/** Default upper bound on concurrent queries in one tool call. */
export const LOCAL_SEARCH_MAX_QUERIES = 4

/** Model-facing `local_search` arguments. */
interface LocalSearchArgs {
  queries: string[]
  maxResults?: number
  mode?: string
}

/**
 * Validate value constraints the schema DSL can't express: `queries` is
 * non-empty, contains only non-blank strings, and fits the query-count
 * bound; duplicates collapse after the bound check.
 *
 * @param args - the schema-validated arguments.
 * @param maxQueries - the upper bound on queries in one call.
 * @returns the accepted queries in first-occurrence order.
 */
export function parseLocalSearchArgs(args: LocalSearchArgs, maxQueries: number): string[] {
  const queries = args.queries
  if (queries.length === 0) throw new Error('queries must contain at least one query')
  if (queries.length > maxQueries) {
    const noun = maxQueries === 1 ? 'query' : 'queries'
    throw new Error(`queries must contain at most ${maxQueries} ${noun}`)
  }
  if (queries.some(query => query.trim().length === 0)) throw new Error('each query must be a non-empty string')
  return [...new Set(queries)]
}

/**
 * Format a local search result as one model-facing text block.
 *
 * @param result - the search outcome.
 * @returns a markdown hit list (or `No local matches.`), plus a note when
 *   semantic retrieval was unavailable.
 */
export function formatLocalSearchOutput(result: LocalSearchOutputValue): string {
  const parts: string[] = []
  if (result.hits.length > 0) {
    const lines = result.hits.map((hit, rank) => {
      const label = hit.title.length > 0 ? hit.title : hit.url
      const meta: string[] = []
      if (hit.snippet.length > 0) meta.push(hit.snippet)
      meta.push(`(${hit.domain})`)
      return `${rank + 1}. [${label}](${hit.url}) — ${meta.join(' ')}`
    })
    parts.push(`Local matches:\n${lines.join('\n')}`)
  } else {
    parts.push('No local matches. The corpus only contains pages this session has fetched or crawled — fetch or crawl the target site first, then search again.')
  }
  if (!result.modelReady) {
    parts.push('(Semantic retrieval unavailable — lexical search only; the embedding model is still downloading or failed to load.)')
  }
  return parts.join('\n\n')
}

/**
 * Project a validated `local_search` output value into its replayable
 * presentation meta (opaque JSON).
 *
 * @param value - the canonical output value.
 * @returns the mode, hit count, and model state.
 */
export function localSearchMetaFromValue(value: LocalSearchOutputValue): JsonValue {
  return { mode: value.mode, hits: value.hits.length, modelReady: value.modelReady }
}

/**
 * Narrow opaque live or replayed result metadata to the local-search meta.
 * Malformed metadata returns `undefined` so presentation can fall back to
 * the generic card instead of throwing during replay.
 *
 * @param meta - result metadata.
 * @returns the validated meta, or `undefined` for absent or malformed data.
 */
export function localSearchMetaFromResult(meta: unknown): { mode: string; hits: number; modelReady: boolean } | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { mode, hits, modelReady } = meta as Record<string, unknown>
  if (typeof mode !== 'string' || typeof hits !== 'number' || typeof modelReady !== 'boolean') return undefined
  return { mode, hits, modelReady }
}

/**
 * Completed-call presentation: a generic card titled by the match count.
 * The hit list itself is already in the raw `tool/result` content, so the
 * card carries only the summary.
 *
 * @param args - the raw tool arguments.
 * @param result - the final model-facing tool result; `meta` carries the summary.
 * @returns the presentation view, or `undefined` (generic card) on failure.
 */
export function presentLocalSearchResult(_args: { queries: string[] }, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = localSearchMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  const noun = meta.hits === 1 ? 'match' : 'matches'
  return { card: 'generic', title: `${meta.hits} local ${noun}` }
}

/**
 * Register the `local_search` tool and its scope-aware system-prompt
 * guidance.
 *
 * @param ctx - context whose `tools` and `systemPrompt` registries receive
 *   the registrations; both are effect-scoped and unregister on plugin dispose.
 * @param maxResults - the upper bound on returned hits.
 * @param maxQueries - the upper bound on queries in one call.
 */
export function applyLocalSearchTool(ctx: Context, maxResults: number, maxQueries: number): void {
  ctx.systemPrompt.section({
    name: 'tool:local_search',
    order: ctx.systemPrompt.getSectionOrder('TOOL_WEB_SEARCH'),
    text: ({ scope }) => ctx.tools.get('local_search', scope) === undefined
      ? ''
      : 'Use the local_search tool to search the locally indexed corpus — pages this '
        + 'session has fetched (web_fetch) or crawled (web_crawl). It does not touch the '
        + 'live web; for live results use web_search. If a topic has no local matches, '
        + 'fetch or crawl the relevant site first, then search again.',
  })

  ctx.tools.register(defineTool({
    name: 'local_search',
    description: 'Search the locally indexed corpus (fetched and crawled pages) with lexical, semantic, or hybrid retrieval.',
    parameters: {
      queries: {
        type: 'array',
        required: true,
        description: `1–${maxQueries} search queries over the local corpus.`,
        items: { type: 'string' },
      },
      maxResults: { type: 'integer', description: `Maximum hits to return (default ${maxResults}).` },
      mode: {
        type: 'string',
        description: "'hybrid' (default), 'lexical' (FTS5 BM25), or 'semantic' (embedding similarity).",
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true },
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                title: { type: 'string', required: true },
                domain: { type: 'string', required: true },
                score: { type: 'number', required: true },
                snippet: { type: 'string', required: true },
              },
            },
          },
          modelReady: { type: 'boolean', required: true },
          elapsedMs: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatLocalSearchOutput(value) }],
      presentationMeta: (_args, value) => localSearchMetaFromValue(value),
    },
    // Local retrieval is fast; the budget covers model-backed semantic search.
    timeoutMs: 60_000,
    // Reads do not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      void exec
      const queries = parseLocalSearchArgs(args, maxQueries)
      const mode: LocalSearchMode = args.mode === 'lexical' || args.mode === 'semantic' ? args.mode : 'hybrid'
      const maxHits = Math.min(50, Math.max(1, args.maxResults ?? maxResults))
      return await searchLocal({ queries, maxResults: maxHits, mode })
    },
    presentCall: (args) => ({ card: 'generic', title: args.queries.join(' | '), kind: 'search' }),
    presentResult: (args, result) => presentLocalSearchResult(args, result),
  }))
}
