import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_EVAL_CHILD_EVIDENCE_CORRUPT_CODE,
  EvolutionEvalChildEvidenceLedgerAdapter,
} from "../../src/lib/evolution/evolution-eval-child-evidence-ledger-adapter.js";
import {
  EVOLUTION_EVAL_ATTESTATION_PURPOSES,
  EVOLUTION_EVAL_RECEIPT_SCHEMA,
  EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA,
  EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA,
  computeEvolutionEvalSignedEvidenceDigest,
  computeEvolutionEvalReceiptDigest,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";

const NOW = "2026-09-05T08:00:00.000Z";
const TENANT_ID = "tenant:eval-child-evidence";
const ARTIFACT_TENANT_ID = "artifact-tenant-eval-child-evidence";
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value = domain) {
  const input =
    arguments.length === 1 ? String(value) : `${domain}\0${canonical(value)}`;
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

function authority(label) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const secret = `test-only-${label}-secret`;
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: { sign: ({ message }) => ({ ...trust, value: sign(message) }) },
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
        )
          return;
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

function storage() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-eval-child-ledger-"),
  );
  roots.push(root);
  const now = Date.parse(NOW);
  const secret = "test-only-eval-child-artifact-key";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/eval-child-artifacts";
  const policyDigest = digest("eval-child-artifact-policy");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: "evolution-runtime",
    tenantId: ARTIFACT_TENANT_ID,
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
          checkedAt: NOW,
          decisionExpiresAt: "2026-09-05T08:00:30.000Z",
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
            "chainlesschain.evolution-artifact-authority-decision/v1",
            core,
          ),
        };
      },
    },
  });
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  const witnessDirectory = path.join(root, "witness");
  fs.mkdirSync(witnessDirectory, { mode: 0o700 });
  const backendOptions = {
    rootDir: path.join(root, "ledger-events"),
    authorityRootDir: path.join(root, "ledger-authority"),
    witnessFilePath: path.join(witnessDirectory, "checkpoint.json"),
    witnessId: "witness-eval-child-evidence",
    ledgerAuthority: authority("eval-child-ledger"),
    witnessAuthority: authority("eval-child-witness"),
    artifactResolver: resolver,
    clock: () => now,
    fsImpl: durableFilesystem(),
    secure: false,
  };
  return { artifactPorts, backendOptions, resolver };
}

function adapter(resources, ledger) {
  return new EvolutionEvalChildEvidenceLedgerAdapter({
    descriptor: {
      tenantId: TENANT_ID,
      artifactTenantId: ARTIFACT_TENANT_ID,
      streamId: "eval-child-stream:one",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
      authorityId: "authority:eval-child-evidence",
      revision: 1,
      handlerArtifactDigest: digest("eval-child-handler"),
    },
    artifactPorts: resources.artifactPorts,
    ledger,
    ledgerArtifactResolver: resources.resolver,
    now: () => Date.parse(NOW),
  });
}

function evidence(kind) {
  if (kind === "gate-receipt") {
    const core = {
      schema: EVOLUTION_EVAL_RECEIPT_SCHEMA,
      runId: "run:child-receipt",
      runNonce: "nonce:child-receipt",
      tenantId: TENANT_ID,
      decision: "accepted",
      attestation: {
        algorithm: "ed25519",
        issuer: "authority:gate-receipt",
        keyId: "key:gate-receipt",
        trustPolicyDigest: digest("gate-receipt-policy"),
        value: "signed-gate-receipt-value-00000000000000000000",
      },
    };
    return Object.freeze({
      ...core,
      receiptDigest: computeEvolutionEvalReceiptDigest(core),
    });
  }
  const invocation = kind === "invocation";
  return Object.freeze({
    schema: invocation
      ? EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA
      : EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA,
    requestDigest: digest("request"),
    capabilityDigest: digest("capability"),
    invocationId: "invocation:one",
    authorityRevision: invocation ? "invocation-v1" : "revocation-v1",
    attestation: {
      algorithm: "ed25519",
      issuer: "authority:child-evidence",
      keyId: "key:child-evidence",
      trustPolicyDigest: digest("child-evidence-policy"),
      value: "signed-child-evidence-value-00000000000000000000",
    },
  });
}

describe("EvolutionEvalChildEvidenceLedgerAdapter", () => {
  it("reopens Gate receipts and target evidence through real Ledger files and witness", async () => {
    const resources = storage();
    const firstBackend = createEvolutionLedgerFileBackend(
      resources.backendOptions,
    );
    const first = adapter(resources, firstBackend.ledger);
    const invocation = evidence("invocation");
    const revocation = evidence("revocation");
    const gateReceipt = evidence("gate-receipt");
    const invocationDigest = computeEvolutionEvalSignedEvidenceDigest(
      invocation,
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation,
    );
    const revocationDigest = computeEvolutionEvalSignedEvidenceDigest(
      revocation,
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation,
    );
    const gateReceiptDigest = gateReceipt.receiptDigest;
    await expect(
      first.retain({
        kind: "invocation",
        evidence: invocation,
        receiptDigest: invocationDigest,
      }),
    ).resolves.toMatchObject({ authenticated: true, durable: true });
    await expect(
      first.retain({
        kind: "revocation",
        evidence: revocation,
        receiptDigest: revocationDigest,
      }),
    ).resolves.toMatchObject({ authenticated: true, durable: true });
    await expect(
      first.retain({
        kind: "gate-receipt",
        evidence: gateReceipt,
        receiptDigest: gateReceiptDigest,
      }),
    ).resolves.toMatchObject({ authenticated: true, durable: true });
    expect(firstBackend.ledger.verify()).toMatchObject({ sequence: 3 });

    const reopenedBackend = createEvolutionLedgerFileBackend(
      resources.backendOptions,
    );
    const reopened = adapter(resources, reopenedBackend.ledger);
    await expect(
      reopened.resolve({
        tenantId: TENANT_ID,
        kind: "invocation",
        receiptDigest: invocationDigest,
      }),
    ).resolves.toMatchObject({
      authenticated: true,
      durable: true,
      evidence: invocation,
    });
    await expect(
      reopened.resolve({
        tenantId: TENANT_ID,
        kind: "revocation",
        receiptDigest: revocationDigest,
      }),
    ).resolves.toMatchObject({ evidence: revocation });
    await expect(
      reopened.resolve({
        tenantId: TENANT_ID,
        kind: "gate-receipt",
        receiptDigest: gateReceiptDigest,
      }),
    ).resolves.toMatchObject({ evidence: gateReceipt });
    expect(reopenedBackend.ledger.verify()).toMatchObject({ sequence: 3 });
  });

  it("rejects cross-tenant resolution and digest substitution", async () => {
    const resources = storage();
    const backend = createEvolutionLedgerFileBackend(resources.backendOptions);
    const subject = adapter(resources, backend.ledger);
    const invocation = evidence("invocation");
    await expect(
      subject.retain({
        kind: "invocation",
        evidence: invocation,
        receiptDigest: digest("substituted"),
      }),
    ).rejects.toThrow("digest does not match");
    await expect(
      subject.resolve({
        tenantId: "tenant:other",
        kind: "invocation",
        receiptDigest: digest("missing"),
      }),
    ).rejects.toThrow("resolution request is invalid");
    await expect(
      subject.resolve({
        tenantId: TENANT_ID,
        kind: "invocation",
        receiptDigest: digest("missing"),
      }),
    ).rejects.toMatchObject({
      code: EVOLUTION_EVAL_CHILD_EVIDENCE_CORRUPT_CODE,
    });
  });
});
