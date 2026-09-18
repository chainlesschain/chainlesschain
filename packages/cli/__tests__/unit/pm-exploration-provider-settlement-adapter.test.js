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
});
