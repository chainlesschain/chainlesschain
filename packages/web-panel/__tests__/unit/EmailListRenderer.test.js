/**
 * EmailListRenderer (pdh) — unit tests for its pure display computeds:
 * from/subject/snippet fallbacks, attachment counting, category, the unread
 * icon flag, and local time formatting.
 */

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@ant-design/icons-vue', () => ({
  MailOutlined: { template: '<i class="mail" />' },
}))

import EmailListRenderer from '../../src/components/pdh/renderers/EmailListRenderer.vue'

const stubs = {
  'a-tag': { props: ['color'], template: '<span class="atag"><slot /></span>' },
}

function render(event) {
  return mount(EmailListRenderer, {
    props: {
      event: { source: { adapter: 'email-gmail' }, content: {}, extra: {}, actor: 'a', ...event },
    },
    global: { stubs },
  })
}

describe('EmailListRenderer — text fallbacks', () => {
  it('from prefers from/sender/fromName/actor, else (未知发件人)', () => {
    expect(render({ content: { from: 'F' } }).find('.from').text()).toBe('F')
    expect(render({ content: { fromName: 'FN' } }).find('.from').text()).toBe('FN')
    expect(render({ actor: 'bob', content: {} }).find('.from').text()).toBe('bob')
    expect(render({ actor: '', content: {} }).find('.from').text()).toBe('(未知发件人)')
  })

  it('subject falls back to title then (无主题)', () => {
    expect(render({ content: { title: 'T' } }).find('.subject').text()).toBe('T')
    expect(render({ content: {} }).find('.subject').text()).toBe('(无主题)')
  })

  it('snippet uses snippet/preview/body-slice, hidden when absent', () => {
    expect(render({ content: { preview: 'pv' } }).find('.snippet').text()).toBe('pv')
    expect(render({ content: { body: 'x'.repeat(150) } }).find('.snippet').text()).toHaveLength(100)
    expect(render({ content: {} }).find('.snippet').exists()).toBe(false)
  })
})

describe('EmailListRenderer — attachments + category', () => {
  it('counts an attachments array or numeric attachmentCount', () => {
    expect(render({ content: { attachments: [1, 2, 3] } }).text()).toContain('📎 3')
    expect(render({ content: { attachmentCount: 2 } }).text()).toContain('📎 2')
  })

  it('hides the attachment tag when there are none', () => {
    expect(render({ content: {} }).text()).not.toContain('📎')
  })

  it('shows category from extra or content', () => {
    expect(render({ extra: { category: '工作' } }).text()).toContain('工作')
    expect(render({ content: { category: '账单' } }).text()).toContain('账单')
  })
})

describe('EmailListRenderer — unread + time', () => {
  it('flags the icon unread only when content.unread === true', () => {
    expect(render({ content: { unread: true } }).find('.icon').classes()).toContain('unread')
    expect(render({ content: { unread: false } }).find('.icon').classes()).not.toContain('unread')
  })

  it('formats occurredAt', () => {
    expect(render({ occurredAt: '2026-06-16T08:30:00' }).find('.time').text()).toBe('2026-06-16 08:30')
  })
})
