// TEST ONLY. Isolated watchdog covers a real journal reopen and measured read.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  journalDigest,
  openJournalBoundaryFixture,
} from "./evolution-journal-boundary.js";

const [root, mode = "read", branch = "cold"] = process.argv.slice(2);
const value = openJournalBoundaryFixture(root, { seed: false });
const target = value.files.segment,
  saved = path.join(root, "saved-segment-process");
const original = fs.readFileSync(target),
  originalInode = fs.lstatSync(target, { bigint: true }).ino;
let fired = false,
  changedMode = false,
  actualFifo = false,
  error;
let savedDirectory = null,
  directoryFlags = null;
value.arm(target);
if (mode === "parent-fifo")
  value.io.beforeAnyOpen = (directory, flags) => {
    if (
      fired ||
      directory !== value.ledger.segmentDir ||
      typeof flags !== "number"
    )
      return;
    fired = true;
    directoryFlags = flags;
    savedDirectory = path.join(root, "saved-parent-process");
    fs.renameSync(directory, savedDirectory);
    const child = spawnSync("mkfifo", [directory], {
      encoding: "utf8",
      timeout: 1000,
    });
    assert.equal(child.status, 0, child.stderr);
    actualFifo = fs.lstatSync(directory).isFIFO();
    assert.equal(actualFifo, true);
  };
if (mode === "fifo")
  value.io.beforeOpen = () => {
    if (fired) return;
    fired = true;
    fs.renameSync(target, saved);
    const child = spawnSync("mkfifo", [target], {
      encoding: "utf8",
      timeout: 1000,
    });
    assert.equal(child.status, 0, child.stderr);
    actualFifo = fs.lstatSync(target).isFIFO();
    assert.equal(actualFifo, true);
  };
if (mode === "symlink") {
  fs.renameSync(target, saved);
  fs.symlinkSync(path.join(root, "missing-target"), target);
  fired = true;
}
if (mode === "ending-mode")
  value.io.afterRead = (_fd, count) => {
    if (fired || count !== 0) return;
    fired = true;
    fs.chmodSync(value.ledger.rootDir, 0o710);
    changedMode = true;
  };
let result;
try {
  result = branch === "cached" ? value.ledger.verify() : value.open();
} catch (cause) {
  error = cause;
}
value.io.armed = false;
if (savedDirectory !== null) {
  fs.unlinkSync(value.ledger.segmentDir);
  fs.renameSync(savedDirectory, value.ledger.segmentDir);
}
if (changedMode) fs.chmodSync(value.ledger.rootDir, 0o700);
if (fs.existsSync(saved)) {
  fs.unlinkSync(target);
  fs.renameSync(saved, target);
}
const restored = fs.readFileSync(target);
const out = {
  branch,
  mode,
  code: error?.code,
  message: error?.message,
  fired,
  actualFifo,
  directoryFlags,
  originalDigest: journalDigest(original),
  preservedDigest: journalDigest(restored),
  preservedInode: fs.lstatSync(target, { bigint: true }).ino === originalInode,
  opens: value.io.opens.length,
  actualReadBytes: value.io.reads.reduce((sum, read) => sum + read.count, 0),
  expectedSize: original.length,
  rawReads: value.io.rawReads,
  liveDescriptors: value.io.live.size,
  requestsWithinChunk: value.io.reads.every((read) => read.requested <= 65536),
  eofProbe: value.io.reads.at(-1),
  nonblocking: value.io.opens.every(
    (entry) =>
      (entry.flags & (fs.constants.O_NONBLOCK || 0)) ===
      (fs.constants.O_NONBLOCK || 0),
  ),
  authenticatedSequence: error
    ? null
    : branch === "cached"
      ? result.sequence
      : result.verify().sequence,
  fullPhysicalStorageGraphVerified: false,
  grantsMutationOrPromotionAuthority: false,
};
assert.equal(out.preservedDigest, out.originalDigest);
assert.equal(out.preservedInode, true);
assert.equal(out.liveDescriptors, 0);
assert.equal(out.rawReads, 0);
process.stdout.write(`${JSON.stringify(out)}\n`);
process.exitCode = error ? 2 : 0;
