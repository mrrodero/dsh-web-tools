/**
 * @deepseek-ai/dsh-web-crawl — bounded same-domain site crawling for the
 * DeepSeek Harness web capability bundle. Registers the model-facing
 * `web_crawl` tool: a bounded breadth-first crawl (page cap, depth cap,
 * robots.txt, politeness delay) whose successful pages are indexed into
 * the local corpus index for follow-up `local_search` queries.
 * @module @deepseek-ai/dsh-web-crawl
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { BrowserFetchProvider, BROWSER_EXECUTABLE_ENV_KEY } from '@deepseek-ai/dsh-web-fetch-browser'
import { applyWebCrawlTool } from './tool.ts'
import type { CrawlOptions } from './types.ts'

export { crawl, normalizeUrl, domainKey } from './engine.ts'
export { makeHttpFetcher, makeBrowserFetcher } from './fetchers.ts'
export { extractPage } from './extract.ts'
export { parseRobots, robotsAllowed, fetchRobots, EMPTY_POLICY } from './robots.ts'
export type { CrawlOptions, CrawledPage, CrawlResult, CrawlRenderMode, PageFetcher, RawPage } from './types.ts'

/** Plugin registration name (the `id` in profile/bundle patch rows). */
export const name = 'web-crawl'

/** Services this plugin requires from the host composition. */
export const inject = ['tools', 'systemPrompt']

/** Default page cap per crawl. */
export const DEFAULT_MAX_PAGES = 50

/** Default depth cap per crawl. */
export const DEFAULT_MAX_DEPTH = 3

/** Default politeness delay between page fetches (ms). */
export const DEFAULT_DELAY_MS = 500

/** Default cap on each page's extracted markdown (chars). */
export const DEFAULT_MAX_PAGE_CHARS = 20_000

/** Default cap on a single fetched response body (bytes). */
export const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000

/** Default navigation timeout for browser-rendered pages (ms). */
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 60_000

/** Default cap on the complete rendered tool output (chars). */
export const DEFAULT_MAX_OUTPUT_CHARS = 200_000

/** Default `User-Agent` sent to crawled pages. */
export const DEFAULT_USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)'

/** Deployment configuration for the crawl tool. */
export interface Config {
  /** Page cap per crawl (1–200). */
  maxPages?: number
  /** Depth cap per crawl (0–5). */
  maxDepth?: number
  /** Politeness delay between page fetches (ms). */
  delayMs?: number
  /** Cap on each page's extracted markdown (chars). */
  maxPageChars?: number
  /** Default retrieval mode: plain HTTP or headless-browser render. */
  render?: 'none' | 'browser'
  /** Index crawled pages into the local corpus (default true). */
  index?: boolean
  /** `User-Agent` sent to crawled pages. */
  userAgent?: string
  /** Path to a Chromium executable for `render: 'browser'` (env fallback `DSH_BROWSER_EXECUTABLE_PATH`). */
  executablePath?: string
  /** Navigation timeout for browser-rendered pages (ms). */
  navigationTimeoutMs?: number
  /** Cap on a single fetched response body (bytes). */
  maxResponseBytes?: number
  /** Cap on the complete rendered tool output (chars). */
  maxOutputChars?: number
  /** Register the `web_crawl` tool (default true). */
  registerTool?: boolean
}

/**
 * The deployment configuration: crawl bounds, politeness, retrieval mode,
 * indexing, and the tool's output cap. Every field is optional with a safe
 * default.
 */
export const Config: z<Config> = z.object({
  maxPages: z.number().default(DEFAULT_MAX_PAGES),
  maxDepth: z.number().default(DEFAULT_MAX_DEPTH),
  delayMs: z.number().default(DEFAULT_DELAY_MS),
  maxPageChars: z.number().default(DEFAULT_MAX_PAGE_CHARS),
  render: z.union(['none', 'browser'] as const).default('none'),
  index: z.boolean().default(true),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
  executablePath: z.string(),
  navigationTimeoutMs: z.number().default(DEFAULT_NAVIGATION_TIMEOUT_MS),
  maxResponseBytes: z.number().default(DEFAULT_MAX_RESPONSE_BYTES),
  maxOutputChars: z.number().default(DEFAULT_MAX_OUTPUT_CHARS),
  registerTool: z.boolean().default(true),
})

/**
 * Wire the `web_crawl` tool into the host composition. The tool is
 * registered in the global tool layer (the plugin's patch row runs in an
 * unscoped context), so every agent scope can crawl. All registrations are
 * effect-scoped and disappear with the plugin's effect.
 *
 * @param ctx - the host context providing the `tools` and `systemPrompt`
 *   registries.
 * @param config - the deployment configuration (validated by {@link Config}).
 */
export function apply(ctx: Context, config: Config): void {
  const options: CrawlOptions = {
    maxPages: config.maxPages ?? DEFAULT_MAX_PAGES,
    maxDepth: config.maxDepth ?? DEFAULT_MAX_DEPTH,
    delayMs: config.delayMs ?? DEFAULT_DELAY_MS,
    maxPageChars: config.maxPageChars ?? DEFAULT_MAX_PAGE_CHARS,
    render: config.render ?? 'none',
    index: config.index ?? true,
    userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
    navigationTimeoutMs: config.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
    maxResponseBytes: config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  }
  const envExecutable = launchEnvironmentOf(ctx).get(BROWSER_EXECUTABLE_ENV_KEY)?.value
  const browser = new BrowserFetchProvider({
    executablePath: config.executablePath ?? envExecutable ?? '',
    timeoutMs: options.navigationTimeoutMs,
    maxBodyChars: options.maxResponseBytes,
    userAgent: options.userAgent,
  })
  if (config.registerTool ?? true) {
    applyWebCrawlTool(ctx, options, browser, config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS)
  }
}
