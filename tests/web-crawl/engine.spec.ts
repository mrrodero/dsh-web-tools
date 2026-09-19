import { describe, expect, it } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { crawl, domainKey, normalizeUrl } from '../../src/web-crawl/engine.ts'
import { EMPTY_POLICY } from '../../src/web-crawl/robots.ts'
import type { CrawlOptions, PageFetcher, RawPage } from '../../src/web-crawl/types.ts'

function options(overrides: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    maxPages: 50,
    maxDepth: 3,
    delayMs: 0,
    maxPageChars: 10_000,
    render: 'none',
    index: false,
    userAgent: 'test-crawler',
    navigationTimeoutMs: 5_000,
    maxResponseBytes: 1_000_000,
    ...overrides,
  }
}

/** A fetcher serving a fixed URL→page table; unknown URLs fail. */
function tableFetcher(table: Record<string, string>): PageFetcher {
  return async (url) => {
    const html = table[normalizeUrl(url)]
    if (html === undefined) throw new Error(`no page for ${url}`)
    return { url, finalUrl: normalizeUrl(url), status: 200, html } satisfies RawPage
  }
}

const PAGE = (title: string, body: string, links: string[] = []): string =>
  `<html><head><title>${title}</title></head><body><main>${body}</main>`
  + links.map(link => `<a href="${link}">link</a>`).join('')
  + '</body></html>'

describe('normalizeUrl', () => {
  it('strips fragments, trailing slashes, and host case', () => {
    expect(normalizeUrl('https://Example.com/a/b/#frag')).toBe('https://example.com/a/b')
    expect(normalizeUrl('https://example.com/a/')).toBe('https://example.com/a')
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })
})

describe('domainKey', () => {
  it('is www-tolerant and case-insensitive', () => {
    expect(domainKey('https://WWW.Example.com/x')).toBe('example.com')
    expect(domainKey('https://example.com/x')).toBe('example.com')
  })
})

describe('crawl', () => {
  it('crawls the seed and its same-domain links in BFS order', async () => {
    const table = {
      'https://example.com/': PAGE('Home', 'home body', ['/a', '/b']),
      'https://example.com/a': PAGE('A', 'a body', ['/c']),
      'https://example.com/b': PAGE('B', 'b body'),
      'https://example.com/c': PAGE('C', 'c body'),
    }
    const result = await crawl('https://example.com/', options(), tableFetcher(table), undefined, undefined, EMPTY_POLICY)
    expect(result.seed).toBe('https://example.com/')
    expect(result.pages.map(page => page.url)).toEqual([
      'https://example.com/',
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ])
    expect(result.pages.map(page => page.depth)).toEqual([0, 1, 1, 2])
    expect(result.truncated).toBe(false)
    expect(result.totalChars).toBeGreaterThan(0)
  })

  it('ignores cross-domain links', async () => {
    const table = {
      'https://example.com/': PAGE('Home', 'home body', ['https://other.org/x', '/a']),
      'https://example.com/a': PAGE('A', 'a body'),
    }
    const result = await crawl('https://example.com/', options(), tableFetcher(table), undefined, undefined, EMPTY_POLICY)
    expect(result.pages.map(page => page.url)).toEqual(['https://example.com/', 'https://example.com/a'])
  })

  it('deduplicates via the visited set (normalized)', async () => {
    const table = {
      'https://example.com/': PAGE('Home', 'home body', ['/a', '/a/', 'https://EXAMPLE.com/a#frag']),
      'https://example.com/a': PAGE('A', 'a body'),
    }
    const result = await crawl('https://example.com/', options(), tableFetcher(table), undefined, undefined, EMPTY_POLICY)
    expect(result.pages.map(page => page.url)).toEqual(['https://example.com/', 'https://example.com/a'])
  })

  it('respects the depth cap', async () => {
    const table = {
      'https://example.com/': PAGE('Home', 'home body', ['/a']),
      'https://example.com/a': PAGE('A', 'a body', ['/b']),
      'https://example.com/b': PAGE('B', 'b body'),
    }
    const result = await crawl('https://example.com/', options({ maxDepth: 1 }), tableFetcher(table), undefined, undefined, EMPTY_POLICY)
    expect(result.pages.map(page => page.url)).toEqual(['https://example.com/', 'https://example.com/a'])
  })

  it('respects the page cap and flags truncation', async () => {
    const table = {
      'https://example.com/': PAGE('Home', 'home body', ['/a', '/b', '/c']),
      'https://example.com/a': PAGE('A', 'a body'),
      'https://example.com/b': PAGE('B', 'b body'),
      'https://example.com/c': PAGE('C', 'c body'),
    }
    const result = await crawl('https://example.com/', options({ maxPages: 3 }), tableFetcher(table), undefined, undefined, EMPTY_POLICY)
    expect(result.pages).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })

  it('records error pages and continues the crawl', async () => {
    const table = {
      'https://example.com/': PAGE('Home', 'home body', ['/missing', '/ok']),
      'https://example.com/ok': PAGE('OK', 'ok body'),
    }
    const result = await crawl('https://example.com/', options(), tableFetcher(table), undefined, undefined, EMPTY_POLICY)
    const missing = result.pages.find(page => page.url === 'https://example.com/missing')
    expect(missing?.error).toBeTypeOf('string')
    expect(result.pages.some(page => page.url === 'https://example.com/ok')).toBe(true)
  })

  it('treats redirects leaving the domain as failures', async () => {
    const fetcher: PageFetcher = async url => ({
      url,
      finalUrl: 'https://other.org/away',
      status: 301,
      html: '<html><body>elsewhere</body></html>',
    })
    const result = await crawl('https://example.com/', options({ maxPages: 1 }), fetcher, undefined, undefined, EMPTY_POLICY)
    expect(result.pages[0]?.error).toContain('redirect left the crawl domain')
  })

  it('skips robots-disallowed URLs', async () => {
    const { parseRobots } = await import('../../src/web-crawl/robots.ts')
    const policy = parseRobots('User-agent: *\nDisallow: /private')
    const table = {
      'https://example.com/': PAGE('Home', 'home body', ['/private', '/open']),
      'https://example.com/private': PAGE('P', 'p body'),
      'https://example.com/open': PAGE('O', 'o body'),
    }
    const result = await crawl('https://example.com/', options(), tableFetcher(table), undefined, undefined, policy)
    expect(result.pages.map(page => page.url)).toEqual(['https://example.com/', 'https://example.com/open'])
  })

  it('calls the index hook for each successful page', async () => {
    const indexed: string[] = []
    const table = {
      'https://example.com/': PAGE('Home', 'home body', ['/a']),
      'https://example.com/a': PAGE('A', 'a body'),
    }
    await crawl(
      'https://example.com/',
      options(),
      tableFetcher(table),
      async page => { indexed.push(page.url) },
      undefined,
      EMPTY_POLICY,
    )
    expect(indexed).toEqual(['https://example.com/', 'https://example.com/a'])
  })

  it('throws WEB_ABORTED when the signal aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const table = { 'https://example.com/': PAGE('Home', 'home body') }
    await expect(
      crawl('https://example.com/', options(), tableFetcher(table), undefined, controller.signal, EMPTY_POLICY),
    ).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('throws WebError on abort', async () => {
    const controller = new AbortController()
    controller.abort()
    const table = { 'https://example.com/': PAGE('Home', 'home body') }
    try {
      await crawl('https://example.com/', options(), tableFetcher(table), undefined, controller.signal, EMPTY_POLICY)
      throw new Error('unreachable')
    } catch (error) {
      expect(error).toBeInstanceOf(WebError)
    }
  })
})
