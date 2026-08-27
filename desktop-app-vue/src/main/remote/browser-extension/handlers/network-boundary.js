import { utf8ByteLength } from "./heap-snapshot-boundary.js";

const KIB = 1024;
const MIB = KIB * KIB;
const RETRY_AFTER_MS = 1000;

export const NETWORK_SANITIZATION_LIMITS = Object.freeze({
  maxIdChars: 256,
  maxUrlChars: 4096,
  maxMethodChars: 32,
  maxTextChars: 512,
  maxHeaders: 32,
  maxHeaderNameChars: 128,
  maxHeaderValueChars: 512,
  maxBlockingPatterns: 100,
  maxPatternChars: 2048,
  maxBlockingPatternBytes: 64 * KIB,
  maxMockBodyBytes: 128 * KIB,
});

export const DEFAULT_NETWORK_CAPTURE_LIMITS = Object.freeze({
  maxActiveCaptures: 8,
  maxRetainedCaptures: 32,
  maxRequestsPerCapture: 500,
  maxBytesPerCapture: 2 * MIB,
  maxTotalBytes: 16 * MIB,
  maxEntryBytes: 64 * KIB,
});

export const HARD_NETWORK_CAPTURE_LIMITS = Object.freeze({
  maxActiveCaptures: 64,
  maxRetainedCaptures: 256,
  maxRequestsPerCapture: 5000,
  maxBytesPerCapture: 16 * MIB,
  maxTotalBytes: 128 * MIB,
  maxEntryBytes: 256 * KIB,
});

export const DEFAULT_NETWORK_MOCK_LIMITS = Object.freeze({
  maxActiveTabs: 8,
  maxMocksPerTab: 32,
  maxBytesPerTab: 2 * MIB,
  maxTotalBytes: 8 * MIB,
  maxEntryBytes: 256 * KIB,
});

export const HARD_NETWORK_MOCK_LIMITS = Object.freeze({
  maxActiveTabs: 64,
  maxMocksPerTab: 256,
  maxBytesPerTab: 16 * MIB,
  maxTotalBytes: 64 * MIB,
  maxEntryBytes: MIB,
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

function sanitizeHeaders(headers, { redactSensitive = true } = {}) {
  if (!headers || typeof headers !== "object") {
    return {};
  }
  let entries;
  try {
    entries = Object.entries(headers);
  } catch {
    return {};
  }
  return Object.fromEntries(
    entries
      .slice(0, NETWORK_SANITIZATION_LIMITS.maxHeaders)
      .map(([name, value]) => [
        truncate(name, NETWORK_SANITIZATION_LIMITS.maxHeaderNameChars),
        redactSensitive &&
        /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(
          name,
        )
          ? "[REDACTED]"
          : truncate(value, NETWORK_SANITIZATION_LIMITS.maxHeaderValueChars),
      ])
      .filter(([name]) => name.length > 0),
  );
}

export function sanitizeNetworkRequest(params = {}) {
  const request = params.request || {};
  return {
    id: truncate(params.requestId, NETWORK_SANITIZATION_LIMITS.maxIdChars),
    url: truncate(request.url, NETWORK_SANITIZATION_LIMITS.maxUrlChars),
    method: truncate(
      request.method,
      NETWORK_SANITIZATION_LIMITS.maxMethodChars,
    ),
    headers: sanitizeHeaders(request.headers),
    timestamp: finiteNumber(params.timestamp),
    type: truncate(params.type, NETWORK_SANITIZATION_LIMITS.maxTextChars),
  };
}

export function sanitizeNetworkResponse(params = {}) {
  const response = params.response || {};
  return {
    requestId: truncate(
      params.requestId,
      NETWORK_SANITIZATION_LIMITS.maxIdChars,
    ),
    status: finiteNumber(response.status),
    statusText: truncate(
      response.statusText,
      NETWORK_SANITIZATION_LIMITS.maxTextChars,
    ),
    responseHeaders: sanitizeHeaders(response.headers),
    mimeType: truncate(
      response.mimeType,
      NETWORK_SANITIZATION_LIMITS.maxTextChars,
    ),
  };
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

export class NetworkCaptureRegistry {
  constructor(options = {}) {
    const maxActiveCaptures = normalizeLimit(
      options.maxActiveCaptures,
      DEFAULT_NETWORK_CAPTURE_LIMITS.maxActiveCaptures,
      HARD_NETWORK_CAPTURE_LIMITS.maxActiveCaptures,
    );
    const maxBytesPerCapture = normalizeLimit(
      options.maxBytesPerCapture,
      DEFAULT_NETWORK_CAPTURE_LIMITS.maxBytesPerCapture,
      HARD_NETWORK_CAPTURE_LIMITS.maxBytesPerCapture,
    );
    this.limits = Object.freeze({
      maxActiveCaptures,
      maxRetainedCaptures: Math.max(
        maxActiveCaptures,
        normalizeLimit(
          options.maxRetainedCaptures,
          DEFAULT_NETWORK_CAPTURE_LIMITS.maxRetainedCaptures,
          HARD_NETWORK_CAPTURE_LIMITS.maxRetainedCaptures,
        ),
      ),
      maxRequestsPerCapture: normalizeLimit(
        options.maxRequestsPerCapture,
        DEFAULT_NETWORK_CAPTURE_LIMITS.maxRequestsPerCapture,
        HARD_NETWORK_CAPTURE_LIMITS.maxRequestsPerCapture,
      ),
      maxBytesPerCapture,
      maxTotalBytes: Math.max(
        maxBytesPerCapture,
        normalizeLimit(
          options.maxTotalBytes,
          DEFAULT_NETWORK_CAPTURE_LIMITS.maxTotalBytes,
          HARD_NETWORK_CAPTURE_LIMITS.maxTotalBytes,
        ),
      ),
      maxEntryBytes: Math.min(
        maxBytesPerCapture,
        normalizeLimit(
          options.maxEntryBytes,
          DEFAULT_NETWORK_CAPTURE_LIMITS.maxEntryBytes,
          HARD_NETWORK_CAPTURE_LIMITS.maxEntryBytes,
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
      return overloaded(
        "Network capture is already active for this tab",
        "network_capture_tab",
        { maxActiveCapturesPerTab: 1 },
      );
    }
    if (this.activeCount >= this.limits.maxActiveCaptures) {
      return overloaded(
        "Network capture capacity exceeded",
        "network_captures",
        { maxActiveCaptures: this.limits.maxActiveCaptures },
      );
    }

    if (existing) {
      this.removeState(existing);
    }
    while (this.captures.size >= this.limits.maxRetainedCaptures) {
      if (!this.evictOldestInactive()) {
        break;
      }
    }

    const timestamp = this.now();
    const lease = Object.freeze({
      id: Symbol("network-capture-lease"),
      tabId,
    });
    const state = {
      tabId,
      lease,
      status: "starting",
      startedAt: timestamp,
      updatedAt: timestamp,
      requests: [],
      requestById: new Map(),
      retainedBytes: 0,
      droppedRequests: 0,
      droppedUpdates: 0,
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
      return {
        accepted: false,
        error: "No active network capture exists for this tab",
        code: "NETWORK_CAPTURE_NOT_FOUND",
      };
    }
    if (state.status !== "active") {
      return {
        accepted: false,
        error: `Network capture is ${state.status}`,
        code: "NETWORK_CAPTURE_BUSY",
        retryAfterMs: RETRY_AFTER_MS,
      };
    }
    state.status = "stopping";
    state.updatedAt = this.now();
    return { accepted: true, capture: this.controlSnapshot(state) };
  }

  recordRequest(lease, entry) {
    const state = this.stateForLease(lease);
    if (!state || (state.status !== "starting" && state.status !== "active")) {
      return false;
    }
    const encoded = serializeEntry(entry);
    if (
      !encoded ||
      encoded.bytes <= 0 ||
      encoded.bytes > this.limits.maxEntryBytes ||
      encoded.bytes > this.limits.maxBytesPerCapture
    ) {
      state.droppedRequests += 1;
      return false;
    }

    while (
      state.requests.length >= this.limits.maxRequestsPerCapture ||
      state.retainedBytes + encoded.bytes > this.limits.maxBytesPerCapture
    ) {
      if (!this.evictOldestRequest(state)) {
        state.droppedRequests += 1;
        return false;
      }
    }
    while (this.totalBytes + encoded.bytes > this.limits.maxTotalBytes) {
      if (this.evictOldestInactive(state.tabId)) {
        continue;
      }
      if (!this.evictOldestRequest(state)) {
        state.droppedRequests += 1;
        return false;
      }
    }

    const retained = {
      entry: JSON.parse(encoded.serialized),
      bytes: encoded.bytes,
    };
    state.requests.push(retained);
    if (entry.id) {
      state.requestById.set(entry.id, retained);
    }
    state.retainedBytes += encoded.bytes;
    state.updatedAt = this.now();
    this.totalBytes += encoded.bytes;
    return true;
  }

  recordResponse(lease, response) {
    const state = this.stateForLease(lease);
    if (!state || (state.status !== "starting" && state.status !== "active")) {
      return false;
    }
    const retained = state.requestById.get(response.requestId);
    if (!retained) {
      state.droppedUpdates += 1;
      return false;
    }
    const { requestId: _requestId, ...fields } = response;
    const nextEntry = { ...retained.entry, ...fields };
    const encoded = serializeEntry(nextEntry);
    if (
      !encoded ||
      encoded.bytes <= 0 ||
      encoded.bytes > this.limits.maxEntryBytes
    ) {
      state.droppedUpdates += 1;
      return false;
    }
    const delta = encoded.bytes - retained.bytes;
    if (
      state.retainedBytes + delta > this.limits.maxBytesPerCapture ||
      this.totalBytes + delta > this.limits.maxTotalBytes
    ) {
      state.droppedUpdates += 1;
      return false;
    }
    retained.entry = JSON.parse(encoded.serialized);
    retained.bytes = encoded.bytes;
    state.retainedBytes += delta;
    state.updatedAt = this.now();
    this.totalBytes += delta;
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
    state.requestById.clear();
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

  getRequests(tabId) {
    const state = this.captures.get(tabId);
    if (!state) {
      return {
        requests: [],
        droppedRequests: 0,
        droppedUpdates: 0,
        retainedBytes: 0,
        status: "inactive",
        limits: this.limits,
      };
    }
    return {
      requests: state.requests.map(({ entry }) => ({
        ...entry,
        headers: { ...entry.headers },
        responseHeaders: { ...entry.responseHeaders },
      })),
      droppedRequests: state.droppedRequests,
      droppedUpdates: state.droppedUpdates,
      retainedBytes: state.retainedBytes,
      status: state.status,
      limits: this.limits,
    };
  }

  getControl(tabId) {
    const state = this.captures.get(tabId);
    return state ? this.controlSnapshot(state) : null;
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
      resources: state.resources,
    });
  }

  evictOldestRequest(state) {
    const oldest = state.requests.shift();
    if (!oldest) {
      return false;
    }
    if (oldest.entry.id && state.requestById.get(oldest.entry.id) === oldest) {
      state.requestById.delete(oldest.entry.id);
    }
    state.retainedBytes -= oldest.bytes;
    state.droppedRequests += 1;
    this.totalBytes -= oldest.bytes;
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

export function validateBlockingPatterns(patterns) {
  if (!Array.isArray(patterns)) {
    return {
      accepted: false,
      error: "Request blocking patterns must be an array",
      code: "INVALID_ARGUMENT",
    };
  }
  if (patterns.length > NETWORK_SANITIZATION_LIMITS.maxBlockingPatterns) {
    return overloaded(
      "Request blocking pattern capacity exceeded",
      "network_blocking_patterns",
      {
        maxBlockingPatterns: NETWORK_SANITIZATION_LIMITS.maxBlockingPatterns,
      },
    );
  }

  const normalized = [];
  let totalBytes = 0;
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || pattern.length === 0) {
      return {
        accepted: false,
        error: "Request blocking patterns must be non-empty strings",
        code: "INVALID_ARGUMENT",
      };
    }
    if (pattern.length > NETWORK_SANITIZATION_LIMITS.maxPatternChars) {
      return overloaded(
        "Request blocking pattern is too large",
        "network_blocking_pattern",
        { maxPatternChars: NETWORK_SANITIZATION_LIMITS.maxPatternChars },
      );
    }
    const bytes = utf8ByteLength(pattern);
    totalBytes += bytes;
    if (totalBytes > NETWORK_SANITIZATION_LIMITS.maxBlockingPatternBytes) {
      return overloaded(
        "Request blocking pattern bytes exceeded",
        "network_blocking_pattern_bytes",
        {
          maxBlockingPatternBytes:
            NETWORK_SANITIZATION_LIMITS.maxBlockingPatternBytes,
        },
      );
    }
    normalized.push(pattern);
  }
  return { accepted: true, patterns: normalized, totalBytes };
}

export function prepareMockResponse(urlPattern, response = {}) {
  if (typeof urlPattern !== "string" || urlPattern.length === 0) {
    return {
      accepted: false,
      error: "Mock URL pattern must be a non-empty string",
      code: "INVALID_ARGUMENT",
    };
  }
  if (urlPattern.length > NETWORK_SANITIZATION_LIMITS.maxPatternChars) {
    return overloaded("Mock URL pattern is too large", "network_mock_pattern", {
      maxPatternChars: NETWORK_SANITIZATION_LIMITS.maxPatternChars,
    });
  }

  let bodyJson;
  try {
    bodyJson = JSON.stringify(response?.body ?? {});
  } catch {
    return {
      accepted: false,
      error: "Mock response body must be JSON serializable",
      code: "INVALID_ARGUMENT",
    };
  }
  if (typeof bodyJson !== "string") {
    return {
      accepted: false,
      error: "Mock response body must serialize to JSON text",
      code: "INVALID_ARGUMENT",
    };
  }
  const bodyBytes = utf8ByteLength(bodyJson);
  if (bodyBytes > NETWORK_SANITIZATION_LIMITS.maxMockBodyBytes) {
    return overloaded("Mock response body is too large", "network_mock_body", {
      maxMockBodyBytes: NETWORK_SANITIZATION_LIMITS.maxMockBodyBytes,
    });
  }

  let statusValue;
  try {
    statusValue = Number(response?.status);
  } catch {
    statusValue = Number.NaN;
  }
  const status =
    Number.isInteger(statusValue) && statusValue >= 100 && statusValue <= 599
      ? statusValue
      : 200;
  let rawHeaders;
  try {
    rawHeaders = response?.headers;
  } catch {
    rawHeaders = {};
  }
  const headers = Object.entries(
    sanitizeHeaders(rawHeaders, { redactSensitive: false }),
  ).map(([name, value]) => ({ name, value }));
  return {
    accepted: true,
    mock: {
      urlPattern,
      status,
      headers,
      bodyJson,
    },
  };
}

export class NetworkMockRegistry {
  constructor(options = {}) {
    const maxBytesPerTab = normalizeLimit(
      options.maxBytesPerTab,
      DEFAULT_NETWORK_MOCK_LIMITS.maxBytesPerTab,
      HARD_NETWORK_MOCK_LIMITS.maxBytesPerTab,
    );
    this.limits = Object.freeze({
      maxActiveTabs: normalizeLimit(
        options.maxActiveTabs,
        DEFAULT_NETWORK_MOCK_LIMITS.maxActiveTabs,
        HARD_NETWORK_MOCK_LIMITS.maxActiveTabs,
      ),
      maxMocksPerTab: normalizeLimit(
        options.maxMocksPerTab,
        DEFAULT_NETWORK_MOCK_LIMITS.maxMocksPerTab,
        HARD_NETWORK_MOCK_LIMITS.maxMocksPerTab,
      ),
      maxBytesPerTab,
      maxTotalBytes: Math.max(
        maxBytesPerTab,
        normalizeLimit(
          options.maxTotalBytes,
          DEFAULT_NETWORK_MOCK_LIMITS.maxTotalBytes,
          HARD_NETWORK_MOCK_LIMITS.maxTotalBytes,
        ),
      ),
      maxEntryBytes: Math.min(
        maxBytesPerTab,
        normalizeLimit(
          options.maxEntryBytes,
          DEFAULT_NETWORK_MOCK_LIMITS.maxEntryBytes,
          HARD_NETWORK_MOCK_LIMITS.maxEntryBytes,
        ),
      ),
    });
    this.tabs = new Map();
    this.totalBytes = 0;
  }

  admit(tabId, mock) {
    let state = this.tabs.get(tabId);
    if (
      !mock ||
      typeof mock !== "object" ||
      typeof mock.urlPattern !== "string"
    ) {
      return {
        accepted: false,
        error: "Prepared network mock is invalid",
        code: "INVALID_ARGUMENT",
      };
    }
    const encoded = serializeEntry(mock);
    if (
      !encoded ||
      encoded.bytes <= 0 ||
      encoded.bytes > this.limits.maxEntryBytes
    ) {
      return overloaded("Mock response is too large", "network_mock_entry", {
        maxEntryBytes: this.limits.maxEntryBytes,
      });
    }
    if (!state && this.tabs.size >= this.limits.maxActiveTabs) {
      return overloaded(
        "Network mock tab capacity exceeded",
        "network_mock_tabs",
        {
          maxActiveTabs: this.limits.maxActiveTabs,
        },
      );
    }
    if (state && state.status !== "active") {
      return overloaded(
        "Network mock state is still starting for this tab",
        "network_mock_tab",
        { maxConcurrentOperationsPerTab: 1 },
      );
    }

    const previous = state?.mocks.get(mock.urlPattern) || null;
    if (!previous && state && state.mocks.size >= this.limits.maxMocksPerTab) {
      return overloaded(
        "Network mock capacity exceeded for this tab",
        "network_mocks_tab",
        { maxMocksPerTab: this.limits.maxMocksPerTab },
      );
    }
    const previousBytes = previous?.bytes || 0;
    const tabBytes =
      (state?.retainedBytes || 0) - previousBytes + encoded.bytes;
    const totalBytes = this.totalBytes - previousBytes + encoded.bytes;
    if (tabBytes > this.limits.maxBytesPerTab) {
      return overloaded(
        "Network mock bytes exceeded for this tab",
        "network_mock_tab_bytes",
        {
          maxBytesPerTab: this.limits.maxBytesPerTab,
        },
      );
    }
    if (totalBytes > this.limits.maxTotalBytes) {
      return overloaded(
        "Network mock global bytes exceeded",
        "network_mock_bytes",
        {
          maxTotalBytes: this.limits.maxTotalBytes,
        },
      );
    }

    const created = !state;
    if (!state) {
      const lease = Object.freeze({ id: Symbol("network-mock-lease"), tabId });
      state = {
        tabId,
        lease,
        status: "starting",
        mocks: new Map(),
        retainedBytes: 0,
        resources: null,
      };
      this.tabs.set(tabId, state);
    }
    const retained = {
      mock: JSON.parse(encoded.serialized),
      bytes: encoded.bytes,
    };
    state.mocks.set(mock.urlPattern, retained);
    state.retainedBytes = tabBytes;
    this.totalBytes = totalBytes;
    return {
      accepted: true,
      lease: state.lease,
      created,
      rollback: { lease: state.lease, urlPattern: mock.urlPattern, previous },
      patterns: this.getPatterns(tabId),
    };
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
    if (!state) {
      return false;
    }
    state.status = "active";
    return true;
  }

  rollback(token) {
    const state = this.stateForLease(token?.lease);
    if (!state) {
      return false;
    }
    const current = state.mocks.get(token.urlPattern);
    if (current) {
      state.retainedBytes -= current.bytes;
      this.totalBytes -= current.bytes;
    }
    if (token.previous) {
      state.mocks.set(token.urlPattern, token.previous);
      state.retainedBytes += token.previous.bytes;
      this.totalBytes += token.previous.bytes;
    } else {
      state.mocks.delete(token.urlPattern);
    }
    if (state.mocks.size === 0) {
      this.removeState(state);
    }
    return true;
  }

  getMatch(tabId, url) {
    const state = this.tabs.get(tabId);
    if (!state || typeof url !== "string") {
      return null;
    }
    for (const { mock } of state.mocks.values()) {
      const needle = mock.urlPattern.replaceAll("*", "");
      if (needle.length === 0 || url.includes(needle)) {
        return {
          ...mock,
          headers: Array.isArray(mock.headers)
            ? mock.headers.map((header) => ({ ...header }))
            : [],
        };
      }
    }
    return null;
  }

  getPatterns(tabId) {
    const state = this.tabs.get(tabId);
    return state ? [...state.mocks.keys()] : [];
  }

  getControl(tabId) {
    const state = this.tabs.get(tabId);
    return state
      ? Object.freeze({
          lease: state.lease,
          tabId: state.tabId,
          status: state.status,
          resources: state.resources,
        })
      : null;
  }

  getStats() {
    return {
      activeTabs: this.tabs.size,
      totalBytes: this.totalBytes,
      limits: this.limits,
    };
  }

  clear(tabId) {
    const state = this.tabs.get(tabId);
    if (!state) {
      return false;
    }
    this.removeState(state);
    return true;
  }

  stateForLease(lease) {
    if (!lease) {
      return null;
    }
    const state = this.tabs.get(lease.tabId);
    return state?.lease === lease ? state : null;
  }

  removeState(state) {
    this.totalBytes -= state.retainedBytes;
    this.tabs.delete(state.tabId);
  }
}
