import { describe, expect, it } from 'vitest'
import { EMPTY_POLICY, parseRobots, robotsAllowed } from '../src/robots.ts'

const UA = 'deepseek-harness/0.0.1'

describe('parseRobots', () => {
  it('parses user-agent groups with allow/disallow rules', () => {
    const policy = parseRobots([
      '# comment',
      'User-agent: *',
      'Disallow: /private',
      'Allow: /private/public',
      '',
      'User-agent: Googlebot',
      'Disallow: /secret',
    ].join('\n'))
    expect(policy.groups).toHaveLength(2)
    expect(policy.groups[0]?.userAgents).toEqual(['*'])
    expect(policy.groups[0]?.disallow).toEqual(['/private'])
    expect(policy.groups[0]?.allow).toEqual(['/private/public'])
    expect(policy.groups[1]?.userAgents).toEqual(['Googlebot'])
    expect(policy.groups[1]?.disallow).toEqual(['/secret'])
  })

  it('ignores lines without a colon and orphan rules', () => {
    const policy = parseRobots('Disallow: /orphan\nUser-agent: *\nDisallow: /x')
    expect(policy.groups).toHaveLength(1)
    expect(policy.groups[0]?.disallow).toEqual(['/x'])
  })
})

describe('robotsAllowed', () => {
  it('allows everything under the empty policy', () => {
    expect(robotsAllowed('https://example.com/anything', EMPTY_POLICY, UA)).toBe(true)
  })

  it('applies wildcard user-agent groups to any crawler', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /private')
    expect(robotsAllowed('https://example.com/private/x', policy, UA)).toBe(false)
    expect(robotsAllowed('https://example.com/public/x', policy, UA)).toBe(true)
  })

  it('does not apply other crawlers\' groups', () => {
    const policy = parseRobots('User-agent: Googlebot\nDisallow: /secret')
    expect(robotsAllowed('https://example.com/secret', policy, UA)).toBe(true)
  })

  it('prefers allow over disallow of equal length', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private')
    expect(robotsAllowed('https://example.com/private', policy, UA)).toBe(true)
  })

  it('prefers the longest matching pattern', () => {
    const policy = parseRobots('User-agent: *\nAllow: /private\nDisallow: /private/deep')
    expect(robotsAllowed('https://example.com/private/shallow', policy, UA)).toBe(true)
    expect(robotsAllowed('https://example.com/private/deep/x', policy, UA)).toBe(false)
  })

  it('supports * wildcards and the $ end anchor', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /images/*.jpg\nDisallow: /exact$')
    expect(robotsAllowed('https://example.com/images/a.jpg', policy, UA)).toBe(false)
    expect(robotsAllowed('https://example.com/images/a.png', policy, UA)).toBe(true)
    expect(robotsAllowed('https://example.com/exact', policy, UA)).toBe(false)
    expect(robotsAllowed('https://example.com/exact/other', policy, UA)).toBe(true)
  })

  it('matches path plus query string', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /search?q=')
    expect(robotsAllowed('https://example.com/search?q=x', policy, UA)).toBe(false)
    expect(robotsAllowed('https://example.com/search', policy, UA)).toBe(true)
  })
})
