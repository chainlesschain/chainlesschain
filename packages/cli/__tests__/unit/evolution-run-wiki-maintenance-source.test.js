import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { sealAgentEvolutionRuntimeComposition } from "../../src/lib/evolution/agent-evolution-runtime-composition-brand.js";
import { createAgentEvolutionIngress } from "../../src/lib/evolution/agent-evolution-ingress.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";
import { EvolutionEvidenceArtifactAdapter } from "../../src/lib/evolution/evolution-evidence-artifact-adapter.js";
import {
  EVOLUTION_RUN_WIKI_MAINTENANCE_SOURCE_INVALID_CODE,
  createEvolutionRunWikiMaintenanceProducer,
  createEvolutionRunWikiMaintenanceSource,
} from "../../src/lib/evolution/evolution-run-wiki-maintenance-source.js";
import { EvolutionRunLedgerAdapter } from "../../src/lib/evolution/evolution-run-ledger-adapter.js";
import {
  WIKI_MAINTENANCE_TRIGGER_KIND,
  WikiMaintenanceTriggerLedgerAdapter,
} from "../../src/lib/evolution/wiki-maintenance-trigger-ledger-adapter.js";

const { EVOLUTION_RUN_EVENT_SCHEMA, EVENT_TYPES } = evolutionRun;
const NOW = "2026-09-03T02:00:00.000Z";
const TENANT_ID = "tenant-agent-source";
const ARTIFACT_TENANT_ID = "artifact-tenant-agent-source";
const RUN_ID = "agent-run-source-1";
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
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
}

function fixture() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-run-wiki-source-"),
  );
  roots.push(root);
  const audience = "evolution-runtime";
  const purpose = "evolution-ledger";
  const secret = "test-only-run-wiki-source-key";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/run-wiki-source";
  const policyDigest = hash("run-wiki-source-policy");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => Date.parse(NOW),
    }),
    audience,
    tenantId: ARTIFACT_TENANT_ID,
    now: () => Date.parse(NOW),
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve(request) {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: NOW,
          decisionExpiresAt: "2026-09-03T02:01:00.000Z",
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: hash(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const state = { events: [] };
  const ledger = {
    read: vi.fn(() => structuredClone(state.events)),
    verify: vi.fn(() => ({
      epoch: "epoch-agent-source",
      ledgerId: "ledger-agent-source",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    })),
    appendDomainEvent: vi.fn((input, options) => {
      const previous = state.events.at(-1);
      if (
        options.expectedSequence !== state.events.length ||
        options.expectedHeadDigest !== (previous?.eventDigest ?? null)
      ) {
        throw new Error("ledger head conflict");
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: hash(input),
      };
      state.events.push(event);
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: hash(event),
      };
    }),
  };
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose,
  });
  const runAdapter = new EvolutionRunLedgerAdapter({
    descriptor: {
      tenantId: TENANT_ID,
      artifactTenantId: ARTIFACT_TENANT_ID,
      runId: RUN_ID,
      audience,
      purpose,
    },
    artifactPorts,
    ledger,
    ledgerArtifactResolver: resolver,
    now: () => Date.parse(NOW),
  });
  return {
    artifactPorts,
    audience,
    ledger,
    purpose,
    resolver,
    runAdapter,
    composition: sealAgentEvolutionRuntimeComposition({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      loadRun: () => runAdapter.load(),
    }),
  };
}

function append(runAdapter, sequence, type, options = {}) {
  return runAdapter.appendEvent({
    schema: EVOLUTION_RUN_EVENT_SCHEMA,
    tenantId: TENANT_ID,
    runId: RUN_ID,
    eventId: `${RUN_ID}:${sequence}`,
    sequence,
    type,
    subjectId: options.subjectId ?? RUN_ID,
    payloadDigest: hash(`payload:${sequence}`),
    artifactRef: options.artifactRef ?? null,
    keyRef: null,
    data: options.data ?? {},
  });
}

function completeRun(runAdapter, { goalEnded = true } = {}) {
  append(runAdapter, 1, EVENT_TYPES.RUN_STARTED, {
    data: { occurredAt: "2026-09-03T01:59:00.000Z" },
  });
  append(runAdapter, 2, EVENT_TYPES.RAW_EVENT_REFERENCED, {
    subjectId: "evidence-user-prompt",
    artifactRef: "cc-evolution-artifact:evidence-user-prompt",
    data: {
      evidenceKind: "user-prompt",
      occurredAt: "2026-09-03T01:59:10.000Z",
    },
  });
  if (goalEnded) {
    append(runAdapter, 3, EVENT_TYPES.RAW_EVENT_REFERENCED, {
      subjectId: "evidence-goal-ended",
      artifactRef: "cc-evolution-artifact:evidence-goal-ended",
      data: {
        evidenceKind: "goal-ended",
        occurredAt: "2026-09-03T01:59:50.000Z",
      },
    });
  }
  append(runAdapter, goalEnded ? 4 : 3, EVENT_TYPES.RUN_COMPLETED, {
    data: { occurredAt: NOW, status: "completed" },
  });
}

function createSource(composition, resolverState = { available: true }) {
  return createEvolutionRunWikiMaintenanceSource({
    tenantId: TENANT_ID,
    runCompositionResolver: {
      resolve({ tenantId, runId }) {
        if (!resolverState.available) throw new Error("source revoked");
        expect({ tenantId, runId }).toEqual({
          tenantId: TENANT_ID,
          runId: RUN_ID,
        });
        return composition;
      },
    },
  });
}

function createTriggerAdapter(
  base,
  source,
  maintainer = { maintain: vi.fn() },
) {
  return new WikiMaintenanceTriggerLedgerAdapter({
    descriptor: {
      tenantId: TENANT_ID,
      artifactTenantId: ARTIFACT_TENANT_ID,
      streamId: "wiki-maintenance-from-agent",
      audience: base.audience,
      purpose: base.purpose,
    },
    artifactPorts: base.artifactPorts,
    ledger: base.ledger,
    ledgerArtifactResolver: base.resolver,
    sourceVerifier: source,
    maintainer,
    now: () => Date.parse(NOW),
  });
}

describe("EvolutionRun Wiki maintenance source", () => {
  it("enqueues session maintenance from the real Agent ingress completion seam", async () => {
    const base = fixture();
    append(base.runAdapter, 1, EVENT_TYPES.RUN_STARTED, {
      data: { occurredAt: "2026-09-03T01:59:00.000Z" },
    });
    append(base.runAdapter, 2, EVENT_TYPES.RAW_EVENT_REFERENCED, {
      subjectId: "evidence-session",
      artifactRef: "cc-evolution-artifact:evidence-session",
      data: {
        evidenceKind: "response-completed",
        occurredAt: "2026-09-03T01:59:50.000Z",
      },
    });
    const source = createSource(base.composition);
    const triggerAdapter = createTriggerAdapter(base, source);
    const producer = createEvolutionRunWikiMaintenanceProducer({
      source,
      triggerAdapter,
    });
    const evidenceAdapter = Object.create(
      EvolutionEvidenceArtifactAdapter.prototype,
    );
    Object.defineProperty(evidenceAdapter, "projectAndPersist", {
      value: vi.fn(async () => {
        throw new Error("not used by completion test");
      }),
    });
    const ingress = createAgentEvolutionIngress({
      evidenceAdapter,
      runAdapter: base.runAdapter,
      sourceEnvelopeAuthority: { issue: vi.fn() },
      wikiMaintenanceProducer: producer,
      completionTriggerKind: WIKI_MAINTENANCE_TRIGGER_KIND.SESSION_END,
      now: () => new Date(NOW),
    });

    await expect(ingress.complete({ occurredAt: NOW })).resolves.toMatchObject({
      status: "completed",
    });
    expect(triggerAdapter.list()).toHaveLength(1);
    expect(triggerAdapter.list()[0]).toMatchObject({
      status: "pending",
      request: {
        kind: "session-end",
        sourceId: RUN_ID,
        evidenceRefs: ["evidence-session"],
      },
    });
    await expect(ingress.complete({ occurredAt: NOW })).resolves.toMatchObject({
      status: "completed",
    });
    expect(triggerAdapter.list()).toHaveLength(1);
  });

  it("turns a reauthenticated completed run into durable session and goal triggers", async () => {
    const base = fixture();
    completeRun(base.runAdapter);
    const source = createSource(base.composition);
    const goal = source.build({
      kind: WIKI_MAINTENANCE_TRIGGER_KIND.GOAL_END,
      runId: RUN_ID,
    });
    expect(goal).toMatchObject({
      kind: "goal-end",
      sourceId: RUN_ID,
      evidenceRefs: ["evidence-goal-ended", "evidence-user-prompt"],
      effectiveAt: NOW,
    });
    expect(goal.sourceReceiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    await expect(
      source.verify({ tenantId: TENANT_ID, ...goal }),
    ).resolves.toMatchObject({
      authenticated: true,
      durable: true,
      receiptDigest: goal.sourceReceiptDigest,
    });

    const triggerAdapter = createTriggerAdapter(base, source);
    const producer = createEvolutionRunWikiMaintenanceProducer({
      source,
      triggerAdapter,
    });
    await expect(
      producer.enqueueCompletedRun({
        kind: WIKI_MAINTENANCE_TRIGGER_KIND.GOAL_END,
        runId: RUN_ID,
      }),
    ).resolves.toMatchObject({ queued: true, recovered: false });
    await expect(
      producer.enqueueCompletedRun({
        kind: WIKI_MAINTENANCE_TRIGGER_KIND.GOAL_END,
        runId: RUN_ID,
      }),
    ).resolves.toMatchObject({ queued: true, recovered: true });
    expect(triggerAdapter.list()).toHaveLength(1);
    expect(triggerAdapter.list()[0]).toMatchObject({
      status: "pending",
      request: goal,
    });

    const session = source.build({
      kind: WIKI_MAINTENANCE_TRIGGER_KIND.SESSION_END,
      runId: RUN_ID,
    });
    expect(session.kind).toBe("session-end");
    expect(session.sourceReceiptDigest).toBe(goal.sourceReceiptDigest);
  });

  it("rejects incomplete runs, scheduled batches, and goal triggers without goal evidence", () => {
    const incomplete = fixture();
    append(incomplete.runAdapter, 1, EVENT_TYPES.RUN_STARTED, {
      data: { occurredAt: NOW },
    });
    const incompleteSource = createSource(incomplete.composition);
    expect(() =>
      incompleteSource.build({ kind: "session-end", runId: RUN_ID }),
    ).toThrow(/not durably completed/u);
    expect(() =>
      incompleteSource.build({ kind: "scheduled-batch", runId: RUN_ID }),
    ).toThrow(/only support session-end and goal-end/u);

    const noGoal = fixture();
    completeRun(noGoal.runAdapter, { goalEnded: false });
    const noGoalSource = createSource(noGoal.composition);
    expect(() =>
      noGoalSource.build({ kind: "goal-end", runId: RUN_ID }),
    ).toThrow(/requires authenticated goal-ended evidence/u);
    expect(() =>
      noGoalSource.build({ kind: "session-end", runId: RUN_ID }),
    ).not.toThrow();
  });

  it("revalidates the durable run before processing and stops after source revocation", async () => {
    const base = fixture();
    completeRun(base.runAdapter);
    const resolverState = { available: true };
    const source = createSource(base.composition, resolverState);
    const maintainer = { maintain: vi.fn() };
    const triggerAdapter = createTriggerAdapter(base, source, maintainer);
    const producer = createEvolutionRunWikiMaintenanceProducer({
      source,
      triggerAdapter,
    });
    await producer.enqueueCompletedRun({ kind: "goal-end", runId: RUN_ID });
    resolverState.available = false;

    await expect(triggerAdapter.processNext()).rejects.toMatchObject({
      code: EVOLUTION_RUN_WIKI_MAINTENANCE_SOURCE_INVALID_CODE,
    });
    expect(maintainer.maintain).not.toHaveBeenCalled();
    expect(triggerAdapter.list()[0].status).toBe("pending");
  });

  it("rejects forged source requests and cross-tenant trigger adapters", async () => {
    const base = fixture();
    completeRun(base.runAdapter);
    const source = createSource(base.composition);
    const trigger = source.build({ kind: "session-end", runId: RUN_ID });
    await expect(
      source.verify({
        tenantId: TENANT_ID,
        ...trigger,
        evidenceRefs: ["evidence-substituted"],
      }),
    ).rejects.toMatchObject({
      code: EVOLUTION_RUN_WIKI_MAINTENANCE_SOURCE_INVALID_CODE,
    });

    const otherTriggerAdapter = new WikiMaintenanceTriggerLedgerAdapter({
      descriptor: {
        tenantId: "tenant-other",
        artifactTenantId: ARTIFACT_TENANT_ID,
        streamId: "wiki-maintenance-other",
        audience: base.audience,
        purpose: base.purpose,
      },
      artifactPorts: base.artifactPorts,
      ledger: base.ledger,
      ledgerArtifactResolver: base.resolver,
      sourceVerifier: source,
      maintainer: { maintain: vi.fn() },
    });
    expect(() =>
      createEvolutionRunWikiMaintenanceProducer({
        source,
        triggerAdapter: otherTriggerAdapter,
      }),
    ).toThrow(/tenant-matched/u);
    expect(() =>
      createEvolutionRunWikiMaintenanceProducer({
        source: { build: source.build },
        triggerAdapter: createTriggerAdapter(base, source),
      }),
    ).toThrow(/branded/u);
  });
});
