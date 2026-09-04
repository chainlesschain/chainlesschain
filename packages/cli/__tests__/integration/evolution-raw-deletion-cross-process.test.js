import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const WORKER = fileURLToPath(
  new URL(
    "./helpers/evolution-raw-deletion-cross-process-worker.mjs",
    import.meta.url,
  ),
);
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function run(root, operation) {
  return spawnSync(process.execPath, [WORKER, root, operation], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    encoding: "utf8",
    timeout: 25_000,
  });
}

function output(result) {
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe("Raw deletion ArtifactStore/Ledger cross-process recovery", () => {
  it("reopens an authenticated receipt and crypto-shred tombstone within 60 seconds", () => {
    const startedAt = Date.now();
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-raw-delete-process-"),
    );
    roots.push(root);

    expect(output(run(root, "shred"))).toMatchObject({
      ok: true,
      sequence: 2,
      result: { authenticated: true, durable: true },
    });
    expect(output(run(root, "verify"))).toEqual({
      ok: true,
      recovered: true,
      sequence: 2,
    });
    expect(Date.now() - startedAt).toBeLessThan(60_000);
  }, 60_000);
});
