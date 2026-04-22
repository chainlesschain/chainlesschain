import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MarkdownRenderer from '../../src/components/MarkdownRenderer.vue'

describe('MarkdownRenderer', () => {
  it('renders markdown as sanitized HTML', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '# Title\n\n**bold**',
      },
    })

    expect(wrapper.html()).toContain('<h1>Title</h1>')
    expect(wrapper.html()).toContain('<strong>bold</strong>')
  })

  it('strips dangerous HTML and event handlers', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content:
          '<img src="x" onerror="window.__xss=1"><script>window.__script=1</script><p>safe</p>',
      },
    })

    const html = wrapper.html()
    expect(html).toContain('<img src="x">')
    expect(html).not.toContain('onerror=')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<p>safe</p>')
  })
})
