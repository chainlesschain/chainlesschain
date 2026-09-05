import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL("./helpers/knowledge-skill-rollback-process.mjs", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function run(
  root,
  mode,
  crashPoint = "none",
  status = 0,
  provenance = "direct",
  dependencies = "active",
) {
  const child = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=256",
      worker,
      root,
      mode,
      crashPoint,
      provenance,
      dependencies,
    ],
    {
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  expect(
    child.status,
    child.error?.message || child.stderr || child.stdout,
  ).toBe(status);
  return status === 0 ? JSON.parse(child.stdout) : null;
}

describe("Knowledge revocation real Skill process recovery", () => {
  it.each([
    ["before-dependency-settlement", 96, "wiki"],
    ["after-dependency-settlement", 97, "wiki"],
    ["before-dependency-settlement", 96, "all"],
    ["after-dependency-settlement", 97, "all"],
  ])(
    "recovers actual Wiki tombstones at %s (%s, %s)",
    (crashPoint, status, dependencies) => {
      const root = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), "cc-knowledge-wiki-process-"),
      );
      roots.push(root);
      const seeded = run(root, "seed", "none", 0, "wiki", dependencies);
      expect(seeded.wikiRevisions).toBe(2);
      run(root, "execute", crashPoint, status, "wiki", dependencies);
      const interrupted = run(root, "inspect", "none", 0, "wiki", dependencies);
      expect(interrupted).toMatchObject({
        prepared: 1,
        settled: status === 97 ? 1 : 0,
        published: 0,
        wikiStatus: "tombstoned",
        wikiRevisions: 3,
      });
      const recovered = run(root, "execute", "none", 0, "wiki", dependencies);
      expect(recovered.pid).not.toBe(interrupted.pid);
      expect(recovered).toMatchObject({
        prepared: 1,
        settled: 1,
        published: 1,
        wikiStatus: "tombstoned",
        wikiRevisions: 3,
        wikiStateDigest: interrupted.wikiStateDigest,
        dependencyResultCount: dependencies === "all" ? 3 : 1,
        revision: dependencies === "all" ? 3 : 2,
        activeReleaseDigest:
          dependencies === "all"
            ? seeded.baselineReleaseDigest
            : seeded.candidateReleaseDigest,
        knowledge: { action: "revoke" },
      });
      const verified = run(root, "inspect", "none", 0, "wiki", dependencies);
      expect(verified.pid).not.toBe(recovered.pid);
      expect({ ...verified, pid: null }).toEqual({ ...recovered, pid: null });
    },
    300_000,
  );

  it.each([
    ["after-release-pointer", 95, "direct", "active"],
    ["before-dependency-settlement", 96, "direct", "active"],
    ["after-dependency-settlement", 97, "direct", "active"],
    ["after-release-pointer", 95, "wiki", "active"],
    ["before-dependency-settlement", 96, "wiki", "active"],
    ["after-dependency-settlement", 97, "wiki", "active"],
    ["after-release-pointer", 95, "direct", "combined"],
    ["before-dependency-settlement", 96, "direct", "combined"],
    ["after-dependency-settlement", 97, "direct", "combined"],
    ["after-release-pointer", 95, "wiki", "combined"],
    ["before-dependency-settlement", 96, "wiki", "combined"],
    ["after-dependency-settlement", 97, "wiki", "combined"],
  ])(
    "recovers %s (%s, %s, %s) without a second rollback",
    (crashPoint, status, provenance, dependencies) => {
      const root = fs.mkdtempSync(
        path.join(
          fs.realpathSync(os.tmpdir()),
          "cc-knowledge-rollback-process-",
        ),
      );
      roots.push(root);
      const seeded = run(root, "seed", "none", 0, provenance, dependencies);
      expect(seeded.revision).toBe(2);
      expect(seeded.activeReleaseDigest).toBe(seeded.candidateReleaseDigest);
      const started = Date.now();
      run(root, "execute", crashPoint, status, provenance, dependencies);
      const recovered = run(
        root,
        "execute",
        "none",
        0,
        provenance,
        dependencies,
      );
      expect(recovered.pid).not.toBe(seeded.pid);
      expect(recovered).toMatchObject({
        revision: 3,
        prepared: 1,
        settled: 1,
        published: 1,
        knowledge: { action: "revoke" },
      });
      expect(recovered.activeReleaseDigest).toBe(seeded.baselineReleaseDigest);
      if (dependencies === "combined")
        expect(recovered.dependencyResultCount).toBe(2);
      expect(recovered.transitions).toHaveLength(3);
      expect(
        recovered.transitions.filter((item) => item.operation === "rollback"),
      ).toHaveLength(1);
      const verified = run(
        root,
        "inspect",
        "none",
        0,
        provenance,
        dependencies,
      );
      expect(verified.pid).not.toBe(recovered.pid);
      expect({ ...verified, pid: null }).toEqual({ ...recovered, pid: null });
      process.stdout.write(
        `Knowledge ${provenance} ${dependencies} rollback ${crashPoint}: ${Date.now() - started}ms\n`,
      );
    },
    300_000,
  );
});
