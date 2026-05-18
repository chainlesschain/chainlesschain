"use strict";

import { describe, it, expect } from "vitest";

const {
  slhDsa,
  assembleBatch,
  LandmarkCache,
  verify,
  SCHEMA_LANDMARK,
} = require("../lib/index.js");

describe("SLH-DSA-SHA2-128F signer (FIPS 205, opt-in)", () => {
  it("generates a keypair with documented byte sizes", () => {
    const k = slhDsa.generateKeyPair();
    expect(Buffer.isBuffer(k.secretKey)).toBe(true);
    expect(Buffer.isBuffer(k.publicKey)).toBe(true);
    expect(k.secretKey.length).toBe(slhDsa.SECRETKEY_LEN); // 64
    expect(k.publicKey.length).toBe(slhDsa.PUBKEY_LEN); // 32
    expect(k.pubkeyId).toMatch(/^sha256:/);
  });

  it("signRaw + makeVerifier round-trip on canonical tree-head bytes", () => {
    const k = slhDsa.generateKeyPair();
    const msg = Buffer.from("mtc/v1/tree-head\n{namespace:test}", "utf-8");
    const sigObj = slhDsa.signTreeHead(msg, {
      secretKey: k.secretKey,
      publicKey: k.publicKey,
      issuer: "mtca:cc:slh-test",
    });
    expect(sigObj.alg).toBe("SLH-DSA-SHA2-128F");
    expect(sigObj.sig).toMatch(/^[A-Za-z0-9_-]+$/);

    // Signature is ~17 KB → base64url ~22.7 KB
    const sigBytes = Buffer.from(sigObj.sig, "base64url");
    expect(sigBytes.length).toBe(slhDsa.SIGNATURE_LEN);

    const trusted = new Map([[sigObj.pubkey_id, k.publicKey]]);
    const verifier = slhDsa.makeVerifier(trusted);
    expect(verifier(msg, sigObj)).toBe(true);

    // Negative path: tampering with sig bytes
    const tampered = { ...sigObj, sig: Buffer.alloc(slhDsa.SIGNATURE_LEN, 0).toString("base64url") };
    expect(verifier(msg, tampered)).toBe(false);

    // Negative path: wrong message
    expect(verifier(Buffer.from("different", "utf-8"), sigObj)).toBe(false);
  });

  it("trustAnchorEntry produces a JWK round-trippable to the original public key", () => {
    const k = slhDsa.generateKeyPair();
    const anchor = slhDsa.trustAnchorEntry(k.publicKey, "mtca:cc:slh");
    expect(anchor.alg).toBe("SLH-DSA-SHA2-128F");
    expect(anchor.pubkey_jwk.kty).toBe("PQK");

    const recovered = slhDsa.jwkToPublicKey(anchor.pubkey_jwk);
    expect(recovered).not.toBeNull();
    expect(recovered.equals(k.publicKey)).toBe(true);
  });

  it("makeVerifierFromLandmark rejects Ed25519 anchors and verifies SLH-DSA", () => {
    const k = slhDsa.generateKeyPair();
    const landmark = {
      schema: SCHEMA_LANDMARK,
      trust_anchors: [
        { issuer: "x", alg: "Ed25519", pubkey_id: "sha256:fake", pubkey_jwk: {} },
        slhDsa.trustAnchorEntry(k.publicKey, "mtca:cc:slh"),
      ],
    };
    const verifier = slhDsa.makeVerifierFromLandmark(landmark);

    const msg = Buffer.from("hello", "utf-8");
    const sig = slhDsa.signTreeHead(msg, {
      secretKey: k.secretKey,
      publicKey: k.publicKey,
      issuer: "mtca:cc:slh",
    });
    expect(verifier(msg, sig)).toBe(true);
  });

  it("getPublicKey derives the original from the secret key (used by disk reload)", () => {
    const k = slhDsa.generateKeyPair();
    const derived = slhDsa.getPublicKey(k.secretKey);
    expect(derived.equals(k.publicKey)).toBe(true);
  });
});

describe("assembleBatch with opt-in SLH-DSA signer", () => {
  it("produces a landmark whose tree_head_signature.alg = SLH-DSA-SHA2-128F", () => {
    const keys = slhDsa.generateKeyPair();
    const leaves = Array.from({ length: 4 }, (_, i) => ({
      kind: "did-document",
      content_hash: "sha256:" + Buffer.alloc(32, i).toString("base64url"),
      issued_at: "2026-05-01T00:00:00Z",
      subject: `did:cc:zQ3slh${i}`,
    }));
    const { landmark, envelopes } = assembleBatch(
      leaves,
      keys,
      { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:slh-test" },
      slhDsa,
    );
    expect(landmark.snapshots[0].signature.alg).toBe("SLH-DSA-SHA2-128F");
    expect(landmark.trust_anchors[0].alg).toBe("SLH-DSA-SHA2-128F");
    expect(landmark.publisher_signature.alg).toBe("SLH-DSA-SHA2-128F");

    // Verifier path is the symmetric SLH-DSA verifier
    const cache = new LandmarkCache({
      signatureVerifier: slhDsa.makeVerifierFromLandmark(landmark),
    });
    cache.ingest(landmark);
    for (const env of envelopes) {
      const r = verify(env, cache);
      expect(r.ok, r.code).toBe(true);
    }
  });

  it("rejects an invalid signer prop (no signTreeHead)", () => {
    const keys = slhDsa.generateKeyPair();
    expect(() =>
      assembleBatch(
        [{ x: 1 }],
        keys,
        { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:x" },
        { /* missing signTreeHead */ },
      ),
    ).toThrow(/signer/);
  });
});
