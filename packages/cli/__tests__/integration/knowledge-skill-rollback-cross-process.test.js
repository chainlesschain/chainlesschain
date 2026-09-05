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
function run(root, mode, crashPoint = "none", status = 0) {
  const child = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", worker, root, mode, crashPoint],
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
    ["after-release-pointer", 95],
    ["before-dependency-settlement", 96],
    ["after-dependency-settlement", 97],
  ])(
    "recovers %s without a second rollback",
    (crashPoint, status) => {
      const root = fs.mkdtempSync(
        path.join(
          fs.realpathSync(os.tmpdir()),
          "cc-knowledge-rollback-process-",
        ),
      );
      roots.push(root);
      const seeded = run(root, "seed");
      expect(seeded.revision).toBe(2);
      expect(seeded.activeReleaseDigest).toBe(seeded.candidateReleaseDigest);
      const started = Date.now();
      run(root, "execute", crashPoint, status);
      const recovered = run(root, "execute");
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
      const verified = run(root, "inspect");
      expect(verified.pid).not.toBe(recovered.pid);
      expect({ ...verified, pid: null }).toEqual({ ...recovered, pid: null });
      process.stdout.write(
        `Knowledge rollback ${crashPoint}: ${Date.now() - started}ms\n`,
      );
    },
    300_000,
  );
});
