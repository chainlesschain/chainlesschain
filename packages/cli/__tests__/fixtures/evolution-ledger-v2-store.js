// Explicit TEST-ONLY HMAC retention authority. Files make process restart and
// corruption observable; they do not simulate WORM or physical power-loss proof.
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
  EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETENTION_PROOF_SCHEMA,
  computeImmutableLedgerSegmentProofDigest,
  createImmutableLedgerSegmentProofVerifier,
  createImmutableLedgerSegmentStorePort,
} from "../../src/lib/evolution/evolution-immutable-ledger-segment-store.js";
import { createEvolutionLedgerManifestAuthority } from "../../src/lib/evolution/evolution-ledger-manifest-chain.js";
import { createEvolutionLedgerManifestCatalog } from "../../src/lib/evolution/evolution-ledger-manifest-catalog.js";
import { createEvolutionLedgerFileManifestCatalogBackend } from "../../src/lib/evolution/evolution-ledger-file-manifest-catalog.js";
import { createEvolutionLedgerManifestHeadStore } from "../../src/lib/evolution/evolution-ledger-manifest-head-store.js";
import { createEvolutionLedgerFileManifestHeadBackend } from "../../src/lib/evolution/evolution-ledger-file-manifest-head-store.js";
import { createEvolutionFileWitness } from "../../src/lib/evolution/evolution-file-witness.js";
import { createEvolutionLedgerManifestWitnessAdapter } from "../../src/lib/evolution/evolution-ledger-manifest-witness-adapter.js";
import { createEvolutionLedgerV2ManifestBackend } from "../../src/lib/evolution/evolution-ledger-v2-manifest-backend.js";
import {
  openEvolutionDurableStore,
  evolutionDurableStoreConfiguration,
} from "./evolution-durable-store.js";

export const V2_FIXTURE_RETENTION = "2036-09-09T00:00:00.000Z";
const hmac = (secret, value) =>
  createHmac("sha256", `test-only-v2-${secret}`)
    .update(value)
    .digest("base64url");
const digest = (letter) => `sha256:${letter.repeat(64)}`;

export function createLedgerV2FixtureBackend(root, request, options = {}) {
  const source = request.authority;
  const { fsImpl, clock } = evolutionDurableStoreConfiguration(root);
  const descriptor = {
    epoch: source.epoch,
    ledgerId: source.ledgerId,
    tenantId: request.descriptor.tenantId,
    maximumEventsPerSegment: options.maximumEventsPerSegment ?? 8,
  };
  const storage = path.join(root, "v2", source.ledgerId);
  const segmentDirectory = path.join(storage, "retained-segments");
  fs.mkdirSync(segmentDirectory, { recursive: true, mode: 0o700 });
  const counts = { retain: 0, catalog: 0, head: 0, witness: 0 };
  const fault = (phase) => options.fault?.(phase, counts);
  const storeDescriptor = {
    authorityId: "test-retention-authority",
    authorityRevision: 1,
    epoch: source.epoch,
    handlerArtifactDigest: digest("a"),
    immutabilityMode: "external-retention-authority",
    ledgerId: source.ledgerId,
    proofAlgorithm: "test-hmac-sha256",
    tenantId: descriptor.tenantId,
  };
  const segmentPath = (reference) =>
    path.join(segmentDirectory, `${reference.slice(7)}.json`);
  const segments = createImmutableLedgerSegmentStorePort({
    descriptor: storeDescriptor,
    proofVerifier: createImmutableLedgerSegmentProofVerifier({
      descriptor: {
        authorityId: storeDescriptor.authorityId,
        authorityRevision: 1,
        proofAlgorithm: "test-hmac-sha256",
        verifierArtifactDigest: digest("b"),
      },
      verify: (proof) =>
        proof.signature === hmac("retention", proof.proofDigest),
    }),
    backend: {
      retain(input) {
        counts.retain++;
        fault("before-retain");
        const proof = {
          authorityId: storeDescriptor.authorityId,
          authorityRevision: 1,
          contentDigest: input.contentDigest,
          epoch: input.epoch,
          issuedAt: new Date(clock()).toISOString(),
          ledgerId: input.ledgerId,
          proofAlgorithm: "test-hmac-sha256",
          proofDigest: digest("0"),
          retainedUntil: "2037-09-09T00:00:00.000Z",
          retentionMode: "compliance",
          schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETENTION_PROOF_SCHEMA,
          segmentRef: input.segmentRef,
          sequenceEnd: input.sequenceEnd,
          sequenceStart: input.sequenceStart,
          signature: "pending",
          storageVersion: "test-version-1",
          tenantId: input.tenantId,
        };
        proof.proofDigest = computeImmutableLedgerSegmentProofDigest(proof);
        proof.signature = hmac("retention", proof.proofDigest);
        const target = segmentPath(input.segmentRef);
        const serialized = JSON.stringify({
          bytes: Buffer.from(input.bytes).toString("base64"),
          proof,
        });
        if (!fs.existsSync(target))
          fs.writeFileSync(target, serialized, { flag: "wx", mode: 0o600 });
        else if (fs.readFileSync(target, "utf8") !== serialized)
          throw new Error("retained fixture content differs");
        fault("after-retain");
        return proof;
      },
      resolve(input) {
        const stored = JSON.parse(
          fs.readFileSync(segmentPath(input.segmentRef), "utf8"),
        );
        return {
          schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
          found: true,
          bytes: Buffer.from(stored.bytes, "base64"),
          proof: stored.proof,
        };
      },
    },
  });
  const authority = createEvolutionLedgerManifestAuthority({
    descriptor: {
      algorithm: "test-hmac-sha256",
      authorityId: "test-manifest-authority",
      revision: options.authorityRevision ?? 1,
    },
    sign: ({ digest: value }) => hmac("manifest", value),
    verify: ({ digest: value, signature }) =>
      signature === hmac("manifest", value),
  });
  const catalogBackend = createEvolutionLedgerFileManifestCatalogBackend({
    directoryPath: path.join(storage, "catalog"),
    fsImpl,
  });
  const catalog = createEvolutionLedgerManifestCatalog({
    descriptor,
    manifestAuthority: authority,
    backend: {
      ...catalogBackend,
      compareAndAppend(input) {
        const result = catalogBackend.compareAndAppend(input);
        counts.catalog++;
        fault("after-catalog");
        return result;
      },
    },
  });
  const headBackend = createEvolutionLedgerFileManifestHeadBackend({
    directoryPath: path.join(storage, "head"),
    fsImpl,
  });
  const headStore = createEvolutionLedgerManifestHeadStore({
    descriptor,
    authority,
    load: headBackend.load,
    compareAndSet(input) {
      const result = headBackend.compareAndSet(input);
      counts.head++;
      fault("after-head");
      return result;
    },
  });
  const witnessTrust = {
    algorithm: "hmac-sha256",
    keyId: "key://tests/v2-journal-witness",
    trustPolicyDigest: digest("c"),
  };
  const witness = createEvolutionFileWitness({
    filePath: path.join(storage, "witness", "checkpoint.json"),
    id: "test-v2-journal-witness",
    trust: witnessTrust,
    fsImpl,
    signer: {
      sign: ({ message }) => ({
        ...witnessTrust,
        value: hmac("witness", message),
      }),
    },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === witnessTrust.algorithm &&
        signature.keyId === witnessTrust.keyId &&
        signature.trustPolicyDigest === witnessTrust.trustPolicyDigest &&
        signature.value === hmac("witness", message),
    },
  });
  const witnessAdapter = createEvolutionLedgerManifestWitnessAdapter({
    manifestAuthority: authority,
    descriptor: {
      ...descriptor,
      identityDigest: source.identityDigest,
      manifestTrustKeyId: "key://tests/v2-journal-manifest",
      storeMarkerDigest: source.storeMarkerDigest,
      storeMarkerEntryDigest: source.storeMarkerEntryDigest,
      storeMarkerId: source.storeMarkerId,
      witnessTrust,
    },
    witness: {
      id: witness.id,
      read: witness.read.bind(witness),
      compareAndSwap(input) {
        const result = witness.compareAndSwap(input);
        counts.witness++;
        fault("after-witness");
        return result;
      },
    },
  });
  const backend = createEvolutionLedgerV2ManifestBackend({
    descriptor,
    catalog,
    headStore,
    manifestAuthority: authority,
    now: clock,
    segmentStore: segments,
    witnessAdapter,
  });
  return {
    backend,
    counts,
    segmentDirectory,
    storage,
    catalogBackend,
    headBackend,
    witness,
  };
}

export function openLedgerV2Fixture(root, options = {}) {
  let manifest;
  const value = openEvolutionDurableStore(root, {
    ...options,
    createManifestBackend(request) {
      manifest = createLedgerV2FixtureBackend(root, request, options);
      return manifest.backend;
    },
  });
  return { ...value, manifest, journal: value.backend.ledger };
}

export function v2FixtureDomainEvent(value, eventId) {
  const subject = value.artifactPorts.putCanonical(
    "evolution-ledger-v2-journal",
    { schema: "test-only-event", eventId },
    {
      audience: value.descriptor.audience,
      purpose: "evolution-ledger",
      retention: "ledger",
    },
  );
  return {
    artifactTenantId: value.descriptor.artifactTenantId,
    correlationId: null,
    decision: "committed",
    eventId,
    reason: `payload:${eventId}`,
    skillName: null,
    sourceRefs: [],
    subjectRef: subject.ref,
    tenantId: value.descriptor.tenantId,
    type: "test.v2-event",
  };
}
