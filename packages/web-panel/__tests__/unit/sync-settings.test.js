/**
 * SyncSettings.vue 单元测试 — Phase 3b web-shell parity
 *
 * 不挂全 Component（页面有 Ant Design 7+ 多组件 + i18n + Vue Router 依赖)。
 * 直接抽 fetchStatus / doPush / doPull / resolveOne 等业务函数等价路径，
 * 通过 mock ws.sendRaw 验 sync.* topic 的 envelope 解析与失败兜底。
 *
 * 这是 ws.sendRaw envelope 形状（{type, ok, result, error?}）和 handler 自身
 * 的 {success, ...} payload 错位时的回归测试 —— 之前漏算 envelope 害我跑
 * 一整轮 dev 才发现 reply.totalResources vs reply.result.totalResources。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// ── ws store mock ───────────────────────────────────────────────
const sendRaw = vi.fn()
vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw }),
}))

// ── i18n mock (SyncSettings doesn't use t() but a-* components might) ────
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k) => k, locale: { value: 'zh-CN' } }),
}))

// ── ant-design-vue stubs (avoid full library load + global registration) ──
const messageStub = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  loading: vi.fn(),
}
vi.mock('ant-design-vue', () => ({
  message: messageStub,
}))

// ── icons — vitest 4 strict mode requires every named export the SUT uses
// to be present in the mock; Proxy('get') doesn't satisfy ESM named-export
// resolution. Enumerate explicitly (per memory feedback "vitest 4 strict
// mock factories must include EVERY symbol").
vi.mock('@ant-design/icons-vue', () => {
  const stub = { template: '<span />' }
  return {
    BranchesOutlined: stub,
    CloudDownloadOutlined: stub,
    CloudSyncOutlined: stub,
    CloudUploadOutlined: stub,
    ReloadOutlined: stub,
    WarningOutlined: stub,
  }
})

// We mount with global stubs for a-* tags so we can inspect rendered output
// without happy-dom needing to render full antd components.
const aStub = {
  template: '<div class="a-stub"><slot /><slot name="extra" /><slot name="title" /><slot name="renderItem" /><slot name="bodyCell" /></div>',
  props: ['title', 'open', 'value', 'checked', 'disabled', 'loading', 'type', 'size', 'color', 'placement', 'placeholder', 'autoSize', 'showCount', 'icon', 'gutter', 'span', 'wrap', 'min', 'max', 'step', 'message', 'description', 'showIcon', 'okText', 'cancelText', 'okButtonProps', 'columns', 'dataSource', 'pagination', 'rowKey', 'itemLayout', 'subTitle', 'extra', 'bordered', 'mode', 'allowClear', 'autocomplete', 'help'],
  emits: ['update:value', 'change', 'click', 'ok', 'cancel', 'confirm', 'update:checked'],
}

const globalStubs = {
  'a-page-header': aStub,
  'a-card': aStub,
  'a-button': {
    template: '<button :data-loading="loading" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    props: ['loading', 'disabled', 'type', 'size', 'icon'],
    emits: ['click'],
  },
  'a-row': aStub,
  'a-col': aStub,
  'a-statistic': {
    template: '<div class="stat" :data-title="title" :data-value="value">{{ title }}: {{ value }}</div>',
    props: ['title', 'value', 'valueStyle'],
  },
  'a-tag': aStub,
  'a-spin': aStub,
  'a-form': aStub,
  'a-form-item': aStub,
  'a-input': aStub,
  'a-input-password': aStub,
  'a-input-number': aStub,
  'a-select': aStub,
  'a-switch': aStub,
  'a-alert': {
    template: '<div class="alert" :data-type="type">{{ message }} {{ description }}</div>',
    props: ['type', 'message', 'description', 'showIcon'],
  },
  // a-table iterates dataSource and tries to read row keys; simplest stub is
  // an empty div that ignores everything to prevent Vue render warns leaking
  // into vitest's unhandled-error hook.
  'a-table': {
    template: '<div class="a-table-stub" />',
    props: ['columns', 'dataSource', 'pagination', 'rowKey', 'size'],
  },
  'a-list': aStub,
  'a-list-item': aStub,
  'a-list-item-meta': aStub,
  'a-empty': aStub,
  'a-popconfirm': aStub,
  'a-descriptions': aStub,
  'a-descriptions-item': aStub,
  'a-space': aStub,
  'a-divider': aStub,
}

// dynamic import after mocks
async function importComponent() {
  return (await import('../../src/views/SyncSettings.vue')).default
}

beforeEach(() => {
  sendRaw.mockReset()
  Object.values(messageStub).forEach((fn) => fn.mockReset())
})

describe('SyncSettings.vue — sync.status', () => {
  it('renders 4 statistic with values from sync.status reply.result', async () => {
    sendRaw.mockResolvedValueOnce({
      type: 'sync.status.result',
      ok: true,
      result: {
        success: true,
        totalResources: 12,
        pending: 3,
        synced: 9,
        conflicts: 0,
      },
    })
    const Component = await importComponent()
    const wrapper = mount(Component, { global: { stubs: globalStubs } })
    await flushPromises()

    expect(sendRaw).toHaveBeenCalledWith({ type: 'sync.status' }, 15000)
    const stats = wrapper.findAll('.stat')
    const byTitle = Object.fromEntries(
      stats.map((s) => [
        s.attributes('data-title'),
        s.attributes('data-value'),
      ]),
    )
    expect(byTitle['资源总数']).toBe('12')
    expect(byTitle['待同步']).toBe('3')
    expect(byTitle['已同步']).toBe('9')
    expect(byTitle['冲突']).toBe('0')
  })

  it('shows 获取状态失败 when reply.ok=false', async () => {
    sendRaw.mockResolvedValueOnce({
      type: 'sync.status.result',
      ok: false,
      error: '数据库未初始化',
    })
    const Component = await importComponent()
    const wrapper = mount(Component, { global: { stubs: globalStubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('获取状态失败')
    expect(wrapper.text()).toContain('数据库未初始化')
  })

  it('shows 获取状态失败 when result.success=false (handler error envelope)', async () => {
    sendRaw.mockResolvedValueOnce({
      type: 'sync.status.result',
      ok: true,
      result: { success: false, error: 'no such table' },
    })
    const Component = await importComponent()
    const wrapper = mount(Component, { global: { stubs: globalStubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('获取状态失败')
    expect(wrapper.text()).toContain('no such table')
  })

  it('fetches conflicts list when conflicts > 0', async () => {
    // mount fires in parallel: sync.status + sync.webdav.config-get + git.config-get.
    // After sync.status returns conflicts:1, fetchConflicts is awaited inline →
    // sync.conflicts shows up in the call list. Assert by membership, not index.
    sendRaw.mockImplementation(async (frame) => {
      if (frame.type === 'sync.status') {
        return {
          type: 'sync.status.result',
          ok: true,
          result: {
            success: true,
            totalResources: 1,
            pending: 0,
            synced: 0,
            conflicts: 1,
          },
        }
      }
      if (frame.type === 'sync.conflicts') {
        return {
          type: 'sync.conflicts.result',
          ok: true,
          result: {
            success: true,
            conflicts: [{ id: 'c1', resource_id: 'r1', resource_type: 'note' }],
          },
        }
      }
      // webdav / git config-get etc — return harmless empty result
      return { type: frame.type + '.result', ok: true, result: {} }
    })
    const Component = await importComponent()
    mount(Component, { global: { stubs: globalStubs } })
    await flushPromises()
    expect(sendRaw).toHaveBeenCalledWith({ type: 'sync.status' }, 15000)
    expect(sendRaw).toHaveBeenCalledWith({ type: 'sync.conflicts' }, 15000)
  })
})
