import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL("./helpers/knowledge-skill-rollback-process.mjs", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function run(root, mode, provenance, crashPoint = "none", status = 0) {
  const child = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=256",
      worker,
      root,
      mode,
      crashPoint,
      provenance,
      "quarantine",
    ],
    {
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, child.stderr || child.stdout).toBe(status);
  return status === 0 ? JSON.parse(child.stdout) : null;
}
it.each([
  ["after-dependency-prepare", 98, "direct"],
  ["before-dependency-settlement", 96, "direct"],
  ["after-dependency-settlement", 97, "direct"],
  ["after-dependency-prepare", 98, "wiki"],
  ["before-dependency-settlement", 96, "wiki"],
  ["after-dependency-settlement", 97, "wiki"],
])(
  "recovers candidate quarantine at %s (%s, %s) without duplicate rollback or settlement",
  (crashPoint, status, provenance) => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-quarantine-process-"),
    );
    roots.push(root);
    const seeded = run(root, "seed", provenance);
    run(root, "execute", provenance, crashPoint, status);
    const recovered = run(root, "execute", provenance);
    expect(recovered.pid).not.toBe(seeded.pid);
    expect(recovered).toMatchObject({
      prepared: 1,
      settled: 1,
      published: 1,
      revision: 3,
      activeReleaseDigest: seeded.baselineReleaseDigest,
      dependencyResultCount: 2,
      dependencyDispositions: ["rollback-active", "quarantine"],
      knowledge: { action: "revoke" },
    });
    expect(recovered.knowledge.dependencies).toContainEqual(
      expect.objectContaining({ kind: "candidate", disposition: "quarantine" }),
    );
    expect(recovered.transitions).toHaveLength(3);
    expect(
      recovered.transitions.filter((item) => item.operation === "rollback"),
    ).toHaveLength(1);
    const verified = run(root, "inspect", provenance);
    expect(verified.pid).not.toBe(recovered.pid);
    expect({ ...verified, pid: null }).toEqual({ ...recovered, pid: null });
  },
  300_000,
);
