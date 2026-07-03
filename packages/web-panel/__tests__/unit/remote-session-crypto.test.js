import { describe, expect, it } from 'vitest'
import {
  RemoteSessionCrypto,
  parseRemotePairingUri,
} from '../../src/utils/remote-session-crypto.js'
import {
  RemoteSessionCryptoContext,
  createRemotePairingUri,
} from '../../../cli/src/harness/remote-session-crypto.js'

describe('web Remote Session crypto interop with the Node host', () => {
  function pairedPair() {
    const sessionId = 'session-interop'
    const token = 'one-time-token-xyz'
    const host = new RemoteSessionCryptoContext({ sessionId, localPeerId: 'host-peer' })
    const web = new RemoteSessionCrypto(sessionId, 'web-peer')
    host.pair('web-peer', web.publicKeyBase64(), token)
    web.pair(host.publicKey, token)
    return { host, web, sessionId, token }
  }

  it('encrypts on the web client and decrypts on the host', () => {
    const { host, web } = pairedPair()
    const envelope = web.encrypt({ type: 'prompt', content: 'continue the build' })
    expect(host.decrypt(envelope)).toEqual({ type: 'prompt', content: 'continue the build' })
  })

  it('decrypts host runtime events on the web client', () => {
    const { host, web } = pairedPair()
    const envelope = host.encrypt('web-peer', { type: 'assistant.delta', content: 'ok' })
    expect(web.decrypt(envelope)).toEqual({ type: 'assistant.delta', content: 'ok' })
  })

  it('rejects replayed or out-of-order envelopes', () => {
    const { host, web } = pairedPair()
    const envelope = host.encrypt('web-peer', { type: 'assistant.delta', content: 'first' })
    expect(web.decrypt(envelope)).toEqual({ type: 'assistant.delta', content: 'first' })
    expect(() => web.decrypt(envelope)).toThrow(/replay or out-of-order/)
  })

  it('parses a host-generated pairing URI and pairs from it', () => {
    const sessionId = 'session-uri'
    const token = 'uri-token'
    const host = new RemoteSessionCryptoContext({ sessionId, localPeerId: 'desktop-peer' })
    const uri = createRemotePairingUri({
      relayUrl: 'wss://relay.example.test',
      remoteSessionId: sessionId,
      hostPeerId: 'desktop-peer',
      hostPublicKey: host.publicKey,
      pairingToken: token,
      expiresAt: Date.now() + 60_000,
    })

    const payload = parseRemotePairingUri(uri)
    expect(payload).toMatchObject({
      relayUrl: 'wss://relay.example.test',
      remoteSessionId: sessionId,
      hostPeerId: 'desktop-peer',
      pairingToken: token,
    })

    const web = new RemoteSessionCrypto(payload.remoteSessionId, 'web-peer')
    host.pair('web-peer', web.publicKeyBase64(), payload.pairingToken)
    web.pair(payload.hostPublicKey, payload.pairingToken)
    const envelope = web.encrypt({ type: 'interrupt' })
    expect(host.decrypt(envelope)).toEqual({ type: 'interrupt' })
  })

  it('rejects expired and non-ws pairing URIs', () => {
    const base = {
      relayUrl: 'wss://relay.example.test',
      remoteSessionId: 's',
      hostPeerId: 'h',
      hostPublicKey: 'AAAA',
      pairingToken: 't',
    }
    const expired = createRemotePairingUri({ ...base, expiresAt: 1 })
    expect(() => parseRemotePairingUri(expired, Date.now())).toThrow(/expired/)
  })
})
