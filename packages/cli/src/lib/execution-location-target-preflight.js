import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./scheduler-kernel/contract.js";

export const EXECUTION_LOCATION_TARGET_PREFLIGHT_SCHEMA =
  "cc-execution-location-target-preflight/v1";

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;
const MAX_PROXY_AUTHORITY_AGE_MS = 5 * 60 * 1000;

function requiredEnvironment(environment, key, pattern = SAFE_ID_RE) {
  const value = environment[key];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`execution location target preflight is missing ${key}`);
  }
  return value;
}

function positiveInteger(environment, key) {
  const value = requiredEnvironment(environment, key, /^[1-9][0-9]*$/u);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`execution location target preflight has invalid ${key}`);
  }
  return number;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "executionLocationTargetPreflight"), "utf8")
    .digest("hex")}`;
}

function parseLimit(limits, label, unit) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = limits.match(
    new RegExp(`^${escaped}\\s+(\\S+)\\s+(\\S+)\\s+${unit}[ \\t]*$`, "mu"),
  );
  if (!match || match[1] === "unlimited") return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function verifyWritableDirectory(baseDir, deps = {}) {
  const runtimeFs = deps.fs || fs;
  const requested = runtimeFs.lstatSync(baseDir);
  if (!requested.isDirectory() || requested.isSymbolicLink()) {
    throw new Error("execution location target base directory drifted");
  }
  const expected = runtimeFs.realpathSync(baseDir);
  const current = runtimeFs.realpathSync((deps.cwd || process.cwd)());
  const stat = runtimeFs.lstatSync(expected);
  if (!stat.isDirectory() || stat.isSymbolicLink() || expected !== current) {
    throw new Error("execution location target base directory drifted");
  }
  const probe = path.join(
    expected,
    `.cc-location-preflight-${(deps.randomId || randomUUID)()}`,
  );
  let descriptor = null;
  let created = false;
  try {
    descriptor = runtimeFs.openSync(probe, "wx", 0o600);
    created = true;
    runtimeFs.writeFileSync(descriptor, "preflight\n", "utf8");
    runtimeFs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) runtimeFs.closeSync(descriptor);
    if (created) {
      try {
        runtimeFs.unlinkSync(probe);
      } catch {
        // The original open/write error remains authoritative.
      }
    }
  }
  return expected;
}

export function projectExecutionLocationTargetPreflight(
  options = {},
  deps = {},
) {
  const environment = deps.environment || process.env;
  const runnerId = requiredEnvironment(
    environment,
    "CC_EXECUTION_LOCATION_RUNNER_ID",
  );
  const state = requiredEnvironment(
    environment,
    "CC_EXECUTION_LOCATION_STATE",
    /^(?:accepting|draining)$/u,
  );
  const generation = positiveInteger(
    environment,
    "CC_EXECUTION_LOCATION_GENERATION",
  );
  const leaseGeneration = positiveInteger(
    environment,
    "CC_EXECUTION_LOCATION_LEASE_GENERATION",
  );
  if (leaseGeneration > generation) {
    throw new Error("execution location target lease generation is stale");
  }
  const nowMs = Number((deps.now || Date.now)());
  const leaseExpiresAt = requiredEnvironment(
    environment,
    "CC_EXECUTION_LOCATION_LEASE_EXPIRES_AT",
    /^.{1,64}$/u,
  );
  const proxyIssuedAt = requiredEnvironment(
    environment,
    "CC_EXECUTION_LOCATION_PROXY_ISSUED_AT",
    /^.{1,64}$/u,
  );
  const proxyExpiresAt = requiredEnvironment(
    environment,
    "CC_EXECUTION_LOCATION_PROXY_EXPIRES_AT",
    /^.{1,64}$/u,
  );
  const proxyIssuedAtMs = Date.parse(proxyIssuedAt);
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(Date.parse(leaseExpiresAt)) ||
    !Number.isFinite(proxyIssuedAtMs) ||
    !Number.isFinite(Date.parse(proxyExpiresAt)) ||
    Date.parse(leaseExpiresAt) <= nowMs ||
    proxyIssuedAtMs > nowMs + 30_000 ||
    nowMs - proxyIssuedAtMs > MAX_PROXY_AUTHORITY_AGE_MS ||
    Date.parse(proxyExpiresAt) <= nowMs
  ) {
    throw new Error(
      "execution location target lease or proxy authority is stale",
    );
  }
  const baseDir = requiredEnvironment(
    environment,
    "CC_EXECUTION_LOCATION_BASE_DIR",
    /^.{1,4096}$/u,
  );
  const canonicalBaseDir = verifyWritableDirectory(baseDir, deps);
  const cpuSeconds = positiveInteger(
    environment,
    "CC_EXECUTION_LOCATION_CPU_SECONDS",
  );
  const memoryBytes = positiveInteger(
    environment,
    "CC_EXECUTION_LOCATION_MEMORY_BYTES",
  );
  const enforcement = requiredEnvironment(
    environment,
    "CC_EXECUTION_LOCATION_RESOURCE_ENFORCEMENT",
    /^(?:posix-rlimit|target-supervisor|posix-rlimit\+target-supervisor)$/u,
  );
  let observedCpuSeconds;
  let observedMemoryBytes;
  if (enforcement === "posix-rlimit") {
    const limitsPath = deps.limitsPath || "/proc/self/limits";
    const limits = (deps.fs || fs).readFileSync(limitsPath, "utf8");
    observedCpuSeconds = parseLimit(limits, "Max cpu time", "seconds");
    observedMemoryBytes = parseLimit(limits, "Max address space", "bytes");
  } else {
    observedCpuSeconds = positiveInteger(
      environment,
      "CC_EXECUTION_LOCATION_OBSERVED_CPU_SECONDS",
    );
    observedMemoryBytes = positiveInteger(
      environment,
      "CC_EXECUTION_LOCATION_OBSERVED_MEMORY_BYTES",
    );
  }
  if (
    observedCpuSeconds === null ||
    observedCpuSeconds > cpuSeconds ||
    observedMemoryBytes === null ||
    observedMemoryBytes > memoryBytes
  ) {
    throw new Error(
      "execution location target resource limits are not enforced",
    );
  }

  const material = {
    schema: EXECUTION_LOCATION_TARGET_PREFLIGHT_SCHEMA,
    runnerId,
    state,
    generation,
    lease: {
      id: requiredEnvironment(environment, "CC_EXECUTION_LOCATION_LEASE_ID"),
      generation: leaseGeneration,
      expiresAt: leaseExpiresAt,
    },
    proxyAuthority: {
      id: requiredEnvironment(
        environment,
        "CC_EXECUTION_LOCATION_PROXY_AUTHORITY_ID",
      ),
      revision: positiveInteger(
        environment,
        "CC_EXECUTION_LOCATION_PROXY_REVISION",
      ),
      issuedAt: proxyIssuedAt,
      expiresAt: proxyExpiresAt,
    },
    baseDir: {
      digest: digest(
        "chainlesschain.execution-location.base-dir.v1\0",
        canonicalBaseDir,
      ),
      writable: true,
    },
    resources: {
      cpuSeconds,
      memoryBytes,
      observedCpuSeconds,
      observedMemoryBytes,
      targetEnforced: true,
      enforcement,
    },
    postSessionHook: {
      digest: requiredEnvironment(
        environment,
        "CC_EXECUTION_LOCATION_POST_SESSION_HOOK_DIGEST",
        DIGEST_RE,
      ),
      generation: positiveInteger(
        environment,
        "CC_EXECUTION_LOCATION_POST_SESSION_HOOK_GENERATION",
      ),
    },
    secretTransferCount: 0,
  };
  if (material.postSessionHook.generation !== leaseGeneration) {
    throw new Error(
      "execution location target post-session hook fence is stale",
    );
  }
  return Object.freeze({
    ...material,
    receiptDigest: digest(
      "chainlesschain.execution-location.target-preflight.v1\0",
      material,
    ),
  });
}

export function runExecutionLocationTargetResourceProbe(kind) {
  if (kind === "cpu") {
    fs.writeSync(1, "CC_EXECUTION_LOCATION_RESOURCE_PROBE_ARMED:cpu\n");
    // The target wrapper's RLIMIT_CPU must terminate this process. Keep the
    // loop side-effect free so a missing limit is diagnosable by the caller's
    // outer timeout without touching workspace or network state.
    for (;;) Math.imul(1_664_525, 1_013_904_223);
  }
  if (kind === "memory") {
    fs.writeSync(1, "CC_EXECUTION_LOCATION_RESOURCE_PROBE_ARMED:memory\n");
    const retained = [];
    for (;;) retained.push(new Array(1024 * 1024).fill(retained.length));
  }
  throw new TypeError("resource probe must be cpu or memory");
}

export async function projectExecutionLocationTargetSigtermProbe(
  options = {},
  deps = {},
) {
  const preflight = projectExecutionLocationTargetPreflight(options, deps);
  const processRef = deps.process || process;
  const timeoutMs = Number(deps.timeoutMs || 2_000);
  if (
    typeof processRef.once !== "function" ||
    typeof processRef.removeListener !== "function" ||
    typeof processRef.kill !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 10_000
  ) {
    throw new TypeError(
      "execution location SIGTERM probe dependencies are invalid",
    );
  }
  let timeout;
  let signalDeliveryCount = 0;
  const delivered = new Promise((resolve, reject) => {
    const onSignal = () => {
      signalDeliveryCount += 1;
      resolve();
    };
    processRef.once("SIGTERM", onSignal);
    timeout = (deps.setTimeout || setTimeout)(() => {
      processRef.removeListener("SIGTERM", onSignal);
      reject(new Error("execution location target did not handle SIGTERM"));
    }, timeoutMs);
  });
  try {
    (
      deps.deliverSignal || (() => processRef.kill(processRef.pid, "SIGTERM"))
    )();
    await delivered;
  } finally {
    (deps.clearTimeout || clearTimeout)(timeout);
  }
  const material = {
    schema: "cc-execution-location-target-sigterm-drain/v1",
    runnerId: preflight.runnerId,
    signal: "SIGTERM",
    before: {
      state: preflight.state,
      generation: preflight.generation,
      accepting: preflight.state === "accepting",
    },
    after: {
      state: "draining",
      generation: preflight.generation + 1,
      accepting: false,
    },
    lease: { ...preflight.lease, continued: true },
    preflightReceiptDigest: preflight.receiptDigest,
    signalDeliveryCount,
    postSignalLeaseAcceptanceCount: 0,
    secretTransferCount: 0,
  };
  return Object.freeze({
    ...material,
    receiptDigest: digest(
      "chainlesschain.execution-location.target-sigterm-drain.v1\0",
      material,
    ),
  });
}
