import { describe, expect, it } from 'vitest'
import { SearxngSearchProvider } from '@deepseek-ai/dsh-web-search-searxng'

/**
 * Real-instance smoke for the SearXNG search provider. Self-skips when
 * `$SEARXNG_BASE_URL` is unset or its instance does not answer `/healthz`
 * (CI has no instance), per the with-key e2e policy in docs/testing.md.
 */
const baseURL = process.env.SEARXNG_BASE_URL
let reachable = false
if (baseURL !== undefined && baseURL.length > 0) {
  try {
    const health = await fetch(`${baseURL}/healthz`, { signal: AbortSignal.timeout(5_000) })
    reachable = health.ok
  } catch {
    reachable = false
  }
}
const maybe = reachable ? describe : describe.skip

maybe('SearxngSearchProvider live instance', () => {
  it('returns sources for a live query', async () => {
    const provider = new SearxngSearchProvider({ baseURL: baseURL! })
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
