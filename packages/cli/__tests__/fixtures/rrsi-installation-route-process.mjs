// TEST ONLY: fresh-process declaration readback, without any trusted host root.
import { openRrsiInstallationRouteSnapshot } from "../../src/lib/evolution/rrsi-installation-route-reader.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
let fired = false;
try {
  const selected = JSON.parse(process.argv[2]),
    mode = process.argv[3];
  if (mode === "fifo-file" || mode === "fifo-parent") {
    if (process.platform === "win32")
      throw new Error("POSIX FIFO fault model only");
    const parent = path.dirname(selected.directory);
    if (
      path.dirname(parent) !== fs.realpathSync.native(os.tmpdir()) ||
      !path.basename(parent).startsWith("cc-rrsi-route-process-") ||
      path.basename(selected.directory) !== "snapshot"
    )
      throw new Error("unsafe FIFO fixture target");
    const target =
      mode === "fifo-file"
        ? path.join(selected.directory, "root.json")
        : selected.directory;
    const originalOpen = fs.openSync;
    fs.openSync = (value, ...args) => {
      if (!fired && value === target) {
        fired = true;
        fs.renameSync(target, path.join(parent, "fifo-saved"));
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
      return originalOpen(value, ...args);
    };
  }
  const reader = openRrsiInstallationRouteSnapshot(selected);
  process.stdout.write(JSON.stringify(reader.read()));
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
