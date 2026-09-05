import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL("./helpers/wiki-pruning-maintenance-process.mjs", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function run(root, mode, crash = "none") {
  return spawnSync(
    process.execPath,
    ["--max-old-space-size=256", worker, root, mode, crash],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
}
function result(processResult, expectedCode = 0) {
  expect(
    processResult.status,
    processResult.error?.message || processResult.stderr,
  ).toBe(expectedCode);
  return expectedCode === 0 ? JSON.parse(processResult.stdout) : null;
}

describe("Wiki pruning maintenance real process recovery", () => {
  it.each([
    ["wiki-commit", 91],
    ["wiki-checkpoint", 92],
  ])(
    "recovers %s without duplicate Wiki effects",
    (crashPoint, exitCode) => {
      const root = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), "cc-pruning-process-"),
      );
      roots.push(root);
      expect(result(run(root, "seed"))).toMatchObject({
        wikiRevision: 1,
        journalRevision: 0,
      });
      const started = Date.now();
      result(run(root, "execute", crashPoint), exitCode);
      const resumed = result(run(root, "execute"));
      const elapsedMs = Date.now() - started;
      expect(elapsedMs).toBeLessThan(60_000);
      expect(resumed).toMatchObject({
        phase: "finalized",
        journalRevision: 5,
        operationCount: 3,
        wikiRevision: 2,
        maintenanceRequestCount: 1,
        ledgerSequence: 7,
        patternStatuses: ["tombstoned"],
        wikiReceipt: { mode: "revisions", revisions: [expect.any(Object)] },
      });
      expect(result(run(root, "execute"))).toEqual(resumed);
      process.stdout.write(`Wiki pruning ${crashPoint}: ${elapsedMs}ms\n`);
    },
    150_000,
  );
});
