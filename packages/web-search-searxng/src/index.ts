/**
 * SearXNG-backed `WebSearchProvider` plugin. It contributes to the `ctx.web`
 * registry without owning the service.
 *
 * @module @deepseek-ai/dsh-web-search-searxng
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { SearxngSearchProvider } from './provider.ts'

export {
  SearxngSearchProvider,
  SEARXNG_PROVIDER_ID,
} from './provider.ts'
export type { SearxngSearchProviderOptions, SearxngTimeRange } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-searxng'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var defaults). */
export interface Config {
  /** Instance base URL. Falls back to `$SEARXNG_BASE_URL`. Empty → provider unavailable. */
  baseURL?: string
  /** Comma-separated SearXNG categories (e.g. `general,news`). Omitted = the instance default. */
  categories?: string
  /** SearXNG language code (e.g. `en`, `all`). Omitted = the instance default. */
  language?: string
  /** Restrict results to the last day, month, or year. Omitted = no restriction. */
  timeRange?: 'day' | 'month' | 'year'
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
  categories: z.string(),
  language: z.string(),
  timeRange: z.union(['day', 'month', 'year'] as const),
})

/** Register the SearXNG search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new SearxngSearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    baseURL: config.baseURL ?? launchEnvironmentOf(ctx).get('SEARXNG_BASE_URL')?.value ?? '',
    ...config.categories !== undefined ? { categories: config.categories } : {},
    ...config.language !== undefined ? { language: config.language } : {},
    ...config.timeRange !== undefined ? { timeRange: config.timeRange } : {},
  }))
}
