#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTestAgentEvolutionComposition } from "../__tests__/fixtures/agent-evolution-test-deployment.js";
import { replicaAuthority } from "../__tests__/fixtures/skill-revocation-release-registry.js";
import { loadConfig } from "../src/lib/config-manager.js";
import { applyConfigLlmDefaults } from "../src/lib/llm-config-defaults.js";
import { BUILT_IN_PROVIDERS } from "../src/lib/llm-providers.js";
import { getEvolutionDeploymentStatus } from "../src/lib/evolution/evolution-deployment-config.js";
import { loadEvolutionDeploymentCommandDependencies } from "../src/lib/evolution/evolution-deployment-loader.js";
import { initializeEvolutionTestDeployment } from "../src/lib/evolution/evolution-test-deployment.js";
import { executePmExplorationBudgetedOperation } from "../src/lib/evolution/pm-exploration-budget-executor.js";
import { EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA } from "../src/lib/evolution/evolution-artifact-ports.js";

const CONFIRM_FLAG = "--confirm-live";
const FIXTURE_FLAG = "--fixture";
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 8;
const MAX_BUDGET_TOKENS = 1_024;
const TENANT_ID = "tenant-pm-signed-live-probe";
const ARTIFACT_TENANT_ID = "artifact-tenant-pm-signed-live-probe";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
}

function deploymentSource() {
  return `
export async function createChainlessChainCommandDependencies({ commandName, descriptor, factories }) {
  if (commandName !== "desktop") return {};
  const resources = await factories.createLocalPmVolcengineProbeResources({
    createComposition: factories.createAgentEvolutionRuntimeComposition,
  });
  const artifactStore = factories.createArtifactStore({ dir: resources.artifactDir });
  const artifactPorts = factories.createEvolutionArtifactPorts({
    artifactStore,
    audience: resources.audience,
    tenantId: resources.artifactTenantId,
    envelopeSigner: resources.artifactAuthority.envelopeSigner,
    envelopeVerifier: resources.artifactAuthority.envelopeVerifier,
    currentAuthorityResolver: resources.artifactAuthority.currentAuthorityResolver,
  });
  const settlementAdapter = factories.createPmExplorationProviderSettlementAdapter({
    descriptor: {
      tenantId: resources.tenantId,
      artifactTenantId: resources.artifactTenantId,
      audience: resources.audience,
      purpose: resources.purpose,
      durabilityAuthorityId: resources.artifactDurabilityAuthority.id,
      handlerArtifactDigest: descriptor.moduleDigest,
    },
    artifactPorts,
    artifactDurabilityAuthority: resources.artifactDurabilityAuthority,
  });
  const settlementStore = factories.capturePmExplorationProviderSettlementStore(settlementAdapter);
  const provider = factories.createPmExplorationVolcengineProvider({
    apiKey: resources.apiKey,
    baseUrl: resources.baseUrl,
    evolutionIngress: resources.evolutionIngress,
    maxOutputTokens: resources.maxOutputTokens,
    model: resources.model,
    persistSettlement: settlementStore.persistSettlement,
    pricing: resources.pricing,
    timeoutMs: resources.timeoutMs,
  });
  return {
    pmVolcengineProbe: Object.freeze({
      deploymentModuleDigest: descriptor.moduleDigest,
      providerDescriptor: factories.inspectPmExplorationVolcengineProvider(provider),
      settlementStoreDescriptor: settlementStore.inspect(),
      invoke: Object.freeze((input) => factories.invokePmExplorationVolcengine(provider, input)),
      verify: Object.freeze((settlement, persistence) =>
        settlementStore.verifySettlementPersistence(settlement, persistence)),
    }),
  };
}
`;
}

function createArtifactAuthority() {
  const secret = crypto.randomBytes(32);
  const algorithm = "hmac-sha256";
  const keyId = "test:key/pm-signed-live-probe";
  const policyDigest = digest("pm-signed-live-probe-policy");
  const sign = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
  return Object.freeze({
    envelopeSigner: Object.freeze({
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    }),
    envelopeVerifier: Object.freeze({
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    }),
    currentAuthorityResolver: Object.freeze({
      resolve(request) {
        const checkedAt = new Date().toISOString();
        const decisionExpiresAt = new Date(
          Date.parse(checkedAt) + 30_000,
        ).toISOString();
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt,
          decisionExpiresAt,
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
          receiptDigest: digest(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    }),
  });
}

function localVolcengineConfig() {
  const config = loadConfig();
  const llm = config?.llm || {};
  const resolved = { provider: "volcengine" };
  applyConfigLlmDefaults(resolved, llm);
  resolved.apiKey ||= process.env.VOLCENGINE_API_KEY;
  const definition = BUILT_IN_PROVIDERS.volcengine;
  if (llm.provider !== "volcengine" || resolved.provider !== "volcengine")
    throw new Error("local LLM configuration is not Volcengine");
  if (!resolved.apiKey) throw new Error("VOLCENGINE_API_KEY is not configured");
  if (!resolved.model) throw new Error("Volcengine model is not configured");
  const baseUrl = (resolved.baseUrl || definition.baseUrl).replace(/\/$/u, "");
  if (baseUrl !== definition.baseUrl)
    throw new Error("Volcengine endpoint differs from the built-in endpoint");
  return Object.freeze({
    apiKey: resolved.apiKey,
    baseUrl,
    model: resolved.model,
    pricing: llm.pricing,
  });
}

function fixtureVolcengineConfig() {
  return Object.freeze({
    apiKey: "test-only-pm-signed-live-probe-secret",
    baseUrl: BUILT_IN_PROVIDERS.volcengine.baseUrl,
    model: "deepseek-v4-flash",
    pricing: undefined,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes(CONFIRM_FLAG);
  const fixture = args.includes(FIXTURE_FLAG);
  if (confirmed && fixture)
    throw new Error(
      `${CONFIRM_FLAG} and ${FIXTURE_FLAG} are mutually exclusive`,
    );
  if (!confirmed && !fixture) {
    throw new Error(
      `Refusing a paid network call without ${CONFIRM_FLAG}; this probe never prints credentials or response content.`,
    );
  }
  const llm = fixture ? fixtureVolcengineConfig() : localVolcengineConfig();
  const previousFetch = globalThis.fetch;
  if (fixture) {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "FIXTURE_OK" } }],
        usage: { prompt_tokens: 249, completion_tokens: 3 },
      }),
    });
  }
  const temporaryBase = fs.realpathSync.native(os.tmpdir());
  const temporaryRoot = fs.mkdtempSync(
    path.join(temporaryBase, "cc-pm-signed-live-"),
  );
  const physicalRoot = fs.realpathSync.native(temporaryRoot);
  const relativeTemporaryRoot = path.relative(temporaryBase, physicalRoot);
  if (
    !relativeTemporaryRoot ||
    relativeTemporaryRoot.startsWith("..") ||
    path.isAbsolute(relativeTemporaryRoot)
  ) {
    throw new Error("signed PM probe temporary root escaped the system temp");
  }
  const deploymentModulePath = path.join(physicalRoot, "deployment.mjs");
  const deploymentHome = path.join(physicalRoot, "home");
  const stateRootDir = path.join(physicalRoot, "evolution-state");
  const artifactDir = path.join(physicalRoot, "settlement-artifacts");
  const replicaDir = path.join(physicalRoot, "settlement-replica");
  const env = {
    ...process.env,
    CHAINLESSCHAIN_HOME: deploymentHome,
  };
  delete env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR;
  delete env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT;
  let composition = null;
  let operationError = null;
  const startedAt = Date.now();
  try {
    fs.writeFileSync(deploymentModulePath, deploymentSource(), { flag: "wx" });
    const initialized = await initializeEvolutionTestDeployment(
      {
        modulePath: deploymentModulePath,
        commands: ["desktop"],
        enabled: true,
      },
      { env, cwd: process.cwd() },
    );
    const status = await getEvolutionDeploymentStatus({
      env,
      cwd: process.cwd(),
    });
    const artifactAuthority = createArtifactAuthority();
    const artifactDurabilityAuthority = replicaAuthority(replicaDir);
    const dependencies = await loadEvolutionDeploymentCommandDependencies(
      "desktop",
      {
        env,
        additionalFactories: {
          createLocalPmVolcengineProbeResources: async ({
            createComposition,
          }) => {
            composition = createTestAgentEvolutionComposition(
              createComposition,
              { runId: `pm-signed-live-${Date.now()}` },
              stateRootDir,
            );
            await composition.evolutionIngress.start();
            return Object.freeze({
              tenantId: TENANT_ID,
              artifactTenantId: ARTIFACT_TENANT_ID,
              audience: "evolution-runtime",
              purpose: "evolution-ledger",
              artifactDir,
              artifactAuthority,
              artifactDurabilityAuthority,
              evolutionIngress: composition.evolutionIngress,
              apiKey: llm.apiKey,
              baseUrl: llm.baseUrl,
              model: llm.model,
              pricing: llm.pricing,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              timeoutMs: TIMEOUT_MS,
            });
          },
        },
      },
    );
    const probe = dependencies?.pmVolcengineProbe;
    if (!probe || typeof probe.invoke !== "function")
      throw new Error("signed desktop deployment omitted the PM live probe");
    if (
      probe.deploymentModuleDigest !== initialized.moduleDigest ||
      probe.settlementStoreDescriptor.handlerArtifactDigest !==
        initialized.moduleDigest
    ) {
      throw new Error("signed PM probe handler digest is not deployment-bound");
    }
    const executionRequestDigest = digest("pm-signed-live-execution-request");
    const outcome = await executePmExplorationBudgetedOperation({
      limits: {
        maxTokens: MAX_BUDGET_TOKENS,
        maxToolCalls: 0,
        maxWallClockMs: TIMEOUT_MS + 10_000,
      },
      operation: async (runtime) => {
        try {
          return await probe.invoke({
            messages: [{ role: "user", content: "Reply exactly OK." }],
            runtime,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            operationId: "runner.signed-live-probe",
            executionRequestDigest,
          });
        } catch (error) {
          operationError = error;
          throw error;
        }
      },
    });
    if (outcome.status !== "succeeded") {
      throw operationError || new Error(`PM live probe ${outcome.status}`);
    }
    const result = outcome.value;
    const verifiedPersistence = probe.verify(
      result.settlement,
      result.persistence,
    );
    await composition.evolutionIngress.complete();
    const run = composition.loadRun();
    process.stdout.write(
      `${JSON.stringify({
        schema: "chainlesschain.pm-exploration-signed-volcengine-live-probe/v1",
        provider: result.settlement.provider,
        model: result.settlement.model,
        elapsedMs: Date.now() - startedAt,
        usage: result.settlement.usage,
        estimatedCost: result.settlement.estimatedCost,
        settlementDigest: result.settlement.settlementDigest,
        persistenceRecordDigest: verifiedPersistence.recordDigest,
        settlementDurablyVerified: true,
        durabilityAuthorityKind: "synthetic-filesystem-replica",
        signedDeploymentVerified: status.verified === true,
        deploymentMode: status.deploymentMode,
        deploymentRevision: status.revision,
        autoPromotion: status.autoPromotion,
        handlerArtifactBound: true,
        budgetStatus: outcome.status,
        budgetMetrics: outcome.metrics,
        ingressProjectionStatus: run.projection.status,
        networkCall: !fixture,
        fixtureResponse: fixture,
        governedPmTestRun: true,
        productionGovernedPmRun: false,
        credentialExposed: false,
        responseContentExposed: false,
      })}\n`,
    );
  } finally {
    fs.rmSync(physicalRoot, { recursive: true, force: true });
    if (fixture) globalThis.fetch = previousFetch;
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
