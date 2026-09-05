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
) {
  const child = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", worker, root, mode, crashPoint, provenance],
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
    ["after-release-pointer", 95, "direct"],
    ["before-dependency-settlement", 96, "direct"],
    ["after-dependency-settlement", 97, "direct"],
    ["after-release-pointer", 95, "wiki"],
    ["before-dependency-settlement", 96, "wiki"],
    ["after-dependency-settlement", 97, "wiki"],
  ])(
    "recovers %s (%s, %s) without a second rollback",
    (crashPoint, status, provenance = "direct") => {
      const root = fs.mkdtempSync(
        path.join(
          fs.realpathSync(os.tmpdir()),
          "cc-knowledge-rollback-process-",
        ),
      );
      roots.push(root);
      const seeded = run(root, "seed", "none", 0, provenance);
      expect(seeded.revision).toBe(2);
      expect(seeded.activeReleaseDigest).toBe(seeded.candidateReleaseDigest);
      const started = Date.now();
      run(root, "execute", crashPoint, status, provenance);
      const recovered = run(root, "execute", "none", 0, provenance);
      expect(recovered.pid).not.toBe(seeded.pid);
      expect(recovered).toMatchObject({
        revision: 3,
        prepared: 1,
        settled: 1,
        published: 1,
        knowledge: { action: "revoke" },
      });
      expect(recovered.activeReleaseDigest).toBe(seeded.baselineReleaseDigest);
      expect(recovered.transitions).toHaveLength(3);
      expect(
        recovered.transitions.filter((item) => item.operation === "rollback"),
      ).toHaveLength(1);
      const verified = run(root, "inspect", "none", 0, provenance);
      expect(verified.pid).not.toBe(recovered.pid);
      expect({ ...verified, pid: null }).toEqual({ ...recovered, pid: null });
      process.stdout.write(
        `Knowledge ${provenance} rollback ${crashPoint}: ${Date.now() - started}ms\n`,
      );
    },
    300_000,
  );
});
