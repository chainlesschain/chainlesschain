const { logger, createLogger } = require('../utils/logger.js');

/**
 * WebRTC Compatibility Layer
 *
 * Provides wrtc-compatible API using werift (pure JavaScript WebRTC implementation)
 * This replaces the deprecated 'wrtc' package which doesn't support modern Electron/Node.js
 *
 * Usage:
 *   const wrtc = require('./wrtc-compat');
 *   const pc = new wrtc.RTCPeerConnection(config);
 */

let werift = null;
let available = false;
let loadError = null;

try {
  // werift is a pure JavaScript WebRTC implementation
  // No native binaries required - works on all platforms
  werift = require("werift");
  available = true;
} catch (e) {
  loadError = e;
  logger.warn("[wrtc-compat] werift not available:", e.message);
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
      if (track.stop) {track.stop();}
    });
  }
}

/**
 * RTCSessionDescription compatibility wrapper
 */
class RTCSessionDescriptionCompat {
  constructor(init = {}) {
    this.type = init.type || "";
    this.sdp = init.sdp || "";
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

  // werift has its own RTCSessionDescription, use it or our compat layer
  RTCSessionDescription: available
    ? werift.RTCSessionDescription || RTCSessionDescriptionCompat
    : RTCSessionDescriptionCompat,

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
