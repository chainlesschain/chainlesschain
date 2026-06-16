/**
 * ChatBubbleRenderer (pdh) — unit tests for its pure display computeds:
 * message/actor fallbacks, the "is mine" alignment heuristic, adapter color,
 * and local time formatting.
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatBubbleRenderer from '../../src/components/pdh/renderers/ChatBubbleRenderer.vue'

const stubs = {
  'a-tag': {
    props: ['color'],
    template: '<span class="atag" :data-color="color"><slot /></span>',
  },
}

function render(event) {
  return mount(ChatBubbleRenderer, {
    props: {
      event: { source: { adapter: 'wechat' }, content: {}, actor: 'alice', ...event },
    },
    global: { stubs },
  })
}

describe('ChatBubbleRenderer — message text', () => {
  it('prefers text, then body/message/title', () => {
    expect(render({ content: { text: 'hi', body: 'b' } }).find('.body').text()).toBe('hi')
    expect(render({ content: { message: 'm' } }).find('.body').text()).toBe('m')
    expect(render({ content: { title: 't' } }).find('.body').text()).toBe('t')
  })

  it('falls back to a JSON preview for unknown content', () => {
    expect(render({ content: { foo: 'bar' } }).find('.body').text()).toBe('{"foo":"bar"}')
  })
})

describe('ChatBubbleRenderer — actor', () => {
  it('prefers content.from, then sender/senderName/actor, else (unknown)', () => {
    expect(render({ content: { from: 'F' } }).find('.actor').text()).toBe('F')
    expect(render({ content: { senderName: 'SN' } }).find('.actor').text()).toBe('SN')
    expect(render({ actor: 'bob', content: {} }).find('.actor').text()).toBe('bob')
    expect(render({ actor: '', content: {} }).find('.actor').text()).toBe('(unknown)')
  })
})

describe('ChatBubbleRenderer — isMine alignment', () => {
  it('right-aligns self-ish actors', () => {
    expect(render({ actor: 'wxid_self' }).find('.chat-row').classes()).toContain('mine')
    expect(render({ actor: 'me' }).find('.chat-row').classes()).toContain('mine')
    expect(render({ actor: 'SELF-device' }).find('.chat-row').classes()).toContain('mine')
  })

  it('does not align others', () => {
    expect(render({ actor: 'alice' }).find('.chat-row').classes()).not.toContain('mine')
  })
})

describe('ChatBubbleRenderer — adapter color', () => {
  it('maps adapter to a tag color', () => {
    expect(render({ source: { adapter: 'messaging-qq-9.0' } }).find('.atag').attributes('data-color')).toBe('magenta')
    expect(render({ source: { adapter: 'wechat' } }).find('.atag').attributes('data-color')).toBe('green')
    expect(render({ source: { adapter: 'social-x' } }).find('.atag').attributes('data-color')).toBe('blue')
  })
})

describe('ChatBubbleRenderer — time', () => {
  it('formats occurredAt and is blank when missing', () => {
    expect(render({ occurredAt: '2026-06-16T08:30:00' }).find('.time').text()).toBe('2026-06-16 08:30')
    expect(render({}).find('.time').text()).toBe('')
  })
})
