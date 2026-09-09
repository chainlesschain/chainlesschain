import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import { createGovernedSkillSynthesisCandidateEvaluator } from "../../src/lib/evolution/governed-skill-synthesis-candidate-evaluator.js";
import {
  GovernedSkillSynthesisEvaluationLedgerAdapter,
  isGovernedSkillSynthesisEvaluationPersistenceReceipt,
} from "../../src/lib/evolution/governed-skill-synthesis-evaluation-ledger-adapter.js";
import { createGovernedSkillSynthesisModelEvaluator } from "../../src/lib/evolution/governed-skill-synthesis-model-evaluator.js";
import { createGovernedSkillSynthesisProviderChat } from "../../src/lib/evolution/governed-skill-synthesis-provider-chat.js";

const roots = [];
const DESCRIPTOR = Object.freeze({
  tenantId: "tenant-learning",
  artifactTenantId: "tenant-learning",
  streamId: "learning-synthesis",
  audience: "evolution-runtime",
  purpose: "evolution-ledger",
  authorityId: "authority:learning-grader",
  revision: 1,
  handlerArtifactDigest: `sha256:${"d".repeat(64)}`,
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function authority(label) {
  const secret = `test-only-${label}-secret`;
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const value = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: {
      sign: ({ message }) => ({ ...trust, value: value(message) }),
    },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === value(message),
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

function artifactAuthority(now) {
  const signing = authority("learning-evaluation-artifacts");
  const policyDigest = digest("learning-evaluation-artifact-policy");
  return {
    envelopeSigner: {
      sign: ({ message }) => {
        const signature = signing.signer.sign({ message });
        return {
          algorithm: signature.algorithm,
          keyId: signature.keyId,
          value: signature.value,
        };
      },
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signing.verifier.verify({
          message,
          signature: {
            ...signature,
            trustPolicyDigest: signing.trust.trustPolicyDigest,
          },
        }),
    },
    currentAuthorityResolver: {
      resolve: (request) => {
        const core = {
          action: request.action,
          algorithm: signing.trust.algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(now()).toISOString(),
          decisionExpiresAt: new Date(now() + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || signing.trust.keyId,
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
    },
  };
}

function openResources(root, ledgerOverride) {
  const now = Date.now;
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now,
    }),
    audience: DESCRIPTOR.audience,
    tenantId: DESCRIPTOR.artifactTenantId,
    now,
    ...artifactAuthority(now),
  });
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose: DESCRIPTOR.purpose,
  });
  const backend = createEvolutionLedgerFileBackend({
    rootDir: path.join(root, "events"),
    authorityRootDir: path.join(root, "authority"),
    witnessFilePath: path.join(root, "witness", "checkpoint.json"),
    witnessId: "learning-evaluation-witness",
    ledgerAuthority: authority("learning-evaluation-ledger"),
    witnessAuthority: authority("learning-evaluation-witness"),
    artifactResolver: resolver,
    fsImpl: durableFilesystem(),
    secure: false,
  });
  const verifyAttestation = async ({ receiptDigest, attestation }) =>
    attestation === `attested:${receiptDigest}`;
  const adapter = new GovernedSkillSynthesisEvaluationLedgerAdapter({
    descriptor: DESCRIPTOR,
    artifactPorts,
    ledger: ledgerOverride?.(backend.ledger) ?? backend.ledger,
    ledgerArtifactResolver: resolver,
    verifyAttestation,
  });
  return { adapter, backend, verifyAttestation };
}

function request() {
  const content = `---
name: review-security-config
description: Review service security configuration
version: 1.0.0
---

## Procedure
1. Read the configuration
2. Analyze the policy
3. Report findings

## Pitfalls
- Do not infer settings that were not observed

## Verification
Confirm every finding identifies its source key

## Metadata
- Source: trajectory
`;
  return {
    skillName: "review-security-config",
    content,
    pattern: {
      name: "review-security-config",
      tools: ["read_config", "analyze_policy", "report_findings"],
    },
    trajectory: {
      id: "trajectory-ledger-reopen",
      toolChain: [
        { tool: "read_config" },
        { tool: "analyze_policy" },
        { tool: "report_findings" },
      ],
    },
  };
}

function evaluator(resources) {
  const candidate = request();
  const candidateDigest = digest(candidate.content);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                candidate_digest: candidateDigest,
                score: 0.94,
                reasons: ["grounded-tools", "verifiable-outcome"],
              }),
            },
          },
        ],
      }),
    })),
  );
  return createGovernedSkillSynthesisModelEvaluator({
    allowSameProcessGrader: true,
    descriptor: {
      authorityId: DESCRIPTOR.authorityId,
      revision: DESCRIPTOR.revision,
      handlerArtifactDigest: DESCRIPTOR.handlerArtifactDigest,
    },
    deterministicEvaluator: createGovernedSkillSynthesisCandidateEvaluator(),
    graderChat: createGovernedSkillSynthesisProviderChat({
      provider: "volcengine",
      model: "doubao-test",
      apiKey: "test-only-key",
    }),
    minScore: 0.8,
    attestReceipt: async ({ receiptDigest }) => `attested:${receiptDigest}`,
    verifyAttestation: resources.verifyAttestation,
    receiptPersistence: resources.adapter.createReceiptPersistencePort(),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("GovernedSkillSynthesisEvaluationLedgerAdapter", () => {
  it("continues to verify v2 receipts that delivered the process credential through bounded stdin", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-learning-eval-v2-"),
    );
    roots.push(root);
    fs.mkdirSync(path.join(root, "witness"), { mode: 0o700 });
    const resources = openResources(root);
    const current = (await evaluator(resources)(request())).receipt;
    const currentCore = structuredClone(current);
    for (const key of [
      "attestation",
      "authenticated",
      "durable",
      "graderCredentialMaxUses",
      "graderCredentialResolverArtifactDigest",
      "graderCredentialTargetHost",
      "graderCredentialTtlMs",
      "receiptDigest",
    ]) {
      delete currentCore[key];
    }
    const core = {
      ...currentCore,
      schema: "chainlesschain.governed-skill-synthesis-evaluation-receipt/v2",
      graderIsolation: "process",
      graderProvider: "volcengine",
      graderModel: "doubao-test",
      graderWorkerArtifactDigest: `sha256:${"e".repeat(64)}`,
      graderInheritedEnvironment: false,
      graderCredentialDelivery: "bounded-stdin",
      graderHardDeadlineEnforced: true,
      graderSandboxProfile: "network-only",
      graderRequiredSandboxBoundaries: [
        "privilege-reduction",
        "process-tree",
        "resource-limits",
      ],
      graderPersistentProcessAuditRequired: true,
    };
    const receiptDigest = digest(`${core.schema}\0${canonical(core)}`);
    const receipt = {
      ...core,
      receiptDigest,
      attestation: `attested:${receiptDigest}`,
      authenticated: true,
      durable: false,
    };

    await expect(
      resources.adapter.createReceiptPersistencePort()(receipt),
    ).resolves.toMatchObject({
      receiptDigest,
      durable: true,
      persisted: true,
    });
  });

  it("reopens an authenticated receipt through real ArtifactStore, Ledger, and witness files", async () => {
    const root = fs.mkdtempSync(
      path.join(
        fs.realpathSync.native(os.tmpdir()),
        "cc-learning-eval-reopen-",
      ),
    );
    roots.push(root);
    fs.mkdirSync(path.join(root, "witness"), { mode: 0o700 });
    const first = openResources(root);
    const result = await evaluator(first)(request());

    expect(result).toMatchObject({
      accepted: true,
      persistence: { durable: true, recovered: false },
    });
    expect(first.backend.ledger.verify()).toMatchObject({ sequence: 1 });

    const reopened = openResources(root);
    const loaded = await reopened.adapter.load(result.receipt.receiptDigest);
    expect(reopened.backend.ledger.verify()).toMatchObject({ sequence: 1 });
    expect(loaded.receipt).toEqual(result.receipt);
    expect(loaded.persistence).toMatchObject({
      authenticated: true,
      durable: true,
      persisted: true,
      recovered: true,
    });
    expect(
      isGovernedSkillSynthesisEvaluationPersistenceReceipt(loaded.persistence),
    ).toBe(true);
  });

  it("recovers idempotently after the Ledger committed but its response was lost", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-learning-eval-loss-"),
    );
    roots.push(root);
    fs.mkdirSync(path.join(root, "witness"), { mode: 0o700 });
    let lost = false;
    const first = openResources(root, (ledger) => ({
      read: (...args) => ledger.read(...args),
      verify: (...args) => ledger.verify(...args),
      appendDomainEvent: (...args) => {
        ledger.appendDomainEvent(...args);
        lost = true;
        throw new Error("simulated append response loss");
      },
    }));
    await expect(evaluator(first)(request())).rejects.toThrow(
      "simulated append response loss",
    );
    expect(lost).toBe(true);
    expect(first.backend.ledger.verify()).toMatchObject({ sequence: 1 });

    const reopened = openResources(root);
    const recovered = await evaluator(reopened)(request());
    expect(recovered.persistence).toMatchObject({
      durable: true,
      recovered: true,
    });
    expect(reopened.backend.ledger.verify()).toMatchObject({ sequence: 1 });
  });
});
