/**
 * SearchFilterBar (pdh) component — unit tests.
 *
 * Pure presentational: computed placeholder / adapter options / date range /
 * active-filter flag, and set-filter / reset emits. No composables or async.
 */

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@ant-design/icons-vue', () => ({
  SearchOutlined: { template: '<i />' },
  CloseCircleOutlined: { template: '<i />' },
  InfoCircleOutlined: { template: '<i />' },
}))

import SearchFilterBar from '../../src/components/pdh/SearchFilterBar.vue'

const stubs = {
  'a-input-search': {
    props: ['value', 'placeholder', 'loading'],
    emits: ['update:value', 'search'],
    template:
      '<div class="search" :data-placeholder="placeholder"><input class="q-input" @input="$emit(\'update:value\', $event.target.value)" /><button class="q-search" @click="$emit(\'search\', \'q1\')" /></div>',
  },
  'a-select': {
    props: ['value', 'options', 'placeholder'],
    emits: ['update:value'],
    template:
      '<select class="adapter-select" :data-options="JSON.stringify(options || [])" @change="$emit(\'update:value\', $event.target.value)"><option value="">none</option><option v-for="o in (options || [])" :key="o.value" :value="o.value">{{ o.label }}</option></select>',
  },
  'a-range-picker': {
    props: ['value'],
    emits: ['update:value'],
    methods: {
      emitSet() {
        this.$emit('update:value', [new Date(1000), new Date(2000)])
      },
      emitClear() {
        this.$emit('update:value', null)
      },
    },
    template:
      '<div class="range" :data-has="value ? 1 : 0"><button class="rp-set" @click="emitSet" /><button class="rp-clear" @click="emitClear" /></div>',
  },
  'a-button': { template: '<button class="abtn" @click="$emit(\'click\')"><slot /></button>' },
}

const baseFilters = {
  q: '',
  adapter: null,
  category: null,
  subtype: null,
  since: null,
  until: null,
}

function makeWrapper(filters = {}, extra = {}) {
  return mount(SearchFilterBar, {
    props: { filters: { ...baseFilters, ...filters }, ...extra },
    global: { stubs },
  })
}

describe('SearchFilterBar — computed display', () => {
  it('uses a category-scoped placeholder when a category is set', () => {
    const w = makeWrapper({ category: '购物' })
    expect(w.find('.search').attributes('data-placeholder')).toContain(
      '在「购物」类目内搜索',
    )
  })

  it('uses the generic placeholder with no category', () => {
    const w = makeWrapper()
    expect(w.find('.search').attributes('data-placeholder')).toContain(
      '搜索关键词',
    )
  })

  it('builds adapter options sorted by count desc with count labels', () => {
    const w = makeWrapper({}, { facets: { byAdapter: { jd: 2, taobao: 5 } } })
    const opts = JSON.parse(w.find('.adapter-select').attributes('data-options'))
    expect(opts).toEqual([
      { value: 'taobao', label: 'taobao (5)' },
      { value: 'jd', label: 'jd (2)' },
    ])
  })

  it('date range is null when neither since nor until is set, present otherwise', () => {
    expect(makeWrapper().find('.range').attributes('data-has')).toBe('0')
    expect(
      makeWrapper({ since: 1000 }).find('.range').attributes('data-has'),
    ).toBe('1')
  })

  it('shows the reset button only when a filter is active', () => {
    expect(makeWrapper().find('.abtn').exists()).toBe(false)
    expect(makeWrapper({ q: 'hi' }).find('.abtn').exists()).toBe(true)
  })

  it('renders the short-query hint and the LIKE-mode hint', () => {
    expect(makeWrapper({}, { shortQuery: true }).text()).toContain(
      '至少 3 字',
    )
    expect(makeWrapper({}, { mode: 'like' }).text()).toContain('LIKE 兜底')
  })
})

describe('SearchFilterBar — emits', () => {
  it('streams typed query via set-filter q', async () => {
    const w = makeWrapper()
    await w.find('.q-input').setValue('alipay')
    expect(w.emitted('set-filter')?.at(-1)).toEqual(['q', 'alipay'])
  })

  it('search button emits set-filter q', async () => {
    const w = makeWrapper()
    await w.find('.q-search').trigger('click')
    expect(w.emitted('set-filter')?.at(-1)).toEqual(['q', 'q1'])
  })

  it('selecting an adapter emits set-filter adapter; clearing emits null', async () => {
    const w = makeWrapper(
      {},
      { facets: { byAdapter: { taobao: 5 } } },
    )
    const sel = w.find('.adapter-select')
    await sel.setValue('taobao')
    expect(w.emitted('set-filter')?.at(-1)).toEqual(['adapter', 'taobao'])
    await sel.setValue('') // the "none" option
    expect(w.emitted('set-filter')?.at(-1)).toEqual(['adapter', null])
  })

  it('picking a date range emits since + until as epoch ms', async () => {
    const w = makeWrapper()
    await w.find('.rp-set').trigger('click')
    const calls = w.emitted('set-filter')
    expect(calls).toContainEqual(['since', 1000])
    expect(calls).toContainEqual(['until', 2000])
  })

  it('clearing the date range emits null since + until', async () => {
    const w = makeWrapper({ since: 1000, until: 2000 })
    await w.find('.rp-clear').trigger('click')
    const calls = w.emitted('set-filter')
    expect(calls).toContainEqual(['since', null])
    expect(calls).toContainEqual(['until', null])
  })

  it('reset button emits reset', async () => {
    const w = makeWrapper({ q: 'hi' })
    await w.find('.abtn').trigger('click')
    expect(w.emitted('reset')).toBeTruthy()
  })
})
