import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";
import { EvolutionReleaseTrainLedgerAdapter } from "../../src/lib/evolution/evolution-release-train-ledger-adapter.js";
import {
  EVOLUTION_RELEASE_TRAIN_STAGES,
  createEvolutionPlan,
  createEvolutionReleaseTrain,
  createEvolutionTrainStageReceipt,
} from "../../src/lib/evolution/evolution-release-train.js";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const D = (value) =>
  `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;

const descriptor = Object.freeze({
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a",
  skillName: "skill-a",
  audience: "evolution-runtime",
  purpose: "evolution-ledger",
});

const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function backends() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-release-train-ledger-"),
  );
  temporaryRoots.push(root);
  const now = Date.parse("2026-09-04T00:00:00.000Z");
  const secret = "release-train-artifact-test-key";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/release-train";
  const policyDigest = D("release-train-artifact-policy");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const rawArtifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: descriptor.audience,
    tenantId: descriptor.artifactTenantId,
    now: () => now,
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
      resolve: (request) => {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(now).toISOString(),
          decisionExpiresAt: new Date(now + 30_000).toISOString(),
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
          receiptDigest: D(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const state = { events: [], failAfterAppend: false };
  const ledger = {
    read: vi.fn(() => structuredClone(state.events)),
    verify: vi.fn(() => ({
      epoch: "epoch-a",
      ledgerId: "ledger-a",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    })),
    appendDomainEvent: vi.fn((input, options) => {
      const head = state.events.at(-1);
      if (
        options.expectedSequence !== state.events.length ||
        options.expectedHeadDigest !== (head?.eventDigest ?? null)
      )
        throw new Error("ledger head conflict");
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: D(input),
      };
      state.events.push(event);
      if (state.failAfterAppend) {
        state.failAfterAppend = false;
        throw new Error("simulated response loss");
      }
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: D(event),
      };
    }),
  };
  return {
    root,
    state,
    ledger,
    artifactPorts: rawArtifactPorts,
    resolver: rawArtifactPorts.createEvolutionLedgerArtifactResolver({
      purpose: descriptor.purpose,
    }),
  };
}

function plan() {
  return createEvolutionPlan({
    tenantId: descriptor.tenantId,
    skillId: descriptor.skillName,
    gitCommit: "a".repeat(40),
    baselineReleaseDigest: D("baseline"),
    baselineId: D("baseline-id"),
    baselineContentDigest: D("baseline-content"),
    baselineRevision: 1,
    candidateId: D("candidate-id"),
    candidateDigest: D("candidate"),
    wikiRevisionDigest: D("wiki"),
    evalSuiteDigest: D("eval"),
    matrixEvalPlanDigest: D("matrix-eval-plan"),
    targetMatrixDigest: D("matrix"),
    riskTier: "low",
    rolloutPolicyDigest: D("rollout"),
    metricPolicyDigest: D("metrics"),
    permissionManifestDigest: D("permissions"),
    policyDigest: D("policy"),
    requestedCapabilityDigests: [D("read")],
    baselineCapabilityDigests: [D("read")],
    rootBudget: { tokens: 1_000, cost: 10, timeMs: 60_000, turns: 20 },
    expiresAt: "2030-01-01T00:00:00.000Z",
    triggerDigest: D("trigger"),
  });
}

function stages(spies = {}) {
  return Object.fromEntries(
    EVOLUTION_RELEASE_TRAIN_STAGES.map((stage) => [
      stage,
      (context) => {
        spies[stage]?.();
        return createEvolutionTrainStageReceipt({
          planDigest: context.plan.planDigest,
          stage,
          operationKey: context.operationKey,
          inputDigest: context.inputDigest,
          outputDigest: D(`${context.plan.planDigest}-${stage}`),
          accepted: true,
          durable: true,
          usage: { tokens: 1, cost: 0.01, timeMs: 10, turns: 1 },
        });
      },
    ]),
  );
}

function adapter(value) {
  return new EvolutionReleaseTrainLedgerAdapter({
    descriptor,
    artifactPorts: value.artifactPorts,
    ledger: value.ledger,
    ledgerArtifactResolver: value.resolver,
    clock: () => "2026-09-04T00:00:00.000Z",
  });
}

describe("EvolutionReleaseTrainLedgerAdapter", () => {
  it("persists all checkpoints through ArtifactStore and Ledger and reopens them", async () => {
    const durable = backends();
    const fixedPlan = plan();
    const calls = Object.fromEntries(
      EVOLUTION_RELEASE_TRAIN_STAGES.map((stage) => [stage, vi.fn()]),
    );
    const first = createEvolutionReleaseTrain({
      plan: fixedPlan,
      stateStore: adapter(durable).createStateStore(),
      stages: stages(calls),
      clock: () => Date.parse("2026-09-04T00:00:00.000Z"),
    });
    const completed = await first.run();
    expect(completed.state.status).toBe("complete");
    expect(durable.state.events).toHaveLength(8);

    const reopened = createEvolutionReleaseTrain({
      plan: fixedPlan,
      stateStore: adapter(durable).createStateStore(),
      stages: stages(calls),
      clock: () => Date.parse("2026-09-04T00:00:00.000Z"),
    });
    const recovered = await reopened.run();
    expect(recovered.state.stateDigest).toBe(completed.state.stateDigest);
    for (const stage of EVOLUTION_RELEASE_TRAIN_STAGES) {
      expect(calls[stage]).toHaveBeenCalledTimes(1);
    }
  });

  it("recovers a committed checkpoint after the append response is lost", async () => {
    const durable = backends();
    const fixedPlan = plan();
    const stagePorts = stages();
    durable.state.failAfterAppend = true;
    const first = createEvolutionReleaseTrain({
      plan: fixedPlan,
      stateStore: adapter(durable).createStateStore(),
      stages: stagePorts,
      clock: () => Date.parse("2026-09-04T00:00:00.000Z"),
    });
    await expect(first.run()).rejects.toThrow("simulated response loss");
    expect(durable.state.events).toHaveLength(1);

    const recovered = await createEvolutionReleaseTrain({
      plan: fixedPlan,
      stateStore: adapter(durable).createStateStore(),
      stages: stagePorts,
      clock: () => Date.parse("2026-09-04T00:00:00.000Z"),
    }).run();
    expect(recovered.state.status).toBe("complete");
    expect(durable.state.events).toHaveLength(8);
  });

  it("rejects a stale competing checkpoint without changing the durable winner", async () => {
    const durable = backends();
    const fixedPlan = plan();
    const storeA = adapter(durable).createStateStore();
    const storeB = adapter(durable).createStateStore();
    let arrivals = 0;
    let releaseBarrier;
    const barrier = new Promise((resolve) => {
      releaseBarrier = resolve;
    });
    const competingStages = (label) => ({
      ...stages(),
      "wiki-maintain": async (context) => {
        arrivals += 1;
        if (arrivals === 2) releaseBarrier();
        await barrier;
        return createEvolutionTrainStageReceipt({
          planDigest: context.plan.planDigest,
          stage: context.stage,
          operationKey: context.operationKey,
          inputDigest: context.inputDigest,
          outputDigest: D(label),
          accepted: true,
          durable: true,
          usage: { tokens: 1, cost: 0, timeMs: 1, turns: 1 },
        });
      },
    });
    const create = (stateStore, label) =>
      createEvolutionReleaseTrain({
        plan: fixedPlan,
        stateStore,
        stages: competingStages(label),
        clock: () => Date.parse("2026-09-04T00:00:00.000Z"),
      }).run();

    const results = await Promise.allSettled([
      create(storeA, "winner-a"),
      create(storeB, "winner-b"),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(durable.state.events).toHaveLength(8);
    expect((await storeA.load(fixedPlan.planDigest)).status).toBe("complete");
  });
});
