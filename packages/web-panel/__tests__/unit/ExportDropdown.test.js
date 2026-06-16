/**
 * ExportDropdown (pdh) — unit tests: result-gated disable, button count, and
 * the menu-click → serialize → downloadAs → toast wiring (+ error path).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const h = vi.hoisted(() => ({
  eventsToJson: vi.fn(() => 'JSON'),
  eventsToNdjson: vi.fn(() => 'NDJSON'),
  eventsToCsv: vi.fn(() => 'CSV'),
  downloadAs: vi.fn(),
  suggestFilename: vi.fn(() => 'export.json'),
  message: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../src/utils/pdhExport.js', () => ({
  eventsToJson: h.eventsToJson,
  eventsToNdjson: h.eventsToNdjson,
  eventsToCsv: h.eventsToCsv,
  downloadAs: h.downloadAs,
  suggestFilename: h.suggestFilename,
}))
vi.mock('ant-design-vue', () => ({ message: h.message }))
vi.mock('@ant-design/icons-vue', () => ({
  DownloadOutlined: { template: '<i />' },
  DownOutlined: { template: '<i />' },
}))

import ExportDropdown from '../../src/components/pdh/ExportDropdown.vue'

const AMenu = { name: 'AMenuStub', emits: ['click'], template: '<div class="amenu"><slot /></div>' }
const stubs = {
  'a-dropdown': { props: ['disabled'], template: '<div class="dd" :data-disabled="disabled"><slot /><slot name="overlay" /></div>' },
  'a-button': { props: ['disabled'], template: '<button class="abtn" :disabled="disabled"><slot /></button>' },
  'a-menu': AMenu,
  'a-menu-item': { template: '<div class="mi"><slot /></div>' },
}

function render(events = [{ id: 1 }, { id: 2 }], category = 'chat') {
  return mount(ExportDropdown, { props: { events, category }, global: { stubs } })
}

const clickMenu = (w, key) => w.findComponent(AMenu).vm.$emit('click', { key })

beforeEach(() => {
  for (const v of Object.values(h)) {
    if (typeof v.mockReset === 'function') v.mockReset()
  }
  h.eventsToJson.mockReturnValue('JSON')
  h.eventsToCsv.mockReturnValue('CSV')
  h.suggestFilename.mockReturnValue('export.json')
})

describe('ExportDropdown — gating + label', () => {
  it('shows the event count in the button', () => {
    expect(render([{ id: 1 }, { id: 2 }, { id: 3 }]).find('.abtn').text()).toContain('导出 (3)')
  })

  it('disables when there are no events', () => {
    expect(render([]).find('.abtn').attributes('disabled')).toBeDefined()
    expect(render([{ id: 1 }]).find('.abtn').attributes('disabled')).toBeUndefined()
  })
})

describe('ExportDropdown — export wiring', () => {
  it('JSON: serializes, downloads with the json MIME, toasts success', async () => {
    const events = [{ id: 1 }, { id: 2 }]
    const w = render(events, 'chat')
    await clickMenu(w, 'json')
    expect(h.eventsToJson).toHaveBeenCalledWith(events)
    expect(h.suggestFilename).toHaveBeenCalledWith('json', 'chat')
    expect(h.downloadAs).toHaveBeenCalledWith(
      'JSON',
      'export.json',
      'application/json;charset=utf-8',
    )
    expect(h.message.success).toHaveBeenCalled()
  })

  it('CSV: uses the csv serializer + MIME', async () => {
    const w = render()
    await clickMenu(w, 'csv')
    expect(h.eventsToCsv).toHaveBeenCalled()
    expect(h.downloadAs).toHaveBeenCalledWith(
      'CSV',
      'export.json',
      'text/csv;charset=utf-8',
    )
  })

  it('surfaces a serialization error as a toast (no download)', async () => {
    h.eventsToJson.mockImplementation(() => {
      throw new Error('boom')
    })
    const w = render()
    await clickMenu(w, 'json')
    expect(h.downloadAs).not.toHaveBeenCalled()
    expect(h.message.error).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })
})
