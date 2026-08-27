import { utf8ByteLength } from "./heap-snapshot-boundary.js";

const KIB = 1024;
const MIB = KIB * KIB;
const RETRY_AFTER_MS = 1000;

export const WEBSOCKET_SANITIZATION_LIMITS = Object.freeze({
  maxIdChars: 256,
  maxUrlChars: 4096,
  maxTextChars: 512,
  maxPayloadChars: 16 * KIB,
  maxOutboundBytes: 64 * KIB,
});

export const DEFAULT_WEBSOCKET_DEBUG_LIMITS = Object.freeze({
  maxActiveTabs: 8,
  maxConnectionsPerTab: 128,
  maxMessagesPerConnection: 500,
  maxMessagesPerTab: 2000,
  maxBytesPerConnection: MIB,
  maxBytesPerTab: 4 * MIB,
  maxTotalBytes: 16 * MIB,
  maxEntryBytes: 64 * KIB,
});

export const HARD_WEBSOCKET_DEBUG_LIMITS = Object.freeze({
  maxActiveTabs: 64,
  maxConnectionsPerTab: 1024,
  maxMessagesPerConnection: 5000,
  maxMessagesPerTab: 20_000,
  maxBytesPerConnection: 8 * MIB,
  maxBytesPerTab: 32 * MIB,
  maxTotalBytes: 128 * MIB,
  maxEntryBytes: 256 * KIB,
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

function truncate(value, maxChars) {
  if (typeof value === "string") {
    return value.slice(0, maxChars);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value).slice(0, maxChars);
  }
  return "";
}

function finiteNumber(value) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return undefined;
  }
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

function serializeEntry(entry) {
  try {
    const serialized = JSON.stringify(entry);
    return { serialized, bytes: utf8ByteLength(serialized) };
  } catch {
    return null;
  }
}

function overloaded(error, scope, limit) {
  return {
    accepted: false,
    error,
    code: "OVERLOADED",
    scope,
    retryAfterMs: RETRY_AFTER_MS,
    limit,
  };
}

export function sanitizeWebSocketConnection(params = {}, now = Date.now) {
  const initiator = params.initiator || {};
  return {
    id: truncate(params.requestId, WEBSOCKET_SANITIZATION_LIMITS.maxIdChars),
    url: truncate(params.url, WEBSOCKET_SANITIZATION_LIMITS.maxUrlChars),
    initiator: {
      type: truncate(
        initiator.type,
        WEBSOCKET_SANITIZATION_LIMITS.maxTextChars,
      ),
      url: truncate(initiator.url, WEBSOCKET_SANITIZATION_LIMITS.maxUrlChars),
      lineNumber: finiteNumber(initiator.lineNumber),
      columnNumber: finiteNumber(initiator.columnNumber),
    },
    createdAt: now(),
  };
}

export function sanitizeWebSocketFrame(method, params = {}) {
  const payload = truncate(
    params.response?.payloadData,
    WEBSOCKET_SANITIZATION_LIMITS.maxPayloadChars,
  );
  const original =
    typeof params.response?.payloadData === "string"
      ? params.response.payloadData
      : "";
  return {
    connectionId: truncate(
      params.requestId,
      WEBSOCKET_SANITIZATION_LIMITS.maxIdChars,
    ),
    type: method === "Network.webSocketFrameSent" ? "sent" : "received",
    data: payload,
    truncated: original.length > payload.length,
    opcode: finiteNumber(params.response?.opcode),
    timestamp: finiteNumber(params.timestamp),
  };
}

export function validateWebSocketOutboundData(data) {
  const serialized = truncate(
    data,
    WEBSOCKET_SANITIZATION_LIMITS.maxOutboundBytes,
  );
  const bytes = utf8ByteLength(serialized);
  if (
    typeof data !== "string" &&
    typeof data !== "number" &&
    typeof data !== "boolean" &&
    typeof data !== "bigint"
  ) {
    return {
      accepted: false,
      error: "WebSocket payload must be a string or primitive",
      code: "INVALID_ARGUMENT",
    };
  }
  if (
    String(data).length > WEBSOCKET_SANITIZATION_LIMITS.maxOutboundBytes ||
    bytes > WEBSOCKET_SANITIZATION_LIMITS.maxOutboundBytes
  ) {
    return overloaded("WebSocket payload is too large", "websocket_payload", {
      maxOutboundBytes: WEBSOCKET_SANITIZATION_LIMITS.maxOutboundBytes,
    });
  }
  return { accepted: true, data: serialized, bytes };
}

export function validateWebSocketConnectionId(connectionId) {
  if (typeof connectionId !== "string" || connectionId.length === 0) {
    return {
      accepted: false,
      error: "WebSocket connection ID must be a non-empty string",
      code: "INVALID_ARGUMENT",
    };
  }
  if (connectionId.length > WEBSOCKET_SANITIZATION_LIMITS.maxIdChars) {
    return overloaded(
      "WebSocket connection ID is too large",
      "websocket_connection_id",
      { maxIdChars: WEBSOCKET_SANITIZATION_LIMITS.maxIdChars },
    );
  }
  return { accepted: true, connectionId };
}

export class WebSocketDebugRegistry {
  constructor(options = {}) {
    const maxBytesPerConnection = normalizeLimit(
      options.maxBytesPerConnection,
      DEFAULT_WEBSOCKET_DEBUG_LIMITS.maxBytesPerConnection,
      HARD_WEBSOCKET_DEBUG_LIMITS.maxBytesPerConnection,
    );
    const maxBytesPerTab = Math.max(
      maxBytesPerConnection,
      normalizeLimit(
        options.maxBytesPerTab,
        DEFAULT_WEBSOCKET_DEBUG_LIMITS.maxBytesPerTab,
        HARD_WEBSOCKET_DEBUG_LIMITS.maxBytesPerTab,
      ),
    );
    this.limits = Object.freeze({
      maxActiveTabs: normalizeLimit(
        options.maxActiveTabs,
        DEFAULT_WEBSOCKET_DEBUG_LIMITS.maxActiveTabs,
        HARD_WEBSOCKET_DEBUG_LIMITS.maxActiveTabs,
      ),
      maxConnectionsPerTab: normalizeLimit(
        options.maxConnectionsPerTab,
        DEFAULT_WEBSOCKET_DEBUG_LIMITS.maxConnectionsPerTab,
        HARD_WEBSOCKET_DEBUG_LIMITS.maxConnectionsPerTab,
      ),
      maxMessagesPerConnection: normalizeLimit(
        options.maxMessagesPerConnection,
        DEFAULT_WEBSOCKET_DEBUG_LIMITS.maxMessagesPerConnection,
        HARD_WEBSOCKET_DEBUG_LIMITS.maxMessagesPerConnection,
      ),
      maxMessagesPerTab: normalizeLimit(
        options.maxMessagesPerTab,
        DEFAULT_WEBSOCKET_DEBUG_LIMITS.maxMessagesPerTab,
        HARD_WEBSOCKET_DEBUG_LIMITS.maxMessagesPerTab,
      ),
      maxBytesPerConnection,
      maxBytesPerTab,
      maxTotalBytes: Math.max(
        maxBytesPerTab,
        normalizeLimit(
          options.maxTotalBytes,
          DEFAULT_WEBSOCKET_DEBUG_LIMITS.maxTotalBytes,
          HARD_WEBSOCKET_DEBUG_LIMITS.maxTotalBytes,
        ),
      ),
      maxEntryBytes: Math.min(
        maxBytesPerConnection,
        normalizeLimit(
          options.maxEntryBytes,
          DEFAULT_WEBSOCKET_DEBUG_LIMITS.maxEntryBytes,
          HARD_WEBSOCKET_DEBUG_LIMITS.maxEntryBytes,
        ),
      ),
    });
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.tabs = new Map();
    this.totalBytes = 0;
    this.sequence = 0;
  }

  admit(tabId) {
    const existing = this.tabs.get(tabId);
    if (existing) {
      return overloaded(
        "WebSocket debugging is already active for this tab",
        "websocket_debug_tab",
        { maxActiveTabsPerTab: 1 },
      );
    }
    if (this.tabs.size >= this.limits.maxActiveTabs) {
      return overloaded(
        "WebSocket debugging capacity exceeded",
        "websocket_debug_tabs",
        { maxActiveTabs: this.limits.maxActiveTabs },
      );
    }
    const lease = Object.freeze({ id: Symbol("websocket-debug-lease"), tabId });
    const state = {
      lease,
      tabId,
      status: "starting",
      connections: new Map(),
      retainedBytes: 0,
      messageCount: 0,
      droppedConnections: 0,
      droppedMessages: 0,
      resources: null,
    };
    this.tabs.set(tabId, state);
    return { accepted: true, lease };
  }

  bindResources(lease, resources) {
    const state = this.stateForLease(lease);
    if (!state) {
      return false;
    }
    state.resources = resources;
    return true;
  }

  markActive(lease) {
    const state = this.stateForLease(lease);
    if (!state || state.status !== "starting") {
      return false;
    }
    state.status = "active";
    return true;
  }

  beginStop(tabId) {
    const state = this.tabs.get(tabId);
    if (!state) {
      return { accepted: false, code: "WEBSOCKET_DEBUG_NOT_FOUND" };
    }
    if (state.status !== "active") {
      return {
        accepted: false,
        error: `WebSocket debugging is ${state.status}`,
        code: "WEBSOCKET_DEBUG_BUSY",
        retryAfterMs: RETRY_AFTER_MS,
      };
    }
    state.status = "stopping";
    return { accepted: true, capture: this.controlSnapshot(state) };
  }

  recordConnection(lease, connection) {
    const state = this.activeState(lease);
    if (!state || !connection.id) {
      return false;
    }
    if (state.connections.has(connection.id)) {
      return true;
    }
    while (state.connections.size >= this.limits.maxConnectionsPerTab) {
      if (!this.evictOldestClosedConnection(state)) {
        state.droppedConnections += 1;
        return false;
      }
    }
    const encoded = serializeEntry(connection);
    if (
      !encoded ||
      encoded.bytes <= 0 ||
      encoded.bytes > this.limits.maxEntryBytes ||
      state.retainedBytes + encoded.bytes > this.limits.maxBytesPerTab ||
      this.totalBytes + encoded.bytes > this.limits.maxTotalBytes
    ) {
      state.droppedConnections += 1;
      return false;
    }
    state.connections.set(connection.id, {
      summary: JSON.parse(encoded.serialized),
      summaryBytes: encoded.bytes,
      messages: [],
      retainedBytes: 0,
      droppedMessages: 0,
      closedAt: undefined,
    });
    state.retainedBytes += encoded.bytes;
    this.totalBytes += encoded.bytes;
    return true;
  }

  closeConnection(lease, connectionId) {
    const state = this.activeState(lease);
    const connection = state?.connections.get(connectionId);
    if (!connection || connection.closedAt) {
      return false;
    }
    connection.closedAt = this.now();
    return true;
  }

  recordFrame(lease, frame) {
    const state = this.activeState(lease);
    const connection = state?.connections.get(frame.connectionId);
    if (!state || !connection) {
      if (state) {
        state.droppedMessages += 1;
      }
      return false;
    }
    const { connectionId: _connectionId, ...entry } = frame;
    const encoded = serializeEntry(entry);
    if (
      !encoded ||
      encoded.bytes <= 0 ||
      encoded.bytes > this.limits.maxEntryBytes ||
      encoded.bytes > this.limits.maxBytesPerConnection
    ) {
      connection.droppedMessages += 1;
      state.droppedMessages += 1;
      return false;
    }

    while (
      connection.messages.length >= this.limits.maxMessagesPerConnection ||
      connection.retainedBytes + encoded.bytes >
        this.limits.maxBytesPerConnection
    ) {
      if (!this.evictOldestMessage(state, connection)) {
        return this.dropMessage(state, connection);
      }
    }
    while (
      state.messageCount >= this.limits.maxMessagesPerTab ||
      state.retainedBytes + encoded.bytes > this.limits.maxBytesPerTab
    ) {
      if (!this.evictOldestTabMessage(state)) {
        return this.dropMessage(state, connection);
      }
    }
    while (this.totalBytes + encoded.bytes > this.limits.maxTotalBytes) {
      if (!this.evictOldestTabMessage(state)) {
        return this.dropMessage(state, connection);
      }
    }

    connection.messages.push({
      entry: JSON.parse(encoded.serialized),
      bytes: encoded.bytes,
      sequence: ++this.sequence,
    });
    connection.retainedBytes += encoded.bytes;
    state.retainedBytes += encoded.bytes;
    state.messageCount += 1;
    this.totalBytes += encoded.bytes;
    return true;
  }

  getConnections(tabId) {
    const state = this.tabs.get(tabId);
    if (!state) {
      return {
        connections: [],
        droppedConnections: 0,
        droppedMessages: 0,
        retainedBytes: 0,
        status: "inactive",
        limits: this.limits,
      };
    }
    return {
      connections: [...state.connections.values()].map((connection) => ({
        ...connection.summary,
        closedAt: connection.closedAt,
        messageCount: connection.messages.length,
        droppedMessages: connection.droppedMessages,
        retainedBytes: connection.retainedBytes,
      })),
      droppedConnections: state.droppedConnections,
      droppedMessages: state.droppedMessages,
      retainedBytes: state.retainedBytes,
      status: state.status,
      limits: this.limits,
    };
  }

  getMessages(tabId, connectionId) {
    const state = this.tabs.get(tabId);
    const connection = state?.connections.get(connectionId);
    return {
      messages: connection
        ? connection.messages.map(({ entry }) => ({ ...entry }))
        : [],
      droppedMessages: connection?.droppedMessages || 0,
      retainedBytes: connection?.retainedBytes || 0,
      status: state?.status || "inactive",
      limits: this.limits,
    };
  }

  complete(lease) {
    const state = this.stateForLease(lease);
    if (!state) {
      return false;
    }
    this.removeState(state);
    return true;
  }

  getControl(tabId) {
    const state = this.tabs.get(tabId);
    return state ? this.controlSnapshot(state) : null;
  }

  getStats() {
    return {
      activeTabs: this.tabs.size,
      totalBytes: this.totalBytes,
      limits: this.limits,
    };
  }

  stateForLease(lease) {
    if (!lease) {
      return null;
    }
    const state = this.tabs.get(lease.tabId);
    return state?.lease === lease ? state : null;
  }

  activeState(lease) {
    const state = this.stateForLease(lease);
    return state && (state.status === "starting" || state.status === "active")
      ? state
      : null;
  }

  controlSnapshot(state) {
    return Object.freeze({
      lease: state.lease,
      tabId: state.tabId,
      status: state.status,
      resources: state.resources,
    });
  }

  evictOldestClosedConnection(state) {
    for (const connection of state.connections.values()) {
      if (connection.closedAt) {
        state.droppedMessages += connection.messages.length;
        this.removeConnection(state, connection.summary.id);
        state.droppedConnections += 1;
        return true;
      }
    }
    return false;
  }

  evictOldestTabMessage(state) {
    let oldestConnection = null;
    let oldestSequence = Number.POSITIVE_INFINITY;
    for (const connection of state.connections.values()) {
      const candidate = connection.messages[0];
      if (candidate && candidate.sequence < oldestSequence) {
        oldestConnection = connection;
        oldestSequence = candidate.sequence;
      }
    }
    return oldestConnection
      ? this.evictOldestMessage(state, oldestConnection)
      : false;
  }

  evictOldestMessage(state, connection) {
    const oldest = connection.messages.shift();
    if (!oldest) {
      return false;
    }
    connection.retainedBytes -= oldest.bytes;
    connection.droppedMessages += 1;
    state.retainedBytes -= oldest.bytes;
    state.messageCount -= 1;
    state.droppedMessages += 1;
    this.totalBytes -= oldest.bytes;
    return true;
  }

  dropMessage(state, connection) {
    connection.droppedMessages += 1;
    state.droppedMessages += 1;
    return false;
  }

  removeConnection(state, connectionId) {
    const connection = state.connections.get(connectionId);
    if (!connection) {
      return false;
    }
    const bytes = connection.summaryBytes + connection.retainedBytes;
    state.retainedBytes -= bytes;
    state.messageCount -= connection.messages.length;
    this.totalBytes -= bytes;
    state.connections.delete(connectionId);
    return true;
  }

  removeState(state) {
    this.totalBytes -= state.retainedBytes;
    this.tabs.delete(state.tabId);
  }
}
