/**
 * TimelineRenderer (pdh) — unit tests for its pure display computeds:
 * travel icon switch, route building, place/fallback precedence, train/flight
 * tag, and the joined extra-detail line.
 */

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@ant-design/icons-vue', () => ({
  CarOutlined: { template: '<i class="car" />' },
  EnvironmentOutlined: { template: '<i class="env" />' },
}))

import TimelineRenderer from '../../src/components/pdh/renderers/TimelineRenderer.vue'

const stubs = {
  'a-tag': { props: ['color'], template: '<span class="atag"><slot /></span>' },
}

function render(event) {
  return mount(TimelineRenderer, {
    props: {
      event: { source: { adapter: 'travel-12306' }, subtype: 'trip', content: {}, ...event },
    },
    global: { stubs },
  })
}

describe('TimelineRenderer — travel icon', () => {
  it('shows the car icon for travel adapters', () => {
    expect(render({ source: { adapter: 'travel-12306' } }).find('.car').exists()).toBe(true)
  })

  it('shows the environment icon for non-travel adapters', () => {
    const w = render({ source: { adapter: 'social-weibo' } })
    expect(w.find('.env').exists()).toBe(true)
    expect(w.find('.car').exists()).toBe(false)
  })
})

describe('TimelineRenderer — primary line', () => {
  it('builds a from→to route', () => {
    expect(render({ content: { from: 'A', to: 'B' } }).text()).toContain('A → B')
  })

  it('falls back to origin→destination', () => {
    expect(render({ content: { origin: 'X', destination: 'Y' } }).text()).toContain('X → Y')
  })

  it('shows the place name (📍) when there is no route', () => {
    expect(render({ place: 'Cafe' }).text()).toContain('📍 Cafe')
    expect(render({ content: { poi: 'POI' } }).text()).toContain('📍 POI')
  })

  it('uses the fallback text when there is no route or place', () => {
    expect(render({ content: { description: 'desc' } }).text()).toContain('desc')
    expect(render({ content: {} }).text()).toContain('—')
  })
})

describe('TimelineRenderer — trip no + extra detail', () => {
  it('shows trainNo (or flightNo) in the trip-no tag', () => {
    expect(render({ content: { trainNo: 'G123' } }).find('.trip-no').text()).toContain('G123')
    expect(render({ content: { flightNo: 'CA456' } }).find('.trip-no').text()).toContain('CA456')
  })

  it('joins departure/arrival/duration/distance with " · "', () => {
    const w = render({
      content: { departureTime: '08:00', arrivalTime: '10:00', duration: '2h' },
    })
    expect(w.find('.extra').text()).toBe('出发 08:00 · 到达 10:00 · 2h')
  })

  it('omits the extra line when there are no detail parts', () => {
    expect(render({ content: { from: 'A', to: 'B' } }).find('.extra').exists()).toBe(false)
  })
})

describe('TimelineRenderer — time', () => {
  it('formats occurredAt as YYYY-MM-DD HH:MM (local)', () => {
    expect(render({ occurredAt: '2026-06-16T08:30:00' }).text()).toContain(
      '2026-06-16 08:30',
    )
  })
})
