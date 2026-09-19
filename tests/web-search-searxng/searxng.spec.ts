import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { SearxngSearchProvider, SEARXNG_PROVIDER_ID } from '../../src/web-search-searxng/index.ts'
import * as searxngPlugin from '../../src/web-search-searxng/index.ts'
import { mapSearxngResult, mapSearxngResponse } from '../../src/web-search-searxng/provider.ts'

const options = { baseURL: 'http://searxng.test' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SearXNG result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapSearxngResult({
      url: 'https://a.test',
      title: 'A',
      content: 'snippet text',
      engine: 'duckduckgo',
      engines: ['duckduckgo', 'brave'],
      score: 1.5,
      publishedDate: '2026-01-01T00:00:00Z',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'snippet text', publishedAt: '2026-01-01T00:00:00Z' })
  })

  it('drops a result with no usable content', () => {
    expect(mapSearxngResult({ url: 'https://a.test', content: '' })).toBeUndefined()
    expect(mapSearxngResult({ url: 'https://a.test', content: '   ' })).toBeUndefined()
    expect(mapSearxngResult({ url: 'https://a.test' })).toBeUndefined()
  })

  it('omits null/empty optional fields rather than emitting them', () => {
    expect(mapSearxngResult({ url: 'https://a.test', title: null, publishedDate: null, content: 'hi' }))
      .toEqual({ url: 'https://a.test', snippet: 'hi' })
    expect(mapSearxngResult({ url: 'https://a.test', title: '', publishedDate: '', content: 'hi' }))
      .toEqual({ url: 'https://a.test', snippet: 'hi' })
  })

  it('maps a response to a result with no content and filtered sources', () => {
    const result = mapSearxngResponse({
      query: 'test',
      results: [
        { url: 'https://a.test', content: 'one' },
        { url: 'https://b.test' },
        { url: 'https://c.test', title: 'C', content: 'three' },
      ],
      unresponsive_engines: [{ engine: 'bing' }],
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', snippet: 'one' },
        { url: 'https://c.test', title: 'C', snippet: 'three' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('tolerates a missing results array', () => {
    expect(mapSearxngResponse({}).sources).toEqual([])
  })
})

describe('SearxngSearchProvider availability', () => {
  it('is unavailable with an empty base URL', () => {
    expect(new SearxngSearchProvider({ baseURL: '' }).available()).toBe(false)
  })

  it('is available with a parseable base URL', () => {
    expect(new SearxngSearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new SearxngSearchProvider({ baseURL: 'not a url' }).available()).toBe(false)
  })
})

describe('SearxngSearchProvider request mapping', () => {
  it('sends q and format=json with no optional filters', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [{ url: 'https://a.test', content: 'hi' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new SearxngSearchProvider(options)
    await provider.search({ query: 'hello world' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('http://searxng.test/search')
    expect(parsed.searchParams.get('q')).toBe('hello world')
    expect(parsed.searchParams.get('format')).toBe('json')
    expect(parsed.searchParams.has('categories')).toBe(false)
    expect(parsed.searchParams.has('language')).toBe(false)
    expect(parsed.searchParams.has('time_range')).toBe(false)
    expect(init).toMatchObject({ redirect: 'error' })
    expect((init.headers as Record<string, string>)['accept']).toBe('application/json')
    expect((init.headers as Record<string, string>)['user-agent']).toBe('deepseek-harness/0.0.1')
  })

  it('sends configured categories, language and time_range', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new SearxngSearchProvider({ baseURL: 'http://searxng.test', categories: 'general,news', language: 'en', timeRange: 'month' })
    await provider.search({ query: 'hello' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    const parsed = new URL(url)
    expect(parsed.searchParams.get('categories')).toBe('general,news')
    expect(parsed.searchParams.get('language')).toBe('en')
    expect(parsed.searchParams.get('time_range')).toBe('month')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new SearxngSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('SearxngSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'format not allowed' }, { status: 403 })))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'format not allowed' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'SearXNG API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'SearXNG API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: {} }, { status: 200 })))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-searxng plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: SEARXNG_PROVIDER_ID })
    const fiber = await ctx.plugin(searxngPlugin, { baseURL: 'http://searxng.test' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in searxngPlugin).toBe(false)
  })

  it('threads categories, language and timeRange config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: SEARXNG_PROVIDER_ID })
    const fiber = await ctx.plugin(searxngPlugin, { baseURL: 'http://searxng.test', categories: 'news', language: 'en', timeRange: 'day' })
    await ctx.web.search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    const parsed = new URL(url)
    expect(parsed.searchParams.get('categories')).toBe('news')
    expect(parsed.searchParams.get('language')).toBe('en')
    expect(parsed.searchParams.get('time_range')).toBe('day')
    await fiber.dispose()
  })

  it('falls back to $SEARXNG_BASE_URL when config omits it', async () => {
    const prev = process.env.SEARXNG_BASE_URL
    process.env.SEARXNG_BASE_URL = 'http://searxng-env.test'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: SEARXNG_PROVIDER_ID })
      const fiber = await ctx.plugin(searxngPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(new URL(url).origin).toBe('http://searxng-env.test')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.SEARXNG_BASE_URL
      else process.env.SEARXNG_BASE_URL = prev
    }
  })

  it('is unavailable when neither config nor env supplies a base URL', async () => {
    const prev = process.env.SEARXNG_BASE_URL
    delete process.env.SEARXNG_BASE_URL
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: SEARXNG_PROVIDER_ID })
      await ctx.plugin(searxngPlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      if (prev !== undefined) process.env.SEARXNG_BASE_URL = prev
    }
  })
})
