// Web Push subscription helper for the Remote Session client.
//
// Registers the service worker, subscribes to the Push API with the host's
// VAPID public key, and serializes the resulting PushSubscription into the
// `{ token, provider }` shape the store carries in pair.join. Browser-only bits
// (navigator.serviceWorker / PushManager) degrade to null when unavailable
// (non-secure context, unsupported browser) so pairing still works without push.

const DEFAULT_SW_PATH = '/remote-session-sw.js'

/** Convert a base64url VAPID public key to the Uint8Array applicationServerKey. */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

/**
 * Serialize a PushSubscription (or its toJSON output) to the pushToken string
 * the host's Web Push sender consumes. Returns null if the subscription is
 * missing its endpoint/keys. Pure — unit-testable without a browser.
 */
export function serializeSubscription(subscription) {
  if (!subscription) return null
  const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription
  if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) return null
  return JSON.stringify({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  })
}

/** True when the current context can register a service worker + Push API. */
export function isWebPushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  )
}

/**
 * Register the service worker and subscribe to Web Push. Returns the serialized
 * subscription string (the pushToken), or null when unsupported / permission
 * denied — the caller pairs without push in that case.
 */
export async function subscribeWebPush({ vapidPublicKey, swPath = DEFAULT_SW_PATH } = {}) {
  if (!vapidPublicKey || !isWebPushSupported()) return null
  try {
    const registration = await navigator.serviceWorker.register(swPath)
    const ready = await navigator.serviceWorker.ready.catch(() => registration)
    const existing = await ready.pushManager.getSubscription()
    const subscription =
      existing ||
      (await ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }))
    return serializeSubscription(subscription)
  } catch {
    return null // permission denied / unsupported / insecure context
  }
}
