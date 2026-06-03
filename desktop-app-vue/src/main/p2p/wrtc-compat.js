const { logger } = require("../utils/logger.js");

/**
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
 */

let polyfill = null;
let available = false;
let loadError = null;

try {
  // node-datachannel/polyfill exports W3C-standard RTCPeerConnection etc.
  polyfill = require("node-datachannel/polyfill");
  available = true;
  logger.info("[wrtc-compat] node-datachannel polyfill loaded ✓");
} catch (e) {
  loadError = e;
  logger.warn(
    "[wrtc-compat] node-datachannel not available:",
    e?.message || "unknown",
  );
}

/**
 * MediaStream compatibility shim.
 *
 * node-datachannel doesn't ship a MediaStream — it's data-channel-only.
 * We keep this shim so voice-video-manager.js code paths don't NPE on
 * `new wrtc.MediaStream()`, but the resulting stream carries no tracks
 * and any RTP-track flow throws downstream.
 */
class MediaStreamCompat {
  constructor(tracks = []) {
    this.id = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this._tracks = [...tracks];
    this._active = true;
  }

  get active() {
    return this._active && this._tracks.length > 0;
  }

  getTracks() {
    return [...this._tracks];
  }

  getAudioTracks() {
    return this._tracks.filter((t) => t.kind === "audio");
  }

  getVideoTracks() {
    return this._tracks.filter((t) => t.kind === "video");
  }

  addTrack(track) {
    if (!this._tracks.includes(track)) {
      this._tracks.push(track);
    }
  }

  removeTrack(track) {
    const index = this._tracks.indexOf(track);
    if (index !== -1) {
      this._tracks.splice(index, 1);
    }
  }

  clone() {
    return new MediaStreamCompat(this._tracks.map((t) => t.clone?.() || t));
  }

  stop() {
    this._active = false;
    this._tracks.forEach((track) => {
      if (track.stop) {
        track.stop();
      }
    });
  }
}

module.exports = {
  get available() {
    return available;
  },

  get loadError() {
    return loadError;
  },

  // node-datachannel polyfill exports W3C-standard ctors. No wrapping needed —
  // RTCSessionDescriptionInit / RTCIceCandidateInit are plain dicts both at
  // input (we pass `{type, sdp}` to setRemoteDescription) and output
  // (createAnswer returns plain dict).
  RTCPeerConnection: available ? polyfill.RTCPeerConnection : null,
  RTCSessionDescription: available ? polyfill.RTCSessionDescription : null,
  RTCIceCandidate: available ? polyfill.RTCIceCandidate : null,
  RTCDataChannel: available ? polyfill.RTCDataChannel : null,

  // MediaStream — local shim only (data-channel-only library, no native track
  // support). voice-video-manager will throw clearly if used.
  MediaStream: MediaStreamCompat,
};
