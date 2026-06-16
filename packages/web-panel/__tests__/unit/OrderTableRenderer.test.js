/**
 * OrderTableRenderer (pdh) — unit tests for its pure display computeds:
 * merchant/item/amount fallbacks, currency formatting, order-no + status
 * visibility, and status color mapping.
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import OrderTableRenderer from '../../src/components/pdh/renderers/OrderTableRenderer.vue'

const stubs = {
  'a-tag': {
    props: ['color'],
    template: '<span class="atag" :data-color="color"><slot /></span>',
  },
}

function render(event) {
  return mount(OrderTableRenderer, {
    props: {
      event: { source: { adapter: 'shopping-taobao' }, subtype: 'order', content: {}, extra: {}, ...event },
    },
    global: { stubs },
  })
}

function statusTag(w) {
  // the status tag is the one whose color is data-driven (not the fixed gold)
  return w.findAll('.atag').find((t) => t.attributes('data-color') && t.attributes('data-color') !== 'gold')
}

describe('OrderTableRenderer — text fallbacks', () => {
  it('merchant prefers extra.merchant, then content.merchant/counterparty', () => {
    expect(render({ extra: { merchant: 'M1' }, content: { merchant: 'M2' } }).text()).toContain('M1')
    expect(render({ content: { counterparty: 'CP' } }).text()).toContain('CP')
    expect(render({}).text()).toContain('—')
  })

  it('item prefers title, then name/itemName/text', () => {
    expect(render({ content: { title: 'T', name: 'N' } }).text()).toContain('T')
    expect(render({ content: { itemName: 'IN' } }).text()).toContain('IN')
  })
})

describe('OrderTableRenderer — amount', () => {
  it('formats a numeric amount to 2 decimals with the default currency', () => {
    expect(render({ content: { amount: 12.5 } }).text()).toContain('¥ 12.50')
  })

  it('honours an explicit currency and falls back price→total', () => {
    expect(render({ content: { price: 9, currency: '$' } }).text()).toContain('$ 9.00')
    expect(render({ content: { total: '面议' } }).text()).toContain('面议')
  })

  it('shows — when there is no amount', () => {
    expect(render({ content: {} }).text()).toContain('—')
  })
})

describe('OrderTableRenderer — order no + status', () => {
  it('hides the order-no row when absent and shows it when present', () => {
    expect(render({ content: {} }).text()).not.toContain('单号')
    expect(render({ extra: { orderNo: 'ON-1' } }).text()).toContain('ON-1')
  })

  it('maps status text to a color', () => {
    expect(statusTag(render({ content: { status: '支付成功' } })).attributes('data-color')).toBe('green')
    expect(statusTag(render({ content: { status: 'Refunded' } })).attributes('data-color')).toBe('orange')
    expect(statusTag(render({ content: { status: '交易失败' } })).attributes('data-color')).toBe('red')
    expect(statusTag(render({ content: { status: '处理中' } })).attributes('data-color')).toBe('default')
  })

  it('hides the status row when there is no status', () => {
    expect(render({ content: {} }).text()).not.toContain('状态')
  })
})

describe('OrderTableRenderer — time', () => {
  it('formats occurredAt as YYYY-MM-DD HH:MM (local)', () => {
    expect(render({ occurredAt: '2026-06-16T08:30:00' }).text()).toContain(
      '2026-06-16 08:30',
    )
  })

  it('is blank without occurredAt', () => {
    const w = render({})
    expect(w.find('.time').text()).toBe('')
  })
})
