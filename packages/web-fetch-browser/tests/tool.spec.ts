import { describe, expect, it } from 'vitest'
import { formatRenderOutput, renderMetaFromResult, renderMetaFromValue } from '../src/tool.ts'
import type { WebRenderValue } from '../src/types.ts'

function value(markdown: string): WebRenderValue {
  return { url: 'https://example.com/page', statusCode: 200, title: 'Example', markdown, truncated: false }
}

describe('formatRenderOutput', () => {
  it('renders a header with title, URL, and status', () => {
    const text = formatRenderOutput(value('body text'), 10_000)
    expect(text).toContain('# Example')
    expect(text).toContain('<https://example.com/page> (HTTP 200)')
    expect(text).toContain('body text')
    expect(text).toContain('untrusted web content')
  })

  it('falls back to the URL when the title is empty', () => {
    const text = formatRenderOutput({ ...value('body'), title: '' }, 10_000)
    expect(text).toContain('# https://example.com/page')
  })

  it('truncates the body to the output cap', () => {
    const long = 'x'.repeat(5_000)
    const text = formatRenderOutput(value(long), 1_000)
    expect(text.length).toBeLessThanOrEqual(1_000 + 32)
    expect(text).toContain('…[truncated]')
  })
})

describe('renderMetaFromValue', () => {
  it('projects url, status, and effective truncation', () => {
    expect(renderMetaFromValue(value('short body'), 10_000)).toEqual({
      url: 'https://example.com/page',
      statusCode: 200,
      truncated: false,
    })
  })

  it('reports truncation when the body exceeds the cap', () => {
    const meta = renderMetaFromValue(value('x'.repeat(5_000)), 1_000)
    expect(meta.truncated).toBe(true)
  })
})

describe('renderMetaFromResult', () => {
  it('returns undefined for malformed metadata', () => {
    expect(renderMetaFromResult(undefined)).toBeUndefined()
    expect(renderMetaFromResult(null)).toBeUndefined()
    expect(renderMetaFromResult('nope')).toBeUndefined()
    expect(renderMetaFromResult({ url: 1, statusCode: 200, truncated: false })).toBeUndefined()
    expect(renderMetaFromResult({ url: 'x', statusCode: 200 })).toBeUndefined()
  })

  it('returns the validated meta for well-formed metadata', () => {
    expect(renderMetaFromResult({ url: 'u', statusCode: 200, truncated: true })).toEqual({
      url: 'u',
      statusCode: 200,
      truncated: true,
    })
  })
})
