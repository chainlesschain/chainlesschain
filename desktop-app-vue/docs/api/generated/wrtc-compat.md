# wrtc-compat

**Source**: `src/main/p2p/wrtc-compat.js`

**Generated**: 2026-02-15T08:42:37.211Z

---

## let werift = null;

```javascript
let werift = null;
```

* WebRTC Compatibility Layer
 *
 * Provides wrtc-compatible API using werift (pure JavaScript WebRTC implementation)
 * This replaces the deprecated 'wrtc' package which doesn't support modern Electron/Node.js
 *
 * Usage:
 *   const wrtc = require('./wrtc-compat');
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

