import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestEvolutionCompositionFactory } from "../helpers/test-model-egress.js";
import { replicaAuthority } from "../fixtures/skill-revocation-release-registry.js";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { executePmExplorationBudgetedOperation } from "../../src/lib/evolution/pm-exploration-budget-executor.js";
import {
  PM_EXPLORATION_PROVIDER_SETTLEMENT_CORRUPT_CODE,
  PmExplorationProviderSettlementAdapter,
  capturePmExplorationProviderSettlementStore,
} from "../../src/lib/evolution/pm-exploration-provider-settlement-adapter.js";
import {
  createPmExplorationVolcengineProvider,
  invokePmExplorationVolcengine,
} from "../../src/lib/evolution/pm-exploration-volcengine-provider.js";
import {
  buildPmExplorationEffectPlan,
  buildPmExplorationPreparationProviderEvidence,
  buildPmExplorationSuite,
  verifyPmExplorationPreparationProviderEvidence,
} from "../../src/lib/evolution/pm-exploration-benchmark.js";
import { buildEvolutionEvalPolicy } from "../../src/lib/evolution/evolution-eval-gate.js";

const ARTIFACT_TENANT_ID = "artifact-tenant-pm-provider-settlement";
const NOW = Date.parse("2026-09-18T06:00:00.000Z");
const MODULE_DIGEST = sha("signed-desktop-deployment");
const roots = [];

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha(value) {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
}

function createArtifactPorts(artifactDir) {
  const secret = "test-only-pm-provider-settlement-artifact-secret";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/pm-provider-settlement";
  const policyDigest = sha("pm-provider-settlement-policy");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({ dir: artifactDir, now: () => NOW }),
    audience: "evolution-runtime",
    tenantId: ARTIFACT_TENANT_ID,
    now: () => NOW,
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
          checkedAt: "2026-09-18T06:00:00.000Z",
          decisionExpiresAt: "2026-09-18T06:01:00.000Z",
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
          receiptDigest: sha(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
}

function fixture(authorityTransform = (authority) => authority) {
  const root = fs.mkdtempSync(
    path.join(
      fs.realpathSync.native(os.tmpdir()),
      "cc-pm-provider-settlement-",
    ),
  );
  roots.push(root);
  const artifactDir = path.join(root, "artifacts");
  const replicaDir = path.join(root, "durable-replica");
  const create = () => {
    const authority = authorityTransform(replicaAuthority(replicaDir));
    const adapter = new PmExplorationProviderSettlementAdapter({
      descriptor: {
        tenantId: "tenant-pm-provider-settlement",
        artifactTenantId: ARTIFACT_TENANT_ID,
        audience: "evolution-runtime",
        purpose: "evolution-ledger",
        durabilityAuthorityId: authority.id,
        handlerArtifactDigest: MODULE_DIGEST,
      },
      artifactPorts: createArtifactPorts(artifactDir),
      artifactDurabilityAuthority: authority,
    });
    return {
      adapter,
      store: capturePmExplorationProviderSettlementStore(adapter),
    };
  };
  return { create, replicaDir };
}

async function invokeProvider(persistSettlement) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"memory":"candidate"}' } }],
        usage: { prompt_tokens: 9, completion_tokens: 3 },
      }),
    })),
  );
  const composition = await createTestEvolutionCompositionFactory()({
    runId: "pm-provider-settlement-adapter",
  });
  const provider = createPmExplorationVolcengineProvider({
    apiKey: "local-test-secret",
    model: "deepseek-v4-flash-ga-260731",
    maxOutputTokens: 64,
    timeoutMs: 1_000,
    evolutionIngress: composition.evolutionIngress,
    ...(persistSettlement === undefined ? {} : { persistSettlement }),
  });
  const outcome = await executePmExplorationBudgetedOperation({
    limits: { maxTokens: 100, maxToolCalls: 0, maxWallClockMs: 5_000 },
    operation: (runtime) =>
      invokePmExplorationVolcengine(provider, {
        messages: [
          { role: "user", content: "Return one PM memory candidate." },
        ],
        runtime,
        maxOutputTokens: 32,
        operationId: "runner.settlement-adapter",
        executionRequestDigest: sha("execution-request"),
      }),
  });
  expect(outcome.status).toBe("succeeded");
  return outcome.value;
}

function preparationInput(result, descriptorDigest) {
  const suite = buildPmExplorationSuite({
    suiteId: "provider-preparation-test",
    datasetVersion: "v1",
    tasks: ["training", "validation", "test", "test"].map((split, index) => ({
      id: `pm-${split}-${index}`,
      split,
      groups: {
        template: `${split}-${index}-template`,
        project: `${split}-${index}-project`,
        principal: `${split}-${index}-principal`,
        timeWindow: `${split}-${index}-window`,
      },
      prompt: `Complete the ${split} PM workflow ${index}`,
      expected: {
        kind: "project-state",
        id: `private-${split}-${index}`,
        name: `private-${split}-${index}`,
        status: "completed",
      },
    })),
  });
  const policy = buildEvolutionEvalPolicy({
    policyId: "provider-preparation-test",
    minTrainingTasks: 30,
    minValidationTasks: 20,
    minTestTasks: 20,
    seeds: [101, 202, 303],
    minimumAbsoluteImprovement: 0.05,
    minimumEfficiencyImprovement: 0.1,
    confidenceZ: 1.96,
    maxAverageTokens: 10_000,
    maxAverageLatencyMs: 60_000,
    maxAverageToolCalls: 100,
    maxTotalTokens: 1_000_000,
    maxTotalLatencyMs: 10_000_000,
    maxTotalToolCalls: 100_000,
    maxTotalCostMicrounits: 1_000_000,
    maxExecutions: 240,
    maxWallClockMs: 30_000,
    portReceiptTtlMs: 60_000,
    receiptTtlMs: 60_000,
  });
  const plan = buildPmExplorationEffectPlan({
    experimentId: "provider-preparation-test",
    suite,
    policy,
    baselineVersion: { id: "baseline", artifactDigest: sha("baseline") },
    candidateVersion: { id: "candidate", artifactDigest: sha("candidate") },
    actorConfigDigest: sha("actor"),
    modelConfigDigest: sha("model"),
    toolPolicyDigest: sha("tool"),
    permissionPolicyDigest: sha("permissions"),
    environmentDigest: sha("environment"),
    resetProtocolDigest: sha("reset"),
    seeds: [101, 202, 303],
    budgetPerArmPerSeed: {
      maxTokens: 10_000,
      maxToolCalls: 100,
      maxWallClockMs: 60_000,
      maxCostMicrounits: 100_000,
    },
    minimumPassRateDelta: 0.05,
    minimumIndependentGroups: 2,
  });
  const phases = (used) =>
    [
      "exploration",
      "curriculum-planning",
      "memory-distillation",
      "failure-retry",
      "environment-reset",
    ].map((phase, index) => ({
      phase,
      usage:
        used && index === 0
          ? {
              receiptDigest: sha("phase-usage"),
              tokens: result.settlement.usage.totalTokens,
              toolCalls: 0,
              wallClockMs: result.elapsedMs,
              costMicrounits: Math.ceil(
                result.settlement.estimatedCost.total * 1e6,
              ),
            }
          : {
              receiptDigest: null,
              tokens: 0,
              toolCalls: 0,
              wallClockMs: 0,
              costMicrounits: 0,
            },
    }));
  return {
    source: {
      plan,
      phaseUsage: [101, 202, 303].map((seed) => ({
        seed,
        baseline: phases(false),
        candidate: phases(seed === 101),
      })),
      settlements: [
        {
          seed: 101,
          arm: "candidate",
          phase: "exploration",
          settlement: result.settlement,
          persistence: result.persistence,
        },
      ],
    },
    expected: {
      planDigest: plan.planDigest,
      descriptorDigest,
      requests: [
        {
          seed: 101,
          arm: "candidate",
          phase: "exploration",
          operationId: result.settlement.operationId,
          executionRequestDigest: result.settlement.executionRequestDigest,
          requestDigest: result.settlement.requestDigest,
        },
      ],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("PM provider settlement adapter", () => {
  it("retains provider usage before return and verifies it after reopening", async () => {
    const resources = fixture();
    const first = resources.create();
    const result = await invokeProvider(first.store.persistSettlement);

    expect(result.persistence).toMatchObject({
      settlementDigest: result.settlement.settlementDigest,
      persisted: true,
      durable: true,
    });
    expect(result.persistence.recordDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      first.store.verifySettlementPersistence(
        result.settlement,
        result.persistence,
      ),
    ).toEqual(result.persistence);

    const reopened = resources.create();
    expect(
      reopened.store.verifySettlementPersistence(
        JSON.parse(JSON.stringify(result.settlement)),
        JSON.parse(JSON.stringify(result.persistence)),
      ),
    ).toEqual(result.persistence);
    expect(reopened.store.persistSettlement(result.settlement)).toEqual(
      result.persistence,
    );
    expect(reopened.store.inspect()).toMatchObject({
      schema: "chainlesschain.pm-exploration-provider-settlement-adapter/v1",
      handlerArtifactDigest: MODULE_DIGEST,
      durabilityAuthorityId: "durability:revocation-release-test",
    });
    expect(JSON.stringify(reopened.store.inspect())).not.toContain(
      "local-test-secret",
    );
  });

  it("fails closed on non-durable acknowledgements", async () => {
    const resources = fixture((authority) => ({
      id: authority.id,
      resolve: authority.resolve,
      retain(request) {
        return { ...authority.retain(request), durable: false };
      },
    }));
    const { store } = resources.create();
    const result = await invokeProvider();
    expect(() => store.persistSettlement(result.settlement)).toThrowError(
      expect.objectContaining({
        code: PM_EXPLORATION_PROVIDER_SETTLEMENT_CORRUPT_CODE,
      }),
    );
  });

  it("rejects durable-replica substitution and forged persistence", async () => {
    const resources = fixture();
    const { store } = resources.create();
    const result = await invokeProvider(store.persistSettlement);
    const replica = fs.readdirSync(resources.replicaDir)[0];
    const replicaPath = path.join(resources.replicaDir, replica);
    const record = JSON.parse(fs.readFileSync(replicaPath, "utf8"));
    record.bytes = Buffer.from("substituted").toString("base64");
    fs.writeFileSync(replicaPath, JSON.stringify(record));

    expect(() =>
      store.verifySettlementPersistence(result.settlement, result.persistence),
    ).toThrow();
    expect(() =>
      store.verifySettlementPersistence(result.settlement, {
        ...result.persistence,
        recordDigest: sha("forged-record"),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: PM_EXPLORATION_PROVIDER_SETTLEMENT_CORRUPT_CODE,
      }),
    );
    expect(() => capturePmExplorationProviderSettlementStore({})).toThrow(
      /real PmExplorationProviderSettlementAdapter/,
    );
  });

  it("binds a registered preparation request to durable token and cost evidence", async () => {
    const resources = fixture();
    const { adapter, store } = resources.create();
    const result = await invokeProvider(store.persistSettlement);
    const { source, expected } = preparationInput(
      result,
      store.inspect().descriptorDigest,
    );
    const evidence = buildPmExplorationPreparationProviderEvidence(
      adapter,
      source,
      expected,
    );
    expect(evidence).toMatchObject({
      planDigest: source.plan.planDigest,
      authenticationScope: "registered-provider-tokens-and-estimated-cost-only",
      preparationEvidenceAuthenticated: false,
      reportAuthenticated: false,
      phaseTotals: [
        {
          seed: 101,
          arm: "candidate",
          phase: "exploration",
          tokens: result.settlement.usage.totalTokens,
        },
      ],
    });
    const reopened = resources.create();
    expect(
      verifyPmExplorationPreparationProviderEvidence(
        reopened.adapter,
        { source, evidence: JSON.parse(JSON.stringify(evidence)) },
        expected,
      ),
    ).toEqual(evidence);
  });

  it("rejects forged attribution, partial registry, undercounting and damaged readback", async () => {
    const resources = fixture();
    const { adapter, store } = resources.create();
    const result = await invokeProvider(store.persistSettlement);
    const original = preparationInput(result, store.inspect().descriptorDigest);
    const attempt = (change) => {
      const source = structuredClone(original.source);
      const expected = structuredClone(original.expected);
      change(source, expected);
      return () =>
        buildPmExplorationPreparationProviderEvidence(
          adapter,
          source,
          expected,
        );
    };
    expect(
      attempt((source) => (source.settlements[0].phase = "failure-retry")),
    ).toThrow();
    expect(
      attempt(
        (_, expected) => (expected.requests[0].requestDigest = sha("other")),
      ),
    ).toThrow();
    expect(
      attempt(
        (_, expected) => (expected.descriptorDigest = sha("different-store")),
      ),
    ).toThrow();
    expect(
      attempt((_, expected) => expected.requests.push(expected.requests[0])),
    ).toThrow();
    expect(
      attempt((source) => (source.phaseUsage[0].candidate[0].usage.tokens = 1)),
    ).toThrow();
    expect(
      attempt(
        (source) =>
          (source.phaseUsage[0].candidate[0].usage.costMicrounits = 0),
      ),
    ).toThrow();
    expect(
      attempt((source) => (source.settlements[0].persistence.durable = false)),
    ).toThrow();
    expect(() =>
      buildPmExplorationPreparationProviderEvidence(
        {},
        original.source,
        original.expected,
      ),
    ).toThrow(/real PmExplorationProviderSettlementAdapter/);

    const evidence = buildPmExplorationPreparationProviderEvidence(
      adapter,
      original.source,
      original.expected,
    );
    const forged = structuredClone(evidence);
    forged.phaseTotals[0].tokens += 1;
    expect(() =>
      verifyPmExplorationPreparationProviderEvidence(
        adapter,
        { source: original.source, evidence: forged },
        original.expected,
      ),
    ).toThrow();
    const replica = fs.readdirSync(resources.replicaDir)[0];
    const replicaPath = path.join(resources.replicaDir, replica);
    const record = JSON.parse(fs.readFileSync(replicaPath, "utf8"));
    record.bytes = Buffer.from("substituted").toString("base64");
    fs.writeFileSync(replicaPath, JSON.stringify(record));
    expect(() =>
      verifyPmExplorationPreparationProviderEvidence(
        adapter,
        { source: original.source, evidence },
        original.expected,
      ),
    ).toThrow();
  });
});
