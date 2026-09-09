import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  createGovernedSkillSynthesisAttestorTrustLedger,
  createGovernedSkillSynthesisAttestorTrustVerifier,
  isGovernedSkillSynthesisAttestorTrustVerifier,
} from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-ledger.js";
import {
  createGovernedSkillSynthesisAttestorTrustOperations,
  createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer,
  isGovernedSkillSynthesisAttestorTrustOperations,
} from "../../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations.js";
import { createGovernedSkillSynthesisCandidateEvaluator } from "../../src/lib/evolution/governed-skill-synthesis-candidate-evaluator.js";
import {
  GOVERNED_SKILL_SYNTHESIS_EVALUATION_CORRUPT_CODE,
  createGovernedSkillSynthesisEvaluationLedgerAdapter,
} from "../../src/lib/evolution/governed-skill-synthesis-evaluation-ledger-adapter.js";
import { createGovernedSkillSynthesisExternalAttestationAuthority } from "../../src/lib/evolution/governed-skill-synthesis-external-attestor.js";
import { createGovernedSkillSynthesisModelEvaluator } from "../../src/lib/evolution/governed-skill-synthesis-model-evaluator.js";
import { createGovernedSkillSynthesisProviderChat } from "../../src/lib/evolution/governed-skill-synthesis-provider-chat.js";

const servicePath = fileURLToPath(
  new URL(
    "../../scripts/governed-learning-local-attestor-service.mjs",
    import.meta.url,
  ),
);
const roots = [];
const children = [];
const DESCRIPTOR = Object.freeze({
  tenantId: "tenant:attestor-trust-test",
  artifactTenantId: "tenant:attestor-trust-test",
  streamId: "learning-synthesis",
  audience: "evolution-runtime",
  purpose: "evolution-ledger",
  authorityId: "authority:attestor-trust-test-grader",
  revision: 1,
  handlerArtifactDigest: `sha256:${"d".repeat(64)}`,
});
const SERVICE_ID = "kms.attestor-trust.test";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function authority(label) {
  const secret = `test-only-${label}-secret`;
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const value = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
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
  let nextDescriptor = -60_000;
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

function resources(root) {
  const now = Date.now;
  const artifactSigning = authority("attestor-trust-artifact");
  const artifactPolicyDigest = digest("attestor-trust-artifact-policy");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now,
    }),
    audience: DESCRIPTOR.audience,
    tenantId: DESCRIPTOR.artifactTenantId,
    now,
    envelopeSigner: {
      sign: ({ message }) => {
        const signature = artifactSigning.signer.sign({ message });
        return {
          algorithm: signature.algorithm,
          keyId: signature.keyId,
          value: signature.value,
        };
      },
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        artifactSigning.verifier.verify({
          message,
          signature: {
            ...signature,
            trustPolicyDigest: artifactSigning.trust.trustPolicyDigest,
          },
        }),
    },
    currentAuthorityResolver: {
      resolve: (request) => {
        const checkedAt = new Date(now()).toISOString();
        const core = {
          action: request.action,
          algorithm: artifactSigning.trust.algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt,
          decisionExpiresAt: new Date(now() + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || artifactSigning.trust.keyId,
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
  });
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose: DESCRIPTOR.purpose,
  });
  const backend = createEvolutionLedgerFileBackend({
    rootDir: path.join(root, "events"),
    authorityRootDir: path.join(root, "authority"),
    witnessFilePath: path.join(root, "witness", "checkpoint.json"),
    witnessId: "attestor-trust-test-witness",
    ledgerAuthority: authority("attestor-trust-ledger"),
    witnessAuthority: authority("attestor-trust-witness"),
    artifactResolver: resolver,
    fsImpl: durableFilesystem(),
    secure: false,
  });
  return { artifactPorts, resolver, backend };
}

function endpoint(root) {
  const id = randomBytes(12).toString("hex");
  return process.platform === "win32"
    ? `\\\\.\\pipe\\cc-evolution-attestor-${id}`
    : path.join(root, `cc-evolution-attestor-${id}.sock`);
}

function waitForLine(stream, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let carry = "";
    const timer = setTimeout(
      () => reject(new Error("attestor service did not become ready")),
      timeoutMs,
    );
    stream.on("data", (chunk) => {
      carry += chunk.toString("utf8");
      const newline = carry.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      resolve(carry.slice(0, newline));
    });
    stream.once("error", reject);
  });
}

async function signer(root, keyPair) {
  const target = endpoint(root);
  const capabilityToken = randomBytes(32).toString("base64url");
  const privateKeyPem = keyPair.privateKey.export({
    type: "pkcs8",
    format: "pem",
  });
  const publicKeyPem = keyPair.publicKey.export({
    type: "spki",
    format: "pem",
  });
  const child = spawn(process.execPath, [servicePath], {
    env:
      process.platform === "win32"
        ? {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
          }
        : {},
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  child.stdin.end(
    `${JSON.stringify({
      endpoint: target,
      capabilityToken,
      serviceId: SERVICE_ID,
      privateKeyPem,
    })}\n`,
  );
  const ready = JSON.parse(await waitForLine(child.stdout));
  expect(ready).toMatchObject({ ok: true, serviceId: SERVICE_ID });
  return createGovernedSkillSynthesisExternalAttestationAuthority({
    endpoint: target,
    capabilityToken,
    publicKeyPem,
    serviceId: SERVICE_ID,
  });
}

function candidate(name) {
  const content = `---
name: ${name}
description: Review a service security configuration
version: 1.0.0
---

## Procedure
1. Read the configuration
2. Analyze the policy
3. Report every risky setting

## Pitfalls
- Do not disclose secrets

## Verification
Confirm every finding identifies its source key

## Metadata
- Source: governed attestor trust lifecycle test
`;
  return {
    skillName: name,
    content,
    pattern: { name, tools: ["read_config", "analyze_policy", "report"] },
    trajectory: {
      id: `trajectory-${name}`,
      toolChain: [
        { tool: "read_config" },
        { tool: "analyze_policy" },
        { tool: "report" },
      ],
    },
  };
}

function evaluator(attestationAuthority, evaluationLedger) {
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
    attestationAuthority,
    receiptPersistence: evaluationLedger.createReceiptPersistencePort(),
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("governed Skill synthesis attestor trust ledger", () => {
  it("supports an explicit single-operator policy for personal AI", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-attestor-personal-"),
    );
    roots.push(root);
    fs.mkdirSync(path.join(root, "witness"));
    const opened = resources(root);
    const trustLedger = createGovernedSkillSynthesisAttestorTrustLedger({
      descriptor: DESCRIPTOR,
      artifactPorts: opened.artifactPorts,
      ledger: opened.backend.ledger,
      ledgerArtifactResolver: opened.resolver,
    });
    const operator = generateKeyPairSync("ed25519");
    const attestor = generateKeyPairSync("ed25519");
    expect(() =>
      createGovernedSkillSynthesisAttestorTrustOperations({
        tenantId: "tenant:other-personal-ai",
        policyId: "policy:cross-tenant",
        revision: 1,
        requiredApprovals: 1,
        operatorIdentities: [
          {
            tenantId: "tenant:other-personal-ai",
            operatorId: "operator:owner",
            publicKey: operator.publicKey,
          },
        ],
        trustLedger,
      }),
    ).toThrow("crossed its tenant boundary");
    const operations = createGovernedSkillSynthesisAttestorTrustOperations({
      tenantId: DESCRIPTOR.tenantId,
      policyId: "policy:personal-ai",
      revision: 1,
      requiredApprovals: 1,
      operatorIdentities: [
        {
          tenantId: DESCRIPTOR.tenantId,
          operatorId: "operator:owner",
          publicKey: operator.publicKey,
        },
      ],
      trustLedger,
    });
    expect(isGovernedSkillSynthesisAttestorTrustOperations(operations)).toBe(
      true,
    );
    expect(operations.descriptor).toMatchObject({
      approvalMode: "single-operator",
      requiredApprovals: 1,
    });
    expect(operations).not.toHaveProperty("trustLedger");
    expect(operations).not.toHaveProperty("registerKey");
    const request = operations.prepare({
      operation: "register",
      serviceId: SERVICE_ID,
      publicKey: attestor.publicKey,
    });
    const issuer =
      createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer({
        tenantId: DESCRIPTOR.tenantId,
        operatorId: "operator:owner",
        privateKey: operator.privateKey,
      });
    const result = await operations.execute({
      request,
      approvals: [issuer.issue(request)],
    });
    expect(result.lifecycle).toMatchObject({
      authenticated: true,
      durable: true,
      recovered: false,
      operation: "register",
    });
    expect(result.authorization).toMatchObject({
      requiredApprovals: 1,
      operatorIds: ["operator:owner"],
      policyDigest: operations.descriptor.policyDigest,
      requestDigest: request.requestDigest,
    });
    expect(JSON.stringify(operations)).not.toContain("PRIVATE KEY");
  });

  it("enforces distinct signatures and prevents quorum downgrade", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-attestor-quorum-"),
    );
    roots.push(root);
    fs.mkdirSync(path.join(root, "witness"));
    const opened = resources(root);
    const trustLedger = createGovernedSkillSynthesisAttestorTrustLedger({
      descriptor: DESCRIPTOR,
      artifactPorts: opened.artifactPorts,
      ledger: opened.backend.ledger,
      ledgerArtifactResolver: opened.resolver,
    });
    const operatorA = generateKeyPairSync("ed25519");
    const operatorB = generateKeyPairSync("ed25519");
    const operatorC = generateKeyPairSync("ed25519");
    const identities = [
      ["operator:security", operatorA],
      ["operator:platform", operatorB],
      ["operator:reliability", operatorC],
    ].map(([operatorId, keys]) => ({
      tenantId: DESCRIPTOR.tenantId,
      operatorId,
      publicKey: keys.publicKey,
    }));
    const multi = createGovernedSkillSynthesisAttestorTrustOperations({
      tenantId: DESCRIPTOR.tenantId,
      policyId: "policy:production-two-person",
      revision: 7,
      requiredApprovals: 2,
      operatorIdentities: identities,
      trustLedger,
    });
    const single = createGovernedSkillSynthesisAttestorTrustOperations({
      tenantId: DESCRIPTOR.tenantId,
      policyId: "policy:personal-ai",
      revision: 1,
      requiredApprovals: 1,
      operatorIdentities: identities,
      trustLedger,
    });
    expect(multi.descriptor).toMatchObject({
      approvalMode: "multi-operator",
      requiredApprovals: 2,
    });
    const attestor = generateKeyPairSync("ed25519");
    const request = multi.prepare({
      operation: "register",
      serviceId: SERVICE_ID,
      publicKey: attestor.publicKey,
    });
    const issuerA =
      createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer({
        tenantId: DESCRIPTOR.tenantId,
        operatorId: "operator:security",
        privateKey: operatorA.privateKey,
      });
    const issuerB =
      createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer({
        tenantId: DESCRIPTOR.tenantId,
        operatorId: "operator:platform",
        privateKey: operatorB.privateKey,
      });
    const approvalA = issuerA.issue(request);
    const approvalB = issuerB.issue(request);
    await expect(
      multi.execute({ request, approvals: [approvalA] }),
    ).rejects.toThrow("requires exactly 2 approvals");
    await expect(
      multi.execute({ request, approvals: [approvalA, approvalA] }),
    ).rejects.toThrow("distinct active operators");
    const forgedApproval = structuredClone(approvalB);
    forgedApproval.attestation.value = `${
      forgedApproval.attestation.value.startsWith("A") ? "B" : "A"
    }${forgedApproval.attestation.value.slice(1)}`;
    await expect(
      multi.execute({
        request,
        approvals: [approvalA, forgedApproval],
      }),
    ).rejects.toThrow("approval signature is invalid");
    const downgradedRequest = single.prepare({
      operation: "register",
      serviceId: SERVICE_ID,
      publicKey: attestor.publicKey,
    });
    await expect(
      multi.execute({
        request: downgradedRequest,
        approvals: [issuerA.issue(downgradedRequest), approvalB],
      }),
    ).rejects.toThrow("request is not authorized");
    const tampered = structuredClone(request);
    tampered.serviceId = "kms.attestor-substituted.test";
    await expect(
      multi.execute({ request: tampered, approvals: [approvalA, approvalB] }),
    ).rejects.toThrow("request is not authorized");
    const result = await multi.execute({
      request,
      approvals: [approvalB, approvalA],
    });
    expect(result.lifecycle).toMatchObject({
      operation: "register",
      recovered: false,
    });
    expect(result.authorization.operatorIds).toEqual([
      "operator:platform",
      "operator:security",
    ]);
    expect(result.authorization.approvalReceiptDigests).toHaveLength(2);

    let expiryClock = Date.now();
    const expiring = createGovernedSkillSynthesisAttestorTrustOperations({
      tenantId: DESCRIPTOR.tenantId,
      policyId: "policy:expiring-personal-ai",
      revision: 1,
      requiredApprovals: 1,
      operatorIdentities: [identities[0]],
      trustLedger,
      requestTtlMs: 1_000,
      now: () => expiryClock,
    });
    const expiringIssuer =
      createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer({
        tenantId: DESCRIPTOR.tenantId,
        operatorId: "operator:security",
        privateKey: operatorA.privateKey,
        now: () => expiryClock,
      });
    const revoke = expiring.prepare({
      operation: "revoke",
      serviceId: SERVICE_ID,
      keyId: result.lifecycle.keyId,
      reason: "expiry boundary drill",
    });
    const revokeApproval = expiringIssuer.issue(revoke);
    expiryClock += 1_000;
    await expect(
      expiring.execute({ request: revoke, approvals: [revokeApproval] }),
    ).rejects.toThrow("request is not authorized");
  });

  it("allows only one concurrent rotation from the same active key", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-attestor-race-"),
    );
    roots.push(root);
    fs.mkdirSync(path.join(root, "witness"));
    const opened = resources(root);
    const trustLedger = createGovernedSkillSynthesisAttestorTrustLedger({
      descriptor: DESCRIPTOR,
      artifactPorts: opened.artifactPorts,
      ledger: opened.backend.ledger,
      ledgerArtifactResolver: opened.resolver,
    });
    const initial = generateKeyPairSync("ed25519");
    await expect(
      trustLedger.registerKey({
        serviceId: SERVICE_ID,
        publicKey: initial.privateKey,
      }),
    ).rejects.toThrow("publicKey must be Ed25519");
    const registered = await trustLedger.registerKey({
      serviceId: SERVICE_ID,
      publicKey: initial.publicKey,
    });
    const replacements = [
      generateKeyPairSync("ed25519"),
      generateKeyPairSync("ed25519"),
    ];
    const results = await Promise.allSettled(
      replacements.map((replacement, index) =>
        trustLedger.rotateKey({
          serviceId: SERVICE_ID,
          priorKeyId: registered.keyId,
          publicKey: replacement.publicKey,
          reason: `competing rotation ${index + 1}`,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const winnerIndex = results.findIndex(
      (result) => result.status === "fulfilled",
    );
    await expect(
      trustLedger.rotateKey({
        serviceId: SERVICE_ID,
        priorKeyId: registered.keyId,
        publicKey: replacements[winnerIndex].publicKey,
        reason: `competing rotation ${winnerIndex + 1}`,
      }),
    ).resolves.toMatchObject({ recovered: true });
  });

  it("binds rotation to Ledger order and makes explicit revocation retroactive", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-attestor-trust-"),
    );
    roots.push(root);
    fs.mkdirSync(path.join(root, "witness"));
    const opened = resources(root);
    const trustLedger = createGovernedSkillSynthesisAttestorTrustLedger({
      descriptor: DESCRIPTOR,
      artifactPorts: opened.artifactPorts,
      ledger: opened.backend.ledger,
      ledgerArtifactResolver: opened.resolver,
    });
    const firstKeys = generateKeyPairSync("ed25519");
    const secondKeys = generateKeyPairSync("ed25519");
    const registered = await trustLedger.registerKey({
      serviceId: SERVICE_ID,
      publicKey: firstKeys.publicKey,
    });
    await expect(
      trustLedger.registerKey({
        serviceId: SERVICE_ID,
        publicKey: firstKeys.publicKey,
      }),
    ).resolves.toMatchObject({ recovered: true });

    const verifier = trustLedger.createVerifier({ serviceId: SERVICE_ID });
    expect(isGovernedSkillSynthesisAttestorTrustVerifier(verifier)).toBe(true);
    expect(verifier).not.toHaveProperty("attestReceipt");
    const evaluationLedger =
      createGovernedSkillSynthesisEvaluationLedgerAdapter({
        descriptor: DESCRIPTOR,
        artifactPorts: opened.artifactPorts,
        ledger: opened.backend.ledger,
        ledgerArtifactResolver: opened.resolver,
        attestationAuthority: verifier,
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        const body = JSON.parse(options.body);
        const supplied = body.messages.at(-1).content;
        const candidateDigest = supplied.match(/sha256:[a-f0-9]{64}/u)?.[0];
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    candidate_digest: candidateDigest,
                    score: 0.96,
                    reasons: ["grounded-tools", "verifiable-outcome"],
                  }),
                },
              },
            ],
          }),
        };
      }),
    );

    const firstSigner = await signer(root, firstKeys);
    const first = await evaluator(
      firstSigner,
      evaluationLedger,
    )(candidate("security-review-first"));
    await expect(
      evaluationLedger.load(first.receipt.receiptDigest),
    ).resolves.toMatchObject({
      receipt: { receiptDigest: first.receipt.receiptDigest },
    });

    await expect(
      trustLedger.rotateKey({
        serviceId: SERVICE_ID,
        priorKeyId: `key:ed25519:${"0".repeat(64)}`,
        publicKey: secondKeys.publicKey,
        reason: "scheduled evaluation signer rotation",
      }),
    ).rejects.toThrow("prior key is not currently active");
    const rotated = await trustLedger.rotateKey({
      serviceId: SERVICE_ID,
      priorKeyId: registered.keyId,
      publicKey: secondKeys.publicKey,
      reason: "scheduled evaluation signer rotation",
    });
    await expect(
      trustLedger.rotateKey({
        serviceId: SERVICE_ID,
        priorKeyId: registered.keyId,
        publicKey: secondKeys.publicKey,
        reason: "scheduled evaluation signer rotation",
      }),
    ).resolves.toMatchObject({ recovered: true });
    await expect(
      evaluator(
        firstSigner,
        evaluationLedger,
      )(candidate("security-review-late-old-key")),
    ).rejects.toMatchObject({
      code: GOVERNED_SKILL_SYNTHESIS_EVALUATION_CORRUPT_CODE,
    });
    const second = await evaluator(
      await signer(root, secondKeys),
      evaluationLedger,
    )(candidate("security-review-second"));

    const reopened = resources(root);
    const reopenedTrust = createGovernedSkillSynthesisAttestorTrustLedger({
      descriptor: DESCRIPTOR,
      artifactPorts: reopened.artifactPorts,
      ledger: reopened.backend.ledger,
      ledgerArtifactResolver: reopened.resolver,
    });
    const reopenedVerifier = createGovernedSkillSynthesisAttestorTrustVerifier({
      descriptor: DESCRIPTOR,
      artifactPorts: reopened.artifactPorts,
      ledger: reopened.backend.ledger,
      ledgerArtifactResolver: reopened.resolver,
      serviceId: SERVICE_ID,
    });
    expect(reopenedVerifier).not.toHaveProperty("registerKey");
    expect(reopenedVerifier).not.toHaveProperty("rotateKey");
    expect(reopenedVerifier).not.toHaveProperty("revokeKey");
    const reopenedEvaluationLedger =
      createGovernedSkillSynthesisEvaluationLedgerAdapter({
        descriptor: DESCRIPTOR,
        artifactPorts: reopened.artifactPorts,
        ledger: reopened.backend.ledger,
        ledgerArtifactResolver: reopened.resolver,
        attestationAuthority: reopenedVerifier,
      });
    await expect(
      reopenedEvaluationLedger.load(first.receipt.receiptDigest),
    ).resolves.toMatchObject({
      receipt: { receiptDigest: first.receipt.receiptDigest },
    });
    await expect(
      reopenedEvaluationLedger.load(second.receipt.receiptDigest),
    ).resolves.toMatchObject({
      receipt: { receiptDigest: second.receipt.receiptDigest },
    });
    await expect(
      reopenedVerifier.verifyAttestation({
        receiptDigest: first.receipt.receiptDigest,
        candidateDigest: first.receipt.candidateDigest,
        descriptor: {
          authorityId: DESCRIPTOR.authorityId,
          revision: DESCRIPTOR.revision,
          handlerArtifactDigest: DESCRIPTOR.handlerArtifactDigest,
        },
        attestation: first.receipt.attestation,
      }),
    ).resolves.toBe(false);

    await reopenedTrust.revokeKey({
      serviceId: SERVICE_ID,
      keyId: registered.keyId,
      reason: "retired key compromise drill",
    });
    await expect(
      reopenedTrust.revokeKey({
        serviceId: SERVICE_ID,
        keyId: registered.keyId,
        reason: "retired key compromise drill",
      }),
    ).resolves.toMatchObject({ recovered: true });
    await expect(
      reopenedEvaluationLedger.load(first.receipt.receiptDigest),
    ).rejects.toMatchObject({
      code: GOVERNED_SKILL_SYNTHESIS_EVALUATION_CORRUPT_CODE,
    });
    await expect(
      reopenedEvaluationLedger.load(second.receipt.receiptDigest),
    ).resolves.toMatchObject({
      receipt: { receiptDigest: second.receipt.receiptDigest },
    });
    await expect(
      reopenedTrust.rotateKey({
        serviceId: SERVICE_ID,
        priorKeyId: rotated.keyId,
        publicKey: firstKeys.publicKey,
        reason: "must not reuse a revoked signer key",
      }),
    ).rejects.toThrow("cannot be reused");
    expect(rotated.operation).toBe("rotate");
  }, 60_000);
});
