import { describe, expect, it } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { BrowserFetchProvider } from '../src/provider.ts'

/** Options with a nonexistent executable so no browser is ever launched. */
function unavailableProvider() {
  return new BrowserFetchProvider({
    executablePath: 'C:/definitely/not/a/chromium.exe',
    timeoutMs: 5_000,
    maxBodyChars: 1_000,
    userAgent: 'test',
  })
}

describe('BrowserFetchProvider', () => {
  it('exposes the stable provider id', () => {
    expect(unavailableProvider().id).toBe('browser')
  })

  it('reports unavailable when the executable does not exist', () => {
    expect(unavailableProvider().available()).toBe(false)
  })

  it('reports the configured executable path', () => {
    expect(unavailableProvider().executablePath()).toBe('C:/definitely/not/a/chromium.exe')
  })

  it('withBrowser fails with WEB_PROVIDER_UNAVAILABLE when no browser is installed', async () => {
    const provider = unavailableProvider()
    await expect(provider.withBrowser(async () => 'unreachable')).rejects.toMatchObject({
      code: 'WEB_PROVIDER_UNAVAILABLE',
    })
  })

  it('fetch validates the URL before launching a browser', async () => {
    const provider = unavailableProvider()
    await expect(provider.fetch({ url: 'ftp://example.com/x' })).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    await expect(provider.fetch({ url: 'http://127.0.0.1/' })).rejects.toMatchObject({ code: 'WEB_URL_BLOCKED' })
  })

  it('maps unavailable-browser errors to WebError', async () => {
    const provider = unavailableProvider()
    try {
      await provider.fetch({ url: 'https://93.184.216.34/' })
      throw new Error('unreachable')
    } catch (error) {
      expect(error).toBeInstanceOf(WebError)
      expect((error as WebError).code).toBe('WEB_PROVIDER_UNAVAILABLE')
    }
  })
})
