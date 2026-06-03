/**
 * Mtc.vue — federation governance operational actions (v0.9 + v0.10).
 *
 * Asserts the "操作型治理" tab (which only renders after a governance.log
 * load succeeds) correctly:
 *  - v0.9: Invite / vote / propose-threshold / confirm-threshold / propose-revoke
 *    / confirm-revoke / governance-publish / governance-pull /
 *    governance-sync-once each shell out to ws.execute with the right
 *    `mtc federation ...` command shape (federation id quoted, --json appended).
 *  - v0.9: Validation messages fire when required fields are missing.
 *  - v0.9: shellSafe() strips backticks and dollar signs from user input.
 *  - v0.9: runGovAction() falls back to multi-line JSON parsing when the CLI
 *    interleaves info logs with the JSON payload.
 *  - v0.9: lastActionResult is rendered in the result card.
 *  - v0.10: pendingThresholdsList exposes pending_thresholds[] (multi-proposal
 *    CRDT) with back-compat fallback to pending_threshold.
 *  - v0.10: runConfirmThresholdById passes --proposal-event-id "<id>" so a
 *    specific proposal among concurrent ones can be confirmed.
 *  - v0.10: loadGovernanceLog chains into loadGovSyncStats which calls
 *    `mtc federation governance-sync-stats <fed> --json` and stores the
 *    decoded payload in govSyncStats (or null when daemon is absent).
 *
 * Mounting strategy mirrors Projects-folder-picker.test.js: real vue-i18n
 * with seed messages, useWsStore stubbed, and a-* components stubbed for
 * deterministic DOM. No backend or CLI is invoked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { messages, FALLBACK } from '@chainlesschain/locales'
import Mtc from '../../src/views/Mtc.vue'
import { useWsStore } from '../../src/stores/ws.js'

const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: FALLBACK,
  fallbackLocale: FALLBACK,
  messages,
})

const STUBS = {
  'a-row': { template: '<div><slot /></div>' },
  'a-col': { template: '<div><slot /></div>' },
  'a-card': {
    props: ['title', 'size'],
    template:
      '<div class="stub-card"><slot name="title" /><slot name="extra" /><slot /></div>',
  },
  'a-statistic': {
    props: ['title', 'value', 'valueStyle'],
    template:
      '<div class="stub-statistic"><span>{{ title }}</span>:<span>{{ value }}</span><slot name="prefix" /><slot name="suffix" /></div>',
  },
  'a-button': {
    props: ['type', 'loading', 'disabled', 'size'],
    emits: ['click'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot name="icon" /><slot /></button>',
  },
  'a-input': {
    props: ['value', 'placeholder', 'allowClear'],
    emits: ['update:value'],
    template:
      "<input :value=\"value\" :placeholder=\"placeholder\" @input=\"$emit('update:value', $event.target.value)\" />",
  },
  'a-input-number': {
    props: ['value', 'min'],
    emits: ['update:value'],
    template:
      "<input type=\"number\" :value=\"value\" @input=\"$emit('update:value', Number($event.target.value))\" />",
  },
  'a-select': {
    props: ['value'],
    emits: ['update:value'],
    template:
      "<select :value=\"value\" @change=\"$emit('update:value', $event.target.value)\"><slot /></select>",
  },
  'a-select-option': {
    props: ['value'],
    template: '<option :value="value"><slot /></option>',
  },
  'a-checkbox': {
    props: ['checked'],
    emits: ['update:checked'],
    template:
      "<input type=\"checkbox\" :checked=\"checked\" @change=\"$emit('update:checked', $event.target.checked)\" />",
  },
  'a-form': { template: '<form><slot /></form>', emits: ['submit'] },
  'a-form-item': {
    props: ['label'],
    template: '<div class="stub-form-item"><label>{{ label }}</label><slot /></div>',
  },
  'a-tag': {
    props: ['color'],
    template: '<span class="stub-tag" :data-color="color"><slot /></span>',
  },
  'a-tabs': {
    props: ['activeKey', 'size'],
    emits: ['update:activeKey'],
    template: '<div class="stub-tabs"><slot /></div>',
  },
  'a-tab-pane': {
    // `key` is a Vue reserved attribute and must not be declared as a prop.
    props: ['tab'],
    template: '<div class="stub-tab-pane"><slot /></div>',
  },
  'a-table': {
    props: ['dataSource', 'columns', 'pagination', 'rowKey', 'size'],
    template:
      '<div class="stub-table"><div v-for="row in dataSource" :key="row[rowKey]" class="stub-row">{{ JSON.stringify(row) }}</div></div>',
  },
  'a-list': {
    props: ['dataSource', 'size'],
    template:
      '<div class="stub-list"><template v-for="(item, i) in dataSource" :key="i"><slot name="renderItem" :item="item" /></template></div>',
  },
  'a-list-item': { template: '<div class="stub-list-item"><slot /></div>' },
  'a-timeline': { template: '<div class="stub-timeline"><slot /></div>' },
  'a-timeline-item': { template: '<div class="stub-timeline-item"><slot /></div>' },
  'a-descriptions': { props: ['column', 'size'], template: '<dl><slot /></dl>' },
  'a-descriptions-item': {
    props: ['label', 'span'],
    template: '<div><dt>{{ label }}</dt><dd><slot /></dd></div>',
  },
  'a-empty': { props: ['description'], template: '<div class="stub-empty">{{ description }}</div>' },
  'a-alert': {
    props: ['type', 'message', 'description', 'showIcon'],
    template:
      '<div class="stub-alert" :data-type="type"><strong>{{ message }}</strong><div>{{ description }}</div><slot name="description" /></div>',
  },
  'a-space': { template: '<div class="stub-space"><slot /></div>' },
  ReloadOutlined: { template: '<span class="i-reload" />' },
  ClockCircleOutlined: { template: '<span class="i-clock" />' },
  CheckCircleOutlined: { template: '<span class="i-check" />' },
  InfoCircleOutlined: { template: '<span class="i-info" />' },
  InboxOutlined: { template: '<span class="i-inbox" />' },
  DatabaseOutlined: { template: '<span class="i-db" />' },
  NumberOutlined: { template: '<span class="i-number" />' },
  HistoryOutlined: { template: '<span class="i-history" />' },
  SafetyOutlined: { template: '<span class="i-safety" />' },
}

// Minimal but realistic governance-log JSON the CLI returns for a
// hypothetical 2-of-3 federation with one pending invite — this is what
// loadGovernanceLog parses to make the operational tab visible.
const FED_ID = 'fed-test'
const GOVERNANCE_LOG_JSON = JSON.stringify({
  federation_id: FED_ID,
  state: {
    status: 'steady',
    threshold: 2,
    members: [
      { member_id: 'alice', status: 'active', weight: 1, alg: 'ed25519' },
      { member_id: 'bob', status: 'active', weight: 1, alg: 'ed25519' },
    ],
    pending_invites: [
      { member_id: 'carol', votes: { approve: ['alice'], reject: [] }, required: 2 },
    ],
  },
  events: [
    { event_id: 'ev1', event_type: 'create', actor_member_id: 'alice', issued_at: '2026-05-02T00:00:00Z' },
    { event_id: 'ev2', event_type: 'invite', actor_member_id: 'alice', issued_at: '2026-05-02T00:01:00Z' },
  ],
})

function findButtonByText(wrapper, text) {
  return wrapper.findAll('button').find((b) => b.text().trim() === text || b.text().includes(text))
}

async function mountAndLoadGovernance(executeMock) {
  // First call (onMounted): audit mtc status — return empty/disabled config.
  // Second call (onMounted): crosschain mtc-status — return empty bridge cfg.
  // Third call (loadGovernanceLog): mtc federation governance-log — real payload.
  executeMock.mockImplementation(async (cmd) => {
    if (cmd.startsWith('audit mtc status')) return { output: '{}' }
    if (cmd.startsWith('crosschain mtc-status')) return { output: '{"config":{"enabled":false,"mode":"independent","alg":"ed25519","batch_interval_seconds":60,"issuer":""},"trust_anchors":{"chain_count":0,"total":0,"by_chain":{}},"staging":{"pending":0},"batches":{"total":0,"latest":null}}' }
    if (cmd.startsWith('mtc federation governance-log')) return { output: GOVERNANCE_LOG_JSON }
    return { output: '' }
  })

  const wrapper = mount(Mtc, { global: { stubs: STUBS, plugins: [i18n] } })
  await flushPromises()

  // Fill federation id + click "加载 governance.log"
  wrapper.vm.govFederationId = FED_ID
  await wrapper.vm.$nextTick()
  await wrapper.vm.loadGovernanceLog()
  await flushPromises()

  return wrapper
}

describe('Mtc.vue — federation governance operational actions (v0.9)', () => {
  let executeMock

  beforeEach(() => {
    setActivePinia(createPinia())
    const ws = useWsStore()
    executeMock = vi.fn()
    ws.execute = executeMock
  })

  it('loadGovernanceLog populates state.threshold + members + events', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    expect(wrapper.vm.govResult).toBeTruthy()
    expect(wrapper.vm.govResult.state.threshold).toBe(2)
    expect(wrapper.vm.govResult.state.members.length).toBe(2)
    expect(wrapper.vm.govResult.events.length).toBe(2)
  })

  it('loadGovernanceLog tolerates info-log noise before JSON', async () => {
    executeMock.mockImplementation(async (cmd) => {
      if (cmd.startsWith('audit mtc status')) return { output: '{}' }
      if (cmd.startsWith('crosschain mtc-status'))
        return { output: '{"config":{"enabled":false},"trust_anchors":{},"staging":{},"batches":{}}' }
      if (cmd.startsWith('mtc federation governance-log'))
        return { output: `[INFO] reading log\nstarting...\n${GOVERNANCE_LOG_JSON}\n[INFO] done` }
      return { output: '' }
    })
    const wrapper = mount(Mtc, { global: { stubs: STUBS, plugins: [i18n] } })
    await flushPromises()
    wrapper.vm.govFederationId = FED_ID
    await wrapper.vm.loadGovernanceLog()
    await flushPromises()
    expect(wrapper.vm.govResult.state.threshold).toBe(2)
  })

  it('loadBridgeStatus fills in missing schema fields (defensive merge)', async () => {
    // CLI returns a partial bridge response — staging/batches/trust_anchors
    // missing; loadBridgeStatus must still produce a fully-shaped object so
    // the template doesn't TypeError on bridgeStatus.staging.pending.
    executeMock.mockImplementation(async (cmd) => {
      if (cmd.startsWith('audit mtc status')) return { output: '{}' }
      if (cmd.startsWith('crosschain mtc-status'))
        return { output: '{"config":{"enabled":true,"mode":"federated"}}' }
      return { output: '' }
    })
    const wrapper = mount(Mtc, { global: { stubs: STUBS, plugins: [i18n] } })
    await flushPromises()
    expect(wrapper.vm.bridgeStatus.config.enabled).toBe(true)
    expect(wrapper.vm.bridgeStatus.config.mode).toBe('federated')
    expect(wrapper.vm.bridgeStatus.staging.pending).toBe(0)
    expect(wrapper.vm.bridgeStatus.batches.total).toBe(0)
    expect(wrapper.vm.bridgeStatus.trust_anchors.total).toBe(0)
    expect(wrapper.vm.bridgeStatus.trust_anchors.by_chain).toEqual({})
  })

  it('runInvite shells out to `mtc federation invite "<fed>" "<candidate>" --actor "<a>" --candidate-pubkey-id "<id>" --json`', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    wrapper.vm.inviteForm.actor = 'alice'
    wrapper.vm.inviteForm.candidate = 'carol'
    wrapper.vm.inviteForm.pubkeyId = 'sha256:abc123'
    await wrapper.vm.runInvite()
    await flushPromises()
    const inviteCall = executeMock.mock.calls.find((c) => c[0].includes('federation invite'))
    expect(inviteCall).toBeTruthy()
    expect(inviteCall[0]).toBe(
      `mtc federation invite "${FED_ID}" "carol" --actor "alice" --candidate-pubkey-id "sha256:abc123" --json`,
    )
  })

  it('runInvite skips ws.execute when required fields are blank', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    const beforeCount = executeMock.mock.calls.length
    wrapper.vm.inviteForm.actor = 'alice' // candidate + pubkeyId still empty
    await wrapper.vm.runInvite()
    await flushPromises()
    const afterCount = executeMock.mock.calls.length
    expect(afterCount).toBe(beforeCount)
  })

  it('runVote shells out to `... vote "<fed>" "<candidate>" --actor "<a>" --decision <approve|reject> --json`', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    wrapper.vm.voteForm.actor = 'bob'
    wrapper.vm.voteForm.candidate = 'carol'
    wrapper.vm.voteForm.decision = 'approve'
    await wrapper.vm.runVote()
    await flushPromises()
    const call = executeMock.mock.calls.find((c) => c[0].includes('federation vote'))
    expect(call[0]).toBe(
      `mtc federation vote "${FED_ID}" "carol" --actor "bob" --decision approve --json`,
    )
  })

  it('runProposeThreshold + runConfirmThreshold pair (quorum gating, v0.9)', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    wrapper.vm.thresholdForm.actor = 'alice'
    wrapper.vm.thresholdForm.newM = 3
    await wrapper.vm.runProposeThreshold()
    await flushPromises()
    await wrapper.vm.runConfirmThreshold()
    await flushPromises()
    const proposeCall = executeMock.mock.calls.find((c) => c[0].includes('propose-threshold'))
    const confirmCall = executeMock.mock.calls.find((c) => c[0].includes('confirm-threshold'))
    expect(proposeCall[0]).toBe(`mtc federation propose-threshold "${FED_ID}" 3 --actor "alice" --json`)
    expect(confirmCall[0]).toBe(`mtc federation confirm-threshold "${FED_ID}" --actor "alice" --json`)
  })

  it('runProposeRevoke + runConfirmRevoke pair (quorum gating, v0.9)', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    wrapper.vm.revokeForm.actor = 'alice'
    wrapper.vm.revokeForm.target = 'bob'
    wrapper.vm.revokeForm.reason = 'inactive'
    await wrapper.vm.runProposeRevoke()
    await flushPromises()
    await wrapper.vm.runConfirmRevoke()
    await flushPromises()
    const proposeCall = executeMock.mock.calls.find((c) => c[0].includes('propose-revoke'))
    const confirmCall = executeMock.mock.calls.find((c) => c[0].includes('confirm-revoke'))
    expect(proposeCall[0]).toBe(
      `mtc federation propose-revoke "${FED_ID}" "bob" --actor "alice" --reason "inactive" --json`,
    )
    expect(confirmCall[0]).toBe(
      `mtc federation confirm-revoke "${FED_ID}" "bob" --actor "alice" --json`,
    )
  })

  it('runGovPublish shells out to governance-publish without --verify', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    wrapper.vm.syncForm.dropZone = '/shared/zone'
    wrapper.vm.syncForm.verify = false
    await wrapper.vm.runGovPublish()
    await flushPromises()
    const call = executeMock.mock.calls.find((c) => c[0].includes('governance-publish'))
    expect(call[0]).toBe(
      `mtc federation governance-publish "${FED_ID}" --drop-zone "/shared/zone" --json`,
    )
  })

  it('runGovPull appends --verify when checkbox is on', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    wrapper.vm.syncForm.dropZone = '/shared/zone'
    wrapper.vm.syncForm.verify = true
    await wrapper.vm.runGovPull()
    await flushPromises()
    const call = executeMock.mock.calls.find((c) => c[0].includes('governance-pull'))
    expect(call[0]).toBe(
      `mtc federation governance-pull "${FED_ID}" --drop-zone "/shared/zone" --verify --json`,
    )
  })

  it('runGovSyncOnce shells out to governance-sync-serve --once', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    wrapper.vm.syncForm.dropZone = '/shared/zone'
    wrapper.vm.syncForm.verify = false
    await wrapper.vm.runGovSyncOnce()
    await flushPromises()
    const call = executeMock.mock.calls.find((c) => c[0].includes('governance-sync-serve'))
    expect(call[0]).toBe(
      `mtc federation governance-sync-serve "${FED_ID}" --drop-zone "/shared/zone" --once --json`,
    )
  })

  it('runGovPublish refuses to fire without a drop-zone', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    const beforeCount = executeMock.mock.calls.length
    wrapper.vm.syncForm.dropZone = ''
    await wrapper.vm.runGovPublish()
    await flushPromises()
    expect(executeMock.mock.calls.length).toBe(beforeCount)
  })

  it('shellSafe strips backticks and dollar signs from user input', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    wrapper.vm.inviteForm.actor = 'a`lice'
    wrapper.vm.inviteForm.candidate = '$evil'
    wrapper.vm.inviteForm.pubkeyId = 'k1`$rm'
    await wrapper.vm.runInvite()
    await flushPromises()
    const call = executeMock.mock.calls.find((c) => c[0].includes('federation invite'))
    expect(call[0]).not.toContain('`')
    expect(call[0]).not.toContain('$')
    // Survives field separation: actor=alice, candidate=evil, pubkey=k1rm
    expect(call[0]).toContain('"alice"')
    expect(call[0]).toContain('"evil"')
    expect(call[0]).toContain('"k1rm"')
  })

  it('runGovAction stores parsed JSON result in lastActionResult', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    // Override execute so the next governance call returns a specific event payload
    executeMock.mockImplementationOnce(async () => ({
      output: '{"event_id":"ev3","event_type":"invite","ok":true}',
    }))
    wrapper.vm.inviteForm.actor = 'alice'
    wrapper.vm.inviteForm.candidate = 'carol'
    wrapper.vm.inviteForm.pubkeyId = 'sha256:k'
    await wrapper.vm.runInvite()
    await flushPromises()
    expect(wrapper.vm.lastActionResult).toBeTruthy()
    expect(wrapper.vm.lastActionResult.event_id).toBe('ev3')
  })

  it('runGovAction surfaces error shape when ws.execute throws', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    executeMock.mockRejectedValueOnce(new Error('cli not found'))
    wrapper.vm.inviteForm.actor = 'alice'
    wrapper.vm.inviteForm.candidate = 'carol'
    wrapper.vm.inviteForm.pubkeyId = 'sha256:k'
    await wrapper.vm.runInvite()
    await flushPromises()
    expect(wrapper.vm.lastActionResult).toBeTruthy()
    expect(wrapper.vm.lastActionResult.error).toContain('cli not found')
  })

  // ───────────────────────── v0.10 ─────────────────────────

  it('pendingThresholdsList prefers pending_thresholds[] (v0.10 multi-proposal CRDT)', async () => {
    const payload = JSON.stringify({
      federation_id: FED_ID,
      state: {
        status: 'steady',
        threshold: 2,
        members: [{ member_id: 'alice', status: 'active', weight: 1, alg: 'ed25519' }],
        pending_thresholds: [
          { target: 3, event_id: 'ev-prop-a', proposer: 'alice', proposed_at: '2026-05-02T00:00:00Z' },
          { target: 4, event_id: 'ev-prop-b', proposer: 'bob', proposed_at: '2026-05-02T00:01:00Z' },
        ],
        pending_threshold: { target: 4, event_id: 'ev-prop-b', proposer: 'bob' },
      },
      events: [],
    })
    executeMock.mockImplementation(async (cmd) => {
      if (cmd.startsWith('audit mtc status')) return { output: '{}' }
      if (cmd.startsWith('crosschain mtc-status')) return { output: '{"config":{"enabled":false}}' }
      if (cmd.startsWith('mtc federation governance-log')) return { output: payload }
      if (cmd.startsWith('mtc federation governance-sync-stats')) return { output: '{"available":false}' }
      return { output: '' }
    })
    const wrapper = mount(Mtc, { global: { stubs: STUBS, plugins: [i18n] } })
    await flushPromises()
    wrapper.vm.govFederationId = FED_ID
    await wrapper.vm.loadGovernanceLog()
    await flushPromises()
    expect(wrapper.vm.pendingThresholdsList.length).toBe(2)
    expect(wrapper.vm.pendingThresholdsList[0].target).toBe(3)
    expect(wrapper.vm.pendingThresholdsList[1].target).toBe(4)
  })

  it('pendingThresholdsList falls back to pending_threshold (single) when pending_thresholds[] absent', async () => {
    const payload = JSON.stringify({
      federation_id: FED_ID,
      state: {
        status: 'steady',
        threshold: 2,
        members: [{ member_id: 'alice', status: 'active', weight: 1, alg: 'ed25519' }],
        pending_threshold: { target: 5 }, // pre-v0.10 shape, no event_id
      },
      events: [],
    })
    executeMock.mockImplementation(async (cmd) => {
      if (cmd.startsWith('audit mtc status')) return { output: '{}' }
      if (cmd.startsWith('crosschain mtc-status')) return { output: '{"config":{"enabled":false}}' }
      if (cmd.startsWith('mtc federation governance-log')) return { output: payload }
      if (cmd.startsWith('mtc federation governance-sync-stats')) return { output: '{"available":false}' }
      return { output: '' }
    })
    const wrapper = mount(Mtc, { global: { stubs: STUBS, plugins: [i18n] } })
    await flushPromises()
    wrapper.vm.govFederationId = FED_ID
    await wrapper.vm.loadGovernanceLog()
    await flushPromises()
    expect(wrapper.vm.pendingThresholdsList.length).toBe(1)
    expect(wrapper.vm.pendingThresholdsList[0].target).toBe(5)
  })

  it('runConfirmThresholdById passes --proposal-event-id "<id>" to confirm a specific proposal', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    wrapper.vm.thresholdForm.actor = 'alice'
    await wrapper.vm.runConfirmThresholdById('ev-prop-a')
    await flushPromises()
    const call = executeMock.mock.calls.find(
      (c) => c[0].includes('confirm-threshold') && c[0].includes('--proposal-event-id'),
    )
    expect(call).toBeTruthy()
    expect(call[0]).toBe(
      `mtc federation confirm-threshold "${FED_ID}" --actor "alice" --proposal-event-id "ev-prop-a" --json`,
    )
  })

  it('runConfirmThresholdById skips when actor or eventId blank', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    const before = executeMock.mock.calls.length
    // actor blank
    wrapper.vm.thresholdForm.actor = ''
    await wrapper.vm.runConfirmThresholdById('ev-x')
    // eventId blank
    wrapper.vm.thresholdForm.actor = 'alice'
    await wrapper.vm.runConfirmThresholdById('')
    await flushPromises()
    expect(executeMock.mock.calls.length).toBe(before)
  })

  it('runConfirmThresholdById sanitises shell metacharacters in eventId', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    wrapper.vm.thresholdForm.actor = 'alice'
    await wrapper.vm.runConfirmThresholdById('ev`$rm-evil')
    await flushPromises()
    const call = executeMock.mock.calls.find((c) => c[0].includes('--proposal-event-id'))
    expect(call).toBeTruthy()
    expect(call[0]).not.toContain('`')
    expect(call[0]).not.toContain('$')
    expect(call[0]).toContain('"evrm-evil"')
  })

  it('loadGovernanceLog chains into loadGovSyncStats — populates govSyncStats when daemon active', async () => {
    const govPayload = JSON.stringify({
      federation_id: FED_ID,
      state: {
        status: 'steady',
        threshold: 1,
        members: [{ member_id: 'alice', status: 'active', weight: 1, alg: 'ed25519' }],
      },
      events: [],
    })
    const statsPayload = JSON.stringify({
      fed_id: FED_ID,
      available: true,
      mode: 'filesystem',
      last_tick_at: '2026-05-02T12:00:00Z',
      publish: { last_published: 2, total_published: 17 },
      pull: { last_appended: 1, total_appended: 5 },
    })
    executeMock.mockImplementation(async (cmd) => {
      if (cmd.startsWith('audit mtc status')) return { output: '{}' }
      if (cmd.startsWith('crosschain mtc-status')) return { output: '{"config":{"enabled":false}}' }
      if (cmd.startsWith('mtc federation governance-log')) return { output: govPayload }
      if (cmd.startsWith('mtc federation governance-sync-stats')) return { output: statsPayload }
      return { output: '' }
    })
    const wrapper = mount(Mtc, { global: { stubs: STUBS, plugins: [i18n] } })
    await flushPromises()
    wrapper.vm.govFederationId = FED_ID
    await wrapper.vm.loadGovernanceLog()
    await flushPromises()
    const statsCall = executeMock.mock.calls.find((c) => c[0].includes('governance-sync-stats'))
    expect(statsCall).toBeTruthy()
    expect(statsCall[0]).toBe(`mtc federation governance-sync-stats "${FED_ID}" --json`)
    expect(wrapper.vm.govSyncStats).toBeTruthy()
    expect(wrapper.vm.govSyncStats.mode).toBe('filesystem')
    expect(wrapper.vm.govSyncStats.publish.total_published).toBe(17)
    expect(wrapper.vm.govSyncStats.pull.total_appended).toBe(5)
  })

  it('loadGovSyncStats stores null when CLI returns available=false (no daemon running)', async () => {
    const govPayload = JSON.stringify({
      federation_id: FED_ID,
      state: {
        status: 'steady',
        threshold: 1,
        members: [{ member_id: 'alice', status: 'active', weight: 1, alg: 'ed25519' }],
      },
      events: [],
    })
    executeMock.mockImplementation(async (cmd) => {
      if (cmd.startsWith('audit mtc status')) return { output: '{}' }
      if (cmd.startsWith('crosschain mtc-status')) return { output: '{"config":{"enabled":false}}' }
      if (cmd.startsWith('mtc federation governance-log')) return { output: govPayload }
      if (cmd.startsWith('mtc federation governance-sync-stats'))
        return { output: '{"fed_id":"' + FED_ID + '","available":false}' }
      return { output: '' }
    })
    const wrapper = mount(Mtc, { global: { stubs: STUBS, plugins: [i18n] } })
    await flushPromises()
    wrapper.vm.govFederationId = FED_ID
    await wrapper.vm.loadGovernanceLog()
    await flushPromises()
    expect(wrapper.vm.govSyncStats).toBeNull()
  })

  it('loadGovSyncStats swallows CLI throw — does not poison the governance load', async () => {
    const govPayload = JSON.stringify({
      federation_id: FED_ID,
      state: {
        status: 'steady',
        threshold: 1,
        members: [{ member_id: 'alice', status: 'active', weight: 1, alg: 'ed25519' }],
      },
      events: [],
    })
    executeMock.mockImplementation(async (cmd) => {
      if (cmd.startsWith('audit mtc status')) return { output: '{}' }
      if (cmd.startsWith('crosschain mtc-status')) return { output: '{"config":{"enabled":false}}' }
      if (cmd.startsWith('mtc federation governance-log')) return { output: govPayload }
      if (cmd.startsWith('mtc federation governance-sync-stats'))
        throw new Error('cli missing')
      return { output: '' }
    })
    const wrapper = mount(Mtc, { global: { stubs: STUBS, plugins: [i18n] } })
    await flushPromises()
    wrapper.vm.govFederationId = FED_ID
    await wrapper.vm.loadGovernanceLog()
    await flushPromises()
    // governance-log still loaded fine
    expect(wrapper.vm.govResult).toBeTruthy()
    expect(wrapper.vm.govResult.state.threshold).toBe(1)
    // sync-stats stays null — error swallowed
    expect(wrapper.vm.govSyncStats).toBeNull()
  })

  it('truncateEventId shortens long ids and preserves short ones', async () => {
    const wrapper = await mountAndLoadGovernance(executeMock)
    expect(wrapper.vm.truncateEventId('')).toBe('—')
    expect(wrapper.vm.truncateEventId('short')).toBe('short')
    expect(wrapper.vm.truncateEventId('abcdefgh1234567890ZZZZ')).toMatch(/^abcdefgh.+ZZZZ$/)
  })
})
