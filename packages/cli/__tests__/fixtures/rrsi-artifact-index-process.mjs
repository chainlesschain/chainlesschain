// TEST ONLY: genuine ports and actual POSIX FIFO races under a bounded child.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  captureEvolutionArtifactStoreDirectoryBoundary,
  captureEvolutionLedgerBatchResolver,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { openArtifactDirectoryPorts } from "./rrsi-artifact-directory.js";

let fired = false;
try {
  const directory = path.resolve(process.argv[2]),
    mode = process.argv[3];
  const root = path.dirname(directory);
  if (
    path.dirname(root) !== fs.realpathSync.native(os.tmpdir()) ||
    !path.basename(root).startsWith("cc-rrsi-artifact-index-process-") ||
    path.basename(directory) !== "artifacts"
  )
    throw new Error("unsafe artifact index process fixture");
  const target = path.join(directory, "index.jsonl");
  function installFault() {
    if (process.platform === "win32") throw new Error("POSIX FIFO model only");
    const originalOpen = fs.openSync;
    fs.openSync = (value, flags, ...args) => {
      if (
        !fired &&
        value === target &&
        typeof flags === "number" &&
        !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR))
      ) {
        fired = true;
        fs.renameSync(target, path.join(root, "saved-index"));
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
      return originalOpen(value, flags, ...args);
    };
  }
  if (mode === "fifo-constructor") installFault();
  const { ports } = openArtifactDirectoryPorts(directory);
  if (mode === "fifo-snapshot") installFault();
  const batch = captureEvolutionLedgerBatchResolver(
    ports.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger",
    }),
  );
  const result = batch([]);
  process.stdout.write(
    JSON.stringify({
      result,
      descriptor:
        captureEvolutionArtifactStoreDirectoryBoundary(ports).descriptor,
    }),
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      code: error.code,
      message: error.message,
      causeCode: error.cause?.code,
      faultInjected: fired,
    }),
  );
  process.exitCode = 2;
}
