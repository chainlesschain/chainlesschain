import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA } from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_KEYED_COMMITMENT_SCHEMA,
  EVOLUTION_PROJECTION_ATTESTATION_SCHEMA,
  EVOLUTION_PROJECTION_ATTESTATION_VERIFICATION_SCHEMA,
  EVOLUTION_RAW_STORAGE_POLICY_SCHEMA,
  EVOLUTION_SOURCE_VERIFICATION_SCHEMA,
} from "../../src/lib/evolution/evolution-evidence-projector.js";
import {
  AGENT_EVOLUTION_RUNTIME_COMPOSITION_SCHEMA,
  assembleAgentSkillOutcomeIndex,
  assembleAgentSkillOutcomeIndexFromCatalog,
  captureAgentEvolutionRuntimeComposition,
  createAgentEvolutionRuntimeComposition,
} from "../../src/lib/evolution/agent-evolution-runtime-composition.js";
import { isEvolutionWorkbenchMetricsOutcomeReader } from "../../src/lib/evolution/evolution-workbench-metrics-ledger-adapter.js";
import { buildSkillOutcomeIndexAuthority } from "../../src/lib/evolution/skill-outcome-index-authority.js";
import {
  EVOLUTION_RELEASE_TRAIN_STAGES,
  createEvolutionPlan,
  createEvolutionTrainStageReceipt,
} from "../../src/lib/evolution/evolution-release-train.js";
import {
  SKILL_OUTCOME_SOURCE_CATALOG_ATTESTATION_SCHEMA,
  SKILL_OUTCOME_SOURCE_CATALOG_SCHEMA,
  createSkillOutcomeSourceCatalogAuthority,
  digestSkillOutcomeSourceCatalog,
} from "../../src/lib/evolution/skill-outcome-source-catalog-authority.js";
import {
  SKILL_VECTOR_ATTESTATION_SCHEMA,
  SKILL_VECTOR_RESULT_SCHEMA,
  createSkillVectorAuthority,
  digestSkillVectorResult,
} from "../../src/lib/skill-vector-authority.js";
import { createAgentRuntimeFactory } from "../../src/runtime/runtime-factory.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import {
  registerAgentCommand,
  resolveAgentCommandEvolutionComposition,
} from "../../src/commands/agent.js";

const NOW = "2026-09-03T04:00:00.000Z";
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function outcomeCatalogAuthority(entries, options = {}) {
  const catalog = {
    schema: SKILL_OUTCOME_SOURCE_CATALOG_SCHEMA,
    tenantId: options.tenantId ?? "tenant:a",
    catalogId: "catalog:production",
    revision: 1,
    issuedAt: NOW,
    entries,
    attestation: {
      schema: SKILL_OUTCOME_SOURCE_CATALOG_ATTESTATION_SCHEMA,
      algorithm: "test-signature",
      keyId: "key:test-catalog",
      value: "A".repeat(32),
    },
  };
  catalog.catalogDigest =
    options.catalogDigest ?? digestSkillOutcomeSourceCatalog(catalog);
  return createSkillOutcomeSourceCatalogAuthority({
    tenantId: options.tenantId ?? "tenant:a",
    loader: { load: async () => options.loaded ?? catalog },
    verifier: {
      verify: async (request) => ({
        authenticated: options.authenticated ?? true,
        durable: true,
        tenantId: request.tenantId,
        catalogId: request.catalogId,
        revision: request.revision,
        catalogDigest: request.catalogDigest,
        receiptDigest: digest(`catalog-receipt:${request.catalogDigest}`),
      }),
    },
  });
}

function vectorAuthority(tenantId) {
  return createSkillVectorAuthority({
    tenantId,
    provider: {
      score: async (request) => {
        const result = {
          schema: SKILL_VECTOR_RESULT_SCHEMA,
          tenantId,
          requestDigest: request.requestDigest,
          corpusDigest: request.corpusDigest,
          modelId: "embedding:model",
          modelRevision: "revision:1",
          indexDigest: digest("vector-index"),
          scores: request.corpus.map(({ digest: contentDigest }) => ({
            digest: contentDigest,
            score: 0.5,
          })),
          attestation: {
            schema: SKILL_VECTOR_ATTESTATION_SCHEMA,
            algorithm: "test-signature",
            keyId: "key:test-vector",
            value: "A".repeat(32),
          },
        };
        return { ...result, resultDigest: digestSkillVectorResult(result) };
      },
    },
    verifier: {
      verify: async (request) => ({
        authenticated: true,
        durable: true,
        tenantId,
        requestDigest: request.requestDigest,
        resultDigest: request.resultDigest,
        receiptDigest: digest(`vector:${request.resultDigest}`),
      }),
    },
  });
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function domainDigest(value, domain) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${domain}\0${canonical(value)}`, "utf8")
    .digest("hex")}`;
}

function signingAuthority(label) {
  const secret = `test-only-${label}-secret`;
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const sign = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: {
      sign: ({ message }) => ({ ...trust, value: sign(message) }),
    },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === sign(message),
    },
  };
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -40_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directories.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directories.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function evidenceAuthorities() {
  const tenantId = "tenant-production";
  const commitmentKey = Buffer.alloc(32, 0x71);
  const rawKey = Buffer.alloc(32, 0x72);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const sourceVerifier = {
    verify: vi.fn(async (request) => {
      if (!request.sourceEnvelope.startsWith("signed-source:")) {
        throw new Error("source envelope denied");
      }
      const core = {
        schema: EVOLUTION_SOURCE_VERIFICATION_SCHEMA,
        verified: true,
        sourceEnvelopeDigest: request.sourceEnvelopeDigest,
        sourceInputDigest: request.sourceInputDigest,
        tenantId,
        principalId: "principal-agent-user",
        sourceKind: "user-statement",
        trust: "untrusted",
        authenticated: true,
        sourceRef: `rollout://${tenantId}/run-production-1/user-prompt`,
        sensitivity: "internal",
        schemaDigest: null,
        compilable: false,
        trustedPayload: null,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        checkedAt: request.requestedAt,
        decisionExpiresAt: new Date(
          Date.parse(request.requestedAt) + 30_000,
        ).toISOString(),
        verifierPolicyDigest: `sha256:${"4".repeat(64)}`,
        verifierPolicyRevision: 1,
        schemaPolicyDigest: `sha256:${"3".repeat(64)}`,
        schemaPolicyRevision: 1,
      };
      return {
        ...core,
        verificationReceiptDigest: domainDigest(
          core,
          "chainlesschain.evolution-source-verification/v1",
        ),
      };
    }),
  };
  const keyedCommitter = {
    commit: vi.fn(async (request) => {
      const commitment = (purpose, inputDigest) =>
        `hmac-sha256:${crypto
          .createHmac("sha256", commitmentKey)
          .update(`${tenantId}\0${purpose}\0${inputDigest}`, "utf8")
          .digest("hex")}`;
      const core = {
        schema: EVOLUTION_KEYED_COMMITMENT_SCHEMA,
        committed: true,
        tenantId,
        algorithm: "hmac-sha256",
        keyId: `kms://${tenantId}/evolution-commitment-v1`,
        keyVersion: 1,
        sourcePurpose: request.sourcePurpose,
        sourceInputDigest: request.sourceInputDigest,
        sourceCommitment: commitment(
          request.sourcePurpose,
          request.sourceInputDigest,
        ),
        trustedPayloadPurpose: request.trustedPayloadPurpose,
        trustedPayloadInputDigest: request.trustedPayloadInputDigest,
        trustedPayloadCommitment: null,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        checkedAt: request.requestedAt,
        decisionExpiresAt: new Date(
          Date.parse(request.requestedAt) + 30_000,
        ).toISOString(),
        policyDigest: `sha256:${"2".repeat(64)}`,
        policyRevision: 1,
      };
      return {
        ...core,
        commitmentReceiptDigest: domainDigest(
          core,
          "chainlesschain.evolution-keyed-commitment/v1",
        ),
      };
    }),
  };
  const storagePolicy = {
    resolve: vi.fn(async (request) => {
      const core = {
        schema: EVOLUTION_RAW_STORAGE_POLICY_SCHEMA,
        allowed: true,
        tenantId,
        principalId: request.principalId,
        sourceKind: request.sourceKind,
        sourceCommitment: request.sourceCommitment,
        commitmentReceiptDigest: request.commitmentReceiptDigest,
        sourceVerificationReceiptDigest:
          request.sourceVerificationReceiptDigest,
        sensitivity: request.sensitivity,
        retention: {
          expiresAt: "2027-09-03T04:00:00.000Z",
          deletionClass: "user-delete",
        },
        acl: [request.principalId, "service-evolution"],
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        checkedAt: request.requestedAt,
        decisionExpiresAt: new Date(
          Date.parse(request.requestedAt) + 30_000,
        ).toISOString(),
        policyDigest: `sha256:${"7".repeat(64)}`,
        policyRevision: 1,
      };
      return {
        ...core,
        policyReceiptDigest: domainDigest(
          core,
          "chainlesschain.evolution-raw-storage-policy/v1",
        ),
      };
    }),
  };
  const rawEncryptor = {
    encrypt: vi.fn(async ({ aad, plaintext }) => {
      const iv = Buffer.alloc(12, 0x73);
      const cipher = crypto.createCipheriv("aes-256-gcm", rawKey, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      return {
        algorithm: "aes-256-gcm",
        keyRef: `kms://${tenantId}/evolution-raw-v1`,
        sealedBytes: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
      };
    }),
  };
  const signedCore = (input) => ({
    schema: EVOLUTION_PROJECTION_ATTESTATION_SCHEMA,
    algorithm: "ed25519",
    keyId: "key-evolution-production-1",
    issuer: "service-evolution-projector",
    trustPolicyDigest: `sha256:${"9".repeat(64)}`,
    receiptDigest: input.receiptDigest,
    tenantId: input.tenantId,
    evidenceId: input.evidenceId,
  });
  const attestationSigner = {
    sign: vi.fn(async (input) => {
      const core = signedCore(input);
      const attested = {
        ...core,
        signature: crypto
          .sign(null, Buffer.from(canonical(core), "utf8"), privateKey)
          .toString("base64url"),
      };
      return {
        ...attested,
        attestationDigest: domainDigest(
          attested,
          "chainlesschain.evolution-projection-attestation/v1",
        ),
      };
    }),
  };
  const attestationVerifier = {
    verify: vi.fn(async (value, expected) => {
      const core = { ...value };
      delete core.signature;
      delete core.attestationDigest;
      if (
        !crypto.verify(
          null,
          Buffer.from(canonical(core), "utf8"),
          publicKey,
          Buffer.from(value.signature, "base64url"),
        ) ||
        value.attestationDigest !== expected.attestationDigest
      ) {
        throw new Error("projection attestation denied");
      }
      const decision = {
        schema: EVOLUTION_PROJECTION_ATTESTATION_VERIFICATION_SCHEMA,
        verified: true,
        attestationDigest: value.attestationDigest,
        receiptDigest: value.receiptDigest,
        tenantId: value.tenantId,
        evidenceId: value.evidenceId,
        issuer: value.issuer,
        keyId: value.keyId,
        trustPolicyDigest: value.trustPolicyDigest,
        trustPolicyRevision: 1,
        requestNonce: expected.requestNonce,
        requestedAt: expected.requestedAt,
        checkedAt: expected.requestedAt,
        decisionExpiresAt: new Date(
          Date.parse(expected.requestedAt) + 30_000,
        ).toISOString(),
      };
      return {
        ...decision,
        verificationReceiptDigest: domainDigest(
          decision,
          "chainlesschain.evolution-attestation-verification/v1",
        ),
      };
    }),
  };
  return {
    rawEncryptor,
    sourceEnvelope: {
      issue: vi.fn(async ({ kind }) => `signed-source:${kind}`),
    },
    sourceVerifier,
    keyedCommitter,
    storagePolicy,
    attestationSigner,
    attestationVerifier,
  };
}

function options(root) {
  const artifactSecret = "test-only-artifact-secret";
  const artifactAlgorithm = "hmac-sha256";
  const artifactKeyId = "key://tests/artifact";
  const artifactSign = (message) =>
    crypto
      .createHmac("sha256", artifactSecret)
      .update(message)
      .digest("base64url");
  const artifactPolicyDigest = digest("artifact-policy");
  const evidence = evidenceAuthorities();
  return {
    tenantId: "tenant-production",
    runId: "run-production-1",
    stateRootDir: root,
    witnessId: "agent-production-witness",
    secure: false,
    fsImpl: durableFilesystem(),
    clock: () => Date.parse(NOW),
    evidenceIdGenerator: vi.fn(async () => "evidence-production-1"),
    ingressIdGenerator: vi.fn(() => "ingress-production-1"),
    authorities: {
      artifact: {
        envelopeSigner: {
          sign: ({ message }) => ({
            algorithm: artifactAlgorithm,
            keyId: artifactKeyId,
            value: artifactSign(message),
          }),
        },
        envelopeVerifier: {
          verify: ({ message, signature }) =>
            signature.algorithm === artifactAlgorithm &&
            signature.keyId === artifactKeyId &&
            signature.value === artifactSign(message),
        },
        currentAuthorityResolver: {
          resolve(request) {
            const core = {
              action: request.action,
              algorithm: artifactAlgorithm,
              allowed: true,
              audience: request.audience,
              checkedAt: NOW,
              decisionExpiresAt: "2026-09-03T04:01:00.000Z",
              digest: request.digest,
              issuedAt: request.issuedAt,
              issuedPolicyDigest: request.issuedPolicyDigest,
              issuedPolicyRevision: request.issuedPolicyRevision,
              issuedPolicyTrusted: true,
              keyId: request.keyId || artifactKeyId,
              policyDigest: artifactPolicyDigest,
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
        },
      },
      ledger: signingAuthority("ledger"),
      witness: signingAuthority("witness"),
      ...evidence,
    },
  };
}

describe("Agent evolution runtime production composition", () => {
  it("mounts the fixed eight-stage train on the production ArtifactStore and Ledger", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-agent-release-train-"),
    );
    roots.push(root);
    const plan = createEvolutionPlan({
      tenantId: "tenant-production",
      skillId: "safe-refactor",
      gitCommit: "a".repeat(40),
      baselineReleaseDigest: digest("baseline"),
      candidateDigest: digest("candidate"),
      wikiRevisionDigest: digest("wiki"),
      evalSuiteDigest: digest("eval"),
      targetMatrixDigest: digest("matrix"),
      riskTier: "low",
      rolloutPolicyDigest: digest("rollout"),
      metricPolicyDigest: digest("metrics"),
      permissionManifestDigest: digest("permissions"),
      policyDigest: digest("policy"),
      requestedCapabilityDigests: [digest("read")],
      baselineCapabilityDigests: [digest("read")],
      rootBudget: { tokens: 100, cost: 1, timeMs: 60_000, turns: 16 },
      expiresAt: "2030-01-01T00:00:00.000Z",
      triggerDigest: digest("trigger"),
    });
    const calls = Object.fromEntries(
      EVOLUTION_RELEASE_TRAIN_STAGES.map((stage) => [stage, vi.fn()]),
    );
    const stages = Object.fromEntries(
      EVOLUTION_RELEASE_TRAIN_STAGES.map((stage) => [
        stage,
        (context) => {
          calls[stage](context);
          return createEvolutionTrainStageReceipt({
            planDigest: context.plan.planDigest,
            stage,
            operationKey: context.operationKey,
            inputDigest: context.inputDigest,
            outputDigest: digest(`${context.plan.planDigest}:${stage}`),
            accepted: true,
            durable: true,
            usage: { tokens: 1, cost: 0.01, timeMs: 10, turns: 1 },
          });
        },
      ]),
    );
    const firstInput = {
      ...options(root),
      releaseTrain: { plan, stages },
    };
    const first = createAgentEvolutionRuntimeComposition(firstInput);
    await first.evolutionIngress.complete();
    const completed = await first.releaseTrain.run();
    expect(completed.state).toMatchObject({
      status: "complete",
      stageIndex: 8,
    });

    const reopened = createAgentEvolutionRuntimeComposition({
      ...options(root),
      releaseTrain: { plan, stages },
    });
    await reopened.evolutionIngress.complete();
    const recovered = await reopened.releaseTrain.run();
    expect(recovered.state.stateDigest).toBe(completed.state.stateDigest);
    for (const stage of EVOLUTION_RELEASE_TRAIN_STAGES) {
      expect(calls[stage]).toHaveBeenCalledTimes(1);
    }
  });

  it("builds and reopens one authenticated run without embedding authority secrets", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-agent-evolution-root-"),
    );
    roots.push(root);
    const firstOptions = options(root);
    const first = createAgentEvolutionRuntimeComposition(firstOptions);

    expect(first).toMatchObject({
      schema: AGENT_EVOLUTION_RUNTIME_COMPOSITION_SCHEMA,
      tenantId: firstOptions.tenantId,
      runId: firstOptions.runId,
    });
    expect(captureAgentEvolutionRuntimeComposition(first)).toBe(first);
    expect(JSON.stringify(first)).not.toContain("test-only");
    const commandFactory = vi.fn(async () => first);
    await expect(
      resolveAgentCommandEvolutionComposition(commandFactory, {
        mode: "interactive",
        sessionId: firstOptions.runId,
        cwd: root,
      }),
    ).resolves.toBe(first);
    expect(commandFactory).toHaveBeenCalledWith({
      mode: "interactive",
      sessionId: firstOptions.runId,
      runId: firstOptions.runId,
      cwd: path.resolve(root),
    });
    await first.evolutionIngress.ingestUserPrompt({
      content: "retain this private prompt only as encrypted Raw evidence",
    });
    const startAgentRepl = vi.fn(async () => "closed");
    const runtime = createAgentRuntimeFactory({
      config: {},
      deps: { startAgentRepl },
      evolutionComposition: first,
    }).createAgentRuntime({ sessionId: firstOptions.runId });
    await expect(runtime.startAgentSession()).resolves.toBe("closed");
    expect(startAgentRepl).toHaveBeenCalledWith(
      expect.objectContaining({
        evolutionIngress: first.evolutionIngress,
      }),
    );
    expect(first.loadRun()).toMatchObject({
      projection: { status: "completed", eventCount: 3 },
    });
    const outcomeReader = first.createSkillOutcomeReader("repair-tests");
    expect(first.createSkillOutcomeReader("repair-tests")).toBe(outcomeReader);
    expect(isEvolutionWorkbenchMetricsOutcomeReader(outcomeReader)).toBe(true);
    expect(Object.keys(outcomeReader)).toEqual(["loadOutcomeSnapshot"]);
    expect(outcomeReader.loadOutcomeSnapshot()).toMatchObject({
      found: false,
      authenticated: true,
      durable: true,
      descriptor: {
        tenantId: firstOptions.tenantId,
        evolutionRunId: firstOptions.runId,
        skillName: "repair-tests",
      },
      ledgerAuthority: {
        status: "verified",
        authenticated: true,
        durable: true,
        eventCount: 3,
        sequence: 3,
      },
    });
    expect(() => first.createSkillOutcomeReader("../escape")).toThrow(
      /skillName is invalid/u,
    );
    const index = assembleAgentSkillOutcomeIndex({
      sources: [
        { composition: first, skillName: "repair-tests" },
        { composition: first, skillName: "write-docs" },
      ],
    });
    expect(index).toMatchObject({
      schema: "chainlesschain.agent-skill-outcome-index/v1",
      tenantId: firstOptions.tenantId,
      readers: [outcomeReader, expect.any(Object)],
    });
    expect(buildSkillOutcomeIndexAuthority(index)).toMatchObject({
      status: "verified-indexed",
      metrics: {},
      evidence: {
        sourceCount: 2,
        snapshotCount: 0,
        antiRollbackWitness: true,
      },
    });
    expect(() =>
      assembleAgentSkillOutcomeIndex({
        sources: [
          { composition: first, skillName: "repair-tests" },
          { composition: first, skillName: "repair-tests" },
        ],
      }),
    ).toThrow(/duplicate/u);
    const foreignOptions = options(root);
    foreignOptions.tenantId = "tenant:other";
    foreignOptions.runId = "run:other";
    const foreign = createAgentEvolutionRuntimeComposition(foreignOptions);
    expect(() =>
      assembleAgentSkillOutcomeIndex({
        sources: [
          { composition: first, skillName: "repair-tests" },
          { composition: foreign, skillName: "repair-tests" },
        ],
      }),
    ).toThrow(/crossed a tenant boundary/u);
    const foreignIndex = assembleAgentSkillOutcomeIndex({
      sources: [{ composition: foreign, skillName: "repair-tests" }],
    });
    expect(() =>
      createAgentRuntimeFactory({
        config: {},
        evolutionComposition: first,
        skillOutcomeIndex: foreignIndex,
      }),
    ).toThrow(/must share one tenant/u);
    const indexedStartAgentRepl = vi.fn(async () => "closed");
    const indexedRuntime = createAgentRuntimeFactory({
      config: {},
      deps: { startAgentRepl: indexedStartAgentRepl },
      skillOutcomeIndex: index,
    }).createAgentRuntime({ sessionId: "indexed-session" });
    await expect(indexedRuntime.startAgentSession()).resolves.toBe("closed");
    expect(indexedStartAgentRepl).toHaveBeenCalledWith(
      expect.objectContaining({ skillOutcomeIndex: index }),
    );
    const indexedServerRuntime = createAgentRuntimeFactory({
      config: {},
      skillOutcomeIndex: index,
    }).createServerRuntime({
      port: 18800,
      host: "127.0.0.1",
      token: "test-token",
    });
    expect(indexedServerRuntime.skillOutcomeIndex).toBe(index);
    expect(indexedServerRuntime.evolutionIngress).toBeNull();
    const rawBytes = fs
      .readdirSync(first.storage.rawDir, { recursive: true })
      .filter((entry) => String(entry).endsWith(".enc"))
      .map((entry) => fs.readFileSync(path.join(first.storage.rawDir, entry)));
    expect(rawBytes).toHaveLength(1);
    expect(
      Buffer.concat(rawBytes).includes(Buffer.from("private prompt")),
    ).toBe(false);

    const reopenedOptions = options(root);
    reopenedOptions.authorities.artifact = firstOptions.authorities.artifact;
    reopenedOptions.authorities.ledger = firstOptions.authorities.ledger;
    reopenedOptions.authorities.witness = firstOptions.authorities.witness;
    const reopened = createAgentEvolutionRuntimeComposition(reopenedOptions);
    expect(reopened.loadRun()).toEqual(first.loadRun());
    expect(reopened.ledgerDescriptor.ledgerTrust.keyId).not.toBe(
      reopened.ledgerDescriptor.witnessTrust.keyId,
    );
  }, 30_000);

  it("fails closed without every external production authority", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-agent-evolution-deny-"),
    );
    roots.push(root);
    const input = options(root);
    delete input.authorities.rawEncryptor;
    expect(() => createAgentEvolutionRuntimeComposition(input)).toThrow(
      /exactly the required ports/u,
    );
    expect(() => captureAgentEvolutionRuntimeComposition({})).toThrow(
      /branded/u,
    );
    expect(() =>
      createAgentRuntimeFactory({ config: {}, skillOutcomeIndex: {} }),
    ).toThrow(/branded Agent Skill outcome index/u);
    expect(() =>
      registerAgentCommand({}, { skillOutcomeIndex: { tenantId: "forged" } }),
    ).toThrow(/branded Agent Skill outcome index/u);
    expect(() =>
      registerAgentCommand(
        {},
        { skillVectorAuthority: { tenantId: "forged" } },
      ),
    ).toThrow(/branded Skill vector authority/u);
    expect(() =>
      createAgentRuntimeFactory({
        config: {},
        evolutionComposition: {},
      }),
    ).toThrow(/branded/u);
    await expect(
      resolveAgentCommandEvolutionComposition(null, {
        mode: "interactive",
      }),
    ).resolves.toBeNull();
    await expect(
      resolveAgentCommandEvolutionComposition(() => ({}), {
        mode: "interactive",
      }),
    ).rejects.toThrow(/branded/u);
    await expect(
      resolveAgentCommandEvolutionComposition(vi.fn(), {
        mode: "unsupported",
      }),
    ).rejects.toThrow(/mode is invalid/u);

    const missingMethod = options(root);
    missingMethod.authorities.sourceEnvelope = {};
    expect(() => createAgentEvolutionRuntimeComposition(missingMethod)).toThrow(
      /source envelope authority\.issue/u,
    );
    expect(
      fs.existsSync(path.join(root, encodeURIComponent(input.tenantId))),
    ).toBe(false);
  });

  it("routes one branded outcome index through single-turn and streaming headless runtimes", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-agent-outcome-headless-"),
    );
    roots.push(root);
    const composition = createAgentEvolutionRuntimeComposition(options(root));
    const index = assembleAgentSkillOutcomeIndex({
      sources: [{ composition, skillName: "repair-tests" }],
    });
    const vector = vectorAuthority(composition.tenantId);
    const runtime = createAgentRuntimeFactory({
      config: {},
      evolutionComposition: composition,
      skillOutcomeIndex: index,
      skillVectorAuthority: vector,
    }).createAgentRuntime();
    expect(runtime.skillVectorAuthority).toBe(vector);
    let singleTurnOptions = null;
    const singleTurnLoop = vi.fn(async function* (_messages, loopOptions) {
      singleTurnOptions = loopOptions;
      yield { type: "response-complete", content: "single complete" };
    });
    const singleResult = await runAgentHeadless(
      {
        prompt: "find the repair Skill",
        outputFormat: "text",
        ephemeral: true,
        skillOutcomeIndex: index,
        skillVectorAuthority: vector,
      },
      {
        agentLoop: singleTurnLoop,
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: vi.fn(),
        writeErr: vi.fn(),
      },
    );
    expect(singleResult).toMatchObject({
      exitCode: 0,
      result: "single complete",
    });
    expect(singleTurnOptions.skillOutcomeIndex).toBe(index);
    expect(singleTurnOptions.skillVectorAuthority).toBe(vector);

    async function* input() {
      yield `${JSON.stringify({ type: "user", text: "find it again" })}\n`;
    }
    let streamOptions = null;
    const streamLoop = vi.fn(async function* (_messages, loopOptions) {
      streamOptions = loopOptions;
      yield { type: "response-complete", content: "stream complete" };
      yield { type: "run-ended", reason: "complete" };
    });
    const streamResult = await runAgentHeadlessStream(
      {
        expandFileRefs: false,
        ephemeral: true,
        skillOutcomeIndex: index,
        skillVectorAuthority: vector,
      },
      {
        input: input(),
        agentLoop: streamLoop,
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: vi.fn(),
        writeErr: vi.fn(),
      },
    );
    expect(streamResult).toMatchObject({ exitCode: 0, turns: 1 });
    expect(streamOptions.skillOutcomeIndex).toBe(index);
    expect(streamOptions.skillVectorAuthority).toBe(vector);

    const foreignInput = options(root);
    foreignInput.tenantId = "tenant:foreign-headless";
    foreignInput.runId = "run:foreign-headless";
    const foreignComposition =
      createAgentEvolutionRuntimeComposition(foreignInput);
    const foreignIndex = assembleAgentSkillOutcomeIndex({
      sources: [{ composition: foreignComposition, skillName: "repair-tests" }],
    });
    const blockedLoop = vi.fn(async function* () {
      yield { type: "response-complete", content: "must not run" };
    });
    await expect(
      runAgentHeadless(
        {
          prompt: "cross tenant",
          evolutionIngress: composition.evolutionIngress,
          skillOutcomeIndex: foreignIndex,
        },
        { agentLoop: blockedLoop },
      ),
    ).rejects.toThrow(/must share one tenant/u);
    expect(blockedLoop).not.toHaveBeenCalled();
    await expect(
      runAgentHeadless(
        {
          prompt: "cross tenant vector",
          evolutionIngress: composition.evolutionIngress,
          skillVectorAuthority: vectorAuthority("tenant:foreign"),
        },
        { agentLoop: blockedLoop },
      ),
    ).rejects.toThrow(/retrieval authorities must share one tenant/u);
    expect(blockedLoop).not.toHaveBeenCalled();
    await expect(
      runAgentHeadlessStream(
        { skillOutcomeIndex: { tenantId: composition.tenantId, readers: [] } },
        { agentLoop: blockedLoop },
      ),
    ).rejects.toThrow(/branded Agent Skill outcome index/u);
    expect(blockedLoop).not.toHaveBeenCalled();
  }, 30_000);

  it("reopens a bounded historical source catalog with exact tenant and run binding", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-agent-outcome-catalog-"),
    );
    roots.push(root);
    const firstInput = options(root);
    firstInput.runId = "run:catalog-one";
    const secondInput = options(root);
    secondInput.runId = "run:catalog-two";
    createAgentEvolutionRuntimeComposition(firstInput);
    createAgentEvolutionRuntimeComposition(secondInput);
    const opened = [];
    const inputs = new Map([
      [firstInput.runId, firstInput],
      [secondInput.runId, secondInput],
    ]);
    const index = await assembleAgentSkillOutcomeIndexFromCatalog({
      tenantId: firstInput.tenantId,
      catalogAuthority: outcomeCatalogAuthority(
        [
          {
            runId: firstInput.runId,
            skillNames: ["repair-tests", "review-diff"],
          },
          { runId: secondInput.runId, skillNames: ["repair-tests"] },
        ],
        { tenantId: firstInput.tenantId },
      ),
      openComposition: async (context) => {
        expect(Object.isFrozen(context)).toBe(true);
        opened.push(context);
        return createAgentEvolutionRuntimeComposition(
          inputs.get(context.runId),
        );
      },
    });

    expect(opened).toEqual([
      { tenantId: firstInput.tenantId, runId: firstInput.runId },
      { tenantId: firstInput.tenantId, runId: secondInput.runId },
    ]);
    expect(index).toMatchObject({
      tenantId: firstInput.tenantId,
      readers: [expect.any(Object), expect.any(Object), expect.any(Object)],
    });
    expect(buildSkillOutcomeIndexAuthority(index)).toMatchObject({
      status: "verified-indexed",
      evidence: { sourceCount: 3, snapshotCount: 0 },
    });

    const opener = vi.fn(async () =>
      createAgentEvolutionRuntimeComposition(firstInput),
    );
    await expect(
      assembleAgentSkillOutcomeIndexFromCatalog({
        tenantId: firstInput.tenantId,
        catalogAuthority: outcomeCatalogAuthority(
          [
            { runId: firstInput.runId, skillNames: ["repair-tests"] },
            { runId: firstInput.runId, skillNames: ["review-diff"] },
          ],
          { tenantId: firstInput.tenantId },
        ),
        openComposition: opener,
      }),
    ).rejects.toThrow(/duplicate run/u);
    expect(opener).not.toHaveBeenCalled();
    await expect(
      assembleAgentSkillOutcomeIndexFromCatalog({
        tenantId: firstInput.tenantId,
        catalogAuthority: outcomeCatalogAuthority(
          [
            {
              runId: firstInput.runId,
              skillNames: Array.from(
                { length: 129 },
                (_value, position) => `skill-${position}`,
              ),
            },
          ],
          { tenantId: firstInput.tenantId },
        ),
        openComposition: opener,
      }),
    ).rejects.toThrow(/unbounded/u);
    expect(opener).not.toHaveBeenCalled();
    await expect(
      assembleAgentSkillOutcomeIndexFromCatalog({
        tenantId: firstInput.tenantId,
        catalogAuthority: outcomeCatalogAuthority(
          new Proxy(
            [{ runId: firstInput.runId, skillNames: ["repair-tests"] }],
            {},
          ),
          { tenantId: firstInput.tenantId },
        ),
        openComposition: opener,
      }),
    ).rejects.toThrow(/catalog is invalid/u);
    expect(opener).not.toHaveBeenCalled();
    await expect(
      assembleAgentSkillOutcomeIndexFromCatalog({
        tenantId: firstInput.tenantId,
        catalogAuthority: outcomeCatalogAuthority(
          [{ runId: secondInput.runId, skillNames: ["repair-tests"] }],
          { tenantId: firstInput.tenantId },
        ),
        openComposition: async () =>
          createAgentEvolutionRuntimeComposition(firstInput),
      }),
    ).rejects.toThrow(/unbound composition/u);
    await expect(
      assembleAgentSkillOutcomeIndexFromCatalog({
        tenantId: firstInput.tenantId,
        catalogAuthority: outcomeCatalogAuthority(
          [{ runId: firstInput.runId, skillNames: ["repair-tests"] }],
          { tenantId: firstInput.tenantId, authenticated: false },
        ),
        openComposition: opener,
      }),
    ).rejects.toThrow(/not authoritative/u);
    await expect(
      assembleAgentSkillOutcomeIndexFromCatalog({
        tenantId: firstInput.tenantId,
        catalogAuthority: {
          loadCatalog: async () => ({ authenticated: true, durable: true }),
        },
        openComposition: opener,
      }),
    ).rejects.toThrow(/branded Skill outcome source catalog authority/u);
    await expect(
      assembleAgentSkillOutcomeIndexFromCatalog({
        tenantId: firstInput.tenantId,
        catalogAuthority: outcomeCatalogAuthority(
          [{ runId: firstInput.runId, skillNames: ["repair-tests"] }],
          {
            tenantId: firstInput.tenantId,
            catalogDigest: digest("substituted-catalog"),
          },
        ),
        openComposition: opener,
      }),
    ).rejects.toThrow(/integrity is invalid/u);
  }, 30_000);
});
