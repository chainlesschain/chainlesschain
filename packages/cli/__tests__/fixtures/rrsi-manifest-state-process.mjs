// TEST ONLY: real mutable backend state; no manifest signature/graph authority.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createEvolutionLedgerFileManifestCatalogBackend as catalog } from "../../src/lib/evolution/evolution-ledger-file-manifest-catalog.js";
import { createEvolutionLedgerFileManifestHeadBackend as head } from "../../src/lib/evolution/evolution-ledger-file-manifest-head-store.js";

let fired = false,
  opens = 0,
  rawReads = 0,
  actualReadBytes = 0,
  expectedSize = 0;
let directoryMoved = false,
  directoryCopied = false,
  directoryModeChanged = false,
  leafPathSamples = 0;
let originalDirectoryInode, originalLeafInode, originalDirectoryMode;
const live = new Set();
try {
  const directory = path.resolve(process.argv[2]),
    kind = process.argv[3],
    mode = process.argv[4];
  const root = path.dirname(directory),
    temp = fs.realpathSync.native(os.tmpdir());
  if (
    path.dirname(root) !== temp ||
    !path.basename(root).startsWith("cc-manifest-state-process-") ||
    !["head", "catalog"].includes(kind) ||
    path.basename(directory) !== kind ||
    !["read", "fifo", "directory", "directory-mode", "symlink"].includes(mode)
  )
    throw new Error("unsafe manifest state child path or mode");
  if (mode !== "read" && process.platform === "win32")
    throw new Error("POSIX mutation probes only");
  const backend = (kind === "head" ? head : catalog)({
    directoryPath: directory,
  });
  const value = {
    headDigest: "test-head",
    manifestDigest: "test-manifest",
    payload: "x".repeat(100_000),
  };
  if (kind === "head")
    backend.compareAndSet({ expectedHeadDigest: null, nextHead: value });
  else
    backend.compareAndAppend({ expectedManifestDigest: null, manifest: value });
  const target = backend.descriptor.file,
    saved = path.join(root, "saved-state");
  expectedSize = fs.statSync(target).size;
  originalDirectoryInode = fs
    .lstatSync(directory, { bigint: true })
    .ino.toString();
  originalLeafInode = fs.lstatSync(target, { bigint: true }).ino.toString();
  originalDirectoryMode = fs.lstatSync(directory).mode;
  if (mode === "symlink") {
    fired = true;
    fs.renameSync(target, saved);
    fs.symlinkSync(path.join(root, "absent-symlink-target"), target);
  }
  const originalOpen = fs.openSync,
    originalClose = fs.closeSync,
    originalRead = fs.readSync,
    originalWhole = fs.readFileSync;
  const originalStat = fs.lstatSync;
  fs.lstatSync = (name, config) => {
    const stat = originalStat(name, config);
    if (
      (mode === "directory" || mode === "directory-mode") &&
      name === target &&
      ++leafPathSamples === 2 &&
      !fired
    ) {
      fired = true;
      if (mode === "directory-mode") {
        // Real permission mutation in our private fixture, preserving owner
        // traversal. WSL1 cannot rename this directory while its leaf is open.
        fs.chmodSync(directory, (originalDirectoryMode & 0o777) ^ 0o010);
        directoryModeChanged = true;
      } else {
        fs.renameSync(directory, path.join(root, "saved-directory"));
        directoryMoved = true;
        fs.cpSync(path.join(root, "saved-directory"), directory, {
          recursive: true,
        });
        directoryCopied = true;
      }
    }
    return stat;
  };
  fs.openSync = (name, flags, ...args) => {
    const leaf =
      name === target &&
      typeof flags === "number" &&
      !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR));
    if (leaf) {
      opens++;
      if (mode === "fifo" && !fired) {
        fired = true;
        fs.renameSync(target, saved);
        const created = spawnSync("mkfifo", [target], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
        });
        if (created.error || created.status !== 0)
          throw new Error(
            `actual FIFO setup failed: ${created.error?.message || created.stderr}`,
          );
      }
    }
    const fd = originalOpen(name, flags, ...args);
    if (leaf) live.add(fd);
    return fd;
  };
  fs.closeSync = (fd) => {
    live.delete(fd);
    return originalClose(fd);
  };
  fs.readSync = (fd, ...args) => {
    const count = originalRead(fd, ...args);
    if (live.has(fd)) actualReadBytes += count;
    return count;
  };
  fs.readFileSync = (name, ...args) => {
    if (name === target || live.has(name)) {
      rawReads++;
      throw new Error("raw manifest state read forbidden");
    }
    return originalWhole(name, ...args);
  };
  const result = kind === "head" ? backend.load() : backend.list()[0];
  process.stdout.write(
    JSON.stringify({
      kind,
      opens,
      rawReads,
      actualReadBytes,
      expectedSize,
      liveDescriptors: live.size,
      payloadMatched: JSON.stringify(result) === JSON.stringify(value),
      localOnly: backend.descriptor.localOnly,
      physicalWindowOnly: true,
      fullPhysicalStorageGraphVerified: false,
    }),
  );
} catch (error) {
  const directory = path.resolve(process.argv[2]),
    root = path.dirname(directory);
  const target = path.join(directory, `manifest-${process.argv[3]}.json`);
  let inspection;
  try {
    // An attempted rename can fail natively before a saved path exists. Report
    // that failure without replacing it with a secondary ENOENT from reporting.
    const preserved = directoryMoved
      ? path.join(root, "saved-directory", `manifest-${process.argv[3]}.json`)
      : ["fifo", "symlink"].includes(process.argv[4]) && fired
        ? path.join(root, "saved-state")
        : target;
    inspection = {
      savedByteLength: fs.statSync(preserved).size,
      preservedLeafInode: fs
        .lstatSync(preserved, { bigint: true })
        .ino.toString(),
      currentDirectoryInode: fs
        .lstatSync(directory, { bigint: true })
        .ino.toString(),
      currentDirectoryMode: fs.lstatSync(directory).mode,
      actualFifoVerified:
        fired && process.argv[4] === "fifo" && fs.lstatSync(target).isFIFO(),
      actualDanglingSymlinkVerified:
        fired &&
        process.argv[4] === "symlink" &&
        fs.lstatSync(target).isSymbolicLink() &&
        !fs.existsSync(target),
    };
  } catch (inspectionError) {
    inspection = {
      inspectionError: {
        code: inspectionError.code,
        message: inspectionError.message,
      },
    };
  }
  process.stderr.write(
    JSON.stringify({
      code: error.code,
      message: error.message,
      causeCode: error.cause?.code,
      kind: process.argv[3],
      faultInjected: fired,
      opens,
      rawReads,
      actualReadBytes,
      expectedSize,
      liveDescriptors: live.size,
      directoryMoved,
      directoryCopied,
      directoryModeChanged,
      leafPathSamples,
      originalDirectoryInode,
      originalLeafInode,
      originalDirectoryMode,
      ...inspection,
    }),
  );
  process.exitCode = 2;
}
