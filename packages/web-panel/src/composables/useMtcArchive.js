/**
 * useMtcArchive — web-panel composable for `mtc.archive.{push, restore, list}`
 * WS topics. Wraps the B4-archive flow: pack channel-mtc/<communityId>/* into
 * a zip and push to a provider (filesystem mirror or WebDAV); restore is the
 * inverse; list enumerates archive filenames already present at the provider.
 *
 * Pure-browser mode: WS topics return null-manager error envelopes from main
 * (because the desktop main process is the only side that holds the
 * channelEnvelopeArchiver instance), so we expose isEmbedded for the page to
 * disable the action buttons.
 */

import { ref } from 'vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from './useShellMode.js'

const REQUEST_TIMEOUT_MS = 60000 // archives can be large

function _unwrap(reply) {
  if (reply && reply.ok === false) {
    throw new Error(reply.error || 'archive handler failed')
  }
  return reply?.result ?? reply
}

export function useMtcArchive() {
  const ws = useWsStore()
  const { isEmbedded } = useShellMode()

  const archives = ref([])
  const lastResult = ref(null)
  const loading = ref(false)
  const errorMessage = ref('')

  function _setError(err) {
    errorMessage.value = err?.message || String(err)
    return null
  }

  async function listArchives(communityId, providerSpec) {
    errorMessage.value = ''
    if (!communityId) return _setError(new Error('communityId 必填'))
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        { type: 'mtc.archive.list', communityId, providerSpec },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '列出归档失败'))
      }
      archives.value = Array.isArray(r.archives) ? r.archives : []
      return archives.value
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function pushArchive(communityId, providerSpec, packOpts = {}) {
    errorMessage.value = ''
    if (!communityId) return _setError(new Error('communityId 必填'))
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        { type: 'mtc.archive.push', communityId, providerSpec, packOpts },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '归档推送失败'))
      }
      lastResult.value = r.result
      return r.result
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function restoreArchive(communityId, archiveName, providerSpec) {
    errorMessage.value = ''
    if (!communityId || !archiveName) {
      return _setError(new Error('communityId + archiveName 必填'))
    }
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        {
          type: 'mtc.archive.restore',
          communityId,
          archiveName,
          providerSpec,
        },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || '归档恢复失败'))
      }
      lastResult.value = r.result
      return r.result
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  return {
    archives,
    lastResult,
    loading,
    errorMessage,
    isEmbedded,
    listArchives,
    pushArchive,
    restoreArchive,
  }
}
