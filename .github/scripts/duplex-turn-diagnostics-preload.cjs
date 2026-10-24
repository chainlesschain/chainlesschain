"use strict";
// Passive diagnostic observer only: no fetch wrapper, dispatcher, or retries.
const fs = require("node:fs");
const dc = require("node:diagnostics_channel");
const { performance } = require("node:perf_hooks");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const CPU_LIMITS = Object.freeze({
  nodes: 20000,
  samples: 50000,
  edges: 40000,
  depth: 128,
  self: 50,
  inclusive: 50,
  chains: 20,
  chainBuckets: 1000,
  bytes: 256 * 1024,
});
const SAMPLING_INTERVAL_US = 10000;

// Engine function names are deliberately omitted: even identifier-shaped names
// can contain user data. A trusted source coordinate identifies the function.
function createFrameSanitizer(root) {
  let trustedRoot;
  try {
    trustedRoot = fs.realpathSync.native(root);
  } catch {
    return () => "unknown";
  }
  const cache = new Map();
  return (frame) => {
    if (!frame || typeof frame.url !== "string") return "unknown";
    if (frame.url.startsWith("node:")) return "node-internal";
    if (!frame.url) {
      return (
        new Map([
          ["(root)", "root"],
          ["(idle)", "idle"],
          ["(program)", "program"],
          ["(garbage collector)", "garbage-collector"],
        ]).get(frame.functionName) || "unknown-native"
      );
    }
    if (frame.url.length > 4096) return "unknown-external";
    let relative = cache.get(frame.url);
    if (relative === undefined) {
      relative = null;
      try {
        const candidate = frame.url.startsWith("file:")
          ? fileURLToPath(frame.url)
          : frame.url;
        if (path.isAbsolute(candidate)) {
          const resolved = fs.realpathSync.native(candidate);
          const local = path
            .relative(trustedRoot, resolved)
            .split(path.sep)
            .join("/");
          if (
            local.length <= 240 &&
            /^packages\/[A-Za-z0-9_./-]+\.(?:js|mjs|cjs|ts)$/.test(local) &&
            !local
              .split("/")
              .some((part) => ["..", "node_modules"].includes(part)) &&
            fs.statSync(resolved).isFile()
          )
            relative = local;
        }
      } catch {
        // Never retain an unverified URL or exception text.
      }
      if (cache.size < CPU_LIMITS.nodes) cache.set(frame.url, relative);
    }
    if (!relative) return "unknown-external";
    if (
      !Number.isSafeInteger(frame.lineNumber) ||
      frame.lineNumber < 0 ||
      frame.lineNumber > 1000000 ||
      !Number.isSafeInteger(frame.columnNumber) ||
      frame.columnNumber < 0 ||
      frame.columnNumber > 1000000
    )
      return "unknown-coordinate";
    return `${relative}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
  };
}

function summarizeCpuProfile(profile, sanitizeFrame) {
  const rawNodes = Array.isArray(profile?.nodes) ? profile.nodes : [];
  const rawSamples = Array.isArray(profile?.samples) ? profile.samples : [];
  const deltas = Array.isArray(profile?.timeDeltas) ? profile.timeDeltas : [];
  const truncated = {
    nodes: rawNodes.length > CPU_LIMITS.nodes,
    samples: rawSamples.length > CPU_LIMITS.samples,
    edges: false,
    depth: false,
    self: false,
    inclusive: false,
    chains: false,
    chainAggregation: false,
    output: false,
  };
  const nodes = new Map();
  const parents = new Map();
  let malformed = 0;
  let edges = 0;
  for (const node of rawNodes.slice(0, CPU_LIMITS.nodes)) {
    if (!Number.isSafeInteger(node?.id) || nodes.has(node.id)) {
      malformed++;
      continue;
    }
    nodes.set(node.id, sanitizeFrame(node.callFrame));
    for (const child of Array.isArray(node.children) ? node.children : []) {
      if (++edges > CPU_LIMITS.edges) {
        truncated.edges = true;
        break;
      }
      if (Number.isSafeInteger(child) && !parents.has(child))
        parents.set(child, node.id);
      else malformed++;
    }
  }
  const self = new Map();
  const inclusive = new Map();
  const chains = new Map();
  let unknownSamples = 0;
  let unknownTimeSamples = 0;
  let sampledMicros = 0;
  const add = (map, key, micros) => {
    const value = map.get(key) || { samples: 0, micros: 0 };
    value.samples++;
    value.micros += micros;
    map.set(key, value);
  };
  const count = Math.min(rawSamples.length, CPU_LIMITS.samples);
  for (let i = 0; i < count; i++) {
    const delta = deltas[i];
    const knownTime =
      Number.isSafeInteger(delta) && delta >= 0 && delta <= 3600000000;
    const micros = knownTime ? delta : 0;
    if (!knownTime) unknownTimeSamples++;
    sampledMicros += micros;
    const leaf = nodes.get(rawSamples[i]) || "unknown";
    if (leaf.startsWith("unknown")) unknownSamples++;
    add(self, leaf, micros);
    const chain = [];
    const visited = new Set();
    let id = rawSamples[i];
    while (id !== undefined && chain.length < CPU_LIMITS.depth) {
      if (visited.has(id)) {
        malformed++;
        chain.push("unknown-cycle");
        break;
      }
      visited.add(id);
      chain.push(nodes.get(id) || "unknown");
      id = parents.get(id);
    }
    if (id !== undefined && chain.length >= CPU_LIMITS.depth)
      truncated.depth = true;
    for (const frame of new Set(chain)) add(inclusive, frame, micros);
    let chainKey = JSON.stringify(chain.reverse());
    if (!chains.has(chainKey) && chains.size >= CPU_LIMITS.chainBuckets) {
      truncated.chainAggregation = true;
      chainKey = '["unknown-chain-overflow"]';
    }
    add(chains, chainKey, micros);
  }
  const top = (map, limit, flag, isChain = false) => {
    truncated[flag] = map.size > limit;
    return [...map.entries()]
      .sort(
        (a, b) =>
          b[1].micros - a[1].micros ||
          b[1].samples - a[1].samples ||
          a[0].localeCompare(b[0]),
      )
      .slice(0, limit)
      .map(([key, values]) => ({
        ...(isChain ? { frames: JSON.parse(key) } : { frame: key }),
        ...values,
      }));
  };
  return {
    inputNodes: rawNodes.length,
    profileMissing:
      !Array.isArray(profile?.nodes) || !Array.isArray(profile?.samples),
    inputSamples: rawSamples.length,
    summarizedSamples: count,
    sampledMicros,
    unknownSamples,
    unknownTimeSamples,
    malformed,
    profileDurationMicros:
      Number.isFinite(profile?.startTime) &&
      Number.isFinite(profile?.endTime) &&
      profile.endTime >= profile.startTime
        ? profile.endTime - profile.startTime
        : null,
    inclusiveRecursion: "one-count-per-frame-per-sample",
    topSelf: top(self, CPU_LIMITS.self, "self"),
    topInclusive: top(inclusive, CPU_LIMITS.inclusive, "inclusive"),
    topChains: top(chains, CPU_LIMITS.chains, "chains", true),
    truncated,
  };
}

function encodeCpuSummary(summary) {
  let encoded = JSON.stringify(summary) + "\n";
  if (Buffer.byteLength(encoded) > CPU_LIMITS.bytes) {
    summary.truncated = { ...summary.truncated, output: true };
    for (const key of ["topChains", "topInclusive", "topSelf"]) {
      while (
        summary[key]?.length &&
        Buffer.byteLength(encoded) > CPU_LIMITS.bytes
      ) {
        summary[key].pop();
        encoded = JSON.stringify(summary) + "\n";
      }
    }
  }
  if (Buffer.byteLength(encoded) > CPU_LIMITS.bytes)
    return '{"status":"summary-output-limit","truncated":{"output":true}}\n';
  return encoded;
}

function createCpuObserver({
  createSession,
  sanitizeFrame,
  write,
  now = () => performance.now(),
  startRequest = 2,
  stopRequest = 4,
}) {
  if (
    !Number.isSafeInteger(startRequest) ||
    !Number.isSafeInteger(stopRequest) ||
    startRequest < 1 ||
    stopRequest <= startRequest ||
    stopRequest > 100
  )
    throw new TypeError("invalid-cpu-request-window");
  let state = "armed";
  let session;
  let pending = Promise.resolve();
  let stopRequested = false;
  let startTriggerMs = null;
  let recordingStartedMs = null;
  let stopTriggerMs = null;
  let completedMs = null;
  const metadata = () => ({
    schema: "chainlesschain.duplex-turn-cpu-summary/v1",
    disposition: "diagnostic-only-non-qualifying",
    formalQualification: false,
    paidReady: false,
    nativeAdmission: false,
    status: state,
    samplingIntervalMicros: SAMPLING_INTERVAL_US,
    startRequest,
    stopRequest,
    startTrigger: `loopback-request-${startRequest}-trailers`,
    stopTrigger: `loopback-request-${stopRequest}-create`,
    startTriggerMs,
    recordingStartedMs,
    stopTriggerMs,
    completedMs,
    frameIdentity: "verified-repository-source-coordinate-no-function-names",
    observerScope:
      "local-inspector-cpu-sampling-with-overhead-no-transport-mutation",
    limits: CPU_LIMITS,
  });
  const persist = (extra = {}) => {
    try {
      write(encodeCpuSummary({ ...metadata(), ...extra }));
    } catch {
      /* Observer only. */
    }
  };
  const disconnect = () => {
    try {
      session?.disconnect();
    } catch {
      /* Observer only. */
    }
  };
  const fail = (stage) => {
    state = "failed";
    completedMs = now();
    disconnect();
    persist({ failureStage: stage });
  };
  const post = (method, params = {}) =>
    new Promise((resolve, reject) => {
      try {
        session.post(method, params, (error, value) =>
          error
            ? reject(new Error("inspector-operation-failed"))
            : resolve(value),
        );
      } catch {
        reject(new Error("inspector-operation-failed"));
      }
    });
  const stop = async () => {
    if (state !== "recording") return;
    state = "stopping";
    try {
      const result = await post("Profiler.stop");
      disconnect();
      const summary = summarizeCpuProfile(result?.profile, sanitizeFrame);
      state = "completed";
      completedMs = now();
      persist(summary);
    } catch {
      fail("stop-or-summary");
    }
  };
  return {
    observe(event, request) {
      if (
        event === "undici:request:trailers" &&
        request === startRequest &&
        state === "armed"
      ) {
        state = "starting";
        startTriggerMs = now();
        pending = (async () => {
          try {
            session = createSession();
            session.connect();
            await post("Profiler.enable");
            await post("Profiler.setSamplingInterval", {
              interval: SAMPLING_INTERVAL_US,
            });
            await post("Profiler.start");
            recordingStartedMs = now();
            state = "recording";
            persist();
            if (stopRequested) await stop();
          } catch {
            fail("start");
          }
        })();
      }
      if (
        event === "undici:request:create" &&
        request === stopRequest &&
        !stopRequested &&
        ["starting", "recording"].includes(state)
      ) {
        stopRequested = true;
        stopTriggerMs = now();
        if (state === "recording") pending = stop();
      }
    },
    settled: () => pending,
    finish() {
      if (["completed", "failed", "incomplete"].includes(state)) return;
      state = "incomplete";
      completedMs = now();
      disconnect();
      persist({ failureStage: "exit-before-summary" });
    },
  };
}
module.exports = {
  CPU_LIMITS,
  createFrameSanitizer,
  summarizeCpuProfile,
  encodeCpuSummary,
  createCpuObserver,
};
const file = process.env.CC_TURN_DIAGNOSTIC_CHILD_FILE;
let brokerOrigin = null;
try {
  const url = new URL(process.env.CC_TURN_DIAGNOSTIC_BROKER_ORIGIN);
  if (url.protocol === "http:" && url.hostname === "127.0.0.1") {
    brokerOrigin = url.origin;
  }
} catch {
  // Missing coordinates must not broaden observation to other providers.
}
if (file && brokerOrigin) {
  let fd;
  let count = 0;
  let bytes = 0;
  let stopped = false;
  const started = performance.now();
  const requestIds = new WeakMap();
  let requestCount = 0;
  const errors = new Set([
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_ABORTED",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "ABORT_ERR",
  ]);
  try {
    fd = fs.openSync(file, "wx", 0o600);
  } catch {
    stopped = true;
  }
  function append(event, extra = {}) {
    if (stopped) return;
    try {
      const limited = count >= 4095 || bytes >= 1024 * 1024 - 1024;
      const cpu = process.cpuUsage();
      const line = Buffer.from(
        JSON.stringify({
          schema: "chainlesschain.duplex-turn-child-diagnostic/v1",
          sequence: count++,
          at: new Date().toISOString(),
          elapsedMs: performance.now() - started,
          event: limited ? "truncated" : event,
          cpuUserMicros: cpu.user,
          cpuSystemMicros: cpu.system,
          rssBytes: process.memoryUsage.rss(),
          ...(limited ? {} : extra),
        }) + "\n",
      );
      let offset = 0;
      while (offset < line.length) {
        const written = fs.writeSync(fd, line, offset, line.length - offset);
        if (!written) throw new Error("diagnostic-write-failed");
        offset += written;
      }
      bytes += line.length;
      if (limited) stopped = true;
    } catch {
      stopped = true;
    }
  }
  append("enabled", { passive: true, maxRecords: 4096, maxBytes: 1024 * 1024 });
  let cpuObserver;
  if (
    process.env.CC_TURN_DIAGNOSTIC_CPU_FILE &&
    process.env.CC_TURN_DIAGNOSTIC_ROOT
  ) {
    cpuObserver = createCpuObserver({
      startRequest:
        process.env.CC_TURN_DIAGNOSTIC_CPU_START_REQUEST === undefined
          ? 2
          : Number(process.env.CC_TURN_DIAGNOSTIC_CPU_START_REQUEST),
      stopRequest:
        process.env.CC_TURN_DIAGNOSTIC_CPU_STOP_REQUEST === undefined
          ? 4
          : Number(process.env.CC_TURN_DIAGNOSTIC_CPU_STOP_REQUEST),
      createSession: () => new (require("node:inspector").Session)(),
      sanitizeFrame: createFrameSanitizer(process.env.CC_TURN_DIAGNOSTIC_ROOT),
      write: (summary) =>
        fs.writeFileSync(process.env.CC_TURN_DIAGNOSTIC_CPU_FILE, summary, {
          mode: 0o600,
        }),
    });
  }
  for (const name of [
    "undici:request:create",
    "undici:request:bodySent",
    "undici:request:headers",
    "undici:request:trailers",
    "undici:request:error",
  ]) {
    dc.channel(name).subscribe((message) => {
      try {
        const request = message.request;
        if (!request || new URL(request.origin).origin !== brokerOrigin) return;
        if (!requestIds.has(request)) requestIds.set(request, ++requestCount);
        cpuObserver?.observe(name, requestIds.get(request));
        append(name, {
          request: requestIds.get(request),
          ...(name === "undici:request:headers"
            ? {
                statusCode: Number.isSafeInteger(message.response?.statusCode)
                  ? message.response.statusCode
                  : null,
              }
            : {}),
          ...(name === "undici:request:error"
            ? {
                errorCode: errors.has(message.error?.code)
                  ? message.error.code
                  : "OTHER",
              }
            : {}),
        });
      } catch {
        /* Observability cannot alter the request. */
      }
    });
  }
  const heartbeat = setInterval(() => append("heartbeat"), 1000);
  heartbeat.unref();
  process.once("exit", () => {
    cpuObserver?.finish();
    append("exit");
    clearInterval(heartbeat);
    try {
      if (fd !== undefined) fs.closeSync(fd);
    } catch {
      /* Diagnostic only. */
    }
  });
}
