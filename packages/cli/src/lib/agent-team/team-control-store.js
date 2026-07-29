/**
 * Durable operator controls for a running Agent Team.
 *
 * The team state file is owned for the lifetime of `cc team run`, so an IDE
 * must never edit it directly. This adjacent, hash-chained event log lets a
 * second process request human takeover while preserving the coordinator's
 * exclusive state ownership. Requests are bound to a stable stateId and the
 * canonical state path; acknowledgements are append-only and cross-process
 * serialized. Every interrupt is also bound to one exact holder/lease/fencing
 * identity so a delayed request can never take over a future task attempt.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { withFileLock } from "../with-file-lock.js";

export const TEAM_CONTROL_SCHEMA_VERSION = 2;
export const MAX_TEAM_CONTROL_EVENTS = 10_000;
export const MAX_TEAM_CONTROL_BYTES = 8 * 1024 * 1024;

const STORE_SCHEMA = "cc.team-control";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERN = /^tctl_[a-zA-Z0-9][a-zA-Z0-9._-]{0,126}$/;
const OUTCOMES = new Set([
  "accepted",
  "not_active",
  "stale_attempt",
  "rejected",
]);

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function controlError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "TeamControlStoreError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw controlError("TEAM_CONTROL_INVALID", "Non-finite control value");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw controlError("TEAM_CONTROL_INVALID", "Unsupported control value");
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`)
    .digest("hex")}`;
}

function pathIdentity(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function canonicalFile(filePath, { mustExist }) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw controlError("TEAM_CONTROL_UNSAFE_PATH", "Control path is required");
  }
  const requested = path.resolve(filePath);
  const parent = fs.realpathSync.native(path.dirname(requested));
  const target = path.join(parent, path.basename(requested));
  if (!fs.existsSync(target)) {
    if (mustExist) {
      throw controlError(
        "TEAM_CONTROL_UNSAFE_PATH",
        `Required control authority file does not exist: ${target}`,
      );
    }
    return target;
  }
  const entry = fs.lstatSync(target);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1) {
    throw controlError(
      "TEAM_CONTROL_UNSAFE_PATH",
      `Control authority must be a regular, single-link file: ${target}`,
    );
  }
  if (process.platform !== "win32" && (entry.mode & 0o077) !== 0) {
    throw controlError(
      "TEAM_CONTROL_UNSAFE_PATH",
      `Control authority permissions must be 0600: ${target}`,
    );
  }
  return fs.realpathSync.native(target);
}

function assertIdentifier(value, label, pattern = ID_PATTERN) {
  const text = String(value || "");
  if (!pattern.test(text)) {
    throw controlError("TEAM_CONTROL_INVALID", `Invalid ${label}`);
  }
  return text;
}

function normalizeText(value, label, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || text.includes("\0")) {
    throw controlError("TEAM_CONTROL_INVALID", `Invalid ${label}`);
  }
  return text;
}

function normalizeAttemptString(value, label, maxLength = 512) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    throw controlError("TEAM_CONTROL_INVALID", `Invalid ${label}`);
  }
  return value;
}

function normalizeFencingToken(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    return normalizeAttemptString(value, "fencingToken");
  }
  throw controlError("TEAM_CONTROL_INVALID", "Invalid fencingToken");
}

export function computeTeamControlAttemptDigest({
  holder,
  leaseId,
  fencingToken,
} = {}) {
  return digest("cc-team-control-attempt-v1", {
    holder: normalizeAttemptString(holder, "holder", 256),
    leaseId: normalizeAttemptString(leaseId, "leaseId"),
    fencingToken: normalizeFencingToken(fencingToken),
  });
}

export function computeTeamControlAdjudicationDigest({
  caseId = null,
  evidenceDigest,
} = {}) {
  const normalizedEvidence = String(evidenceDigest || "");
  if (!DIGEST_PATTERN.test(normalizedEvidence)) {
    throw controlError("TEAM_CONTROL_INVALID", "Invalid evidenceDigest");
  }
  if (caseId == null) return normalizedEvidence;
  return digest("cc-team-control-adjudication-v1", {
    caseId: normalizeAttemptString(caseId, "caseId"),
    evidenceDigest: normalizedEvidence,
  });
}

function eventDigest(event) {
  const body = { ...event };
  delete body.digest;
  return digest("cc-team-control-event-v2", body);
}

function initialDocument({ statePath, stateId, now }) {
  const statePathDigest = digest(
    "cc-team-control-state-path-v1",
    pathIdentity(statePath),
  );
  return {
    schema: STORE_SCHEMA,
    schemaVersion: TEAM_CONTROL_SCHEMA_VERSION,
    statePathDigest,
    stateId,
    createdAt: now,
    events: [],
  };
}

function replay(document, authority) {
  if (
    !document ||
    document.schema !== STORE_SCHEMA ||
    document.schemaVersion !== TEAM_CONTROL_SCHEMA_VERSION ||
    document.statePathDigest !== authority.statePathDigest ||
    document.stateId !== authority.stateId ||
    !Number.isFinite(document.createdAt) ||
    !Array.isArray(document.events)
  ) {
    throw controlError(
      "TEAM_CONTROL_CORRUPT",
      "Invalid or mismatched team control store",
    );
  }
  const requests = new Map();
  let previousDigest = null;
  for (let index = 0; index < document.events.length; index += 1) {
    const event = document.events[index];
    if (
      !event ||
      event.version !== TEAM_CONTROL_SCHEMA_VERSION ||
      event.sequence !== index + 1 ||
      event.previousDigest !== previousDigest ||
      !DIGEST_PATTERN.test(String(event.digest || "")) ||
      event.digest !== eventDigest(event) ||
      !Number.isFinite(event.at)
    ) {
      throw controlError(
        "TEAM_CONTROL_CORRUPT",
        "Invalid team control hash chain",
      );
    }
    if (event.type === "interrupt.request") {
      assertIdentifier(event.requestId, "requestId");
      if (requests.has(event.requestId)) {
        throw controlError(
          "TEAM_CONTROL_CORRUPT",
          "Duplicate team control request",
        );
      }
      normalizeText(event.taskKey, "taskKey", 256);
      normalizeAttemptString(event.holder, "holder", 256);
      normalizeAttemptString(event.leaseId, "leaseId");
      normalizeFencingToken(event.fencingToken);
      if (
        event.attemptDigest !==
        computeTeamControlAttemptDigest({
          holder: event.holder,
          leaseId: event.leaseId,
          fencingToken: event.fencingToken,
        })
      ) {
        throw controlError(
          "TEAM_CONTROL_CORRUPT",
          "Interrupt attempt digest does not match its lease binding",
        );
      }
      normalizeText(event.actor, "actor", 256);
      normalizeText(event.reason, "reason", 2048);
      requests.set(event.requestId, {
        request: event,
        acknowledgement: null,
      });
    } else if (event.type === "interrupt.ack") {
      const record = requests.get(event.requestId);
      if (!record || record.acknowledgement || !OUTCOMES.has(event.outcome)) {
        throw controlError(
          "TEAM_CONTROL_CORRUPT",
          "Invalid team control acknowledgement",
        );
      }
      normalizeText(event.workerId, "workerId", 256);
      record.acknowledgement = event;
    } else {
      throw controlError(
        "TEAM_CONTROL_CORRUPT",
        `Unknown team control event: ${event.type}`,
      );
    }
    previousDigest = event.digest;
  }
  return { requests, headDigest: previousDigest };
}

function assertAnchor(document, runtime, authority, anchor) {
  if (anchor == null) return;
  if (
    !anchor ||
    anchor.version !== TEAM_CONTROL_SCHEMA_VERSION ||
    anchor.statePathDigest !== authority.statePathDigest ||
    anchor.stateId !== authority.stateId ||
    !Number.isSafeInteger(anchor.lastSequence) ||
    anchor.lastSequence < 0 ||
    anchor.lastSequence > document.events.length
  ) {
    throw controlError(
      "TEAM_CONTROL_ROLLBACK",
      "Team control cursor is not a valid log prefix",
    );
  }
  const anchoredDigest =
    anchor.lastSequence === 0
      ? null
      : document.events[anchor.lastSequence - 1]?.digest;
  if (anchoredDigest !== anchor.headDigest) {
    throw controlError(
      "TEAM_CONTROL_ROLLBACK",
      "Team control cursor digest is not an exact log prefix",
    );
  }
  if (
    document.events.length === anchor.lastSequence &&
    runtime.headDigest !== anchor.headDigest
  ) {
    throw controlError(
      "TEAM_CONTROL_ROLLBACK",
      "Team control log head diverged from its cursor",
    );
  }
}

function readDocument(filePath, authority, now) {
  if (!fs.existsSync(filePath)) {
    return initialDocument({ ...authority, now });
  }
  const entry = fs.lstatSync(filePath);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1) {
    throw controlError(
      "TEAM_CONTROL_UNSAFE_PATH",
      `Control store must be a regular, single-link file: ${filePath}`,
    );
  }
  if (entry.size <= 0 || entry.size > MAX_TEAM_CONTROL_BYTES) {
    throw controlError(
      "TEAM_CONTROL_CORRUPT",
      "Team control store size is invalid",
    );
  }
  let document;
  try {
    document = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (cause) {
    throw controlError(
      "TEAM_CONTROL_CORRUPT",
      "Unreadable team control store",
      {
        cause,
      },
    );
  }
  replay(document, authority);
  return document;
}

function atomicWrite(filePath, document) {
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_TEAM_CONTROL_BYTES) {
    throw controlError("TEAM_CONTROL_LIMIT", "Team control store is full");
  }
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, filePath);
  } finally {
    if (descriptor != null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        /* preserve the primary failure */
      }
    }
    try {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    } catch {
      /* preserve the primary failure */
    }
  }
}

function append(document, event) {
  if (document.events.length >= MAX_TEAM_CONTROL_EVENTS) {
    throw controlError(
      "TEAM_CONTROL_LIMIT",
      "Team control event limit reached",
    );
  }
  const previousDigest =
    document.events[document.events.length - 1]?.digest || null;
  const next = {
    version: TEAM_CONTROL_SCHEMA_VERSION,
    sequence: document.events.length + 1,
    previousDigest,
    ...event,
  };
  next.digest = eventDigest(next);
  document.events.push(next);
  return next;
}

export class TeamControlStore {
  constructor({
    statePath,
    stateId,
    filePath = null,
    now = () => Date.now(),
  } = {}) {
    this.statePath = canonicalFile(statePath, { mustExist: true });
    this.stateId = assertIdentifier(
      stateId,
      "stateId",
      /^team_state_[a-zA-Z0-9][a-zA-Z0-9._-]{0,126}$/,
    );
    this.filePath = canonicalFile(
      filePath || `${this.statePath}.controls.json`,
      { mustExist: false },
    );
    this._now = typeof now === "function" ? now : () => Number(now);
    this.authority = {
      statePath: this.statePath,
      statePathDigest: digest(
        "cc-team-control-state-path-v1",
        pathIdentity(this.statePath),
      ),
      stateId: this.stateId,
    };
  }

  _locked(mutator, { write = false } = {}) {
    return withFileLock(
      this.filePath,
      () => {
        const currentStatePath = canonicalFile(this.statePath, {
          mustExist: true,
        });
        if (pathIdentity(currentStatePath) !== pathIdentity(this.statePath)) {
          throw controlError(
            "TEAM_CONTROL_UNSAFE_PATH",
            "Team state canonical path changed",
          );
        }
        const document = readDocument(
          this.filePath,
          this.authority,
          this._now(),
        );
        const result = mutator(document, replay(document, this.authority));
        if (write) atomicWrite(this.filePath, document);
        return result;
      },
      { failIfUnavailable: true },
    );
  }

  requestInterrupt({
    requestId = `tctl_${randomUUID()}`,
    taskKey,
    holder,
    leaseId,
    fencingToken,
    actor,
    reason,
  } = {}) {
    const normalizedId = assertIdentifier(requestId, "requestId");
    const normalizedTask = normalizeText(taskKey, "taskKey", 256);
    const normalizedHolder = normalizeAttemptString(holder, "holder", 256);
    const normalizedLeaseId = normalizeAttemptString(leaseId, "leaseId");
    const normalizedFencingToken = normalizeFencingToken(fencingToken);
    const attemptDigest = computeTeamControlAttemptDigest({
      holder: normalizedHolder,
      leaseId: normalizedLeaseId,
      fencingToken: normalizedFencingToken,
    });
    const normalizedActor = normalizeText(actor, "actor", 256);
    const normalizedReason = normalizeText(reason, "reason", 2048);
    return this._locked(
      (document, runtime) => {
        const prior = runtime.requests.get(normalizedId);
        if (prior) {
          const request = prior.request;
          if (
            request.taskKey === normalizedTask &&
            request.holder === normalizedHolder &&
            request.leaseId === normalizedLeaseId &&
            request.fencingToken === normalizedFencingToken &&
            request.actor === normalizedActor &&
            request.reason === normalizedReason
          ) {
            return { ok: true, idempotent: true, request: { ...request } };
          }
          throw controlError(
            "TEAM_CONTROL_CONFLICT",
            "Control request id is already bound to different input",
          );
        }
        const request = append(document, {
          type: "interrupt.request",
          at: this._now(),
          requestId: normalizedId,
          taskKey: normalizedTask,
          holder: normalizedHolder,
          leaseId: normalizedLeaseId,
          fencingToken: normalizedFencingToken,
          attemptDigest,
          actor: normalizedActor,
          reason: normalizedReason,
        });
        return { ok: true, request: { ...request } };
      },
      { write: true },
    );
  }

  pending({ anchor = null } = {}) {
    return this._locked((document, runtime) => {
      assertAnchor(document, runtime, this.authority, anchor);
      return Array.from(runtime.requests.values())
        .filter((record) => !record.acknowledgement)
        .map((record) => ({ ...record.request }));
    });
  }

  acknowledge({ requestId, outcome, workerId } = {}) {
    const normalizedId = assertIdentifier(requestId, "requestId");
    if (!OUTCOMES.has(outcome)) {
      throw controlError("TEAM_CONTROL_INVALID", "Invalid control outcome");
    }
    const normalizedWorker = normalizeText(workerId, "workerId", 256);
    return this._locked(
      (document, runtime) => {
        const record = runtime.requests.get(normalizedId);
        if (!record) {
          throw controlError(
            "TEAM_CONTROL_NOT_FOUND",
            `Control request not found: ${normalizedId}`,
          );
        }
        if (record.acknowledgement) {
          if (
            record.acknowledgement.outcome === outcome &&
            record.acknowledgement.workerId === normalizedWorker
          ) {
            return {
              ok: true,
              idempotent: true,
              acknowledgement: { ...record.acknowledgement },
            };
          }
          throw controlError(
            "TEAM_CONTROL_CONFLICT",
            "Control request already has a different acknowledgement",
          );
        }
        const acknowledgement = append(document, {
          type: "interrupt.ack",
          at: this._now(),
          requestId: normalizedId,
          outcome,
          workerId: normalizedWorker,
        });
        return { ok: true, acknowledgement: { ...acknowledgement } };
      },
      { write: true },
    );
  }

  cursor() {
    return this._locked((document, runtime) => ({
      version: TEAM_CONTROL_SCHEMA_VERSION,
      statePathDigest: this.authority.statePathDigest,
      stateId: this.stateId,
      lastSequence: document.events.length,
      headDigest: runtime.headDigest,
    }));
  }
}
