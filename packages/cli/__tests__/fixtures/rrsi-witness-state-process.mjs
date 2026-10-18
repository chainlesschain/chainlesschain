// TEST ONLY: actual local HMAC witness I/O, never production trust or WORM.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  createWitnessBoundaryIo,
  openWitnessBoundaryFixture,
  witnessBoundaryDigest,
} from "./evolution-witness-boundary.js";

let fixture,
  tracking,
  fired = false,
  moved = false,
  copied = false,
  modeChanged = false;
let originalBytes,
  originalLeafInode,
  originalDirectoryInode,
  directory,
  target,
  saved;
const root = path.resolve(process.argv[2]),
  kind = process.argv[3],
  mode = process.argv[4];
function metrics() {
  let inspection;
  try {
    const preserved = moved
      ? path.join(root, "saved-directory", path.basename(target))
      : fired && ["fifo", "symlink", "prepare-swap"].includes(mode)
        ? saved
        : target;
    inspection = {
      preservedDigest: witnessBoundaryDigest(fs.readFileSync(preserved)),
      preservedLeafInode: fs
        .lstatSync(preserved, { bigint: true })
        .ino.toString(),
      currentDirectoryInode: fs
        .lstatSync(directory, { bigint: true })
        .ino.toString(),
      currentDirectoryMode: fs.lstatSync(directory).mode & 0o777,
      leafMode:
        fs.existsSync(target) && !fs.lstatSync(target).isFIFO()
          ? fs.lstatSync(target).mode & 0o777
          : null,
      actualFifo: mode === "fifo" && fs.lstatSync(target).isFIFO(),
      actualDanglingSymlink:
        mode === "symlink" &&
        fs.lstatSync(target).isSymbolicLink() &&
        !fs.existsSync(target),
    };
  } catch (error) {
    inspection = {
      inspectionError: { code: error.code, message: error.message },
    };
  }
  return {
    kind,
    mode,
    fired,
    directoryMoved: moved,
    directoryCopied: copied,
    directoryModeChanged: modeChanged,
    opens: tracking?.io.opens.length,
    rawReads: tracking?.io.rawReads,
    actualReadBytes: tracking?.io.reads.reduce(
      (sum, entry) => sum + entry.count,
      0,
    ),
    requestsWithinChunk: tracking?.io.reads.every(
      (entry) => entry.requested <= 65536,
    ),
    eofProbe: tracking?.io.reads.at(-1),
    liveDescriptors: tracking?.io.live.size,
    expectedSize: originalBytes?.length,
    originalDigest: originalBytes ? witnessBoundaryDigest(originalBytes) : null,
    originalLeafInode,
    originalDirectoryInode,
    ...inspection,
  };
}
try {
  const temp = fs.realpathSync.native(os.tmpdir());
  if (
    path.dirname(root) !== temp ||
    !path.basename(root).startsWith("cc-witness-state-process-") ||
    !["head", "segment"].includes(kind) ||
    ![
      "read",
      "fifo",
      "symlink",
      "directory-mode",
      "directory",
      "prepare-mode",
      "prepare-swap",
    ].includes(mode)
  )
    throw new Error("unsafe witness child path or mode");
  if (mode !== "read" && process.platform === "win32")
    throw new Error("POSIX mutation probe required");
  tracking = createWitnessBoundaryIo();
  fixture = openWitnessBoundaryFixture(root, {
    segmented: kind === "segment",
    reopenOnly: process.argv[5] === "existing",
    fsImpl: tracking.fsImpl,
  });
  target = kind === "head" ? fixture.file : fixture.segmentFiles[0];
  directory = path.dirname(target);
  saved = path.join(root, "saved-state");
  originalBytes = fs.readFileSync(target);
  originalLeafInode = fs.lstatSync(target, { bigint: true }).ino.toString();
  originalDirectoryInode = fs
    .lstatSync(directory, { bigint: true })
    .ino.toString();
  if (mode.startsWith("prepare-")) fs.chmodSync(target, 0o640);
  if (mode === "symlink") {
    fired = true;
    fs.renameSync(target, saved);
    fs.symlinkSync(path.join(root, "missing-target"), target);
  }
  tracking.arm(target);
  tracking.io.beforeOpen = () => {
    if (mode !== "fifo" || fired) return;
    fired = true;
    fs.renameSync(target, saved);
    const response = spawnSync("mkfifo", [target], {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
    });
    if (response.error || response.status !== 0)
      throw new Error(
        `FIFO creation failed: ${response.error?.message || response.stderr}`,
      );
  };
  tracking.io.stat = (stat, source, name) => {
    if (
      !fired &&
      ["directory", "directory-mode"].includes(mode) &&
      source === "path" &&
      name === target &&
      tracking.io.fstats === 2
    ) {
      fired = true;
      if (mode === "directory-mode") {
        fs.chmodSync(directory, 0o710);
        modeChanged = true;
      } else {
        fs.renameSync(directory, path.join(root, "saved-directory"));
        moved = true;
        fs.cpSync(path.join(root, "saved-directory"), directory, {
          recursive: true,
        });
        copied = true;
      }
    }
    return stat;
  };
  if (mode === "prepare-swap")
    tracking.fsImpl.chmodSync = (name, permissions) => {
      fs.chmodSync(name, permissions);
      if (!fired && name === target) {
        fired = true;
        fs.renameSync(target, saved);
        fs.writeFileSync(target, originalBytes, { mode: 0o600 });
      }
    };
  const result = fixture.witness.read();
  process.stdout.write(
    JSON.stringify({
      ...metrics(),
      payloadMatched: isDeepStrictEqual(result, fixture.current),
      fullPhysicalStorageGraphVerified: false,
      grantsMutationOrPromotionAuthority: false,
    }),
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      code: error.code,
      message: error.message,
      causeCode: error.cause?.code,
      ...metrics(),
    }),
  );
  process.exitCode = 2;
}
