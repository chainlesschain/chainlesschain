import { describe, it, expect, beforeEach } from "vitest";

const {
  MerkleTree,
  encodeHashStr,
  sha256,
  leafHash,
  jcs,
  LandmarkCache,
  alwaysAcceptSignatureVerifier,
  verify,
  SCHEMA_ENVELOPE,
  SCHEMA_TREE_HEAD,
  SCHEMA_LANDMARK,
} = require("../lib/index.js");

/**
 * End-to-end flow:
 *   raw leaves → MerkleTree → tree_head → landmark → cache.ingest →
 *   per-leaf envelope (inclusion proof) → verify
 *
 * Uses alwaysAcceptSignatureVerifier (PQC not wired in core-mtc).
 */

const NAMESPACE = "mtc/v1/did/000142";
const ISSUER = "mtca:cc:zQ3shTestIssuer";
const NOW = Date.parse("2026-04-26T12:00:00Z");
const LATER = Date.parse("2026-05-03T12:00:00Z"); // 1 week later

function makeRawLeaves(n) {
  return Array.from({ length: n }, (_, i) => ({
    kind: "did-document",
    content_hash: encodeHashStr(sha256(Buffer.from(`content-${i}`))),
    issued_at: "2026-04-26T10:00:00Z",
    subject: `did:cc:zQ3shTest${String(i).padStart(3, "0")}`,
    metadata: {
      version: "1.0.0",
      supersedes: null,
    },
  }));
}

function buildTreeHead({ namespace, treeSize, rootHash, issuedAt, expiresAt, issuer }) {
  return {
    schema: SCHEMA_TREE_HEAD,
    namespace,
    tree_size: treeSize,
    root_hash: rootHash,
    issued_at: issuedAt,
    expires_at: expiresAt,
    issuer,
  };
}

function buildLandmarkFixture(rawLeaves, opts = {}) {
  const namespace = opts.namespace || NAMESPACE;
  const issuer = opts.issuer || ISSUER;
  const issuedAt = opts.issuedAt || "2026-04-26T12:00:00Z";
  const expiresAt = opts.expiresAt || "2026-05-03T12:00:00Z";

  const leafHashes = rawLeaves.map((l) => leafHash(jcs(l)));
  const tree = new MerkleTree(leafHashes);
  const root = tree.root();

  const treeHead = buildTreeHead({
    namespace,
    treeSize: leafHashes.length,
    rootHash: encodeHashStr(root),
    issuedAt,
    expiresAt,
    issuer,
  });
  const treeHeadId = encodeHashStr(sha256(jcs(treeHead)));

  const landmark = {
    schema: SCHEMA_LANDMARK,
    namespace: namespace.split("/").slice(0, -1).join("/"),
    snapshots: [
      {
        tree_head: treeHead,
        tree_head_id: treeHeadId,
        signature: {
          alg: "SLH-DSA-128f",
          issuer,
          sig: Buffer.alloc(17000).toString("base64url"),
          pubkey_id: "sha256:" + Buffer.alloc(32, 0xab).toString("base64url"),
        },
      },
    ],
    trust_anchors: [
      {
        issuer,
        alg: "SLH-DSA-128f",
        pubkey_id: "sha256:" + Buffer.alloc(32, 0xab).toString("base64url"),
        pubkey_jwk: { kty: "slh-dsa", alg: "SLH-DSA-128f", x: "test" },
      },
    ],
    published_at: issuedAt,
    publisher_signature: {
      alg: "Ed25519",
      key_id: "did:cc:zQ3shTest#key-1",
      sig: "test-sig-not-checked-here",
    },
  };

  return { rawLeaves, leafHashes, tree, treeHead, treeHeadId, landmark };
}

function buildEnvelope(rawLeaf, leafIndex, fixture) {
  const path = fixture.tree.prove(leafIndex);
  return {
    schema: SCHEMA_ENVELOPE,
    namespace: fixture.treeHead.namespace,
    tree_head_id: fixture.treeHeadId,
    leaf: rawLeaf,
    inclusion_proof: {
      leaf_index: leafIndex,
      tree_size: fixture.tree.size,
      audit_path: path.map((b) => encodeHashStr(b)),
    },
  };
}

describe("E2E — full MTCA → landmark → verify flow", () => {
  let cache;
  let fixture;

  beforeEach(() => {
    cache = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
    });
    fixture = buildLandmarkFixture(makeRawLeaves(8));
    cache.ingest(fixture.landmark);
  });

  it("ingests landmark and reports 1 accepted snapshot", () => {
    const fresh = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
    });
    const result = fresh.ingest(fixture.landmark);
    expect(result).toEqual({ accepted: 1, total: 1 });
    expect(fresh.size()).toBe(1);
  });

  it("verifies all 8 envelopes successfully", () => {
    for (let i = 0; i < 8; i++) {
      const env = buildEnvelope(fixture.rawLeaves[i], i, fixture);
      const result = verify(env, cache, { now: NOW });
      expect(result.ok, `envelope ${i} failed: ${result.code}`).toBe(true);
      expect(result.leaf.subject).toBe(fixture.rawLeaves[i].subject);
    }
  });

  it("verifies a 1024-leaf batch end-to-end", () => {
    const big = buildLandmarkFixture(makeRawLeaves(1024));
    const bigCache = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
    });
    bigCache.ingest(big.landmark);

    // Spot-check 5 indices
    for (const i of [0, 1, 511, 512, 1023]) {
      const env = buildEnvelope(big.rawLeaves[i], i, big);
      const result = verify(env, bigCache, { now: NOW });
      expect(result.ok, `envelope ${i} failed: ${result.code}`).toBe(true);
    }
  });

  describe("rejection scenarios", () => {
    it("returns LANDMARK_MISS for unknown tree_head_id", () => {
      const env = buildEnvelope(fixture.rawLeaves[0], 0, fixture);
      env.tree_head_id = "sha256:" + Buffer.alloc(32, 0xff).toString("base64url");
      const result = verify(env, cache, { now: NOW });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("LANDMARK_MISS");
      expect(result.recoverable).toBe(true);
    });

    it("returns LANDMARK_EXPIRED when now > expires_at", () => {
      const env = buildEnvelope(fixture.rawLeaves[0], 0, fixture);
      const tooLate = LATER + 1000;
      const result = verify(env, cache, { now: tooLate });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("LANDMARK_EXPIRED");
    });

    it("returns ROOT_MISMATCH when leaf is tampered", () => {
      const env = buildEnvelope(fixture.rawLeaves[3], 3, fixture);
      env.leaf.subject = "did:cc:zQ3shTAMPERED";
      const result = verify(env, cache, { now: NOW });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("ROOT_MISMATCH");
    });

    it("returns ROOT_MISMATCH when audit_path entry is tampered", () => {
      const env = buildEnvelope(fixture.rawLeaves[3], 3, fixture);
      const original = env.inclusion_proof.audit_path[0];
      const decoded = Buffer.from(original.slice(7), "base64url");
      decoded[0] ^= 0xff;
      env.inclusion_proof.audit_path[0] =
        "sha256:" + decoded.toString("base64url");
      const result = verify(env, cache, { now: NOW });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("ROOT_MISMATCH");
    });

    it("returns BAD_NAMESPACE for malformed namespace", () => {
      const env = buildEnvelope(fixture.rawLeaves[0], 0, fixture);
      env.namespace = "mtc/v2/bogus/123";
      const result = verify(env, cache, { now: NOW });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("BAD_NAMESPACE");
    });

    it("returns UNKNOWN_SCHEMA for wrong schema string", () => {
      const env = buildEnvelope(fixture.rawLeaves[0], 0, fixture);
      env.schema = "mtc-envelope/v2";
      const result = verify(env, cache, { now: NOW });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("UNKNOWN_SCHEMA");
    });

    it("returns PROOF_TREE_SIZE_MISMATCH when proof.tree_size != tree_head.tree_size", () => {
      const env = buildEnvelope(fixture.rawLeaves[0], 0, fixture);
      env.inclusion_proof.tree_size = 16;
      const result = verify(env, cache, { now: NOW });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("PROOF_TREE_SIZE_MISMATCH");
    });

    it("returns BAD_PROOF_INDEX when leaf_index out of range", () => {
      const env = buildEnvelope(fixture.rawLeaves[0], 0, fixture);
      env.inclusion_proof.leaf_index = 99;
      const result = verify(env, cache, { now: NOW });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("BAD_PROOF_INDEX");
    });

    it("returns BAD_PROOF_LENGTH when audit_path is wrong size", () => {
      const env = buildEnvelope(fixture.rawLeaves[0], 0, fixture);
      env.inclusion_proof.audit_path =
        env.inclusion_proof.audit_path.slice(0, -1);
      const result = verify(env, cache, { now: NOW });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("BAD_PROOF_LENGTH");
    });
  });
});

describe("E2E — split-view attack defense", () => {
  it("rejects a second landmark with same tree_size but different root_hash", () => {
    const cache = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
    });
    const honest = buildLandmarkFixture(makeRawLeaves(8));
    cache.ingest(honest.landmark);

    // Build a different tree of same size with one leaf changed
    const tampered = makeRawLeaves(8);
    tampered[0].subject = "did:cc:zQ3shATTACKER";
    const evil = buildLandmarkFixture(tampered);

    expect(() => cache.ingest(evil.landmark)).toThrowError(
      expect.objectContaining({ code: "MTCA_DOUBLE_SIGNED" }),
    );
  });

  it("accepts re-ingestion of the same honest landmark (idempotent)", () => {
    const cache = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
    });
    const honest = buildLandmarkFixture(makeRawLeaves(8));
    cache.ingest(honest.landmark);
    const result2 = cache.ingest(honest.landmark);
    expect(result2.accepted).toBe(0); // already cached
    expect(cache.size()).toBe(1);
  });
});

describe("E2E — signature verifier integration", () => {
  it("rejects ingest when signature verifier returns false", () => {
    const cache = new LandmarkCache({
      signatureVerifier: () => false,
    });
    const fixture = buildLandmarkFixture(makeRawLeaves(4));
    expect(() => cache.ingest(fixture.landmark)).toThrowError(
      expect.objectContaining({ code: "BAD_TREE_HEAD_SIG" }),
    );
  });

  it("rejects ingest when signature verifier is not configured (default)", () => {
    const cache = new LandmarkCache(); // no signatureVerifier
    const fixture = buildLandmarkFixture(makeRawLeaves(4));
    expect(() => cache.ingest(fixture.landmark)).toThrowError(
      expect.objectContaining({ code: "NO_SIGNATURE_VERIFIER" }),
    );
  });

  it("rejects ingest when claimed tree_head_id doesn't match canonical hash", () => {
    const cache = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
    });
    const fixture = buildLandmarkFixture(makeRawLeaves(4));
    fixture.landmark.snapshots[0].tree_head_id =
      "sha256:" + Buffer.alloc(32, 0x00).toString("base64url");
    expect(() => cache.ingest(fixture.landmark)).toThrowError(
      expect.objectContaining({ code: "BAD_TREE_HEAD_ID" }),
    );
  });
});

describe("E2E — JCS canonicalization invariance", () => {
  it("verification works regardless of leaf field insertion order", () => {
    const cache = new LandmarkCache({
      signatureVerifier: alwaysAcceptSignatureVerifier,
    });
    const fixture = buildLandmarkFixture(makeRawLeaves(4));
    cache.ingest(fixture.landmark);

    // Re-construct envelope with deliberately reordered leaf keys
    const env = buildEnvelope(fixture.rawLeaves[2], 2, fixture);
    const reordered = {
      metadata: env.leaf.metadata,
      subject: env.leaf.subject,
      issued_at: env.leaf.issued_at,
      content_hash: env.leaf.content_hash,
      kind: env.leaf.kind,
    };
    env.leaf = reordered;

    const result = verify(env, cache, { now: NOW });
    expect(result.ok).toBe(true);
  });
});
