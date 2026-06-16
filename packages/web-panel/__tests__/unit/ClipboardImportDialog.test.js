/**
 * ClipboardImportDialog component — unit tests.
 *
 * Reads navigator.clipboard on open, then saves to the knowledge base via
 * useKnowledge. useKnowledge + ant message are mocked; the clipboard API is
 * stubbed per test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const h = vi.hoisted(() => ({
  addItem: vi.fn(),
  message: { info: vi.fn(), warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../src/composables/useKnowledge.js', () => ({
  useKnowledge: () => ({ addItem: h.addItem }),
}))
vi.mock('ant-design-vue', () => ({ message: h.message }))

import ClipboardImportDialog from '../../src/components/ClipboardImportDialog.vue'

const stubs = {
  'a-modal': {
    props: ['open'],
    emits: ['ok', 'cancel', 'update:open'],
    template:
      '<div class="modal" v-if="open"><slot /><button class="modal-ok" @click="$emit(\'ok\')">ok</button><button class="modal-cancel" @click="$emit(\'cancel\')">cancel</button></div>',
  },
  'a-alert': {
    props: ['message', 'description', 'type'],
    template: '<div class="alert" :data-type="type">{{ message }}</div>',
  },
  'a-form': { template: '<form><slot /></form>' },
  'a-form-item': { template: '<div class="fitem"><slot /></div>' },
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
}

const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function setClipboard(readText) {
  Object.defineProperty(navigator, 'clipboard', {
    value: readText === null ? {} : { readText },
    configurable: true,
  })
}

function openDialog() {
  return mount(ClipboardImportDialog, {
    props: { modelValue: true },
    global: { stubs },
  })
}

beforeEach(() => {
  h.addItem.mockReset().mockResolvedValue({ id: 'k1' })
  for (const f of Object.values(h.message)) f.mockReset()
  setClipboard(vi.fn().mockResolvedValue('pasted text'))
})
afterEach(() => {
  if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard)
})

describe('ClipboardImportDialog — clipboard read on open', () => {
  it('reads clipboard text and uses it as the saved content', async () => {
    const w = openDialog()
    await flushPromises()
    expect(navigator.clipboard.readText).toHaveBeenCalled()
    await w.find('.modal-ok').trigger('click')
    await flushPromises()
    expect(h.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'pasted text', type: 'note' }),
    )
  })

  it('warns (alert) when the clipboard API is unavailable', async () => {
    setClipboard(null) // {} — no readText
    const w = openDialog()
    await flushPromises()
    expect(w.find('.alert[data-type="warning"]').text()).toContain(
      '不支持剪贴板读取',
    )
  })

  it('flags an empty clipboard', async () => {
    setClipboard(vi.fn().mockResolvedValue(''))
    const w = openDialog()
    await flushPromises()
    expect(w.find('.alert').text()).toContain('剪贴板为空')
  })

  it('surfaces a clipboard read failure', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    const w = openDialog()
    await flushPromises()
    expect(w.find('.alert').text()).toContain('读取剪贴板失败')
  })
})

describe('ClipboardImportDialog — save', () => {
  it('splits tags, calls addItem, emits saved and closes', async () => {
    const w = openDialog()
    await flushPromises()
    const tagsInput = w
      .findAll('.ainput')
      .find((i) => i.attributes('placeholder')?.includes('素材, 链接'))
    await tagsInput.setValue('素材，链接, x ')
    await w.find('.modal-ok').trigger('click')
    await flushPromises()
    expect(h.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'pasted text',
        tags: ['素材', '链接', 'x'],
        type: 'note',
      }),
    )
    expect(h.addItem.mock.calls[0][0].title).toMatch(/剪贴板导入/)
    expect(w.emitted('saved')).toBeTruthy()
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
    expect(h.message.success).toHaveBeenCalled()
  })

  it('refuses to save empty content', async () => {
    setClipboard(vi.fn().mockResolvedValue(''))
    const w = openDialog()
    await flushPromises()
    await w.find('.modal-ok').trigger('click')
    await flushPromises()
    expect(h.message.warning).toHaveBeenCalled()
    expect(h.addItem).not.toHaveBeenCalled()
  })

  it('shows an error toast when addItem fails', async () => {
    h.addItem.mockRejectedValueOnce(new Error('boom'))
    const w = openDialog()
    await flushPromises()
    await w.find('.modal-ok').trigger('click')
    await flushPromises()
    expect(h.message.error).toHaveBeenCalledWith(expect.stringContaining('boom'))
    // dialog stays open on failure
    expect(w.emitted('update:modelValue')?.at(-1)).not.toEqual([false])
  })

  it('cancel closes without saving', async () => {
    const w = openDialog()
    await flushPromises()
    await w.find('.modal-cancel').trigger('click')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
    expect(h.addItem).not.toHaveBeenCalled()
  })
})
