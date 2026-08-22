import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";

export const EXECUTION_LOCATION_RUNNER_LIFECYCLE_SCHEMA =
  "cc-execution-location-runner-lifecycle/v1";
export const EXECUTION_LOCATION_RUNNER_STATES = Object.freeze([
  "accepting",
  "draining",
  "parked",
  "reclaiming",
]);

const STORE_LABEL = "Execution location runner lifecycle";
const TARGETS = new Set(["local", "wsl", "ssh", "container"]);
const STATES = new Set(EXECUTION_LOCATION_RUNNER_STATES);
const LEASE_STATUSES = new Set(["active", "settled", "parked"]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const MAX_PROXY_AGE_MS = 5 * 60 * 1000;
const MAX_RETAINED_LEASES = 1024;

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} has an invalid schema`);
  }
  return value;
}

function safeId(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function safeDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function safeInteger(
  value,
  label,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const normalized = Number(value);
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < minimum ||
    normalized > maximum
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function safeTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function receiptDigest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "executionLocationRunnerLifecycle"), "utf8")
    .digest("hex")}`;
}

function validateResources(value) {
  const input = exactObject(
    value,
    ["cpuSeconds", "memoryBytes"],
    "runner resources",
  );
  return Object.freeze({
    cpuSeconds: safeInteger(input.cpuSeconds, "runner cpuSeconds", 1, 86_400),
    memoryBytes: safeInteger(
      input.memoryBytes,
      "runner memoryBytes",
      64 * 1024 * 1024,
      64 * 1024 * 1024 * 1024,
    ),
  });
}

function validateProxyAuthority(value, now, minimumRevision = 0) {
  const input = exactObject(
    value,
    ["id", "revision", "issuedAt", "expiresAt"],
    "proxy authority",
  );
  const issuedAt = safeTimestamp(input.issuedAt, "proxy authority issuedAt");
  const expiresAt = safeTimestamp(input.expiresAt, "proxy authority expiresAt");
  const revision = safeInteger(
    input.revision,
    "proxy authority revision",
    Math.max(1, minimumRevision),
  );
  const issuedAtMs = Date.parse(issuedAt);
  if (
    issuedAtMs > now + 30_000 ||
    now - issuedAtMs > MAX_PROXY_AGE_MS ||
    Date.parse(expiresAt) <= now
  ) {
    throw new Error("execution location proxy authority is not fresh");
  }
  return Object.freeze({
    id: safeId(input.id, "proxy authority id"),
    revision,
    issuedAt,
    expiresAt,
  });
}

function validateLease(value) {
  const input = exactObject(
    value,
    [
      "id",
      "sessionId",
      "generation",
      "issuedAt",
      "expiresAt",
      "status",
      "resultDigest",
      "hookReceiptDigest",
    ],
    "runner lease",
  );
  const status = safeId(input.status, "runner lease status");
  if (!LEASE_STATUSES.has(status)) {
    throw new TypeError("runner lease status is invalid");
  }
  return {
    id: safeId(input.id, "runner lease id"),
    sessionId: safeId(input.sessionId, "runner lease sessionId"),
    generation: safeInteger(input.generation, "runner lease generation", 1),
    issuedAt: safeTimestamp(input.issuedAt, "runner lease issuedAt"),
    expiresAt: safeTimestamp(input.expiresAt, "runner lease expiresAt"),
    status,
    resultDigest:
      input.resultDigest === null
        ? null
        : safeDigest(input.resultDigest, "runner lease resultDigest"),
    hookReceiptDigest:
      input.hookReceiptDigest === null
        ? null
        : safeDigest(input.hookReceiptDigest, "runner lease hookReceiptDigest"),
  };
}

function validateState(value, expected = {}) {
  const input = exactObject(
    value,
    [
      "schema",
      "runnerId",
      "target",
      "state",
      "generation",
      "policyRevision",
      "baseDir",
      "resources",
      "proxyAuthority",
      "postSessionHookDigest",
      "drain",
      "leases",
      "updatedAt",
    ],
    "runner lifecycle state",
  );
  if (input.schema !== EXECUTION_LOCATION_RUNNER_LIFECYCLE_SCHEMA) {
    throw new TypeError("runner lifecycle state schema is invalid");
  }
  const runnerId = safeId(input.runnerId, "runnerId");
  const target = safeId(input.target, "runner target");
  const state = safeId(input.state, "runner state");
  if (!TARGETS.has(target) || !STATES.has(state)) {
    throw new TypeError("runner lifecycle target or state is invalid");
  }
  if (
    (expected.runnerId && expected.runnerId !== runnerId) ||
    (expected.target && expected.target !== target) ||
    (expected.baseDir && expected.baseDir !== input.baseDir)
  ) {
    throw new Error("runner lifecycle identity drifted");
  }
  const drain =
    input.drain === null
      ? null
      : exactObject(
          input.drain,
          ["signal", "requestedAt", "deadlineAt"],
          "runner drain",
        );
  if ((state === "draining") !== Boolean(drain)) {
    throw new TypeError("runner drain state is inconsistent");
  }
  if (drain) {
    if (drain.signal !== "SIGTERM") {
      throw new TypeError("runner drain signal is invalid");
    }
    safeTimestamp(drain.requestedAt, "runner drain requestedAt");
    safeTimestamp(drain.deadlineAt, "runner drain deadlineAt");
  }
  if (
    !Array.isArray(input.leases) ||
    input.leases.length > MAX_RETAINED_LEASES
  ) {
    throw new TypeError("runner leases are invalid");
  }
  const leases = input.leases.map(validateLease);
  if (new Set(leases.map((lease) => lease.id)).size !== leases.length) {
    throw new TypeError("runner leases contain duplicate identities");
  }
  const proxyAuthority = exactObject(
    input.proxyAuthority,
    ["id", "revision"],
    "runner proxy authority",
  );
  return {
    ...input,
    runnerId,
    target,
    state,
    generation: safeInteger(input.generation, "runner generation", 1),
    policyRevision: safeInteger(
      input.policyRevision,
      "runner policyRevision",
      1,
    ),
    baseDir: input.baseDir,
    resources: validateResources(input.resources),
    proxyAuthority: {
      id: safeId(proxyAuthority.id, "runner proxy authority id"),
      revision: safeInteger(
        proxyAuthority.revision,
        "runner proxy authority revision",
        0,
      ),
    },
    postSessionHookDigest: safeDigest(
      input.postSessionHookDigest,
      "runner post-session hook digest",
    ),
    drain,
    leases,
    updatedAt: safeTimestamp(input.updatedAt, "runner updatedAt"),
  };
}

function project(state) {
  const activeLeaseCount = state.leases.filter(
    (lease) => lease.status === "active",
  ).length;
  return Object.freeze({
    schema: state.schema,
    runnerId: state.runnerId,
    target: state.target,
    state: state.state,
    accepting: state.state === "accepting",
    generation: state.generation,
    policyRevision: state.policyRevision,
    baseDirDigest: receiptDigest(
      "chainlesschain.execution-location.base-dir.v1\0",
      state.baseDir,
    ),
    resources: Object.freeze({ ...state.resources }),
    proxyAuthority: Object.freeze({ ...state.proxyAuthority }),
    drain: state.drain ? Object.freeze({ ...state.drain }) : null,
    activeLeaseCount,
    parkedLeaseCount: state.leases.filter((lease) => lease.status === "parked")
      .length,
    settledLeaseCount: state.leases.filter(
      (lease) => lease.status === "settled",
    ).length,
    updatedAt: state.updatedAt,
  });
}

function preflightWritableDirectory(
  baseDir,
  runtimeFs = fs,
  randomId = randomUUID,
) {
  const stat = runtimeFs.lstatSync(baseDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(
      "execution location base directory must be a real directory",
    );
  }
  const probe = path.join(baseDir, `.cc-runner-preflight-${randomId()}`);
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
        // Preserve the original preflight error.
      }
    }
  }
}

export class ExecutionLocationRunnerLifecycle {
  constructor({
    filePath,
    runnerId,
    target,
    baseDir,
    resources,
    postSessionHookDigest,
    now = Date.now,
    randomId = randomUUID,
    runtimeFs = fs,
    preflightBaseDir = preflightWritableDirectory,
    normalizeBaseDir = path.resolve,
    lockOptions,
  } = {}) {
    if (!path.isAbsolute(String(filePath || ""))) {
      throw new TypeError("runner lifecycle filePath must be absolute");
    }
    this.filePath = path.resolve(filePath);
    this.runnerId = safeId(runnerId, "runnerId");
    this.target = safeId(target, "runner target");
    if (!TARGETS.has(this.target))
      throw new TypeError("runner target is invalid");
    if (typeof normalizeBaseDir !== "function") {
      throw new TypeError("runner normalizeBaseDir must be a function");
    }
    this.baseDir = String(normalizeBaseDir(baseDir));
    if (
      this.baseDir.length < 1 ||
      this.baseDir.length > 4096 ||
      this.baseDir.includes("\0")
    ) {
      throw new TypeError("runner baseDir is invalid");
    }
    this.resources = validateResources(resources);
    this.postSessionHookDigest = safeDigest(
      postSessionHookDigest,
      "postSessionHookDigest",
    );
    this._now = now;
    this._randomId = randomId;
    this._fs = runtimeFs;
    if (typeof preflightBaseDir !== "function") {
      throw new TypeError("runner preflightBaseDir must be a function");
    }
    this._preflightBaseDir = preflightBaseDir;
    this._lockOptions = lockOptions;
  }

  initialize() {
    const now = new Date(this._now()).toISOString();
    mutateSecurityStore(
      this.filePath,
      STORE_LABEL,
      (draft) => {
        if (Object.keys(draft).length > 0) {
          validateState(draft, this);
          return;
        }
        Object.assign(draft, {
          schema: EXECUTION_LOCATION_RUNNER_LIFECYCLE_SCHEMA,
          runnerId: this.runnerId,
          target: this.target,
          state: "accepting",
          generation: 1,
          policyRevision: 1,
          baseDir: this.baseDir,
          resources: { ...this.resources },
          proxyAuthority: { id: "unbound", revision: 0 },
          postSessionHookDigest: this.postSessionHookDigest,
          drain: null,
          leases: [],
          updatedAt: now,
        });
      },
      this._lockOptions,
    );
    return this.snapshot();
  }

  _read() {
    return validateState(readSecurityStore(this.filePath, STORE_LABEL), this);
  }

  snapshot() {
    return project(this._read());
  }

  acquireLease({
    sessionId,
    expectedGeneration,
    ttlMs = 10 * 60 * 1000,
    proxyAuthority,
  } = {}) {
    const nowMs = Number(this._now());
    const now = new Date(nowMs).toISOString();
    const normalizedSessionId = safeId(sessionId, "sessionId");
    const normalizedProxy = validateProxyAuthority(proxyAuthority, nowMs);
    const leaseId = `lease-${this._randomId()}`;
    const expiresAt = new Date(
      nowMs + safeInteger(ttlMs, "lease ttlMs", 1_000, 24 * 60 * 60 * 1000),
    ).toISOString();
    this._preflightBaseDir(this.baseDir, this._fs, this._randomId);
    let lease;
    mutateSecurityStore(
      this.filePath,
      STORE_LABEL,
      (draft) => {
        const state = validateState(draft, this);
        if (
          state.state !== "accepting" ||
          state.generation !== Number(expectedGeneration)
        ) {
          throw new Error(
            "execution location runner is not accepting this generation",
          );
        }
        if (
          state.leases.some(
            (candidate) =>
              candidate.sessionId === normalizedSessionId &&
              candidate.status === "active",
          )
        ) {
          throw new Error(
            "execution location session already has an active lease",
          );
        }
        if (
          state.proxyAuthority.id !== "unbound" &&
          state.proxyAuthority.id !== normalizedProxy.id
        ) {
          throw new Error(
            "execution location proxy authority identity drifted",
          );
        }
        if (normalizedProxy.revision < state.proxyAuthority.revision) {
          throw new Error(
            "execution location proxy authority revision rolled back",
          );
        }
        lease = {
          id: leaseId,
          sessionId: normalizedSessionId,
          generation: state.generation,
          issuedAt: now,
          expiresAt,
          status: "active",
          resultDigest: null,
          hookReceiptDigest: null,
        };
        Object.assign(draft, state, {
          proxyAuthority: {
            id: normalizedProxy.id,
            revision: normalizedProxy.revision,
          },
          leases: [...state.leases.slice(-(MAX_RETAINED_LEASES - 1)), lease],
          updatedAt: now,
        });
      },
      this._lockOptions,
    );
    const material = {
      runnerId: this.runnerId,
      target: this.target,
      authorityFile: this.filePath,
      state: "accepting",
      runnerGeneration: Number(expectedGeneration),
      lease,
      proxyAuthority: normalizedProxy,
      baseDir: { path: this.baseDir, writableRequired: true },
      resources: { ...this.resources },
      postSessionHook: {
        digest: this.postSessionHookDigest,
        generation: lease.generation,
      },
    };
    return Object.freeze({
      ...material,
      leaseReceiptDigest: receiptDigest(
        "chainlesschain.execution-location.runner-lease.v1\0",
        material,
      ),
    });
  }

  assertPoll({
    leaseId,
    leaseGeneration,
    proxyAuthorityId,
    proxyAuthorityRevision,
  } = {}) {
    const state = this._read();
    const lease = state.leases.find((candidate) => candidate.id === leaseId);
    if (
      !lease ||
      lease.status !== "active" ||
      lease.generation !== Number(leaseGeneration) ||
      Date.parse(lease.expiresAt) <= this._now() ||
      state.proxyAuthority.id !== proxyAuthorityId ||
      state.proxyAuthority.revision !== Number(proxyAuthorityRevision) ||
      state.state === "parked" ||
      state.state === "reclaiming"
    ) {
      throw new Error("execution location poll lease is stale or parked");
    }
    return Object.freeze({
      runnerId: state.runnerId,
      runnerGeneration: state.generation,
      leaseId: lease.id,
      leaseGeneration: lease.generation,
      state: state.state,
      proxyAuthority: Object.freeze({ ...state.proxyAuthority }),
    });
  }

  rotateProxyAuthority({ expectedGeneration, proxyAuthority } = {}) {
    const nowMs = Number(this._now());
    const now = new Date(nowMs).toISOString();
    let normalizedProxy;
    mutateSecurityStore(
      this.filePath,
      STORE_LABEL,
      (draft) => {
        const state = validateState(draft, this);
        normalizedProxy = validateProxyAuthority(
          proxyAuthority,
          nowMs,
          state.proxyAuthority.revision + 1,
        );
        if (
          (state.state !== "accepting" && state.state !== "draining") ||
          state.generation !== Number(expectedGeneration) ||
          normalizedProxy.id !== state.proxyAuthority.id
        ) {
          throw new Error("execution location proxy rotation fence is stale");
        }
        Object.assign(draft, state, {
          generation: state.generation + 1,
          policyRevision: state.policyRevision + 1,
          proxyAuthority: {
            id: normalizedProxy.id,
            revision: normalizedProxy.revision,
          },
          updatedAt: now,
        });
      },
      this._lockOptions,
    );
    return this.snapshot();
  }

  refreshLeaseAuthority({
    leaseId,
    leaseGeneration,
    expectedGeneration,
    proxyAuthority,
  } = {}) {
    const nowMs = Number(this._now());
    const state = this._read();
    const normalizedProxy = validateProxyAuthority(
      proxyAuthority,
      nowMs,
      state.proxyAuthority.revision,
    );
    const lease = state.leases.find((candidate) => candidate.id === leaseId);
    if (
      state.state !== "accepting" ||
      state.generation !== Number(expectedGeneration) ||
      state.proxyAuthority.id !== normalizedProxy.id ||
      state.proxyAuthority.revision !== normalizedProxy.revision ||
      !lease ||
      lease.status !== "active" ||
      lease.generation !== Number(leaseGeneration) ||
      Date.parse(lease.expiresAt) <= nowMs
    ) {
      throw new Error("execution location lease refresh fence is stale");
    }
    this._preflightBaseDir(this.baseDir, this._fs, this._randomId);
    const material = {
      runnerId: this.runnerId,
      target: this.target,
      authorityFile: this.filePath,
      state: state.state,
      runnerGeneration: state.generation,
      lease: { ...lease },
      proxyAuthority: normalizedProxy,
      baseDir: { path: this.baseDir, writableRequired: true },
      resources: { ...this.resources },
      postSessionHook: {
        digest: this.postSessionHookDigest,
        generation: lease.generation,
      },
    };
    return Object.freeze({
      ...material,
      leaseReceiptDigest: receiptDigest(
        "chainlesschain.execution-location.runner-lease.v1\0",
        material,
      ),
    });
  }

  requestDrain({
    expectedGeneration,
    timeoutMs = 30_000,
    signal = "SIGTERM",
  } = {}) {
    if (signal !== "SIGTERM")
      throw new TypeError("runner drain requires SIGTERM");
    const nowMs = Number(this._now());
    const requestedAt = new Date(nowMs).toISOString();
    const deadlineAt = new Date(
      nowMs + safeInteger(timeoutMs, "drain timeoutMs", 1, 10 * 60 * 1000),
    ).toISOString();
    mutateSecurityStore(
      this.filePath,
      STORE_LABEL,
      (draft) => {
        const state = validateState(draft, this);
        if (
          state.state !== "accepting" ||
          state.generation !== Number(expectedGeneration)
        ) {
          throw new Error("execution location drain generation is stale");
        }
        Object.assign(draft, state, {
          state: "draining",
          generation: state.generation + 1,
          drain: { signal, requestedAt, deadlineAt },
          updatedAt: requestedAt,
        });
      },
      this._lockOptions,
    );
    return this.snapshot();
  }

  settleLease({ leaseId, leaseGeneration, resultDigest } = {}) {
    const normalizedResultDigest = safeDigest(resultDigest, "resultDigest");
    const now = new Date(this._now()).toISOString();
    mutateSecurityStore(
      this.filePath,
      STORE_LABEL,
      (draft) => {
        const state = validateState(draft, this);
        const index = state.leases.findIndex((lease) => lease.id === leaseId);
        const lease = state.leases[index];
        if (
          !lease ||
          lease.status !== "active" ||
          lease.generation !== Number(leaseGeneration)
        ) {
          throw new Error("execution location result lease fence is stale");
        }
        const leases = state.leases.map((candidate, candidateIndex) =>
          candidateIndex === index
            ? {
                ...candidate,
                status: "settled",
                resultDigest: normalizedResultDigest,
              }
            : candidate,
        );
        const parkRunner =
          state.state === "draining" &&
          leases.every((candidate) => candidate.status !== "active");
        Object.assign(draft, state, {
          state: parkRunner ? "parked" : state.state,
          generation: parkRunner ? state.generation + 1 : state.generation,
          drain: parkRunner ? null : state.drain,
          leases,
          updatedAt: now,
        });
      },
      this._lockOptions,
    );
    return this.snapshot();
  }

  parkLease({ leaseId, leaseGeneration, resultDigest, reason } = {}) {
    const normalizedResultDigest = safeDigest(resultDigest, "resultDigest");
    if (
      reason !== "checkout-failure" &&
      reason !== "lost-poll" &&
      reason !== "resource-limit"
    ) {
      throw new TypeError("execution location park reason is invalid");
    }
    const now = new Date(this._now()).toISOString();
    mutateSecurityStore(
      this.filePath,
      STORE_LABEL,
      (draft) => {
        const state = validateState(draft, this);
        const index = state.leases.findIndex((lease) => lease.id === leaseId);
        const lease = state.leases[index];
        if (
          (state.state !== "accepting" && state.state !== "draining") ||
          !lease ||
          lease.status !== "active" ||
          lease.generation !== Number(leaseGeneration)
        ) {
          throw new Error("execution location park lease fence is stale");
        }
        const leases = state.leases.map((candidate, candidateIndex) =>
          candidateIndex === index
            ? {
                ...candidate,
                status: "parked",
                resultDigest: normalizedResultDigest,
              }
            : candidate,
        );
        const parkRunner = leases.every(
          (candidate) => candidate.status !== "active",
        );
        Object.assign(draft, state, {
          state: parkRunner ? "parked" : state.state,
          generation: parkRunner ? state.generation + 1 : state.generation,
          drain: parkRunner ? null : state.drain,
          leases,
          updatedAt: now,
        });
      },
      this._lockOptions,
    );
    return Object.freeze({ ...this.snapshot(), parkReason: reason });
  }

  parkExpiredDrain({ expectedGeneration } = {}) {
    const nowMs = Number(this._now());
    const now = new Date(nowMs).toISOString();
    let parked = 0;
    mutateSecurityStore(
      this.filePath,
      STORE_LABEL,
      (draft) => {
        const state = validateState(draft, this);
        if (
          state.state !== "draining" ||
          state.generation !== Number(expectedGeneration) ||
          Date.parse(state.drain.deadlineAt) > nowMs
        ) {
          throw new Error("execution location drain is not ready to park");
        }
        const leases = state.leases.map((lease) => {
          if (lease.status !== "active") return lease;
          parked += 1;
          return { ...lease, status: "parked" };
        });
        Object.assign(draft, state, {
          state: "parked",
          generation: state.generation + 1,
          drain: null,
          leases,
          updatedAt: now,
        });
      },
      this._lockOptions,
    );
    return Object.freeze({ ...this.snapshot(), newlyParkedLeaseCount: parked });
  }

  beginReclaim({ expectedGeneration, proxyAuthority } = {}) {
    const nowMs = Number(this._now());
    const now = new Date(nowMs).toISOString();
    let normalizedProxy;
    mutateSecurityStore(
      this.filePath,
      STORE_LABEL,
      (draft) => {
        const state = validateState(draft, this);
        normalizedProxy = validateProxyAuthority(
          proxyAuthority,
          nowMs,
          state.proxyAuthority.revision + 1,
        );
        if (
          state.state !== "parked" ||
          state.generation !== Number(expectedGeneration) ||
          normalizedProxy.id !== state.proxyAuthority.id
        ) {
          throw new Error("execution location reclaim fence is stale");
        }
        Object.assign(draft, state, {
          state: "reclaiming",
          generation: state.generation + 1,
          proxyAuthority: {
            id: normalizedProxy.id,
            revision: normalizedProxy.revision,
          },
          updatedAt: now,
        });
      },
      this._lockOptions,
    );
    return this.snapshot();
  }

  completeReclaim({ expectedGeneration } = {}) {
    const now = new Date(this._now()).toISOString();
    mutateSecurityStore(
      this.filePath,
      STORE_LABEL,
      (draft) => {
        const state = validateState(draft, this);
        if (
          state.state !== "reclaiming" ||
          state.generation !== Number(expectedGeneration)
        ) {
          throw new Error("execution location reclaim completion is stale");
        }
        Object.assign(draft, state, {
          state: "accepting",
          generation: state.generation + 1,
          leases: state.leases.slice(-256),
          updatedAt: now,
        });
      },
      this._lockOptions,
    );
    return this.snapshot();
  }

  authorizePostSessionHook({
    expectedRunnerGeneration,
    leaseId,
    leaseGeneration,
    resultDigest,
    hookDigest,
  } = {}) {
    const normalizedResultDigest = safeDigest(resultDigest, "resultDigest");
    const normalizedHookDigest = safeDigest(hookDigest, "hookDigest");
    const now = new Date(this._now()).toISOString();
    let receipt;
    mutateSecurityStore(
      this.filePath,
      STORE_LABEL,
      (draft) => {
        const state = validateState(draft, this);
        const index = state.leases.findIndex((lease) => lease.id === leaseId);
        const lease = state.leases[index];
        if (
          state.generation !== Number(expectedRunnerGeneration) ||
          (state.state !== "parked" && state.state !== "draining") ||
          !lease ||
          lease.generation !== Number(leaseGeneration) ||
          lease.status === "active" ||
          lease.resultDigest !== normalizedResultDigest ||
          lease.hookReceiptDigest !== null ||
          normalizedHookDigest !== state.postSessionHookDigest
        ) {
          throw new Error(
            "execution location post-session hook fence is stale",
          );
        }
        const material = {
          runnerId: state.runnerId,
          runnerGeneration: state.generation,
          leaseId: lease.id,
          leaseGeneration: lease.generation,
          resultDigest: normalizedResultDigest,
          hookDigest: normalizedHookDigest,
        };
        receipt = {
          ...material,
          receiptDigest: receiptDigest(
            "chainlesschain.execution-location.post-session-hook.v1\0",
            material,
          ),
        };
        const leases = state.leases.map((candidate, candidateIndex) =>
          candidateIndex === index
            ? { ...candidate, hookReceiptDigest: receipt.receiptDigest }
            : candidate,
        );
        Object.assign(draft, state, { leases, updatedAt: now });
      },
      this._lockOptions,
    );
    return Object.freeze(receipt);
  }
}

export function lifecycleProfileFromLease(leaseReceipt) {
  if (!leaseReceipt || typeof leaseReceipt !== "object") {
    throw new TypeError("runner lease receipt is required");
  }
  return Object.freeze({
    runnerId: leaseReceipt.runnerId,
    authorityFile: leaseReceipt.authorityFile,
    state: leaseReceipt.state,
    generation: leaseReceipt.runnerGeneration,
    lease: Object.freeze({
      id: leaseReceipt.lease.id,
      generation: leaseReceipt.lease.generation,
      expiresAt: leaseReceipt.lease.expiresAt,
    }),
    proxyAuthority: Object.freeze({ ...leaseReceipt.proxyAuthority }),
    baseDir: Object.freeze({ ...leaseReceipt.baseDir }),
    resources: Object.freeze({ ...leaseReceipt.resources }),
    postSessionHook: Object.freeze({ ...leaseReceipt.postSessionHook }),
  });
}

export function assertExecutionLocationRunnerLeaseAuthority(
  lifecycle,
  target,
  deps = {},
) {
  if (!lifecycle || typeof lifecycle !== "object") {
    throw new TypeError("runner lifecycle authority is required");
  }
  const authorityFileInput = String(lifecycle.authorityFile || "");
  if (
    !path.isAbsolute(authorityFileInput) ||
    authorityFileInput.length > 4096 ||
    authorityFileInput.includes("\0")
  ) {
    throw new TypeError("runner authority file is invalid");
  }
  const authorityFile = path.resolve(authorityFileInput);
  const state = validateState(
    (deps.readSecurityStore || readSecurityStore)(authorityFile, STORE_LABEL),
    {
      runnerId: lifecycle.runnerId,
      target,
      baseDir: lifecycle.baseDir?.path,
    },
  );
  const lease = state.leases.find(
    (candidate) => candidate.id === lifecycle.lease?.id,
  );
  if (
    state.state !== "accepting" ||
    state.generation !== Number(lifecycle.generation) ||
    state.resources.cpuSeconds !== Number(lifecycle.resources?.cpuSeconds) ||
    state.resources.memoryBytes !== Number(lifecycle.resources?.memoryBytes) ||
    state.proxyAuthority.id !== lifecycle.proxyAuthority?.id ||
    state.proxyAuthority.revision !==
      Number(lifecycle.proxyAuthority?.revision) ||
    state.postSessionHookDigest !== lifecycle.postSessionHook?.digest ||
    !lease ||
    lease.status !== "active" ||
    lease.generation !== Number(lifecycle.lease?.generation) ||
    lease.expiresAt !== lifecycle.lease?.expiresAt ||
    Date.parse(lease.expiresAt) <= Number((deps.now || Date.now)())
  ) {
    throw new Error("execution location runner lease authority is stale");
  }
  return Object.freeze({
    runnerId: state.runnerId,
    target: state.target,
    state: state.state,
    generation: state.generation,
    leaseId: lease.id,
    leaseGeneration: lease.generation,
    proxyAuthority: Object.freeze({ ...state.proxyAuthority }),
  });
}
