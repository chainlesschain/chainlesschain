import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const trustedWorkspaceStorage = new AsyncLocalStorage();
const registeredHostWorkspaces = new Map();
const registeredHostWorkspaceIdentities = new Map();
const MAX_REGISTERED_HOST_WORKSPACES = 1024;

function validateHostWorkspaceRoot(workspaceRoot) {
  if (
    typeof workspaceRoot !== "string" ||
    workspaceRoot.length === 0 ||
    workspaceRoot.includes("\0")
  ) {
    const error = new TypeError(
      "Hooks v2 host workspace root must be a non-empty path",
    );
    error.code = "CC_HOOK_TRUSTED_WORKSPACE_INVALID";
    throw error;
  }
  return path.resolve(workspaceRoot);
}

function invalidWorkspaceRoot(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "CC_HOOK_TRUSTED_WORKSPACE_INVALID";
  return error;
}

function workspaceGeneration(stats) {
  // dev+ino alone is insufficient: filesystems may immediately reuse an inode
  // after a same-path directory replacement. Prefer the stable creation
  // timestamp and fail closed on metadata changes when a filesystem does not
  // expose one.
  return stats.birthtimeNs > 0n
    ? `birth:${stats.birthtimeNs.toString()}`
    : `ctime:${stats.ctimeNs.toString()}`;
}

function captureWorkspaceIdentity(workspaceRoot) {
  const resolvedRoot = validateHostWorkspaceRoot(workspaceRoot);
  let canonicalRoot;
  let stats;
  try {
    canonicalRoot = fs.realpathSync.native(resolvedRoot);
    stats = fs.statSync(canonicalRoot, { bigint: true });
  } catch (error) {
    throw invalidWorkspaceRoot(
      "Hooks v2 host workspace root must resolve to an existing directory",
      error,
    );
  }
  if (!stats.isDirectory()) {
    throw invalidWorkspaceRoot(
      "Hooks v2 host workspace root must resolve to a directory",
    );
  }
  return Object.freeze({
    canonicalRoot,
    device: stats.dev,
    inode: stats.ino,
    generation: workspaceGeneration(stats),
  });
}

function workspaceIdentityKey(identity) {
  return JSON.stringify([
    identity.canonicalRoot,
    identity.device.toString(),
    identity.inode.toString(),
    identity.generation,
  ]);
}

function sameWorkspaceIdentity(left, right) {
  return (
    left.canonicalRoot === right.canonicalRoot &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.generation === right.generation
  );
}

function invalidateWorkspaceRecord(record) {
  if (registeredHostWorkspaces.get(record.binding.bindingId) === record) {
    registeredHostWorkspaces.delete(record.binding.bindingId);
  }
  if (
    registeredHostWorkspaceIdentities.get(record.identityKey) ===
    record.binding.bindingId
  ) {
    registeredHostWorkspaceIdentities.delete(record.identityKey);
  }
}

function verifyWorkspaceRecord(record) {
  if (!record) return null;
  if (registeredHostWorkspaces.get(record.binding.bindingId) !== record) {
    return null;
  }
  let currentIdentity;
  try {
    currentIdentity = captureWorkspaceIdentity(record.binding.workspaceRoot);
  } catch {
    invalidateWorkspaceRecord(record);
    return null;
  }
  if (!sameWorkspaceIdentity(record.identity, currentIdentity)) {
    invalidateWorkspaceRecord(record);
    return null;
  }
  return record.binding;
}

function pruneInvalidWorkspaceRecords() {
  for (const record of Array.from(registeredHostWorkspaces.values())) {
    verifyWorkspaceRecord(record);
  }
}

function workspaceBindingId(identity) {
  return createHash("sha256")
    .update("chainlesschain.hooks-v2-host-workspace.v3\0")
    .update(workspaceIdentityKey(identity), "utf8")
    .digest("hex");
}

/**
 * Register a root selected by trusted host bootstrap code. Durable records
 * persist only the returned opaque stable digest; the plaintext canonical path
 * and directory identity remain process-local.
 */
export function registerHostHooksV2Workspace(workspaceRoot) {
  const identity = captureWorkspaceIdentity(workspaceRoot);
  const identityKey = workspaceIdentityKey(identity);
  const existingBindingId = registeredHostWorkspaceIdentities.get(identityKey);
  if (existingBindingId) {
    const existingRecord = registeredHostWorkspaces.get(existingBindingId);
    const existingBinding = verifyWorkspaceRecord(existingRecord);
    if (
      existingBinding &&
      sameWorkspaceIdentity(existingRecord.identity, identity)
    ) {
      return existingBinding;
    }
  }

  // A long-running host may create and remove many isolated worktrees. Sweep
  // stale filesystem identities before enforcing the bounded registry so
  // deleted roots cannot exhaust future trusted registrations.
  if (registeredHostWorkspaces.size >= MAX_REGISTERED_HOST_WORKSPACES) {
    pruneInvalidWorkspaceRecords();
  }
  if (registeredHostWorkspaces.size >= MAX_REGISTERED_HOST_WORKSPACES) {
    const error = new Error(
      "Hooks v2 host workspace registry capacity exceeded",
    );
    error.code = "CC_HOOK_TRUSTED_WORKSPACE_LIMIT";
    throw error;
  }

  const bindingId = workspaceBindingId(identity);
  const collidingRecord = registeredHostWorkspaces.get(bindingId);
  if (collidingRecord) {
    const collidingBinding = verifyWorkspaceRecord(collidingRecord);
    if (
      collidingBinding &&
      sameWorkspaceIdentity(collidingRecord.identity, identity)
    ) {
      registeredHostWorkspaceIdentities.set(identityKey, bindingId);
      return collidingBinding;
    }
    if (
      collidingBinding &&
      collidingRecord.identity.canonicalRoot !== identity.canonicalRoot
    ) {
      const error = new Error("Hooks v2 workspace binding digest collision");
      error.code = "CC_HOOK_TRUSTED_WORKSPACE_COLLISION";
      throw error;
    }
    if (collidingBinding) {
      throw invalidWorkspaceRoot(
        "Hooks v2 host workspace identity changed during registration",
      );
    }
  }

  const binding = Object.freeze({
    bindingId,
    workspaceRoot: identity.canonicalRoot,
  });
  const record = Object.freeze({
    binding,
    identity,
    identityKey,
  });
  registeredHostWorkspaces.set(bindingId, record);
  registeredHostWorkspaceIdentities.set(identityKey, bindingId);
  return binding;
}

/**
 * Run a CLI-host operation with an immutable Hooks v2 workspace authority.
 *
 * Only host bootstrap code may call this with a root selected before hook,
 * plugin, model, or event payload processing. The binding is async-scoped
 * instead of global so concurrent CLI runs cannot replace one another's
 * writable root.
 */
export function runWithHostHooksV2Workspace(workspaceRoot, callback) {
  if (typeof callback !== "function") {
    throw new TypeError("Hooks v2 workspace callback must be a function");
  }
  const binding = registerHostHooksV2Workspace(workspaceRoot);
  return trustedWorkspaceStorage.run(
    registeredHostWorkspaces.get(binding.bindingId),
    callback,
  );
}

/**
 * Internal consumer seam for HooksV2Runtime. Event and hook payloads never
 * participate in selecting this value.
 */
export function currentHostHooksV2WorkspaceRoot() {
  return currentHostHooksV2WorkspaceBinding()?.workspaceRoot || null;
}

export function currentHostHooksV2WorkspaceBinding() {
  return verifyWorkspaceRecord(trustedWorkspaceStorage.getStore());
}

/**
 * Resolve an opaque durable binding only against roots registered by the
 * current host process. No persisted or event-supplied path is accepted.
 */
export function resolveRegisteredHostHooksV2Workspace(bindingId) {
  if (typeof bindingId !== "string" || !/^[a-f0-9]{64}$/.test(bindingId)) {
    return null;
  }
  return verifyWorkspaceRecord(registeredHostWorkspaces.get(bindingId));
}

/**
 * Revoke a process-local binding owned by trusted host lifecycle code.
 * Payloads, hooks, and durable records must never call this release seam.
 */
export function releaseRegisteredHostHooksV2Workspace(bindingId) {
  if (typeof bindingId !== "string" || !/^[a-f0-9]{64}$/.test(bindingId)) {
    return false;
  }
  const record = registeredHostWorkspaces.get(bindingId);
  if (!record) return false;
  invalidateWorkspaceRecord(record);
  return true;
}
