/**
 * The crawl engine: a bounded breadth-first crawl of one domain. The engine
 * is fetcher-agnostic — it receives a {@link PageFetcher} (plain HTTP or a
 * headless browser) plus a page-indexing hook, and owns the queue, the
 * visited set, robots filtering, politeness delay, and abort handling.
 * @module @deepseek-ai/dsh-web-crawl/engine
 */

import { WebError } from '@deepseek-ai/dsh-web'
import { extractPage } from './extract.ts'
import { fetchRobots, robotsAllowed, type RobotsPolicy } from './robots.ts'
import type { CrawlOptions, CrawledPage, CrawlResult, PageFetcher } from './types.ts'

/** A fetched page together with its discovered link frontier. */
interface FetchedPage {
  readonly page: CrawledPage
  readonly links: readonly string[]
}

/**
 * Normalize a URL for the visited set: strip the fragment, drop a trailing
 * slash on the path (except the root), and lowercase the host.
 *
 * @param url - the URL to normalize.
 * @returns the normalized URL string.
 */
export function normalizeUrl(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.hostname = parsed.hostname.toLowerCase()
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1)
  }
  return parsed.toString()
}

/**
 * The domain key for same-domain filtering: the hostname without a leading
 * `www.` (www-tolerant, per the crawl contract).
 *
 * @param url - the URL whose domain key is wanted.
 * @returns the lowercased hostname without a leading `www.`.
 */
export function domainKey(url: string): string {
  const host = new URL(url).hostname.toLowerCase()
  return host.startsWith('www.') ? host.slice(4) : host
}

/**
 * Run one bounded crawl.
 *
 * @param seed - the seed URL (validated and normalized by the caller).
 * @param options - the resolved crawl options.
 * @param fetcher - the page fetcher (plain HTTP or browser-backed).
 * @param onIndex - optional hook called with each successfully crawled page
 *   (the local index); failures here never fail the crawl.
 * @param signal - optional cancellation signal; aborting throws `WEB_ABORTED`.
 * @param policy - an already-fetched robots policy; when omitted it is
 *   fetched from the seed's origin (tests inject a fixed policy).
 * @returns the crawl result in BFS order.
 */
export async function crawl(
  seed: string,
  options: CrawlOptions,
  fetcher: PageFetcher,
  onIndex: ((page: CrawledPage) => Promise<void>) | undefined,
  signal: AbortSignal | undefined,
  policy: RobotsPolicy | undefined = undefined,
): Promise<CrawlResult> {
  const seedUrl = normalizeUrl(seed)
  const seedDomain = domainKey(seedUrl)
  const visited = new Set<string>([seedUrl])
  const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }]
  const pages: CrawledPage[] = []
  const robots = policy ?? await fetchRobots(seedUrl, options.userAgent, signal)
  let truncated = false

  while (queue.length > 0) {
    if (pages.length >= options.maxPages) {
      truncated = true
      break
    }
    const item = queue.shift()
    if (item === undefined) break
    if (item.depth > options.maxDepth) continue
    if (signal?.aborted) throw new WebError('crawl aborted', 'WEB_ABORTED')
    if (!robotsAllowed(item.url, robots, options.userAgent)) continue

    const fetched = await fetchAndExtract(item.url, item.depth, options, fetcher, signal)
    pages.push(fetched.page)
    if (fetched.page.error === undefined && onIndex !== undefined) {
      try {
        await onIndex(fetched.page)
      } catch {
        // Indexing failures never fail the crawl.
      }
    }

    if (fetched.page.error === undefined) {
      for (const rawLink of fetched.links) {
        const link = normalizeUrl(rawLink)
        if (visited.has(link)) continue
        if (!isHttpUrl(link)) continue
        if (domainKey(link) !== seedDomain) continue
        visited.add(link)
        queue.push({ url: link, depth: item.depth + 1 })
      }
    }
    await sleep(options.delayMs, signal)
  }

  return {
    seed: seedUrl,
    pages,
    totalChars: pages.reduce((total, page) => total + page.markdown.length, 0),
    truncated,
  }
}

/**
 * Fetch one page and extract it; failures become error pages (the crawl
 * continues). Redirects that leave the seed domain are treated as failures.
 */
async function fetchAndExtract(
  url: string,
  depth: number,
  options: CrawlOptions,
  fetcher: PageFetcher,
  signal: AbortSignal | undefined,
): Promise<FetchedPage> {
  let raw: import('./types.ts').RawPage | null
  try {
    raw = await fetcher(url, signal)
  } catch (error: unknown) {
    return { page: { url, depth, title: '', markdown: '', status: 0, error: `fetch failed: ${String(error)}` }, links: [] }
  }
  if (raw === null) {
    return { page: { url, depth, title: '', markdown: '', status: 0, error: 'not crawlable (non-HTML or blocked)' }, links: [] }
  }
  if (domainKey(raw.finalUrl) !== domainKey(url)) {
    return {
      page: { url, depth, title: '', markdown: '', status: raw.status, error: `redirect left the crawl domain (${raw.finalUrl})` },
      links: [],
    }
  }
  const extracted = extractPage(raw.html, raw.finalUrl, options.maxPageChars)
  return {
    page: {
      url: raw.finalUrl,
      depth,
      title: extracted.title,
      markdown: extracted.markdown,
      status: raw.status,
    },
    links: extracted.links,
  }
}

/** Whether a URL is http(s) (the only schemes the crawl follows). */
function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Sleep for `ms`, resolving early when the signal aborts. */
async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return
  if (signal === undefined || signal.aborted) return
  await new Promise<void>(resolve => {
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
