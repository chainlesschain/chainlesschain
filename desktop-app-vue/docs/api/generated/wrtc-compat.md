# wrtc-compat

**Source**: `src/main/p2p/wrtc-compat.js`

---

## let polyfill = null;

```javascript
let polyfill = null;
```

* WebRTC Compatibility Layer (v2 — node-datachannel)
 *
 * Migrated from `werift` (deprecated, transitively depends on the unmaintained
 * `ip` package — CVE-2024-29415 / GHSA-78xj-cgh5-2h22) to `node-datachannel`
 * (libdatachannel C++ binding) at v5.0.3.46+.
 *
 * What works (Phase 3d mobile sync use case):
 *   - RTCPeerConnection + RTCDataChannel (via node-datachannel/polyfill)
 *   - SDP offer/answer negotiation, ICE candidates, DTLS
 *   - All standard W3C signatures (no werift constructor quirks)
 *
 * What does NOT work (acknowledged limitation):
 *   - Audio/video MediaStream tracks. node-datachannel is data-channel-only;
 *     voice-video-manager.js will throw a clear "voice/video unsupported on
 *     desktop main process" error when invoked. Per-renderer Chromium WebRTC
 *     is the long-term plan for voice/video.
 *
 * N-API v8 prebuild — same binary works in Node 18+ and Electron 28+ (shared
 * ABI). No electron-rebuild needed.

---

## class MediaStreamCompat

```javascript
class MediaStreamCompat
```

* MediaStream compatibility shim.
 *
 * node-datachannel doesn't ship a MediaStream — it's data-channel-only.
 * We keep this shim so voice-video-manager.js code paths don't NPE on
 * `new wrtc.MediaStream()`, but the resulting stream carries no tracks
 * and any RTP-track flow throws downstream.

---

