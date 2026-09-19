/**
 * The two {@link PageFetcher} implementations for the crawl engine: plain
 * anonymous HTTP (node `fetch`) and headless-browser rendering (one browser
 * context per page, all under a single launch supplied by the caller).
 * @module @deepseek-ai/dsh-web-crawl/fetchers
 */

import type { Browser } from '@deepseek-ai/dsh-web-fetch-browser'
import type { CrawlOptions, PageFetcher, RawPage } from './types.ts'

/**
 * Build the plain-HTTP page fetcher: anonymous `fetch` with redirect
 * following, a response-size cap, and a text/html content-type gate.
 *
 * @param options - the resolved crawl options (user agent, size cap).
 * @returns the page fetcher; non-HTML responses resolve to `null`.
 */
export function makeHttpFetcher(options: CrawlOptions): PageFetcher {
  return async (url, signal) => {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: signal ?? null,
      headers: { 'User-Agent': options.userAgent },
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) {
      await response.body?.cancel()
      return null
    }
    const html = await readWithCap(response, options.maxResponseBytes)
    return { url, finalUrl: response.url, status: response.status, html }
  }
}

/**
 * Read a response body up to `maxBytes`, cancelling the body when the cap
 * is exceeded.
 *
 * @param response - the HTTP response.
 * @param maxBytes - the byte cap.
 * @returns the decoded body text.
 * @throws Error when the body exceeds the cap.
 */
async function readWithCap(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('response has no body')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`response exceeds ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return new TextDecoder().decode(concat(chunks))
}

/** Concatenate byte chunks into one buffer. */
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Build a browser-rendering page fetcher under one already-launched browser:
 * one fresh context per page (no state shared between pages), closed in
 * `finally`.
 *
 * @param browser - the launched browser (owned by the caller).
 * @param options - the resolved crawl options (user agent, navigation timeout).
 * @returns the page fetcher.
 */
export function makeBrowserFetcher(browser: Browser, options: CrawlOptions): PageFetcher {
  return async (url, signal) => {
    const context = await browser.newContext({ userAgent: options.userAgent })
    try {
      const page = await context.newPage()
      const onAbort = () => { void page.close() }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: options.navigationTimeoutMs })
        const html = await page.content()
        return { url, finalUrl: page.url(), status: response === null ? 0 : response.status(), html }
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    } finally {
      await context.close()
    }
  }
}
