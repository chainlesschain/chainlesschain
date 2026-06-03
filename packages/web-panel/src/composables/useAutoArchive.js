/**
 * useAutoArchive — web-panel composable for `mtc.auto-archive.*`
 * (config-get / config-set / run-now). Wraps the B4-auto-archive cron
 * scheduler that lives in the desktop main process.
 *
 * Pure-browser mode (no embeddedShell) returns null-manager error
 * envelopes from main; UI gates the action buttons via isEmbedded.
 */

import { ref } from 'vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from './useShellMode.js'

const REQUEST_TIMEOUT_MS = 60000

function _unwrap(reply) {
  if (reply && reply.ok === false) {
    throw new Error(reply.error || 'auto-archive handler failed')
  }
  return reply?.result ?? reply
}

export function useAutoArchive() {
  const ws = useWsStore()
  const { isEmbedded } = useShellMode()

  const config = ref(null)
  const lastRunResult = ref(null)
  const loading = ref(false)
  const errorMessage = ref('')

  function _setError(err) {
    errorMessage.value = err?.message || String(err)
    return null
  }

  async function getConfig() {
    errorMessage.value = ''
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        { type: 'mtc.auto-archive.config-get' },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || 'config-get failed'))
      }
      config.value = r.config
      return r.config
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function setConfig(patch) {
    errorMessage.value = ''
    if (!patch || typeof patch !== 'object') {
      return _setError(new Error('patch 必须是对象'))
    }
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        { type: 'mtc.auto-archive.config-set', patch },
        REQUEST_TIMEOUT_MS,
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || 'config-set failed'))
      }
      config.value = r.config
      return r.config
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  async function runNow() {
    errorMessage.value = ''
    loading.value = true
    try {
      const reply = await ws.sendRaw(
        { type: 'mtc.auto-archive.run-now' },
        REQUEST_TIMEOUT_MS * 5, // archival sweep can take longer
      )
      const r = _unwrap(reply)
      if (!r || r.success !== true) {
        return _setError(new Error(r?.error || 'run-now failed'))
      }
      lastRunResult.value = r.result
      // Refresh config so lastRunAt / lastRunStatus reflect server state
      await getConfig()
      return r.result
    } catch (err) {
      return _setError(err)
    } finally {
      loading.value = false
    }
  }

  return {
    config,
    lastRunResult,
    loading,
    errorMessage,
    isEmbedded,
    getConfig,
    setConfig,
    runNow,
  }
}
