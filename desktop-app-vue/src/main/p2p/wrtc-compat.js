const { logger } = require("../utils/logger.js");

/**
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
 */

// Mitigate GHSA-78xj-cgh5-2h22 (CVE-2024-29415) IF `ip` is somehow in
// the tree (e.g., werift was manually installed). When werift is
// removed, `ip` is also gone and this block is a harmless no-op caught
// by the try/catch.
try {
  const ip = require("ip");
  const origIsPublic = ip.isPublic;
  ip.isPublic = function patchedIsPublic(addr) {
    if (typeof addr !== "string") {
      return false;
    }
    // 0.0.0.0 / :: are "this network" per RFC 1122 / RFC 4291 — never public
    if (addr === "0.0.0.0" || addr === "::") {
      return false;
    }
    // Reject hex / octal / leading-zero encodings (0x..., 010.0.0.1, etc.)
    if (/^0[xX]/.test(addr) || /^0\d/.test(addr)) {
      return false;
    }
    return origIsPublic.call(this, addr);
  };
} catch {
  // `ip` not in tree — werift not installed, expected default.
}

let werift = null;
let available = false;
let loadError = null;

try {
  // Optional dep. Default: not installed (deprecated).
  werift = require("werift");
  available = true;
  logger.info(
    "[wrtc-compat] werift detected (deprecated; consider migrating off — see module header)",
  );
} catch (e) {
  loadError = e;
  // Not a warning — werift being absent is the intended default.
}

/**
 * MediaStream compatibility wrapper
 * werift doesn't have MediaStream built-in, so we create a simple implementation
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

/**
 * RTCSessionDescription compatibility wrapper
 *
 * IMPORTANT: werift's RTCSessionDescription uses (sdp, type) as separate arguments,
 * but the standard WebRTC API expects ({type, sdp}) as an init object.
 * This wrapper provides the standard API.
 */
class RTCSessionDescriptionCompat {
  constructor(init = {}) {
    // Handle both standard API {type, sdp} and werift's (sdp, type) patterns
    if (typeof init === "string") {
      // werift-style: first arg is sdp string
      this.sdp = init;
      this.type = arguments[1] || "";
    } else {
      // Standard API: init object with type and sdp
      this.type = init.type || "";
      this.sdp = init.sdp || "";
    }
  }

  toJSON() {
    return {
      type: this.type,
      sdp: this.sdp,
    };
  }
}

/**
 * RTCIceCandidate compatibility wrapper
 */
class RTCIceCandidateCompat {
  constructor(init = {}) {
    this.candidate = init.candidate || "";
    this.sdpMid = init.sdpMid || null;
    this.sdpMLineIndex = init.sdpMLineIndex ?? null;
    this.usernameFragment = init.usernameFragment || null;
  }

  toJSON() {
    return {
      candidate: this.candidate,
      sdpMid: this.sdpMid,
      sdpMLineIndex: this.sdpMLineIndex,
      usernameFragment: this.usernameFragment,
    };
  }
}

// Export the compatibility layer
module.exports = {
  get available() {
    return available;
  },

  get loadError() {
    return loadError;
  },

  // Use werift's RTCPeerConnection if available, otherwise provide a stub
  RTCPeerConnection: available ? werift.RTCPeerConnection : null,

  // Always use our compat layer because werift's RTCSessionDescription uses (sdp, type) constructor
  // instead of the standard ({type, sdp}) init object pattern
  RTCSessionDescription: RTCSessionDescriptionCompat,

  // werift has its own RTCIceCandidate, use it or our compat layer
  RTCIceCandidate: available
    ? werift.RTCIceCandidate || RTCIceCandidateCompat
    : RTCIceCandidateCompat,

  // MediaStream - use our compat implementation
  MediaStream: MediaStreamCompat,

  // Additional werift exports if available
  ...(available
    ? {
        RTCRtpSender: werift.RTCRtpSender,
        RTCRtpReceiver: werift.RTCRtpReceiver,
        RTCDataChannel: werift.RTCDataChannel,
        MediaStreamTrack: werift.MediaStreamTrack,
        RTCRtpTransceiver: werift.RTCRtpTransceiver,
      }
    : {}),
};
