/**
 * AIChatWizard component — unit tests.
 *
 * usePersonalDataHub is mocked; ant components are stubbed to render slots +
 * translate clicks/inputs. Covers: step-1 health tags (healthOf/isRegistered/
 * healthReasonOf), stepDescription, the happy-path flow (pick → login → probe
 * → register → registered emit), and the probe/register error-reason mappings.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const hub = vi.hoisted(() => ({
  openAichatLogin: vi.fn(),
  probeAichatCookies: vi.fn(),
  registerAichatVendor: vi.fn(),
  unregisterAichat: vi.fn(),
}))
vi.mock('../../src/composables/usePersonalDataHub.js', () => ({
  usePersonalDataHub: () => hub,
}))

import AIChatWizard from '../../src/components/AIChatWizard.vue'

const slot = (cls) => ({ template: `<div class="${cls}"><slot /></div>` })
const stubs = {
  'a-drawer': {
    props: ['open'],
    emits: ['update:open', 'close'],
    template: '<div class="drawer" v-if="open"><slot /><div class="footer"><slot name="footer" /></div></div>',
  },
  'a-alert': {
    props: ['message', 'description'],
    template: '<div class="alert"><span class="amsg">{{ message }}</span><span class="adesc">{{ description }}</span></div>',
  },
  'a-row': slot('row'),
  'a-col': slot('col'),
  'a-card': { template: '<div class="card" @click="$emit(\'click\')"><slot /></div>' },
  'a-tag': { template: '<span class="atag"><slot /></span>' },
  'a-collapse': slot('coll'),
  'a-collapse-panel': slot('collp'),
  'a-form': slot('form'),
  'a-form-item': slot('fitem'),
  'a-textarea': {
    props: ['value'],
    emits: ['update:value'],
    template: '<textarea class="cookie" :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
  },
  'a-result': {
    props: ['title', 'subTitle', 'status'],
    template: '<div class="result" :data-status="status"><div class="rtitle">{{ title }}</div><div class="rsub">{{ subTitle }}</div><slot name="extra" /></div>',
  },
  'a-button': {
    props: ['disabled', 'loading'],
    template: '<button class="abtn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  'a-space': slot('space'),
  'a-popconfirm': { emits: ['confirm'], template: '<span class="popc"><slot /><button class="popc-ok" @click="$emit(\'confirm\')" /></span>' },
}

function render(props = {}) {
  return mount(AIChatWizard, { props: { open: true, existingAccounts: [], ...props }, global: { stubs } })
}

const btn = (w, text) => w.findAll('.abtn').find((b) => b.text().includes(text))
const card = (w, name) => w.findAll('.card').find((c) => c.text().includes(name))

beforeEach(() => {
  hub.openAichatLogin.mockReset()
  hub.probeAichatCookies.mockReset()
  hub.registerAichatVendor.mockReset()
  hub.unregisterAichat.mockReset()
})

describe('AIChatWizard — step 1 display', () => {
  it('describes step 1', () => {
    expect(render().find('.adesc').text()).toContain('选择一家 AI 服务商')
  })

  it('maps account health to a vendor tag + reason', () => {
    const w = render({
      existingAccounts: [
        { vendor: 'deepseek', lastHealth: { ok: true } },
        { vendor: 'kimi', lastHealth: { ok: false, reason: 'COOKIE_EXPIRED' } },
        { vendor: 'tongyi' }, // registered, no health pass yet
      ],
    })
    expect(card(w, 'DeepSeek').text()).toContain('✓ 已接入')
    expect(card(w, 'Kimi').text()).toContain('🔴 重新登录')
    expect(card(w, 'Kimi').text()).toContain('Cookie 已过期')
    expect(card(w, '通义千问').text()).toContain('已接入·待巡检')
  })

  it('shows the unregister control only for registered vendors', () => {
    const w = render({ existingAccounts: [{ vendor: 'kimi', lastHealth: { ok: true } }] })
    expect(card(w, 'Kimi').text()).toContain('注销')
    expect(card(w, 'DeepSeek').text()).not.toContain('注销')
  })
})

describe('AIChatWizard — happy path flow', () => {
  it('pick → 下一步 → 检测 → 注册 emits registered', async () => {
    hub.openAichatLogin.mockResolvedValue({ ok: true, fallbackMode: 'paste', loginUrl: 'http://x' })
    hub.probeAichatCookies.mockResolvedValue({
      ok: true,
      foundRequired: ['userToken'],
      foundOptional: [],
      cookies: [{ name: 'userToken', value: 'v' }],
    })
    hub.registerAichatVendor.mockResolvedValue({ ok: true, accountId: 'acc1' })

    const w = render()
    await card(w, 'DeepSeek').trigger('click')
    await btn(w, '下一步').trigger('click')
    await flushPromises()
    expect(hub.openAichatLogin).toHaveBeenCalledWith('deepseek')

    await w.find('.cookie').setValue('userToken=v')
    await btn(w, '检测 cookie').trigger('click')
    await flushPromises()
    expect(hub.probeAichatCookies).toHaveBeenCalledWith('deepseek', 'userToken=v')

    await btn(w, '注册').trigger('click')
    await flushPromises()
    expect(hub.registerAichatVendor).toHaveBeenCalledWith('deepseek', [
      { name: 'userToken', value: 'v' },
    ])
    expect(w.emitted('registered')?.at(-1)).toEqual([
      { vendor: 'deepseek', accountId: 'acc1' },
    ])
    expect(w.find('.result[data-status="success"]').exists()).toBe(true)
  })
})

describe('AIChatWizard — error mappings', () => {
  async function toStep2(w) {
    hub.openAichatLogin.mockResolvedValue({ ok: true, fallbackMode: 'paste', loginUrl: 'http://x' })
    await card(w, 'DeepSeek').trigger('click')
    await btn(w, '下一步').trigger('click')
    await flushPromises()
    await w.find('.cookie').setValue('x=1')
  }

  it('maps a probe failure reason to a message', async () => {
    const w = render()
    await toStep2(w)
    hub.probeAichatCookies.mockResolvedValue({ ok: false, reason: 'PASTE_REQUIRED' })
    await btn(w, '检测 cookie').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('请先粘贴 cookie')
  })

  it('maps a register failure reason to a message on step 3', async () => {
    const w = render()
    await toStep2(w)
    hub.probeAichatCookies.mockResolvedValue({ ok: true, foundRequired: ['userToken'], foundOptional: [], cookies: [] })
    await btn(w, '检测 cookie').trigger('click')
    await flushPromises()
    hub.registerAichatVendor.mockResolvedValue({ ok: false, reason: 'VALIDATE_COOKIE_FAILED' })
    await btn(w, '注册').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('厂商拒绝该 cookie')
  })
})
