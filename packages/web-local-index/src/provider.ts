/**
 * `IndexedFetchProvider`: the default fetch path for profiles that want
 * every fetched page to join the local corpus automatically. It wraps the
 * local HTTP provider and indexes each successful result as a side effect
 * — indexing failures never fail the fetch.
 * @module @deepseek-ai/dsh-web-local-index/provider
 */

import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import type { HttpFetchLimits } from '@deepseek-ai/dsh-web-fetch-http'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { indexPage } from './store.ts'

/** Stable id this provider registers under. */
export const INDEXED_FETCH_PROVIDER_ID = 'indexed'

/**
 * Transport limits for the wrapped HTTP provider (the same defaults the
 * `web-fetch-http` plugin resolves when its config is left unset).
 */
const DEFAULT_HTTP_FETCH_LIMITS: HttpFetchLimits = {
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 30_000,
  maxRedirects: 5,
  userAgent: 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)',
}

/**
 * A `WebFetchProvider` that indexes every successful fetch into the local
 * corpus. The wrapped provider does all retrieval; indexing is a
 * fire-and-forget side effect.
 */
export class IndexedFetchProvider implements WebFetchProvider {
  readonly id = INDEXED_FETCH_PROVIDER_ID

  /**
   * @param inner - the wrapped provider (defaults to the local HTTP provider).
   */
  constructor(private readonly inner: WebFetchProvider = new HttpFetchProvider(DEFAULT_HTTP_FETCH_LIMITS)) {}

  available(): boolean {
    return this.inner.available()
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const result = await this.inner.fetch(request, signal)
    void this.indexResult(result).catch(() => {
      // Indexing is best-effort; the fetch result is authoritative.
    })
    return result
  }

  private async indexResult(result: WebFetchResult): Promise<void> {
    const content = result.body.content
    const title = result.body.kind === 'html' ? extractTitle(content) : ''
    await indexPage({
      url: result.url,
      title,
      text: content,
      fetchedAt: new Date().toISOString(),
    })
  }
}

/** Extract the first `<title>` element's text from HTML (empty when absent). */
function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)
  return match?.[1]?.replace(/\s+/gu, ' ').trim() ?? ''
}
