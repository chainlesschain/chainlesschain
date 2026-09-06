import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
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
function run(root, operation, crashPoint, pilotRoot = root) {
  return spawnSync(
    process.execPath,
    [WORKER, root, operation, crashPoint, pilotRoot],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    },
  );
}
function expectExit(result, code) {
  expect(
    result.status,
    result.error?.message || result.stderr || result.stdout,
  ).toBe(code);
}
function expectRollback(root) {
  const inspection = read(root, "pilot-inspection");
  expect(inspection).toMatchObject({
    view: {
      stage: "rolled-back",
      revision: 5,
      killSwitch: true,
      reconciliationRequired: false,
    },
    restore: {
      authenticated: true,
      durable: true,
      state: { stage: "rolled-back", revision: 5, killSwitch: true },
    },
    ledger: {
      authenticated: true,
      durable: true,
      status: "verified",
      sequence: 5,
    },
    releaseRegistry: {
      active: {
        state: {
          tenantId: "tenant-a",
          skillName: "safe-refactor",
          revision: 3,
        },
      },
      ledger: { authenticated: true, durable: true, status: "verified" },
    },
  });
  const { active, baseline, candidateRelease, transitions } =
    inspection.releaseRegistry;
  expect(candidateRelease.candidate.content).not.toBe(
    baseline.candidate.content,
  );
  expect(candidateRelease.dependencyLockDigest).not.toBe(
    baseline.dependencyLockDigest,
  );
  expect(active.release).toEqual(baseline);
  expect(active.state.activeReleaseDigest).toBe(baseline.releaseDigest);
  expect(active.state.lastKnownGoodReleaseDigest).toBe(baseline.releaseDigest);
  expect(active.state.dependencyLockDigest).toBe(baseline.dependencyLockDigest);
  expect(
    `sha256:${createHash("sha256").update(active.release.candidate.content).digest("hex")}`,
  ).toBe(baseline.contentDigest);
  expect(inspection.view.candidateDigest).toBe(candidateRelease.candidateId);
  expect(transitions.map(({ operation }) => operation)).toEqual([
    "promote",
    "promote",
    "rollback",
  ]);
  expect(transitions[2].transactionId).toBe(active.state.transactionId);
  expect(transitions[2].operationId).toMatch(/^pilot-rollback:[a-f0-9]{64}$/u);
  expect(existsSync(join(root, "effects.json"))).toBe(false);
  return inspection;
}
function expectWiki(root) {
  expect(read(root, "wiki-inspection")).toMatchObject({
    state: {
      patterns: { "pat-safe-refactor": { status: "stale", actionable: false } },
      skillImpact: { "safe-refactor": { rejected: 1 } },
    },
    ledgerSequence: 2,
  });
}
function expectDependencies(root) {
  expectWiki(root);
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
        revocationPropagationRequestDigest: expect.stringMatching(/^sha256:/u),
      },
    },
    projectionSequence: 2,
  });
  expect(read(root, "propagation-checkpoint").cursor).toBe(5);
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Skill revocation real cross-process recovery", () => {
  it("recovers real release pointer, Wiki, dependency and checkpoint crashes within 60 seconds each", () => {
    const pilotRoot = mkdtempSync(
      join(realpathSync.native(tmpdir()), "cc-revoke-pilot-"),
    );
    roots.push(pilotRoot);
    expectExit(run(pilotRoot, "seed", "none"), 0);
    const seeded = read(pilotRoot, "pilot-inspection");
    expect(seeded.view).toMatchObject({ stage: "shadow", revision: 3 });
    expect(seeded.releaseRegistry.active.release).toEqual(
      seeded.releaseRegistry.candidateRelease,
    );
    expect(seeded.releaseRegistry.active.state.lastKnownGoodReleaseDigest).toBe(
      seeded.releaseRegistry.baseline.releaseDigest,
    );
    let recovered = null;
    for (const [operation, crashPoint, exitCode] of [
      ["propagate", "after-release-pointer", 95],
      ["wiki", "after-wiki-commit", 92],
      ["propagate", "after-dependencies", 93],
      ["propagate", "after-checkpoint-commit", 94],
    ]) {
      const root = mkdtempSync(
        join(realpathSync.native(tmpdir()), `cc-revoke-${crashPoint}-`),
      );
      roots.push(root);
      expectExit(run(root, "seed-dependencies", "none", pilotRoot), 0);
      expect(read(root, "dependency-seed-inspection")).toMatchObject({
        retrievalSequence: 0,
        marketplaceStage: "candidate",
        activeMemory: { layer: "procedural" },
        wikiPattern: { actionable: true },
      });
      // The first window includes the actual kill-switch, pointer write,
      // process exit, release/Pilot reconciliation and all four dependencies.
      const startedAt = Date.now();
      expectExit(run(root, operation, crashPoint, pilotRoot), exitCode);
      expectExit(run(root, operation, "none", pilotRoot), 0);
      const inspection = expectRollback(root);
      expectWiki(root);
      if (operation === "propagate") expectDependencies(root);
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs, crashPoint).toBeLessThan(60_000);
      process.stdout.write(`recovery ${crashPoint}: ${elapsedMs}ms\n`);
      if (recovered) {
        expect(inspection.ledger).toEqual(recovered.ledger);
        expect(inspection.releaseRegistry).toEqual(recovered.releaseRegistry);
        expect(inspection.restore).toEqual(recovered.restore);
      }
      recovered = inspection;
    }
    expect(existsSync(join(pilotRoot, "pilot-active-state.json"))).toBe(false);
  }, 300_000);
});
