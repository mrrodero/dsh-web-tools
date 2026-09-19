/**
 * SSRF-safe URL validation for browser navigation. Mirrors the local HTTP
 * provider's defense in spirit: http/https only, no credentials, and
 * public addresses only. The DNS check is a pre-navigation gate —
 * Playwright re-resolves at navigation time, so this is a deliberate
 * wave-1 simplification of the http provider's per-request address
 * pinning (TOCTOU hardening is a follow-up).
 * @module @deepseek-ai/dsh-web-fetch-browser/policy
 */

import dns from 'node:dns/promises'
import { WebError } from '@deepseek-ai/dsh-web'

/** Maximum accepted URL length. */
export const MAX_URL_LENGTH = 2048

/**
 * Validate a URL for browser navigation.
 *
 * @param url - the URL to navigate to.
 * @throws {@link WebError} with code `WEB_INVALID_URL` for malformed or
 *   non-http(s) URLs, or `WEB_URL_BLOCKED` for credentials, unresolvable
 *   hosts, or private/loopback/link-local targets.
 */
export async function validateBrowserUrl(url: string): Promise<void> {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) {
    throw new WebError('URL must be a non-empty string of at most 2048 characters', 'WEB_INVALID_URL')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new WebError(`invalid URL: ${url}`, 'WEB_INVALID_URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebError(`unsupported protocol ${parsed.protocol} (http/https only)`, 'WEB_INVALID_URL')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new WebError('URL must not carry credentials', 'WEB_URL_BLOCKED')
  }
  const host = parsed.hostname
  if (host === '') throw new WebError('URL has no host', 'WEB_INVALID_URL')

  // Literal IP hosts are checked directly; name hosts are resolved first.
  // `URL.hostname` keeps the brackets around IPv6 literals; strip them so
  // the range checks see the bare address.
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const addresses = isIpLiteral(bareHost) ? [bareHost] : await resolveHost(host)
  for (const address of addresses) {
    if (!isPublicAddress(address)) {
      throw new WebError(`host ${host} resolves to a non-public address (${address})`, 'WEB_URL_BLOCKED')
    }
  }
}

/** Whether `host` is an IPv4 or IPv6 literal (not a name to resolve). */
function isIpLiteral(host: string): boolean {
  return host.includes(':') || IPv4_LITERAL.test(host)
}

const IPv4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/

/** Resolve a name host to all of its addresses; failure blocks the URL. */
async function resolveHost(host: string): Promise<string[]> {
  try {
    const records = await dns.lookup(host, { all: true })
    return records.map(record => record.address)
  } catch {
    throw new WebError(`could not resolve host ${host}`, 'WEB_URL_BLOCKED')
  }
}

/** Whether an IPv4/IPv6 literal is a public, routable address. */
export function isPublicAddress(address: string): boolean {
  return address.includes(':') ? isPublicIpv6(address) : isPublicIpv4(address)
}

/** Whether an IPv4 literal is outside every private/reserved range. */
function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const a = parts[0] ?? 0
  const b = parts[1] ?? 0
  if (a === 0) return false // 0.0.0.0/8 "this network"
  if (a === 10) return false // 10.0.0.0/8
  if (a === 127) return false // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return false // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return false // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return false // 172.16.0.0/12
  if (a === 192 && b === 168) return false // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return false // 198.18.0.0/15 benchmarking
  if (a >= 224) return false // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return true
}

/** Whether an IPv6 literal is outside every private/reserved range. */
function isPublicIpv6(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === '::' || lower === '::1') return false // unspecified, loopback
  if (lower.startsWith('fc') || lower.startsWith('fd')) return false // ULA fc00::/7
  if (lower.startsWith('fe80')) return false // link-local
  if (lower.startsWith('ff')) return false // multicast
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped: defer to the IPv4 rules.
    return isPublicIpv4(lower.slice('::ffff:'.length))
  }
  return true
}
