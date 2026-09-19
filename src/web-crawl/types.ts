/**
 * Shared vocabulary for the crawl engine and the `web_crawl` tool.
 * @module @deepseek-ai/dsh-web-crawl/types
 */

/** How pages are retrieved during a crawl. */
export type CrawlRenderMode = 'none' | 'browser'

/** Resolved crawl options (the tool's `apply` fills defaults). */
export interface CrawlOptions {
  /** Maximum number of pages to fetch (inclusive). */
  readonly maxPages: number
  /** Maximum link depth from the seed (0 = seed only). */
  readonly maxDepth: number
  /** Polite delay between page fetches (ms). */
  readonly delayMs: number
  /** Cap on each page's extracted markdown (chars). */
  readonly maxPageChars: number
  /** Page retrieval mode: plain HTTP or headless-browser render. */
  readonly render: CrawlRenderMode
  /** Index each successfully crawled page into the local corpus index. */
  readonly index: boolean
  /** `User-Agent` sent to crawled pages. */
  readonly userAgent: string
  /** Navigation timeout for browser-rendered pages (ms). */
  readonly navigationTimeoutMs: number
  /** Cap on a single fetched response body (bytes). */
  readonly maxResponseBytes: number
}

/** One crawled page (successful or failed). */
export interface CrawledPage {
  /** The page's final URL. */
  readonly url: string
  /** Link depth from the seed (0 = seed). */
  readonly depth: number
  /** The page title (empty when absent). */
  readonly title: string
  /** The extracted content as markdown (empty on failure). */
  readonly markdown: string
  /** HTTP status code (0 when no HTTP response was obtained). */
  readonly status: number
  /** Failure reason, present only when the page could not be crawled. */
  readonly error?: string
}

/** The complete result of one crawl. */
export interface CrawlResult {
  /** The normalized seed URL. */
  readonly seed: string
  /** Pages in crawl (BFS) order. */
  readonly pages: CrawledPage[]
  /** Total extracted markdown characters across successful pages. */
  readonly totalChars: number
  /** True when the page cap stopped the crawl before the queue drained. */
  readonly truncated: boolean
}

/** A raw fetched page before extraction. */
export interface RawPage {
  /** The requested URL. */
  readonly url: string
  /** The final URL after redirects. */
  readonly finalUrl: string
  /** HTTP status code. */
  readonly status: number
  /** The response body as text. */
  readonly html: string
}

/**
 * Fetch one page. Returns `null` for pages that are not crawlable HTML
 * (non-HTML content types, blocked robots, failed fetches are reported
 * differently). Implementations must honor the signal.
 */
export type PageFetcher = (url: string, signal: AbortSignal | undefined) => Promise<RawPage | null>
