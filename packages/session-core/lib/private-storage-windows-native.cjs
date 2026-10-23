// Win32 ACL operations for the bounded, isolated Node worker. This module does
// not load Koffi until its real Windows adapter is requested.
const path = require("node:path");
const { createHash } = require("node:crypto");
const FULL_CONTROL = 0x1f01ff;
const READ_CONTROL = 0x20000;
const WRITE_DAC = 0x40000;
const WRITE_OWNER = 0x80000;
const DIRECTORY = 0x10;
const REPARSE = 0x400;

function failure(code, stage = "verify", win32 = 0) {
  const error = new Error(`Windows native ACL ${code}`);
  error.code = code;
  error.stage = stage;
  error.win32 = Number.isSafeInteger(win32) ? win32 : 0;
  return error;
}

function ownerOnly(security, isDirectory, sid) {
  if (security.ownerSid !== sid || security.rules.length !== 1) return false;
  if (isDirectory && !security.protected) return false;
  const rule = security.rules[0];
  return (
    rule.type === 0 &&
    rule.sid === sid &&
    (rule.mask & FULL_CONTROL) === FULL_CONTROL &&
    // Files may retain a sole inherited owner rule, as in the existing policy.
    (isDirectory ? rule.flags === 3 : rule.flags === 0 || rule.flags === 16)
  );
}

function validateRequest(request) {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).some(
      (k) => !["operation", "targets", "expectedKind", "timeoutMs"].includes(k),
    ) ||
    !["repair", "inspect", "preflight"].includes(request.operation) ||
    ![undefined, null, "file", "directory"].includes(request.expectedKind) ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 1 ||
    request.timeoutMs > 300000 ||
    !Array.isArray(request.targets) ||
    request.targets.length < 1 ||
    request.targets.length > 500 ||
    request.targets.some(
      (target) =>
        typeof target !== "string" ||
        target.length > 32760 ||
        target.includes("\0"),
    ) ||
    new Set(request.targets).size !== request.targets.length
  )
    throw failure("INVALID_REQUEST", "initialize");
  return request;
}

function standardPath(target) {
  if (target.startsWith("\\\\?\\UNC\\")) return "\\\\" + target.slice(8);
  if (target.startsWith("\\\\?\\")) return target.slice(4);
  return target;
}

function mutexName(sid, fullPath, invariantUpper) {
  return (
    "Global\\ChainlessChain.PrivateAcl." +
    createHash("sha256")
      .update(sid + ":" + invariantUpper(fullPath), "utf8")
      .digest("hex")
      .toUpperCase()
  );
}

// Adapter injection is exclusively for component tests. A request completes
// every path/kind preflight before its first mutation, retaining opened handles.
function executeRequest(
  request,
  api,
  { now = () => performance.now(), guard } = {},
) {
  validateRequest(request);
  if (typeof guard !== "function")
    throw failure("PATH_GUARD_UNAVAILABLE", "initialize");
  for (const target of request.targets) {
    const plain = standardPath(target);
    // A stream handle refers to its base file's security descriptor. Do not let
    // an alternate stream spell a protected base object past the path guard.
    const rest = /^[A-Za-z]:/u.test(plain) ? plain.slice(2) : plain;
    if (rest.includes(":")) throw failure("UNSAFE_PATH", "traversal");
    guard(plain, "win32");
  }
  const deadline = now() + request.timeoutMs;
  const remaining = () => {
    const value = Math.floor(deadline - now());
    if (value <= 0) throw failure("DEADLINE_EXCEEDED", "repair-lock");
    return value;
  };
  const held = [];
  const openedByPath = new Map();
  const releaseAll = () => {
    let failed = false;
    for (const opened of held.reverse()) {
      try {
        api.close(opened);
      } catch {
        failed = true;
      }
    }
    if (failed) throw failure("HANDLE_CLOSE_FAILED");
  };
  const openTraversal = (target) => {
    const plain = standardPath(target);
    const root = path.win32.parse(plain).root;
    if (!root || !path.win32.isAbsolute(plain))
      throw failure("UNSAFE_PATH", "traversal");
    const parts = path.win32
      .resolve(plain)
      .slice(root.length)
      .split(/[\\/]/u)
      .filter(Boolean);
    let current = root;
    let found = null;
    for (let i = -1; i < parts.length; i++) {
      if (i >= 0) current = path.win32.join(current, parts[i]);
      remaining();
      const key = current;
      let opened = openedByPath.get(key);
      if (!opened) {
        opened = api.open(current, 0x80);
        if (opened === null) return null;
        held.push(opened);
        openedByPath.set(key, opened);
      }
      const info = api.information(opened);
      if (info.attributes & REPARSE)
        throw failure("PATH_PREFLIGHT_FAILED", "traversal");
      if (i < parts.length - 1 && !(info.attributes & DIRECTORY))
        throw failure("PATH_PREFLIGHT_FAILED", "traversal");
      if (info.attributes & DIRECTORY && !openedByPath.has(key + "\0pinned")) {
        // Metadata-only handles do not activate Windows sharing checks. A
        // directory TRAVERSE handle pins every ancestor without requiring LIST.
        const pinned = api.open(current, 0xa0);
        if (!pinned) throw failure("PATH_IDENTITY_CHANGED", "traversal");
        held.push(pinned);
        const actual = api.information(pinned);
        if (
          actual.identity !== info.identity ||
          !(actual.attributes & DIRECTORY) ||
          actual.attributes & REPARSE
        )
          throw failure("PATH_IDENTITY_CHANGED", "traversal");
        openedByPath.set(key + "\0pinned", pinned);
      }
      found = { opened, info, path: current };
    }
    return found;
  };
  try {
    const entries = request.targets.map((target) => ({
      target,
      found: openTraversal(target),
    }));
    for (const entry of entries) {
      if (
        entry.found &&
        request.expectedKind &&
        Boolean(entry.found.info.attributes & DIRECTORY) !==
          (request.expectedKind === "directory")
      )
        throw failure("EXPECTED_KIND_MISMATCH", "lookup");
    }
    if (request.operation === "preflight")
      return entries.map(({ target, found }) => ({
        target,
        exists: Boolean(found),
        isDirectory: found ? Boolean(found.info.attributes & DIRECTORY) : null,
        ok: true,
        error: null,
      }));
    const token = api.token();
    const results = [];
    for (const { target, found } of entries) {
      remaining();
      if (!found) {
        results.push({
          target,
          exists: false,
          isDirectory: null,
          ok: true,
          error: null,
        });
        continue;
      }
      let mutex = null;
      let acquired = false;
      let readHandle = null;
      let writeHandle = null;
      try {
        const checkHandle = (handle, stage) => {
          if (!handle) throw failure("PATH_IDENTITY_CHANGED", stage);
          const actual = api.information(handle);
          if (
            actual.identity !== found.info.identity ||
            Boolean(actual.attributes & DIRECTORY) !==
              Boolean(found.info.attributes & DIRECTORY) ||
            actual.attributes & REPARSE
          )
            throw failure("PATH_IDENTITY_CHANGED", stage);
        };
        const freshPathSecurity = (stage) => {
          const fresh = api.open(target, READ_CONTROL | 0x80);
          try {
            checkHandle(fresh, stage);
            return api.security(fresh);
          } finally {
            if (fresh)
              try {
                api.close(fresh);
              } catch {
                throw failure("HANDLE_CLOSE_FAILED");
              }
          }
        };
        if (request.operation === "repair") {
          mutex = api.createMutex(
            mutexName(token.userSid, api.fullPath(target), api.invariantUpper),
          );
          acquired = api.waitMutex(mutex, Math.min(10000, remaining()));
          if (!acquired) throw failure("MUTEX_TIMEOUT", "repair-lock");
        }
        for (const opened of held)
          if (api.information(opened).attributes & REPARSE)
            throw failure("PATH_PREFLIGHT_FAILED", "traversal");
        readHandle = api.open(target, READ_CONTROL | 0x80);
        checkHandle(readHandle, "repair-inspect");
        const isDirectory = Boolean(found.info.attributes & DIRECTORY);
        let security = api.security(readHandle);
        if (
          request.operation === "repair" &&
          !ownerOnly(security, isDirectory, token.userSid)
        ) {
          const changeOwner = security.ownerSid !== token.userSid;
          if (changeOwner && security.ownerSid !== token.ownerSid)
            throw failure("FOREIGN_OWNER", "repair-inspect");
          remaining();
          writeHandle = api.open(
            target,
            READ_CONTROL | WRITE_DAC | (changeOwner ? WRITE_OWNER : 0) | 0x80,
          );
          checkHandle(writeHandle, "repair-write");
          // Re-read after acquiring the mutation handle; permission/owner races
          // cannot turn a formerly authorized write into an unrelated-owner repair.
          security = api.security(writeHandle);
          if (
            security.ownerSid !== token.userSid &&
            security.ownerSid !== token.ownerSid
          )
            throw failure("FOREIGN_OWNER", "repair-write");
          if (!ownerOnly(security, isDirectory, token.userSid)) {
            if (security.ownerSid !== token.userSid && !changeOwner)
              throw failure("OWNER_CHANGED", "repair-write");
            security = freshPathSecurity("repair-write");
            if (
              security.ownerSid !== token.userSid &&
              security.ownerSid !== token.ownerSid
            )
              throw failure("FOREIGN_OWNER", "repair-write");
            if (security.ownerSid !== token.userSid && !changeOwner)
              throw failure("OWNER_CHANGED", "repair-write");
            for (const opened of held)
              if (api.information(opened).attributes & REPARSE)
                throw failure("PATH_PREFLIGHT_FAILED", "repair-write");
            checkHandle(writeHandle, "repair-write");
            remaining();
            // File names can still move after this check. Only the held,
            // authorized object is changed; final path checks reject a swap.
            if (!ownerOnly(security, isDirectory, token.userSid))
              api.writeSecurity(
                writeHandle,
                token.userSid,
                isDirectory,
                security.ownerSid !== token.userSid,
              );
          }
        }
        remaining();
        for (const opened of held)
          if (api.information(opened).attributes & REPARSE)
            throw failure("PATH_PREFLIGHT_FAILED", "verify");
        checkHandle(readHandle, "verify");
        security = freshPathSecurity("verify");
        const ok = ownerOnly(security, isDirectory, token.userSid);
        results.push({
          target,
          exists: true,
          isDirectory,
          ok,
          ownerSid: security.ownerSid,
          currentSid: token.userSid,
          tokenOwnerSid: token.ownerSid,
          protected: security.protected,
          aceCount: security.rules.length,
          error: ok ? null : "path is not owner-only",
          errorCode: null,
        });
      } finally {
        let cleanupFailed = false;
        for (const action of [
          () => {
            if (writeHandle) api.close(writeHandle);
          },
          () => {
            if (readHandle) api.close(readHandle);
          },
          () => {
            if (mutex && acquired) api.releaseMutex(mutex);
          },
          () => {
            if (mutex) api.close(mutex);
          },
        ])
          try {
            action();
          } catch {
            cleanupFailed = true;
          }
        if (cleanupFailed) throw failure("HANDLE_CLOSE_FAILED");
      }
    }
    return results;
  } finally {
    releaseAll();
  }
}

module.exports = {
  executeRequest,
  validateRequest,
  ownerOnly,
  mutexName,
  failure,
  standardPath,
};
