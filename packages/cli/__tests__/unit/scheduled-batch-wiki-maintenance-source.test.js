import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SCHEDULED_BATCH_WIKI_MAINTENANCE_INVALID_CODE,
  SCHEDULED_BATCH_WIKI_MAINTENANCE_JOB_SCHEMA,
  SCHEDULED_BATCH_WIKI_MAINTENANCE_RESULT_SCHEMA,
  createScheduledBatchWikiMaintenanceProducer,
  createScheduledBatchWikiMaintenanceSource,
} from "../../src/lib/evolution/scheduled-batch-wiki-maintenance-source.js";
import {
  WIKI_MAINTENANCE_TRIGGER_KIND,
  WikiMaintenanceTriggerLedgerAdapter,
} from "../../src/lib/evolution/wiki-maintenance-trigger-ledger-adapter.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

const TENANT_ID = "tenant-scheduled-wiki";
const BASE_NOW = Date.parse("2026-09-03T03:00:00.000Z");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function authority() {
  return {
    schemaVersion: 1,
    principal: { type: "service", id: "wiki-maintenance-scheduler" },
    tenantId: TENANT_ID,
    workspaceId: "workspace-scheduled-wiki",
    requestedCapabilities: ["evolution.wiki.maintain"],
    authorizationRefs: {
      decisionId: "decision-scheduled-wiki",
      policyRevision: "policy-scheduled-wiki-v1",
      schedulerPolicyRevision: "scheduler-policy-v1",
      grantIds: ["grant-scheduled-wiki"],
      approvalIds: [],
      delegationIds: [],
    },
  };
}

function fixture({ validResult = true, settle = true } = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-scheduled-wiki-source-"),
  );
  roots.push(root);
  const file = path.join(root, "scheduler.db");
  let now = BASE_NOW;
  let store = openSchedulerStore({ file, Database, clock: () => now });
  const evidenceSelectorDigest = hash("all-new-evolution-evidence");
  store.createJob({
    id: "job-wiki-maintenance",
    kind: "evolution.wiki-maintenance",
    trigger: { adapter: "routine", expression: "daily" },
    payload: {
      schema: SCHEDULED_BATCH_WIKI_MAINTENANCE_JOB_SCHEMA,
      tenantId: TENANT_ID,
      evidenceSelectorDigest,
    },
    authority: authority(),
    maxAttempts: 1,
  });
  const queued = store.enqueueOccurrence({
    jobId: "job-wiki-maintenance",
    scheduledFor: now,
    triggerKey: "wiki-maintenance:2026-09-03",
  });
  const claim = store.claimNext({
    ownerId: "wiki-maintenance-worker",
    leaseMs: 60_000,
  });
  now += 1_000;
  if (settle) {
    const refs = ["evidence:batch-a", "evidence:batch-b"];
    store.settle({
      occurrenceId: claim.id,
      ownerId: claim.leaseOwner,
      fence: claim.fence,
      outcome: "succeeded",
      result: {
        schema: SCHEDULED_BATCH_WIKI_MAINTENANCE_RESULT_SCHEMA,
        tenantId: TENANT_ID,
        evidenceRefs: refs,
        evidenceSetDigest: validResult ? hash(refs) : hash("substituted"),
      },
    });
  }
  const verifierState = { available: true };
  const schedulerAuthorityVerifier = {
    async verify(input) {
      if (!verifierState.available) return { authenticated: false };
      return {
        authenticated: true,
        durable: true,
        tenantId: input.tenantId,
        occurrenceId: input.occurrence.id,
        jobId: input.job.id,
        jobRevision: input.job.revision,
        occurrenceDigest: input.occurrenceDigest,
        receiptDigest: hash({
          purpose: "scheduled-wiki-maintenance",
          occurrenceDigest: input.occurrenceDigest,
        }),
      };
    },
  };
  const resolver = {
    resolve({ tenantId, occurrenceId }) {
      expect(tenantId).toBe(TENANT_ID);
      expect(occurrenceId).toBe(queued.id);
      return store;
    },
  };
  const source = createScheduledBatchWikiMaintenanceSource({
    tenantId: TENANT_ID,
    schedulerStoreResolver: resolver,
    schedulerAuthorityVerifier,
  });
  return {
    file,
    queued,
    source,
    verifierState,
    close() {
      store.close();
    },
    reopen() {
      store = openSchedulerStore({ file, Database, clock: () => now });
      return store;
    },
  };
}

describe("scheduled-batch Wiki maintenance source", () => {
  it("reauthenticates a succeeded SchedulerStore occurrence after reopen", async () => {
    const base = fixture();
    const trigger = await base.source.build({
      occurrenceId: base.queued.id,
    });
    expect(trigger).toMatchObject({
      kind: WIKI_MAINTENANCE_TRIGGER_KIND.SCHEDULED_BATCH,
      sourceId: base.queued.id,
      evidenceRefs: ["evidence:batch-a", "evidence:batch-b"],
      effectiveAt: "2026-09-03T03:00:01.000Z",
    });
    expect(trigger.sourceReceiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);

    base.close();
    base.reopen();
    await expect(
      base.source.verify({ tenantId: TENANT_ID, ...trigger }),
    ).resolves.toMatchObject({
      authenticated: true,
      durable: true,
      receiptDigest: trigger.sourceReceiptDigest,
    });
    base.close();
  });

  it("feeds only branded, tenant-matched trigger adapters", async () => {
    const base = fixture();
    const enqueue = vi.fn(async (input) => ({
      queued: true,
      sourceId: input.sourceId,
    }));
    const triggerAdapter = Object.create(
      WikiMaintenanceTriggerLedgerAdapter.prototype,
    );
    Object.defineProperties(triggerAdapter, {
      descriptor: {
        value: Object.freeze({ tenantId: TENANT_ID }),
        enumerable: true,
      },
      enqueue: { value: enqueue, enumerable: true },
    });
    Object.freeze(triggerAdapter);
    const producer = createScheduledBatchWikiMaintenanceProducer({
      source: base.source,
      triggerAdapter,
    });
    await expect(
      producer.enqueueSettledBatch({ occurrenceId: base.queued.id }),
    ).resolves.toMatchObject({
      queued: true,
      sourceId: base.queued.id,
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0][0].kind).toBe("scheduled-batch");
    base.close();
  });

  it("fails closed for unfinished or evidence-substituted scheduler results", async () => {
    const unfinished = fixture({ settle: false });
    await expect(
      unfinished.source.build({ occurrenceId: unfinished.queued.id }),
    ).rejects.toMatchObject({
      code: SCHEDULED_BATCH_WIKI_MAINTENANCE_INVALID_CODE,
    });
    unfinished.close();

    const substituted = fixture({ validResult: false });
    await expect(
      substituted.source.build({ occurrenceId: substituted.queued.id }),
    ).rejects.toThrow(/evidence binding is invalid/u);
    substituted.close();
  });

  it("revalidates the independent scheduler authority on every read", async () => {
    const base = fixture();
    const trigger = await base.source.build({
      occurrenceId: base.queued.id,
    });
    base.verifierState.available = false;
    await expect(
      base.source.verify({ tenantId: TENANT_ID, ...trigger }),
    ).rejects.toMatchObject({
      code: SCHEDULED_BATCH_WIKI_MAINTENANCE_INVALID_CODE,
    });
    base.close();
  });
});
