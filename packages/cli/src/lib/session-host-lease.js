/**
 * Durable same-machine lease and fencing authority for canonical sessions.
 *
 * A lease is cooperative authority for production hosts, not a same-UID
 * sandbox. Every process sharing CHAINLESSCHAIN_HOME observes the same strict
 * state file. A monotonically increasing fencing token prevents an expired or
 * crashed host from publishing through guarded session-store write paths after
 * a successor takes over.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getStatePath } from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import { withFileLock } from "./with-file-lock.js";

export const SESSION_HOST_LEASE_HELD_CODE = "CC_SESSION_HOST_LEASE_HELD";
export const SESSION_HOST_LEASE_FENCED_CODE = "CC_SESSION_HOST_LEASE_FENCED";
export const SESSION_HOST_LEASE_UNAVAILABLE_CODE =
  "CC_SESSION_HOST_LEASE_UNAVAILABLE";

const STORE_VERSION = 1;
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 5_000;
const MAX_SESSION_ID_BYTES = 1024;
const HOST_KIND_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const LEASE_ID_PATTERN = /^lease-[0-9a-f-]{36}$/;

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

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return number;
}

function normalizeActiveLease(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("active session host lease must be an object or null");
  }
  if (
    typeof value.leaseId !== "string" ||
    !LEASE_ID_PATTERN.test(value.leaseId) ||
    !Number.isSafeInteger(value.fencingToken) ||
    value.fencingToken < 1 ||
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
    ownerPid: value.ownerPid,
    hostKind: value.hostKind,
    acquiredAtMs: value.acquiredAtMs,
    renewedAtMs: value.renewedAtMs,
    expiresAtMs: value.expiresAtMs,
  });
}

function validateStore(value, sessionId, { missing = false } = {}) {
  if (missing && Object.keys(value).length === 0) {
    return Object.freeze({
      version: STORE_VERSION,
      sessionId,
      lastFencingToken: 0,
      active: null,
    });
  }
  if (
    value?.version !== STORE_VERSION ||
    value?.sessionId !== sessionId ||
    !Number.isSafeInteger(value?.lastFencingToken) ||
    value.lastFencingToken < 0
  ) {
    throw new TypeError("session host lease store is invalid");
  }
  const active = normalizeActiveLease(value.active);
  if (active && active.fencingToken !== value.lastFencingToken) {
    throw new TypeError("active lease does not match the last fencing token");
  }
  return Object.freeze({
    version: STORE_VERSION,
    sessionId,
    lastFencingToken: value.lastFencingToken,
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

export function getSessionHostLeaseRoot() {
  return path.join(getStatePath(), "session-host-leases");
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
      cause?.code === SESSION_HOST_LEASE_FENCED_CODE
    ) {
      return cause;
    }
    return leaseError(
      SESSION_HOST_LEASE_UNAVAILABLE_CODE,
      `Session host lease authority is unavailable for ${sessionId}`,
      { sessionId, filePath },
      cause,
    );
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
    if (!record.controller.signal.aborted) record.controller.abort(reason);
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
          // external side effect and resume later. Expiry fences that host's
          // next guarded transition; takeover additionally requires proven
          // process death so two executors cannot overlap.
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
            ownerPid: process.pid,
            hostKind: kind,
            acquiredAtMs: now,
            renewedAtMs: now,
            expiresAtMs: now + ttl,
          };
          normalizeActiveLease(next);
          draft.version = STORE_VERSION;
          draft.sessionId = id;
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
            if (!sameLease(snapshot.active, record.active)) {
              throw leaseError(
                SESSION_HOST_LEASE_FENCED_CODE,
                `Session host lease was superseded for ${id}`,
                {
                  sessionId: id,
                  fencingToken: record.active.fencingToken,
                  activeFencingToken: snapshot.active?.fencingToken ?? null,
                },
              );
            }
            const now = Math.trunc(this._now());
            if (snapshot.active.expiresAtMs <= now) {
              throw leaseError(
                SESSION_HOST_LEASE_FENCED_CODE,
                `Session host lease expired for ${id}`,
                { sessionId: id, fencingToken: record.active.fencingToken },
              );
            }
            const next = {
              ...snapshot.active,
              renewedAtMs: now,
              expiresAtMs: now + ttl,
            };
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
      let released = false;
      try {
        released = mutateSecurityStore(
          filePath,
          "Session host lease authority",
          (draft) => {
            const snapshot = validateStore(draft, id);
            if (!sameLease(snapshot.active, record.active)) return false;
            draft.version = STORE_VERSION;
            draft.sessionId = id;
            draft.lastFencingToken = snapshot.lastFencingToken;
            draft.active = null;
            return true;
          },
          { lock: this._lock, timeoutMs: 30_000, staleMs: 30_000 },
        );
      } catch (cause) {
        const error = this._unavailable(id, filePath, cause);
        this._lose(record, error);
        throw error;
      }
      record.released = true;
      this._local.delete(key);
      return released;
    };

    record.timer = this._setInterval(() => {
      try {
        renew();
      } catch {
        // renew() already aborts and retires the local lease.
      }
    }, heartbeat);
    record.timer?.unref?.();

    return Object.freeze({
      sessionId: id,
      leaseId: record.active.leaseId,
      fencingToken: record.active.fencingToken,
      signal: controller.signal,
      renew,
      assert: () => this.withWriteAuthority(id, (authority) => authority),
      release,
    });
  }

  withWriteAuthority(sessionId, task) {
    if (typeof task !== "function") {
      throw new TypeError("session host write authority callback is required");
    }
    const id = canonicalSessionId(sessionId);
    const filePath = this.pathFor(id);
    if (!fs.existsSync(filePath)) return task(null);
    try {
      return this._lock(
        filePath,
        () => {
          const snapshot = this._read(filePath, id);
          if (!snapshot.active) return task(null);
          const record = this._local.get(this._key(id));
          const now = Math.trunc(this._now());
          if (
            !record ||
            record.released ||
            !sameLease(snapshot.active, record.active) ||
            snapshot.active.expiresAtMs <= now
          ) {
            const error = leaseError(
              SESSION_HOST_LEASE_FENCED_CODE,
              `Session write is fenced by another or expired host lease: ${id}`,
              {
                sessionId: id,
                activeFencingToken: snapshot.active.fencingToken,
                localFencingToken: record?.active?.fencingToken ?? null,
              },
            );
            if (record) this._lose(record, error);
            throw error;
          }
          return task(
            Object.freeze({
              leaseId: snapshot.active.leaseId,
              fencingToken: snapshot.active.fencingToken,
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
      throw this._unavailable(id, filePath, cause);
    }
  }
}

const defaultAuthority = new SessionHostLeaseAuthority();

export function acquireSessionHostLease(sessionId, options) {
  return defaultAuthority.acquire(sessionId, options);
}

export function withSessionHostWriteAuthority(sessionId, task) {
  return defaultAuthority.withWriteAuthority(sessionId, task);
}

export function assertSessionHostWriteAuthority(sessionId) {
  return defaultAuthority.withWriteAuthority(
    sessionId,
    (authority) => authority,
  );
}
