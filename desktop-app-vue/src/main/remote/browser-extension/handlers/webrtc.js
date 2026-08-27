/**
 * Bounded WebRTC inspection and monitoring handlers.
 */

/* eslint-disable no-undef */
/* global chrome, window, TextEncoder, JSON, Array, Map, String */

const KIB = 1024;

export const DEFAULT_WEBRTC_LIMITS = Object.freeze({
  maxPeerConnections: 64,
  maxStats: 500,
  maxStatBytes: 8 * KIB,
  maxStatsBytes: 1024 * KIB,
  maxDataChannels: 128,
  maxMediaStreams: 128,
  maxTracksPerStream: 32,
  maxIceCandidates: 256,
  maxCandidateChars: 2 * KIB,
  maxSdpChars: 4 * KIB,
  maxMonitorEvents: 500,
  maxStateChars: 64,
});

export const HARD_WEBRTC_LIMITS = Object.freeze({
  maxPeerConnections: 256,
  maxStats: 5000,
  maxStatBytes: 64 * KIB,
  maxStatsBytes: 8 * 1024 * KIB,
  maxDataChannels: 1024,
  maxMediaStreams: 1024,
  maxTracksPerStream: 128,
  maxIceCandidates: 2048,
  maxCandidateChars: 8 * KIB,
  maxSdpChars: 32 * KIB,
  maxMonitorEvents: 5000,
  maxStateChars: 256,
});

function normalizeLimit(value, fallback, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

export function createWebRTCLimits(options = {}) {
  const maxStatsBytes = normalizeLimit(
    options.maxStatsBytes,
    DEFAULT_WEBRTC_LIMITS.maxStatsBytes,
    HARD_WEBRTC_LIMITS.maxStatsBytes,
  );
  return Object.freeze({
    maxPeerConnections: normalizeLimit(
      options.maxPeerConnections,
      DEFAULT_WEBRTC_LIMITS.maxPeerConnections,
      HARD_WEBRTC_LIMITS.maxPeerConnections,
    ),
    maxStats: normalizeLimit(
      options.maxStats,
      DEFAULT_WEBRTC_LIMITS.maxStats,
      HARD_WEBRTC_LIMITS.maxStats,
    ),
    maxStatBytes: Math.min(
      maxStatsBytes,
      normalizeLimit(
        options.maxStatBytes,
        DEFAULT_WEBRTC_LIMITS.maxStatBytes,
        HARD_WEBRTC_LIMITS.maxStatBytes,
      ),
    ),
    maxStatsBytes,
    maxDataChannels: normalizeLimit(
      options.maxDataChannels,
      DEFAULT_WEBRTC_LIMITS.maxDataChannels,
      HARD_WEBRTC_LIMITS.maxDataChannels,
    ),
    maxMediaStreams: normalizeLimit(
      options.maxMediaStreams,
      DEFAULT_WEBRTC_LIMITS.maxMediaStreams,
      HARD_WEBRTC_LIMITS.maxMediaStreams,
    ),
    maxTracksPerStream: normalizeLimit(
      options.maxTracksPerStream,
      DEFAULT_WEBRTC_LIMITS.maxTracksPerStream,
      HARD_WEBRTC_LIMITS.maxTracksPerStream,
    ),
    maxIceCandidates: normalizeLimit(
      options.maxIceCandidates,
      DEFAULT_WEBRTC_LIMITS.maxIceCandidates,
      HARD_WEBRTC_LIMITS.maxIceCandidates,
    ),
    maxCandidateChars: normalizeLimit(
      options.maxCandidateChars,
      DEFAULT_WEBRTC_LIMITS.maxCandidateChars,
      HARD_WEBRTC_LIMITS.maxCandidateChars,
    ),
    maxSdpChars: normalizeLimit(
      options.maxSdpChars,
      DEFAULT_WEBRTC_LIMITS.maxSdpChars,
      HARD_WEBRTC_LIMITS.maxSdpChars,
    ),
    maxMonitorEvents: normalizeLimit(
      options.maxMonitorEvents,
      DEFAULT_WEBRTC_LIMITS.maxMonitorEvents,
      HARD_WEBRTC_LIMITS.maxMonitorEvents,
    ),
    maxStateChars: normalizeLimit(
      options.maxStateChars,
      DEFAULT_WEBRTC_LIMITS.maxStateChars,
      HARD_WEBRTC_LIMITS.maxStateChars,
    ),
  });
}

export function validateConnectionId(connectionId, maxPeerConnections) {
  if (
    !Number.isInteger(connectionId) ||
    connectionId < 0 ||
    connectionId >= maxPeerConnections
  ) {
    return {
      accepted: false,
      error: "Invalid WebRTC connection ID",
      code: "INVALID_ARGUMENT",
      limit: { maxPeerConnections },
    };
  }
  return { accepted: true, connectionId };
}

export function listPeerConnectionsInPage(limits) {
  const connections = Array.isArray(window.__rtcPeerConnections)
    ? window.__rtcPeerConnections
    : [];
  const bounded = [];
  const upperBound = Math.min(connections.length, limits.maxPeerConnections);
  for (let index = 0; index < upperBound; index += 1) {
    const pc = connections[index];
    if (!pc) {
      continue;
    }
    bounded.push({
      id: index,
      connectionState: String(pc.connectionState || "").slice(
        0,
        limits.maxStateChars,
      ),
      iceConnectionState: String(pc.iceConnectionState || "").slice(
        0,
        limits.maxStateChars,
      ),
      iceGatheringState: String(pc.iceGatheringState || "").slice(
        0,
        limits.maxStateChars,
      ),
      signalingState: String(pc.signalingState || "").slice(
        0,
        limits.maxStateChars,
      ),
      localStreams: pc.getLocalStreams?.()?.length || 0,
      remoteStreams: pc.getRemoteStreams?.()?.length || 0,
    });
  }
  return {
    connections: bounded,
    droppedConnections: Math.max(0, connections.length - upperBound),
  };
}

export async function getConnectionStatsInPage(connId, limits) {
  const connections = Array.isArray(window.__rtcPeerConnections)
    ? window.__rtcPeerConnections
    : [];
  const pc = connections[connId];
  if (!pc) {
    return { error: "Connection not found" };
  }
  try {
    const report = await pc.getStats();
    const stats = [];
    let retainedBytes = 0;
    let droppedStats = 0;
    report.forEach((stat) => {
      if (stats.length >= limits.maxStats) {
        droppedStats += 1;
        return;
      }
      try {
        const serialized = JSON.stringify({
          ...stat,
          id: stat.id,
          type: stat.type,
          timestamp: stat.timestamp,
        });
        if (typeof serialized !== "string") {
          droppedStats += 1;
          return;
        }
        const bytes = new TextEncoder().encode(serialized).byteLength;
        if (
          bytes > limits.maxStatBytes ||
          retainedBytes + bytes > limits.maxStatsBytes
        ) {
          droppedStats += 1;
          return;
        }
        stats.push(JSON.parse(serialized));
        retainedBytes += bytes;
      } catch {
        droppedStats += 1;
      }
    });
    return { stats, retainedBytes, droppedStats };
  } catch (error) {
    return { error: error.message };
  }
}

export function getDataChannelsInPage(connId, limits) {
  const connections = Array.isArray(window.__rtcPeerConnections)
    ? window.__rtcPeerConnections
    : [];
  if (!connections[connId]) {
    return { error: "Connection not found" };
  }
  const byConnection = window.__rtcDataChannels;
  const channels = Array.isArray(byConnection?.[connId])
    ? byConnection[connId]
    : [];
  return {
    channels: channels.slice(0, limits.maxDataChannels).map((channel) => ({
      label: String(channel.label || "").slice(0, limits.maxStateChars),
      id: channel.id,
      readyState: String(channel.readyState || "").slice(
        0,
        limits.maxStateChars,
      ),
      bufferedAmount: Number.isFinite(channel.bufferedAmount)
        ? channel.bufferedAmount
        : 0,
      ordered: channel.ordered === true,
      protocol: String(channel.protocol || "").slice(0, limits.maxStateChars),
    })),
    droppedChannels: Math.max(0, channels.length - limits.maxDataChannels),
  };
}

export function getMediaStreamsInPage(limits) {
  const connections = Array.isArray(window.__rtcPeerConnections)
    ? window.__rtcPeerConnections
    : [];
  const streams = [];
  let droppedStreams = 0;
  const connectionLimit = Math.min(
    connections.length,
    limits.maxPeerConnections,
  );

  const retainStreams = (pcStreams, connectionId, type) => {
    const candidates = Array.isArray(pcStreams) ? pcStreams : [];
    for (
      let streamIndex = 0;
      streamIndex < candidates.length;
      streamIndex += 1
    ) {
      const stream = candidates[streamIndex];
      if (streams.length >= limits.maxMediaStreams) {
        droppedStreams += candidates.length - streamIndex;
        break;
      }
      const tracks = Array.from(stream.getTracks?.() || []);
      streams.push({
        connectionId,
        type,
        id: String(stream.id || "").slice(0, limits.maxStateChars),
        active: stream.active === true,
        tracks: tracks.slice(0, limits.maxTracksPerStream).map((track) => ({
          kind: String(track.kind || "").slice(0, limits.maxStateChars),
          id: String(track.id || "").slice(0, limits.maxStateChars),
          label: String(track.label || "").slice(0, limits.maxStateChars),
          enabled: track.enabled === true,
          muted: track.muted === true,
          readyState: String(track.readyState || "").slice(
            0,
            limits.maxStateChars,
          ),
        })),
        droppedTracks: Math.max(0, tracks.length - limits.maxTracksPerStream),
      });
    }
  };

  for (let index = 0; index < connectionLimit; index += 1) {
    const pc = connections[index];
    if (!pc) {
      continue;
    }
    retainStreams(pc.getLocalStreams?.(), index, "local");
    retainStreams(pc.getRemoteStreams?.(), index, "remote");
  }
  return { streams, droppedStreams };
}

export function getIceCandidatesInPage(connId, limits) {
  const byConnection = window.__rtcICECandidates;
  const candidates = Array.isArray(byConnection?.[connId])
    ? byConnection[connId]
    : [];
  return {
    candidates: candidates
      .slice(0, limits.maxIceCandidates)
      .map((candidate) => ({
        candidate: String(candidate.candidate || "").slice(
          0,
          limits.maxCandidateChars,
        ),
        sdpMid: String(candidate.sdpMid || "").slice(0, limits.maxStateChars),
        sdpMLineIndex: candidate.sdpMLineIndex,
        type: String(candidate.type || "").slice(0, limits.maxStateChars),
        protocol: String(candidate.protocol || "").slice(
          0,
          limits.maxStateChars,
        ),
        address: String(candidate.address || "").slice(0, limits.maxStateChars),
        port: candidate.port,
      })),
    droppedCandidates: Math.max(0, candidates.length - limits.maxIceCandidates),
  };
}

export function getDescriptionInPage(connId, kind, limits) {
  const connections = Array.isArray(window.__rtcPeerConnections)
    ? window.__rtcPeerConnections
    : [];
  const pc = connections[connId];
  if (!pc) {
    return { error: "Connection not found" };
  }
  const description =
    kind === "local" ? pc.localDescription : pc.remoteDescription;
  return description
    ? {
        type: String(description.type || "").slice(0, limits.maxStateChars),
        sdp: String(description.sdp || "").slice(0, limits.maxSdpChars),
      }
    : null;
}

export function monitorConnectionInPage(connId, limits) {
  const connections = Array.isArray(window.__rtcPeerConnections)
    ? window.__rtcPeerConnections
    : [];
  const pc = connections[connId];
  if (!pc) {
    return { error: "Connection not found" };
  }
  if (!(window.__rtcMonitoring instanceof Map)) {
    window.__rtcMonitoring = new Map();
  }
  const monitors = window.__rtcMonitoring;
  const previous = monitors.get(connId);
  if (previous) {
    const previousPeerConnection = previous.peerConnection || pc;
    previousPeerConnection.removeEventListener?.(
      "connectionstatechange",
      previous.connectionHandler,
    );
    previousPeerConnection.removeEventListener?.(
      "iceconnectionstatechange",
      previous.iceConnectionHandler,
    );
    previous.events.length = 0;
    monitors.delete(connId);
  }
  if (monitors.size >= limits.maxPeerConnections) {
    return {
      accepted: false,
      error: "WebRTC monitor capacity exceeded",
      code: "OVERLOADED",
      scope: "webrtc_monitors",
      retryAfterMs: 1000,
      limit: { maxPeerConnections: limits.maxPeerConnections },
    };
  }

  const monitor = {
    events: [],
    startTime: Date.now(),
    droppedEvents: 0,
    peerConnection: pc,
    connectionHandler: null,
    iceConnectionHandler: null,
  };
  const retainEvent = (type, state) => {
    if (monitor.events.length >= limits.maxMonitorEvents) {
      monitor.events.shift();
      monitor.droppedEvents += 1;
    }
    monitor.events.push({
      type,
      state: String(state || "").slice(0, limits.maxStateChars),
      timestamp: Date.now(),
    });
  };
  monitor.connectionHandler = () => {
    retainEvent("connectionstatechange", pc.connectionState);
  };
  monitor.iceConnectionHandler = () => {
    retainEvent("iceconnectionstatechange", pc.iceConnectionState);
  };
  pc.addEventListener?.("connectionstatechange", monitor.connectionHandler);
  pc.addEventListener?.(
    "iceconnectionstatechange",
    monitor.iceConnectionHandler,
  );
  monitors.set(connId, monitor);
  return {
    success: true,
    message: "Monitoring started",
    limit: { maxMonitorEvents: limits.maxMonitorEvents },
  };
}

export function closeConnectionInPage(connId) {
  const connections = Array.isArray(window.__rtcPeerConnections)
    ? window.__rtcPeerConnections
    : [];
  const pc = connections[connId];
  if (!pc) {
    return { error: "Connection not found" };
  }
  const monitors = window.__rtcMonitoring;
  const monitor = monitors instanceof Map ? monitors.get(connId) : null;
  if (monitor) {
    const monitoredPeerConnection = monitor.peerConnection || pc;
    monitoredPeerConnection.removeEventListener?.(
      "connectionstatechange",
      monitor.connectionHandler,
    );
    monitoredPeerConnection.removeEventListener?.(
      "iceconnectionstatechange",
      monitor.iceConnectionHandler,
    );
    monitor.events.length = 0;
    monitors.delete(connId);
  }
  pc.close();
  connections[connId] = null;
  if (Array.isArray(window.__rtcDataChannels?.[connId])) {
    window.__rtcDataChannels[connId].length = 0;
  }
  if (Array.isArray(window.__rtcICECandidates?.[connId])) {
    window.__rtcICECandidates[connId].length = 0;
  }
  return { success: true };
}

const webRTCLimits = createWebRTCLimits();

async function executeForConnection(tabId, connectionId, func, extraArgs = []) {
  const validation = validateConnectionId(
    connectionId,
    webRTCLimits.maxPeerConnections,
  );
  if (!validation.accepted) {
    return validation;
  }
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args: [validation.connectionId, ...extraArgs],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getWebRTCPeerConnections(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: listPeerConnectionsInPage,
      args: [webRTCLimits],
    });
    return result[0]?.result || { connections: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export const getWebRTCConnectionStats = (tabId, connectionId) =>
  executeForConnection(tabId, connectionId, getConnectionStatsInPage, [
    webRTCLimits,
  ]);

export const getWebRTCDataChannels = (tabId, connectionId) =>
  executeForConnection(tabId, connectionId, getDataChannelsInPage, [
    webRTCLimits,
  ]);

export async function getWebRTCMediaStreams(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: getMediaStreamsInPage,
      args: [webRTCLimits],
    });
    return result[0]?.result || { streams: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export const getICECandidates = (tabId, connectionId) =>
  executeForConnection(tabId, connectionId, getIceCandidatesInPage, [
    webRTCLimits,
  ]);

export const getLocalDescription = (tabId, connectionId) =>
  executeForConnection(tabId, connectionId, getDescriptionInPage, [
    "local",
    webRTCLimits,
  ]);

export const getRemoteDescription = (tabId, connectionId) =>
  executeForConnection(tabId, connectionId, getDescriptionInPage, [
    "remote",
    webRTCLimits,
  ]);

export const monitorWebRTCConnection = (tabId, connectionId) =>
  executeForConnection(tabId, connectionId, monitorConnectionInPage, [
    webRTCLimits,
  ]);

export const closeWebRTCConnection = (tabId, connectionId) =>
  executeForConnection(tabId, connectionId, closeConnectionInPage);

export const webRTCHandlers = {
  "webrtc.getPeerConnections": ({ tabId }) => getWebRTCPeerConnections(tabId),
  "webrtc.getConnectionStats": ({ tabId, connectionId }) =>
    getWebRTCConnectionStats(tabId, connectionId),
  "webrtc.getDataChannels": ({ tabId, connectionId }) =>
    getWebRTCDataChannels(tabId, connectionId),
  "webrtc.getMediaStreams": ({ tabId }) => getWebRTCMediaStreams(tabId),
  "webrtc.getICECandidates": ({ tabId, connectionId }) =>
    getICECandidates(tabId, connectionId),
  "webrtc.getLocalDescription": ({ tabId, connectionId }) =>
    getLocalDescription(tabId, connectionId),
  "webrtc.getRemoteDescription": ({ tabId, connectionId }) =>
    getRemoteDescription(tabId, connectionId),
  "webrtc.monitorConnection": ({ tabId, connectionId }) =>
    monitorWebRTCConnection(tabId, connectionId),
  "webrtc.closeConnection": ({ tabId, connectionId }) =>
    closeWebRTCConnection(tabId, connectionId),
};
