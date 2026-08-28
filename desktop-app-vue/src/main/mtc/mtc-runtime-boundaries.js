const DEFAULT_MTC_RUNTIME_LIMITS = Object.freeze({
  maxSubscriptions: 256,
  maxPayloadBytes: 256 * 1024,
  maxInflightRequests: 128,
  maxInboundTasks: 64,
  maxBatchClosedHandlers: 32,
  maxStagedEventsPerCommunity: 10_000,
  maxStagedEventBytes: 1024 * 1024,
  maxStagedBytesPerCommunity: 64 * 1024 * 1024,
  maxCommunitiesPerSweep: 256,
  closeTimeoutMs: 5_000,
});

const HARD_MTC_RUNTIME_LIMITS = Object.freeze({
  maxSubscriptions: 4_096,
  maxPayloadBytes: 4 * 1024 * 1024,
  maxInflightRequests: 2_048,
  maxInboundTasks: 1_024,
  maxBatchClosedHandlers: 256,
  maxStagedEventsPerCommunity: 100_000,
  maxStagedEventBytes: 16 * 1024 * 1024,
  maxStagedBytesPerCommunity: 512 * 1024 * 1024,
  maxCommunitiesPerSweep: 4_096,
  closeTimeoutMs: 30_000,
});

function resolveMtcRuntimeLimits(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("MTC runtime limits must be an object");
  }
  const unknown = Object.keys(overrides).filter(
    (name) => !(name in DEFAULT_MTC_RUNTIME_LIMITS),
  );
  if (unknown.length > 0) {
    throw new TypeError(`Unknown MTC runtime limit: ${unknown.join(", ")}`);
  }

  const resolved = {};
  for (const [name, fallback] of Object.entries(DEFAULT_MTC_RUNTIME_LIMITS)) {
    const value = overrides[name] ?? fallback;
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > HARD_MTC_RUNTIME_LIMITS[name]
    ) {
      throw new RangeError(
        `${name} must be an integer between 1 and ${HARD_MTC_RUNTIME_LIMITS[name]}`,
      );
    }
    resolved[name] = value;
  }
  return Object.freeze(resolved);
}

function jsonBytesWithinLimit(value, maxBytes, label = "MTC payload") {
  const json = JSON.stringify(value);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > maxBytes) {
    throw new RangeError(`${label} exceeds ${maxBytes} bytes`);
  }
  return { bytes, json };
}

function waitForTasksBounded(tasks, timeoutMs) {
  if (!tasks || tasks.size === 0) {
    return Promise.resolve({ timedOut: false });
  }
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    timer.unref?.();
  });
  const drain = Promise.allSettled(Array.from(tasks)).then(() => ({
    timedOut: false,
  }));
  return Promise.race([drain, timeout]).finally(() => clearTimeout(timer));
}

module.exports = {
  DEFAULT_MTC_RUNTIME_LIMITS,
  HARD_MTC_RUNTIME_LIMITS,
  jsonBytesWithinLimit,
  resolveMtcRuntimeLimits,
  waitForTasksBounded,
};
