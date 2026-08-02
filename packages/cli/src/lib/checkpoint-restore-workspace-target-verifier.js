/**
 * Read-only exact-target verification for an already-applied checkpoint
 * restore. Git and copy engines reuse their canonical status planners; this
 * adapter rejects every non-empty diff and binds the observed target identity
 * back to the saga/session poststate digest.
 */

import path from "node:path";
import { realpathSync } from "node:fs";
import { statusAgainst as gitStatusAgainst } from "./checkpoint-store.js";
import { diffCheckpoint as copyDiffCheckpoint } from "./file-checkpoint.js";
import { computeCheckpointRestoreDigest } from "./checkpoint-restore-orchestrator.js";
import {
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_SCHEMA,
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_VERSION,
} from "./checkpoint-restore-already-completed-controller.js";

export {
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_SCHEMA,
  CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_VERSION,
};

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const GIT_IDENTITY_PATTERN = /^git:(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const GIT_TREE_PATTERN = /^git-tree:(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export const CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "CHECKPOINT_RESTORE_WORKSPACE_TARGET_INVALID_ARGUMENT",
  CONFLICT: "CHECKPOINT_RESTORE_WORKSPACE_TARGET_CONFLICT",
});

export class CheckpointRestoreWorkspaceTargetError extends Error {
  constructor(code, message, details = {}, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "CheckpointRestoreWorkspaceTargetError";
    this.code = code;
    Object.assign(this, details);
  }
}

function targetError(code, message, details = {}, cause = null) {
  return new CheckpointRestoreWorkspaceTargetError(
    code,
    message,
    details,
    cause,
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value, maximum = 1_024) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function pathKey(value, platform, resolveCanonicalPath) {
  if (!boundedText(value, 4_096) || !path.isAbsolute(value)) return null;
  const resolved = resolveCanonicalPath(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right, platform, resolveCanonicalPath) {
  const leftKey = pathKey(left, platform, resolveCanonicalPath);
  return (
    leftKey !== null &&
    leftKey === pathKey(right, platform, resolveCanonicalPath)
  );
}

function validateRequest(request, platform, resolveCanonicalPath) {
  const expected = request?.expected;
  const kind = expected?.restoreKind;
  const checkpointIdentityPattern =
    kind === "git" ? GIT_IDENTITY_PATTERN : DIGEST_PATTERN;
  const targetIdentityPattern =
    kind === "git" ? GIT_TREE_PATTERN : DIGEST_PATTERN;
  if (
    !isPlainObject(request) ||
    !OPERATION_ID_PATTERN.test(String(request.operationId || "")) ||
    !pathKey(request.workspaceRoot, platform, resolveCanonicalPath) ||
    !request.workspaceLease ||
    typeof request.workspaceLease.assertOwned !== "function" ||
    !isPlainObject(expected) ||
    expected.operationId !== request.operationId ||
    !["git", "copy"].includes(kind) ||
    !boundedText(expected.checkpointId, 256) ||
    !checkpointIdentityPattern.test(
      String(expected.checkpointIdentity || ""),
    ) ||
    (kind === "git" && !boundedText(expected.checkpointNamespace, 256)) ||
    !DIGEST_PATTERN.test(String(expected.workspaceScopeIdentity || "")) ||
    !targetIdentityPattern.test(
      String(expected.workspaceTargetPoststateIdentity || ""),
    ) ||
    !DIGEST_PATTERN.test(String(expected.poststateDigest || ""))
  ) {
    throw targetError(
      CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES.INVALID_ARGUMENT,
      "Workspace target verification requires exact checkpoint and poststate authority",
    );
  }
  return expected;
}

function validateStatus(
  status,
  request,
  expected,
  platform,
  resolveCanonicalPath,
) {
  const binding = status?.workspaceBinding;
  const modified = status?.modified;
  const added = expected.restoreKind === "git" ? status?.added : [];
  const deleted = status?.deleted;
  const exactTarget =
    Array.isArray(modified) &&
    Array.isArray(added) &&
    Array.isArray(deleted) &&
    modified.length === 0 &&
    added.length === 0 &&
    deleted.length === 0;
  const actualPoststateDigest = isPlainObject(binding)
    ? computeCheckpointRestoreDigest("cc-checkpoint-restore-poststate-v1", {
        engine: expected.restoreKind,
        scopeIdentity: binding.scopeIdentity,
        stateIdentity: binding.targetPoststateIdentity,
      })
    : null;
  if (
    !isPlainObject(status) ||
    status.checkpointIdentity !== expected.checkpointIdentity ||
    !exactTarget ||
    !isPlainObject(binding) ||
    binding.schema !== "cc-checkpoint-workspace-binding/v1" ||
    binding.version !== 1 ||
    binding.engine !== expected.restoreKind ||
    !samePath(
      binding.workspaceRoot,
      request.workspaceRoot,
      platform,
      resolveCanonicalPath,
    ) ||
    binding.scopeIdentity !== expected.workspaceScopeIdentity ||
    (expected.restoreKind === "git" &&
      binding.prestateIdentity !== expected.workspaceTargetPoststateIdentity) ||
    binding.targetPoststateIdentity !==
      expected.workspaceTargetPoststateIdentity ||
    actualPoststateDigest !== expected.poststateDigest
  ) {
    throw targetError(
      CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES.CONFLICT,
      "Workspace no longer matches the exact restored checkpoint target",
      { operationId: request.operationId, restoreKind: expected.restoreKind },
    );
  }
}

export class CheckpointRestoreWorkspaceTargetVerifier {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw targetError(
        CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES.INVALID_ARGUMENT,
        "Workspace target verifier options must be an object",
      );
    }
    this._gitStatusAgainst = options.gitStatusAgainst || gitStatusAgainst;
    this._copyDiffCheckpoint = options.copyDiffCheckpoint || copyDiffCheckpoint;
    this._platform = options.platform || process.platform;
    this._canonicalPath = options.canonicalPath || canonicalPath;
    if (
      typeof this._gitStatusAgainst !== "function" ||
      typeof this._copyDiffCheckpoint !== "function" ||
      typeof this._canonicalPath !== "function"
    ) {
      throw targetError(
        CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES.INVALID_ARGUMENT,
        "Workspace target verifier requires Git and copy status readers",
      );
    }
  }

  verify(request) {
    const expected = validateRequest(
      request,
      this._platform,
      this._canonicalPath,
    );
    request.workspaceLease.assertOwned();
    let status;
    try {
      status =
        expected.restoreKind === "git"
          ? this._gitStatusAgainst(
              request.workspaceRoot,
              expected.checkpointId,
              {
                session: expected.checkpointNamespace,
                expectedIdentity: expected.checkpointIdentity,
              },
            )
          : this._copyDiffCheckpoint(expected.checkpointId, {
              cwd: request.workspaceRoot,
              expectedIdentity: expected.checkpointIdentity,
            });
    } catch (cause) {
      throw targetError(
        CHECKPOINT_RESTORE_WORKSPACE_TARGET_ERROR_CODES.CONFLICT,
        "Workspace target could not be verified against its checkpoint",
        { operationId: request.operationId, restoreKind: expected.restoreKind },
        cause,
      );
    }
    request.workspaceLease.assertOwned();
    validateStatus(
      status,
      request,
      expected,
      this._platform,
      this._canonicalPath,
    );
    request.workspaceLease.assertOwned();
    return Object.freeze({
      schema: CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_SCHEMA,
      version: CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_VERSION,
      verified: true,
      exact: true,
      operationId: request.operationId,
      restoreKind: expected.restoreKind,
      checkpointNamespace: expected.checkpointNamespace || null,
      checkpointId: expected.checkpointId,
      checkpointIdentity: expected.checkpointIdentity,
      workspaceScopeIdentity: expected.workspaceScopeIdentity,
      workspaceTargetPoststateIdentity:
        expected.workspaceTargetPoststateIdentity,
      poststateDigest: expected.poststateDigest,
    });
  }
}

export function createCheckpointRestoreWorkspaceTargetVerifier(options = {}) {
  return new CheckpointRestoreWorkspaceTargetVerifier(options);
}
