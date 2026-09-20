"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");
const ACTIVE_TARGETS = new Set();

function createAtomicFileCommitter({
  fs = defaultFs,
  fsPromises = defaultFs.promises,
  path = defaultPath,
  platform = process.platform,
} = {}) {
  function targetKey(filePath) {
    return path.resolve(filePath);
  }

  function tempPath(filePath) {
    return `${filePath}.tmp`;
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

  function writeFileSync(filePath, data) {
    const key = enter(filePath);
    const temporary = tempPath(filePath);
    let committed = false;
    try {
      const dir = ensureParentSync(filePath);
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
      if (!committed) {
        try {
          unlinkIfPresentSync(temporary);
        } catch {
          // Preserve the primary commit failure.
        }
      }
      leave(key);
    }
  }

  async function writeFile(filePath, data) {
    const key = enter(filePath);
    const temporary = tempPath(filePath);
    let handle = null;
    let committed = false;
    try {
      const dir = await ensureParent(filePath);
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
      if (!committed) {
        await unlinkIfPresent(temporary);
      }
      leave(key);
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
    try {
      if (!fs.existsSync(temporary)) {
        return Object.freeze({ action: "none", recovered: false });
      }
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
      leave(key);
    }
  }

  async function recover(filePath, validate) {
    if (typeof validate !== "function") {
      throw new TypeError("Atomic file recovery requires a validator");
    }
    const key = enter(filePath);
    const temporary = tempPath(filePath);
    try {
      if (!(await exists(temporary))) {
        return Object.freeze({ action: "none", recovered: false });
      }
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
      leave(key);
    }
  }

  function removeSync(filePath) {
    const key = enter(filePath);
    try {
      const removedTemporary = unlinkIfPresentSync(tempPath(filePath));
      const removedTarget = unlinkIfPresentSync(filePath);
      if (removedTemporary || removedTarget) {
        syncDirectorySync(path.dirname(filePath));
      }
      return removedTarget;
    } finally {
      leave(key);
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
