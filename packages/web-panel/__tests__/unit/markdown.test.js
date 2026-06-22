/**
 * Unit tests for src/utils/markdown.js
 *
 * renderMarkdown turns model/user markdown into HTML and sanitizes it with
 * DOMPurify — the XSS boundary for everything rendered in the panel. These
 * tests pin both the basic rendering and (most importantly) that script tags,
 * inline event handlers and javascript: URLs are stripped.
 *
 * Run: npx vitest run __tests__/unit/markdown.test.js
 */

import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/utils/markdown.js'

describe('renderMarkdown — rendering', () => {
  it('renders emphasis and strong', () => {
    const html = renderMarkdown('**bold** and *em*')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>em</em>')
  })

  it('renders headings', () => {
    expect(renderMarkdown('# Title')).toContain('<h1')
  })

  it('renders a safe link', () => {
    const html = renderMarkdown('[docs](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('docs')
  })

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown()).toBe('')
  })

  it('passes plain text through', () => {
    expect(renderMarkdown('just text')).toContain('just text')
  })
})

describe('renderMarkdown — XSS sanitization', () => {
  it('strips <script> tags and their payload', () => {
    const html = renderMarkdown('hi <script>alert(1)</script> there')
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('strips inline event handlers', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">')
    expect(html.toLowerCase()).not.toContain('onerror')
  })

  it('removes javascript: URLs from links', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html.toLowerCase()).not.toContain('javascript:alert')
  })

  it('drops a raw inline <script> embedded in HTML', () => {
    const html = renderMarkdown('<div><script>steal()</script></div>')
    expect(html.toLowerCase()).not.toContain('steal()')
  })
})
