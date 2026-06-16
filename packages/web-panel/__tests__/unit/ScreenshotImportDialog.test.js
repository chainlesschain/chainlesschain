/**
 * ScreenshotImportDialog component — unit tests.
 *
 * Composes useScreenshot + useKnowledge (both mocked) and ant message
 * toasts. Drives the dialog's own logic: open→capture→ocr flow, OCR
 * empty/error toasts, capture error + unsupported alerts, save (tag split
 * + addItem + saved emit + close + cleanup), the no-content guard, cancel,
 * and the recapture / rerun-ocr buttons.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const h = vi.hoisted(() => ({
  unsupported: { value: false },
  capture: vi.fn(),
  ocr: vi.fn(),
  cleanup: vi.fn(),
  addItem: vi.fn(),
  message: { info: vi.fn(), warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../src/composables/useScreenshot.js', () => ({
  useScreenshot: () =>
    h.unsupported.value
      ? {
          unsupported: true,
          capture: async () => {
            throw new Error('unsupported')
          },
          ocr: async () => {
            throw new Error('unsupported')
          },
          cleanup: async () => {},
        }
      : {
          unsupported: false,
          capture: h.capture,
          ocr: h.ocr,
          cleanup: h.cleanup,
        },
}))
vi.mock('../../src/composables/useKnowledge.js', () => ({
  useKnowledge: () => ({ addItem: h.addItem }),
}))
vi.mock('ant-design-vue', () => ({ message: h.message }))
vi.mock('@ant-design/icons-vue', () => ({
  CameraOutlined: { template: '<i />' },
  ScanOutlined: { template: '<i />' },
}))

import ScreenshotImportDialog from '../../src/components/ScreenshotImportDialog.vue'

const stubs = {
  'a-modal': {
    props: ['open', 'okButtonProps'],
    emits: ['ok', 'cancel', 'update:open'],
    template:
      '<div class="modal" v-if="open"><slot /><button class="modal-ok" @click="$emit(\'ok\')">ok</button><button class="modal-cancel" @click="$emit(\'cancel\')">cancel</button></div>',
  },
  'a-alert': {
    props: ['message', 'description', 'type'],
    template:
      '<div class="alert" :data-type="type">{{ message }} {{ description }}</div>',
  },
  'a-button': { template: '<button class="abtn" @click="$emit(\'click\')"><slot /></button>' },
  'a-select': {
    props: ['value'],
    template: '<select class="aselect"><slot /></select>',
  },
  'a-select-option': { template: '<option><slot /></option>' },
  'a-tag': { template: '<span class="atag"><slot /></span>' },
  'a-tooltip': { template: '<div><slot /></div>' },
  'a-form': { template: '<form><slot /></form>' },
  'a-form-item': {
    template: '<div class="fitem"><slot name="label" /><slot /></div>',
  },
  'a-input': {
    props: ['value', 'placeholder'],
    emits: ['update:value'],
    template:
      '<input class="ainput" :placeholder="placeholder" :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
  },
  'a-textarea': {
    props: ['value'],
    emits: ['update:value'],
    template:
      '<textarea class="atextarea" :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
  },
  'a-spin': { template: '<span class="spin" />' },
}

function openDialog() {
  return mount(ScreenshotImportDialog, {
    props: { modelValue: true },
    global: { stubs },
  })
}

beforeEach(() => {
  h.unsupported.value = false
  h.capture.mockReset().mockResolvedValue({ path: '/s.png', dataUrl: 'data:img' })
  h.ocr.mockReset().mockResolvedValue({
    text: 'recognized text',
    confidence: 88,
    engine: 'tesseract',
  })
  h.cleanup.mockReset().mockResolvedValue(undefined)
  h.addItem.mockReset().mockResolvedValue({ id: 'k1' })
  for (const f of Object.values(h.message)) f.mockReset()
})

describe('ScreenshotImportDialog — open → capture → ocr', () => {
  it('captures and runs OCR with the selected engine on open', async () => {
    openDialog()
    await flushPromises()
    expect(h.capture).toHaveBeenCalled()
    expect(h.ocr).toHaveBeenCalledWith('/s.png', undefined, 'auto')
  })

  it('shows an info toast when OCR yields no text', async () => {
    h.ocr.mockResolvedValueOnce({ text: '', engine: 'tesseract' })
    openDialog()
    await flushPromises()
    expect(h.message.info).toHaveBeenCalled()
  })

  it('warns when OCR throws', async () => {
    h.ocr.mockRejectedValueOnce(new Error('ocr-broke'))
    openDialog()
    await flushPromises()
    expect(h.message.warning).toHaveBeenCalledWith(
      expect.stringContaining('ocr-broke'),
    )
  })

  it('surfaces a capture error as an alert', async () => {
    h.capture.mockRejectedValueOnce(new Error('no-display'))
    const w = openDialog()
    await flushPromises()
    expect(w.find('.alert[data-type="error"]').text()).toContain('no-display')
    expect(h.ocr).not.toHaveBeenCalled()
  })
})

describe('ScreenshotImportDialog — unsupported (browser)', () => {
  it('shows the unsupported warning and never captures', async () => {
    h.unsupported.value = true
    const w = openDialog()
    await flushPromises()
    expect(w.find('.alert[data-type="warning"]').exists()).toBe(true)
    expect(h.capture).not.toHaveBeenCalled()
  })
})

describe('ScreenshotImportDialog — save', () => {
  it('saves the OCR content + split tags, emits saved, cleans up and closes', async () => {
    const w = openDialog()
    await flushPromises()
    // set tags via the tags input (targeted by placeholder)
    const tagsInput = w
      .findAll('.ainput')
      .find((i) => i.attributes('placeholder')?.includes('截图, 参考'))
    await tagsInput.setValue('a, b，c ')
    await w.find('.modal-ok').trigger('click')
    await flushPromises()
    expect(h.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'recognized text',
        tags: ['a', 'b', 'c'],
        type: 'note',
      }),
    )
    expect(h.addItem.mock.calls[0][0].title).toMatch(/截图识别/)
    expect(w.emitted('saved')).toBeTruthy()
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
    expect(h.cleanup).toHaveBeenCalledWith('/s.png')
  })

  it('refuses to save when there is no recognized text', async () => {
    h.ocr.mockResolvedValueOnce({ text: '', engine: 'tesseract' })
    const w = openDialog()
    await flushPromises()
    await w.find('.modal-ok').trigger('click')
    await flushPromises()
    expect(h.message.warning).toHaveBeenCalled()
    expect(h.addItem).not.toHaveBeenCalled()
  })

  it('shows an error toast when addItem fails', async () => {
    h.addItem.mockRejectedValueOnce(new Error('disk full'))
    const w = openDialog()
    await flushPromises()
    await w.find('.modal-ok').trigger('click')
    await flushPromises()
    expect(h.message.error).toHaveBeenCalledWith(
      expect.stringContaining('disk full'),
    )
  })
})

describe('ScreenshotImportDialog — cancel + action buttons', () => {
  it('cancel cleans up and closes', async () => {
    const w = openDialog()
    await flushPromises()
    h.cleanup.mockClear()
    await w.find('.modal-cancel').trigger('click')
    await flushPromises()
    expect(h.cleanup).toHaveBeenCalledWith('/s.png')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('"重跑 OCR" re-runs OCR on the current shot', async () => {
    const w = openDialog()
    await flushPromises()
    h.ocr.mockClear()
    const rerun = w.findAll('.abtn').find((b) => b.text().includes('重跑 OCR'))
    await rerun.trigger('click')
    await flushPromises()
    expect(h.ocr).toHaveBeenCalledWith('/s.png', undefined, 'auto')
  })

  it('"重新截图" cleans up then captures again', async () => {
    const w = openDialog()
    await flushPromises()
    h.capture.mockClear()
    h.cleanup.mockClear()
    const recap = w.findAll('.abtn').find((b) => b.text().includes('重新截图'))
    await recap.trigger('click')
    await flushPromises()
    expect(h.cleanup).toHaveBeenCalledWith('/s.png')
    expect(h.capture).toHaveBeenCalled()
  })
})
