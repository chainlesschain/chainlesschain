/**
 * useGovernanceMofn — web-panel composable for `mtc.governance-mofn.*` WS topics.
 *
 * The 5-call surface mirrors the GovernanceMultiSig main-process API:
 *   createProposal(args) → proposal record
 *   addSignature(communityId, proposalId, signerKeys) — base64-serialize
 *     the secretKey/publicKey before sending (renderer must produce the
 *     keys via tweetnacl OR derive from local DID identity)
 *   getStatus(communityId, proposalId)
 *   finalize(communityId, proposalId)
 *   listProposals(communityId)
 *
 * Pure-browser mode: server-side will return success:false ("not initialized")
 * because the desktop main process is the only host for governanceMultiSig.
 * We expose isEmbedded so the UI can disable controls + show a helper alert.
 */

import { ref } from 'vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from './useShellMode.js'

const REQUEST_TIMEOUT_MS = 12000

function _unwrap(reply) {
  if (reply && reply.ok === false) {
    throw new Error(reply.error || 'governance-mofn handler failed')
  }
  return reply?.result ?? reply
}

function _bufToBase64(buf) {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) {
    return buf.toString('base64')
  }
  // Browser: assume Uint8Array
  if (buf instanceof Uint8Array) {
    let s = ''
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i])
    return globalThis.btoa(s)
  }
  if (typeof buf === 'string') return buf // already base64
  throw new TypeError('signerKeys.{secretKey,publicKey} must be Buffer / Uint8Array / base64 string')
}

export function useGovernanceMofn() {
  const ws = useWsStore()
  const { isEmbedded } = useShellMode()

  const proposals = ref([])
  const currentStatus = ref(null)
  const loading = ref(false)
  const errorMessage = ref('')

  function _setError(err) {
    errorMessage.value = err?.message || String(err)
    return null
  }

  async function listProposals(communityId) {
    errorMessage.value = ''
    if (!communityId) return _setError(new Error('communityId 必填'))
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        { type: 'mtc.governance-mofn.list', communityId },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '提案列表读取失败'))
      }
      proposals.value = Array.isArray(r.proposals) ? r.proposals : []
      return proposals.value
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function createProposal({
    communityId,
    proposalId,
    payload,
    members,
    threshold,
  }) {
    errorMessage.value = ''
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        {
          type: 'mtc.governance-mofn.create',
          communityId,
          proposalId,
          payload,
          members,
          threshold,
        },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '创建提案失败'))
      }
      return r.proposal
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function addSignature(communityId, proposalId, signerKeys) {
    errorMessage.value = ''
    if (!signerKeys || !signerKeys.did) {
      return _setError(new Error('signerKeys 必须含 did/secretKey/publicKey'))
    }
    loading.value = true
    try {
      const serialized = {
        did: signerKeys.did,
        secretKey: _bufToBase64(signerKeys.secretKey),
        publicKey: _bufToBase64(signerKeys.publicKey),
      }
      const reply = await ws.sendRaw(
        {
          type: 'mtc.governance-mofn.sign',
          communityId,
          proposalId,
          signerKeys: serialized,
        },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '签名提交失败'))
      }
      currentStatus.value = r.status
      return r.status
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function getStatus(communityId, proposalId) {
    errorMessage.value = ''
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        { type: 'mtc.governance-mofn.status', communityId, proposalId },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '状态读取失败'))
      }
      currentStatus.value = r.status
      return r.status
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function finalize(communityId, proposalId) {
    errorMessage.value = ''
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        { type: 'mtc.governance-mofn.finalize', communityId, proposalId },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '提案 finalize 失败'))
      }
      return r.result
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  return {
    proposals,
    currentStatus,
    loading,
    errorMessage,
    isEmbedded,
    listProposals,
    createProposal,
    addSignature,
    getStatus,
    finalize,
  }
}
