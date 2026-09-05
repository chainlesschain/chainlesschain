import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL("./helpers/wiki-pruning-dependencies-process.mjs", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function run(root, mode, crashPoint = "none", exitCode = 0) {
  const child = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", worker, root, mode, crashPoint],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  expect(child.status, child.error?.message || child.stderr).toBe(exitCode);
  return exitCode === 0 ? JSON.parse(child.stdout) : null;
}

describe("Wiki dependency pruning real process recovery", () => {
  it.each([
    ["dependency-commit", 93],
    ["dependency-checkpoint", 94],
  ])(
    "recovers %s up to the explicit KMS boundary",
    (crashPoint, exitCode) => {
      const root = fs.mkdtempSync(
        path.join(
          fs.realpathSync(os.tmpdir()),
          "cc-pruning-dependency-process-",
        ),
      );
      roots.push(root);
      expect(run(root, "seed")).toMatchObject({
        wikiRevision: 1,
        journalRevision: 0,
      });
      const started = Date.now();
      run(root, "execute", crashPoint, exitCode);
      const recovered = run(root, "execute");
      const elapsedMs = Date.now() - started;
      expect(elapsedMs).toBeLessThan(60_000);
      expect(recovered).toMatchObject({
        phase: "running",
        journalRevision: 3,
        operationCount: 2,
        wikiRevision: 3,
        maintenanceRequestCount: 2,
        ledgerSequence: 7,
        patternStatuses: ["tombstoned"],
        dependencyReceipt: {
          mode: "revisions",
          revisions: [expect.any(Object)],
        },
        wikiReceipt: { mode: "revisions", revisions: [expect.any(Object)] },
      });
      expect(recovered.wikiReceipt.sourceStateDigest).toBe(
        recovered.dependencyReceipt.resultStateDigest,
      );
      expect(run(root, "execute")).toEqual(recovered);
      process.stdout.write(`Wiki dependency ${crashPoint}: ${elapsedMs}ms\n`);
    },
    150_000,
  );
});
