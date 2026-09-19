/**
 * `SearxngSearchProvider`: a `WebSearchProvider` backed by a self-hosted
 * SearXNG instance's JSON API (`GET /search?format=json`). It maps `content`
 * to `snippet`, maps `publishedDate` to `publishedAt`, drops entries without
 * a snippet, and omits `content` because SearXNG generates no answer.
 * @module @deepseek-ai/dsh-web-search-searxng/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { SearxngResult, SearxngSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const SEARXNG_PROVIDER_ID = 'searxng'

/** Time-range filter values SearXNG accepts for `time_range`. */
export type SearxngTimeRange = 'day' | 'month' | 'year'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var defaults). */
export interface SearxngSearchProviderOptions {
  /** Instance base URL; `/search` is appended. Empty makes the provider unavailable. */
  baseURL: string
  /** Comma-separated SearXNG categories (e.g. `general,news`); omitted = the instance default. */
  categories?: string
  /** SearXNG language code (e.g. `en`, `all`); omitted = the instance default. */
  language?: string
  /** Restrict results to the last day, month, or year; omitted = no restriction. */
  timeRange?: SearxngTimeRange
}

/**
 * Map one SearXNG result to a normalized source, or `undefined` when it
 * carries no portable snippet (an entry with blank or absent `content` is
 * dropped — the seam has no other field to derive a snippet from, and
 * inventing one would lie).
 *
 * @param result - one entry of SearXNG's `results[]`.
 * @returns the normalized source, or `undefined` when the entry has no
 *   non-blank `content`.
 */
export function mapSearxngResult(result: SearxngResult): WebSearchSource | undefined {
  const snippet = result.content?.trim()
  if (snippet === undefined || snippet.length === 0) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.trim().length > 0 ? { title: result.title } : {},
    snippet,
    ...result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {},
  }
}

/**
 * Map a SearXNG response envelope to a normalized search result.
 *
 * @param response - the parsed `GET /search` response body.
 * @returns the normalized result; snippet-less entries are dropped
 *   ({@link mapSearxngResult}).
 */
export function mapSearxngResponse(response: SearxngSearchResponse): WebSearchResult {
  const sources = (response.results ?? [])
    .map(mapSearxngResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // SearXNG generates no answer, so `content` is omitted. The web service owns
  // the final `maxResults` truncation, so this provider reports `truncated: false`.
  return { sources, truncated: false }
}

/** The SearXNG-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_PROVIDER_ID

  constructor(private readonly options: SearxngSearchProviderOptions) {}

  available(): boolean {
    return this.options.baseURL.length > 0 && isValidBaseUrl(this.options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const search = new URL('/search', this.options.baseURL)
    search.searchParams.set('q', request.query)
    search.searchParams.set('format', 'json')
    if (this.options.categories !== undefined && this.options.categories.length > 0) {
      search.searchParams.set('categories', this.options.categories)
    }
    if (this.options.language !== undefined && this.options.language.length > 0) {
      search.searchParams.set('language', this.options.language)
    }
    if (this.options.timeRange !== undefined) {
      search.searchParams.set('time_range', this.options.timeRange)
    }

    let response: Response
    try {
      response = await fetch(search, {
        redirect: 'error',
        headers: {
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`SearXNG search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `SearXNG API error (HTTP ${status})`
      try {
        const parsed = await response.json() as { error?: string; message?: string }
        const detail = parsed.error ?? parsed.message
        if (typeof detail === 'string' && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // non-JSON error body (normal for SearXNG's HTML error pages) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as SearxngSearchResponse
      return mapSearxngResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`SearXNG returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
