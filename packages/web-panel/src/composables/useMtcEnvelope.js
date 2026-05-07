/**
 * useMtcEnvelope — web-panel composable for `mtc.envelope.get` WS topic.
 *
 * Mirrors the V6 desktop `useMessageEnvelope` composable shape so any UI
 * primitive (modal, drawer, sidebar pane) can drop in either renderer
 * without rewriting the lookup logic.
 *
 * 5-phase reactive state: idle / loading / found / not-found / error.
 *
 * Pure-browser mode (cc serve in plain Chrome): no WS topic backing →
 * resolves to {phase: 'error', message: 'requires desktop web-shell'}.
 */

import { ref } from 'vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from './useShellMode.js'

const REQUEST_TIMEOUT_MS = 12000

function _unwrap(reply) {
  if (reply && reply.ok === false) {
    throw new Error(reply.error || 'mtc.envelope.get handler failed')
  }
  return reply?.result ?? reply
}

export function useMtcEnvelope() {
  const ws = useWsStore()
  const { isEmbedded } = useShellMode()
  const state = ref({ phase: 'idle' })

  async function fetch(communityId, messageId) {
    if (!communityId || !messageId) {
      state.value = { phase: 'error', message: 'communityId / messageId 必填' }
      return
    }
    if (!isEmbedded) {
      state.value = { phase: 'error', message: '此功能仅在嵌入式 web-shell 中可用' }
      return
    }
    state.value = { phase: 'loading' }
    try {
      const reply = await ws.sendRaw(
        { type: 'mtc.envelope.get', communityId, messageId },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        state.value = { phase: 'not-found', reason: r?.error }
        return
      }
      state.value = {
        phase: 'found',
        result: {
          origin: r.origin || 'local',
          envelope: r.envelope || {},
          landmark: r.landmark ?? null,
          treeHeadId: r.treeHeadId || '',
          namespace: r.namespace,
          batchId: r.batchId,
          leafIndex: r.leafIndex,
          staging: r.staging,
        },
      }
    } catch (err) {
      state.value = { phase: 'error', message: err?.message || String(err) }
    }
  }

  function reset() {
    state.value = { phase: 'idle' }
  }

  return { state, fetch, reset, isEmbedded }
}
