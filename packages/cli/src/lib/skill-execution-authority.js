/**
 * Durable, same-machine Skill execution authority.
 *
 * Every CLI process that shares CHAINLESSCHAIN_HOME observes the same
 * monotonically increasing generation. Revocation is serialized by the
 * canonical cross-process state lock and persisted with an atomic rename
 * before any caller reports success. Active leases poll while they are alive,
 * and every authority-sensitive transition also re-reads the store as a hard
 * fence. Corruption, rollback observed by a live host, and lock/write failures
 * fail closed.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { threadId } from "node:worker_threads";
import { getStatePath } from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";

export const SKILL_EXECUTION_REVOKED_CODE = "CC_SKILL_EXECUTION_REVOKED";
export const SKILL_EXECUTION_AUTHORITY_UNAVAILABLE_CODE =
  "CC_SKILL_EXECUTION_AUTHORITY_UNAVAILABLE";
export const SKILL_EXECUTION_AUTHORITY_ROLLBACK_CODE =
  "CC_SKILL_EXECUTION_AUTHORITY_ROLLBACK";

const STORE_VERSION = 1;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_REASON_CODE = "host-revocation";
const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const defaultAuthorities = new Map();

function authorityError(code, message, cause, filePath) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "SkillExecutionAuthorityError";
  error.code = code;
  error.filePath = filePath;
  return error;
}

export function skillExecutionRevokedError(generation, message) {
  const error = new Error(
    message || "Skill execution authorization was revoked by the host",
  );
  error.name = "AbortError";
  error.code = SKILL_EXECUTION_REVOKED_CODE;
  error.generation = String(generation);
  return error;
}

function unavailableError(cause, filePath) {
  return authorityError(
    SKILL_EXECUTION_AUTHORITY_UNAVAILABLE_CODE,
    "Skill execution authority is unavailable; execution is denied",
    cause,
    filePath,
  );
}

function rollbackError(observed, current, filePath) {
  const error = authorityError(
    SKILL_EXECUTION_AUTHORITY_ROLLBACK_CODE,
    `Skill execution authority generation rolled back from ${current} to ${observed}; execution is denied`,
    null,
    filePath,
  );
  error.observedGeneration = String(observed);
  error.currentGeneration = String(current);
  return error;
}

function parseGeneration(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new TypeError(`${label} must be a canonical non-negative integer`);
  }
  return BigInt(value);
}

function validateStore(store, { missing = false } = {}) {
  if (missing && Object.keys(store).length === 0) {
    return Object.freeze({ generation: 0n, events: Object.freeze([]) });
  }
  if (store.version !== STORE_VERSION) {
    throw new TypeError(
      `unsupported Skill execution authority version: ${String(store.version)}`,
    );
  }
  const generation = parseGeneration(store.generation, "generation");
  if (!Array.isArray(store.events)) {
    throw new TypeError("events must be an array");
  }

  let previousGeneration = 0n;
  for (const [index, event] of store.events.entries()) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new TypeError(`events[${index}] must be an object`);
    }
    const eventGeneration = parseGeneration(
      event.generation,
      `events[${index}].generation`,
    );
    const eventPrevious = parseGeneration(
      event.previousGeneration,
      `events[${index}].previousGeneration`,
    );
    if (
      eventPrevious !== previousGeneration ||
      eventGeneration !== previousGeneration + 1n
    ) {
      throw new TypeError(`events[${index}] breaks the generation chain`);
    }
    if (typeof event.eventId !== "string" || event.eventId.length === 0) {
      throw new TypeError(
        `events[${index}].eventId must be a non-empty string`,
      );
    }
    if (
      typeof event.revokedAt !== "string" ||
      !Number.isFinite(Date.parse(event.revokedAt))
    ) {
      throw new TypeError(
        `events[${index}].revokedAt must be an ISO timestamp`,
      );
    }
    if (!Number.isSafeInteger(event.actorPid) || event.actorPid <= 0) {
      throw new TypeError(`events[${index}].actorPid must be a positive PID`);
    }
    if (!Number.isSafeInteger(event.actorThreadId) || event.actorThreadId < 0) {
      throw new TypeError(
        `events[${index}].actorThreadId must be a non-negative integer`,
      );
    }
    if (
      typeof event.reasonCode !== "string" ||
      !REASON_CODE_PATTERN.test(event.reasonCode)
    ) {
      throw new TypeError(`events[${index}].reasonCode is invalid`);
    }
    previousGeneration = eventGeneration;
  }
  if (previousGeneration !== generation) {
    throw new TypeError("generation does not match the durable event chain");
  }
  return Object.freeze({
    generation,
    events: Object.freeze([...store.events]),
  });
}

function safeReasonCode(options) {
  try {
    const candidate = options?.reasonCode;
    if (typeof candidate === "string" && REASON_CODE_PATTERN.test(candidate)) {
      return candidate;
    }
  } catch {
    // Diagnostic metadata cannot prevent an emergency restriction.
  }
  return DEFAULT_REASON_CODE;
}

function safeMessage(options) {
  try {
    const candidate = options?.message;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  } catch {
    // Diagnostic metadata cannot prevent an emergency restriction.
  }
  return undefined;
}

export function getSkillExecutionAuthorityPath() {
  return path.join(getStatePath(), "skill-execution-authority.json");
}

export class DurableSkillExecutionAuthority {
  constructor({
    filePath = getSkillExecutionAuthorityPath(),
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    now = () => Date.now(),
    createEventId = randomUUID,
    lockOptions,
  } = {}) {
    if (!path.isAbsolute(filePath)) {
      throw new TypeError("Skill execution authority path must be absolute");
    }
    this.filePath = path.resolve(filePath);
    this.pollIntervalMs = Math.max(10, Number(pollIntervalMs) || 0);
    this._now = now;
    this._createEventId = createEventId;
    this._lockOptions = lockOptions;
    this._generation = 0n;
    this._activeLeases = new Set();
    this._pollTimer = null;
  }

  _abortActive(errorFactory) {
    let interruptedLeases = 0;
    for (const lease of [...this._activeLeases]) {
      this._activeLeases.delete(lease);
      if (lease.controller.signal.aborted) continue;
      interruptedLeases += 1;
      lease.controller.abort(errorFactory());
    }
    this._stopPollingIfIdle();
    return interruptedLeases;
  }

  _failClosed(cause) {
    const error =
      cause?.code === SKILL_EXECUTION_AUTHORITY_ROLLBACK_CODE
        ? cause
        : unavailableError(cause, this.filePath);
    this._abortActive(() => error);
    return error;
  }

  _observeGeneration(generation, message) {
    if (generation < this._generation) {
      throw this._failClosed(
        rollbackError(generation, this._generation, this.filePath),
      );
    }
    if (generation === this._generation) return 0;
    this._generation = generation;
    return this._abortActive(() =>
      skillExecutionRevokedError(generation, message),
    );
  }

  _readSnapshot() {
    let existed;
    try {
      existed = fs.existsSync(this.filePath);
      return validateStore(
        readSecurityStore(this.filePath, "Skill execution authority"),
        { missing: !existed },
      );
    } catch (cause) {
      throw this._failClosed(cause);
    }
  }

  readGeneration() {
    const snapshot = this._readSnapshot();
    this._observeGeneration(snapshot.generation);
    return this._generation;
  }

  assertGeneration(expectedGeneration) {
    const current = this.readGeneration();
    if (expectedGeneration !== current) {
      throw skillExecutionRevokedError(current);
    }
    return current;
  }

  _startPolling() {
    if (this._pollTimer || this._activeLeases.size === 0) return;
    this._pollTimer = setInterval(() => {
      if (this._activeLeases.size === 0) {
        this._stopPollingIfIdle();
        return;
      }
      try {
        this.readGeneration();
      } catch {
        // readGeneration already failed closed and aborted every active lease.
      }
    }, this.pollIntervalMs);
    this._pollTimer.unref?.();
  }

  _stopPollingIfIdle() {
    if (this._activeLeases.size !== 0 || !this._pollTimer) return;
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  acquireLease({ skillId = "unknown" } = {}) {
    const generation = this.readGeneration();
    const controller = new AbortController();
    const record = { controller, generation, skillId: String(skillId) };
    this._activeLeases.add(record);
    this._startPolling();

    try {
      const confirmedGeneration = this.readGeneration();
      if (confirmedGeneration !== generation) {
        throw (
          controller.signal.reason ||
          skillExecutionRevokedError(confirmedGeneration)
        );
      }
    } catch (error) {
      this._activeLeases.delete(record);
      this._stopPollingIfIdle();
      throw error;
    }

    let released = false;
    return Object.freeze({
      generation,
      signal: controller.signal,
      abort: (reason) => {
        if (!controller.signal.aborted) controller.abort(reason);
      },
      release: () => {
        if (released) return;
        released = true;
        this._activeLeases.delete(record);
        this._stopPollingIfIdle();
      },
    });
  }

  revoke(options = {}) {
    const message = safeMessage(options);
    const reasonCode = safeReasonCode(options);
    let generation;
    try {
      generation = mutateSecurityStore(
        this.filePath,
        "Skill execution authority",
        (draft) => {
          const snapshot = validateStore(draft, {
            missing: !fs.existsSync(this.filePath),
          });
          if (snapshot.generation < this._generation) {
            throw rollbackError(
              snapshot.generation,
              this._generation,
              this.filePath,
            );
          }
          const nextGeneration = snapshot.generation + 1n;
          draft.version = STORE_VERSION;
          draft.generation = String(nextGeneration);
          draft.events = [
            ...snapshot.events,
            {
              eventId: String(this._createEventId()),
              generation: String(nextGeneration),
              previousGeneration: String(snapshot.generation),
              revokedAt: new Date(this._now()).toISOString(),
              actorPid: process.pid,
              actorThreadId: threadId,
              reasonCode,
            },
          ];
          return nextGeneration;
        },
        this._lockOptions,
      );
    } catch (cause) {
      throw this._failClosed(cause);
    }

    const interruptedLeases = this._observeGeneration(generation, message);
    return Object.freeze({
      code: SKILL_EXECUTION_REVOKED_CODE,
      generation: String(generation),
      interruptedLeases,
      authorityPath: this.filePath,
      propagationIntervalMs: this.pollIntervalMs,
    });
  }
}

export function getSkillExecutionAuthority(options = {}) {
  if (options.filePath) return new DurableSkillExecutionAuthority(options);
  const filePath = path.resolve(getSkillExecutionAuthorityPath());
  let authority = defaultAuthorities.get(filePath);
  if (!authority) {
    authority = new DurableSkillExecutionAuthority({ ...options, filePath });
    defaultAuthorities.set(filePath, authority);
  }
  return authority;
}
