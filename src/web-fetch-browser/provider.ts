/**
 * `BrowserFetchProvider`: a `WebFetchProvider` backed by a headless Chromium
 * (Playwright). Each fetch launches a fresh browser, opens one page, waits
 * for load, and serializes the rendered DOM. No browser state persists
 * between fetches (no profile, no cookies) — the provider is anonymous,
 * exactly like the local HTTP provider. Batch consumers (the crawl engine)
 * use {@link withBrowser} so a whole crawl pays the launch cost once.
 * @module @deepseek-ai/dsh-web-fetch-browser/provider
 */

import { existsSync } from 'node:fs'
import { chromium, type Browser, type Page, type Response } from 'playwright'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { validateBrowserUrl } from './policy.ts'
import type { BrowserFetchProviderOptions } from './types.ts'

/** Stable id this provider registers under. */
export const BROWSER_FETCH_PROVIDER_ID = 'browser'

/**
 * Map a Playwright navigation failure to the seam's error vocabulary.
 * Cancellation is not a provider error (the seam's cancellation contract).
 */
function mapNavigationError(error: unknown, signal: AbortSignal | undefined, timeoutMs: number): never {
  if (signal?.aborted) throw new WebError('render aborted', 'WEB_ABORTED', { cause: error })
  if (isTimeoutError(error)) {
    throw new WebError(`render timed out after ${timeoutMs}ms`, 'WEB_FETCH_TIMEOUT', { cause: error })
  }
  throw new WebError(`render failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}

/** Playwright names its navigation timeout `TimeoutError`. */
function isTimeoutError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'TimeoutError'
}

/** The headless-Chromium-backed fetch provider. */
export class BrowserFetchProvider implements WebFetchProvider {
  readonly id = BROWSER_FETCH_PROVIDER_ID

  constructor(private readonly options: BrowserFetchProviderOptions) {}

  /** The executable this provider would launch, or `undefined` when none resolves. */
  executablePath(): string | undefined {
    if (this.options.executablePath.length > 0) return this.options.executablePath
    try {
      return chromium.executablePath()
    } catch {
      return undefined
    }
  }

  available(): boolean {
    const path = this.executablePath()
    return path !== undefined && existsSync(path)
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    await validateBrowserUrl(request.url)
    return await this.withBrowser(async browser => {
      const context = await browser.newContext({ userAgent: this.options.userAgent })
      try {
        const page = await context.newPage()
        const response = await this.navigate(page, request.url, signal)
        const html = await page.content()
        const truncated = html.length > this.options.maxBodyChars
        return {
          url: page.url(),
          statusCode: response === null ? 0 : response.status(),
          body: { kind: 'html', content: truncated ? html.slice(0, this.options.maxBodyChars) : html },
          truncated,
        }
      } finally {
        await context.close()
      }
    })
  }

  /**
   * Run `fn` under one browser launch. {@link fetch} uses one launch per
   * call; batch consumers use this directly so a whole crawl pays the
   * launch cost once. The browser is always closed, even on failure.
   *
   * @param fn - the work to run with one launched browser.
   * @throws {@link WebError} with code `WEB_PROVIDER_UNAVAILABLE` when no
   *   Chromium executable is installed.
   */
  async withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
    const path = this.executablePath()
    if (path === undefined || !existsSync(path)) {
      throw new WebError(
        'headless Chromium is not installed (run `npx playwright install chromium` once, or set executablePath)',
        'WEB_PROVIDER_UNAVAILABLE',
      )
    }
    const browser = await chromium.launch({ executablePath: path, headless: true })
    try {
      return await fn(browser)
    } finally {
      await browser.close()
    }
  }

  /** Navigate one page, honoring the caller's signal and the navigation timeout. */
  private async navigate(page: Page, url: string, signal: AbortSignal | undefined): Promise<Response | null> {
    if (signal?.aborted) throw new WebError('render aborted', 'WEB_ABORTED')
    let onAbort: (() => void) | undefined
    if (signal !== undefined) {
      // Closing the page aborts the in-flight navigation; the catch below
      // maps it to WEB_ABORTED via the signal state.
      onAbort = () => { void page.close() }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      return await page.goto(url, { waitUntil: 'load', timeout: this.options.timeoutMs })
    } catch (error: unknown) {
      throw mapNavigationError(error, signal, this.options.timeoutMs)
    } finally {
      if (signal !== undefined && onAbort !== undefined) signal.removeEventListener('abort', onAbort)
    }
  }
}
