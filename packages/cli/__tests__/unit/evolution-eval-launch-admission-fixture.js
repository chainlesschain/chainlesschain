import {
  createHash,
  createHmac,
  generateKeyPairSync,
  sign as edSign,
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";

const NOW = "2026-09-05T08:00:00.000Z";
const TENANT_ID = "tenant:eval-child-evidence";
const ARTIFACT_TENANT_ID = "artifact-tenant-eval-child-evidence";
const roots = [];

export function cleanupEvalLaunchAdmissionFixtures() {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
}

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
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-eval-launch-admission-"),
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
  return { artifactPorts, backendOptions, resolver, root };
}

export function setupEvalLaunchAdmissionFixture() {
  // TEST authorities and a Windows directory-fsync shim; no production durability claim.
  const resources = storage();
  const backend = createEvolutionLedgerFileBackend(resources.backendOptions);
  const keys = generateKeyPairSync("ed25519");
  const descriptor = {
    tenantId: TENANT_ID,
    artifactTenantId: ARTIFACT_TENANT_ID,
    streamId: "eval-launch:stream",
    audience: "evolution-runtime",
    purpose: "evolution-ledger",
    planDigest: digest("effect-plan"),
    manifestDigest: digest("frozen-slot-manifest"),
    cohortId: "cohort:one",
    slotId: "slot:one",
    authorityId: "authority:test-launch",
    keyId: "key:test-launch",
    trustPolicyDigest: digest("launch-trust"),
  };
  const options = {
    descriptor,
    publicKey: keys.publicKey,
    signer: {
      sign: ({ message }) =>
        edSign(null, Buffer.from(message), keys.privateKey).toString(
          "base64url",
        ),
    },
    artifactPorts: resources.artifactPorts,
    ledger: backend.ledger,
    ledgerArtifactResolver: resources.resolver,
    now: () => Date.parse(NOW),
  };
  const input = {
    runId: "eval:one",
    runNonce: "nonce:one",
    requestDigest: digest("request:one"),
    policyDigest: digest("eval-policy"),
    evaluationAuthorityRoot: digest("eval-authority-root"),
    tenantId: TENANT_ID,
    admittedAt: NOW,
    deadlineAt: "2026-09-05T08:00:20.000Z",
  };
  return { resources, backend, options, input };
}

export function lookupEvalLaunchAdmission(input) {
  return {
    runId: input.runId,
    runNonce: input.runNonce,
    requestDigest: input.requestDigest,
  };
}
