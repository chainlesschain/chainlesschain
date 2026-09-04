import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ArtifactStore } from "../../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../../src/lib/evolution/evolution-ledger-file-backend.js";
import { EvolutionRawCryptoShred } from "../../../src/lib/evolution/evolution-raw-crypto-shred.js";
import {
  EVOLUTION_RAW_DELETION_RECEIPT_SCHEMA,
  EvolutionRawDeletionLedgerAdapter,
  digestEvolutionRawDeletionReceipt,
} from "../../../src/lib/evolution/evolution-raw-deletion-ledger-adapter.js";

const [root, operation] = process.argv.slice(2);
const NOW = "2026-09-05T13:00:00.000Z";
const TENANT_ID = "tenant:raw-deletion-process";
const ARTIFACT_TENANT_ID = "artifact-tenant-raw-deletion-process";
const RECEIPT_SECRET = "test-only-process-privacy-governor-secret";

fs.mkdirSync(root, { recursive: true });

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value = domain) {
  const bytes =
    arguments.length === 1 ? String(value) : `${domain}\0${canonical(value)}`;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function receiptSigningMaterial(receipt) {
  const core = { ...receipt };
  delete core.receiptDigest;
  core.attestation = { ...core.attestation };
  delete core.attestation.value;
  return canonical(core);
}

function deletionReceipt() {
  const unsigned = {
    schema: EVOLUTION_RAW_DELETION_RECEIPT_SCHEMA,
    tenantId: TENANT_ID,
    decision: "delete",
    evidenceRef: "evidence:cross-process-private",
    sourceDigest: digest("cross-process-source"),
    artifactRef: "artifact://trusted/cross-process-private",
    rawArtifactRef: `artifact://${TENANT_ID}/raw/cross-process-private`,
    rawCipherDigest: digest("cross-process-ciphertext"),
    keyRef: `kms://${TENANT_ID}/cross-process-private`,
    issuedAt: NOW,
    attestation: {
      algorithm: "hmac-sha256",
      issuer: "authority:process-privacy-governor",
      keyId: "key://tests/process-privacy-governor",
      trustPolicyDigest: digest("process-privacy-policy"),
      value: "pending",
    },
  };
  unsigned.attestation.value = createHmac("sha256", RECEIPT_SECRET)
    .update(receiptSigningMaterial({ ...unsigned, receiptDigest: "pending" }))
    .digest("base64url");
  return Object.freeze({
    ...unsigned,
    receiptDigest: digestEvolutionRawDeletionReceipt(unsigned),
  });
}

function signingAuthority(label) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/raw-deletion-process-${label}`,
    trustPolicyDigest: digest(`process-${label}-policy`),
  });
  const secret = `test-only-process-${label}-secret`;
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return Object.freeze({
    trust,
    signer: Object.freeze({
      sign: ({ message }) => Object.freeze({ ...trust, value: sign(message) }),
    }),
    verifier: Object.freeze({
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === sign(message),
    }),
  });
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -90_000;
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

function artifactPorts() {
  const secret = "test-only-process-raw-deletion-artifact-secret";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/process-raw-deletion-artifacts";
  const policyDigest = digest("process-raw-deletion-artifact-policy");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => Date.parse(NOW),
    }),
    audience: "evolution-runtime",
    tenantId: ARTIFACT_TENANT_ID,
    now: () => Date.parse(NOW),
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
          checkedAt: NOW,
          decisionExpiresAt: "2026-09-05T13:01:00.000Z",
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
}

function pruningCall(receipt) {
  const request = {
    tenantId: TENANT_ID,
    planDigest: digest("process-pruning-plan"),
    wikiStateDigest: digest("process-wiki-state"),
    operation: "crypto-shred",
    payload: {
      evidenceRef: receipt.evidenceRef,
      sourceDigest: receipt.sourceDigest,
      artifactRef: receipt.artifactRef,
      rawArtifactRef: receipt.rawArtifactRef,
      rawCipherDigest: receipt.rawCipherDigest,
      keyRef: receipt.keyRef,
      receiptDigest: receipt.receiptDigest,
    },
  };
  return Object.freeze({
    request,
    requestDigest: digest(
      "chainlesschain.governed-wiki-pruning-operation/v1",
      request,
    ),
  });
}

const artifacts = artifactPorts();
const resolver = artifacts.createEvolutionLedgerArtifactResolver({
  purpose: "evolution-ledger",
});
const witnessRoot = path.join(root, "witness");
fs.mkdirSync(witnessRoot, { recursive: true, mode: 0o700 });
const backend = createEvolutionLedgerFileBackend({
  rootDir: path.join(root, "ledger-events"),
  authorityRootDir: path.join(root, "ledger-authority"),
  witnessFilePath: path.join(witnessRoot, "checkpoint.json"),
  witnessId: "raw-deletion-process-witness",
  ledgerAuthority: signingAuthority("ledger"),
  witnessAuthority: signingAuthority("witness"),
  artifactResolver: resolver,
  fsImpl: durableFilesystem(),
  secure: false,
  clock: () => Date.parse(NOW),
});
const verifier = {
  verify({ receipt }) {
    const expected = createHmac("sha256", RECEIPT_SECRET)
      .update(receiptSigningMaterial(receipt))
      .digest("base64url");
    return receipt.attestation.value === expected;
  },
};
const adapter = new EvolutionRawDeletionLedgerAdapter({
  descriptor: {
    tenantId: TENANT_ID,
    artifactTenantId: ARTIFACT_TENANT_ID,
    streamId: "raw-deletion:process",
    audience: "evolution-runtime",
    purpose: "evolution-ledger",
    authorityId: "authority:process-privacy-deletion-ledger",
    revision: 1,
    handlerArtifactDigest: digest("process-raw-deletion-handler"),
  },
  artifactPorts: artifacts,
  ledger: backend.ledger,
  ledgerArtifactResolver: resolver,
  deletionReceiptVerifier: verifier,
  now: () => Date.parse(NOW),
});

const receipt = deletionReceipt();
const resultPath = path.join(root, "shred-result.json");

if (operation === "shred") {
  await adapter.retainDeletionReceipt({ receipt });
  const kmsStatePath = path.join(root, "kms-state.json");
  const shredder = new EvolutionRawCryptoShred({
    tenantId: TENANT_ID,
    ports: adapter.cryptoShredPorts({
      destroyKey: async (request) => {
        const state = {
          keyRef: request.keyRef,
          requestDigest: request.requestDigest,
          receiptDigest: digest("process-kms-destruction"),
        };
        fs.writeFileSync(kmsStatePath, JSON.stringify(state), "utf8");
        return {
          authenticated: true,
          durable: true,
          destroyed: true,
          ...state,
        };
      },
      confirmKeyDestroyed: async ({ keyRef, destructionReceiptDigest }) => {
        const state = JSON.parse(fs.readFileSync(kmsStatePath, "utf8"));
        if (
          state.keyRef !== keyRef ||
          state.receiptDigest !== destructionReceiptDigest
        ) {
          throw new Error("process KMS state binding failed");
        }
        return {
          authenticated: true,
          destroyed: true,
          keyRef,
          destructionReceiptDigest,
          receiptDigest: digest("process-kms-confirmation"),
        };
      },
    }),
  });
  const result = await shredder.shred(pruningCall(receipt));
  fs.writeFileSync(resultPath, JSON.stringify(result), "utf8");
  process.stdout.write(
    `${JSON.stringify({ ok: true, sequence: backend.ledger.verify().sequence, result })}\n`,
  );
} else if (operation === "verify") {
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const recoveredReceipt = await adapter.retainDeletionReceipt({ receipt });
  const resolvedReceipt = await adapter.resolveDeletionReceipt({
    tenantId: TENANT_ID,
    receiptDigest: receipt.receiptDigest,
  });
  const resolvedTombstone = await adapter.resolveTombstone({
    tenantId: TENANT_ID,
    tombstoneDigest: result.tombstoneDigest,
  });
  if (
    recoveredReceipt.recovered !== true ||
    resolvedReceipt.rawCipherDigest !== receipt.rawCipherDigest ||
    resolvedTombstone.tombstone.deletionReceiptDigest !==
      receipt.receiptDigest ||
    backend.ledger.verify().sequence !== 2
  ) {
    throw new Error("raw deletion process recovery did not converge");
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, recovered: true, sequence: 2 })}\n`,
  );
} else {
  throw new Error("unknown raw deletion worker operation");
}
