import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { disableModelForTests } from '../../src/web-local-index/model.ts'
import { IndexedFetchProvider, INDEXED_FETCH_PROVIDER_ID } from '../../src/web-local-index/provider.ts'
import { closeIndexStore, configureIndexStore, indexStats } from '../../src/web-local-index/store.ts'

let dir: string

beforeEach(() => {
  disableModelForTests()
  dir = mkdtempSync(join(tmpdir(), 'web-index-provider-'))
  configureIndexStore({ dbPath: join(dir, 'provider.db') })
})

afterEach(async () => {
  await closeIndexStore()
})

/** A fake inner provider returning canned results. */
function fakeInner(result: WebFetchResult, available = true): WebFetchProvider {
  return {
    id: 'fake',
    available: () => available,
    fetch: async (_request: WebFetchRequest) => result,
  }
}

describe('IndexedFetchProvider', () => {
  it('has the stable indexed id and delegates availability', () => {
    const provider = new IndexedFetchProvider(fakeInner(
      { url: 'https://example.com/x', statusCode: 200, body: { kind: 'text', content: '' }, truncated: false },
      false,
    ))
    expect(provider.id).toBe(INDEXED_FETCH_PROVIDER_ID)
    expect(provider.available()).toBe(false)
  })

  it('returns the inner result and indexes it as a side effect', async () => {
    const result: WebFetchResult = {
      url: 'https://example.com/page',
      statusCode: 200,
      body: { kind: 'html', content: '<html><head><title>Example</title></head><body><p>hello body</p></body></html>' },
      truncated: false,
    }
    const provider = new IndexedFetchProvider(fakeInner(result))
    const returned = await provider.fetch({ url: result.url })
    expect(returned).toBe(result)
    // Allow the fire-and-forget indexing to settle.
    await new Promise(resolve => setTimeout(resolve, 50))
    const stats = await indexStats()
    expect(stats.pages).toBe(1)
  })

  it('never fails the fetch when indexing throws', async () => {
    const result: WebFetchResult = {
      url: 'https://example.com/page',
      statusCode: 200,
      body: { kind: 'text', content: 'plain text' },
      truncated: false,
    }
    const provider = new IndexedFetchProvider(fakeInner(result))
    const returned = await provider.fetch({ url: result.url })
    expect(returned).toBe(result)
  })
})
