// TEST ONLY: three actual FIFO leaf-open phases of genuine signed artifact reads.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { captureEvolutionArtifactStoreDirectoryBoundary } from "../../src/lib/evolution/evolution-artifact-ports.js";
import { openArtifactByteFixture } from "./evolution-artifact-bytes.js";

let fired = false,
  opens = 0,
  rawReads = 0,
  actualReadBytes = 0;
let injectedPhase = null;
try {
  const directory = path.resolve(process.argv[2]),
    phase = Number(process.argv[3] || 0);
  const root = path.dirname(directory);
  if (
    path.dirname(root) !== fs.realpathSync.native(os.tmpdir()) ||
    !path.basename(root).startsWith("cc-rrsi-artifact-bytes-process-") ||
    path.basename(directory) !== "artifacts" ||
    ![0, 1, 2, 3].includes(phase)
  )
    throw new Error("unsafe artifact bytes process fixture");
  const fixture = openArtifactByteFixture(directory);
  const target = fixture.target;
  if (!target.startsWith(path.join(directory, "files") + path.sep))
    throw new Error("unsafe artifact FIFO target");
  fs.chmodSync(target, 0o600);
  const originalOpen = fs.openSync,
    originalWholeRead = fs.readFileSync,
    originalRead = fs.readSync,
    originalClose = fs.closeSync;
  const live = new Set();
  fs.openSync = (value, flags, ...args) => {
    const isArtifact =
      value === target &&
      typeof flags === "number" &&
      !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR));
    if (isArtifact) {
      opens += 1;
      if (opens === phase) {
        if (process.platform === "win32")
          throw new Error("POSIX FIFO model only");
        fired = true;
        injectedPhase = opens;
        fs.renameSync(target, path.join(root, "saved-artifact"));
        const created = spawnSync("mkfifo", [target], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
        });
        if (created.error || created.status !== 0)
          throw new Error(
            `FIFO setup failed: ${created.error?.message || created.stderr}`,
          );
      }
    }
    const fd = originalOpen(value, flags, ...args);
    if (isArtifact) live.add(fd);
    return fd;
  };
  fs.readFileSync = (value, ...args) => {
    if (value === target || live.has(value)) rawReads += 1;
    return originalWholeRead(value, ...args);
  };
  fs.readSync = (fd, ...args) => {
    const count = originalRead(fd, ...args);
    if (live.has(fd)) actualReadBytes += count;
    return count;
  };
  fs.closeSync = (fd) => {
    live.delete(fd);
    return originalClose(fd);
  };
  try {
    const result = fixture.read();
    process.stdout.write(
      JSON.stringify({
        authenticated: result.authenticated,
        found: result.found,
        opens,
        expectedSize: fixture.entry.size,
        actualReadBytes,
        rawReads,
        liveArtifactDescriptors: live.size,
        descriptor: captureEvolutionArtifactStoreDirectoryBoundary(
          fixture.ports,
        ).descriptor,
      }),
    );
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        code: error.code,
        message: error.message,
        causeCode: error.cause?.code,
        faultInjected: fired,
        injectedPhase,
        opens,
        rawReads,
        actualReadBytes,
        expectedSize: fixture.entry.size,
        liveArtifactDescriptors: live.size,
        actualFifoVerified: fired && fs.lstatSync(target).isFIFO(),
      }),
    );
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      code: error.code,
      message: error.message,
      faultInjected: fired,
      injectedPhase,
      opens,
      rawReads,
    }),
  );
  process.exitCode = 2;
}
