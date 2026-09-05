import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { openWorkbenchRollbackStore } from "../fixtures/evolution-workbench-rollback.js";
import {
  createEvolutionWorkbenchRegistrySource,
  verifyWorkbenchRegistryState,
} from "../../src/lib/evolution/evolution-workbench-registry-source.js";
import {
  buildEvolutionWorkbenchProjection,
  filterEvolutionWorkbenchProjection,
} from "../../src/lib/evolution/evolution-workbench-projection.js";
import { captureSkillReleaseOperationReader } from "../../src/lib/evolution/evolution-ledger-ports.js";
import { appendWorkbenchTransitionRecords } from "../fixtures/evolution-workbench-transition-records.js";
import { pruningDigest } from "../../src/lib/evolution/governed-wiki-pruning-journal.js";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function temp() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-workbench-registry-"),
  );
  roots.push(root);
  return root;
}

describe("Workbench real current Registry projection", () => {
  it("keeps a completed run immutable while actual rollback changes current activity and LKG", async () => {
    const root = temp();
    const h = await openWorkbenchRollbackStore(root, { seed: true });
    const initial = h.registrySource.load();
    expect(initial.registry.operations).toHaveLength(2);
    expect(initial.transitions).toEqual([]); // Actual transition reader proves no workflow requests; Registry history is not empty.
    const events = h.run.load().events;
    h.run.appendEvent({
      schema: evolutionRun.EVOLUTION_RUN_EVENT_SCHEMA,
      tenantId: h.descriptor.tenantId,
      runId: h.descriptor.runId,
      eventId: "run-finished",
      sequence: events.length + 1,
      type: "run-completed",
      subjectId: null,
      payloadDigest: h.plan.planDigest,
      artifactRef: null,
      keyRef: null,
      data: {},
    });
    const completed = h.run.load();
    expect(h.registrySource.load().registry).toEqual(initial.registry);
    await h.adapter.createExecutor().execute(h.plan);
    expect(h.run.load()).toEqual(completed);
    const current = await h.reviewBridge.loadCurrentProjection();
    const visible = filterEvolutionWorkbenchProjection(current);
    expect(current.schema).toBe(
      "chainlesschain.evolution-workbench-projection/v2",
    );
    expect(current.run.status).toBe("completed");
    expect(current.run.activeReleaseId).toBe(
      h.release.candidateRelease.releaseDigest,
    );
    expect(visible.governance.activeReleaseId).toBe(
      h.release.baseline.releaseDigest,
    );
    expect(visible.governance.lastKnownGoodReleaseId).toBe(
      h.release.baseline.releaseDigest,
    );
    expect(
      current.candidates
        .filter((candidate) => candidate.actualUsage.active)
        .map((candidate) => candidate.candidateId),
    ).toEqual([h.release.baseline.candidateId]);
    expect(current.registry.operations).toHaveLength(3);
    expect(current.registry.operations.at(-1)).toMatchObject({
      operation: "rollback",
      status: "committed",
    });
    expect(
      current.timeline.some(
        (row) =>
          row.source === "release-registry" &&
          row.phase === "release-rolled-back",
      ),
    ).toBe(true);
    const reopened = await openWorkbenchRollbackStore(root);
    expect(await reopened.reviewBridge.loadCurrentProjection()).toEqual(
      current,
    );
    expect(reopened.run.load()).toEqual(completed);
    const next = h.release.createDerivedCandidate();
    await h.release.promoteCandidate("another-run-promotion", next.candidateId);
    const outside = await reopened.reviewBridge.loadCurrentProjection();
    expect(
      outside.candidates.every(
        (candidate) => candidate.actualUsage.active === false,
      ),
    ).toBe(true);
    expect(
      outside.conflicts.some(
        (conflict) => conflict.type === "active-outside-run",
      ),
    ).toBe(true);
    expect(
      filterEvolutionWorkbenchProjection(outside).governance.activeReleaseId,
    ).toBe(h.release.readActive().release.releaseDigest);
    expect(reopened.run.load()).toEqual(completed);
  });
  it("authenticates complete history once per reader and rejects scope/brand replacement", async () => {
    const h = await openWorkbenchRollbackStore(temp(), { seed: true });
    const reader = captureSkillReleaseOperationReader(
      h.registryOptions.transactionLedger,
    );
    const history = reader.readReleaseHistory({
      tenantId: h.descriptor.tenantId,
      skillName: h.descriptor.skillName,
      context: reader.currentContext(),
    });
    expect(history.operations).toHaveLength(2);
    for (const operation of history.operations)
      expect(
        reader.resolveOperation({
          tenantId: h.descriptor.tenantId,
          skillName: h.descriptor.skillName,
          operationId: operation.intent.operationId,
          context: reader.currentContext(),
        }).result,
      ).toEqual(operation);
    const state = h.registrySource.load().registry;
    expect(
      verifyWorkbenchRegistryState(
        state,
        h.descriptor.tenantId,
        h.descriptor.skillName,
      ),
    ).toEqual(state);
    expect(() =>
      createEvolutionWorkbenchRegistrySource({
        ...h.registryOptions,
        verifierLedger: h.registryOptions.ledger,
      }),
    ).toThrow("independent");
    expect(() =>
      createEvolutionWorkbenchRegistrySource({
        ...h.registryOptions,
        releaseRegistry: { ...h.registryOptions.releaseRegistry },
      }),
    ).toThrow();
    expect(() =>
      reader.readReleaseHistory({
        tenantId: h.descriptor.tenantId,
        skillName: h.descriptor.skillName,
        context: reader.currentContext(),
        limit: 1,
      }),
    ).toThrow();
  });
  it.each([false, true])(
    "connects nonempty workflow history to its exact real Registry effect (forged=%s)",
    async (forgedTransaction) => {
      const h = await openWorkbenchRollbackStore(temp(), { seed: true });
      const records = appendWorkbenchTransitionRecords(h, {
        forgedTransaction,
      });
      if (forgedTransaction)
        expect(() => h.registrySource.load()).toThrow(
          "no exact prior Registry effect",
        );
      else {
        const current = await h.reviewBridge.loadCurrentProjection();
        expect(current.summary.transitionCount).toBe(1);
        expect(current.summary.registryOperationCount).toBe(2);
        expect(
          current.timeline.some(
            (row) => row.digest === records.settlement.settlementDigest,
          ),
        ).toBe(true);
      }
    },
  );
  it("rejects rehashed current-state claims, missing operations, and cloned authority", async () => {
    const h = await openWorkbenchRollbackStore(temp(), { seed: true });
    const projection = await h.reviewBridge.loadCurrentProjection();
    for (const change of [
      (registry) => {
        registry.active.contentDigest = `sha256:${"0".repeat(64)}`;
      },
      (registry) => {
        registry.operations.shift();
      },
      (registry) => {
        registry.active.authenticated = true;
      },
      (registry) => {
        registry.active.lastKnownGoodReleaseDigest =
          registry.active.releaseDigest;
      },
    ]) {
      const forged = structuredClone(projection);
      change(forged.registry);
      const { registryDigest: ignoredRegistryDigest, ...registryCore } =
        forged.registry;
      void ignoredRegistryDigest;
      forged.registry.registryDigest = pruningDigest(
        forged.registry.schema,
        registryCore,
      );
      const { projectionDigest: ignoredProjectionDigest, ...core } = forged;
      void ignoredProjectionDigest;
      forged.projectionDigest = pruningDigest(forged.schema, core);
      expect(() => filterEvolutionWorkbenchProjection(forged)).toThrow();
    }
    expect(() =>
      createEvolutionWorkbenchRegistrySource({
        ...h.registryOptions,
        transactionLedger: { ...h.registryOptions.transactionLedger },
      }),
    ).toThrow();
  });
  it("does not invalidate a retained view merely because an unrelated audit event was appended", async () => {
    const h = await openWorkbenchRollbackStore(temp(), { seed: true });
    const stored = h.reviewBridge.createProjectionReader().read({
      tenantId: h.descriptor.tenantId,
      projectionDigest: h.plan.sourceProjectionDigest,
    });
    const now = Date.parse(stored.projection.observedAt) + 1000;
    const projection = await buildEvolutionWorkbenchProjection(
      h.projectionSource,
      { observedAt: new Date(now).toISOString() },
    );
    const before = h.registrySource.currentContext();
    h.backend.ledger.appendDomainEvent({
      type: "test.workbench.unrelated",
      eventId: "test-unrelated-event",
      tenantId: h.descriptor.tenantId,
      artifactTenantId: h.descriptor.artifactTenantId,
      correlationId: h.descriptor.streamId,
      skillName: h.descriptor.skillName,
      decision: "committed",
      reason: "test unrelated audit record",
      timestamp: new Date(now).toISOString(),
      subjectRef: stored.artifactRef,
      sourceRefs: [],
    });
    expect(() => h.registrySource.assertCurrent(before)).toThrow("changed");
    expect(h.registrySource.load().registry).toEqual(projection.registry);
    expect(
      await h.reviewBridge.retainProjection({
        tenantId: h.descriptor.tenantId,
        projection,
      }),
    ).toMatchObject({ durable: true });
  });
});
