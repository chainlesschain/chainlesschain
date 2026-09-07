import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
const worker = fileURLToPath(
  new URL(
    "./helpers/evolution-workbench-rollback-process.mjs",
    import.meta.url,
  ),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function run(root, mode, phase) {
  const child = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", worker, root, mode, phase],
    {
      encoding: "utf8",
      // Windows ACL/file operations can exceed 90s on loaded hosted runners.
      // Keep process recovery bounded without changing any checkpoint assertion.
      timeout: process.platform === "win32" ? 180_000 : 90_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  expect(child.error, child.stderr).toBeUndefined();
  if (mode === "seed") {
    expect(child.status, child.stderr).not.toBe(0);
    const output = JSON.parse(child.stdout);
    expect(output.checkpoint).toBe(phase);
    return output;
  }
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout);
}
describe("Workbench rollback real process recovery", () => {
  it.each(["prepared", "after-lease", "after-pointer", "applied", "committed"])(
    "recovers after SIGKILL at %s without repeating the Registry mutation",
    (phase) => {
      const needsMutation = ["prepared", "after-lease"].includes(phase);
      const root = fs.mkdtempSync(
        path.join(
          fs.realpathSync.native(os.tmpdir()),
          "cc-workbench-rollback-process-",
        ),
      );
      roots.push(root);
      const killed = run(root, "seed", phase);
      // Opening the actual Registry also reconciles its own unfinished journal;
      // the Workbench must recover from that evidence, not from the kill marker.
      const before = run(root, "startup", phase);
      expect(before).toMatchObject({
        prepared: 1,
        committed: needsMutation ? 0 : 1,
        revision: needsMutation ? 2 : 3,
        releaseFinalizations: needsMutation ? 2 : 3,
        workbenchActiveReleaseDigest: needsMutation
          ? before.candidateReleaseDigest
          : before.baselineReleaseDigest,
        asks: 0,
        mutations: 0,
        startupRecovery: {
          reviewsSettled: 0,
          reviewPreparationsDeferred: 0,
          rollbacksSettled: !needsMutation && phase !== "committed" ? 1 : 0,
          rollbackPlansDeferred: needsMutation ? 1 : 0,
        },
      });
      const recovered = run(root, "resume", phase);
      expect(recovered.pid).not.toBe(killed.pid);
      expect(recovered).toMatchObject({
        prepared: 1,
        committed: 1,
        revision: 3,
        releaseFinalizations: 3,
        asks: 0,
        mutations: needsMutation ? 1 : 0,
        resumed: needsMutation ? 1 : 0,
        contentDigest: recovered.baselineContentDigest,
        dependencyLockDigest: recovered.baselineLockDigest,
        workbenchActiveReleaseDigest: recovered.baselineReleaseDigest,
        workbenchLastKnownGoodReleaseDigest: recovered.baselineReleaseDigest,
        historicalRunActiveReleaseDigest: recovered.candidateReleaseDigest,
        registryOperationCount: 3,
      });
      const repeated = run(root, "resume", phase);
      expect(repeated.pid).not.toBe(recovered.pid);
      expect(repeated).toMatchObject({
        sequence: recovered.sequence,
        revision: 3,
        releaseFinalizations: 3,
        prepared: 1,
        committed: 1,
        resumed: 0,
        asks: 0,
        mutations: 0,
        contentDigest: recovered.contentDigest,
        dependencyLockDigest: recovered.dependencyLockDigest,
        workbenchActiveReleaseDigest: recovered.baselineReleaseDigest,
      });
    },
    process.platform === "win32" ? 600_000 : 300_000,
  );
});
