# wrtc-compat

**Source**: `src/main/p2p/wrtc-compat.js`

---

## try

```javascript
try
```

* WebRTC Compatibility Layer
 *
 * Optional WebRTC support via werift. werift is **deprecated** in this
 * project (removed from desktop-app-vue/package.json dependencies as of
 * v5.0.3.43+) because it transitively depends on the unmaintained `ip`
 * package, which has an unfixed SSRF advisory (CVE-2024-29415,
 * GHSA-78xj-cgh5-2h22). werift maintainer has not migrated off `ip`.
 *
 * What this means for callers:
 *   - `available` is `false` by default (werift not installed)
 *   - Callers (mobile-bridge, voice-video-manager) gracefully degrade:
 *     mobile-bridge logs a warning and skips the WebRTC fast path;
 *     voice-video-manager throws a clear error when startCall() is
 *     invoked
 *   - To re-enable: `npm install werift@^0.22.2` in the desktop app
 *     after auditing the `ip` patch state. The CVE-2024-29415 monkey-
 *     patch below activates if werift is present.
 *
 * Migration plan: replace werift with renderer-side WebRTC (Chromium
 * native, no node deps) for voice/video calling, and keep mobile-bridge
 * on a non-WebRTC transport (libp2p direct or signalling-only proxy).
 *
 * Usage:
 *   const wrtc = require('./wrtc-compat');
 *   if (!wrtc.available) { ... fall back ... }
 *   const pc = new wrtc.RTCPeerConnection(config);

---

## class MediaStreamCompat

```javascript
class MediaStreamCompat
```

* MediaStream compatibility wrapper
 * werift doesn't have MediaStream built-in, so we create a simple implementation

---

## class RTCSessionDescriptionCompat

```javascript
class RTCSessionDescriptionCompat
```

* RTCSessionDescription compatibility wrapper
 *
 * IMPORTANT: werift's RTCSessionDescription uses (sdp, type) as separate arguments,
 * but the standard WebRTC API expects ({type, sdp}) as an init object.
 * This wrapper provides the standard API.

---

## class RTCIceCandidateCompat

```javascript
class RTCIceCandidateCompat
```

* RTCIceCandidate compatibility wrapper

---

