const KIB = 1024;
const MIB = KIB * KIB;
const RETRY_AFTER_MS = 1000;

export const DEFAULT_ACTIVE_PAGE_MONITOR_LIMITS = Object.freeze({
  maxActiveMonitors: 32,
});

export const HARD_ACTIVE_PAGE_MONITOR_LIMITS = Object.freeze({
  maxActiveMonitors: 256,
});

export const PAGE_MONITOR_INPUT_LIMITS = Object.freeze({
  maxSelectorChars: 2048,
  maxEventTypes: 32,
  maxEventTypeChars: 64,
});

export const EVENT_MONITOR_LIMITS = Object.freeze({
  maxReturnedListeners: 500,
  maxEntries: 500,
  maxEntryBytes: 4 * KIB,
  maxTotalBytes: 256 * KIB,
  maxTargetChars: 256,
  maxKeyChars: 64,
  maxValueChars: 256,
});

export const MUTATION_MONITOR_LIMITS = Object.freeze({
  maxEntries: 1000,
  maxEntryBytes: 8 * KIB,
  maxTotalBytes: MIB,
  maxTargetChars: 256,
  maxAttributeChars: 128,
  maxOldValueChars: 1024,
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

export class ActivePageMonitorRegistry {
  constructor(options = {}) {
    this.kind =
      typeof options.kind === "string" && options.kind.length > 0
        ? options.kind
        : "page";
    this.limits = Object.freeze({
      maxActiveMonitors: normalizeLimit(
        options.maxActiveMonitors,
        DEFAULT_ACTIVE_PAGE_MONITOR_LIMITS.maxActiveMonitors,
        HARD_ACTIVE_PAGE_MONITOR_LIMITS.maxActiveMonitors,
      ),
    });
    this.monitors = new Map();
  }

  admit(tabId) {
    if (this.monitors.has(tabId)) {
      return overloaded(
        `${this.kind} monitoring is already active for this tab`,
        `${this.kind}_monitor_tab`,
        { maxActiveMonitorsPerTab: 1 },
      );
    }
    if (this.monitors.size >= this.limits.maxActiveMonitors) {
      return overloaded(
        `${this.kind} monitor capacity exceeded`,
        `${this.kind}_monitors`,
        { maxActiveMonitors: this.limits.maxActiveMonitors },
      );
    }
    const lease = Object.freeze({
      id: Symbol(`${this.kind}-monitor-lease`),
      tabId,
    });
    this.monitors.set(tabId, { lease, tabId, status: "starting" });
    return { accepted: true, lease };
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
    const state = this.monitors.get(tabId);
    if (!state) {
      return { accepted: false, code: "PAGE_MONITOR_NOT_FOUND" };
    }
    if (state.status !== "active") {
      return {
        accepted: false,
        error: `${this.kind} monitoring is ${state.status}`,
        code: "PAGE_MONITOR_BUSY",
        retryAfterMs: RETRY_AFTER_MS,
      };
    }
    state.status = "stopping";
    return { accepted: true, lease: state.lease };
  }

  cancelStop(lease) {
    const state = this.stateForLease(lease);
    if (!state || state.status !== "stopping") {
      return false;
    }
    state.status = "active";
    return true;
  }

  complete(lease) {
    const state = this.stateForLease(lease);
    if (!state) {
      return false;
    }
    this.monitors.delete(state.tabId);
    return true;
  }

  clearTab(tabId) {
    return this.monitors.delete(tabId);
  }

  getControl(tabId) {
    const state = this.monitors.get(tabId);
    return state
      ? Object.freeze({ lease: state.lease, tabId, status: state.status })
      : null;
  }

  getStats() {
    return { activeMonitors: this.monitors.size, limits: this.limits };
  }

  stateForLease(lease) {
    if (!lease) {
      return null;
    }
    const state = this.monitors.get(lease.tabId);
    return state?.lease === lease ? state : null;
  }
}

export function validatePageMonitorSelector(selector) {
  if (selector === undefined || selector === null || selector === "") {
    return { accepted: true, selector: "" };
  }
  if (typeof selector !== "string") {
    return {
      accepted: false,
      error: "Page monitor selector must be a string",
      code: "INVALID_ARGUMENT",
    };
  }
  if (selector.length > PAGE_MONITOR_INPUT_LIMITS.maxSelectorChars) {
    return overloaded(
      "Page monitor selector is too large",
      "monitor_selector",
      {
        maxSelectorChars: PAGE_MONITOR_INPUT_LIMITS.maxSelectorChars,
      },
    );
  }
  return { accepted: true, selector };
}

export function validateEventMonitorTypes(eventTypes = []) {
  if (!Array.isArray(eventTypes)) {
    return {
      accepted: false,
      error: "Event monitor types must be an array",
      code: "INVALID_ARGUMENT",
    };
  }
  if (eventTypes.length > PAGE_MONITOR_INPUT_LIMITS.maxEventTypes) {
    return overloaded("Too many event monitor types", "event_monitor_types", {
      maxEventTypes: PAGE_MONITOR_INPUT_LIMITS.maxEventTypes,
    });
  }
  const normalized = [];
  const seen = new Set();
  for (const eventType of eventTypes) {
    if (typeof eventType !== "string" || eventType.length === 0) {
      return {
        accepted: false,
        error: "Event monitor types must be non-empty strings",
        code: "INVALID_ARGUMENT",
      };
    }
    if (eventType.length > PAGE_MONITOR_INPUT_LIMITS.maxEventTypeChars) {
      return overloaded(
        "Event monitor type is too large",
        "event_monitor_type",
        {
          maxEventTypeChars: PAGE_MONITOR_INPUT_LIMITS.maxEventTypeChars,
        },
      );
    }
    if (!seen.has(eventType)) {
      seen.add(eventType);
      normalized.push(eventType);
    }
  }
  return { accepted: true, eventTypes: normalized };
}

export function validateMutationMonitorOptions(options = {}) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    return {
      accepted: false,
      error: "Mutation monitor options must be an object",
      code: "INVALID_ARGUMENT",
    };
  }
  return {
    accepted: true,
    options: {
      attributes: options.attributes !== false,
      childList: options.childList !== false,
      subtree: options.subtree !== false,
      characterData: options.characterData === true,
      attributeOldValue: options.attributeOldValue === true,
      characterDataOldValue: options.characterDataOldValue === true,
    },
  };
}
