/**
 * Crash-safe approval request/resolve state.
 *
 * This store is the durable boundary for approval cards that authorize side
 * effects. Every mutation is a locked read-modify-write, every successful
 * resolve is a record-level compare-and-swap, and the state file is replaced
 * atomically. A lock, read, or write failure throws: callers must treat that as
 * a denied approval and must not execute the side effect.
 *
 * Display/list reads and the optional audit callback are advisory. They may
 * degrade best-effort without weakening the critical request/resolve path.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  canApprove,
  describeAuthorityChain,
  verifyApprovalBinding,
} from "./agent-authority.js";
import {
  computeOperationFingerprint,
  operationDescriptorKey,
  shortOperationId,
  summarizeOperation,
} from "./operation-fingerprint.js";
import { withFileLock } from "./with-file-lock.js";

const STATE_SCHEMA = "cc.approval-authority-state";
const STATE_SCHEMA_VERSION = 1;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RECORDS = 10_000;
const APPROVAL_BINDING_PATTERN = /^ab_[0-9a-f]{32}$/;
const OPERATION_FINGERPRINT_PATTERN = /^opf_[0-9a-f]{40}$/;
const TERMINAL_STATUSES = new Set([
  "resolved",
  "rejected",
  "superseded",
  "expired",
  "cancelled",
]);

export const APPROVAL_STATE_ERROR_CODES = Object.freeze({
  INVALID: "CC_APPROVAL_STATE_INVALID",
  CONFLICT: "CC_APPROVAL_STATE_CONFLICT",
  LOCK_UNAVAILABLE: "CC_APPROVAL_STATE_LOCK_UNAVAILABLE",
  READ_FAILED: "CC_APPROVAL_STATE_READ_FAILED",
  WRITE_FAILED: "CC_APPROVAL_STATE_WRITE_FAILED",
  CORRUPT: "CC_APPROVAL_STATE_CORRUPT",
  BACKPRESSURE: "CC_APPROVAL_STATE_BACKPRESSURE",
});

function approvalStateError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function finiteTime(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function requiredId(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 256) {
    throw approvalStateError(
      APPROVAL_STATE_ERROR_CODES.INVALID,
      `${fieldName} is required and must be at most 256 characters`,
    );
  }
  return normalized;
}

function emptyState() {
  return {
    schema: STATE_SCHEMA,
    schemaVersion: STATE_SCHEMA_VERSION,
    generation: 0,
    updatedAt: null,
    requests: [],
  };
}

function logicalDescriptorDigest(descriptor) {
  return (
    "opk_" +
    createHash("sha256")
      .update(
        `cc-approval-logical-key-v1\n${operationDescriptorKey(descriptor)}`,
        "utf8",
      )
      .digest("hex")
      .slice(0, 40)
  );
}

function isKnownStateError(error) {
  return Object.values(APPROVAL_STATE_ERROR_CODES).includes(error?.code);
}

export function defaultApprovalAuthorityStatePath(sessionId = null) {
  const sessionSuffix = sessionId
    ? `session-${createHash("sha256")
        .update(String(sessionId), "utf8")
        .digest("hex")
        .slice(0, 32)}.json`
    : "state.json";
  return path.join(
    os.homedir(),
    ".chainlesschain",
    "approval-authority",
    sessionSuffix,
  );
}

export class ApprovalAuthorityStore {
  constructor({
    filePath = defaultApprovalAuthorityStatePath(),
    now = () => Date.now(),
    defaultTtlMs = DEFAULT_TTL_MS,
    maxRecords = DEFAULT_MAX_RECORDS,
    lockTimeoutMs = 2000,
    lockStaleMs = 30_000,
    onAudit = null,
    _fs = fs,
    _lock = withFileLock,
    _randomUUID = randomUUID,
    _beforeRename = null,
    _platform = process.platform,
  } = {}) {
    const normalizedFilePath = String(filePath ?? "").trim();
    if (!normalizedFilePath) {
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.INVALID,
        "Approval state file path is required",
      );
    }
    this.filePath = path.resolve(normalizedFilePath);
    this._now = typeof now === "function" ? now : () => Number(now);
    this.defaultTtlMs = Math.max(
      1,
      Math.floor(Number(defaultTtlMs) || DEFAULT_TTL_MS),
    );
    this.maxRecords = Math.max(
      1,
      Math.floor(Number(maxRecords) || DEFAULT_MAX_RECORDS),
    );
    this.lockTimeoutMs = Math.max(0, Number(lockTimeoutMs) || 0);
    this.lockStaleMs = Math.max(1, Number(lockStaleMs) || 30_000);
    this._onAudit = typeof onAudit === "function" ? onAudit : null;
    this._fs = _fs;
    this._lock = _lock;
    this._randomUUID = _randomUUID;
    this._beforeRename = _beforeRename;
    this._platform = _platform;
  }

  _emitAudit(entry) {
    if (!this._onAudit) return;
    try {
      this._onAudit({
        timestamp: this._now(),
        ...entry,
      });
    } catch {
      // Audit delivery is advisory. Critical state is already durable.
    }
  }

  _ensureDirectory() {
    try {
      this._fs.mkdirSync(path.dirname(this.filePath), {
        recursive: true,
        mode: 0o700,
      });
    } catch (cause) {
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.WRITE_FAILED,
        "Could not create approval state directory",
        cause,
      );
    }
  }

  _validateState(value) {
    if (
      !value ||
      value.schema !== STATE_SCHEMA ||
      value.schemaVersion !== STATE_SCHEMA_VERSION ||
      !Number.isInteger(value.generation) ||
      value.generation < 0 ||
      !Array.isArray(value.requests)
    ) {
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.CORRUPT,
        "Approval state file has an invalid schema",
      );
    }

    const requestIds = new Set();
    const fingerprints = new Set();
    for (const record of value.requests) {
      const hasValidDecision =
        (record?.status === "pending" &&
          record.decision === null &&
          record.resolvedAt === null &&
          record.resolvedAuthority === null) ||
        (record?.status === "resolved" &&
          record.decision === true &&
          Number.isFinite(record.resolvedAt) &&
          typeof record.resolvedAuthority === "string") ||
        (record?.status === "rejected" &&
          record.decision === false &&
          Number.isFinite(record.resolvedAt) &&
          typeof record.resolvedAuthority === "string") ||
        (TERMINAL_STATUSES.has(record?.status) &&
          record.status !== "resolved" &&
          record.status !== "rejected" &&
          record.decision === null);
      if (
        !record ||
        typeof record.requestId !== "string" ||
        !record.requestId ||
        requestIds.has(record.requestId) ||
        !OPERATION_FINGERPRINT_PATTERN.test(record.fingerprint || "") ||
        fingerprints.has(record.fingerprint) ||
        !APPROVAL_BINDING_PATTERN.test(record.binding || "") ||
        !/^opk_[0-9a-f]{40}$/.test(record.logicalDigest || "") ||
        typeof record.sessionId !== "string" ||
        !record.sessionId ||
        !Number.isInteger(record.revision) ||
        record.revision < 1 ||
        !Number.isFinite(record.notBefore) ||
        !Number.isFinite(record.notAfter) ||
        record.notAfter < record.notBefore ||
        !Number.isFinite(record.createdAt) ||
        !Number.isFinite(record.updatedAt) ||
        (record.status !== "pending" &&
          !TERMINAL_STATUSES.has(record.status)) ||
        !hasValidDecision ||
        (record.status === "superseded" && !record.supersededBy)
      ) {
        throw approvalStateError(
          APPROVAL_STATE_ERROR_CODES.CORRUPT,
          "Approval state file contains an invalid request record",
        );
      }
      requestIds.add(record.requestId);
      fingerprints.add(record.fingerprint);
    }
    return value;
  }

  _readState() {
    let serialized;
    try {
      serialized = this._fs.readFileSync(this.filePath, "utf8");
    } catch (cause) {
      if (cause?.code === "ENOENT") return emptyState();
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.READ_FAILED,
        "Could not read approval state",
        cause,
      );
    }

    try {
      return this._validateState(JSON.parse(serialized));
    } catch (cause) {
      if (isKnownStateError(cause)) throw cause;
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.CORRUPT,
        "Could not parse approval state",
        cause,
      );
    }
  }

  _writeState(state) {
    const directory = path.dirname(this.filePath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${this._randomUUID()}.tmp`,
    );
    let descriptor = null;
    let renamed = false;

    try {
      descriptor = this._fs.openSync(temporaryPath, "wx", 0o600);
      this._fs.writeFileSync(
        descriptor,
        `${JSON.stringify(state, null, 2)}\n`,
        "utf8",
      );
      this._fs.fsyncSync(descriptor);
      this._fs.closeSync(descriptor);
      descriptor = null;

      if (this._beforeRename) this._beforeRename(temporaryPath, this.filePath);
      this._fs.renameSync(temporaryPath, this.filePath);
      renamed = true;

      // Persist the directory entry where the platform supports directory fsync.
      if (this._platform !== "win32") {
        const directoryDescriptor = this._fs.openSync(directory, "r");
        try {
          this._fs.fsyncSync(directoryDescriptor);
        } finally {
          this._fs.closeSync(directoryDescriptor);
        }
      }
    } catch (cause) {
      if (descriptor != null) {
        try {
          this._fs.closeSync(descriptor);
        } catch {
          // Best-effort descriptor cleanup; the critical error is rethrown.
        }
      }
      if (!renamed) {
        try {
          this._fs.unlinkSync(temporaryPath);
        } catch {
          // Best-effort orphan cleanup.
        }
      }
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.WRITE_FAILED,
        "Could not atomically persist approval state",
        cause,
      );
    }
  }

  _mutate(operation, mutator) {
    this._ensureDirectory();
    let outcome;
    try {
      outcome = this._lock(
        this.filePath,
        () => {
          const current = this._readState();
          const draft = clone(current);
          const mutation = mutator(draft) || {};
          if (mutation.changed === true) {
            draft.generation = current.generation + 1;
            draft.updatedAt = this._now();
            this._validateState(draft);
            this._writeState(draft);
          }
          return mutation;
        },
        {
          timeoutMs: this.lockTimeoutMs,
          staleMs: this.lockStaleMs,
          failIfUnavailable: true,
        },
      );
    } catch (cause) {
      this._emitAudit({
        event: operation,
        outcome: "state-unavailable",
        reason: cause?.code || "unknown",
      });
      if (isKnownStateError(cause)) throw cause;
      if (cause?.code === "STATE_LOCK_UNAVAILABLE") {
        throw approvalStateError(
          APPROVAL_STATE_ERROR_CODES.LOCK_UNAVAILABLE,
          "Could not acquire approval state lock",
          cause,
        );
      }
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.WRITE_FAILED,
        "Approval state mutation failed",
        cause,
      );
    }

    this._emitAudit(
      outcome.audit || {
        event: operation,
        outcome: "allowed",
      },
    );
    return outcome.value;
  }

  _expirePending(records, now) {
    let changed = false;
    for (const record of records) {
      if (
        record.status === "pending" &&
        record.notAfter != null &&
        now > record.notAfter
      ) {
        record.status = "expired";
        record.revision += 1;
        record.updatedAt = now;
        changed = true;
      }
    }
    return changed;
  }

  _makeCapacity(records) {
    if (records.length < this.maxRecords) return;
    const removable = records
      .filter((record) => TERMINAL_STATUSES.has(record.status))
      .sort(
        (left, right) =>
          finiteTime(left.updatedAt, 0) - finiteTime(right.updatedAt, 0),
      );
    const removeIds = new Set();
    for (const record of removable) {
      removeIds.add(record.requestId);
      if (records.length - removeIds.size < this.maxRecords) break;
    }
    if (removeIds.size > 0) {
      const retained = records.filter(
        (record) => !removeIds.has(record.requestId),
      );
      records.splice(0, records.length, ...retained);
    }
    if (records.length >= this.maxRecords) {
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.BACKPRESSURE,
        "Approval state has reached its pending request limit",
      );
    }
  }

  /**
   * Persist a pending approval before its card is published.
   *
   * `binding` must be an approvalBindingDigest. Raw arguments and descriptor
   * values are never written; only operation/binding hashes and target ids are
   * durable.
   */
  issueRequest({ requestId, descriptor = {}, binding, now: suppliedNow } = {}) {
    const normalizedRequestId = requiredId(requestId, "requestId");
    const descriptorInput =
      descriptor && typeof descriptor === "object" ? descriptor : {};
    const sessionId = requiredId(descriptorInput.session, "descriptor.session");
    if (!APPROVAL_BINDING_PATTERN.test(String(binding || ""))) {
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.INVALID,
        "binding must be an approval binding digest",
      );
    }

    const now = finiteTime(suppliedNow, finiteTime(this._now()));
    if (now == null) {
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.INVALID,
        "A finite approval clock is required",
      );
    }
    if (
      descriptorInput.notBefore != null &&
      finiteTime(descriptorInput.notBefore) == null
    ) {
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.INVALID,
        "Approval notBefore must be a finite timestamp",
      );
    }
    if (
      descriptorInput.notAfter != null &&
      finiteTime(descriptorInput.notAfter) == null
    ) {
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.INVALID,
        "Approval notAfter must be a finite timestamp",
      );
    }
    const notBefore = finiteTime(descriptorInput.notBefore, now);
    const notAfter = finiteTime(
      descriptorInput.notAfter,
      now + this.defaultTtlMs,
    );
    if (notBefore == null || notAfter == null || notAfter < notBefore) {
      throw approvalStateError(
        APPROVAL_STATE_ERROR_CODES.INVALID,
        "Approval validity window is invalid",
      );
    }

    const normalizedDescriptor = {
      ...descriptorInput,
      session: sessionId,
      notBefore,
      notAfter,
    };
    const fingerprint = computeOperationFingerprint(normalizedDescriptor);
    const logicalDigest = logicalDescriptorDigest(normalizedDescriptor);
    const normalizedBinding = String(binding);

    return this._mutate("approval.request", (state) => {
      let changed = this._expirePending(state.requests, now);
      const existing = state.requests.find(
        (record) => record.requestId === normalizedRequestId,
      );
      if (existing) {
        if (
          existing.status === "pending" &&
          existing.fingerprint === fingerprint &&
          existing.binding === normalizedBinding &&
          existing.sessionId === sessionId
        ) {
          const value = {
            requestId: normalizedRequestId,
            fingerprint,
            shortId: shortOperationId(fingerprint),
            summary: summarizeOperation(normalizedDescriptor),
            revision: existing.revision,
            status: existing.status,
            duplicate: true,
          };
          return {
            changed,
            value,
            audit: {
              event: "approval.request",
              outcome: "idempotent",
              requestId: normalizedRequestId,
              fingerprint,
              sessionId,
            },
          };
        }
        throw approvalStateError(
          APPROVAL_STATE_ERROR_CODES.CONFLICT,
          "Approval request id is already bound to different state",
        );
      }

      if (state.requests.some((record) => record.fingerprint === fingerprint)) {
        throw approvalStateError(
          APPROVAL_STATE_ERROR_CODES.CONFLICT,
          "Approval fingerprint has already been issued",
        );
      }

      for (const record of state.requests) {
        if (
          record.status === "pending" &&
          record.logicalDigest === logicalDigest
        ) {
          record.status = "superseded";
          record.supersededBy = normalizedRequestId;
          record.revision += 1;
          record.updatedAt = now;
          changed = true;
        }
      }

      this._makeCapacity(state.requests);
      const record = {
        requestId: normalizedRequestId,
        fingerprint,
        logicalDigest,
        binding: normalizedBinding,
        sessionId,
        status: "pending",
        decision: null,
        revision: 1,
        notBefore,
        notAfter,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        resolvedAuthority: null,
        supersededBy: null,
      };
      state.requests.push(record);

      return {
        changed: true,
        value: {
          requestId: normalizedRequestId,
          fingerprint,
          shortId: shortOperationId(fingerprint),
          summary: summarizeOperation(normalizedDescriptor),
          revision: record.revision,
          status: record.status,
          duplicate: false,
        },
        audit: {
          event: "approval.request",
          outcome: "persisted",
          requestId: normalizedRequestId,
          fingerprint,
          sessionId,
          revision: record.revision,
        },
      };
    });
  }

  /**
   * Atomically resolve one pending request.
   *
   * Returning `{ok:true, approved:true}` is the only result that authorizes the
   * caller to execute a side effect. State errors throw, and all stale,
   * mismatched, unauthorized, expired, or duplicate resolutions return
   * `{ok:false, approved:false}`.
   */
  resolveRequest(
    requestId,
    {
      fingerprint,
      binding,
      sessionId,
      decision,
      authority,
      expectedRevision,
      now: suppliedNow,
    } = {},
  ) {
    const normalizedRequestId = requiredId(requestId, "requestId");
    const normalizedSessionId = requiredId(sessionId, "sessionId");
    if (!OPERATION_FINGERPRINT_PATTERN.test(String(fingerprint || ""))) {
      return { ok: false, approved: false, reason: "fingerprint-required" };
    }
    if (!APPROVAL_BINDING_PATTERN.test(String(binding || ""))) {
      return { ok: false, approved: false, reason: "binding-required" };
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return { ok: false, approved: false, reason: "revision-required" };
    }
    if (typeof decision !== "boolean") {
      return { ok: false, approved: false, reason: "decision-required" };
    }
    if (
      !authority ||
      canApprove(authority) !== true ||
      authority.sessionId !== normalizedSessionId
    ) {
      this._emitAudit({
        event: "approval.resolve",
        outcome: "rejected",
        reason: "authority-denied",
        requestId: normalizedRequestId,
        sessionId: normalizedSessionId,
      });
      return { ok: false, approved: false, reason: "authority-denied" };
    }

    const now = finiteTime(suppliedNow, finiteTime(this._now()));
    if (now == null) {
      return { ok: false, approved: false, reason: "clock-required" };
    }

    return this._mutate("approval.resolve", (state) => {
      const record = state.requests.find(
        (candidate) => candidate.requestId === normalizedRequestId,
      );
      if (!record) {
        return {
          changed: false,
          value: { ok: false, approved: false, reason: "unknown" },
          audit: {
            event: "approval.resolve",
            outcome: "rejected",
            reason: "unknown",
            requestId: normalizedRequestId,
          },
        };
      }

      const reject = (reason, changed = false) => ({
        changed,
        value: { ok: false, approved: false, reason },
        audit: {
          event: "approval.resolve",
          outcome: "rejected",
          reason,
          requestId: normalizedRequestId,
          fingerprint: record.fingerprint,
          sessionId: record.sessionId,
          revision: record.revision,
        },
      });

      if (record.status === "resolved" || record.status === "rejected") {
        return reject("duplicate");
      }
      if (record.status !== "pending") return reject(record.status);
      if (record.revision !== expectedRevision) {
        return reject("stale-revision");
      }
      if (
        record.sessionId !== normalizedSessionId ||
        authority.sessionId !== record.sessionId
      ) {
        return reject("session-mismatch");
      }
      if (!verifyApprovalBinding(record.fingerprint, fingerprint)) {
        return reject("fingerprint-mismatch");
      }
      if (!verifyApprovalBinding(record.binding, binding)) {
        return reject("binding-mismatch");
      }
      if (record.notBefore != null && now < record.notBefore) {
        return reject("not-yet-valid");
      }
      if (record.notAfter != null && now > record.notAfter) {
        record.status = "expired";
        record.revision += 1;
        record.updatedAt = now;
        return reject("expired", true);
      }

      record.status = decision ? "resolved" : "rejected";
      record.decision = decision;
      record.resolvedAt = now;
      record.updatedAt = now;
      record.resolvedAuthority = describeAuthorityChain(authority);
      record.revision += 1;

      return {
        changed: true,
        value: {
          ok: true,
          approved: decision,
          reason: null,
          requestId: normalizedRequestId,
          revision: record.revision,
        },
        audit: {
          event: "approval.resolve",
          outcome: decision ? "approved" : "denied",
          requestId: normalizedRequestId,
          fingerprint: record.fingerprint,
          sessionId: record.sessionId,
          revision: record.revision,
          authority: record.resolvedAuthority,
        },
      };
    });
  }

  /**
   * Persist a timeout/close cancellation. This transition can only reduce
   * authority, so it does not require an approval envelope; it still requires
   * the request revision and the same locked CAS/atomic write as resolution.
   */
  cancelRequest(
    requestId,
    { expectedRevision, reason = "cancelled", now: suppliedNow } = {},
  ) {
    const normalizedRequestId = requiredId(requestId, "requestId");
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return { ok: false, approved: false, reason: "revision-required" };
    }
    const terminalStatus = reason === "timeout" ? "expired" : "cancelled";
    const now = finiteTime(suppliedNow, finiteTime(this._now()));
    if (now == null) {
      return { ok: false, approved: false, reason: "clock-required" };
    }

    return this._mutate("approval.cancel", (state) => {
      const record = state.requests.find(
        (candidate) => candidate.requestId === normalizedRequestId,
      );
      if (!record) {
        return {
          changed: false,
          value: { ok: false, approved: false, reason: "unknown" },
          audit: {
            event: "approval.cancel",
            outcome: "rejected",
            reason: "unknown",
            requestId: normalizedRequestId,
          },
        };
      }
      if (record.status !== "pending") {
        return {
          changed: false,
          value: {
            ok: false,
            approved: false,
            reason:
              record.status === "resolved" || record.status === "rejected"
                ? "duplicate"
                : record.status,
          },
          audit: {
            event: "approval.cancel",
            outcome: "rejected",
            reason: record.status,
            requestId: normalizedRequestId,
            revision: record.revision,
          },
        };
      }
      if (record.revision !== expectedRevision) {
        return {
          changed: false,
          value: {
            ok: false,
            approved: false,
            reason: "stale-revision",
          },
          audit: {
            event: "approval.cancel",
            outcome: "rejected",
            reason: "stale-revision",
            requestId: normalizedRequestId,
            revision: record.revision,
          },
        };
      }

      record.status = terminalStatus;
      record.updatedAt = now;
      record.revision += 1;
      return {
        changed: true,
        value: {
          ok: true,
          approved: false,
          reason: terminalStatus,
          requestId: normalizedRequestId,
          revision: record.revision,
        },
        audit: {
          event: "approval.cancel",
          outcome: terminalStatus,
          requestId: normalizedRequestId,
          revision: record.revision,
        },
      };
    });
  }

  /**
   * Advisory snapshot for UI/status surfaces. Corrupt/unavailable state returns
   * an empty list by default; pass `bestEffort:false` for a strict diagnostic.
   * This method must never be used to authorize a side effect.
   */
  listRequests({ status = null, bestEffort = true } = {}) {
    try {
      const records = this._readState().requests;
      return records
        .filter((record) => !status || record.status === status)
        .map(clone);
    } catch (error) {
      this._emitAudit({
        event: "approval.list",
        outcome: "state-unavailable",
        reason: error?.code || "unknown",
      });
      if (!bestEffort) throw error;
      return [];
    }
  }

  /**
   * Advisory lookup. Use the returned revision as the CAS token echoed by an
   * approval UI, but only resolveRequest performs an authorization transition.
   */
  getRequest(requestId, { bestEffort = true } = {}) {
    const normalizedRequestId = String(requestId ?? "");
    try {
      const record = this._readState().requests.find(
        (candidate) => candidate.requestId === normalizedRequestId,
      );
      return record ? clone(record) : null;
    } catch (error) {
      this._emitAudit({
        event: "approval.get",
        outcome: "state-unavailable",
        reason: error?.code || "unknown",
      });
      if (!bestEffort) throw error;
      return null;
    }
  }
}
