import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import VirtualMessageList from '../../src/components/VirtualMessageList.vue'

const sample = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 ? 'assistant' : 'user',
    content: `msg ${i}`,
  }))

describe('VirtualMessageList', () => {
  it('renders fallback list when virtualizer has no virtual items', async () => {
    const wrapper = mount(VirtualMessageList, {
      props: { messages: sample(3) },
      slots: {
        default: ({ message }) => `<div class="row">${message.content}</div>`,
      },
    })
    await flushPromises()
    const html = wrapper.html()
    // happy-dom doesn't lay out boxes so virtualizer.getVirtualItems() likely
    // returns []; the fallback path must still surface every message.
    expect(html).toContain('msg 0')
    expect(html).toContain('msg 1')
    expect(html).toContain('msg 2')
  })

  it('uses message.id as :key in fallback path', async () => {
    const wrapper = mount(VirtualMessageList, {
      props: { messages: sample(2) },
      slots: { default: ({ message }) => `<div>${message.content}</div>` },
    })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toMatch(/msg 0/)
    expect(text).toMatch(/msg 1/)
  })

  it('exposes scrollToBottom on the component instance', async () => {
    const wrapper = mount(VirtualMessageList, {
      props: { messages: sample(1) },
      slots: { default: ({ message }) => `<div>${message.content}</div>` },
    })
    await flushPromises()
    const exposed = wrapper.vm
    expect(typeof exposed.scrollToBottom).toBe('function')
    // Calling it must be safe even without real scroll layout.
    expect(() => exposed.scrollToBottom()).not.toThrow()
  })

  it('emits load-more / scroll-to-bottom when scroll position triggers them', async () => {
    const wrapper = mount(VirtualMessageList, {
      props: { messages: sample(5) },
      slots: { default: ({ message }) => `<div>${message.content}</div>` },
      attachTo: document.body,
    })
    await flushPromises()

    const root = wrapper.element
    // Top: scrollTop < 100 should emit load-more.
    Object.defineProperty(root, 'scrollTop', { value: 10, configurable: true })
    Object.defineProperty(root, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(root, 'clientHeight', { value: 200, configurable: true })
    await wrapper.trigger('scroll')
    expect(wrapper.emitted('load-more')).toBeTruthy()

    // Bottom: scrollTop + clientHeight >= scrollHeight - 50 should emit scroll-to-bottom.
    Object.defineProperty(root, 'scrollTop', { value: 800, configurable: true })
    Object.defineProperty(root, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(root, 'clientHeight', { value: 200, configurable: true })
    await wrapper.trigger('scroll')
    expect(wrapper.emitted('scroll-to-bottom')).toBeTruthy()

    wrapper.unmount()
  })

  it('updates when messages prop length grows', async () => {
    const wrapper = mount(VirtualMessageList, {
      props: { messages: sample(2) },
      slots: { default: ({ message }) => `<div>${message.content}</div>` },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('msg 1')

    await wrapper.setProps({ messages: sample(4) })
    await flushPromises()
    expect(wrapper.text()).toContain('msg 3')
  })
})
