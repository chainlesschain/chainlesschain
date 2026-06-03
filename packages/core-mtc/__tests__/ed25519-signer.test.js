import { describe, it, expect } from "vitest";

const {
  MerkleTree,
  encodeHashStr,
  sha256,
  leafHash,
  jcs,
  LandmarkCache,
  verify,
  TREE_HEAD_SIG_PREFIX,
  SCHEMA_ENVELOPE,
  SCHEMA_TREE_HEAD,
  SCHEMA_LANDMARK,
  ed25519,
} = require("../lib/index.js");

const NS = "mtc/v1/did/000099";

function buildSignedFixture() {
  const keys = ed25519.generateKeyPair();
  const issuer = "mtca:cc:zQ3shEd25519Test";
  const rawLeaves = Array.from({ length: 4 }, (_, i) => ({
    kind: "did-document",
    content_hash: encodeHashStr(sha256(Buffer.from(`x${i}`))),
    issued_at: "2026-04-26T10:00:00Z",
    subject: `did:cc:zQ3shEdTest${i}`,
    metadata: { version: "1.0.0", supersedes: null },
  }));
  const tree = new MerkleTree(rawLeaves.map((l) => leafHash(jcs(l))));
  const treeHead = {
    schema: SCHEMA_TREE_HEAD,
    namespace: NS,
    tree_size: rawLeaves.length,
    root_hash: encodeHashStr(tree.root()),
    issued_at: "2026-04-26T12:00:00Z",
    expires_at: "2026-05-03T12:00:00Z",
    issuer,
  };
  const canonical = jcs(treeHead);
  const signingInput = Buffer.concat([TREE_HEAD_SIG_PREFIX, canonical]);
  const signature = ed25519.signTreeHead(signingInput, {
    secretKey: keys.secretKey,
    publicKey: keys.publicKey,
    issuer,
  });
  const treeHeadId = encodeHashStr(sha256(canonical));

  const landmark = {
    schema: SCHEMA_LANDMARK,
    namespace: NS.split("/").slice(0, -1).join("/"),
    snapshots: [{ tree_head: treeHead, tree_head_id: treeHeadId, signature }],
    trust_anchors: [ed25519.trustAnchorEntry(keys.publicKey, issuer)],
    published_at: "2026-04-26T12:00:00Z",
    publisher_signature: { alg: "Ed25519", key_id: "x", sig: "y" },
  };
  return { keys, rawLeaves, tree, landmark, treeHeadId, issuer };
}

describe("Ed25519 signer", () => {
  it("generateKeyPair returns 32-byte keys + valid pubkey_id", () => {
    const k = ed25519.generateKeyPair();
    expect(k.secretKey.length).toBe(32);
    expect(k.publicKey.length).toBe(32);
    expect(k.pubkeyId).toMatch(/^sha256:[A-Za-z0-9_-]+$/);
  });

  it("pubkeyId is deterministic for same public key", () => {
    const k1 = ed25519.generateKeyPair();
    const id1 = ed25519.pubkeyId(k1.publicKey);
    const id2 = ed25519.pubkeyId(k1.publicKey);
    expect(id1).toBe(id2);
  });

  it("pubkeyId differs for different public keys", () => {
    const k1 = ed25519.generateKeyPair();
    const k2 = ed25519.generateKeyPair();
    expect(ed25519.pubkeyId(k1.publicKey)).not.toBe(
      ed25519.pubkeyId(k2.publicKey),
    );
  });

  it("signRaw + makeVerifier round-trips", () => {
    const k = ed25519.generateKeyPair();
    const msg = Buffer.from("hello mtc");
    const sig = ed25519.signRaw(msg, k.secretKey);
    expect(sig.length).toBe(64);

    const trusted = new Map([[ed25519.pubkeyId(k.publicKey), k.publicKey]]);
    const v = ed25519.makeVerifier(trusted);
    expect(
      v(msg, {
        alg: "Ed25519",
        sig: sig.toString("base64url"),
        pubkey_id: ed25519.pubkeyId(k.publicKey),
        issuer: "test",
      }),
    ).toBe(true);
  });

  it("verifier rejects signature from unknown key", () => {
    const k1 = ed25519.generateKeyPair();
    const k2 = ed25519.generateKeyPair();
    const msg = Buffer.from("hello");
    const sig = ed25519.signRaw(msg, k1.secretKey);

    const trusted = new Map([[ed25519.pubkeyId(k2.publicKey), k2.publicKey]]);
    const v = ed25519.makeVerifier(trusted);
    expect(
      v(msg, {
        alg: "Ed25519",
        sig: sig.toString("base64url"),
        pubkey_id: ed25519.pubkeyId(k1.publicKey),
        issuer: "test",
      }),
    ).toBe(false);
  });

  it("verifier rejects tampered message", () => {
    const k = ed25519.generateKeyPair();
    const sig = ed25519.signRaw(Buffer.from("original"), k.secretKey);
    const trusted = new Map([[ed25519.pubkeyId(k.publicKey), k.publicKey]]);
    const v = ed25519.makeVerifier(trusted);
    expect(
      v(Buffer.from("tampered"), {
        alg: "Ed25519",
        sig: sig.toString("base64url"),
        pubkey_id: ed25519.pubkeyId(k.publicKey),
      }),
    ).toBe(false);
  });

  it("verifier rejects wrong alg", () => {
    const k = ed25519.generateKeyPair();
    const sig = ed25519.signRaw(Buffer.from("x"), k.secretKey);
    const trusted = new Map([[ed25519.pubkeyId(k.publicKey), k.publicKey]]);
    const v = ed25519.makeVerifier(trusted);
    expect(
      v(Buffer.from("x"), {
        alg: "SLH-DSA-128f",
        sig: sig.toString("base64url"),
        pubkey_id: ed25519.pubkeyId(k.publicKey),
      }),
    ).toBe(false);
  });

  it("makeVerifierFromLandmark builds verifier from trust_anchors", () => {
    const fixture = buildSignedFixture();
    const v = ed25519.makeVerifierFromLandmark(fixture.landmark);
    const cache = new LandmarkCache({ signatureVerifier: v });
    expect(() => cache.ingest(fixture.landmark)).not.toThrow();
    expect(cache.size()).toBe(1);
  });

  it("verifier built from one landmark rejects landmarks signed by other keys", () => {
    const f1 = buildSignedFixture();
    const f2 = buildSignedFixture();
    const v = ed25519.makeVerifierFromLandmark(f1.landmark);
    const cache = new LandmarkCache({ signatureVerifier: v });
    cache.ingest(f1.landmark);
    expect(() => cache.ingest(f2.landmark)).toThrowError(
      expect.objectContaining({ code: "BAD_TREE_HEAD_SIG" }),
    );
  });
});

describe("Full Ed25519 round-trip via cache + verifier", () => {
  it("verify(envelope) succeeds after real Ed25519-signed batch", () => {
    const f = buildSignedFixture();
    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(f.landmark),
    });
    cache.ingest(f.landmark);

    for (let i = 0; i < f.rawLeaves.length; i++) {
      const path = f.tree.prove(i);
      const envelope = {
        schema: SCHEMA_ENVELOPE,
        namespace: NS,
        tree_head_id: f.treeHeadId,
        leaf: f.rawLeaves[i],
        inclusion_proof: {
          leaf_index: i,
          tree_size: f.rawLeaves.length,
          audit_path: path.map((b) => encodeHashStr(b)),
        },
      };
      const result = verify(envelope, cache, {
        now: Date.parse("2026-04-26T13:00:00Z"),
      });
      expect(result.ok, `envelope ${i} failed: ${result.code}`).toBe(true);
    }
  });
});
