import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
const helper = fileURLToPath(
  new URL(
    "./helpers/knowledge-candidate-admission-process.mjs",
    import.meta.url,
  ),
);
function run(
  root,
  mode,
  status = 0,
  identity = "original",
  provenance = "direct",
) {
  const result = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", helper, root, mode, identity, provenance],
    {
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(status);
  return status === 0 ? JSON.parse(result.stdout) : null;
}
it("keeps the admission fence across a process exit immediately after durable revocation preparation", () => {
  const root = fs.mkdtempSync(
    path.join(
      fs.realpathSync.native(os.tmpdir()),
      "cc-candidate-admission-process-",
    ),
  );
  roots.push(root);
  const seed = run(root, "seed");
  run(root, "prepare", 98);
  const rejected = run(root, "promote");
  const again = run(root, "promote");
  for (const result of [rejected, again]) {
    expect(result).toMatchObject({
      active: seed.baseline,
      revision: 3,
      transitions: 3,
      prepared: 1,
      settled: 0,
      published: 0,
    });
    expect(result.errors).toContain("CC_EVOLUTION_LEDGER_CANDIDATE_REVOKED");
  }
  expect(new Set([seed.pid, rejected.pid, again.pid]).size).toBe(3);
}, 300_000);

it.each(["direct", "wiki"])(
  "blocks new %s-derived identities in two fresh processes after a revocation crash",
  (provenance) => {
    const root = fs.mkdtempSync(
      path.join(
        fs.realpathSync.native(os.tmpdir()),
        "cc-source-admission-process-",
      ),
    );
    roots.push(root);
    const worker = (mode, status = 0) =>
      run(root, mode, status, "derived", provenance);
    const seed = worker("seed");
    worker("prepare", 98);
    const rejected = worker("promote");
    const again = worker("promote");
    for (const result of [rejected, again]) {
      expect(result).toMatchObject({
        active: seed.baseline,
        revision: 3,
        transitions: 3,
        prepared: 1,
        settled: 0,
        published: 0,
      });
      expect(result.errors).toContain("CC_EVOLUTION_LEDGER_SOURCE_REVOKED");
      expect(result.candidateId).not.toBe(result.originalCandidateId);
    }
    expect(rejected.candidateId).not.toBe(again.candidateId);
    expect(new Set([seed.pid, rejected.pid, again.pid]).size).toBe(3);
  },
  300_000,
);
