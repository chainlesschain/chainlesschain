import { utf8ByteLength } from "./heap-snapshot-boundary.js";

const MIB = 1024 * 1024;
const RETRY_AFTER_MS = 1000;

export const DEFAULT_CONSOLE_CAPTURE_LIMITS = Object.freeze({
  maxActiveCaptures: 8,
  maxRetainedCaptures: 32,
  maxLogsPerCapture: 1000,
  maxBytesPerCapture: MIB,
  maxTotalBytes: 8 * MIB,
  maxEntryBytes: 64 * 1024,
});

export const HARD_CONSOLE_CAPTURE_LIMITS = Object.freeze({
  maxActiveCaptures: 64,
  maxRetainedCaptures: 256,
  maxLogsPerCapture: 10_000,
  maxBytesPerCapture: 8 * MIB,
  maxTotalBytes: 64 * MIB,
  maxEntryBytes: 256 * 1024,
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

function createStateError(state) {
  if (!state) {
    return {
      accepted: false,
      error: "No console capture exists for this tab",
      code: "CONSOLE_CAPTURE_NOT_FOUND",
    };
  }
  return {
    accepted: false,
    error:
      state.status === "starting"
        ? "Console capture is still starting"
        : "Console capture is already stopping",
    code:
      state.status === "starting"
        ? "CONSOLE_CAPTURE_STARTING"
        : "CONSOLE_CAPTURE_STOPPING",
    retryAfterMs: RETRY_AFTER_MS,
  };
}

export class ConsoleCaptureRegistry {
  constructor(options = {}) {
    const maxActiveCaptures = normalizeLimit(
      options.maxActiveCaptures,
      DEFAULT_CONSOLE_CAPTURE_LIMITS.maxActiveCaptures,
      HARD_CONSOLE_CAPTURE_LIMITS.maxActiveCaptures,
    );
    const maxBytesPerCapture = normalizeLimit(
      options.maxBytesPerCapture,
      DEFAULT_CONSOLE_CAPTURE_LIMITS.maxBytesPerCapture,
      HARD_CONSOLE_CAPTURE_LIMITS.maxBytesPerCapture,
    );
    this.limits = Object.freeze({
      maxActiveCaptures,
      maxRetainedCaptures: Math.max(
        maxActiveCaptures,
        normalizeLimit(
          options.maxRetainedCaptures,
          DEFAULT_CONSOLE_CAPTURE_LIMITS.maxRetainedCaptures,
          HARD_CONSOLE_CAPTURE_LIMITS.maxRetainedCaptures,
        ),
      ),
      maxLogsPerCapture: normalizeLimit(
        options.maxLogsPerCapture,
        DEFAULT_CONSOLE_CAPTURE_LIMITS.maxLogsPerCapture,
        HARD_CONSOLE_CAPTURE_LIMITS.maxLogsPerCapture,
      ),
      maxBytesPerCapture,
      maxTotalBytes: Math.max(
        maxBytesPerCapture,
        normalizeLimit(
          options.maxTotalBytes,
          DEFAULT_CONSOLE_CAPTURE_LIMITS.maxTotalBytes,
          HARD_CONSOLE_CAPTURE_LIMITS.maxTotalBytes,
        ),
      ),
      maxEntryBytes: Math.min(
        maxBytesPerCapture,
        normalizeLimit(
          options.maxEntryBytes,
          DEFAULT_CONSOLE_CAPTURE_LIMITS.maxEntryBytes,
          HARD_CONSOLE_CAPTURE_LIMITS.maxEntryBytes,
        ),
      ),
    });
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.captures = new Map();
    this.activeCount = 0;
    this.totalBytes = 0;
  }

  admit(tabId) {
    const existing = this.captures.get(tabId);
    if (existing && existing.status !== "inactive") {
      return {
        accepted: false,
        error: "Console capture is already active for this tab",
        code: "OVERLOADED",
        scope: "console_capture_tab",
        retryAfterMs: RETRY_AFTER_MS,
        limit: { maxActiveCapturesPerTab: 1 },
      };
    }
    if (this.activeCount >= this.limits.maxActiveCaptures) {
      return {
        accepted: false,
        error: "Console capture capacity exceeded",
        code: "OVERLOADED",
        scope: "console_captures",
        retryAfterMs: RETRY_AFTER_MS,
        limit: { maxActiveCaptures: this.limits.maxActiveCaptures },
      };
    }

    if (existing) {
      this.removeState(existing);
    }
    while (this.captures.size >= this.limits.maxRetainedCaptures) {
      if (!this.evictOldestInactive()) {
        break;
      }
    }

    const lease = Object.freeze({
      id: Symbol("console-capture-lease"),
      tabId,
    });
    const timestamp = this.now();
    const state = {
      lease,
      tabId,
      status: "starting",
      startedAt: timestamp,
      updatedAt: timestamp,
      logs: [],
      retainedBytes: 0,
      droppedLogs: 0,
      resources: null,
    };
    this.captures.set(tabId, state);
    this.activeCount += 1;
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
    state.updatedAt = this.now();
    return true;
  }

  beginStop(tabId) {
    const state = this.captures.get(tabId);
    if (!state || state.status === "inactive") {
      return createStateError(null);
    }
    if (state.status !== "active") {
      return createStateError(state);
    }
    state.status = "stopping";
    state.updatedAt = this.now();
    return { accepted: true, capture: this.controlSnapshot(state) };
  }

  append(lease, entry) {
    const state = this.stateForLease(lease);
    if (!state || (state.status !== "starting" && state.status !== "active")) {
      return false;
    }

    let serialized;
    try {
      serialized = JSON.stringify(entry);
    } catch {
      state.droppedLogs += 1;
      return false;
    }
    const entryBytes = utf8ByteLength(serialized);
    if (
      entryBytes <= 0 ||
      entryBytes > this.limits.maxEntryBytes ||
      entryBytes > this.limits.maxBytesPerCapture
    ) {
      state.droppedLogs += 1;
      return false;
    }

    while (
      state.logs.length >= this.limits.maxLogsPerCapture ||
      state.retainedBytes + entryBytes > this.limits.maxBytesPerCapture
    ) {
      if (!this.evictOldestLog(state)) {
        state.droppedLogs += 1;
        return false;
      }
    }
    while (this.totalBytes + entryBytes > this.limits.maxTotalBytes) {
      if (this.evictOldestInactive(state.tabId)) {
        continue;
      }
      if (!this.evictOldestLog(state)) {
        state.droppedLogs += 1;
        return false;
      }
    }

    state.logs.push({ entry, bytes: entryBytes });
    state.retainedBytes += entryBytes;
    state.updatedAt = this.now();
    this.totalBytes += entryBytes;
    return true;
  }

  complete(lease) {
    const state = this.stateForLease(lease);
    if (!state) {
      return null;
    }
    if (state.status !== "inactive") {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
    state.status = "inactive";
    state.resources = null;
    state.updatedAt = this.now();
    return this.controlSnapshot(state);
  }

  failStart(lease) {
    const state = this.stateForLease(lease);
    if (!state) {
      return false;
    }
    if (state.status !== "inactive") {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
    this.removeState(state);
    return true;
  }

  getControl(tabId) {
    const state = this.captures.get(tabId);
    return state ? this.controlSnapshot(state) : null;
  }

  getLogs(tabId) {
    const state = this.captures.get(tabId);
    if (!state) {
      return {
        logs: [],
        droppedLogs: 0,
        retainedBytes: 0,
        status: "inactive",
        limits: this.limits,
      };
    }
    return {
      logs: state.logs.map(({ entry }) => entry),
      droppedLogs: state.droppedLogs,
      retainedBytes: state.retainedBytes,
      status: state.status,
      limits: this.limits,
    };
  }

  clear(tabId) {
    const state = this.captures.get(tabId);
    if (!state) {
      return false;
    }
    this.totalBytes -= state.retainedBytes;
    state.logs = [];
    state.retainedBytes = 0;
    state.droppedLogs = 0;
    state.updatedAt = this.now();
    return true;
  }

  getStats() {
    return {
      activeCaptures: this.activeCount,
      retainedCaptures: this.captures.size,
      totalBytes: this.totalBytes,
      limits: this.limits,
    };
  }

  stateForLease(lease) {
    if (!lease) {
      return null;
    }
    const state = this.captures.get(lease.tabId);
    return state?.lease === lease ? state : null;
  }

  controlSnapshot(state) {
    return Object.freeze({
      lease: state.lease,
      tabId: state.tabId,
      status: state.status,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      resources: state.resources,
    });
  }

  evictOldestLog(state) {
    const oldest = state.logs.shift();
    if (!oldest) {
      return false;
    }
    state.retainedBytes -= oldest.bytes;
    this.totalBytes -= oldest.bytes;
    state.droppedLogs += 1;
    return true;
  }

  evictOldestInactive(excludedTabId) {
    for (const state of this.captures.values()) {
      if (state.status === "inactive" && state.tabId !== excludedTabId) {
        this.removeState(state);
        return true;
      }
    }
    return false;
  }

  removeState(state) {
    this.totalBytes -= state.retainedBytes;
    this.captures.delete(state.tabId);
  }
}
