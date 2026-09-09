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
import {
  EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
  EVOLUTION_LEDGER_MANIFEST_HEAD_SCHEMA,
  EVOLUTION_LEDGER_SEGMENT_MANIFEST_SCHEMA,
  createEvolutionLedgerManifestAuthority,
  sealEvolutionLedgerManifestSegment,
  verifyEvolutionLedgerManifestChain,
} from "../../src/lib/evolution/evolution-ledger-manifest-chain.js";
import {
  EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA,
  EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE,
  captureEvolutionLedgerManifestHeadStore,
  createEvolutionLedgerManifestHeadStore,
} from "../../src/lib/evolution/evolution-ledger-manifest-head-store.js";
import { createEvolutionFileWitness } from "../../src/lib/evolution/evolution-file-witness.js";
import {
  EVOLUTION_LEDGER_MANIFEST_WITNESS_COMMIT_UNKNOWN_CODE,
  captureEvolutionLedgerManifestWitnessAdapter,
  createEvolutionLedgerManifestWitnessAdapter,
} from "../../src/lib/evolution/evolution-ledger-manifest-witness-adapter.js";

const STORE_SECRET = "manifest-store-test-secret";
const MANIFEST_SECRET = "manifest-signing-test-secret";
const MINIMUM_RETENTION = "2036-09-09T00:00:00.000Z";
const RETAINED_UNTIL = "2037-09-09T00:00:00.000Z";
const HANDLER_DIGEST = `sha256:${"a".repeat(64)}`;
const VERIFIER_DIGEST = `sha256:${"b".repeat(64)}`;

function hmac(secret, value) {
  return `hmac-sha256:${createHmac("sha256", secret).update(value).digest("hex")}`;
}

function chainDescriptor(overrides = {}) {
  return {
    epoch: "epoch-1",
    ledgerId: "ledger-1",
    maximumEventsPerSegment: 3,
    tenantId: "tenant-1",
    ...overrides,
  };
}

function eventDigest(letter) {
  return `sha256:${letter.repeat(64)}`;
}

function storeProof(request, overrides = {}) {
  const proof = {
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
  proof.proofDigest = computeImmutableLedgerSegmentProofDigest(proof);
  proof.signature = hmac(STORE_SECRET, proof.proofDigest);
  return Object.freeze(proof);
}

function memorySegmentStore({ mutateResolve } = {}) {
  const records = new Map();
  const proofVerifier = createImmutableLedgerSegmentProofVerifier({
    descriptor: {
      authorityId: "worm-fixture",
      authorityRevision: 1,
      proofAlgorithm: "test-hmac-sha256",
      verifierArtifactDigest: VERIFIER_DIGEST,
    },
    verify(proof) {
      return proof.signature === hmac(STORE_SECRET, proof.proofDigest);
    },
  });
  const backend = {
    retain: vi.fn((request) => {
      const proof = storeProof(request);
      records.set(request.segmentRef, {
        bytes: Buffer.from(request.bytes),
        proof,
      });
      return proof;
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
            proof: storeProof(request),
            schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
          };
      return mutateResolve
        ? mutateResolve(resolution, request, records)
        : resolution;
    }),
  };
  const store = createImmutableLedgerSegmentStorePort({
    backend,
    descriptor: {
      authorityId: "worm-fixture",
      authorityRevision: 1,
      epoch: "epoch-1",
      handlerArtifactDigest: HANDLER_DIGEST,
      immutabilityMode: "external-retention-authority",
      ledgerId: "ledger-1",
      proofAlgorithm: "test-hmac-sha256",
      tenantId: "tenant-1",
    },
    proofVerifier,
  });
  return { backend, records, store };
}

function authority() {
  return createEvolutionLedgerManifestAuthority({
    descriptor: {
      algorithm: "test-hmac-sha256",
      authorityId: "manifest-authority",
      revision: 1,
    },
    sign({ digest }) {
      return hmac(MANIFEST_SECRET, digest);
    },
    verify({ digest, signature }) {
      return signature === hmac(MANIFEST_SECRET, digest);
    },
  });
}

function seal({ previousHead = null, eventDigests = [eventDigest("c")] } = {}) {
  const fixture = memorySegmentStore();
  const manifestAuthority = authority();
  const first = sealEvolutionLedgerManifestSegment({
    authority: manifestAuthority,
    descriptor: chainDescriptor(),
    eventDigests,
    minimumRetainedUntil: MINIMUM_RETENTION,
    now: () => Date.parse("2026-09-09T00:00:00.000Z"),
    previousHead,
    segmentStore: fixture.store,
  });
  return { ...fixture, first, manifestAuthority };
}

function expectCorrupt(operation, message) {
  try {
    operation();
    throw new Error("expected manifest operation to fail");
  } catch (error) {
    expect(error.code).toBe(EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE);
    expect(error.message).toMatch(message);
  }
}

function memoryHeadStore({ manifestAuthority, current = null, compare } = {}) {
  let stored = current;
  const load = vi.fn(() => stored);
  const compareAndSet = vi.fn((request) => {
    if (compare)
      return compare({ request, stored, set: (head) => (stored = head) });
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
  const store = createEvolutionLedgerManifestHeadStore({
    authority: manifestAuthority,
    compareAndSet,
    descriptor: chainDescriptor(),
    load,
  });
  return {
    compareAndSet,
    load,
    set(head) {
      stored = head;
    },
    store,
  };
}

describe("Evolution Ledger v2 manifest chain", () => {
  it("seals fixed-size immutable segments and verifies a contiguous signed chain", () => {
    const fixture = memorySegmentStore();
    const manifestAuthority = authority();
    const first = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("c"), eventDigest("d"), eventDigest("e")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:00:00.000Z"),
      previousHead: null,
      segmentStore: fixture.store,
    });
    const second = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("f"), eventDigest("1")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:01:00.000Z"),
      previousHead: first.head,
      segmentStore: fixture.store,
    });

    expect(first.manifest.schema).toBe(
      EVOLUTION_LEDGER_SEGMENT_MANIFEST_SCHEMA,
    );
    expect(second.head.schema).toBe(EVOLUTION_LEDGER_MANIFEST_HEAD_SCHEMA);
    expect(second.manifest.previousManifestDigest).toBe(
      first.manifest.manifestDigest,
    );
    expect(second.head.previousHeadDigest).toBe(first.head.headDigest);
    expect(fixture.backend.resolve).toHaveBeenCalledTimes(2);

    expect(
      verifyEvolutionLedgerManifestChain({
        authority: manifestAuthority,
        descriptor: chainDescriptor(),
        head: second.head,
        manifests: [first.manifest, second.manifest],
        segmentStore: fixture.store,
      }),
    ).toMatchObject({
      authenticated: true,
      manifestCount: 2,
      sequence: 5,
    });
  });

  it("does not read prior immutable segments while sealing the next segment", () => {
    const fixture = memorySegmentStore();
    const manifestAuthority = authority();
    const first = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("c")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:00:00.000Z"),
      previousHead: null,
      segmentStore: fixture.store,
    });
    fixture.backend.resolve.mockClear();
    sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("d")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:01:00.000Z"),
      previousHead: first.head,
      segmentStore: fixture.store,
    });
    expect(fixture.backend.resolve).toHaveBeenCalledTimes(1);
  });

  it("rejects replacement or deletion of an immutable segment during audit", () => {
    const replaced = memorySegmentStore({
      mutateResolve(resolution) {
        return { ...resolution, bytes: Buffer.from("replacement") };
      },
    });
    const manifestAuthority = authority();
    expectCorrupt(
      () =>
        sealEvolutionLedgerManifestSegment({
          authority: manifestAuthority,
          descriptor: chainDescriptor(),
          eventDigests: [eventDigest("c")],
          minimumRetainedUntil: MINIMUM_RETENTION,
          now: () => Date.parse("2026-09-09T00:00:00.000Z"),
          previousHead: null,
          segmentStore: replaced.store,
        }),
      /immutable segment store retain failed/u,
    );
  });

  it("rejects deletion and broken manifest/head linkage during audit", () => {
    const fixture = memorySegmentStore();
    const manifestAuthority = authority();
    const first = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("c")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:00:00.000Z"),
      previousHead: null,
      segmentStore: fixture.store,
    });
    fixture.records.clear();
    expectCorrupt(
      () =>
        verifyEvolutionLedgerManifestChain({
          authority: manifestAuthority,
          descriptor: chainDescriptor(),
          head: first.head,
          manifests: [first.manifest],
          segmentStore: fixture.store,
        }),
      /immutable segment store resolve failed/u,
    );
  });

  it("rejects a substituted, stale, foreign, or unsigned chain head", () => {
    const fixture = memorySegmentStore();
    const manifestAuthority = authority();
    const first = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("c")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:00:00.000Z"),
      previousHead: null,
      segmentStore: fixture.store,
    });
    const second = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("d")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:01:00.000Z"),
      previousHead: first.head,
      segmentStore: fixture.store,
    });
    expectCorrupt(
      () =>
        verifyEvolutionLedgerManifestChain({
          authority: manifestAuthority,
          descriptor: chainDescriptor(),
          head: second.head,
          manifests: [second.manifest],
          segmentStore: fixture.store,
        }),
      /manifest chain linkage is invalid/u,
    );
    for (const [head, message] of [
      [first.head, /does not bind the final manifest/u],
      [
        { ...second.head, tenantId: "tenant-foreign" },
        /tenantId binding differs/u,
      ],
      [{ ...second.head, signature: "invalid" }, /signature was rejected/u],
    ]) {
      expectCorrupt(
        () =>
          verifyEvolutionLedgerManifestChain({
            authority: manifestAuthority,
            descriptor: chainDescriptor(),
            head,
            manifests: [first.manifest, second.manifest],
            segmentStore: fixture.store,
          }),
        message,
      );
    }
  });

  it("fails closed on unbranded authorities, scope mismatch, and hostile records", () => {
    const fixture = memorySegmentStore();
    expect(() =>
      sealEvolutionLedgerManifestSegment({
        authority: {},
        descriptor: chainDescriptor(),
        eventDigests: [eventDigest("c")],
        minimumRetainedUntil: MINIMUM_RETENTION,
        now: Date.now,
        previousHead: null,
        segmentStore: fixture.store,
      }),
    ).toThrow(/branded Evolution Ledger manifest authority/u);

    const sealed = seal();
    expect(() =>
      verifyEvolutionLedgerManifestChain({
        authority: sealed.manifestAuthority,
        descriptor: chainDescriptor({ tenantId: "tenant-foreign" }),
        head: sealed.first.head,
        manifests: [sealed.first.manifest],
        segmentStore: sealed.store,
      }),
    ).toThrow(/scope differs/u);

    const trap = vi.fn(() => {
      throw new Error("Proxy trap must not run");
    });
    expectCorrupt(
      () =>
        verifyEvolutionLedgerManifestChain({
          authority: sealed.manifestAuthority,
          descriptor: chainDescriptor(),
          head: sealed.first.head,
          manifests: new Proxy([], { get: trap, ownKeys: trap }),
          segmentStore: sealed.store,
        }),
      /must not be a Proxy/u,
    );
    expect(trap).not.toHaveBeenCalled();
  });
});

describe("Evolution Ledger v2 manifest head CAS store", () => {
  it("commits signed heads with mandatory readback and prevents stale writers", () => {
    const fixture = memorySegmentStore();
    const manifestAuthority = authority();
    const first = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("c")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:00:00.000Z"),
      previousHead: null,
      segmentStore: fixture.store,
    });
    const heads = memoryHeadStore({ manifestAuthority });
    const committedFirst = heads.store.commit({
      expectedHeadDigest: null,
      nextHead: first.head,
    });
    expect(committedFirst).toMatchObject({ committed: true, conflict: false });
    expect(heads.store.read().headDigest).toBe(first.head.headDigest);
    expect(captureEvolutionLedgerManifestHeadStore(heads.store)).toBe(
      heads.store,
    );

    const second = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("d")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:01:00.000Z"),
      previousHead: first.head,
      segmentStore: fixture.store,
    });
    const committedSecond = heads.store.commit({
      expectedHeadDigest: first.head.headDigest,
      nextHead: second.head,
    });
    expect(committedSecond.head.headDigest).toBe(second.head.headDigest);
    const callsBeforeStaleRetry = heads.compareAndSet.mock.calls.length;
    const stale = heads.store.commit({
      expectedHeadDigest: first.head.headDigest,
      nextHead: second.head,
    });
    expect(stale).toMatchObject({ committed: false, conflict: true });
    expect(heads.compareAndSet).toHaveBeenCalledTimes(callsBeforeStaleRetry);
  });

  it("rejects unbranded stores and marks substituted or malformed acknowledgements unknown", () => {
    expect(() => captureEvolutionLedgerManifestHeadStore({})).toThrow(
      /branded Evolution Ledger manifest head store/u,
    );
    const fixture = memorySegmentStore();
    const manifestAuthority = authority();
    const first = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("c")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:00:00.000Z"),
      previousHead: null,
      segmentStore: fixture.store,
    });
    const substituted = memoryHeadStore({
      manifestAuthority,
      compare: () => ({
        committed: true,
        head: { ...first.head, signature: "invalid" },
        schema: EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA,
      }),
    });
    try {
      substituted.store.commit({
        expectedHeadDigest: null,
        nextHead: first.head,
      });
      throw new Error("expected substituted head response to fail");
    } catch (error) {
      expect(error.code).toBe(
        EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE,
      );
    }

    const malformed = memoryHeadStore({
      manifestAuthority,
      compare: () => ({ committed: true }),
    });
    try {
      malformed.store.commit({
        expectedHeadDigest: null,
        nextHead: first.head,
      });
      throw new Error("expected malformed head response to fail");
    } catch (error) {
      expect(error.code).toBe(
        EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE,
      );
    }
  });

  it("returns commit-unknown when the acknowledgement or post-commit readback is lost", () => {
    const fixture = memorySegmentStore();
    const manifestAuthority = authority();
    const first = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("c")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:00:00.000Z"),
      previousHead: null,
      segmentStore: fixture.store,
    });
    const lostAcknowledgement = memoryHeadStore({
      manifestAuthority,
      compare: ({ request, set }) => {
        set(request.nextHead);
        throw new Error("response lost after write");
      },
    });
    try {
      lostAcknowledgement.store.commit({
        expectedHeadDigest: null,
        nextHead: first.head,
      });
      throw new Error("expected commit state to be unknown");
    } catch (error) {
      expect(error.code).toBe(
        EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE,
      );
    }
    expect(lostAcknowledgement.store.read().headDigest).toBe(
      first.head.headDigest,
    );
  });
});

describe("Evolution Ledger v2 manifest witness adapter", () => {
  function createRealWitness(root) {
    const trust = {
      algorithm: "hmac-sha256",
      keyId: "key://tests/v2-manifest-witness",
      trustPolicyDigest: eventDigest("9"),
    };
    const sign = ({ message }) => ({
      ...trust,
      value: createHmac("sha256", "v2-witness-secret")
        .update(message)
        .digest("base64url"),
    });
    const verify = ({ message, signature, trust: requestTrust }) =>
      requestTrust.algorithm === trust.algorithm &&
      requestTrust.keyId === trust.keyId &&
      requestTrust.trustPolicyDigest === trust.trustPolicyDigest &&
      signature.algorithm === trust.algorithm &&
      signature.keyId === trust.keyId &&
      signature.trustPolicyDigest === trust.trustPolicyDigest &&
      signature.value ===
        createHmac("sha256", "v2-witness-secret")
          .update(message)
          .digest("base64url");
    const directory = path.join(root, "witness-authority");
    fs.mkdirSync(directory, { mode: 0o700 });
    return {
      trust,
      witness: createEvolutionFileWitness({
        filePath: path.join(directory, "witness.json"),
        id: "v2-manifest-witness",
        signer: { sign },
        trust,
        verifier: { verify },
      }),
    };
  }

  function witnessDescriptor(trust) {
    return {
      epoch: "epoch-1",
      identityDigest: eventDigest("1"),
      ledgerId: "ledger-1",
      manifestTrustKeyId: "key://tests/manifest-authority",
      maximumEventsPerSegment: 3,
      storeMarkerDigest: eventDigest("2"),
      storeMarkerEntryDigest: eventDigest("3"),
      storeMarkerId: "v2-store-marker",
      tenantId: "tenant-1",
      witnessTrust: trust,
    };
  }

  function sealedFixture() {
    const segments = memorySegmentStore();
    const manifestAuthority = authority();
    const sealed = sealEvolutionLedgerManifestSegment({
      authority: manifestAuthority,
      descriptor: chainDescriptor(),
      eventDigests: [eventDigest("c")],
      minimumRetainedUntil: MINIMUM_RETENTION,
      now: () => Date.parse("2026-09-09T00:00:00.000Z"),
      previousHead: null,
      segmentStore: segments.store,
    });
    return { manifestAuthority, ...sealed };
  }

  it("publishes and rereads a real independent EvolutionFileWitness checkpoint", () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-v2-manifest-witness-"),
    );
    try {
      const { trust, witness } = createRealWitness(root);
      const sealed = sealedFixture();
      const adapter = createEvolutionLedgerManifestWitnessAdapter({
        descriptor: witnessDescriptor(trust),
        manifestAuthority: sealed.manifestAuthority,
        witness,
      });
      const genesis = witness.read();
      const receipt = adapter.checkpoint({
        expectedWitnessDigest: genesis.witnessDigest,
        head: sealed.head,
        manifest: sealed.manifest,
      });
      expect(receipt).toMatchObject({
        checkpointed: true,
        conflict: false,
        headDigest: sealed.head.headDigest,
        manifestDigest: sealed.manifest.manifestDigest,
        sequence: 1,
      });
      expect(adapter.read().record.headDigest).toBe(sealed.head.headDigest);
      expect(captureEvolutionLedgerManifestWitnessAdapter(adapter)).toBe(
        adapter,
      );
      const stale = adapter.checkpoint({
        expectedWitnessDigest: genesis.witnessDigest,
        head: sealed.head,
        manifest: sealed.manifest,
      });
      expect(stale).toMatchObject({ checkpointed: false, conflict: true });
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects cross-bound manifest pairs before touching the witness", () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-v2-manifest-witness-"),
    );
    try {
      const { trust, witness } = createRealWitness(root);
      const sealed = sealedFixture();
      const adapter = createEvolutionLedgerManifestWitnessAdapter({
        descriptor: witnessDescriptor(trust),
        manifestAuthority: sealed.manifestAuthority,
        witness,
      });
      expect(() =>
        adapter.checkpoint({
          expectedWitnessDigest: witness.read().witnessDigest,
          head: { ...sealed.head, manifestDigest: eventDigest("f") },
          manifest: sealed.manifest,
        }),
      ).toThrow(/manifest witness input is invalid/u);
      expect(witness.read().status).toBe("absent");
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  it("marks a lost witness acknowledgement commit-unknown", () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-v2-manifest-witness-"),
    );
    try {
      const { trust, witness } = createRealWitness(root);
      const sealed = sealedFixture();
      const lostAcknowledgementWitness = Object.freeze({
        compareAndSwap() {
          throw new Error("response lost after checkpoint");
        },
        id: witness.id,
        read() {
          return witness.read();
        },
      });
      const adapter = createEvolutionLedgerManifestWitnessAdapter({
        descriptor: witnessDescriptor(trust),
        manifestAuthority: sealed.manifestAuthority,
        witness: lostAcknowledgementWitness,
      });
      try {
        adapter.checkpoint({
          expectedWitnessDigest: witness.read().witnessDigest,
          head: sealed.head,
          manifest: sealed.manifest,
        });
        throw new Error("expected unknown witness commit state");
      } catch (error) {
        expect(error.code).toBe(
          EVOLUTION_LEDGER_MANIFEST_WITNESS_COMMIT_UNKNOWN_CODE,
        );
      }
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });
});
