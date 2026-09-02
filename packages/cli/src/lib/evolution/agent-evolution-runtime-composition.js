import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";

import { ArtifactStore } from "../artifact-store.js";
import {
  ArtifactStoreEncryptedRawStore,
  EvolutionEvidenceArtifactAdapter,
} from "./evolution-evidence-artifact-adapter.js";
import {
  EvolutionEvidenceBundleVerifier,
  EvolutionEvidenceProjector,
} from "./evolution-evidence-projector.js";
import { EvolutionArtifactPorts } from "./evolution-artifact-ports.js";
import {
  captureEvolutionLedgerFileBackend,
  createEvolutionLedgerFileBackend,
} from "./evolution-ledger-file-backend.js";
import { EvolutionRunLedgerAdapter } from "./evolution-run-ledger-adapter.js";
import {
  captureAgentEvolutionIngress,
  createAgentEvolutionIngress,
} from "./agent-evolution-ingress.js";
import { sealAgentEvolutionRuntimeComposition } from "./agent-evolution-runtime-composition-brand.js";

export {
  AGENT_EVOLUTION_RUNTIME_COMPOSITION_SCHEMA,
  captureAgentEvolutionRuntimeComposition,
} from "./agent-evolution-runtime-composition-brand.js";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const AUTHORITY_KEYS = new Set([
  "artifact",
  "attestationSigner",
  "attestationVerifier",
  "keyedCommitter",
  "ledger",
  "rawEncryptor",
  "sourceEnvelope",
  "sourceVerifier",
  "storagePolicy",
  "witness",
]);
const ARTIFACT_AUTHORITY_KEYS = new Set([
  "currentAuthorityResolver",
  "envelopeSigner",
  "envelopeVerifier",
]);

function exactRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Reflect.ownKeys(value).length !== keys.size ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !keys.has(key),
    )
  ) {
    throw new TypeError(`${label} must contain exactly the required ports`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${String(key)} must be a data property`);
    }
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function capture(owner, method, label) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  ) {
    throw new TypeError(`${label}.${method} port is required`);
  }
  const operation = owner[method];
  return Object.freeze((...args) => Reflect.apply(operation, owner, args));
}

function captureAuthority(authority, method, label) {
  return Object.freeze({ [method]: capture(authority, method, label) });
}

function normalizeClock(clock) {
  if (typeof clock !== "function" || utilTypes.isProxy(clock)) {
    throw new TypeError("clock must be a non-proxy function");
  }
  return Object.freeze(() => {
    const milliseconds = Number(clock());
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError("clock must return epoch milliseconds");
    }
    return milliseconds;
  });
}

function layout(stateRootDir, tenantId, runId) {
  if (typeof stateRootDir !== "string" || stateRootDir.trim() === "") {
    throw new TypeError("stateRootDir is required");
  }
  const rootDir = path.resolve(stateRootDir);
  const scope = path.join(
    rootDir,
    encodeURIComponent(tenantId),
    encodeURIComponent(runId),
  );
  const result = Object.freeze({
    rootDir,
    artifactDir: path.join(scope, "artifacts"),
    rawDir: path.join(scope, "raw"),
    ledgerRootDir: path.join(scope, "ledger-events"),
    ledgerAuthorityRootDir: path.join(scope, "ledger-authority"),
    witnessFilePath: path.join(scope, "witness", "checkpoint.json"),
  });
  fs.mkdirSync(path.dirname(result.witnessFilePath), {
    recursive: true,
    mode: 0o700,
  });
  return result;
}

function defaultWitnessId(tenantId, runId) {
  return `agent-evolution-${crypto
    .createHash("sha256")
    .update(`${tenantId}\0${runId}`, "utf8")
    .digest("hex")}`;
}

function assertIndependentSigningAuthorities(ledger, witness) {
  if (
    !ledger?.trust ||
    !witness?.trust ||
    ledger === witness ||
    ledger.signer === witness.signer ||
    ledger.verifier === witness.verifier ||
    ledger.trust === witness.trust ||
    ledger.trust.keyId === witness.trust.keyId ||
    ledger.trust.trustPolicyDigest === witness.trust.trustPolicyDigest
  ) {
    throw new TypeError(
      "ledger and witness production authorities must be independent",
    );
  }
}

/**
 * Production composition root for the CLI Agent evolution ingress.
 *
 * Every cryptographic, identity, policy, commitment and encryption operation
 * is supplied by the host. This module deliberately contains no local key,
 * permissive policy, environment fallback, or auto-enable path.
 */
export function createAgentEvolutionRuntimeComposition({
  tenantId: tenantIdInput,
  runId: runIdInput,
  audience: audienceInput = "evolution-runtime",
  stateRootDir,
  authorities: authorityInput,
  evidenceTtlMs,
  witnessId: witnessIdInput,
  clock: clockInput = Date.now,
  evidenceIdGenerator,
  ingressIdGenerator,
  secure = true,
  fsImpl,
  lock,
  random,
  lockTimeoutMs,
  witnessMaximumBytes,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const runId = identifier(runIdInput, "runId");
  const audience = identifier(audienceInput, "audience");
  const witnessId = identifier(
    witnessIdInput ?? defaultWitnessId(tenantId, runId),
    "witnessId",
  );
  const authorities = exactRecord(
    authorityInput,
    AUTHORITY_KEYS,
    "authorities",
  );
  const artifactAuthority = exactRecord(
    authorities.artifact,
    ARTIFACT_AUTHORITY_KEYS,
    "authorities.artifact",
  );
  const clock = normalizeClock(clockInput);
  if (
    typeof evidenceIdGenerator !== "function" ||
    utilTypes.isProxy(evidenceIdGenerator)
  ) {
    throw new TypeError("evidenceIdGenerator port is required");
  }
  if (
    typeof ingressIdGenerator !== "function" ||
    utilTypes.isProxy(ingressIdGenerator)
  ) {
    throw new TypeError("ingressIdGenerator port is required");
  }
  const ports = Object.freeze({
    artifactEnvelopeSigner: captureAuthority(
      artifactAuthority.envelopeSigner,
      "sign",
      "artifact envelope signer",
    ),
    artifactEnvelopeVerifier: captureAuthority(
      artifactAuthority.envelopeVerifier,
      "verify",
      "artifact envelope verifier",
    ),
    artifactCurrentAuthorityResolver: captureAuthority(
      artifactAuthority.currentAuthorityResolver,
      "resolve",
      "artifact current authority resolver",
    ),
    rawEncryptor: captureAuthority(
      authorities.rawEncryptor,
      "encrypt",
      "Raw encryptor",
    ),
    sourceEnvelope: captureAuthority(
      authorities.sourceEnvelope,
      "issue",
      "source envelope authority",
    ),
    sourceVerifier: captureAuthority(
      authorities.sourceVerifier,
      "verify",
      "source verifier",
    ),
    keyedCommitter: captureAuthority(
      authorities.keyedCommitter,
      "commit",
      "keyed committer",
    ),
    storagePolicy: captureAuthority(
      authorities.storagePolicy,
      "resolve",
      "storage policy",
    ),
    attestationSigner: captureAuthority(
      authorities.attestationSigner,
      "sign",
      "attestation signer",
    ),
    attestationVerifier: captureAuthority(
      authorities.attestationVerifier,
      "verify",
      "attestation verifier",
    ),
  });
  capture(authorities.ledger?.signer, "sign", "ledger signer");
  capture(authorities.ledger?.verifier, "verify", "ledger verifier");
  capture(authorities.witness?.signer, "sign", "witness signer");
  capture(authorities.witness?.verifier, "verify", "witness verifier");
  assertIndependentSigningAuthorities(authorities.ledger, authorities.witness);
  const storage = layout(stateRootDir, tenantId, runId);
  const artifactPorts = new EvolutionArtifactPorts({
    tenantId,
    audience,
    artifactStore: new ArtifactStore({
      dir: storage.artifactDir,
      now: clock,
    }),
    envelopeSigner: ports.artifactEnvelopeSigner,
    envelopeVerifier: ports.artifactEnvelopeVerifier,
    currentAuthorityResolver: ports.artifactCurrentAuthorityResolver,
    now: clock,
  });
  const rawStore = new ArtifactStoreEncryptedRawStore({
    tenantId,
    artifactStore: new ArtifactStore({
      dir: storage.rawDir,
      now: clock,
    }),
    encryptor: ports.rawEncryptor,
  });
  const projector = new EvolutionEvidenceProjector({
    sourceVerifier: ports.sourceVerifier,
    keyedCommitter: ports.keyedCommitter,
    storagePolicy: ports.storagePolicy,
    rawStore,
    attestationSigner: ports.attestationSigner,
    attestationVerifier: ports.attestationVerifier,
    idGenerator: evidenceIdGenerator,
    now: () => new Date(clock()),
  });
  const bundleVerifier = new EvolutionEvidenceBundleVerifier({
    attestationVerifier: ports.attestationVerifier,
    now: () => new Date(clock()),
  });
  const evidenceAdapter = new EvolutionEvidenceArtifactAdapter({
    tenantId,
    audience,
    projector,
    bundleVerifier,
    artifactPorts,
    ...(evidenceTtlMs === undefined ? {} : { ttlMs: evidenceTtlMs }),
  });
  const ledgerArtifactResolver =
    artifactPorts.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger",
    });
  const backend = createEvolutionLedgerFileBackend({
    rootDir: storage.ledgerRootDir,
    authorityRootDir: storage.ledgerAuthorityRootDir,
    witnessFilePath: storage.witnessFilePath,
    witnessId,
    ledgerAuthority: authorities.ledger,
    witnessAuthority: authorities.witness,
    artifactResolver: ledgerArtifactResolver,
    secure,
    clock,
    ...(fsImpl === undefined ? {} : { fsImpl }),
    ...(lock === undefined ? {} : { lock }),
    ...(random === undefined ? {} : { random }),
    ...(lockTimeoutMs === undefined ? {} : { lockTimeoutMs }),
    ...(witnessMaximumBytes === undefined ? {} : { witnessMaximumBytes }),
  });
  captureEvolutionLedgerFileBackend(backend);
  const runAdapter = new EvolutionRunLedgerAdapter({
    descriptor: {
      tenantId,
      artifactTenantId: tenantId,
      runId,
      audience,
      purpose: "evolution-ledger",
    },
    artifactPorts,
    ledger: backend.ledger,
    ledgerArtifactResolver,
    now: clock,
  });
  const evolutionIngress = createAgentEvolutionIngress({
    evidenceAdapter,
    runAdapter,
    sourceEnvelopeAuthority: ports.sourceEnvelope,
    now: () => new Date(clock()),
    idGenerator: ingressIdGenerator,
  });
  captureAgentEvolutionIngress(evolutionIngress, { tenantId });

  const composition = sealAgentEvolutionRuntimeComposition({
    tenantId,
    runId,
    evolutionIngress,
    loadRun: Object.freeze(() => runAdapter.load()),
    ledgerDescriptor: backend.descriptor,
    storage,
  });
  return composition;
}
