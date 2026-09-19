import { describe, expect, it } from 'vitest'
import { extractPage } from '../src/extract.ts'

describe('extractPage', () => {
  it('extracts the title and main content as markdown', () => {
    const html = '<html><head><title>  Test Page </title></head><body><nav>menu</nav><main><h1>Heading</h1><p>Body text.</p></main><footer>footer</footer></body></html>'
    const page = extractPage(html, 'https://example.com/x', 10_000)
    expect(page.title).toBe('Test Page')
    expect(page.markdown).toContain('# Heading')
    expect(page.markdown).toContain('Body text.')
    expect(page.markdown).not.toContain('menu')
    expect(page.markdown).not.toContain('footer')
    expect(page.truncated).toBe(false)
  })

  it('falls back to the body when no content selector matches', () => {
    const html = '<html><head><title>T</title></head><body><div>plain content</div></body></html>'
    const page = extractPage(html, 'https://example.com/x', 10_000)
    expect(page.markdown).toContain('plain content')
  })

  it('resolves relative links against the page URL', () => {
    const html = '<html><body><a href="/a">a</a><a href="https://other.org/b">b</a><a href="mailto:x@y.z">mail</a></body></html>'
    const page = extractPage(html, 'https://example.com/dir/', 10_000)
    expect(page.links).toContain('https://example.com/a')
    expect(page.links).toContain('https://other.org/b')
    expect(page.links).toContain('mailto:x@y.z')
  })

  it('cuts the markdown to the page cap', () => {
    const html = `<html><head><title>T</title></head><body><main>${'word '.repeat(5_000)}</main></body></html>`
    const page = extractPage(html, 'https://example.com/x', 1_000)
    expect(page.truncated).toBe(true)
    expect(page.markdown.length).toBeLessThanOrEqual(1_000)
  })

  it('skips unresolvable hrefs', () => {
    const html = '<html><body><a href="not a url">x</a><a href="/ok">ok</a></body></html>'
    const page = extractPage(html, 'https://example.com/', 10_000)
    expect(page.links).toEqual(['https://example.com/ok'])
  })
})
