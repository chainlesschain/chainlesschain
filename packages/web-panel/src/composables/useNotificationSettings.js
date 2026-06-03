/**
 * useNotificationSettings — web-panel composable wrapping
 * `notification-settings.*` WS topics (Phase 3c.7, 2026-05-07).
 *
 * Pure-browser mode (cc serve in plain Chrome): no WS topic backing,
 * settings页面应当 disable 整张表 + 显示 "请用桌面壳"。
 *
 * Embedded shell: get/update 直透 appConfig.notifications.* 子树,
 * 持久化由 AppConfigManager 自身搞定。
 */

import { ref } from 'vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from './useShellMode.js'

const DEFAULTS = { enabled: true, sound: true, badge: true, desktop: true }

function _unwrap(reply) {
  if (reply && reply.ok === false) {
    throw new Error(reply.error || 'notification-settings handler failed')
  }
  return reply?.result ?? reply
}

const _state = {
  settings: ref({ ...DEFAULTS }),
}

export function useNotificationSettings() {
  const ws = useWsStore()
  const isEmbedded = useShellMode().isEmbedded

  async function load() {
    if (!isEmbedded) {
      _state.settings.value = { ...DEFAULTS }
      return _state.settings.value
    }
    const reply = await ws.sendRaw(
      { type: 'notification-settings.get' },
      10000,
    )
    const r = _unwrap(reply)
    if (r?.success === false) {
      throw new Error(r.error || 'notification-settings.get failed')
    }
    _state.settings.value = { ...DEFAULTS, ...(r?.settings || {}) }
    return _state.settings.value
  }

  async function update(patch) {
    if (!patch || typeof patch !== 'object') {
      throw new Error('patch is required')
    }
    if (!isEmbedded) {
      throw new Error('通知设置仅在嵌入式 web-shell 中可写')
    }
    const reply = await ws.sendRaw(
      { type: 'notification-settings.update', settings: patch },
      10000,
    )
    const r = _unwrap(reply)
    if (r?.success === false) {
      throw new Error(r.error || 'notification-settings.update failed')
    }
    _state.settings.value = { ...DEFAULTS, ...(r?.settings || {}) }
    return _state.settings.value
  }

  return {
    settings: _state.settings,
    isEmbedded,
    load,
    update,
    DEFAULTS,
  }
}
