import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_CORRUPT_CODE,
  EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
  EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETENTION_PROOF_SCHEMA,
  EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETAIN_REQUEST_SCHEMA,
  captureImmutableLedgerSegmentProofVerifier,
  captureImmutableLedgerSegmentStorePort,
  computeImmutableLedgerSegmentProofDigest,
  createImmutableLedgerSegmentProofVerifier,
  createImmutableLedgerSegmentStorePort,
  isImmutableLedgerSegmentStorePort,
} from "../../src/lib/evolution/evolution-immutable-ledger-segment-store.js";

const SECRET = "test-only-immutable-segment-proof-key";
const MINIMUM_RETENTION = "2036-09-09T00:00:00.000Z";
const RETAINED_UNTIL = "2037-09-09T00:00:00.000Z";
const ARTIFACT_DIGEST = `sha256:${"a".repeat(64)}`;
const VERIFIER_DIGEST = `sha256:${"b".repeat(64)}`;

function signature(proofDigest) {
  return `hmac-sha256:${createHmac("sha256", SECRET)
    .update(proofDigest)
    .digest("hex")}`;
}

function descriptor(overrides = {}) {
  return {
    authorityId: "worm-fixture",
    authorityRevision: 1,
    epoch: "epoch-1",
    handlerArtifactDigest: ARTIFACT_DIGEST,
    immutabilityMode: "external-retention-authority",
    ledgerId: "ledger-1",
    proofAlgorithm: "test-hmac-sha256",
    tenantId: "tenant-1",
    ...overrides,
  };
}

function createVerifier(overrides = {}) {
  return createImmutableLedgerSegmentProofVerifier({
    descriptor: {
      authorityId: "worm-fixture",
      authorityRevision: 1,
      proofAlgorithm: "test-hmac-sha256",
      verifierArtifactDigest: VERIFIER_DIGEST,
      ...overrides,
    },
    verify(proof) {
      return proof.signature === signature(proof.proofDigest);
    },
  });
}

function signedProof(request, overrides = {}) {
  const draft = {
    authorityId: "worm-fixture",
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
    ...overrides,
  };
  draft.proofDigest = computeImmutableLedgerSegmentProofDigest(draft);
  draft.signature = signature(draft.proofDigest);
  return Object.freeze(draft);
}

function fixture({ mutateResolution, mutateRetainProof, proofVerifier } = {}) {
  const records = new Map();
  const backend = {
    retain: vi.fn((request) => {
      expect(request.schema).toBe(
        EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETAIN_REQUEST_SCHEMA,
      );
      const proof = signedProof(request);
      records.set(request.segmentRef, {
        bytes: Buffer.from(request.bytes),
        proof,
      });
      return mutateRetainProof ? mutateRetainProof(proof, request) : proof;
    }),
    resolve: vi.fn((request) => {
      const record = records.get(request.segmentRef);
      const resolution = record
        ? {
            bytes: Buffer.from(record.bytes),
            found: true,
            proof: record.proof,
            schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
          }
        : {
            bytes: Buffer.from("missing"),
            found: false,
            proof: signedProof(request),
            schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
          };
      return mutateResolution
        ? mutateResolution(resolution, request, records)
        : resolution;
    }),
  };
  const store = createImmutableLedgerSegmentStorePort({
    backend,
    descriptor: descriptor(),
    proofVerifier: proofVerifier || createVerifier(),
  });
  return { backend, records, store };
}

function retainInput(bytes = "segment-one") {
  return {
    bytes: Buffer.from(bytes),
    minimumRetainedUntil: MINIMUM_RETENTION,
    sequenceEnd: 10,
    sequenceStart: 1,
  };
}

function expectCorrupt(operation, message) {
  try {
    operation();
    throw new Error("expected immutable store operation to fail");
  } catch (error) {
    expect(error.code).toBe(EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_CORRUPT_CODE);
    expect(error.message).toMatch(message);
  }
}

describe("immutable ledger segment store port", () => {
  it("issues a branded receipt only after proof verification and exact readback", () => {
    const { backend, store } = fixture();
    const receipt = store.retain(retainInput());

    expect(receipt).toMatchObject({
      authenticated: true,
      immutable: true,
      readbackVerified: true,
      retainedUntil: RETAINED_UNTIL,
      sequenceEnd: 10,
      sequenceStart: 1,
      storageVersion: "version-1",
    });
    expect(receipt.segmentRef).toBe(receipt.contentDigest);
    expect(backend.retain).toHaveBeenCalledTimes(1);
    expect(backend.resolve).toHaveBeenCalledTimes(1);
    expect(isImmutableLedgerSegmentStorePort(store)).toBe(true);
    expect(captureImmutableLedgerSegmentStorePort(store)).toBe(store);
    expect(
      captureImmutableLedgerSegmentStorePort(store, {
        epoch: "epoch-1",
        ledgerId: "ledger-1",
        tenantId: "tenant-1",
      }),
    ).toBe(store);

    const resolution = store.resolve({
      contentDigest: receipt.contentDigest,
      minimumRetainedUntil: MINIMUM_RETENTION,
      segmentRef: receipt.segmentRef,
      sequenceEnd: 10,
      sequenceStart: 1,
      storageVersion: receipt.storageVersion,
    });
    expect(resolution.authenticated).toBe(true);
    expect(resolution.immutable).toBe(true);
    expect(resolution.bytes.toString("utf8")).toBe("segment-one");
  });

  it("rejects unbranded stores, proof verifiers, and mutable filesystem claims", () => {
    expect(() => captureImmutableLedgerSegmentStorePort({})).toThrow(
      /branded immutable ledger segment store/u,
    );
    expect(() => captureImmutableLedgerSegmentProofVerifier({})).toThrow(
      /branded immutable ledger segment proof verifier/u,
    );
    expect(() =>
      createImmutableLedgerSegmentStorePort({
        backend: { resolve() {}, retain() {} },
        descriptor: descriptor({ immutabilityMode: "mutable-filesystem" }),
        proofVerifier: createVerifier(),
      }),
    ).toThrow(/external retention authority/u);
    expect(() =>
      createImmutableLedgerSegmentStorePort({
        backend: { resolve() {}, retain() {} },
        descriptor: descriptor(),
        proofVerifier: {
          descriptor: createVerifier().descriptor,
          verify: () => true,
        },
      }),
    ).toThrow(/branded immutable ledger segment proof verifier/u);
  });

  it("rejects replacement bytes before issuing a receipt", () => {
    const { store } = fixture({
      mutateResolution(resolution) {
        return { ...resolution, bytes: Buffer.from("replacement") };
      },
    });
    expectCorrupt(() => store.retain(retainInput()), /substituted bytes/u);
  });

  it("rejects deletion during mandatory readback", () => {
    const { store } = fixture({
      mutateResolution(resolution, _request, records) {
        records.clear();
        return { ...resolution, found: false };
      },
    });
    expectCorrupt(() => store.retain(retainInput()), /segment is missing/u);
  });

  it("rejects a stale or replaced storage version", () => {
    const { store } = fixture({
      mutateResolution(resolution, request) {
        return {
          ...resolution,
          proof: signedProof(request, { storageVersion: "version-2" }),
        };
      },
    });
    expectCorrupt(
      () => store.retain(retainInput()),
      /storageVersion binding differs/u,
    );
  });

  it.each([
    [
      "foreign tenant",
      { tenantId: "tenant-foreign" },
      /tenantId binding differs/u,
    ],
    [
      "cross-ledger substitution",
      { ledgerId: "ledger-foreign" },
      /ledgerId binding differs/u,
    ],
    ["foreign epoch", { epoch: "epoch-foreign" }, /epoch binding differs/u],
  ])(
    "rejects %s even when its proof is correctly signed",
    (_label, overrides, message) => {
      const { store } = fixture({
        mutateRetainProof(_proof, request) {
          return signedProof(request, overrides);
        },
      });
      expectCorrupt(() => store.retain(retainInput()), message);
    },
  );

  it("rejects proof replay from a different content-addressed segment", () => {
    let replayedProof;
    const { store } = fixture({
      mutateRetainProof(proof) {
        if (!replayedProof) {
          replayedProof = proof;
          return proof;
        }
        return replayedProof;
      },
    });
    store.retain(retainInput("segment-one"));
    expectCorrupt(
      () => store.retain(retainInput("segment-two")),
      /contentDigest binding differs/u,
    );
  });

  it("rejects invalid signatures and insufficient retention", () => {
    const invalidSignature = fixture({
      mutateRetainProof(proof) {
        return { ...proof, signature: "invalid" };
      },
    });
    expectCorrupt(
      () => invalidSignature.store.retain(retainInput()),
      /signature was rejected/u,
    );

    const insufficientRetention = fixture({
      mutateRetainProof(_proof, request) {
        return signedProof(request, {
          retainedUntil: "2030-09-09T00:00:00.000Z",
        });
      },
    });
    expectCorrupt(
      () => insufficientRetention.store.retain(retainInput()),
      /retention is shorter/u,
    );
  });

  it("rejects hostile proof containers without invoking Proxy traps or getters", () => {
    const proxyTrap = vi.fn(() => {
      throw new Error("Proxy trap must not run");
    });
    const proxyProof = new Proxy({}, { get: proxyTrap, ownKeys: proxyTrap });
    const proxied = fixture({ mutateRetainProof: () => proxyProof });
    expectCorrupt(
      () => proxied.store.retain(retainInput()),
      /must not be a Proxy/u,
    );
    expect(proxyTrap).not.toHaveBeenCalled();

    const getter = vi.fn(() => {
      throw new Error("getter must not run");
    });
    const accessorProof = {
      ...signedProof({
        contentDigest: `sha256:${"c".repeat(64)}`,
        epoch: "epoch-1",
        ledgerId: "ledger-1",
        segmentRef: `sha256:${"c".repeat(64)}`,
        sequenceEnd: 10,
        sequenceStart: 1,
        tenantId: "tenant-1",
      }),
    };
    Object.defineProperty(accessorProof, "tenantId", { get: getter });
    const accessor = fixture({ mutateRetainProof: () => accessorProof });
    expectCorrupt(
      () => accessor.store.retain(retainInput()),
      /own data property/u,
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects hostile factory configurations without invoking traps or accessors", () => {
    const trap = vi.fn(() => {
      throw new Error("configuration Proxy trap must not run");
    });
    expect(() =>
      createImmutableLedgerSegmentStorePort(
        new Proxy({}, { get: trap, ownKeys: trap }),
      ),
    ).toThrow(/must not be a Proxy/u);
    expect(trap).not.toHaveBeenCalled();

    const getter = vi.fn(() => {
      throw new Error("configuration getter must not run");
    });
    const configuration = {
      descriptor: descriptor(),
      proofVerifier: createVerifier(),
    };
    Object.defineProperty(configuration, "backend", { get: getter });
    expect(() => createImmutableLedgerSegmentStorePort(configuration)).toThrow(
      /own data property/u,
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects asynchronous backends and proof verifiers", () => {
    const asyncBackend = {
      retain() {
        return Promise.resolve({});
      },
      resolve() {
        return Promise.resolve({});
      },
    };
    const store = createImmutableLedgerSegmentStorePort({
      backend: asyncBackend,
      descriptor: descriptor(),
      proofVerifier: createVerifier(),
    });
    expect(() => store.retain(retainInput())).toThrow(/must be synchronous/u);

    const verifier = createImmutableLedgerSegmentProofVerifier({
      descriptor: createVerifier().descriptor,
      verify: async () => true,
    });
    const asyncVerifierStore = fixture({ proofVerifier: verifier }).store;
    expect(() => asyncVerifierStore.retain(retainInput())).toThrow();
  });
});
