// Web Remote Session client store.
//
// A browser port of the Android RemoteSessionClient/ViewModel: it joins a
// desktop coding session over the signaling relay (NOT the panel's local CLI
// WebSocket), speaks the E2EE protocol, and mirrors the host's runtime events.
// Auto-reconnects transient drops on the already-derived shared secret without
// re-spending the one-time pairing token; stops on explicit disconnect or a
// host-issued `session.revoked`.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { RemoteSessionCrypto, parseRemotePairingUri } from '../utils/remote-session-crypto.js'

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

let seq = 0
function newPeerId() {
  const rand = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `web-${rand}`
}

export const useRemoteSessionStore = defineStore('remoteSession', () => {
  const status = ref('idle') // idle|connecting|pairing|connected|reconnecting|disconnected|revoked|error
  const events = ref([])
  const error = ref('')
  const remoteSessionId = ref(null)

  // Non-reactive connection internals (persist for the singleton store).
  let socket = null
  let crypto = null
  let pairing = null
  let peerId = null
  let paired = false
  let closedExplicitly = false
  let reconnectAttempts = 0
  let reconnectTimer = null

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function openSocket() {
    if (!pairing) return
    const ws = new WebSocket(pairing.relayUrl)
    socket = ws
    ws.addEventListener('open', () => {
      if (ws !== socket) return
      ws.send(
        JSON.stringify({
          type: 'register',
          peerId,
          deviceType: 'web',
          deviceInfo: { protocol: 'remote-session.e2ee.v1' },
        }),
      )
    })
    ws.addEventListener('message', (event) => {
      if (ws !== socket) return
      handleMessage(event.data)
    })
    ws.addEventListener('close', () => {
      if (ws !== socket) return
      socket = null
      if (closedExplicitly) {
        status.value = 'disconnected'
      } else {
        scheduleReconnect()
      }
    })
    ws.addEventListener('error', () => {
      if (ws !== socket) return
      error.value = 'Remote Session relay connection error'
    })
  }

  function scheduleReconnect() {
    if (closedExplicitly || reconnectTimer) return
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS)
    reconnectAttempts += 1
    status.value = 'reconnecting'
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (!closedExplicitly) openSocket()
    }, delay)
  }

  function handleMessage(raw) {
    try {
      let message = JSON.parse(typeof raw === 'string' ? raw : String(raw))
      if (message.type === 'offline-message') message = message.originalMessage || {}
      if (message.type === 'registered') {
        if (paired) {
          // Reconnected after a transient drop — resume without re-pairing.
          status.value = 'connected'
        } else {
          status.value = 'pairing'
          sendPairRequest()
        }
        return
      }
      if (message.type !== 'message') return
      const payload = message.payload
      if (!payload || payload.type !== 'remote-session.encrypted') return
      const event = crypto.decrypt(payload.envelope)
      if (event.type === 'pair.accepted') {
        paired = true
        reconnectAttempts = 0
        status.value = 'connected'
      } else if (event.type === 'session.revoked') {
        closedExplicitly = true
        paired = false
        clearReconnect()
        if (socket) socket.close()
        socket = null
        status.value = 'revoked'
      } else {
        seq += 1
        events.value = [...events.value, { ...event, _id: seq, _rxAt: Date.now() }].slice(-200)
      }
    } catch (cause) {
      status.value = 'error'
      error.value = cause?.message || 'Remote Session protocol error'
    }
  }

  function relaySend(payloadType, envelope) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !pairing) return false
    socket.send(
      JSON.stringify({
        type: 'message',
        to: pairing.hostPeerId,
        payload: { type: payloadType, ...envelope },
      }),
    )
    return true
  }

  function sendPairRequest() {
    const envelope = crypto.encrypt({
      type: 'pair.join',
      remoteSessionId: pairing.remoteSessionId,
      token: pairing.pairingToken,
    })
    relaySend('remote-session.pair', {
      mobilePeerId: peerId,
      mobilePublicKey: crypto.publicKeyBase64(),
      envelope,
    })
  }

  function sendControl(event) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !paired) return false
    return relaySend('remote-session.encrypted', { envelope: crypto.encrypt(event) })
  }

  function connect(uri) {
    disconnect()
    try {
      const parsed = parseRemotePairingUri(uri)
      peerId = newPeerId()
      crypto = new RemoteSessionCrypto(parsed.remoteSessionId, peerId)
      crypto.pair(parsed.hostPublicKey, parsed.pairingToken)
      pairing = parsed
      remoteSessionId.value = parsed.remoteSessionId
      paired = false
      closedExplicitly = false
      reconnectAttempts = 0
      error.value = ''
      events.value = []
      status.value = 'connecting'
      openSocket()
      return true
    } catch (cause) {
      status.value = 'error'
      error.value = cause?.message || 'Invalid pairing link'
      return false
    }
  }

  function sendPrompt(content) {
    const trimmed = (content || '').trim()
    if (!trimmed) return
    if (!sendControl({ type: 'prompt', content: trimmed })) {
      error.value = 'Remote Session is not connected'
    }
  }

  function approve(requestId, approved) {
    sendControl({ type: 'approval.resolve', requestId, approved })
  }

  function interrupt() {
    sendControl({ type: 'interrupt' })
  }

  function disconnect() {
    closedExplicitly = true
    paired = false
    clearReconnect()
    if (socket) {
      try {
        socket.close()
      } catch {
        /* already closing */
      }
    }
    socket = null
    if (status.value !== 'revoked') status.value = 'disconnected'
  }

  return {
    status,
    events,
    error,
    remoteSessionId,
    connect,
    sendPrompt,
    approve,
    interrupt,
    disconnect,
  }
})
