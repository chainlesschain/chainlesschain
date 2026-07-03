// Browser-side Remote Session end-to-end encryption.
//
// A pure-JS (@noble) port of the Node host crypto
// (packages/cli/src/harness/remote-session-crypto.js) and the Android client
// (RemoteSessionCrypto.kt). Uses X25519 ECDH → HKDF-SHA256 (salt = SHA-256 of
// the one-time pairing token) → AES-256-GCM with per-sender monotonic sequence
// numbers bound into the AAD. Deliberately avoids WebCrypto's X25519 (still
// spotty across browsers) so the exact same code runs in the Vite bundle and in
// Node unit tests, guaranteeing byte-for-byte interop with the host.

import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { gcm } from '@noble/ciphers/aes.js'

const PROTOCOL = 'chainlesschain.remote-session.e2ee.v1'
const PAIRING_PREFIX = 'chainlesschain://remote-session/pair#'
const X25519_KEY_LEN = 32

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function utf8(str) {
  return encoder.encode(str)
}

export function b64u(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function unb64u(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function randomBytes(length) {
  const out = new Uint8Array(length)
  globalThis.crypto.getRandomValues(out)
  return out
}

function generateSecretKey() {
  const utils = x25519.utils
  return utils.randomSecretKey ? utils.randomSecretKey() : utils.randomPrivateKey()
}

function aad(sessionId, senderId, sequence) {
  return utf8(`${PROTOCOL}\n${sessionId}\n${senderId}\n${sequence}`)
}

/**
 * Parse a `chainlesschain://remote-session/pair#<base64url(json)>` URI. Mirrors
 * the Node/Android parsers: v1 only, required fields present, relay must be
 * ws/wss, and a stated expiry must be in the future.
 */
export function parseRemotePairingUri(uri, now = Date.now()) {
  if (typeof uri !== 'string' || !uri.startsWith(PAIRING_PREFIX)) {
    throw new Error('Invalid Remote Session pairing URI')
  }
  let payload
  try {
    payload = JSON.parse(decoder.decode(unb64u(uri.slice(PAIRING_PREFIX.length))))
  } catch {
    throw new Error('Malformed Remote Session pairing payload')
  }
  if (
    payload.v !== 1 ||
    !payload.relayUrl ||
    !payload.remoteSessionId ||
    !payload.hostPeerId ||
    !payload.hostPublicKey ||
    !payload.pairingToken
  ) {
    throw new Error('Incomplete Remote Session pairing payload')
  }
  if (payload.expiresAt && payload.expiresAt <= now) {
    throw new Error('Remote Session pairing payload expired')
  }
  let scheme
  try {
    scheme = new URL(payload.relayUrl).protocol
  } catch {
    scheme = null
  }
  if (scheme !== 'ws:' && scheme !== 'wss:') {
    throw new Error('Remote Session relay must use ws or wss')
  }
  return payload
}

export class RemoteSessionCrypto {
  constructor(sessionId, localPeerId) {
    if (!sessionId || !localPeerId) throw new Error('sessionId and localPeerId are required')
    this.sessionId = sessionId
    this.localPeerId = localPeerId
    this.secretKey = generateSecretKey()
    this.publicKey = x25519.getPublicKey(this.secretKey)
    this.key = null
    this.sendSequence = 0
    this.receivedSequences = new Map()
  }

  publicKeyBase64() {
    return b64u(this.publicKey)
  }

  pair(hostPublicKey, pairingToken) {
    if (!hostPublicKey || !pairingToken) throw new Error('Incomplete peer key material')
    const decoded = unb64u(hostPublicKey)
    // The Node host advertises an SPKI-DER key; the last 32 bytes are the raw
    // X25519 point. Android/web send raw 32-byte keys. Accept both.
    const raw =
      decoded.length === X25519_KEY_LEN ? decoded : decoded.slice(-X25519_KEY_LEN)
    if (raw.length !== X25519_KEY_LEN) throw new Error('Invalid X25519 host public key')
    const shared = x25519.getSharedSecret(this.secretKey, raw)
    const salt = sha256(utf8(pairingToken))
    this.key = hkdf(sha256, shared, salt, utf8(`${PROTOCOL}:${this.sessionId}`), 32)
  }

  encrypt(message) {
    if (!this.key) throw new Error('Remote Session is not paired')
    const sequence = (this.sendSequence += 1)
    const nonce = randomBytes(12)
    const sealed = gcm(this.key, nonce, aad(this.sessionId, this.localPeerId, sequence)).encrypt(
      utf8(JSON.stringify(message)),
    )
    return {
      v: 1,
      sessionId: this.sessionId,
      senderId: this.localPeerId,
      sequence,
      nonce: b64u(nonce),
      ciphertext: b64u(sealed.slice(0, sealed.length - 16)),
      tag: b64u(sealed.slice(sealed.length - 16)),
    }
  }

  decrypt(envelope) {
    if (envelope?.v !== 1 || envelope.sessionId !== this.sessionId) {
      throw new Error('Invalid encrypted Remote Session envelope')
    }
    if (!this.key) throw new Error('Remote Session is not paired')
    const previous = this.receivedSequences.get(envelope.senderId) || 0
    if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence <= previous) {
      throw new Error('Remote Session replay or out-of-order envelope rejected')
    }
    const sealed = new Uint8Array([...unb64u(envelope.ciphertext), ...unb64u(envelope.tag)])
    const plaintext = gcm(
      this.key,
      unb64u(envelope.nonce),
      aad(this.sessionId, envelope.senderId, envelope.sequence),
    ).decrypt(sealed)
    this.receivedSequences.set(envelope.senderId, envelope.sequence)
    return JSON.parse(decoder.decode(plaintext))
  }
}
