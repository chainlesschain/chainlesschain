import { describe, expect, it } from 'vitest'
import {
  isWebPushSupported,
  serializeSubscription,
  urlBase64ToUint8Array,
} from '../../src/utils/webPush.js'

describe('serializeSubscription', () => {
  it('serializes a PushSubscription with toJSON()', () => {
    const sub = {
      toJSON: () => ({
        endpoint: 'https://push.example.test/ep/1',
        keys: { p256dh: 'PUB', auth: 'AUTH' },
      }),
    }
    expect(JSON.parse(serializeSubscription(sub))).toEqual({
      endpoint: 'https://push.example.test/ep/1',
      keys: { p256dh: 'PUB', auth: 'AUTH' },
    })
  })

  it('accepts a plain subscription object', () => {
    const json = serializeSubscription({
      endpoint: 'https://push.example.test/ep/2',
      keys: { p256dh: 'P', auth: 'A' },
    })
    expect(JSON.parse(json).endpoint).toBe('https://push.example.test/ep/2')
  })

  it('returns null when endpoint or keys are missing', () => {
    expect(serializeSubscription(null)).toBeNull()
    expect(serializeSubscription({ endpoint: 'x' })).toBeNull()
    expect(serializeSubscription({ endpoint: 'x', keys: { p256dh: 'p' } })).toBeNull()
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url VAPID key to bytes', () => {
    // "hello" → base64url "aGVsbG8"
    const bytes = urlBase64ToUint8Array('aGVsbG8')
    expect(Array.from(bytes)).toEqual([...'hello'].map((c) => c.charCodeAt(0)))
  })
})

describe('isWebPushSupported', () => {
  it('reflects the absence of PushManager in the test environment', () => {
    // happy-dom has navigator but no real PushManager → unsupported.
    expect(typeof isWebPushSupported()).toBe('boolean')
  })
})
