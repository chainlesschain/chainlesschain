"use strict";

import { describe, it, expect } from "vitest";

const {
  assembleBatch,
  assembleBatchFederated,
  ed25519,
  LandmarkCache,
  SCHEMA_LANDMARK,
} = require("../lib/index.js");

const META = {
  namespace: "mtc/v1/did/000001",
  issuer: "mtca:cc:zQ3shTest",
  issuedAt: "2026-04-26T12:00:00Z",
  expiresAt: "2026-05-03T12:00:00Z",
};

describe("LandmarkCache publisher_signature verification (opt-in)", () => {
  it("default mode (verifyPublisherSignature off) accepts placeholder sigs", () => {
    // Hand-built landmark with placeholder publisher_signature — mirrors
    // the on-disk shape of pre-fix-mtc-publisher-signature landmarks and
    // existing test fixtures.
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META);
    landmark.publisher_signature.sig = "TODO-PUBLISHER-SIG"; // simulate stale producer
    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      // verifyPublisherSignature defaults false
    });
    expect(() => cache.ingest(landmark)).not.toThrow();
  });

  it("opt-in mode accepts real publisher_signature from assembleBatch", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }, { b: 2 }], keys, META);
    expect(landmark.publisher_signature.sig).not.toBe("");
    expect(landmark.publisher_signature.sig).not.toMatch(/^TODO/);

    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      verifyPublisherSignature: true,
    });
    const result = cache.ingest(landmark);
    expect(result.accepted).toBe(1);
  });

  it("opt-in mode accepts real publisher_signature from assembleBatchFederated", () => {
    const k1 = ed25519.generateKeyPair();
    const k2 = ed25519.generateKeyPair();
    const k3 = ed25519.generateKeyPair();
    const { landmark } = assembleBatchFederated(
      [{ a: 1 }],
      [
        { ...k1, issuer: "did:cc:m1" },
        { ...k2, issuer: "did:cc:m2" },
        { ...k3, issuer: "did:cc:m3" },
      ],
      { ...META, issuer: "federation:test", threshold: 2 },
    );
    expect(landmark.publisher_signature.sig).not.toBe("");
    expect(landmark.publisher_signature.key_id).toContain("#federation");

    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      verifyPublisherSignature: true,
    });
    const result = cache.ingest(landmark);
    expect(result.accepted).toBe(1);
  });

  it("opt-in mode rejects landmark with tampered publisher_signature.sig", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META);
    const original = landmark.publisher_signature.sig;
    // Flip one base64url char to get a different but well-formed sig string
    landmark.publisher_signature.sig =
      original[0] === "A" ? "B" + original.slice(1) : "A" + original.slice(1);

    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      verifyPublisherSignature: true,
    });
    expect(() => cache.ingest(landmark)).toThrow(/BAD_LANDMARK_SIG/);
  });

  it("opt-in mode rejects landmark with mutated body after signing", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META);
    // Mutate published_at (a field outside the snapshot) — this is exactly
    // what publisher_signature is meant to catch (snapshot-level signatures
    // wouldn't notice changes to landmark-level fields).
    landmark.published_at = "1970-01-01T00:00:00Z";

    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      verifyPublisherSignature: true,
    });
    expect(() => cache.ingest(landmark)).toThrow(/BAD_LANDMARK_SIG/);
  });

  it("opt-in mode rejects landmark with placeholder sig", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META);
    landmark.publisher_signature.sig = "TODO-PUBLISHER-SIG";

    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      verifyPublisherSignature: true,
    });
    expect(() => cache.ingest(landmark)).toThrow(/BAD_LANDMARK_SIG/);
  });

  it("opt-in mode rejects landmark with missing publisher_signature", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META);
    delete landmark.publisher_signature;

    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      verifyPublisherSignature: true,
    });
    expect(() => cache.ingest(landmark)).toThrow(/BAD_LANDMARK_SIG/);
  });

  it("opt-in mode rejects landmark with empty trust_anchors", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META);
    const trustedKeys = new Map();
    trustedKeys.set(landmark.snapshots[0].signature.pubkey_id, keys.publicKey);
    landmark.trust_anchors = [];

    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifier(trustedKeys),
      verifyPublisherSignature: true,
    });
    expect(() => cache.ingest(landmark)).toThrow(/BAD_LANDMARK_SIG/);
  });

  it("opt-in mode rejects landmark with alg mismatch between sig and anchor", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META);
    // Producer wrote alg "Ed25519". Pretend it claims SLH-DSA — sig is
    // still well-formed bytes but the anchor's alg doesn't match.
    landmark.publisher_signature.alg = "SLH-DSA-SHA2-128F";

    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      verifyPublisherSignature: true,
    });
    expect(() => cache.ingest(landmark)).toThrow(/BAD_LANDMARK_SIG/);
  });

  it("schema sanity: SCHEMA_LANDMARK still emitted", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META);
    expect(landmark.schema).toBe(SCHEMA_LANDMARK);
  });
});
