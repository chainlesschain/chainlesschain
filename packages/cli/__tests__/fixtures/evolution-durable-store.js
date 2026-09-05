import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";

const NOW = Date.parse("2026-09-05T00:00:00.000Z");
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
function authority(label) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const sign = (message) =>
    createHmac("sha256", `test-only-${label}`)
      .update(message)
      .digest("base64url");
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
  let nextDescriptor = -90_000;
  return {
    ...fs,
    closeSync(fd) {
      if (!directories.delete(fd)) return fs.closeSync(fd);
    },
    fsyncSync(fd) {
      if (directories.has(fd)) return;
      try {
        return fs.fsyncSync(fd);
      } catch (error) {
        if (
          process.platform !== "win32" ||
          !["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error.code) ||
          !fs.fstatSync(fd).isDirectory()
        )
          throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform !== "win32" ||
          flags !== "r" ||
          !["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error.code) ||
          !fs.statSync(target).isDirectory()
        )
          throw error;
        const fd = nextDescriptor--;
        directories.add(fd);
        return fd;
      }
    },
  };
}

// Test authorities only. Actual ArtifactStore, Ledger, signatures and witness
// files; directory-fsync compatibility is not a physical power-loss proof.
export function openEvolutionDurableStore(
  root,
  { tenantId = "tenant-pruning", streamId = "pruning" } = {},
) {
  const descriptor = Object.freeze({
    tenantId,
    artifactTenantId: "pruning-artifacts",
    streamId,
    audience: "evolution-runtime",
    purpose: "evolution-ledger",
  });
  const algorithm = "hmac-sha256";
  const keyId = "test:key/pruning-artifact";
  const policyDigest = digest("pruning-artifact-policy");
  const sign = (message) =>
    createHmac("sha256", "test-only-pruning-artifact")
      .update(message)
      .digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => NOW,
    }),
    audience: descriptor.audience,
    tenantId: descriptor.artifactTenantId,
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
          checkedAt: new Date(NOW).toISOString(),
          decisionExpiresAt: new Date(NOW + 60_000).toISOString(),
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
    },
  });
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  fs.mkdirSync(path.join(root, "witness"), { recursive: true, mode: 0o700 });
  const fsImpl = durableFilesystem();
  const backend = createEvolutionLedgerFileBackend({
    rootDir: path.join(root, "events"),
    authorityRootDir: path.join(root, "authority"),
    witnessFilePath: path.join(root, "witness", "checkpoint.json"),
    witnessId: "pruning-test-witness",
    ledgerAuthority: authority("pruning-ledger"),
    witnessAuthority: authority("pruning-witness"),
    artifactResolver: resolver,
    secure: false,
    fsImpl,
    clock: () => NOW,
  });
  return {
    descriptor,
    artifactPorts,
    resolver,
    backend,
    fsImpl,
    clock: () => NOW,
  };
}
