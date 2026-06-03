/**
 * Tail of views-mount-smoke — isolated file so each view gets a fresh
 * vitest module state.
 *
 * When mounted alongside the 50+ parametric sweep in views-mount-smoke.test.js,
 * these 4 views fail with "Cannot read properties of null (reading '$')"
 * deep inside @vue/test-utils. Each passes in isolation; root cause is
 * @vue/test-utils' wrapper caching cleaving against ant-design-vue's
 * Notification provider when both Pinia + i18n plugins accumulate >50 mounts.
 *
 * Splitting to its own file resets the module scope per file — vitest
 * runs each .test.js in a separate worker context.
 *
 * Pre-existing flake, NOT a real regression — the views render fine in
 * the actual web-panel SPA. Keep this file lean (no shared describes,
 * no parametric loops) to preserve the isolation that makes it pass.
 */

import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'

vi.mock('ant-design-vue/es/locale/zh_CN', () => ({ default: { locale: 'zh_CN' } }))
vi.mock('ant-design-vue/es/locale/en_US', () => ({ default: { locale: 'en_US' } }))

const wsExecute = vi.fn().mockResolvedValue({ output: '', exitCode: 0 })

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({
    execute: wsExecute,
    onRuntimeEvent: () => () => {},
    onSession: () => () => {},
    sendRaw: vi.fn().mockResolvedValue({}),
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ id: 'mock', type: 'chat', history: [] }),
    resumeSession: vi.fn().mockResolvedValue({ id: 'mock', history: [] }),
    sendSessionMessage: vi.fn().mockResolvedValue({}),
    answerQuestion: vi.fn().mockResolvedValue({}),
    status: 'connected',
    connect: vi.fn(),
  }),
}))

const { messages, FALLBACK } = await import('@chainlesschain/locales')
const i18n = createI18n({
  legacy: false, globalInjection: true,
  locale: FALLBACK, fallbackLocale: FALLBACK, messages,
})

const antTagNames = [
  'a-alert', 'a-badge', 'a-button', 'a-card', 'a-col', 'a-row', 'a-list',
  'a-list-item', 'a-input', 'a-input-search', 'a-input-password', 'a-input-number',
  'a-tag', 'a-divider', 'a-empty', 'a-modal', 'a-radio-group', 'a-radio-button',
  'a-select', 'a-select-option', 'a-table', 'a-tabs', 'a-tab-pane', 'a-spin',
  'a-statistic', 'a-tooltip', 'a-popconfirm', 'a-progress', 'a-result',
  'a-textarea', 'a-typography-paragraph', 'a-typography-text', 'a-typography-title',
  'a-space', 'a-switch', 'a-checkbox', 'a-form', 'a-form-item', 'a-collapse',
  'a-collapse-panel', 'a-dropdown', 'a-menu', 'a-menu-item', 'a-menu-divider',
  'a-config-provider', 'a-descriptions', 'a-descriptions-item', 'a-timeline',
  'a-timeline-item',
]
const antStubs = Object.fromEntries(antTagNames.map((n) => [n, true]))
const mountOpts = {
  shallow: true,
  global: { renderStubDefaultSlot: true, stubs: antStubs, plugins: [i18n] },
}

setActivePinia(createPinia())

describe('isolated tail views', () => {
  it('VideoEditing.vue mounts under zh-CN', async () => {
    const View = (await import('../../src/views/VideoEditing.vue')).default
    const wrapper = mount(View, mountOpts)
    await flushPromises()
    expect(wrapper.html()).toContain(i18n.global.t('videoEditing.title'))
  })

  it('P2P.vue mounts under zh-CN', async () => {
    const View = (await import('../../src/views/P2P.vue')).default
    const wrapper = mount(View, mountOpts)
    await flushPromises()
    expect(wrapper.html()).toContain(i18n.global.t('p2p.title'))
  })

  it('Memory.vue mounts under zh-CN', async () => {
    const View = (await import('../../src/views/Memory.vue')).default
    const wrapper = mount(View, mountOpts)
    await flushPromises()
    expect(wrapper.html()).toContain(i18n.global.t('memory.title'))
  })

  it('Git.vue mounts under zh-CN', async () => {
    const View = (await import('../../src/views/Git.vue')).default
    const wrapper = mount(View, mountOpts)
    await flushPromises()
    expect(wrapper.html()).toContain(i18n.global.t('git.title'))
  })
})
