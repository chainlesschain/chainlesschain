/**
 * MobileBridgeHeaderStatus component — unit tests.
 *
 * Exercises the CLI-output JSON parser (parseJsonOutput) through the rendered
 * device count, plus tooltip text, icon color, refresh gating on ws.status,
 * silent error handling, and the click → /mobile-bridge navigation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const h = vi.hoisted(() => ({
  status: { value: 'connected' },
  execute: vi.fn(),
  push: vi.fn(),
}))

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({
    get status() {
      return h.status.value
    },
    execute: h.execute,
  }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: h.push }) }))
vi.mock('@ant-design/icons-vue', () => ({
  MobileOutlined: { template: '<i class="mob" />' },
}))

import MobileBridgeHeaderStatus from '../../src/components/MobileBridgeHeaderStatus.vue'

const stubs = {
  'a-tooltip': {
    props: ['title'],
    template: '<div class="tip" :data-title="title"><slot /></div>',
  },
  'a-badge': {
    props: ['count'],
    template: '<div class="badge" :data-count="count"><slot /></div>',
  },
}

async function mountWith(output) {
  if (output !== undefined) h.execute.mockResolvedValue({ output })
  const w = mount(MobileBridgeHeaderStatus, { global: { stubs } })
  await flushPromises()
  return w
}

const count = (w) => Number(w.find('.badge').attributes('data-count'))

beforeEach(() => {
  vi.useFakeTimers()
  h.status.value = 'connected'
  h.execute.mockReset().mockResolvedValue({ output: '[]' })
  h.push.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('MobileBridgeHeaderStatus — parseJsonOutput via device count', () => {
  it('parses a plain JSON array', async () => {
    const w = await mountWith('[{"id":1},{"id":2}]')
    expect(count(w)).toBe(2)
  })

  it('skips a leading CLI log prefix before multi-line JSON', async () => {
    const w = await mountWith('[AppConfig] Configuration loaded\n[\n  {"id":1}\n]')
    expect(count(w)).toBe(1)
  })

  it('skips leading + trailing log lines around multi-line JSON', async () => {
    const w = await mountWith(
      '[AppConfig] x\n[\n  {"id":1},\n  {"id":2}\n]\n[DatabaseManager] closed',
    )
    expect(count(w)).toBe(2)
  })

  it('yields 0 for non-JSON garbage and for empty output', async () => {
    expect(count(await mountWith('not json at all'))).toBe(0)
    expect(count(await mountWith(''))).toBe(0)
  })
})

describe('MobileBridgeHeaderStatus — tooltip + icon color', () => {
  it('shows the unpaired tooltip + inactive button at zero', async () => {
    const w = await mountWith('[]')
    expect(w.find('.tip').attributes('data-title')).toContain('尚未配对')
    // jsdom drops `color: var(--text-muted,…)`, so assert the observable
    // non-active state instead of the muted CSS var.
    expect(w.find('.mbh-btn').classes()).not.toContain('mbh-btn--active')
    expect(w.find('.mob').attributes('style') || '').not.toContain('#52c41a')
  })

  it('shows the paired tooltip + green icon when devices exist', async () => {
    const w = await mountWith('[{"id":1}]')
    expect(w.find('.tip').attributes('data-title')).toContain('已配对 1 台')
    expect(w.find('.mob').attributes('style')).toContain('#52c41a')
    expect(w.find('.mbh-btn').classes()).toContain('mbh-btn--active')
  })
})

describe('MobileBridgeHeaderStatus — refresh gating + errors', () => {
  it('does not query the CLI when the ws is not connected', async () => {
    h.status.value = 'disconnected'
    const w = await mountWith('[{"id":1}]')
    expect(h.execute).not.toHaveBeenCalled()
    expect(count(w)).toBe(0)
  })

  it('keeps the last list (no throw) when execute fails', async () => {
    h.execute.mockRejectedValue(new Error('ws-down'))
    const w = mount(MobileBridgeHeaderStatus, { global: { stubs } })
    await flushPromises()
    expect(count(w)).toBe(0)
  })
})

describe('MobileBridgeHeaderStatus — navigation', () => {
  it('clicking routes to /mobile-bridge', async () => {
    const w = await mountWith('[]')
    await w.find('.mbh-btn').trigger('click')
    expect(h.push).toHaveBeenCalledWith('/mobile-bridge')
  })
})
