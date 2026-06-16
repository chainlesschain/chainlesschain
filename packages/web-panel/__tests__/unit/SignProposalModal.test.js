/**
 * SignProposalModal (view) — unit tests.
 *
 * ws store + shell mode + ant message mocked. Covers the multisig signing
 * logic: hash/payload display, pending-member derivation + auto-pick, canSign
 * gating (hex regex), the embedded sendRaw vs non-embedded executeJson sign
 * call, and accepted / rejected / throw outcomes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const h = vi.hoisted(() => ({
  sendRaw: vi.fn(),
  executeJson: vi.fn(),
  message: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw: h.sendRaw, executeJson: h.executeJson }),
}))
vi.mock('ant-design-vue', () => ({ message: h.message }))

import SignProposalModal from '../../src/views/SignProposalModal.vue'

const A_DID = 'did:key:' + 'a'.repeat(40)
const B_DID = 'did:key:' + 'b'.repeat(40)

function makeProposal() {
  return {
    proposal: {
      id: 'prop1',
      domain: 'treasury',
      thresholdM: 2,
      memberSet: [
        { did: A_DID, alg: 'Ed25519' },
        { did: B_DID, alg: 'SLH-DSA' },
      ],
      payloadHash: 'AABBCCDD' + 'x'.repeat(50) + 'EEFF',
      payload: { foo: 'bar' },
    },
    signatures: [{ signerDid: A_DID }], // member A already signed → B pending
  }
}

const KeyRadio = { name: 'KeyRadioStub', props: ['value'], emits: ['update:value'], template: '<div class="krg"><slot /></div>' }
const slot = (c) => ({ template: `<div class="${c}"><slot /></div>` })
const stubs = {
  'a-modal': { props: ['open'], emits: ['update:open'], template: '<div class="modal" v-if="open"><slot /><div class="footer"><slot name="footer" /></div></div>' },
  'a-descriptions': slot('desc'),
  'a-descriptions-item': slot('ditem'),
  'a-tag': { template: '<span><slot /></span>' },
  'a-divider': { template: '<hr />' },
  'a-select': { props: ['value'], emits: ['update:value'], template: '<select class="signer"><slot /></select>' },
  'a-select-option': { template: '<option><slot /></option>' },
  'a-typography-text': slot('typo'),
  'a-radio-group': KeyRadio,
  'a-radio': { props: ['value'], template: '<label><slot /></label>' },
  'a-input-password': { props: ['value'], emits: ['update:value'], template: '<input class="hex" :value="value" @input="$emit(\'update:value\', $event.target.value)" />' },
  'a-alert': { props: ['message', 'description'], template: '<div class="alert">{{ message }} {{ description }}</div>' },
  'a-button': { props: ['disabled', 'loading'], template: '<button class="abtn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
}

const signBtn = (w) => w.findAll('.abtn').find((b) => b.text().includes('立即签名'))
const cancelBtn = (w) => w.findAll('.abtn').find((b) => b.text().includes('取消'))

async function openWith(embedded = true, proposal = makeProposal()) {
  globalThis.window = globalThis.window || globalThis
  globalThis.window.__CC_CONFIG__ = embedded ? { embeddedShell: true } : {}
  const w = mount(SignProposalModal, { props: { open: true, proposal: null }, global: { stubs } })
  await w.setProps({ proposal }) // triggers pendingMembers watch → auto-pick B
  await flushPromises()
  return w
}

beforeEach(() => {
  h.sendRaw.mockReset()
  h.executeJson.mockReset()
  h.message.success.mockReset()
  h.message.error.mockReset()
})

describe('SignProposalModal — display', () => {
  it('shortens the payload hash (head 8 + tail 4)', async () => {
    const w = await openWith()
    expect(w.find('.hash-short').text()).toBe('AABBCCDD…EEFF')
  })

  it('pretty-prints the payload JSON', async () => {
    const w = await openWith()
    expect(w.find('pre').text()).toContain('"foo": "bar"')
  })

  it('shows signed/threshold count and the U-Key risk note', async () => {
    const w = await openWith()
    expect(w.text()).toContain('1 / 2')
    expect(w.find('.alert').text()).toContain('U-Key 硬件')
  })
})

describe('SignProposalModal — canSign gating', () => {
  it('enables signing with an auto-picked DID + ukey source', async () => {
    const w = await openWith()
    expect(signBtn(w).attributes('disabled')).toBeUndefined()
  })

  it('requires valid hex when the source is hex', async () => {
    const w = await openWith()
    await w.findComponent(KeyRadio).vm.$emit('update:value', 'hex')
    await flushPromises()
    expect(signBtn(w).attributes('disabled')).toBeDefined() // empty hex
    await w.find('.hex').setValue('not-hex!')
    expect(signBtn(w).attributes('disabled')).toBeDefined()
    await w.find('.hex').setValue('deadbeef')
    expect(signBtn(w).attributes('disabled')).toBeUndefined()
  })
})

describe('SignProposalModal — sign flow', () => {
  it('embedded: sends multisig.sign and emits signed on accept', async () => {
    h.sendRaw.mockResolvedValue({ ok: true, result: { accepted: true, reachedThreshold: true } })
    const w = await openWith(true)
    await signBtn(w).trigger('click')
    await flushPromises()
    expect(h.sendRaw).toHaveBeenCalledWith(
      { type: 'multisig.sign', proposalId: 'prop1', signerDid: B_DID, alg: 'SLH-DSA', source: 'ukey', params: {} },
      20000,
    )
    expect(h.message.success).toHaveBeenCalled()
    expect(w.emitted('signed')?.[0]?.[0]).toMatchObject({ accepted: true })
    expect(w.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('reports a rejected signature without emitting signed', async () => {
    h.sendRaw.mockResolvedValue({ ok: true, result: { accepted: false, reason: 'THRESHOLD_NOT_MET' } })
    const w = await openWith(true)
    await signBtn(w).trigger('click')
    await flushPromises()
    expect(h.message.error).toHaveBeenCalledWith(expect.stringContaining('THRESHOLD_NOT_MET'))
    expect(w.emitted('signed')).toBeFalsy()
  })

  it('surfaces a transport failure (sendRaw ok:false) as an error', async () => {
    h.sendRaw.mockResolvedValue({ ok: false, error: 'boom' })
    const w = await openWith(true)
    await signBtn(w).trigger('click')
    await flushPromises()
    expect(h.message.error).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })

  it('non-embedded: signs via executeJson fallback command', async () => {
    h.executeJson.mockResolvedValue({ accepted: true })
    const w = await openWith(false)
    await signBtn(w).trigger('click')
    await flushPromises()
    expect(h.executeJson).toHaveBeenCalledWith(
      `multisig sign prop1 --signer ${B_DID} --json`,
      20000,
    )
    expect(h.sendRaw).not.toHaveBeenCalled()
  })
})

describe('SignProposalModal — cancel', () => {
  it('cancel emits update:open false', async () => {
    const w = await openWith()
    await cancelBtn(w).trigger('click')
    expect(w.emitted('update:open')?.at(-1)).toEqual([false])
  })
})
