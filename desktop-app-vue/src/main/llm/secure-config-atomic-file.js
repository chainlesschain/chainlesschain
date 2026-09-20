"use strict";

const defaultFs = require("node:fs");
const crypto = require("node:crypto");
const defaultPath = require("node:path");
const ACTIVE_TARGETS = new Set();
const LOCK_VERSION = 1;
const MAX_LOCK_BYTES = 1024;
const PROCESS_STARTED_AT = Math.max(
  0,
  Math.floor(Date.now() - process.uptime() * 1000),
);

function defaultProcessLiveness(pid, processStartedAt) {
  if (
    pid === process.pid &&
    Math.abs(processStartedAt - PROCESS_STARTED_AT) > 1000
  ) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function createAtomicFileCommitter({
  fs = defaultFs,
  fsPromises = defaultFs.promises,
  path = defaultPath,
  platform = process.platform,
  processId = process.pid,
  processStartedAt = PROCESS_STARTED_AT,
  isProcessAlive = defaultProcessLiveness,
} = {}) {
  if (!Number.isSafeInteger(processId) || processId < 1) {
    throw new TypeError("Atomic file process identity is invalid");
  }
  if (!Number.isSafeInteger(processStartedAt) || processStartedAt < 0) {
    throw new TypeError("Atomic file process start is invalid");
  }
  if (typeof isProcessAlive !== "function") {
    throw new TypeError("Atomic file process liveness probe is invalid");
  }

  function targetKey(filePath) {
    return path.resolve(filePath);
  }

  function tempPath(filePath) {
    return `${filePath}.tmp`;
  }

  function lockPath(filePath) {
    return `${filePath}.lock`;
  }

  function recoveryPath(filePath) {
    return `${lockPath(filePath)}.recovery`;
  }

  function digest(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  function createOwner(filePath, kind, observedOwnerDigest = null) {
    const owner = {
      version: LOCK_VERSION,
      kind,
      pid: processId,
      processStartedAt,
      nonce: crypto.randomBytes(16).toString("hex"),
      targetDigest: digest(targetKey(filePath)),
    };
    if (kind === "recovery") {
      owner.observedOwnerDigest = observedOwnerDigest;
    }
    return Object.freeze(owner);
  }

  function encodeOwner(owner) {
    return Buffer.from(JSON.stringify(owner), "utf8");
  }

  function readOwnerSync(recordPath, filePath, expectedKind) {
    const stat = fs.lstatSync(recordPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !Number.isSafeInteger(stat.size) ||
      stat.size < 1 ||
      stat.size > MAX_LOCK_BYTES
    ) {
      throw new Error("Atomic file lock owner is invalid");
    }
    const bytes = fs.readFileSync(recordPath);
    let owner;
    try {
      owner = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("Atomic file lock owner is invalid");
    }
    const expectedKeys = [
      "kind",
      "nonce",
      "pid",
      "processStartedAt",
      "targetDigest",
      "version",
      ...(expectedKind === "recovery" ? ["observedOwnerDigest"] : []),
    ].sort();
    if (
      !owner ||
      typeof owner !== "object" ||
      Array.isArray(owner) ||
      Object.keys(owner).sort().join("\0") !== expectedKeys.join("\0") ||
      owner.version !== LOCK_VERSION ||
      owner.kind !== expectedKind ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid < 1 ||
      !Number.isSafeInteger(owner.processStartedAt) ||
      owner.processStartedAt < 0 ||
      !/^[a-f0-9]{32}$/u.test(owner.nonce) ||
      !/^[a-f0-9]{64}$/u.test(owner.targetDigest) ||
      owner.targetDigest !== digest(targetKey(filePath)) ||
      (expectedKind === "recovery" &&
        !/^[a-f0-9]{64}$/u.test(owner.observedOwnerDigest))
    ) {
      throw new Error("Atomic file lock owner is invalid");
    }
    return Object.freeze({ bytes, owner: Object.freeze(owner) });
  }

  function enter(filePath) {
    const key = targetKey(filePath);
    if (ACTIVE_TARGETS.has(key)) {
      throw new Error("Atomic file target is already active");
    }
    ACTIVE_TARGETS.add(key);
    return key;
  }

  function leave(key) {
    ACTIVE_TARGETS.delete(key);
  }

  function unlinkIfPresentSync(filePath) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  async function unlinkIfPresent(filePath) {
    try {
      await fsPromises.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  function syncDirectorySync(dir) {
    const descriptor = fs.openSync(dir, platform === "win32" ? "r+" : "r");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  async function syncDirectory(dir) {
    const handle = await fsPromises.open(
      dir,
      platform === "win32" ? "r+" : "r",
    );
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  function assertDirectoryChain(firstCreated, target) {
    const first = path.toNamespacedPath(path.resolve(firstCreated));
    const resolvedTarget = path.toNamespacedPath(path.resolve(target));
    const relative = path.relative(first, resolvedTarget);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Atomic file directory creation escaped its target");
    }
    return { first, resolvedTarget };
  }

  function syncCreatedDirectoryChainSync(firstCreated, target) {
    const { first, resolvedTarget } = assertDirectoryChain(
      firstCreated,
      target,
    );
    let current = first;
    for (;;) {
      syncDirectorySync(path.dirname(current));
      if (current === resolvedTarget) {
        return;
      }
      const [next] = path.relative(current, resolvedTarget).split(path.sep);
      current = path.join(current, next);
    }
  }

  async function syncCreatedDirectoryChain(firstCreated, target) {
    const { first, resolvedTarget } = assertDirectoryChain(
      firstCreated,
      target,
    );
    let current = first;
    for (;;) {
      await syncDirectory(path.dirname(current));
      if (current === resolvedTarget) {
        return;
      }
      const [next] = path.relative(current, resolvedTarget).split(path.sep);
      current = path.join(current, next);
    }
  }

  function ensureParentSync(filePath) {
    const dir = path.dirname(filePath);
    const firstCreated = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (typeof firstCreated === "string") {
      syncCreatedDirectoryChainSync(firstCreated, dir);
    }
    return dir;
  }

  async function ensureParent(filePath) {
    const dir = path.dirname(filePath);
    const firstCreated = await fsPromises.mkdir(dir, {
      recursive: true,
      mode: 0o700,
    });
    if (typeof firstCreated === "string") {
      await syncCreatedDirectoryChain(firstCreated, dir);
    }
    return dir;
  }

  function ownerIsAlive(owner) {
    try {
      return isProcessAlive(owner.pid, owner.processStartedAt) !== false;
    } catch {
      return true;
    }
  }

  function releaseOwnedRecordSync(recordPath, expectedBytes) {
    const stat = fs.lstatSync(recordPath);
    const currentBytes = fs.readFileSync(recordPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !Buffer.isBuffer(expectedBytes) ||
      !currentBytes.equals(expectedBytes)
    ) {
      throw new Error("Atomic file lock ownership changed");
    }
    fs.unlinkSync(recordPath);
    syncDirectorySync(path.dirname(recordPath));
  }

  function tryCreateExclusiveRecordSync(recordPath, owner) {
    const bytes = encodeOwner(owner);
    if (bytes.length < 1 || bytes.length > MAX_LOCK_BYTES) {
      throw new Error("Atomic file lock owner is invalid");
    }
    const candidate = `${recordPath}.claim-${processId}-${owner.nonce}`;
    let linkAttempted = false;
    let linked = false;
    try {
      fs.writeFileSync(candidate, bytes, { flag: "wx", mode: 0o600 });
      const descriptor = fs.openSync(candidate, "r+");
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      linkAttempted = true;
      fs.linkSync(candidate, recordPath);
      linked = true;
      fs.unlinkSync(candidate);
      syncDirectorySync(path.dirname(recordPath));
      return Object.freeze({ bytes, owner, path: recordPath });
    } catch (error) {
      if (linked) {
        try {
          releaseOwnedRecordSync(recordPath, bytes);
        } catch {
          // Preserve the primary lock acquisition failure.
        }
      }
      if (linkAttempted && error?.code === "EEXIST") {
        return null;
      }
      throw error;
    } finally {
      try {
        unlinkIfPresentSync(candidate);
      } catch {
        // Candidate cleanup cannot replace the primary result.
      }
    }
  }

  function acquireRecoveryFenceSync(filePath, observedBytes) {
    const recordPath = recoveryPath(filePath);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const owner = createOwner(filePath, "recovery", digest(observedBytes));
      const fence = tryCreateExclusiveRecordSync(recordPath, owner);
      if (fence) {
        return fence;
      }
      const current = readOwnerSync(recordPath, filePath, "recovery");
      if (ownerIsAlive(current.owner)) {
        return null;
      }
      try {
        releaseOwnedRecordSync(recordPath, current.bytes);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }
    return null;
  }

  function reclaimDeadTargetLockSync(filePath, observed) {
    const fence = acquireRecoveryFenceSync(filePath, observed.bytes);
    if (!fence) {
      return false;
    }
    try {
      const current = readOwnerSync(lockPath(filePath), filePath, "target");
      if (
        !current.bytes.equals(observed.bytes) ||
        ownerIsAlive(current.owner)
      ) {
        return false;
      }
      releaseOwnedRecordSync(lockPath(filePath), current.bytes);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") {
        return true;
      }
      throw error;
    } finally {
      releaseOwnedRecordSync(fence.path, fence.bytes);
    }
  }

  function acquireTargetLockSync(filePath) {
    const recordPath = lockPath(filePath);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const owner = createOwner(filePath, "target");
      const lock = tryCreateExclusiveRecordSync(recordPath, owner);
      if (lock) {
        return lock;
      }
      const observed = readOwnerSync(recordPath, filePath, "target");
      if (ownerIsAlive(observed.owner)) {
        throw new Error("Atomic file target is owned by another process");
      }
      if (!reclaimDeadTargetLockSync(filePath, observed)) {
        throw new Error("Atomic file target recovery is already active");
      }
    }
    throw new Error("Atomic file target lock could not be acquired");
  }

  function releaseTargetLockSync(lock) {
    if (lock) {
      releaseOwnedRecordSync(lock.path, lock.bytes);
    }
  }

  function writeFileSync(filePath, data) {
    const key = enter(filePath);
    const temporary = tempPath(filePath);
    let lock = null;
    let committed = false;
    try {
      const dir = ensureParentSync(filePath);
      lock = acquireTargetLockSync(filePath);
      unlinkIfPresentSync(temporary);
      fs.writeFileSync(temporary, data, { flag: "wx", mode: 0o600 });
      const descriptor = fs.openSync(temporary, "r+");
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(temporary, filePath);
      committed = true;
      syncDirectorySync(dir);
    } finally {
      if (!committed && lock) {
        try {
          unlinkIfPresentSync(temporary);
        } catch {
          // Preserve the primary commit failure.
        }
      }
      try {
        releaseTargetLockSync(lock);
      } finally {
        leave(key);
      }
    }
  }

  async function writeFile(filePath, data) {
    const key = enter(filePath);
    const temporary = tempPath(filePath);
    let lock = null;
    let handle = null;
    let committed = false;
    try {
      const dir = await ensureParent(filePath);
      lock = acquireTargetLockSync(filePath);
      await unlinkIfPresent(temporary);
      handle = await fsPromises.open(temporary, "wx", 0o600);
      await handle.writeFile(data);
      await handle.sync();
      await handle.close();
      handle = null;
      await fsPromises.rename(temporary, filePath);
      committed = true;
      await syncDirectory(dir);
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // Preserve the primary commit failure.
        }
      }
      if (!committed && lock) {
        await unlinkIfPresent(temporary);
      }
      try {
        releaseTargetLockSync(lock);
      } finally {
        leave(key);
      }
    }
  }

  function validatesSync(filePath, validate) {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    try {
      return validate(fs.readFileSync(filePath)) === true;
    } catch {
      return false;
    }
  }

  async function validates(filePath, validate) {
    try {
      const data = await fsPromises.readFile(filePath);
      return (await validate(data)) === true;
    } catch {
      return false;
    }
  }

  async function exists(filePath) {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  function recoverSync(filePath, validate) {
    if (typeof validate !== "function") {
      throw new TypeError("Atomic file recovery requires a validator");
    }
    const key = enter(filePath);
    const temporary = tempPath(filePath);
    let lock = null;
    try {
      if (!fs.existsSync(temporary)) {
        return Object.freeze({ action: "none", recovered: false });
      }
      lock = acquireTargetLockSync(filePath);
      const dir = path.dirname(filePath);
      if (validatesSync(filePath, validate)) {
        fs.unlinkSync(temporary);
        syncDirectorySync(dir);
        return Object.freeze({ action: "stale-discarded", recovered: false });
      }
      if (!validatesSync(temporary, validate)) {
        fs.unlinkSync(temporary);
        syncDirectorySync(dir);
        return Object.freeze({ action: "invalid-discarded", recovered: false });
      }
      fs.renameSync(temporary, filePath);
      syncDirectorySync(dir);
      return Object.freeze({ action: "temporary-recovered", recovered: true });
    } finally {
      try {
        releaseTargetLockSync(lock);
      } finally {
        leave(key);
      }
    }
  }

  async function recover(filePath, validate) {
    if (typeof validate !== "function") {
      throw new TypeError("Atomic file recovery requires a validator");
    }
    const key = enter(filePath);
    const temporary = tempPath(filePath);
    let lock = null;
    try {
      if (!(await exists(temporary))) {
        return Object.freeze({ action: "none", recovered: false });
      }
      lock = acquireTargetLockSync(filePath);
      if (await validates(filePath, validate)) {
        await fsPromises.unlink(temporary);
        await syncDirectory(path.dirname(filePath));
        return Object.freeze({ action: "stale-discarded", recovered: false });
      }
      if (!(await validates(temporary, validate))) {
        await fsPromises.unlink(temporary);
        await syncDirectory(path.dirname(filePath));
        return Object.freeze({
          action: "invalid-discarded",
          recovered: false,
        });
      }
      await fsPromises.rename(temporary, filePath);
      await syncDirectory(path.dirname(filePath));
      return Object.freeze({ action: "temporary-recovered", recovered: true });
    } finally {
      try {
        releaseTargetLockSync(lock);
      } finally {
        leave(key);
      }
    }
  }

  function removeSync(filePath) {
    const key = enter(filePath);
    let lock = null;
    try {
      ensureParentSync(filePath);
      lock = acquireTargetLockSync(filePath);
      const removedTemporary = unlinkIfPresentSync(tempPath(filePath));
      const removedTarget = unlinkIfPresentSync(filePath);
      if (removedTemporary || removedTarget) {
        syncDirectorySync(path.dirname(filePath));
      }
      return removedTarget;
    } finally {
      try {
        releaseTargetLockSync(lock);
      } finally {
        leave(key);
      }
    }
  }

  return Object.freeze({
    recover,
    recoverSync,
    removeSync,
    writeFile,
    writeFileSync,
  });
}

module.exports = { createAtomicFileCommitter };
