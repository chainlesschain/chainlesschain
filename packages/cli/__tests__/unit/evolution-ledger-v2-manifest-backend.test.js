import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
  EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETENTION_PROOF_SCHEMA,
  computeImmutableLedgerSegmentProofDigest,
  createImmutableLedgerSegmentProofVerifier,
  createImmutableLedgerSegmentStorePort,
} from "../../src/lib/evolution/evolution-immutable-ledger-segment-store.js";
import { createEvolutionFileWitness } from "../../src/lib/evolution/evolution-file-witness.js";
import {
  EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA,
  createEvolutionLedgerManifestCatalog,
} from "../../src/lib/evolution/evolution-ledger-manifest-catalog.js";
import { createEvolutionLedgerManifestAuthority } from "../../src/lib/evolution/evolution-ledger-manifest-chain.js";
import {
  EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA,
  createEvolutionLedgerManifestHeadStore,
} from "../../src/lib/evolution/evolution-ledger-manifest-head-store.js";
import { createEvolutionLedgerManifestWitnessAdapter } from "../../src/lib/evolution/evolution-ledger-manifest-witness-adapter.js";
import {
  EVOLUTION_LEDGER_V2_MANIFEST_COMMIT_UNKNOWN_CODE,
  EVOLUTION_LEDGER_V2_MANIFEST_CONFLICT_SCHEMA,
  EVOLUTION_LEDGER_V2_MANIFEST_APPEND_RECEIPT_SCHEMA,
  createEvolutionLedgerV2ManifestBackend,
} from "../../src/lib/evolution/evolution-ledger-v2-manifest-backend.js";

const STORE_SECRET = "v2-backend-store-secret";
const MANIFEST_SECRET = "v2-backend-manifest-secret";
const MINIMUM_RETENTION = "2036-09-09T00:00:00.000Z";
const RETAINED_UNTIL = "2037-09-09T00:00:00.000Z";
const HANDLER_DIGEST = `sha256:${"a".repeat(64)}`;
const VERIFIER_DIGEST = `sha256:${"b".repeat(64)}`;

function hmac(secret, value) {
  return `hmac-sha256:${createHmac("sha256", secret).update(value).digest("hex")}`;
}

function digest(letter) {
  return `sha256:${letter.repeat(64)}`;
}

function descriptor() {
  return {
    epoch: "epoch-v2",
    ledgerId: "ledger-v2",
    maximumEventsPerSegment: 3,
    tenantId: "tenant-v2",
  };
}

function proof(request) {
  const value = {
    authorityId: "v2-worm-fixture",
    authorityRevision: 1,
    contentDigest: request.contentDigest,
    epoch: request.epoch,
    issuedAt: "2026-09-09T00:00:00.000Z",
    ledgerId: request.ledgerId,
    proofAlgorithm: "test-hmac-sha256",
    proofDigest: `sha256:${"0".repeat(64)}`,
    retainedUntil: RETAINED_UNTIL,
    retentionMode: "compliance",
    schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETENTION_PROOF_SCHEMA,
    segmentRef: request.segmentRef,
    sequenceEnd: request.sequenceEnd,
    sequenceStart: request.sequenceStart,
    signature: "pending",
    storageVersion: "version-1",
    tenantId: request.tenantId,
  };
  value.proofDigest = computeImmutableLedgerSegmentProofDigest(value);
  value.signature = hmac(STORE_SECRET, value.proofDigest);
  return Object.freeze(value);
}

function segmentStore() {
  const records = new Map();
  const backend = {
    retain: vi.fn((request) => {
      const retained = proof(request);
      records.set(request.segmentRef, {
        bytes: Buffer.from(request.bytes),
        proof: retained,
      });
      return retained;
    }),
    resolve: vi.fn((request) => {
      const record = records.get(request.segmentRef);
      return record
        ? {
            bytes: Buffer.from(record.bytes),
            found: true,
            proof: record.proof,
            schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
          }
        : {
            bytes: Buffer.from("missing"),
            found: false,
            proof: proof(request),
            schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
          };
    }),
  };
  const proofVerifier = createImmutableLedgerSegmentProofVerifier({
    descriptor: {
      authorityId: "v2-worm-fixture",
      authorityRevision: 1,
      proofAlgorithm: "test-hmac-sha256",
      verifierArtifactDigest: VERIFIER_DIGEST,
    },
    verify(value) {
      return value.signature === hmac(STORE_SECRET, value.proofDigest);
    },
  });
  return {
    backend,
    store: createImmutableLedgerSegmentStorePort({
      backend,
      descriptor: {
        authorityId: "v2-worm-fixture",
        authorityRevision: 1,
        epoch: "epoch-v2",
        handlerArtifactDigest: HANDLER_DIGEST,
        immutabilityMode: "external-retention-authority",
        ledgerId: "ledger-v2",
        proofAlgorithm: "test-hmac-sha256",
        tenantId: "tenant-v2",
      },
      proofVerifier,
    }),
  };
}

function manifestAuthority() {
  return createEvolutionLedgerManifestAuthority({
    descriptor: {
      algorithm: "test-hmac-sha256",
      authorityId: "v2-manifest-authority",
      revision: 1,
    },
    sign({ digest: value }) {
      return hmac(MANIFEST_SECRET, value);
    },
    verify({ digest: value, signature }) {
      return signature === hmac(MANIFEST_SECRET, value);
    },
  });
}

function headStore(authority, options = {}) {
  let stored = null;
  const load = vi.fn(() => stored);
  const compareAndSet = vi.fn((request) => {
    if (options.compare)
      return options.compare({
        request,
        stored,
        set: (head) => (stored = head),
      });
    if ((stored?.headDigest ?? null) !== request.expectedHeadDigest) {
      return {
        committed: false,
        head: stored,
        schema: EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA,
      };
    }
    stored = request.nextHead;
    return {
      committed: true,
      head: stored,
      schema: EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA,
    };
  });
  return {
    compareAndSet,
    store: createEvolutionLedgerManifestHeadStore({
      authority,
      compareAndSet,
      descriptor: descriptor(),
      load,
    }),
  };
}

function realWitness(root) {
  const trust = {
    algorithm: "hmac-sha256",
    keyId: "key://tests/v2-backend-witness",
    trustPolicyDigest: digest("9"),
  };
  const signer = {
    sign({ message }) {
      return {
        ...trust,
        value: createHmac("sha256", "v2-backend-witness-secret")
          .update(message)
          .digest("base64url"),
      };
    },
  };
  const verifier = {
    verify({ message, signature, trust: requestTrust }) {
      return (
        requestTrust.algorithm === trust.algorithm &&
        requestTrust.keyId === trust.keyId &&
        requestTrust.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value ===
          createHmac("sha256", "v2-backend-witness-secret")
            .update(message)
            .digest("base64url")
      );
    },
  };
  const directory = path.join(root, "witness-authority");
  fs.mkdirSync(directory, { mode: 0o700 });
  return {
    trust,
    witness: createEvolutionFileWitness({
      filePath: path.join(directory, "witness.json"),
      id: "v2-backend-witness",
      signer,
      trust,
      verifier,
    }),
  };
}

function witnessDescriptor(trust) {
  return {
    epoch: "epoch-v2",
    identityDigest: digest("1"),
    ledgerId: "ledger-v2",
    manifestTrustKeyId: "key://tests/v2-manifest-authority",
    maximumEventsPerSegment: 3,
    storeMarkerDigest: digest("2"),
    storeMarkerEntryDigest: digest("3"),
    storeMarkerId: "v2-backend-store-marker",
    tenantId: "tenant-v2",
    witnessTrust: trust,
  };
}

function fixture(root, { catalogPort, witnessPort } = {}) {
  const authority = manifestAuthority();
  const segments = segmentStore();
  const heads = headStore(authority);
  const manifests = [];
  const defaultCatalogPort = {
    compareAndAppend(request) {
      const latest = manifests.at(-1) ?? null;
      if ((latest?.manifestDigest ?? null) !== request.expectedManifestDigest) {
        return {
          appended: false,
          latest,
          schema: EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA,
        };
      }
      manifests.push(request.manifest);
      return {
        appended: true,
        latest: request.manifest,
        schema: EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA,
      };
    },
    list() {
      return [...manifests];
    },
    loadLatest() {
      return manifests.at(-1) ?? null;
    },
  };
  const catalog = createEvolutionLedgerManifestCatalog({
    backend: catalogPort?.(manifests, defaultCatalogPort) ?? defaultCatalogPort,
    descriptor: descriptor(),
    manifestAuthority: authority,
  });
  const { trust, witness } = realWitness(root);
  const witnessAdapter = createEvolutionLedgerManifestWitnessAdapter({
    descriptor: witnessDescriptor(trust),
    manifestAuthority: authority,
    witness: witnessPort?.(witness) ?? witness,
  });
  return {
    backend: createEvolutionLedgerV2ManifestBackend({
      catalog,
      descriptor: descriptor(),
      headStore: heads.store,
      manifestAuthority: authority,
      now: () => Date.parse("2026-09-09T00:00:00.000Z"),
      segmentStore: segments.store,
      witnessAdapter,
    }),
    heads,
    manifests,
    segments,
    witness,
  };
}

function root() {
  return fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-v2-backend-"),
  );
}

describe("Evolution Ledger v2 manifest backend", () => {
  it("publishes a segment only after CAS and witnessed durable readback", () => {
    const directory = root();
    try {
      const value = fixture(directory);
      const initial = value.backend.read();
      const receipt = value.backend.appendSegment({
        eventDigests: [digest("c"), digest("d")],
        expectedHeadDigest: null,
        expectedWitnessDigest: initial.witness.witnessDigest,
        minimumRetainedUntil: MINIMUM_RETENTION,
      });
      expect(receipt).toMatchObject({
        authenticated: true,
        durable: true,
        immutable: true,
        readbackVerified: true,
        schema: EVOLUTION_LEDGER_V2_MANIFEST_APPEND_RECEIPT_SCHEMA,
        sequenceEnd: 2,
        sequenceStart: 1,
        witnessed: true,
      });
      expect(value.backend.read().head.headDigest).toBe(receipt.headDigest);
      expect(value.backend.read().witness.record.headDigest).toBe(
        receipt.headDigest,
      );
      expect(value.segments.backend.resolve).toHaveBeenCalledTimes(1);
      const next = value.backend.read();
      const second = value.backend.appendSegment({
        eventDigests: [digest("e")],
        expectedHeadDigest: next.head.headDigest,
        expectedWitnessDigest: next.witness.witnessDigest,
        minimumRetainedUntil: MINIMUM_RETENTION,
      });
      expect(second).toMatchObject({ sequenceEnd: 3, sequenceStart: 3 });
      expect(value.segments.backend.resolve).toHaveBeenCalledTimes(2);
      expect(value.backend.read().head.headDigest).toBe(second.headDigest);
      expect(value.backend.verify()).toMatchObject({
        authenticated: true,
        manifestCount: 2,
        sequence: 3,
      });
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  it("returns a conflict before retaining a segment when the caller snapshot is stale", () => {
    const directory = root();
    try {
      const value = fixture(directory);
      const initial = value.backend.read();
      const result = value.backend.appendSegment({
        eventDigests: [digest("c")],
        expectedHeadDigest: null,
        expectedWitnessDigest: digest("f"),
        minimumRetainedUntil: MINIMUM_RETENTION,
      });
      expect(result).toEqual({
        conflict: true,
        currentHeadDigest: null,
        currentWitnessDigest: initial.witness.witnessDigest,
        schema: EVOLUTION_LEDGER_V2_MANIFEST_CONFLICT_SCHEMA,
      });
      expect(value.segments.backend.retain).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  it("reports commit unknown when the head is committed but the witness conflicts", () => {
    const directory = root();
    try {
      const value = fixture(directory, {
        witnessPort(witness) {
          return Object.freeze({
            compareAndSwap() {
              return witness.read();
            },
            id: witness.id,
            read() {
              return witness.read();
            },
          });
        },
      });
      const initial = value.backend.read();
      try {
        value.backend.appendSegment({
          eventDigests: [digest("c")],
          expectedHeadDigest: null,
          expectedWitnessDigest: initial.witness.witnessDigest,
          minimumRetainedUntil: MINIMUM_RETENTION,
        });
        throw new Error("expected unknown commit state");
      } catch (error) {
        expect(error.code).toBe(
          EVOLUTION_LEDGER_V2_MANIFEST_COMMIT_UNKNOWN_CODE,
        );
      }
      expect(value.heads.store.read()).not.toBeNull();
      expect(value.witness.read().status).toBe("absent");
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  it("does not publish a head when manifest catalog acknowledgement is lost", () => {
    const directory = root();
    try {
      const value = fixture(directory, {
        catalogPort(manifests, fallback) {
          return {
            ...fallback,
            compareAndAppend(request) {
              manifests.push(request.manifest);
              throw new Error("catalog response lost after append");
            },
          };
        },
      });
      const initial = value.backend.read();
      try {
        value.backend.appendSegment({
          eventDigests: [digest("c")],
          expectedHeadDigest: null,
          expectedWitnessDigest: initial.witness.witnessDigest,
          minimumRetainedUntil: MINIMUM_RETENTION,
        });
        throw new Error("expected unknown commit state");
      } catch (error) {
        expect(error.code).toBe(
          EVOLUTION_LEDGER_V2_MANIFEST_COMMIT_UNKNOWN_CODE,
        );
      }
      expect(value.manifests).toHaveLength(1);
      expect(value.heads.store.read()).toBeNull();
      expect(value.witness.read().status).toBe("absent");
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });
});
