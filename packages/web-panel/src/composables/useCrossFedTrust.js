/**
 * useCrossFedTrust — web-panel composable for `mtc.cross-fed-trust.*` WS topics.
 *
 * Wraps the B4-crossfed flow: establish (or update) a trust record, revoke
 * by remote-community-id, list current records, query the union DID set
 * (used by the inbound landmark trust filter under the hood).
 */

import { ref } from 'vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from './useShellMode.js'

const REQUEST_TIMEOUT_MS = 8000

function _unwrap(reply) {
  if (reply && reply.ok === false) {
    throw new Error(reply.error || 'cross-fed-trust handler failed')
  }
  return reply?.result ?? reply
}

export function useCrossFedTrust() {
  const ws = useWsStore()
  const { isEmbedded } = useShellMode()

  const records = ref([])
  const trustedDids = ref([])
  const loading = ref(false)
  const errorMessage = ref('')

  function _setError(err) {
    errorMessage.value = err?.message || String(err)
    return null
  }

  async function listTrust(localCommunityId) {
    errorMessage.value = ''
    if (!localCommunityId) return _setError(new Error('localCommunityId 必填'))
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        { type: 'mtc.cross-fed-trust.list', localCommunityId },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '信任列表读取失败'))
      }
      records.value = Array.isArray(r.records) ? r.records : []
      return records.value
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function establishTrust({
    localCommunityId,
    remoteCommunityId,
    remoteMembers,
    expiresAt,
    note,
  }) {
    errorMessage.value = ''
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        {
          type: 'mtc.cross-fed-trust.establish',
          localCommunityId,
          remoteCommunityId,
          remoteMembers,
          expiresAt: expiresAt || undefined,
          note: note || undefined,
        },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '建立信任失败'))
      }
      return r.record
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function revokeTrust(localCommunityId, remoteCommunityId) {
    errorMessage.value = ''
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        {
          type: 'mtc.cross-fed-trust.revoke',
          localCommunityId,
          remoteCommunityId,
        },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '撤销信任失败'))
      }
      return r.removed
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function getTrustedDids(localCommunityId) {
    errorMessage.value = ''
    if (!localCommunityId) return _setError(new Error('localCommunityId 必填'))
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        {
          type: 'mtc.cross-fed-trust.get-trusted-dids',
          localCommunityId,
        },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || 'DID 列表读取失败'))
      }
      trustedDids.value = Array.isArray(r.dids) ? r.dids : []
      return trustedDids.value
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  return {
    records,
    trustedDids,
    loading,
    errorMessage,
    isEmbedded,
    listTrust,
    establishTrust,
    revokeTrust,
    getTrustedDids,
  }
}
