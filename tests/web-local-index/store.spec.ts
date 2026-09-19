import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chunkText,
  closeIndexStore,
  configureIndexStore,
  indexPage,
  indexStats,
  pruneIndex,
} from '../../src/web-local-index/store.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'web-index-test-'))
  configureIndexStore({ dbPath: join(dir, 'test.db') })
})

afterEach(async () => {
  await closeIndexStore()
})

describe('chunkText', () => {
  it('splits on blank lines and keeps chunks under the target size', () => {
    const text = ['alpha paragraph', 'beta paragraph', 'gamma paragraph'].join('\n\n')
    const chunks = chunkText(text, 40)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(80)
  })

  it('hard-splits oversized paragraphs', () => {
    const text = 'x'.repeat(3_000)
    const chunks = chunkText(text, 800)
    expect(chunks.length).toBeGreaterThanOrEqual(3)
  })

  it('returns no chunks for empty text', () => {
    expect(chunkText('')).toEqual([])
  })
})

describe('indexPage + indexStats', () => {
  it('stores pages and chunks them', async () => {
    await indexPage({
      url: 'https://example.com/a',
      title: 'A',
      markdown: 'first paragraph\n\nsecond paragraph',
      fetchedAt: new Date().toISOString(),
    })
    const stats = await indexStats()
    expect(stats.pages).toBe(1)
    expect(stats.chunks).toBe(2)
    expect(stats.dbPath).toBe(join(dir, 'test.db'))
  })

  it('replaces a page on re-index (latest wins)', async () => {
    await indexPage({ url: 'https://example.com/a', title: 'A1', markdown: 'one', fetchedAt: '2026-01-01T00:00:00Z' })
    await indexPage({ url: 'https://example.com/a', title: 'A2', markdown: 'two\n\nthree', fetchedAt: '2026-02-01T00:00:00Z' })
    const stats = await indexStats()
    expect(stats.pages).toBe(1)
    expect(stats.chunks).toBe(2)
  })
})

describe('pruneIndex', () => {
  it('removes pages older than the cutoff', async () => {
    await indexPage({ url: 'https://example.com/old', title: 'Old', markdown: 'old', fetchedAt: '2020-01-01T00:00:00Z' })
    await indexPage({ url: 'https://example.com/new', title: 'New', markdown: 'new', fetchedAt: new Date().toISOString() })
    const result = await pruneIndex({ olderThanDays: 30 })
    expect(result.removedPages).toBe(1)
    const stats = await indexStats()
    expect(stats.pages).toBe(1)
  })

  it('removes pages by domain', async () => {
    await indexPage({ url: 'https://example.com/a', title: 'A', markdown: 'a', fetchedAt: new Date().toISOString() })
    await indexPage({ url: 'https://other.org/b', title: 'B', markdown: 'b', fetchedAt: new Date().toISOString() })
    const result = await pruneIndex({ domains: ['other.org'] })
    expect(result.removedPages).toBe(1)
    const stats = await indexStats()
    expect(stats.pages).toBe(1)
  })

  it('removes nothing without criteria', async () => {
    await indexPage({ url: 'https://example.com/a', title: 'A', markdown: 'a', fetchedAt: new Date().toISOString() })
    const result = await pruneIndex({})
    expect(result.removedPages).toBe(0)
  })
})
