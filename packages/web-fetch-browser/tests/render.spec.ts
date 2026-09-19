import { describe, expect, it } from 'vitest'
import { extractTitle, htmlToMarkdown } from '../src/render.ts'

describe('htmlToMarkdown', () => {
  it('converts headings, lists, and links to markdown', () => {
    const html = '<html><body><h1>Title</h1><ul><li>one</li><li>two</li></ul><p>See <a href="https://example.com/x">the page</a>.</p></body></html>'
    const markdown = htmlToMarkdown(html)
    expect(markdown).toContain('# Title')
    expect(markdown).toContain('- one')
    expect(markdown).toContain('- two')
    expect(markdown).toContain('[the page](https://example.com/x)')
  })

  it('drops non-content elements and their text', () => {
    const html = '<html><body><script>var x = 1;</script><style>p{color:red}</style><nav>menu items</nav><main>content</main></body></html>'
    const markdown = htmlToMarkdown(html)
    expect(markdown).not.toContain('var x')
    expect(markdown).not.toContain('color:red')
    expect(markdown).not.toContain('menu items')
    expect(markdown).toContain('content')
  })

  it('drops hidden elements and inline-hidden content', () => {
    const html = '<html><body><div hidden>secret</div><span style="display:none">invisible</span><span>visible</span></body></html>'
    const markdown = htmlToMarkdown(html)
    expect(markdown).not.toContain('secret')
    expect(markdown).not.toContain('invisible')
    expect(markdown).toContain('visible')
  })

  it('renders fenced code blocks', () => {
    const html = '<html><body><pre><code>const a = 1</code></pre></body></html>'
    const markdown = htmlToMarkdown(html)
    expect(markdown).toContain('```\nconst a = 1\n```')
  })
})

describe('extractTitle', () => {
  it('extracts the first title element text', () => {
    expect(extractTitle('<html><head><title>  My Page </title></head></html>')).toBe('My Page')
  })

  it('returns empty string when no title is present', () => {
    expect(extractTitle('<html><head></head><body>no title</body></html>')).toBe('')
  })

  it('ignores later title-like elements', () => {
    expect(extractTitle('<html><head><title>first</title></head><body><title>second</title></body></html>')).toBe('first')
  })
})
