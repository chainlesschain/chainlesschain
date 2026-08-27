export const DEFAULT_PERFORMANCE_TRACE_LIMITS = Object.freeze({
  maxActiveTraces: 4,
});

export const HARD_PERFORMANCE_TRACE_LIMITS = Object.freeze({
  maxActiveTraces: 64,
});

const RETRY_AFTER_MS = 1000;

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

function createOverloadResult(scope, limits) {
  return {
    accepted: false,
    error:
      scope === "performance_trace_tab"
        ? "A performance trace is already running for this tab"
        : "Performance trace capacity exceeded",
    code: "OVERLOADED",
    scope,
    retryAfterMs: RETRY_AFTER_MS,
    limit: {
      maxActiveTraces: limits.maxActiveTraces,
      maxActiveTracesPerTab: 1,
    },
  };
}

/**
 * Tracks only bounded trace control state and aggregate counters. Raw CDP trace
 * events are deliberately never retained.
 */
export class PerformanceTraceRegistry {
  constructor(options = {}) {
    this.limits = Object.freeze({
      maxActiveTraces: normalizeLimit(
        options.maxActiveTraces,
        DEFAULT_PERFORMANCE_TRACE_LIMITS.maxActiveTraces,
        HARD_PERFORMANCE_TRACE_LIMITS.maxActiveTraces,
      ),
    });
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.activeTraces = new Map();
    this.activeTabs = new Map();
  }

  admit(tabId) {
    if (this.activeTabs.has(tabId)) {
      return createOverloadResult("performance_trace_tab", this.limits);
    }
    if (this.activeTraces.size >= this.limits.maxActiveTraces) {
      return createOverloadResult("performance_traces", this.limits);
    }

    const lease = Object.freeze({
      id: Symbol("performance-trace-lease"),
      tabId,
    });
    const state = {
      lease,
      tabId,
      startedAt: this.now(),
      phase: "starting",
      eventCount: 0,
      eventCountExact: true,
      listener: null,
    };
    this.activeTraces.set(lease, state);
    this.activeTabs.set(tabId, lease);
    return { accepted: true, lease };
  }

  bindListener(lease, listener) {
    const state = this.activeTraces.get(lease);
    if (!state) {
      return false;
    }
    state.listener = listener;
    return true;
  }

  markActive(lease) {
    const state = this.activeTraces.get(lease);
    if (!state || state.phase !== "starting") {
      return false;
    }
    state.phase = "active";
    return true;
  }

  beginStop(tabId) {
    const lease = this.activeTabs.get(tabId);
    if (!lease) {
      return {
        accepted: false,
        error: "No active performance trace for this tab",
        code: "TRACE_NOT_ACTIVE",
      };
    }

    const state = this.activeTraces.get(lease);
    if (state.phase === "starting") {
      return {
        accepted: false,
        error: "Performance trace is still starting",
        code: "TRACE_STARTING",
        retryAfterMs: RETRY_AFTER_MS,
      };
    }
    if (state.phase === "stopping") {
      return {
        accepted: false,
        error: "Performance trace is already stopping",
        code: "TRACE_STOPPING",
        retryAfterMs: RETRY_AFTER_MS,
      };
    }

    state.phase = "stopping";
    return { accepted: true, trace: this.snapshot(state) };
  }

  recordEventBatch(lease, eventCount) {
    const state = this.activeTraces.get(lease);
    if (!state || !Number.isSafeInteger(eventCount) || eventCount <= 0) {
      return false;
    }

    const remaining = Number.MAX_SAFE_INTEGER - state.eventCount;
    if (eventCount > remaining) {
      state.eventCount = Number.MAX_SAFE_INTEGER;
      state.eventCountExact = false;
    } else {
      state.eventCount += eventCount;
    }
    return true;
  }

  getByTab(tabId) {
    const lease = this.activeTabs.get(tabId);
    if (!lease) {
      return null;
    }
    return this.snapshot(this.activeTraces.get(lease));
  }

  release(lease) {
    const state = this.activeTraces.get(lease);
    if (!state) {
      return null;
    }

    this.activeTraces.delete(lease);
    if (this.activeTabs.get(state.tabId) === lease) {
      this.activeTabs.delete(state.tabId);
    }
    return this.snapshot(state);
  }

  getStats() {
    return {
      activeTraces: this.activeTraces.size,
      limits: this.limits,
    };
  }

  snapshot(state) {
    if (!state) {
      return null;
    }
    return Object.freeze({
      lease: state.lease,
      tabId: state.tabId,
      startedAt: state.startedAt,
      phase: state.phase,
      eventCount: state.eventCount,
      eventCountExact: state.eventCountExact,
      listener: state.listener,
    });
  }
}
