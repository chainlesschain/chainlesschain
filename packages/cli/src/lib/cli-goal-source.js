/** Bounded standalone file reads shared by explicit CLI snapshots. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createGoalFileAdapter } from "./goal-store.js";

function fail(code) {
  throw new Error(code);
}
function sameFile(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

/** Pin the configured store, including directory identity, for this snapshot. */
function sourceReader(root, onRead) {
  const realRoot = fs.realpathSync(root);
  const initialRoot = fs.statSync(root);
  function checkRoot() {
    const stat = fs.statSync(root);
    if (
      !stat.isDirectory() ||
      fs.realpathSync(root) !== realRoot ||
      stat.dev !== initialRoot.dev ||
      stat.ino !== initialRoot.ino
    )
      fail("CLI_GOAL_STORE_CHANGED");
  }
  const readJson = (file) => {
    checkRoot();
    const entry = fs.lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink())
      fail("CLI_GOAL_REGULAR_FILE_REQUIRED");
    let fd;
    try {
      fd = fs.openSync(
        file,
        fs.constants.O_RDONLY |
          (fs.constants.O_NOFOLLOW || 0) |
          (fs.constants.O_NONBLOCK || 0),
      );
      const before = fs.fstatSync(fd);
      if (!before.isFile() || !sameFile(entry, before))
        fail("CLI_GOAL_SOURCE_CHANGED");
      if (before.size > 64 * 1024) fail("CLI_GOAL_SOURCE_TOO_LARGE");
      const buffer = Buffer.alloc(before.size + 1);
      let count = 0;
      while (count < buffer.length) {
        const size = fs.readSync(
          fd,
          buffer,
          count,
          buffer.length - count,
          count,
        );
        if (!size) break;
        count += size;
      }
      checkRoot();
      const after = fs.lstatSync(file);
      if (
        count !== before.size ||
        !sameFile(before, fs.fstatSync(fd)) ||
        !after.isFile() ||
        after.isSymbolicLink() ||
        !sameFile(before, after)
      )
        fail("CLI_GOAL_SOURCE_CHANGED");
      const bytes = buffer.subarray(0, count);
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      onRead(createHash("sha256").update(bytes).digest("hex"));
      return value;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  };
  return { readJson, checkRoot };
}

export function createCliGoalSnapshotReader(root) {
  let rawDigest;
  const source = sourceReader(root, (value) => {
    rawDigest = value;
  });
  const adapter = createGoalFileAdapter({ root, readJson: source.readJson });
  function read(id) {
    const goal = adapter.get(id);
    if (!goal) fail("CLI_GOAL_NOT_FOUND");
    return { goal, digest: rawDigest };
  }
  function revalidate(snapshot) {
    let current;
    try {
      current = read(snapshot.goal.id);
    } catch {
      fail("CLI_GOAL_SOURCE_CHANGED");
    }
    if (
      current.digest !== snapshot.digest ||
      current.goal.storeId !== snapshot.goal.storeId ||
      current.goal.revision !== snapshot.goal.revision ||
      current.goal.controlGeneration !== snapshot.goal.controlGeneration
    )
      fail("CLI_GOAL_SOURCE_CHANGED");
    return current.goal;
  }
  return {
    storeId: adapter.storeId,
    read,
    revalidate,
    checkRoot: source.checkRoot,
  };
}
