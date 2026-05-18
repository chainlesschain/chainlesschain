/**
 * Unit tests for web-panel MtcVerifyDrawer (Phase 4.3 / cross-host parity).
 *
 * Asserts:
 *  - Renders prop-driven hint
 *  - Disables 运行 button until both paths are filled
 *  - Calls ws.execute with quoted `mtc verify` command
 *  - Renders success state for verify pass
 *  - Renders failure code for verify fail
 *  - Surfaces error when CLI returns non-JSON output
 *  - Resets result on reopen (watch on `open`)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import MtcVerifyDrawer from '../../src/components/MtcVerifyDrawer.vue'
import { useWsStore } from '../../src/stores/ws.js'

const STUBS = {
  'a-drawer': {
    props: ['open', 'title', 'width', 'placement'],
    template: '<div class="stub-drawer" v-if="open"><slot /></div>',
  },
  'a-alert': {
    props: ['type', 'showIcon', 'message'],
    template: '<div class="stub-alert">{{ message }}</div>',
  },
  'a-form': { template: '<form><slot /></form>' },
  'a-form-item': {
    props: ['label'],
    template: '<div><label>{{ label }}</label><slot /></div>',
  },
  'a-input': {
    props: ['value', 'placeholder', 'allowClear'],
    emits: ['update:value'],
    template:
      "<input :value=\"value\" :placeholder=\"placeholder\" @input=\"$emit('update:value', $event.target.value)\" />",
  },
  'a-button': {
    props: ['type', 'loading', 'disabled'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot name="icon" /><slot /></button>',
    emits: ['click'],
  },
  'a-divider': { template: '<hr />' },
  'a-card': {
    props: ['size', 'title'],
    template: '<div class="stub-card"><slot name="title" /><slot /></div>',
  },
  'a-descriptions': { template: '<dl><slot /></dl>' },
  'a-descriptions-item': {
    props: ['label'],
    template: '<div><dt>{{ label }}</dt><dd><slot /></dd></div>',
  },
  'a-tag': {
    props: ['color'],
    template: '<span class="stub-tag"><slot /></span>',
  },
  'a-collapse': { template: '<div><slot /></div>' },
  'a-collapse-panel': {
    props: ['header'],
    template: '<details><summary>{{ header }}</summary><slot /></details>',
  },
  SafetyOutlined: { template: '<span />' },
  CheckCircleOutlined: { template: '<span class="ok" />' },
  CloseCircleOutlined: { template: '<span class="fail" />' },
}

describe('MtcVerifyDrawer (web-panel)', () => {
  let executeMock

  beforeEach(() => {
    setActivePinia(createPinia())
    const ws = useWsStore()
    executeMock = vi.fn()
    ws.execute = executeMock
  })

  it('renders custom hint when prop provided', () => {
    const wrapper = mount(MtcVerifyDrawer, {
      props: { open: true, hint: 'this is a custom hint' },
      global: { stubs: STUBS },
    })
    expect(wrapper.html()).toContain('this is a custom hint')
  })

  it('disables 运行 button until both paths are filled', async () => {
    const wrapper = mount(MtcVerifyDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    })
    const button = wrapper.findAll('button').find((b) => b.text().includes('运行'))
    expect(button?.element.disabled).toBe(true)
    await wrapper.findAll('input')[0].setValue('./envelope.json')
    expect(button?.element.disabled).toBe(true)
    await wrapper.findAll('input')[1].setValue('./landmark.json')
    expect(button?.element.disabled).toBe(false)
  })

  it('calls ws.execute with mtc verify command + quoted paths', async () => {
    executeMock.mockResolvedValue({
      output: JSON.stringify({
        ok: true,
        leaf: { subject: 'did:cc:zQ3', kind: 'did-document' },
        treeHead: { tree_size: 4, issuer: 'mtca:cc:test' },
      }),
    })

    const wrapper = mount(MtcVerifyDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    })
    await wrapper.findAll('input')[0].setValue('./envelope.json')
    await wrapper.findAll('input')[1].setValue('./landmark.json')
    const button = wrapper.findAll('button').find((b) => b.text().includes('运行'))
    await button.trigger('click')
    await flushPromises()

    expect(executeMock).toHaveBeenCalledTimes(1)
    const cmd = executeMock.mock.calls[0][0]
    expect(cmd).toContain('mtc verify')
    expect(cmd).toContain('"./envelope.json"')
    expect(cmd).toContain('--landmark "./landmark.json"')
    expect(cmd).toContain('--json')

    const html = wrapper.html()
    expect(html).toContain('验证通过')
    expect(html).toContain('did:cc:zQ3')
  })

  it('renders failure code when verify ok=false', async () => {
    executeMock.mockResolvedValue({
      output: JSON.stringify({
        ok: false,
        code: 'LANDMARK_EXPIRED',
        recoverable: false,
      }),
    })
    const wrapper = mount(MtcVerifyDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    })
    await wrapper.findAll('input')[0].setValue('a')
    await wrapper.findAll('input')[1].setValue('b')
    const button = wrapper.findAll('button').find((b) => b.text().includes('运行'))
    await button.trigger('click')
    await flushPromises()

    const html = wrapper.html()
    expect(html).toContain('验证失败')
    expect(html).toContain('LANDMARK_EXPIRED')
  })

  it('shows error message when CLI returns non-JSON output', async () => {
    executeMock.mockResolvedValue({ output: 'cc: command not found' })
    const wrapper = mount(MtcVerifyDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    })
    await wrapper.findAll('input')[0].setValue('a')
    await wrapper.findAll('input')[1].setValue('b')
    const button = wrapper.findAll('button').find((b) => b.text().includes('运行'))
    await button.trigger('click')
    await flushPromises()

    expect(wrapper.html()).toContain('验证命令未返回 JSON')
  })

  it('shows error message when ws.execute throws', async () => {
    executeMock.mockRejectedValue(new Error('connection refused'))
    const wrapper = mount(MtcVerifyDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    })
    await wrapper.findAll('input')[0].setValue('a')
    await wrapper.findAll('input')[1].setValue('b')
    const button = wrapper.findAll('button').find((b) => b.text().includes('运行'))
    await button.trigger('click')
    await flushPromises()

    expect(wrapper.html()).toContain('connection refused')
  })

  it('clears result on reopen (watch open)', async () => {
    executeMock.mockResolvedValue({
      output: JSON.stringify({ ok: false, code: 'X' }),
    })
    const wrapper = mount(MtcVerifyDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    })
    await wrapper.findAll('input')[0].setValue('a')
    await wrapper.findAll('input')[1].setValue('b')
    const button = wrapper.findAll('button').find((b) => b.text().includes('运行'))
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.html()).toContain('验证失败')

    await wrapper.setProps({ open: false })
    await nextTick()
    await wrapper.setProps({ open: true })
    await nextTick()
    expect(wrapper.html()).not.toContain('验证失败')
  })
})
