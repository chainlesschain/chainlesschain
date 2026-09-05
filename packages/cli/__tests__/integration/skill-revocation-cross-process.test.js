import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const WORKER = fileURLToPath(
  new URL(
    "./helpers/skill-revocation-cross-process-worker.mjs",
    import.meta.url,
  ),
);
const roots = [];
const read = (root, name) =>
  JSON.parse(readFileSync(join(root, `${name}.json`), "utf8"));
function run(root, operation, crashPoint) {
  return spawnSync(process.execPath, [WORKER, root, operation, crashPoint], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    encoding: "utf8",
    timeout: 20_000,
  });
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Skill revocation real cross-process recovery", () => {
  it("recovers Wiki commit and dependency/checkpoint settlement kills within 60 seconds", () => {
    const startedAt = Date.now();

    const wikiRoot = mkdtempSync(join(tmpdir(), "cc-revoke-wiki-"));
    roots.push(wikiRoot);
    expect(run(wikiRoot, "wiki", "after-wiki-commit").status).toBe(92);
    expect(run(wikiRoot, "wiki", "none").status).toBe(0);
    expect(read(wikiRoot, "wiki").patterns["pat-safe-refactor"]).toMatchObject({
      status: "stale",
      actionable: false,
    });
    expect(read(wikiRoot, "wiki").skillImpact["safe-refactor"]).toMatchObject({
      rejected: 1,
    });

    for (const crashPoint of [
      "after-dependencies",
      "after-checkpoint-commit",
    ]) {
      const root = mkdtempSync(join(tmpdir(), `cc-revoke-${crashPoint}-`));
      roots.push(root);
      expect(run(root, "propagate", crashPoint).status).toBe(
        crashPoint === "after-dependencies" ? 93 : 94,
      );
      expect(run(root, "propagate", "none").status).toBe(0);
      const effects = Object.values(read(root, "effects"));
      expect(effects).toHaveLength(1);
      expect(effects.every(({ applyCount }) => applyCount === 1)).toBe(true);
      expect(read(root, "retrieval-inspection")).toMatchObject({
        invalidated: true,
        tenantId: "tenant-a",
        skillName: "safe-refactor",
        ledgerSequence: 1,
      });
      expect(read(root, "marketplace-inspection")).toMatchObject({
        state: {
          tenantId: "tenant-a",
          skillName: "safe-refactor",
          stage: "rolled-back",
          revoked: true,
        },
        ledgerSequence: 2,
      });
      expect(read(root, "memory-inspection")).toMatchObject({
        active: null,
        quarantine: {
          layer: "procedural",
          contentDigest: expect.stringMatching(/^sha256:/u),
          metadata: {
            revocationPropagationRequestDigest:
              expect.stringMatching(/^sha256:/u),
          },
        },
        projectionSequence: 2,
      });
      expect(read(root, "propagation-checkpoint").cursor).toBe(1);
    }

    expect(Date.now() - startedAt).toBeLessThan(60_000);
  }, 60_000);
});
