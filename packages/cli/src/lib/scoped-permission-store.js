/**
 * Workspace-bound, expiring permission rules owned by the CLI.
 *
 * The state lives outside the repository so an agent cannot authorize itself
 * by editing a project file. Mutations use the shared durable security store:
 * cross-process lock, atomic replace, fsync, and fail-closed corrupt reads.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import projectRoot from "./project-root.cjs";
import permissionRules from "./permission-rules.cjs";
import { getMachineSecurityAnchorDir } from "./paths.js";
import {
  readSecurityStore,
  writeSecurityStore,
} from "./durable-security-store.js";
import { withFileLock } from "./with-file-lock.js";

const { findGitProjectRoot } = projectRoot;
const { parseRule } = permissionRules;

const STATE_SCHEMA = "cc.scoped-permission-rules";
const STATE_SCHEMA_VERSION = 1;
const STORE_LABEL = "scoped permission";
const RULE_ID_PATTERN = /^spr_[0-9a-f]{32}$/;
const DECISIONS = new Set(["allow", "ask", "deny"]);
const DEFAULT_MAX_RECORDS = 1000;

// Official mutations revoke every provider in this module instance. Path
// matching alone misses aliases and files that did not exist at admission.
// This is an in-process event owner, not a cross-process notification journal.
const ownerId = randomUUID();
let permissionRevision = Object.freeze({
  ownerId,
  revision: 0,
  state: "ready",
});
const revisionListeners = new Set();

export function getScopedPermissionRevision() {
  if (permissionRevision.state !== "ready") {
    throw scopedPermissionError(
      "CC_SCOPED_PERMISSION_AUTHORITY_UNAVAILABLE",
      "Scoped permission authority is unavailable",
    );
  }
  return permissionRevision;
}

export function subscribeScopedPermissionRevision(listener) {
  if (typeof listener !== "function")
    throw new TypeError(
      "scoped permission revision listener must be a function",
    );
  revisionListeners.add(listener);
  return () => revisionListeners.delete(listener);
}

function beginMutation() {
  getScopedPermissionRevision();
  const revision = permissionRevision.revision + 1;
  permissionRevision = Object.freeze({
    ownerId,
    revision,
    state: Number.isSafeInteger(revision) ? "mutating" : "invalid",
  });
  for (const listener of [...revisionListeners]) {
    try {
      listener(permissionRevision);
    } catch {
      // One observer must not prevent the other shells from being revoked.
    }
  }
  if (permissionRevision.state === "invalid") getScopedPermissionRevision();
}

function finishMutation(state) {
  permissionRevision = Object.freeze({ ...permissionRevision, state });
}

export const SCOPED_PERMISSION_ERROR_CODES = Object.freeze({
  INVALID: "CC_SCOPED_PERMISSION_INVALID",
  CONFLICT: "CC_SCOPED_PERMISSION_CONFLICT",
  NOT_FOUND: "CC_SCOPED_PERMISSION_NOT_FOUND",
  CORRUPT: "CC_SCOPED_PERMISSION_CORRUPT",
});

function scopedPermissionError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function canonicalWorkspaceRoot(cwd) {
  const resolved = path.resolve(cwd || process.cwd());
  const root = findGitProjectRoot(resolved) || resolved;
  let canonical = root;
  try {
    canonical = fs.realpathSync.native(root);
  } catch {
    // A missing/unreadable cwd will be rejected by the caller that uses it.
  }
  const normalized = path.normalize(canonical);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function workspaceBinding(cwd) {
  const root = canonicalWorkspaceRoot(cwd);
  const id = createHash("sha256")
    .update(`cc-scoped-permission-workspace-v1\n${root}`, "utf8")
    .digest("hex");
  return Object.freeze({ id, root });
}

export function defaultScopedPermissionStatePath(cwd = process.cwd()) {
  const workspace = workspaceBinding(cwd);
  return path.join(
    getMachineSecurityAnchorDir(),
    "permission-center",
    "workspaces",
    `${workspace.id}.json`,
  );
}

function emptyState(workspace) {
  return {
    schema: STATE_SCHEMA,
    schemaVersion: STATE_SCHEMA_VERSION,
    generation: 0,
    updatedAt: null,
    workspace,
    rules: [],
  };
}

function validateRecord(record, seenIds) {
  if (
    !record ||
    !RULE_ID_PATTERN.test(record.id || "") ||
    seenIds.has(record.id) ||
    !DECISIONS.has(record.decision) ||
    !parseRule(record.rule) ||
    !Number.isInteger(record.revision) ||
    record.revision < 1 ||
    !Number.isFinite(record.createdAt) ||
    !Number.isFinite(record.expiresAt) ||
    record.expiresAt <= record.createdAt ||
    (record.revokedAt !== null && !Number.isFinite(record.revokedAt)) ||
    typeof record.reason !== "string" ||
    record.reason.length > 500
  ) {
    throw scopedPermissionError(
      SCOPED_PERMISSION_ERROR_CODES.CORRUPT,
      "Scoped permission state contains an invalid rule record",
    );
  }
  seenIds.add(record.id);
}

function validateState(value, workspace) {
  if (
    !value ||
    value.schema !== STATE_SCHEMA ||
    value.schemaVersion !== STATE_SCHEMA_VERSION ||
    !Number.isInteger(value.generation) ||
    value.generation < 0 ||
    !value.workspace ||
    value.workspace.id !== workspace.id ||
    value.workspace.root !== workspace.root ||
    !Array.isArray(value.rules)
  ) {
    throw scopedPermissionError(
      SCOPED_PERMISSION_ERROR_CODES.CORRUPT,
      "Scoped permission state has an invalid schema or workspace binding",
    );
  }
  const seenIds = new Set();
  for (const record of value.rules) validateRecord(record, seenIds);
  return value;
}

function statusFor(record, now) {
  if (record.revokedAt !== null) return "revoked";
  if (record.expiresAt <= now) return "expired";
  return "active";
}

function projectRecord(record, now, filePath) {
  return Object.freeze({
    ...structuredClone(record),
    status: statusFor(record, now),
    source: "cli-security-store",
    sourceFile: filePath,
    scope: "workspace",
  });
}

export class ScopedPermissionStore {
  constructor({
    cwd = process.cwd(),
    filePath = null,
    now = () => Date.now(),
    maxRecords = DEFAULT_MAX_RECORDS,
    lock = undefined,
    randomId = () => `spr_${randomUUID().replaceAll("-", "")}`,
  } = {}) {
    this.workspace = workspaceBinding(cwd);
    this.filePath = path.resolve(
      filePath || defaultScopedPermissionStatePath(this.workspace.root),
    );
    const relativeToWorkspace = path.relative(
      this.workspace.root,
      this.filePath,
    );
    if (
      relativeToWorkspace === "" ||
      (!relativeToWorkspace.startsWith("..") &&
        !path.isAbsolute(relativeToWorkspace))
    ) {
      throw scopedPermissionError(
        SCOPED_PERMISSION_ERROR_CODES.INVALID,
        "Scoped permission authority must be stored outside the workspace",
      );
    }
    this._now = typeof now === "function" ? now : () => Number(now);
    this.maxRecords = Math.max(
      1,
      Math.floor(Number(maxRecords) || DEFAULT_MAX_RECORDS),
    );
    this._lock = lock;
    this._randomId = randomId;
  }

  _capture() {
    const revision = getScopedPermissionRevision();
    const captured = Object.freeze({
      filePath: path.resolve(this.filePath),
      workspace: Object.freeze({ ...this.workspace }),
      now: this._now.bind(this),
      randomId: this._randomId.bind(this),
      maxRecords: this.maxRecords,
      lock: this._lock || withFileLock,
    });
    if (getScopedPermissionRevision() !== revision)
      throw scopedPermissionError(
        "CC_SCOPED_PERMISSION_AUTHORITY_CHANGED",
        "Scoped permission authority changed while capturing the operation",
      );
    return captured;
  }

  _read(captured = this._capture()) {
    getScopedPermissionRevision();
    const stored = readSecurityStore(captured.filePath, STORE_LABEL);
    if (Object.keys(stored).length === 0) return emptyState(captured.workspace);
    return validateState(stored, captured.workspace);
  }

  _mutate(captured, update) {
    getScopedPermissionRevision(); // Reject observer reentry before the lock.
    fs.mkdirSync(path.dirname(captured.filePath), {
      recursive: true,
      mode: 0o700,
    });
    let started = false;
    let committed = false;
    try {
      captured.lock(
        captured.filePath,
        () => {
          const draft = this._read(captured);
          if (update(draft) === false) return; // Idempotent revoke does no I/O.
          validateState(draft, captured.workspace);
          started = true;
          beginMutation();
          // No draft field aliases the public instance during notification.
          validateState(draft, captured.workspace);
          writeSecurityStore(captured.filePath, STORE_LABEL, draft);
          committed = true;
        },
        { timeoutMs: 2000, staleMs: 30000, failIfUnavailable: true },
      );
      if (started) finishMutation("ready");
    } catch (error) {
      if (!error.commitState)
        error.commitState = committed ? "committed" : "not-committed";
      if (started)
        finishMutation(
          error.commitState === "unknown" ||
            permissionRevision.state === "invalid"
            ? "invalid"
            : "ready",
        );
      throw error;
    }
  }

  list() {
    const revision = getScopedPermissionRevision();
    const captured = this._capture();
    const state = this._read(captured);
    const now = captured.now();
    if (getScopedPermissionRevision() !== revision)
      throw scopedPermissionError(
        "CC_SCOPED_PERMISSION_AUTHORITY_CHANGED",
        "Scoped permission authority changed while reading rules",
      );
    return Object.freeze({
      schema: state.schema,
      schemaVersion: state.schemaVersion,
      generation: state.generation,
      updatedAt: state.updatedAt,
      workspace: structuredClone(state.workspace),
      file: captured.filePath,
      rules: state.rules.map((record) =>
        projectRecord(record, now, captured.filePath),
      ),
    });
  }

  add({
    decision,
    rule,
    expiresAt,
    reason = "",
    expectedGeneration = null,
  } = {}) {
    const captured = this._capture();
    const normalizedDecision = String(decision || "")
      .trim()
      .toLowerCase();
    const normalizedRule = String(rule || "").trim();
    const normalizedReason = String(reason || "").trim();
    const now = captured.now();
    const expiry = Number(expiresAt);
    if (!DECISIONS.has(normalizedDecision)) {
      throw scopedPermissionError(
        SCOPED_PERMISSION_ERROR_CODES.INVALID,
        "decision must be allow | ask | deny",
      );
    }
    if (!parseRule(normalizedRule)) {
      throw scopedPermissionError(
        SCOPED_PERMISSION_ERROR_CODES.INVALID,
        "rule must be a valid Tool or Tool(pattern) permission rule",
      );
    }
    if (!Number.isFinite(expiry) || expiry <= now) {
      throw scopedPermissionError(
        SCOPED_PERMISSION_ERROR_CODES.INVALID,
        "expiresAt must be a future timestamp",
      );
    }
    if (normalizedReason.length > 500) {
      throw scopedPermissionError(
        SCOPED_PERMISSION_ERROR_CODES.INVALID,
        "reason must be at most 500 characters",
      );
    }

    let created = null;
    this._mutate(captured, (draft) => {
      const current =
        Object.keys(draft).length === 0
          ? emptyState(captured.workspace)
          : validateState(draft, captured.workspace);
      if (
        expectedGeneration !== null &&
        Number(expectedGeneration) !== current.generation
      ) {
        throw scopedPermissionError(
          SCOPED_PERMISSION_ERROR_CODES.CONFLICT,
          `Scoped permission generation changed (expected ${expectedGeneration}, current ${current.generation})`,
        );
      }

      const retained = [...current.rules];
      while (retained.length >= captured.maxRecords) {
        const inactiveIndex = retained.findIndex(
          (record) => statusFor(record, now) !== "active",
        );
        if (inactiveIndex < 0) break;
        retained.splice(inactiveIndex, 1);
      }
      if (retained.length >= captured.maxRecords) {
        throw scopedPermissionError(
          SCOPED_PERMISSION_ERROR_CODES.INVALID,
          `Scoped permission store is full (${captured.maxRecords} retained rules)`,
        );
      }
      const id = captured.randomId();
      if (
        !RULE_ID_PATTERN.test(id) ||
        retained.some((item) => item.id === id)
      ) {
        throw scopedPermissionError(
          SCOPED_PERMISSION_ERROR_CODES.INVALID,
          "Could not allocate a valid unique scoped permission id",
        );
      }
      created = {
        id,
        decision: normalizedDecision,
        rule: normalizedRule,
        revision: 1,
        createdAt: now,
        expiresAt: expiry,
        revokedAt: null,
        reason: normalizedReason,
      };
      Object.assign(draft, current, {
        generation: current.generation + 1,
        updatedAt: now,
        rules: [...retained, created],
      });
      validateState(draft, captured.workspace);
    });
    return projectRecord(created, now, captured.filePath);
  }

  revoke({ id, expectedRevision = null } = {}) {
    const captured = this._capture();
    const normalizedId = String(id || "").trim();
    if (!RULE_ID_PATTERN.test(normalizedId)) {
      throw scopedPermissionError(
        SCOPED_PERMISSION_ERROR_CODES.INVALID,
        "A valid scoped permission id is required",
      );
    }
    const now = captured.now();
    let revoked = null;
    this._mutate(captured, (draft) => {
      const current =
        Object.keys(draft).length === 0
          ? emptyState(captured.workspace)
          : validateState(draft, captured.workspace);
      const index = current.rules.findIndex(
        (record) => record.id === normalizedId,
      );
      if (index < 0) {
        throw scopedPermissionError(
          SCOPED_PERMISSION_ERROR_CODES.NOT_FOUND,
          `Scoped permission rule not found: ${normalizedId}`,
        );
      }
      const record = current.rules[index];
      if (
        expectedRevision !== null &&
        Number(expectedRevision) !== record.revision
      ) {
        throw scopedPermissionError(
          SCOPED_PERMISSION_ERROR_CODES.CONFLICT,
          `Scoped permission revision changed (expected ${expectedRevision}, current ${record.revision})`,
        );
      }
      if (record.revokedAt !== null) {
        revoked = record;
        return false;
      }
      revoked = {
        ...record,
        revision: record.revision + 1,
        revokedAt: now,
      };
      const rules = [...current.rules];
      rules[index] = revoked;
      Object.assign(draft, current, {
        generation: current.generation + 1,
        updatedAt: now,
        rules,
      });
      validateState(draft, captured.workspace);
    });
    return projectRecord(revoked, now, captured.filePath);
  }
}
