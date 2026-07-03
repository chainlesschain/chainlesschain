/* global self, clients */
// Remote Session Web Push service worker.
//
// Wakes a backgrounded browser tab for approval requests. The host's Web Push
// sender (packages/cli/src/harness/remote-session-push-web.js) delivers an
// aes128gcm-encrypted JSON payload carrying only routing ids (no session
// content); we surface it as a notification and, on click, focus/open the panel.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_e) {
    data = {}
  }
  if (data.type && data.type !== 'remote-session.approval-request') return
  const title = data.title || 'Approval requested'
  const body = data.body || 'A coding session needs your approval'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: data.sessionId ? `remote-session-${data.sessionId}` : 'remote-session-approval',
      renotify: true,
      requireInteraction: true,
      data: { sessionId: data.sessionId || null, clientId: data.clientId || null },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow ? self.clients.openWindow('/') : undefined
    }),
  )
})
