/**
 * Phase 16 — PdhVaultBrowser view-level integration test.
 *
 * Mounts the view with a synthetic Pinia store (via @pinia/testing) so we
 * can drive every UI state without standing up a WS gateway. Verifies the
 * sidebar + filter bar + result list + load-more + export dropdown are
 * wired to the store, plus empty-state + error-state branches.
 *
 * Async renderer components (RendererDispatcher uses defineAsyncComponent)
 * are stubbed so the test doesn't need to wait for chunk resolution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import PdhVaultBrowser from '../../src/views/PdhVaultBrowser.vue'
import { usePdhBrowserStore } from '../../src/stores/pdhBrowser.js'

// Stub Ant Design + icon components so we don't drag in the whole bundle
// nor depend on their runtime shape. Each stub renders the slot content
// and exposes the props we assert against via data-attrs.
const STUBS = {
  'a-row': { template: '<div class="a-row"><slot /></div>' },
  'a-col': { template: '<div class="a-col"><slot /></div>' },
  'a-space': { template: '<div class="a-space"><slot /></div>' },
  'a-tag': {
    props: ['color'],
    template: '<span class="a-tag" :data-color="color"><slot /></span>',
  },
  'a-button': {
    props: ['type', 'loading', 'disabled', 'block'],
    emits: ['click'],
    template:
      '<button class="a-button" :disabled="disabled" :data-loading="loading || false" @click="$emit(\'click\')"><slot /></button>',
  },
  'a-spin': {
    props: ['size'],
    template: '<span class="a-spin"><slot /></span>',
  },
  'a-empty': {
    props: ['description'],
    template: '<div class="a-empty">{{ description }}</div>',
  },
  'a-alert': {
    props: ['type', 'showIcon', 'message', 'closable'],
    template: '<div class="a-alert" :data-type="type">{{ message }}</div>',
  },
  'a-input-search': {
    props: ['value', 'placeholder', 'enterButton', 'allowClear', 'loading'],
    emits: ['update:value', 'search'],
    template:
      '<input class="a-input-search" :value="value" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />',
  },
  'a-select': {
    props: ['value', 'placeholder', 'allowClear', 'options'],
    emits: ['update:value'],
    template:
      '<select class="a-select" :value="value" @change="$emit(\'update:value\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>',
  },
  'a-range-picker': {
    props: ['value', 'placeholder'],
    emits: ['update:value'],
    template: '<div class="a-range-picker"></div>',
  },
  'a-dropdown': {
    props: ['disabled'],
    template: '<div class="a-dropdown" :data-disabled="disabled"><slot /><slot name="overlay" /></div>',
  },
  'a-menu': {
    emits: ['click'],
    template: '<ul class="a-menu" @click="$emit(\'click\', { key: \'json\' })"><slot /></ul>',
  },
  'a-menu-item': {
    props: ['key'],
    template: '<li class="a-menu-item"><slot /></li>',
  },
  'a-badge': {
    props: ['count', 'numberStyle', 'overflowCount'],
    template: '<span class="a-badge" :data-count="count"><slot /></span>',
  },
  // Icons
  ReloadOutlined: { template: '<i class="i-reload" />' },
  AppstoreOutlined: { template: '<i class="i-apps" />' },
  MessageOutlined: { template: '<i class="i-msg" />' },
  PlayCircleOutlined: { template: '<i class="i-play" />' },
  MailOutlined: { template: '<i class="i-mail" />' },
  ShoppingOutlined: { template: '<i class="i-shop" />' },
  CarOutlined: { template: '<i class="i-car" />' },
  MobileOutlined: { template: '<i class="i-mob" />' },
  RobotOutlined: { template: '<i class="i-bot" />' },
  SearchOutlined: { template: '<i class="i-search" />' },
  CloseCircleOutlined: { template: '<i class="i-close" />' },
  InfoCircleOutlined: { template: '<i class="i-info" />' },
  DownloadOutlined: { template: '<i class="i-dl" />' },
  DownOutlined: { template: '<i class="i-down" />' },
  // Async renderer dispatcher — stub so we don't load defineAsyncComponent chunks
  RendererDispatcher: {
    props: ['event'],
    template: '<div class="renderer-stub" :data-event-id="event.id">{{ event.subtype }}</div>',
  },
  ExportDropdown: {
    props: ['events', 'category'],
    template: '<div class="export-stub" :data-event-count="events.length" :data-category="category" />',
  },
  CategorySidebar: {
    props: ['selected', 'facets'],
    emits: ['select'],
    template:
      '<div class="sidebar-stub" :data-selected="selected" :data-total="facets.total"></div>',
  },
  SearchFilterBar: {
    props: ['filters', 'facets', 'isLoading', 'mode', 'shortQuery'],
    emits: ['set-filter', 'reset'],
    template:
      '<div class="filterbar-stub" :data-q="filters.q" :data-loading="isLoading" :data-mode="mode" />',
  },
  GenericCardRenderer: {
    props: ['event'],
    template: '<div class="generic-stub" :data-event-id="event.id" />',
  },
}

function event(id, occurredAt, adapter = 'wechat', subtype = 'chat.message') {
  return {
    id, type: 'event', subtype, occurredAt, ingestedAt: occurredAt,
    content: { text: `text-${id}` },
    source: { adapter, adapterVersion: '0.1', capturedAt: 0, capturedBy: 't' },
  }
}

function mountView(initialState = {}) {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: {},
    stubActions: true, // we want to assert calls without running real logic
  })
  // Pre-set store state by accessing the store after pinia is active
  const wrapper = mount(PdhVaultBrowser, {
    global: { plugins: [pinia], stubs: STUBS },
  })
  const store = usePdhBrowserStore()
  Object.assign(store, initialState)
  return { wrapper, store }
}

describe('PdhVaultBrowser view integration', () => {
  beforeEach(() => {
    // Silence the v-if warnings from async components in our stub set
  })

  it('mounts and calls store.search() on initial mount', async () => {
    const { store } = mountView()
    await flushPromises()
    // mount → onMounted hook calls store.search() since hasResults=false
    expect(store.search).toHaveBeenCalled()
  })

  it('renders sidebar / filterbar / export with right wiring', async () => {
    const { wrapper, store } = mountView({
      results: [event('a', 1700000000000)],
      facets: { byCategory: { chat: 1 }, byAdapter: { wechat: 1 }, bySubtype: {}, total: 1 },
      mode: 'fts5',
    })
    await flushPromises()

    expect(wrapper.find('.sidebar-stub').attributes('data-total')).toBe('1')
    expect(wrapper.find('.filterbar-stub').attributes('data-mode')).toBe('fts5')
    expect(wrapper.find('.export-stub').attributes('data-event-count')).toBe('1')
    // Mode tag shows
    expect(wrapper.html()).toContain('FTS5 trigram')
  })

  it('shows LIKE-fallback tag when mode=like', async () => {
    const { wrapper } = mountView({ mode: 'like' })
    await flushPromises()
    expect(wrapper.html()).toContain('LIKE 兜底')
  })

  it('shows empty hint when no results + no filter', async () => {
    const { wrapper } = mountView({ results: [], facets: { byCategory: {}, byAdapter: {}, bySubtype: {}, total: 0 } })
    await flushPromises()
    expect(wrapper.find('.a-empty').exists()).toBe(true)
    expect(wrapper.find('.a-empty').text()).toContain('Vault 里还没有数据')
  })

  it('empty hint adapts to active keyword filter', async () => {
    const { wrapper } = mountView({
      results: [], filters: { q: 'abc', category: null, adapter: null, subtype: null, since: null, until: null },
      facets: { byCategory: {}, byAdapter: {}, bySubtype: {}, total: 0 },
    })
    await flushPromises()
    expect(wrapper.find('.a-empty').text()).toContain('"abc"')
  })

  it('empty hint adapts to active category filter', async () => {
    const { wrapper } = mountView({
      results: [], filters: { q: '', category: 'shopping', adapter: null, subtype: null, since: null, until: null },
      facets: { byCategory: { chat: 5 }, byAdapter: {}, bySubtype: {}, total: 5 },
    })
    await flushPromises()
    expect(wrapper.find('.a-empty').text()).toContain('支付订单')
  })

  it('renders error alert when store.error is set', async () => {
    const { wrapper } = mountView({ error: 'WS gateway timeout' })
    await flushPromises()
    const alert = wrapper.find('.a-alert')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('WS gateway timeout')
  })

  it('renders one RendererDispatcher per result row', async () => {
    const { wrapper } = mountView({
      results: [event('a', 100), event('b', 90), event('c', 80)],
      facets: { byCategory: { chat: 3 }, byAdapter: { wechat: 3 }, bySubtype: {}, total: 3 },
    })
    await flushPromises()
    const rows = wrapper.findAll('.renderer-stub')
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.attributes('data-event-id'))).toEqual(['a', 'b', 'c'])
  })

  it('shows "加载下一页" button when cursor is set', async () => {
    const { wrapper } = mountView({
      results: [event('a', 100)],
      cursor: { occurredAt: 100, id: 'a' },
      facets: { byCategory: {}, byAdapter: {}, bySubtype: {}, total: 100 },
    })
    await flushPromises()
    expect(wrapper.html()).toContain('加载下一页')
  })

  it('does NOT show load-more when cursor is null (final page)', async () => {
    const { wrapper } = mountView({
      results: [event('a', 100)],
      cursor: null,
      facets: { byCategory: {}, byAdapter: {}, bySubtype: {}, total: 1 },
    })
    await flushPromises()
    expect(wrapper.html()).not.toContain('加载下一页')
  })

  it('clicking load-more calls store.loadMore()', async () => {
    const { wrapper, store } = mountView({
      results: [event('a', 100)],
      cursor: { occurredAt: 100, id: 'a' },
      facets: { byCategory: {}, byAdapter: {}, bySubtype: {}, total: 100 },
    })
    await flushPromises()
    // Find the load-more button (first a-button with text)
    const btns = wrapper.findAll('.a-button')
    const loadMore = btns.find((b) => b.text().includes('加载下一页'))
    expect(loadMore).toBeDefined()
    await loadMore.trigger('click')
    expect(store.loadMore).toHaveBeenCalled()
  })

  it('summary row reflects facet totals + filter state', async () => {
    const { wrapper } = mountView({
      results: [event('a', 100), event('b', 90)],
      filters: { q: 'foo', category: 'social', adapter: null, subtype: null, since: null, until: null },
      facets: { byCategory: { social: 5, chat: 10 }, byAdapter: {}, bySubtype: {}, total: 15 },
    })
    await flushPromises()
    const html = wrapper.html()
    expect(html).toContain('15')               // total
    expect(html).toContain('内容平台')         // category label
    expect(html).toContain('foo')              // keyword
    expect(html).toContain('已显示 2')         // loaded count
  })
})
