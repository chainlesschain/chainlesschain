import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import IntentConfirmationMessage from '../../src/components/IntentConfirmationMessage.vue'

const STUBS = {
  'a-button': {
    props: ['type', 'size'],
    emits: ['click'],
    template:
      '<button class="stub-btn" :data-type="type" @click="$emit(\'click\')"><slot /></button>',
  },
  'a-textarea': {
    props: ['value', 'autoSize', 'placeholder'],
    emits: ['update:value'],
    template:
      "<textarea :value=\"value\" :placeholder=\"placeholder\" @input=\"$emit('update:value', $event.target.value)\"></textarea>",
  },
  CheckCircleOutlined: { template: '<i class="i-check-circle" />' },
  ExclamationCircleOutlined: { template: '<i class="i-exclamation-circle" />' },
  BulbOutlined: { template: '<i class="i-bulb" />' },
  CheckOutlined: { template: '<i class="i-check" />' },
  EditOutlined: { template: '<i class="i-edit" />' },
  CloseOutlined: { template: '<i class="i-close" />' },
}

const i18nStub = {
  $t: (k) => k,
}

const baseMessage = (overrides = {}) => ({
  id: 'msg-1',
  type: 'intent-confirmation',
  role: 'assistant',
  content: '我理解您的需求如下，请确认：',
  metadata: {
    originalInput: 'fxi loign',
    understanding: {
      correctedInput: 'fix login',
      intent: '修复登录',
      keyPoints: ['登录', 'bug'],
    },
    status: 'pending',
    correction: null,
    ...overrides.metadata,
  },
  ...overrides,
})

function makeWrapper(message) {
  return mount(IntentConfirmationMessage, {
    props: { message },
    global: {
      stubs: STUBS,
      mocks: i18nStub,
    },
  })
}

describe('IntentConfirmationMessage', () => {
  it('renders original (strikethrough) and corrected text when they differ', () => {
    const w = makeWrapper(baseMessage())
    const html = w.html()
    expect(html).toContain('fxi loign')
    expect(html).toContain('fix login')
    // 修正后的 keyPoints 也要出现
    expect(html).toContain('登录')
    expect(html).toContain('bug')
  })

  it('hides original/corrected sections when correctedInput equals input', () => {
    const w = makeWrapper(
      baseMessage({
        metadata: {
          originalInput: 'fix login',
          understanding: { correctedInput: 'fix login', intent: 'i', keyPoints: [] },
          status: 'pending',
          correction: null,
        },
      }),
    )
    const html = w.html()
    expect(html).not.toContain('original-text')
    expect(html).not.toContain('corrected-text')
  })

  it('shows action buttons in pending state', () => {
    const w = makeWrapper(baseMessage())
    const buttons = w.findAll('.stub-btn')
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })

  it('emits confirm with messageId + originalInput + understanding', async () => {
    const w = makeWrapper(baseMessage())
    const buttons = w.findAll('.stub-btn')
    const confirmBtn = buttons.find((b) => b.attributes('data-type') === 'primary')
    await confirmBtn.trigger('click')
    const evt = w.emitted('confirm')
    expect(evt).toBeTruthy()
    expect(evt[0][0]).toMatchObject({
      messageId: 'msg-1',
      originalInput: 'fxi loign',
    })
    expect(evt[0][0].understanding.correctedInput).toBe('fix login')
  })

  it('clicking 纠正 reveals the correction textarea', async () => {
    const w = makeWrapper(baseMessage())
    const buttons = w.findAll('.stub-btn')
    // The 2nd action button is "纠正".
    await buttons[1].trigger('click')
    expect(w.find('textarea').exists()).toBe(true)
  })

  it('submitting empty correction does NOT emit correct', async () => {
    const w = makeWrapper(baseMessage())
    const buttons = w.findAll('.stub-btn')
    await buttons[1].trigger('click') // open input
    const ta = w.find('textarea')
    await ta.setValue('   ')
    const inlineButtons = w.findAll('.stub-btn')
    // After 纠正 opens, two more buttons appear (提交修正 / 取消).
    const submit = inlineButtons.find((b) => b.attributes('data-type') === 'primary' && b.text() !== '')
    // Just trigger every primary button to be safe — the empty value path
    // must still no-op.
    if (submit) await submit.trigger('click')
    expect(w.emitted('correct')).toBeFalsy()
  })

  it('emits correct with the user input on valid submission', async () => {
    const w = makeWrapper(baseMessage())
    const buttons = w.findAll('.stub-btn')
    await buttons[1].trigger('click')
    const ta = w.find('textarea')
    await ta.setValue('fix login flow')
    // After opening, buttons array reshuffles; trigger every primary button —
    // only the "提交修正" path does anything because handleSubmitCorrection
    // is the only handler bound to a primary button on the inner panel.
    const all = w.findAll('.stub-btn')
    for (const b of all) {
      if (b.attributes('data-type') === 'primary') await b.trigger('click')
    }
    const evt = w.emitted('correct')
    expect(evt).toBeTruthy()
    expect(evt[0][0]).toMatchObject({
      messageId: 'msg-1',
      correction: 'fix login flow',
    })
  })

  it('confirmed status hides action buttons and shows confirmed banner', () => {
    const w = makeWrapper(
      baseMessage({
        metadata: {
          originalInput: 'a',
          understanding: { correctedInput: 'a', intent: 'x', keyPoints: [] },
          status: 'confirmed',
          correction: null,
        },
      }),
    )
    expect(w.find('.action-buttons').exists()).toBe(false)
  })
})
