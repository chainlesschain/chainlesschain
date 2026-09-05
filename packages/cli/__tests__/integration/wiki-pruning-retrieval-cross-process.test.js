import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL("./helpers/wiki-pruning-retrieval-process.mjs", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function run(root, mode, fault = "none", expectedCode = 0) {
  const result = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", worker, root, mode, fault],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  expect(result.status, result.error?.message || result.stderr).toBe(
    expectedCode,
  );
  return expectedCode === 0 ? JSON.parse(result.stdout) : null;
}
describe("real Wiki pruning retrieval process recovery", () => {
  it.each([
    ["projection-commit", 93],
    ["projection-checkpoint", 94],
  ])(
    "recovers %s with no duplicate publication",
    (fault, exitCode) => {
      const root = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), "cc-retrieval-process-"),
      );
      roots.push(root);
      expect(run(root, "seed")).toMatchObject({
        wikiRevision: 1,
        journalRevision: 0,
      });
      const started = Date.now();
      run(root, "execute", fault, exitCode);
      const resumed = run(root, "execute");
      const elapsedMs = Date.now() - started;
      process.stdout.write(`Wiki retrieval ${fault}: ${elapsedMs}ms\n`);
      expect(elapsedMs).toBeLessThan(60_000);
      expect(resumed).toMatchObject({
        phase: "finalized",
        journalRevision: 5,
        wikiRevision: 2,
        operationCount: 3,
        ledgerSequence: 8,
        maintenanceRequestCount: 1,
        patternStatuses: ["tombstoned"],
        retrievalReceipt: { authenticated: true, durable: true },
      });
      expect(run(root, "execute")).toEqual(resumed);
    },
    150_000,
  );
});
