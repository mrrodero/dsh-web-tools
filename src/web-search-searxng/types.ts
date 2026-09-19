/**
 * Wire types for the SearXNG search API (`GET /search?format=json`). Types
 * only — no runtime code. SearXNG returns a flat `results[]`; each entry
 * carries a URL, optional title, a `content` snippet, the engine(s) that
 * produced it, and (when the upstream engine supplies one) an ISO
 * `publishedDate`.
 *
 * @module @deepseek-ai/dsh-web-search-searxng/types
 */

/** One entry of SearXNG's `results[]`. */
export interface SearxngResult {
  url: string
  title?: string | null
  /** Snippet text; blank or absent when the upstream engine returned none. */
  content?: string | null
  /** Primary engine that produced the result. */
  engine?: string
  /** Engines that returned this result (merged duplicates). */
  engines?: string[]
  /** Engine-provided relevance score. */
  score?: number
  img_url?: string | null
  /** ISO-8601 publication date, present only when the engine supplies one. */
  publishedDate?: string | null
}

/** One entry of SearXNG's `unresponsive_engines[]`. */
export interface SearxngUnresponsiveEngine {
  engine: string
  error?: string
}

/** SearXNG's search response envelope (JSON format). */
export interface SearxngSearchResponse {
  query?: string
  results?: SearxngResult[]
  /** Direct answers keyed by topic; SearXNG usually returns none. */
  answers?: Record<string, string>
  corrections?: string[]
  infoboxes?: unknown[]
  suggestions?: string[]
  unresponsive_engines?: SearxngUnresponsiveEngine[]
}
