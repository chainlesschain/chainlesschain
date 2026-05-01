/**
 * View mount-smoke tests for high-traffic pages.
 *
 * Existing tests cover stores, parsers, and composables in isolation but
 * never mount the SFCs themselves — so a template syntax slip or a
 * broken initial reactive setup can land without failing any test.
 * These tests mount each view shallowly with realistic ws + store
 * mocks and assert that the page heading renders and the expected
 * onMounted side-effects fire.
 *
 * Pattern: shallow mount + renderStubDefaultSlot + ws/store mocks.
 * Stubs strip ant-design-vue children so we don't pull async chunks.
 *
 * Coverage:
 *   - Pipeline.vue  (recently audited; Compliance/DID/KG sister pattern)
 *   - Compliance.vue (had a placeholder removed; protect the new shape)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const wsExecute = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({
    execute: wsExecute,
    onRuntimeEvent: () => () => {},
    onSession: () => () => {},
    sendRaw: vi.fn().mockResolvedValue({}),
    status: 'connected',
    connect: vi.fn(),
  }),
}))

// ant-design-vue components are registered via app.component() in
// plugins/antd.js at boot; the SFCs never import them. shallow mount's
// auto-stub only catches imported children, so we need to stub the full
// a-* surface explicitly or Vue emits dozens of "Failed to resolve
// component" warnings per test run. Listing them here is verbose but
// keeps the test signal clean.
const antTagNames = [
  'a-alert', 'a-badge', 'a-button', 'a-card', 'a-checkbox', 'a-col',
  'a-collapse', 'a-collapse-panel', 'a-config-provider', 'a-descriptions',
  'a-descriptions-item', 'a-divider', 'a-dropdown', 'a-empty', 'a-form',
  'a-form-item', 'a-input', 'a-input-group', 'a-input-number',
  'a-input-password', 'a-input-search', 'a-layout', 'a-layout-content',
  'a-layout-header', 'a-layout-sider', 'a-list', 'a-list-item', 'a-menu',
  'a-menu-divider', 'a-menu-item', 'a-menu-item-group', 'a-modal',
  'a-popconfirm', 'a-progress', 'a-radio-button', 'a-radio-group', 'a-result',
  'a-row', 'a-select', 'a-select-option', 'a-slider', 'a-space', 'a-spin',
  'a-statistic', 'a-sub-menu', 'a-switch', 'a-table', 'a-tab-pane', 'a-tabs',
  'a-tag', 'a-textarea', 'a-timeline', 'a-timeline-item', 'a-tooltip',
]
const antStubs = Object.fromEntries(antTagNames.map((n) => [n, true]))

const mountOpts = {
  shallow: true,
  global: { renderStubDefaultSlot: true, stubs: antStubs },
}

beforeEach(() => {
  setActivePinia(createPinia())
  wsExecute.mockReset()
  wsExecute.mockResolvedValue({ output: '', exitCode: 0 })
})

afterEach(() => {
  // Suppress async-rejection noise from happy-dom timers triggered by
  // background loaders that resolve after the test finished.
})

describe('Pipeline.vue mount smoke', () => {
  it('mounts and renders the page heading', async () => {
    const Pipeline = (await import('../../src/views/Pipeline.vue')).default
    const wrapper = mount(Pipeline, mountOpts)
    await flushPromises()

    const html = wrapper.html()
    expect(html).toContain('开发流水线')
    expect(html).toContain('7 阶段 AI 开发流水线')
  })

  it('fires the four pipeline ws.execute calls on mount', async () => {
    const Pipeline = (await import('../../src/views/Pipeline.vue')).default
    mount(Pipeline, mountOpts)
    await flushPromises()

    const cmds = wsExecute.mock.calls.map((c) => c[0])
    expect(cmds).toContain('pipeline list')
    expect(cmds).toContain('pipeline deploys')
    expect(cmds).toContain('pipeline templates')
    expect(cmds).toContain('pipeline stats')
  })

  it('survives the noDb error path without throwing', async () => {
    // When the ws.execute responses look like the "no DB" CLI output,
    // Pipeline sets errorState.noDb=true and shows a banner. The mount
    // should not crash even when every command "fails".
    wsExecute.mockResolvedValue({
      output: '需要 chainlesschain 项目数据库',
      exitCode: 1,
    })
    const Pipeline = (await import('../../src/views/Pipeline.vue')).default
    const wrapper = mount(Pipeline, mountOpts)
    await flushPromises()

    expect(wrapper.html()).toContain('开发流水线')
  })
})

describe('Compliance.vue mount smoke', () => {
  it('mounts and renders the page heading', async () => {
    const Compliance = (await import('../../src/views/Compliance.vue')).default
    const wrapper = mount(Compliance, mountOpts)
    await flushPromises()

    const html = wrapper.html()
    expect(html).toContain('合规与威胁情报')
    expect(html).toContain('威胁指标')
  })

  it('fires the threat-intel + ueba ws.execute calls on mount', async () => {
    const Compliance = (await import('../../src/views/Compliance.vue')).default
    mount(Compliance, mountOpts)
    await flushPromises()

    const cmds = wsExecute.mock.calls.map((c) => c[0])
    expect(cmds.some((c) => c.includes('compliance threat-intel list'))).toBe(true)
    expect(cmds.some((c) => c.includes('compliance threat-intel stats'))).toBe(true)
    expect(cmds.some((c) => c.includes('compliance ueba top'))).toBe(true)
  })

  it('does not render the removed STIX-import placeholder anywhere', async () => {
    // Defence in depth alongside desktop-only-buttons-removed.test.js:
    // that one scans source, this one scans the rendered DOM. If the
    // placeholder ever gets re-added under a v-if branch we forget to
    // strip, the source-only test would not catch it.
    const Compliance = (await import('../../src/views/Compliance.vue')).default
    const wrapper = mount(Compliance, mountOpts)
    await flushPromises()

    expect(wrapper.html()).not.toContain('(CLI 端)')
    expect(wrapper.html()).not.toContain('disabled="disabled"')
  })
})
