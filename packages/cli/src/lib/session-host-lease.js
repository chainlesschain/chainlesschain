/**
 * Durable same-machine lease and fencing authority for canonical sessions.
 *
 * A lease is cooperative authority for production hosts, not a same-UID
 * sandbox. Every process sharing CHAINLESSCHAIN_HOME observes the same strict
 * state file. A monotonically increasing fencing token prevents a crashed host
 * from publishing through guarded session-store write paths after a successor
 * takes over. A separate monotonic revocation epoch lets an operator fence a
 * still-live host; every guarded transition re-reads it. An exact local owner
 * may renew after its TTL when the event loop was blocked: no successor can
 * have been admitted while that owner PID remained live, and any revocation or
 * takeover still changes the durable authority tuple and fences the old host.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cliPaths from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import { withFileLock } from "./with-file-lock.js";

export const SESSION_HOST_LEASE_HELD_CODE = "CC_SESSION_HOST_LEASE_HELD";
export const SESSION_HOST_LEASE_FENCED_CODE = "CC_SESSION_HOST_LEASE_FENCED";
export const SESSION_HOST_LEASE_UNAVAILABLE_CODE =
  "CC_SESSION_HOST_LEASE_UNAVAILABLE";
export const SESSION_HOST_REVOCATION_CONFLICT_CODE =
  "CC_SESSION_HOST_REVOCATION_CONFLICT";

const STORE_VERSION = 2;
const LEGACY_STORE_VERSION = 1;
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 5_000;
const MAX_SESSION_ID_BYTES = 1024;
const MAX_REVOCATIONS = 1024;
const HOST_KIND_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const LEASE_ID_PATTERN = /^lease-[0-9a-f-]{36}$/;
const REVOCATION_REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;
const REVOCATION_REASON_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function leaseError(code, message, details = {}, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "SessionHostLeaseError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function canonicalSessionId(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > MAX_SESSION_ID_BYTES
  ) {
    throw new TypeError("session host lease requires a bounded session id");
  }
  return value;
}

function canonicalHostKind(value) {
  const kind = String(value || "unknown").toLowerCase();
  if (!HOST_KIND_PATTERN.test(kind)) {
    throw new TypeError("session host kind is invalid");
  }
  return kind;
}

function canonicalRevocationRequestId(value) {
  if (typeof value !== "string" || !REVOCATION_REQUEST_ID_PATTERN.test(value)) {
    throw new TypeError("session host revocation requestId is invalid");
  }
  return value;
}

function canonicalRevocationReason(value) {
  const reason = String(value || "operator").toLowerCase();
  if (!REVOCATION_REASON_PATTERN.test(reason)) {
    throw new TypeError("session host revocation reasonCode is invalid");
  }
  return reason;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return number;
}

function normalizeActiveLease(value, fallbackRevocationEpoch = null) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("active session host lease must be an object or null");
  }
  if (
    typeof value.leaseId !== "string" ||
    !LEASE_ID_PATTERN.test(value.leaseId) ||
    !Number.isSafeInteger(value.fencingToken) ||
    value.fencingToken < 1 ||
    !Number.isSafeInteger(value.revocationEpoch ?? fallbackRevocationEpoch) ||
    (value.revocationEpoch ?? fallbackRevocationEpoch) < 0 ||
    !Number.isSafeInteger(value.ownerPid) ||
    value.ownerPid < 1 ||
    typeof value.hostKind !== "string" ||
    !HOST_KIND_PATTERN.test(value.hostKind) ||
    !Number.isSafeInteger(value.acquiredAtMs) ||
    value.acquiredAtMs < 0 ||
    !Number.isSafeInteger(value.renewedAtMs) ||
    value.renewedAtMs < value.acquiredAtMs ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    value.expiresAtMs < value.renewedAtMs
  ) {
    throw new TypeError("active session host lease is invalid");
  }
  return Object.freeze({
    leaseId: value.leaseId,
    fencingToken: value.fencingToken,
    revocationEpoch: value.revocationEpoch ?? fallbackRevocationEpoch,
    ownerPid: value.ownerPid,
    hostKind: value.hostKind,
    acquiredAtMs: value.acquiredAtMs,
    renewedAtMs: value.renewedAtMs,
    expiresAtMs: value.expiresAtMs,
  });
}

function normalizeWriteDelegation(value, expectedSessionId = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("session host write delegation must be an object");
  }
  const sessionId = canonicalSessionId(value.sessionId);
  if (expectedSessionId !== null && sessionId !== expectedSessionId) {
    throw leaseError(
      SESSION_HOST_LEASE_FENCED_CODE,
      `Session host write delegation belongs to a different session`,
      { sessionId: expectedSessionId, delegatedSessionId: sessionId },
    );
  }
  if (
    typeof value.leaseId !== "string" ||
    !LEASE_ID_PATTERN.test(value.leaseId) ||
    !Number.isSafeInteger(value.fencingToken) ||
    value.fencingToken < 1 ||
    !Number.isSafeInteger(value.revocationEpoch) ||
    value.revocationEpoch < 0 ||
    !Number.isSafeInteger(value.ownerPid) ||
    value.ownerPid < 1 ||
    typeof value.hostKind !== "string" ||
    !HOST_KIND_PATTERN.test(value.hostKind)
  ) {
    throw new TypeError("session host write delegation is invalid");
  }
  return Object.freeze({
    sessionId,
    leaseId: value.leaseId,
    fencingToken: value.fencingToken,
    revocationEpoch: value.revocationEpoch,
    ownerPid: value.ownerPid,
    hostKind: value.hostKind,
  });
}

function delegationMatchesLease(delegation, lease) {
  return Boolean(
    delegation &&
    lease &&
    delegation.leaseId === lease.leaseId &&
    delegation.fencingToken === lease.fencingToken &&
    delegation.revocationEpoch === lease.revocationEpoch &&
    delegation.ownerPid === lease.ownerPid &&
    delegation.hostKind === lease.hostKind,
  );
}

function normalizeRevocation(value, expectedEpoch) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("session host revocation must be an object");
  }
  const targetIsNull = value.targetLeaseId === null;
  if (
    canonicalRevocationRequestId(value.requestId) !== value.requestId ||
    canonicalRevocationReason(value.reasonCode) !== value.reasonCode ||
    !Number.isSafeInteger(value.revocationEpoch) ||
    value.revocationEpoch !== expectedEpoch ||
    !Number.isSafeInteger(value.revokedAtMs) ||
    value.revokedAtMs < 0 ||
    (targetIsNull
      ? value.targetFencingToken !== null || value.targetOwnerPid !== null
      : !LEASE_ID_PATTERN.test(String(value.targetLeaseId || "")) ||
        !Number.isSafeInteger(value.targetFencingToken) ||
        value.targetFencingToken < 1 ||
        !Number.isSafeInteger(value.targetOwnerPid) ||
        value.targetOwnerPid < 1)
  ) {
    throw new TypeError("session host revocation is invalid");
  }
  return Object.freeze({
    requestId: value.requestId,
    revocationEpoch: value.revocationEpoch,
    reasonCode: value.reasonCode,
    revokedAtMs: value.revokedAtMs,
    targetLeaseId: value.targetLeaseId,
    targetFencingToken: value.targetFencingToken,
    targetOwnerPid: value.targetOwnerPid,
  });
}

function validateStore(value, sessionId, { missing = false } = {}) {
  if (missing && Object.keys(value).length === 0) {
    return Object.freeze({
      version: STORE_VERSION,
      sessionId,
      lastFencingToken: 0,
      revocationEpoch: 0,
      revocations: Object.freeze([]),
      active: null,
    });
  }
  const legacy = value?.version === LEGACY_STORE_VERSION;
  if (
    (!legacy && value?.version !== STORE_VERSION) ||
    value?.sessionId !== sessionId ||
    !Number.isSafeInteger(value?.lastFencingToken) ||
    value.lastFencingToken < 0
  ) {
    throw new TypeError("session host lease store is invalid");
  }
  const revocationEpoch = legacy ? 0 : value.revocationEpoch;
  const rawRevocations = legacy ? [] : value.revocations;
  if (
    !Number.isSafeInteger(revocationEpoch) ||
    revocationEpoch < 0 ||
    !Array.isArray(rawRevocations) ||
    rawRevocations.length > MAX_REVOCATIONS ||
    rawRevocations.length !== revocationEpoch
  ) {
    throw new TypeError("session host revocation authority is invalid");
  }
  const revocations = rawRevocations.map((record, index) =>
    normalizeRevocation(record, index + 1),
  );
  if (
    new Set(revocations.map((record) => record.requestId)).size !==
    revocations.length
  ) {
    throw new TypeError("session host revocation requestIds must be unique");
  }
  const active = normalizeActiveLease(value.active, legacy ? 0 : null);
  if (active && active.fencingToken !== value.lastFencingToken) {
    throw new TypeError("active lease does not match the last fencing token");
  }
  if (active && active.revocationEpoch !== revocationEpoch) {
    throw new TypeError("active lease predates the revocation authority");
  }
  return Object.freeze({
    version: STORE_VERSION,
    sessionId,
    lastFencingToken: value.lastFencingToken,
    revocationEpoch,
    revocations: Object.freeze(revocations),
    active,
  });
}

function sameLease(left, right) {
  return Boolean(
    left &&
    right &&
    left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.ownerPid === right.ownerPid,
  );
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function publicLease(active) {
  return Object.freeze({ ...active });
}

function publicRevocation(record, replayed) {
  return Object.freeze({ ...record, replayed });
}

export function getSessionHostLeaseRoot() {
  const projectDir =
    typeof cliPaths.getClaudeProjectStorageDir === "function"
      ? cliPaths.getClaudeProjectStorageDir()
      : null;
  if (projectDir) {
    const stateRoot = path.join(projectDir, "session-host-leases");
    // The caller did not supply this location; it is derived exclusively from
    // the validated launch environment. Establish the same private project
    // tree for host leases that JSONL uses for transcripts.
    if (
      typeof cliPaths.getHomeDir === "function" &&
      typeof cliPaths.ensureClaudeProjectStorageTree === "function"
    ) {
      cliPaths.ensureClaudeProjectStorageTree(
        cliPaths.getHomeDir(),
        projectDir,
        { extraDirectories: [stateRoot] },
      );
    }
    return stateRoot;
  }
  return path.join(cliPaths.getStatePath(), "session-host-leases");
}

export class SessionHostLeaseAuthority {
  constructor({
    stateRoot = getSessionHostLeaseRoot(),
    now = () => Date.now(),
    isProcessAlive = processAlive,
    createLeaseId = () => `lease-${crypto.randomUUID()}`,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    lock = withFileLock,
  } = {}) {
    if (!path.isAbsolute(stateRoot)) {
      throw new TypeError("session host lease root must be absolute");
    }
    this.stateRoot = path.resolve(stateRoot);
    this._now = now;
    this._isProcessAlive = isProcessAlive;
    this._createLeaseId = createLeaseId;
    this._setInterval = setIntervalFn;
    this._clearInterval = clearIntervalFn;
    this._lock = lock;
    this._local = new Map();
    this._fenced = new Map();
    this._delegatedWrites = [];
  }

  pathFor(sessionId) {
    const id = canonicalSessionId(sessionId);
    const digest = crypto.createHash("sha256").update(id).digest("hex");
    return path.join(this.stateRoot, `${digest}.json`);
  }

  _key(sessionId) {
    return `${this.pathFor(sessionId)}\0${sessionId}`;
  }

  _read(filePath, sessionId) {
    const existed = fs.existsSync(filePath);
    return validateStore(
      readSecurityStore(filePath, "Session host lease authority"),
      sessionId,
      { missing: !existed },
    );
  }

  _unavailable(sessionId, filePath, cause) {
    if (
      cause?.code === SESSION_HOST_LEASE_HELD_CODE ||
      cause?.code === SESSION_HOST_LEASE_FENCED_CODE ||
      cause?.code === SESSION_HOST_LEASE_UNAVAILABLE_CODE ||
      cause?.code === SESSION_HOST_REVOCATION_CONFLICT_CODE
    ) {
      return cause;
    }
    const error = leaseError(
      SESSION_HOST_LEASE_UNAVAILABLE_CODE,
      `Session host lease authority is unavailable for ${sessionId}`,
      { sessionId, filePath },
      cause,
    );
    if (cause?.commitState) error.commitState = cause.commitState;
    return error;
  }

  _lose(record, cause) {
    if (!record || record.released) return;
    record.released = true;
    if (record.timer) this._clearInterval(record.timer);
    record.timer = null;
    this._local.delete(record.key);
    const reason =
      cause?.code === SESSION_HOST_LEASE_FENCED_CODE
        ? cause
        : this._unavailable(record.sessionId, record.filePath, cause);
    this._fenced.set(record.key, reason);
    if (!record.controller.signal.aborted) record.controller.abort(reason);
  }

  _writeSnapshot(draft, snapshot) {
    draft.version = STORE_VERSION;
    draft.sessionId = snapshot.sessionId;
    draft.lastFencingToken = snapshot.lastFencingToken;
    draft.revocationEpoch = snapshot.revocationEpoch;
    draft.revocations = snapshot.revocations.map((record) => ({ ...record }));
  }

  acquire(
    sessionId,
    {
      hostKind = "unknown",
      ttlMs = DEFAULT_TTL_MS,
      heartbeatMs = DEFAULT_HEARTBEAT_MS,
    } = {},
  ) {
    const id = canonicalSessionId(sessionId);
    const kind = canonicalHostKind(hostKind);
    const ttl = Math.max(1_000, positiveInteger(ttlMs, "lease ttl"));
    const heartbeat = Math.max(
      250,
      Math.min(ttl - 1, positiveInteger(heartbeatMs, "heartbeat interval")),
    );
    const filePath = this.pathFor(id);
    const key = this._key(id);
    const priorFence = this._fenced.get(key);
    if (priorFence) throw priorFence;
    if (this._local.has(key)) {
      throw leaseError(
        SESSION_HOST_LEASE_HELD_CODE,
        `This process already hosts session ${id}`,
        { sessionId: id, filePath },
      );
    }

    let active;
    try {
      active = mutateSecurityStore(
        filePath,
        "Session host lease authority",
        (draft) => {
          const snapshot = validateStore(draft, id, {
            missing: !fs.existsSync(filePath),
          });
          const now = Math.trunc(this._now());
          const incumbent = snapshot.active;
          // Never take authority from a process that the OS still reports as
          // alive, even after its heartbeat TTL. It may be blocked inside an
          // external side effect and resume later. The exact local owner may
          // renew late; takeover additionally requires proven process death so
          // two executors cannot overlap.
          if (incumbent && this._isProcessAlive(incumbent.ownerPid)) {
            throw leaseError(
              SESSION_HOST_LEASE_HELD_CODE,
              `Session ${id} is already hosted by another live process`,
              {
                sessionId: id,
                filePath,
                incumbent: publicLease(incumbent),
              },
            );
          }
          const fencingToken = snapshot.lastFencingToken + 1;
          const next = {
            leaseId: this._createLeaseId(),
            fencingToken,
            revocationEpoch: snapshot.revocationEpoch,
            ownerPid: process.pid,
            hostKind: kind,
            acquiredAtMs: now,
            renewedAtMs: now,
            expiresAtMs: now + ttl,
          };
          normalizeActiveLease(next);
          this._writeSnapshot(draft, snapshot);
          draft.lastFencingToken = fencingToken;
          draft.active = next;
          return next;
        },
        { lock: this._lock, timeoutMs: 30_000, staleMs: 30_000 },
      );
    } catch (cause) {
      throw this._unavailable(id, filePath, cause);
    }

    const controller = new AbortController();
    const record = {
      key,
      sessionId: id,
      filePath,
      ttlMs: ttl,
      heartbeatMs: heartbeat,
      active: normalizeActiveLease(active),
      controller,
      timer: null,
      released: false,
    };
    this._local.set(key, record);

    const renew = () => {
      if (record.released) {
        throw leaseError(
          SESSION_HOST_LEASE_FENCED_CODE,
          `Session host lease is no longer active for ${id}`,
          { sessionId: id, fencingToken: record.active.fencingToken },
        );
      }
      try {
        const renewed = mutateSecurityStore(
          filePath,
          "Session host lease authority",
          (draft) => {
            const snapshot = validateStore(draft, id);
            if (
              snapshot.revocationEpoch !== record.active.revocationEpoch ||
              !sameLease(snapshot.active, record.active)
            ) {
              throw leaseError(
                SESSION_HOST_LEASE_FENCED_CODE,
                `Session host lease was superseded for ${id}`,
                {
                  sessionId: id,
                  fencingToken: record.active.fencingToken,
                  activeFencingToken: snapshot.active?.fencingToken ?? null,
                  localRevocationEpoch: record.active.revocationEpoch,
                  activeRevocationEpoch: snapshot.revocationEpoch,
                },
              );
            }
            const now = Math.trunc(this._now());
            const next = {
              ...snapshot.active,
              renewedAtMs: now,
              expiresAtMs: now + ttl,
            };
            this._writeSnapshot(draft, snapshot);
            draft.active = next;
            return next;
          },
          { lock: this._lock, timeoutMs: 30_000, staleMs: 30_000 },
        );
        record.active = normalizeActiveLease(renewed);
        return publicLease(record.active);
      } catch (cause) {
        const error = this._unavailable(id, filePath, cause);
        this._lose(record, error);
        throw error;
      }
    };

    const release = () => {
      if (record.released) return false;
      if (record.timer) this._clearInterval(record.timer);
      record.timer = null;
      let outcome = Object.freeze({ released: false, fenced: true });
      try {
        outcome = mutateSecurityStore(
          filePath,
          "Session host lease authority",
          (draft) => {
            const snapshot = validateStore(draft, id);
            if (
              snapshot.revocationEpoch !== record.active.revocationEpoch ||
              !sameLease(snapshot.active, record.active)
            ) {
              return Object.freeze({
                released: false,
                fenced: true,
                activeFencingToken: snapshot.active?.fencingToken ?? null,
                activeRevocationEpoch: snapshot.revocationEpoch,
              });
            }
            this._writeSnapshot(draft, snapshot);
            draft.active = null;
            return Object.freeze({ released: true, fenced: false });
          },
          { lock: this._lock, timeoutMs: 30_000, staleMs: 30_000 },
        );
      } catch (cause) {
        const error = this._unavailable(id, filePath, cause);
        this._lose(record, error);
        throw error;
      }
      if (!outcome.released) {
        this._lose(
          record,
          leaseError(
            SESSION_HOST_LEASE_FENCED_CODE,
            `Session host lease cannot be released after losing authority for ${id}`,
            {
              sessionId: id,
              fencingToken: record.active.fencingToken,
              activeFencingToken: outcome.activeFencingToken ?? null,
              localRevocationEpoch: record.active.revocationEpoch,
              activeRevocationEpoch: outcome.activeRevocationEpoch ?? null,
            },
          ),
        );
        return false;
      }
      record.released = true;
      this._local.delete(key);
      return true;
    };

    record.timer = this._setInterval(() => {
      try {
        renew();
      } catch {
        // renew() already aborts and retires the local lease.
      }
    }, heartbeat);
    record.timer?.unref?.();

    const admitMcpDispatch = (_metadata, dispatch) => {
      if (typeof dispatch !== "function") {
        throw new TypeError("session host MCP dispatch callback is required");
      }
      return this.withWriteAuthority(id, (authority) => {
        // A lease-owned dispatch must never inherit the legacy no-lease write
        // authority represented by null. Invoke the actual transport send
        // while the authority lock is held, then return its response promise
        // without awaiting it so the lock covers dispatch only.
        if (!authority) {
          throw leaseError(
            SESSION_HOST_LEASE_FENCED_CODE,
            `Session host MCP dispatch is fenced for ${id}`,
            { sessionId: id, fencingToken: record.active.fencingToken },
          );
        }
        return dispatch();
      });
    };

    return Object.freeze({
      sessionId: id,
      leaseId: record.active.leaseId,
      fencingToken: record.active.fencingToken,
      revocationEpoch: record.active.revocationEpoch,
      ownerPid: record.active.ownerPid,
      hostKind: record.active.hostKind,
      signal: controller.signal,
      renew,
      assert: () => this.withWriteAuthority(id, (authority) => authority),
      admitMcpDispatch,
      release,
    });
  }

  readAuthority(sessionId) {
    const id = canonicalSessionId(sessionId);
    const filePath = this.pathFor(id);
    if (!fs.existsSync(filePath)) {
      return Object.freeze({
        version: STORE_VERSION,
        sessionId: id,
        lastFencingToken: 0,
        revocationEpoch: 0,
        revocationCount: 0,
        latestRevocation: null,
        active: null,
      });
    }
    try {
      return this._lock(
        filePath,
        () => {
          const snapshot = this._read(filePath, id);
          return Object.freeze({
            version: STORE_VERSION,
            sessionId: id,
            lastFencingToken: snapshot.lastFencingToken,
            revocationEpoch: snapshot.revocationEpoch,
            revocationCount: snapshot.revocations.length,
            latestRevocation:
              snapshot.revocations.length > 0
                ? publicRevocation(snapshot.revocations.at(-1), false)
                : null,
            active: snapshot.active ? publicLease(snapshot.active) : null,
          });
        },
        {
          timeoutMs: 30_000,
          staleMs: 30_000,
          retryMs: 1,
          maxRetryMs: 8,
          retryJitterMs: 4,
          failIfUnavailable: true,
        },
      );
    } catch (cause) {
      throw this._unavailable(id, filePath, cause);
    }
  }

  /**
   * Durably revoke the current host generation. The request id is a permanent
   * idempotency key: an exact replay returns the original record and never
   * revokes a successor. The bounded journal fails closed at capacity rather
   * than evicting replay authority.
   */
  revoke(sessionId, { requestId, reasonCode = "operator" } = {}) {
    const id = canonicalSessionId(sessionId);
    const canonicalRequestId = canonicalRevocationRequestId(requestId);
    const canonicalReasonCode = canonicalRevocationReason(reasonCode);
    const filePath = this.pathFor(id);
    const key = this._key(id);
    let result;
    try {
      result = mutateSecurityStore(
        filePath,
        "Session host lease authority",
        (draft) => {
          const snapshot = validateStore(draft, id, {
            missing: !fs.existsSync(filePath),
          });
          const replay = snapshot.revocations.find(
            (record) => record.requestId === canonicalRequestId,
          );
          if (replay) {
            if (replay.reasonCode !== canonicalReasonCode) {
              throw leaseError(
                SESSION_HOST_REVOCATION_CONFLICT_CODE,
                `Session host revocation requestId was reused with different authority: ${canonicalRequestId}`,
                { sessionId: id, requestId: canonicalRequestId },
              );
            }
            return publicRevocation(replay, true);
          }
          if (snapshot.revocations.length >= MAX_REVOCATIONS) {
            throw new RangeError(
              "session host revocation journal is full and requires explicit operator repair",
            );
          }
          const revocationEpoch = snapshot.revocationEpoch + 1;
          if (!Number.isSafeInteger(revocationEpoch)) {
            throw new RangeError("session host revocation epoch is exhausted");
          }
          const active = snapshot.active;
          const record = normalizeRevocation(
            {
              requestId: canonicalRequestId,
              revocationEpoch,
              reasonCode: canonicalReasonCode,
              revokedAtMs: Math.trunc(this._now()),
              targetLeaseId: active?.leaseId ?? null,
              targetFencingToken: active?.fencingToken ?? null,
              targetOwnerPid: active?.ownerPid ?? null,
            },
            revocationEpoch,
          );
          this._writeSnapshot(draft, snapshot);
          draft.revocationEpoch = revocationEpoch;
          draft.revocations = [
            ...snapshot.revocations.map((entry) => ({ ...entry })),
            { ...record },
          ];
          draft.active = null;
          return publicRevocation(record, false);
        },
        { lock: this._lock, timeoutMs: 30_000, staleMs: 30_000 },
      );
    } catch (cause) {
      const error = this._unavailable(id, filePath, cause);
      if (["committed", "unknown"].includes(error.commitState)) {
        try {
          const latest = this.readAuthority(id).latestRevocation;
          if (
            latest?.requestId === canonicalRequestId &&
            latest?.reasonCode === canonicalReasonCode
          ) {
            result = publicRevocation(latest, true);
          }
        } catch {
          // The original classified write failure remains the authority when
          // exact readback cannot prove this request's durable record.
        }
      }
      if (!result) {
        const local = this._local.get(key);
        if (local) this._lose(local, error);
        throw error;
      }
    }

    const local = this._local.get(key);
    if (
      local &&
      local.active.revocationEpoch < result.revocationEpoch &&
      (!result.targetLeaseId || result.targetLeaseId === local.active.leaseId)
    ) {
      this._lose(
        local,
        leaseError(
          SESSION_HOST_LEASE_FENCED_CODE,
          `Session host authority was durably revoked for ${id}`,
          {
            sessionId: id,
            requestId: result.requestId,
            fencingToken: local.active.fencingToken,
            localRevocationEpoch: local.active.revocationEpoch,
            activeRevocationEpoch: result.revocationEpoch,
            revoked: true,
          },
        ),
      );
    }
    return result;
  }

  withWriteAuthority(sessionId, task) {
    if (typeof task !== "function") {
      throw new TypeError("session host write authority callback is required");
    }
    const id = canonicalSessionId(sessionId);
    const filePath = this.pathFor(id);
    const key = this._key(id);
    let callbackError = null;
    const invokeTask = (authority) => {
      try {
        return task(authority);
      } catch (cause) {
        callbackError = cause;
        throw cause;
      }
    };
    const priorFence = this._fenced.get(key);
    if (priorFence) throw priorFence;
    const local = this._local.get(key);
    const delegation = this._delegatedWrites.at(-1) || null;
    if (!fs.existsSync(filePath)) {
      if (!delegation && !local) return invokeTask(null);
      if (delegation) {
        throw leaseError(
          SESSION_HOST_LEASE_FENCED_CODE,
          `Delegated session write lost its active host lease: ${id}`,
          { sessionId: id, delegatedLeaseId: delegation.leaseId },
        );
      }
      const error = leaseError(
        SESSION_HOST_LEASE_FENCED_CODE,
        `Session host authority disappeared while locally held: ${id}`,
        {
          sessionId: id,
          localFencingToken: local.active.fencingToken,
          localRevocationEpoch: local.active.revocationEpoch,
        },
      );
      this._lose(local, error);
      throw error;
    }
    try {
      return this._lock(
        filePath,
        () => {
          const snapshot = this._read(filePath, id);
          const record = this._local.get(key);
          const now = Math.trunc(this._now());
          // A delegated scope is always constrained by the delegated lease.
          // Do this before considering a local record: an authority instance
          // may have acquired a successor/recovery lease after the delegation
          // was minted, and that local authority must never upgrade the stale
          // capability into a write under the successor.
          if (
            delegation &&
            (!snapshot.active ||
              !delegationMatchesLease(delegation, snapshot.active) ||
              delegation.sessionId !== id ||
              snapshot.active.expiresAtMs <= now)
          ) {
            throw leaseError(
              SESSION_HOST_LEASE_FENCED_CODE,
              `Delegated session write is fenced by a revocation, successor, or expired host lease: ${id}`,
              {
                sessionId: id,
                delegatedLeaseId: delegation.leaseId,
                delegatedFencingToken: delegation.fencingToken,
                activeLeaseId: snapshot.active?.leaseId ?? null,
                activeFencingToken: snapshot.active?.fencingToken ?? null,
                activeRevocationEpoch: snapshot.revocationEpoch,
              },
            );
          }
          if (delegation && snapshot.active) {
            return invokeTask(
              Object.freeze({
                leaseId: snapshot.active.leaseId,
                fencingToken: snapshot.active.fencingToken,
                revocationEpoch: snapshot.active.revocationEpoch,
                ownerPid: snapshot.active.ownerPid,
                hostKind: snapshot.active.hostKind,
                delegated: true,
              }),
            );
          }
          if (
            record &&
            (record.released ||
              record.active.revocationEpoch !== snapshot.revocationEpoch ||
              !sameLease(snapshot.active, record.active))
          ) {
            const error = leaseError(
              SESSION_HOST_LEASE_FENCED_CODE,
              `Session write is fenced by a revocation, successor, or expired host lease: ${id}`,
              {
                sessionId: id,
                activeFencingToken: snapshot.active?.fencingToken ?? null,
                localFencingToken: record.active.fencingToken,
                localRevocationEpoch: record.active.revocationEpoch,
                activeRevocationEpoch: snapshot.revocationEpoch,
                revoked:
                  record.active.revocationEpoch !== snapshot.revocationEpoch,
              },
            );
            this._lose(record, error);
            throw error;
          }
          if (!record && snapshot.active) {
            throw leaseError(
              SESSION_HOST_LEASE_FENCED_CODE,
              `Session write is fenced by another host lease: ${id}`,
              {
                sessionId: id,
                activeFencingToken: snapshot.active?.fencingToken ?? null,
                localFencingToken: null,
                activeRevocationEpoch: snapshot.revocationEpoch,
              },
            );
          }
          if (!record) return invokeTask(null);
          return invokeTask(
            Object.freeze({
              leaseId: snapshot.active.leaseId,
              fencingToken: snapshot.active.fencingToken,
              revocationEpoch: snapshot.active.revocationEpoch,
              ownerPid: snapshot.active.ownerPid,
              hostKind: snapshot.active.hostKind,
            }),
          );
        },
        {
          timeoutMs: 30_000,
          staleMs: 30_000,
          retryMs: 1,
          maxRetryMs: 8,
          retryJitterMs: 4,
          failIfUnavailable: true,
        },
      );
    } catch (cause) {
      if (cause === callbackError) throw cause;
      throw this._unavailable(id, filePath, cause);
    }
  }

  withDelegatedWriteAuthority(sessionId, delegation, task, options = {}) {
    if (typeof task !== "function") {
      throw new TypeError("delegated session host write callback is required");
    }
    const id = canonicalSessionId(sessionId);
    const normalized = normalizeWriteDelegation(delegation, id);
    if (
      options.expectedOwnerPid !== undefined &&
      normalized.ownerPid !==
        positiveInteger(options.expectedOwnerPid, "delegated owner pid")
    ) {
      throw leaseError(
        SESSION_HOST_LEASE_FENCED_CODE,
        `Session host write delegation owner does not match the turn child (delegated ${normalized.ownerPid}, expected ${Number(options.expectedOwnerPid)})`,
        {
          sessionId: id,
          delegatedOwnerPid: normalized.ownerPid,
          expectedOwnerPid: Number(options.expectedOwnerPid),
        },
      );
    }
    this._delegatedWrites.push(normalized);
    try {
      const result = task();
      if (result && typeof result.then === "function") {
        throw new TypeError(
          "delegated session host write callback must be synchronous",
        );
      }
      return result;
    } finally {
      this._delegatedWrites.pop();
    }
  }
}

const scopedAuthorities = new Map();

function authorityFor(options = {}) {
  const stateRoot = path.resolve(
    options?.stateRoot || getSessionHostLeaseRoot(),
  );
  let authority = scopedAuthorities.get(stateRoot);
  if (!authority) {
    authority = new SessionHostLeaseAuthority({ stateRoot });
    scopedAuthorities.set(stateRoot, authority);
  }
  return authority;
}

export function acquireSessionHostLease(sessionId, options) {
  const { stateRoot = null, ...leaseOptions } = options || {};
  return authorityFor({ stateRoot }).acquire(sessionId, leaseOptions);
}

export function withSessionHostWriteAuthority(sessionId, task, options = {}) {
  return authorityFor(options).withWriteAuthority(sessionId, task);
}

export function createSessionHostWriteDelegation(lease) {
  return normalizeWriteDelegation(lease);
}

export function withSessionHostDelegatedWriteAuthority(
  sessionId,
  delegation,
  task,
  options,
) {
  const { stateRoot = null, ...delegationOptions } = options || {};
  return authorityFor({ stateRoot }).withDelegatedWriteAuthority(
    sessionId,
    delegation,
    task,
    delegationOptions,
  );
}

export function withSessionHostRecoveryLease(
  sessionId,
  task,
  { hostKind = "background-recovery", stateRoot = null } = {},
) {
  if (typeof task !== "function") {
    throw new TypeError("session host recovery callback is required");
  }
  const lease = acquireSessionHostLease(sessionId, { hostKind, stateRoot });
  try {
    const result = task(lease);
    if (result && typeof result.then === "function") {
      throw new TypeError("session host recovery callback must be synchronous");
    }
    return result;
  } finally {
    lease.release();
  }
}

export function assertSessionHostWriteAuthority(sessionId, options = {}) {
  return authorityFor(options).withWriteAuthority(
    sessionId,
    (authority) => authority,
  );
}

export function readSessionHostAuthority(sessionId, options = {}) {
  return authorityFor(options).readAuthority(sessionId);
}

export function revokeSessionHostAuthority(sessionId, options = {}) {
  const { stateRoot = null, ...revocationOptions } = options;
  return authorityFor({ stateRoot }).revoke(sessionId, revocationOptions);
}
