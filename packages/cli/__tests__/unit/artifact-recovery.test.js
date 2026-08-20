import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  ARTIFACT_ORPHAN_GC_LEDGER_SCHEMA,
  ARTIFACT_RECOVERY_PLAN_SCHEMA,
  adjudicateArtifactRecovery,
  buildArtifactRecoveryPlan,
  readArtifactOrphanGcLedger,
} from "../../src/lib/artifact-recovery.js";
import { settleArtifactCleanup } from "../../src/lib/artifact-cleanup-ledger.js";
import { settleArtifactDeletion } from "../../src/lib/artifact-deletion-ledger.js";
import {
  runArtifactsOrphanGcLog,
  runArtifactsRecoveryAdjudicate,
  runArtifactsRecoveryPlan,
} from "../../src/commands/artifacts.js";

function overrideFs(overrides) {
  return new Proxy(fs, {
    get(target, property) {
      return Object.hasOwn(overrides, property)
        ? overrides[property]
        : target[property];
    },
  });
}

describe("artifact startup recovery and administrator adjudication", () => {
  let root;
  let now;
  let store;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-artifact-recovery-"));
    now = Date.UTC(2026, 7, 20, 0, 0, 0);
    store = new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns a stable, content-free clear startup plan", () => {
    const first = buildArtifactRecoveryPlan(store, { now: () => now });
    const later = buildArtifactRecoveryPlan(store, { now: () => now + 1_000 });

    expect(first).toMatchObject({
      schema: ARTIFACT_RECOVERY_PLAN_SCHEMA,
      policy: { unattendedMutationAllowed: false },
      summary: { itemCount: 0, criticalCount: 0 },
      items: [],
    });
    expect(later.planDigest).toBe(first.planDigest);
    expect(later.observedAt).not.toBe(first.observedAt);
  });

  it("discovers a timed-out prepared deletion and retries its original authority", () => {
    const entry = store.publishData({
      data: "pending deletion secret",
      fileName: "pending.txt",
      sessionId: "session-pending",
      recordDigest: `sha256:${"4".repeat(64)}`,
    });
    const failingFs = overrideFs({
      rmSync() {
        throw new Error("injected deletion interruption");
      },
    });
    expect(() =>
      settleArtifactDeletion(
        store,
        {
          deletionId: "delete-pending-1",
          artifactId: entry.id,
          reason: "explicit",
          client: "cli",
        },
        { fs: failingFs, now: () => now },
      ),
    ).toThrow(/injected deletion interruption/u);

    now += 20 * 60 * 1000;
    const plan = buildArtifactRecoveryPlan(store, { now: () => now });
    expect(plan.summary).toMatchObject({
      itemCount: 1,
      criticalCount: 1,
      timedOutCount: 1,
      pendingDeletionCount: 1,
      orphanCount: 0,
    });
    const item = plan.items[0];
    expect(item).toMatchObject({
      kind: "pending-deletion",
      recommendedDecision: "retry",
      timedOut: true,
      authority: {
        deletionId: "delete-pending-1",
        artifactId: entry.id,
        artifactSessionId: "session-pending",
      },
    });

    const settled = adjudicateArtifactRecovery(
      store,
      {
        itemId: item.itemId,
        planDigest: plan.planDigest,
        decision: "retry",
        adjudicationId: "admin-delete-retry-1",
      },
      { now: () => now },
    );
    expect(settled).toMatchObject({ settled: true, mutationPerformed: true });
    expect(fs.existsSync(path.join(store.dir, "files", entry.file))).toBe(
      false,
    );
    expect(buildArtifactRecoveryPlan(store, { now: () => now }).items).toEqual(
      [],
    );
    expect(JSON.stringify({ plan, settled })).not.toContain(
      "pending deletion secret",
    );
    expect(JSON.stringify({ plan, settled })).not.toContain(root);
  });

  it("discovers and retries one prepared cleanup without selecting a new scope", () => {
    const expired = store.publishData({
      data: "expired secret",
      fileName: "expired.txt",
      ttlDays: 1,
    });
    now += 2 * 24 * 60 * 60 * 1000;
    expect(() =>
      settleArtifactCleanup(
        store,
        { cleanupId: "cleanup-pending-1", client: "cli" },
        {
          now: () => now,
          afterItem() {
            throw new Error("injected cleanup interruption");
          },
        },
      ),
    ).toThrow(/injected cleanup interruption/u);

    const later = store.publishData({
      data: "later secret",
      fileName: "later.txt",
      ttlDays: 1,
    });
    now += 2 * 24 * 60 * 60 * 1000;
    const plan = buildArtifactRecoveryPlan(store, { now: () => now });
    const item = plan.items.find(
      (candidate) => candidate.kind === "pending-cleanup",
    );
    expect(item).toBeTruthy();
    expect(item.authority.itemCount).toBe(1);

    const settled = adjudicateArtifactRecovery(
      store,
      {
        itemId: item.itemId,
        planDigest: plan.planDigest,
        decision: "retry",
        adjudicationId: "admin-cleanup-retry-1",
      },
      { now: () => now },
    );
    expect(settled.result.selected).toBe(1);
    expect(store.get(expired.id)).toBeNull();
    expect(store.get(later.id)).not.toBeNull();
  });

  it("inventories an unreferenced managed copy and settles explicit GC exactly once", () => {
    const filesDir = path.join(store.dir, "files");
    fs.mkdirSync(filesDir, { recursive: true });
    const orphanPath = path.join(filesDir, "art_crash_deadbeef.txt");
    fs.writeFileSync(orphanPath, "unindexed secret", { mode: 0o600 });

    const plan = buildArtifactRecoveryPlan(store, { now: () => now });
    expect(plan.summary).toMatchObject({ itemCount: 1, orphanCount: 1 });
    const item = plan.items[0];
    expect(item).toMatchObject({
      kind: "orphan-managed-copy",
      recommendedDecision: "delete-orphan",
      automaticallyExecutable: false,
      requiresApproval: true,
    });
    expect(JSON.stringify(plan)).not.toContain("unindexed secret");
    expect(JSON.stringify(plan)).not.toContain(root);

    const request = {
      itemId: item.itemId,
      planDigest: plan.planDigest,
      decision: "delete-orphan",
      adjudicationId: "orphan-gc-1",
    };
    const first = adjudicateArtifactRecovery(store, request, {
      now: () => now,
    });
    const retry = adjudicateArtifactRecovery(store, request, {
      now: () => now,
    });

    expect(first).toMatchObject({
      settled: true,
      recorded: true,
      gc: { phase: "terminal", outcome: "deleted" },
    });
    expect(retry).toMatchObject({
      settled: true,
      recorded: false,
      gc: first.gc,
    });
    expect(fs.existsSync(orphanPath)).toBe(false);
    expect(readArtifactOrphanGcLedger(store)).toMatchObject({
      schema: ARTIFACT_ORPHAN_GC_LEDGER_SCHEMA,
      eventCount: 2,
      preparedCount: 1,
      terminalCount: 1,
      pendingCount: 0,
    });
  });

  it("recovers orphan GC after bytes disappeared before terminal response", () => {
    const filesDir = path.join(store.dir, "files");
    fs.mkdirSync(filesDir, { recursive: true });
    const orphanPath = path.join(filesDir, "art_crash_response.txt");
    fs.writeFileSync(orphanPath, "response loss secret", { mode: 0o600 });
    const plan = buildArtifactRecoveryPlan(store, { now: () => now });
    const item = plan.items[0];
    const request = {
      itemId: item.itemId,
      planDigest: plan.planDigest,
      decision: "delete-orphan",
      adjudicationId: "orphan-gc-response-loss",
    };

    expect(() =>
      adjudicateArtifactRecovery(store, request, {
        now: () => now,
        afterDelete() {
          throw new Error("injected response loss");
        },
      }),
    ).toThrow(/injected response loss/u);
    expect(fs.existsSync(orphanPath)).toBe(false);
    expect(readArtifactOrphanGcLedger(store).pendingCount).toBe(1);
    expect(
      buildArtifactRecoveryPlan(store, { now: () => now }).items[0].kind,
    ).toBe("pending-orphan-gc");

    const recovered = adjudicateArtifactRecovery(store, request, {
      now: () => now,
    });
    expect(recovered.gc.outcome).toBe("already-absent");
    expect(readArtifactOrphanGcLedger(store).pendingCount).toBe(0);
  });

  it("fails closed on plan drift, unsafe files, and tampered GC history", () => {
    const filesDir = path.join(store.dir, "files");
    fs.mkdirSync(filesDir, { recursive: true });
    const orphanPath = path.join(filesDir, "art_drift.txt");
    fs.writeFileSync(orphanPath, "before", { mode: 0o600 });
    const plan = buildArtifactRecoveryPlan(store, { now: () => now });
    fs.writeFileSync(orphanPath, "after", { mode: 0o600 });
    expect(() =>
      adjudicateArtifactRecovery(
        store,
        {
          itemId: plan.items[0].itemId,
          planDigest: plan.planDigest,
          decision: "delete-orphan",
          adjudicationId: "orphan-gc-drift",
        },
        { now: () => now },
      ),
    ).toThrow(/plan changed/u);

    const refreshed = buildArtifactRecoveryPlan(store, { now: () => now });
    adjudicateArtifactRecovery(
      store,
      {
        itemId: refreshed.items[0].itemId,
        planDigest: refreshed.planDigest,
        decision: "delete-orphan",
        adjudicationId: "orphan-gc-tamper",
      },
      { now: () => now },
    );
    const ledgerPath = path.join(store.dir, "orphan-gc-settlements.jsonl");
    const original = fs.readFileSync(ledgerPath, "utf8");
    fs.writeFileSync(
      ledgerPath,
      original.replace('"outcome":"deleted"', '"outcome":"already-absent"'),
    );
    expect(() => readArtifactOrphanGcLedger(store)).toThrow(
      /digest is invalid/u,
    );
  });

  it("exposes read-only plan, explicit approval, and verified history command contracts", () => {
    const filesDir = path.join(store.dir, "files");
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(path.join(filesDir, "art_command.txt"), "command secret");
    const writes = [];
    const errors = [];
    const logSpy = console.log;
    const errorSpy = console.error;
    console.log = (value) => writes.push(String(value));
    console.error = (value) => errors.push(String(value));
    try {
      expect(
        runArtifactsRecoveryPlan(
          { json: true },
          { store, recoveryOptions: { now: () => now } },
        ),
      ).toBe(2);
      const plan = JSON.parse(writes.pop());
      expect(
        runArtifactsRecoveryAdjudicate(
          plan.items[0].itemId,
          {
            planDigest: plan.planDigest,
            decision: "delete-orphan",
            json: true,
          },
          { store, recoveryOptions: { now: () => now } },
        ),
      ).toBe(1);
      expect(errors.pop()).toContain("explicit --approve");
      expect(
        runArtifactsRecoveryAdjudicate(
          plan.items[0].itemId,
          {
            planDigest: plan.planDigest,
            decision: "delete-orphan",
            adjudicationId: "orphan-gc-command",
            approve: true,
            json: true,
          },
          { store, recoveryOptions: { now: () => now } },
        ),
      ).toBe(0);
      expect(runArtifactsOrphanGcLog({ json: true }, { store })).toBe(0);
      expect(JSON.parse(writes.at(-1))).toMatchObject({ terminalCount: 1 });
    } finally {
      console.log = logSpy;
      console.error = errorSpy;
    }
  });
});
