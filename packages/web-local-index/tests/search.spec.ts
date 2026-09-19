import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { disableModelForTests } from '../src/model.ts'
import { closeIndexStore, configureIndexStore, indexPage } from '../src/store.ts'
import { ftsMatchQuery, rrf, searchLocal } from '../src/search.ts'

let dir: string

beforeEach(() => {
  disableModelForTests()
  dir = mkdtempSync(join(tmpdir(), 'web-index-search-'))
  configureIndexStore({ dbPath: join(dir, 'search.db') })
})

afterEach(async () => {
  await closeIndexStore()
})

describe('ftsMatchQuery', () => {
  it('quotes each term and OR-joins them', () => {
    expect(ftsMatchQuery('machine learning')).toBe('"machine" OR "learning"')
  })

  it('doubles internal quotes', () => {
    expect(ftsMatchQuery('a"b')).toBe('"a""b"')
  })

  it('drops blank terms', () => {
    expect(ftsMatchQuery('  alpha   beta ')).toBe('"alpha" OR "beta"')
  })

  it('returns undefined for blank queries', () => {
    expect(ftsMatchQuery('   ')).toBeUndefined()
    expect(ftsMatchQuery('')).toBeUndefined()
  })
})

describe('rrf', () => {
  it('fuses rankings with k=60', () => {
    const scores = rrf([['a', 'b'], ['b', 'c']])
    expect(scores.get('a')).toBeCloseTo(1 / 61)
    expect(scores.get('b')).toBeCloseTo(1 / 62 + 1 / 61)
    expect(scores.get('c')).toBeCloseTo(1 / 62)
  })

  it('returns an empty map for no rankings', () => {
    expect([...rrf([]).entries()]).toEqual([])
  })
})

describe('searchLocal (lexical, model disabled)', () => {
  it('finds pages by content terms with snippets', async () => {
    await indexPage({
      url: 'https://example.com/rust',
      title: 'Rust safety',
      markdown: 'Rust guarantees memory safety without a garbage collector.',
      fetchedAt: new Date().toISOString(),
    })
    await indexPage({
      url: 'https://example.com/python',
      title: 'Python typing',
      markdown: 'Python uses optional type hints.',
      fetchedAt: new Date().toISOString(),
    })
    const result = await searchLocal({ queries: ['memory safety'], maxResults: 5, mode: 'lexical' })
    expect(result.modelReady).toBe(false)
    expect(result.hits.length).toBe(1)
    expect(result.hits[0]?.url).toBe('https://example.com/rust')
    expect(result.hits[0]?.domain).toBe('example.com')
    expect(result.hits[0]?.snippet).toContain('memory safety')
  })

  it('returns no hits for an empty corpus', async () => {
    const result = await searchLocal({ queries: ['anything'], maxResults: 5, mode: 'lexical' })
    expect(result.hits).toEqual([])
  })

  it('honors the maxResults cap', async () => {
    for (let i = 0; i < 5; i++) {
      await indexPage({
        url: `https://example.com/page-${i}`,
        title: `Page ${i}`,
        markdown: `unique term needle-${i} in the haystack`,
        fetchedAt: new Date().toISOString(),
      })
    }
    const result = await searchLocal({ queries: ['needle'], maxResults: 2, mode: 'lexical' })
    expect(result.hits.length).toBeLessThanOrEqual(2)
  })
})
