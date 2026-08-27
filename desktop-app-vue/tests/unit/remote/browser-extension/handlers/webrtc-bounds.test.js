import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WEBRTC_LIMITS,
  HARD_WEBRTC_LIMITS,
  closeConnectionInPage,
  createWebRTCLimits,
  getConnectionStatsInPage,
  getDataChannelsInPage,
  getDescriptionInPage,
  getIceCandidatesInPage,
  getMediaStreamsInPage,
  getWebRTCConnectionStats,
  listPeerConnectionsInPage,
  monitorConnectionInPage,
  validateConnectionId,
} from "../../../../../src/main/remote/browser-extension/handlers/webrtc.js";

class FakePeerConnection {
  constructor() {
    this.connectionState = "connected";
    this.iceConnectionState = "connected";
    this.iceGatheringState = "complete";
    this.signalingState = "stable";
    this.localDescription = { type: "offer", sdp: "local-sdp" };
    this.remoteDescription = { type: "answer", sdp: "remote-sdp" };
    this.localStreams = [];
    this.remoteStreams = [];
    this.stats = [];
    this.listeners = new Map();
    this.closed = false;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      listener();
    }
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }

  getLocalStreams() {
    return this.localStreams;
  }

  getRemoteStreams() {
    return this.remoteStreams;
  }

  async getStats() {
    return { forEach: (callback) => this.stats.forEach(callback) };
  }

  close() {
    this.closed = true;
  }
}

function createTrack(index) {
  return {
    kind: "video",
    id: `track-${index}`,
    label: `Track ${index}`,
    enabled: true,
    muted: false,
    readyState: "live",
  };
}

function createStream(index, trackCount = 1) {
  const tracks = Array.from({ length: trackCount }, (_, trackIndex) =>
    createTrack(trackIndex),
  );
  return {
    id: `stream-${index}`,
    active: true,
    getTracks: () => tracks,
  };
}

beforeEach(() => {
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebRTC boundaries", () => {
  it("uses finite defaults and clamps configured limits to hard ceilings", () => {
    expect(createWebRTCLimits()).toEqual(DEFAULT_WEBRTC_LIMITS);
    expect(
      createWebRTCLimits(
        Object.fromEntries(
          Object.keys(HARD_WEBRTC_LIMITS).map((key) => [
            key,
            Number.MAX_SAFE_INTEGER,
          ]),
        ),
      ),
    ).toEqual(HARD_WEBRTC_LIMITS);
  });

  it("rejects invalid or out-of-range connection identifiers", async () => {
    expect(validateConnectionId(-1, 4)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(validateConnectionId(4, 4)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    const executeScript = vi.fn();
    vi.stubGlobal("chrome", { scripting: { executeScript } });
    await expect(getWebRTCConnectionStats(1, 64)).resolves.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("bounds peer listings and serialized RTC stats", async () => {
    const first = new FakePeerConnection();
    first.connectionState = "x".repeat(20);
    first.stats = [
      { id: "one", type: "candidate", timestamp: 1, value: "ok" },
      { id: "large", type: "candidate", value: "x".repeat(200) },
      { id: "two", type: "candidate", timestamp: 2, value: "ok" },
      { id: "three", type: "candidate", timestamp: 3, value: "ok" },
    ];
    window.__rtcPeerConnections = [
      first,
      new FakePeerConnection(),
      new FakePeerConnection(),
    ];
    const limits = createWebRTCLimits({
      maxPeerConnections: 2,
      maxStats: 2,
      maxStatBytes: 100,
      maxStatsBytes: 150,
      maxStateChars: 8,
    });

    expect(listPeerConnectionsInPage(limits)).toMatchObject({
      connections: [{ id: 0, connectionState: "xxxxxxxx" }, { id: 1 }],
      droppedConnections: 1,
    });
    await expect(getConnectionStatsInPage(0, limits)).resolves.toMatchObject({
      stats: [{ id: "one" }, { id: "two" }],
      droppedStats: 2,
    });
  });

  it("bounds data channels, streams, tracks, candidates, and descriptions", () => {
    const pc = new FakePeerConnection();
    pc.localStreams = [createStream(1, 3), createStream(2), createStream(3)];
    pc.remoteStreams = [createStream(4)];
    pc.localDescription.sdp = "s".repeat(20);
    window.__rtcPeerConnections = [pc];
    window.__rtcDataChannels = [
      [
        { label: "one", readyState: "open" },
        { label: "two", readyState: "open" },
        { label: "three", readyState: "open" },
      ],
    ];
    window.__rtcICECandidates = [
      [
        { candidate: "candidate-one" },
        { candidate: "candidate-two" },
        { candidate: "candidate-three" },
      ],
    ];
    const limits = createWebRTCLimits({
      maxDataChannels: 2,
      maxMediaStreams: 2,
      maxTracksPerStream: 1,
      maxIceCandidates: 2,
      maxCandidateChars: 5,
      maxSdpChars: 6,
    });

    expect(getDataChannelsInPage(0, limits)).toMatchObject({
      channels: [{ label: "one" }, { label: "two" }],
      droppedChannels: 1,
    });
    expect(getMediaStreamsInPage(limits)).toMatchObject({
      streams: [
        { id: "stream-1", tracks: [{ id: "track-0" }], droppedTracks: 2 },
        { id: "stream-2" },
      ],
      droppedStreams: 2,
    });
    expect(getIceCandidatesInPage(0, limits)).toMatchObject({
      candidates: [{ candidate: "candi" }, { candidate: "candi" }],
      droppedCandidates: 1,
    });
    expect(getDescriptionInPage(0, "local", limits)).toEqual({
      type: "offer",
      sdp: "ssssss",
    });
  });

  it("bounds monitor events and releases listeners plus retained state", () => {
    const pc = new FakePeerConnection();
    window.__rtcPeerConnections = [pc];
    window.__rtcDataChannels = [[{ label: "release" }]];
    window.__rtcICECandidates = [[{ candidate: "release" }]];
    const limits = createWebRTCLimits({ maxMonitorEvents: 2 });

    expect(monitorConnectionInPage(0, limits).success).toBe(true);
    pc.connectionState = "first";
    pc.dispatch("connectionstatechange");
    pc.connectionState = "second";
    pc.dispatch("connectionstatechange");
    pc.connectionState = "third";
    pc.dispatch("connectionstatechange");
    const firstMonitor = window.__rtcMonitoring.get(0);
    expect(firstMonitor.events.map((event) => event.state)).toEqual([
      "second",
      "third",
    ]);
    expect(firstMonitor.droppedEvents).toBe(1);

    expect(monitorConnectionInPage(0, limits).success).toBe(true);
    expect(pc.listenerCount("connectionstatechange")).toBe(1);
    expect(firstMonitor.events).toEqual([]);

    expect(closeConnectionInPage(0)).toEqual({ success: true });
    expect(pc.closed).toBe(true);
    expect(pc.listenerCount("connectionstatechange")).toBe(0);
    expect(window.__rtcMonitoring.size).toBe(0);
    expect(window.__rtcPeerConnections[0]).toBeNull();
    expect(window.__rtcDataChannels[0]).toEqual([]);
    expect(window.__rtcICECandidates[0]).toEqual([]);
  });

  it("releases listeners from a replaced peer connection", () => {
    const original = new FakePeerConnection();
    const replacement = new FakePeerConnection();
    window.__rtcPeerConnections = [original];
    const limits = createWebRTCLimits({ maxMonitorEvents: 2 });

    expect(monitorConnectionInPage(0, limits).success).toBe(true);
    window.__rtcPeerConnections[0] = replacement;
    expect(monitorConnectionInPage(0, limits).success).toBe(true);
    expect(original.listenerCount("connectionstatechange")).toBe(0);
    expect(replacement.listenerCount("connectionstatechange")).toBe(1);

    expect(closeConnectionInPage(0)).toEqual({ success: true });
    expect(replacement.listenerCount("connectionstatechange")).toBe(0);
    expect(replacement.closed).toBe(true);
  });
});
