import { describe, expect, it } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { isPublicAddress, validateBrowserUrl, MAX_URL_LENGTH } from '../../src/web-fetch-browser/policy.ts'

describe('isPublicAddress', () => {
  it('accepts public IPv4 addresses', () => {
    expect(isPublicAddress('93.184.216.34')).toBe(true)
    expect(isPublicAddress('1.1.1.1')).toBe(true)
    expect(isPublicAddress('8.8.8.8')).toBe(true)
  })

  it('rejects private, loopback, link-local, CGNAT, and reserved IPv4 ranges', () => {
    expect(isPublicAddress('127.0.0.1')).toBe(false)
    expect(isPublicAddress('10.0.0.1')).toBe(false)
    expect(isPublicAddress('192.168.1.10')).toBe(false)
    expect(isPublicAddress('172.16.0.1')).toBe(false)
    expect(isPublicAddress('172.31.255.255')).toBe(false)
    expect(isPublicAddress('169.254.1.1')).toBe(false)
    expect(isPublicAddress('100.64.0.1')).toBe(false)
    expect(isPublicAddress('100.127.255.255')).toBe(false)
    expect(isPublicAddress('198.18.0.1')).toBe(false)
    expect(isPublicAddress('224.0.0.1')).toBe(false)
    expect(isPublicAddress('255.255.255.255')).toBe(false)
    expect(isPublicAddress('0.0.0.0')).toBe(false)
  })

  it('rejects malformed IPv4 literals', () => {
    expect(isPublicAddress('999.1.1.1')).toBe(false)
    expect(isPublicAddress('1.2.3')).toBe(false)
    expect(isPublicAddress('not-an-ip')).toBe(false)
  })

  it('accepts public IPv6 addresses', () => {
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true)
  })

  it('rejects private, loopback, link-local, and multicast IPv6 ranges', () => {
    expect(isPublicAddress('::1')).toBe(false)
    expect(isPublicAddress('::')).toBe(false)
    expect(isPublicAddress('fd00::1')).toBe(false)
    expect(isPublicAddress('fc00::1')).toBe(false)
    expect(isPublicAddress('fe80::1')).toBe(false)
    expect(isPublicAddress('ff02::1')).toBe(false)
  })

  it('defers IPv4-mapped IPv6 addresses to the IPv4 rules', () => {
    expect(isPublicAddress('::ffff:93.184.216.34')).toBe(true)
    expect(isPublicAddress('::ffff:192.168.1.10')).toBe(false)
  })
})

describe('validateBrowserUrl', () => {
  it('rejects non-http(s) protocols', async () => {
    for (const url of ['ftp://example.com/file', 'file:///etc/passwd', 'javascript:alert(1)']) {
      await expect(validateBrowserUrl(url)).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    }
  })

  it('rejects malformed URLs', async () => {
    await expect(validateBrowserUrl('not a url')).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    await expect(validateBrowserUrl('')).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    await expect(validateBrowserUrl('http://')).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
  })

  it('rejects overlong URLs', async () => {
    const url = `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`
    await expect(validateBrowserUrl(url)).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
  })

  it('rejects URLs carrying credentials', async () => {
    await expect(validateBrowserUrl('https://user:pass@example.com/')).rejects.toMatchObject({ code: 'WEB_URL_BLOCKED' })
    await expect(validateBrowserUrl('https://user@example.com/')).rejects.toMatchObject({ code: 'WEB_URL_BLOCKED' })
  })

  it('rejects private and loopback literal-IP hosts', async () => {
    for (const url of ['http://127.0.0.1:8888/', 'http://192.168.1.10:8080/', 'http://[::1]/', 'http://10.0.0.1/']) {
      await expect(validateBrowserUrl(url)).rejects.toMatchObject({ code: 'WEB_URL_BLOCKED' })
    }
  })

  it('rejects unresolvable hosts', async () => {
    await expect(validateBrowserUrl('https://definitely-not-a-real-host.invalid/')).rejects.toMatchObject({ code: 'WEB_URL_BLOCKED' })
  })

  it('accepts well-formed public http(s) URLs', async () => {
    // Resolution of example.com depends on DNS; assert the error type is not
    // thrown for the shape itself by using a literal public IP instead.
    await expect(validateBrowserUrl('https://93.184.216.34/')).resolves.toBeUndefined()
  })

  it('throws WebError instances', async () => {
    try {
      await validateBrowserUrl('ftp://example.com/x')
      throw new Error('unreachable')
    } catch (error) {
      expect(error).toBeInstanceOf(WebError)
    }
  })
})
