import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL("./helpers/wiki-pruning-full-chain-process.mjs", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function run(root, mode, crash = "none", status = 0) {
  const child = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", worker, root, mode, crash],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  expect(child.status, child.error?.message || child.stderr).toBe(status);
  return status === 0 ? JSON.parse(child.stdout) : null;
}

describe("complete pruning real process recovery", () => {
  it.each([
    ["release-pointer", 95],
    ["dependency-commit", 99],
    ["key-unlink", 96],
    ["raw-tombstone", 97],
    ["raw-checkpoint", 98],
    ["projection-checkpoint", 90],
  ])(
    "recovers %s across actual release/key/Wiki/retrieval effects",
    (crash, status) => {
      const root = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), "cc-pruning-full-process-"),
      );
      roots.push(root);
      const seeded = run(root, "seed");
      expect(seeded.snapshot.decryptable).toBe(true);
      const started = Date.now();
      run(root, "execute", crash, status);
      const resumed = run(root, "execute");
      const elapsedMs = Date.now() - started;
      expect(elapsedMs).toBeLessThan(60_000);
      expect(resumed.pid).not.toBe(seeded.pid);
      expect(resumed.snapshot).toMatchObject({
        phase: "finalized",
        operationCount: 4,
        wikiRevision: 5,
        maintenanceRequestCount: 2,
        decryptable: false,
        kms: { keyAvailable: false },
      });
      expect(resumed.snapshot.activeRelease).toEqual(resumed.snapshot.baseline);
      expect(resumed.snapshot.activeState.revision).toBe(3);
      expect(resumed.snapshot.releaseTransitions).toHaveLength(3);
      const again = run(root, "execute");
      expect(again.pid).not.toBe(resumed.pid);
      expect(again.snapshot).toEqual(resumed.snapshot);
      process.stdout.write(`Pruning full chain ${crash}: ${elapsedMs}ms\n`);
    },
    180_000,
  );
});
