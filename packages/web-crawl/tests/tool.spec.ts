import { describe, expect, it } from 'vitest'
import { crawlMetaFromResult, crawlMetaFromValue, formatCrawlOutput } from '../src/tool.ts'
import type { CrawlResult } from '../src/types.ts'

function result(overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    seed: 'https://example.com/',
    pages: [
      { url: 'https://example.com/', depth: 0, title: 'Home', markdown: 'home body', status: 200 },
      { url: 'https://example.com/a', depth: 1, title: 'A', markdown: 'a body', status: 200 },
      { url: 'https://example.com/bad', depth: 1, title: '', markdown: '', status: 0, error: 'fetch failed: boom' },
    ],
    totalChars: 14,
    truncated: false,
    ...overrides,
  }
}

describe('formatCrawlOutput', () => {
  it('renders the notice, summary, sitemap, and excerpts', () => {
    const text = formatCrawlOutput(result(), 20_000)
    expect(text).toContain('untrusted web content')
    expect(text).toContain('# Crawl of <https://example.com/>')
    expect(text).toContain('3 pages · 14 chars')
    expect(text).toContain('## Sitemap')
    expect(text).toContain('[Home](https://example.com/)')
    expect(text).toContain('[A](https://example.com/a)')
    expect(text).toContain('— error: fetch failed: boom')
    expect(text).toContain('## Home')
    expect(text).toContain('home body')
  })

  it('flags truncation when the page cap was reached', () => {
    const text = formatCrawlOutput(result({ truncated: true }), 20_000)
    expect(text).toContain('page cap reached')
  })

  it('omits excerpts when the output budget is exhausted', () => {
    const big = result({
      pages: Array.from({ length: 40 }, (_, i) => ({
        url: `https://example.com/p${i}`,
        depth: 1,
        title: `P${i}`,
        markdown: 'x'.repeat(2_000),
        status: 200,
      })),
    })
    const text = formatCrawlOutput(big, 8_000)
    expect(text).toContain('output cap reached')
  })
})

describe('crawlMetaFromValue', () => {
  it('projects seed, page count, total chars, and truncation', () => {
    expect(crawlMetaFromValue(result())).toEqual({
      seed: 'https://example.com/',
      pages: 3,
      totalChars: 14,
      truncated: false,
    })
  })
})

describe('crawlMetaFromResult', () => {
  it('returns undefined for malformed metadata', () => {
    expect(crawlMetaFromResult(undefined)).toBeUndefined()
    expect(crawlMetaFromResult(null)).toBeUndefined()
    expect(crawlMetaFromResult('nope')).toBeUndefined()
    expect(crawlMetaFromResult({ seed: 's', pages: 1, totalChars: 1 })).toBeUndefined()
  })

  it('returns the validated meta for well-formed metadata', () => {
    expect(crawlMetaFromResult({ seed: 's', pages: 2, totalChars: 3, truncated: true })).toEqual({
      seed: 's',
      pages: 2,
      totalChars: 3,
      truncated: true,
    })
  })
})
