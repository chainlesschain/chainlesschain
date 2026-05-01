"use strict";

import { describe, it, expect } from "vitest";

const {
  assembleBatchFederated,
  assembleBatch,
  ed25519,
  slhDsa,
  LandmarkCache,
  verify,
  SCHEMA_LANDMARK,
} = require("../lib/index.js");

/** Build a verifier that handles both Ed25519 and SLH-DSA anchors in the same landmark. */
function multiAlgVerifier(landmark) {
  const ed = ed25519.makeVerifierFromLandmark(landmark);
  const slh = slhDsa.makeVerifierFromLandmark(landmark);
  return (signingInput, sig) =>
    ed(signingInput, sig) || slh(signingInput, sig);
}

describe("assembleBatchFederated — M-of-N multi-signature", () => {
  it("emits signatures[] + threshold + N trust_anchors when given N signers", () => {
    const signers = [
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:fed-a" },
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:fed-b" },
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:fed-c" },
    ];
    const leaves = [
      { kind: "did-document", subject: "did:cc:zQ3a", content_hash: "sha256:" + Buffer.alloc(32, 1).toString("base64url") },
    ];
    const { landmark } = assembleBatchFederated(leaves, signers, {
      namespace: "mtc/v1/did/000001",
      issuer: "mtca:cc:fed-3",
      threshold: 2,
    });
    expect(landmark.snapshots[0].signatures).toHaveLength(3);
    expect(landmark.snapshots[0].threshold).toBe(2);
    expect(landmark.trust_anchors).toHaveLength(3);
    // Default snapshot lacks single-signer .signature field
    expect(landmark.snapshots[0].signature).toBeUndefined();
  });

  it("defaults threshold to signers.length (everyone-signs strict mode)", () => {
    const signers = [
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:fed-a" },
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:fed-b" },
    ];
    const { landmark } = assembleBatchFederated(
      [{ x: 1 }],
      signers,
      { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:fed-2" },
    );
    expect(landmark.snapshots[0].threshold).toBe(2);
  });

  it("supports mixed Ed25519 + SLH-DSA federation members", () => {
    const signers = [
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:classical", signer: ed25519 },
      { ...slhDsa.generateKeyPair(), issuer: "mtca:cc:pqc", signer: slhDsa },
    ];
    const { landmark, envelopes } = assembleBatchFederated(
      [{ kind: "did-document", subject: "did:cc:mixed", content_hash: "sha256:abc" }],
      signers,
      { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:fed-mixed", threshold: 2 },
    );
    expect(landmark.snapshots[0].signatures[0].alg).toBe("Ed25519");
    expect(landmark.snapshots[0].signatures[1].alg).toBe("SLH-DSA-SHA2-128F");
    expect(landmark.trust_anchors[0].alg).toBe("Ed25519");
    expect(landmark.trust_anchors[1].alg).toBe("SLH-DSA-SHA2-128F");

    // Round-trip: cache+verify with multi-alg verifier
    const cache = new LandmarkCache({ signatureVerifier: multiAlgVerifier(landmark) });
    cache.ingest(landmark);
    const r = verify(envelopes[0], cache);
    expect(r.ok, r.code).toBe(true);
  });

  it("rejects when threshold > signers.length", () => {
    const signers = [{ ...ed25519.generateKeyPair(), issuer: "mtca:cc:a" }];
    expect(() =>
      assembleBatchFederated(
        [{ x: 1 }],
        signers,
        { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:fed", threshold: 5 },
      ),
    ).toThrow(/threshold/);
  });

  it("rejects empty signers array", () => {
    expect(() =>
      assembleBatchFederated(
        [{ x: 1 }],
        [],
        { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:fed" },
      ),
    ).toThrow(/non-empty/);
  });

  it("rejects signer missing issuer", () => {
    const k = ed25519.generateKeyPair();
    expect(() =>
      assembleBatchFederated(
        [{ x: 1 }],
        [{ secretKey: k.secretKey, publicKey: k.publicKey }],
        { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:fed" },
      ),
    ).toThrow(/issuer/);
  });
});

describe("LandmarkCache — federation threshold validation", () => {
  function makeFedLandmark(threshold = 2) {
    const signers = [
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:fed-a" },
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:fed-b" },
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:fed-c" },
    ];
    const { landmark, envelopes } = assembleBatchFederated(
      [{ kind: "did-document", subject: "did:cc:test", content_hash: "sha256:abc" }],
      signers,
      { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:fed-3of3", threshold },
    );
    return { landmark, envelopes, signers };
  }

  it("accepts when all signatures verify (3-of-3)", () => {
    const { landmark } = makeFedLandmark(3);
    const cache = new LandmarkCache({ signatureVerifier: ed25519.makeVerifierFromLandmark(landmark) });
    expect(() => cache.ingest(landmark)).not.toThrow();
    expect(cache.size()).toBe(1);
  });

  it("accepts when ≥ threshold signatures verify (2-of-3)", () => {
    const { landmark } = makeFedLandmark(2);
    // Tamper with one signature — threshold still met by other 2
    landmark.snapshots[0].signatures[0] = {
      ...landmark.snapshots[0].signatures[0],
      sig: Buffer.alloc(64, 0).toString("base64url"),
    };
    const cache = new LandmarkCache({ signatureVerifier: ed25519.makeVerifierFromLandmark(landmark) });
    expect(() => cache.ingest(landmark)).not.toThrow();
  });

  it("rejects FEDERATION_THRESHOLD_NOT_MET when not enough sigs verify", () => {
    const { landmark } = makeFedLandmark(3);
    // Tamper with 2 of 3 sigs — only 1 valid, threshold = 3 → fail
    for (let i = 0; i < 2; i++) {
      landmark.snapshots[0].signatures[i] = {
        ...landmark.snapshots[0].signatures[i],
        sig: Buffer.alloc(64, 0).toString("base64url"),
      };
    }
    const cache = new LandmarkCache({ signatureVerifier: ed25519.makeVerifierFromLandmark(landmark) });
    let error;
    try {
      cache.ingest(landmark);
    } catch (e) {
      error = e;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe("FEDERATION_THRESHOLD_NOT_MET");
    expect(error.threshold).toBe(3);
    expect(error.valid).toBeLessThan(3);
  });

  it("ignores duplicate signatures from the same pubkey_id (no double-counting)", () => {
    const { landmark } = makeFedLandmark(2);
    // Replace second signature with a clone of the first (same pubkey_id)
    landmark.snapshots[0].signatures[1] = { ...landmark.snapshots[0].signatures[0] };
    // Tamper with the third — leaves us with 1 unique valid sig + 1 duplicate
    landmark.snapshots[0].signatures[2] = {
      ...landmark.snapshots[0].signatures[2],
      sig: Buffer.alloc(64, 0).toString("base64url"),
    };
    const cache = new LandmarkCache({ signatureVerifier: ed25519.makeVerifierFromLandmark(landmark) });
    let error;
    try {
      cache.ingest(landmark);
    } catch (e) {
      error = e;
    }
    expect(error?.code).toBe("FEDERATION_THRESHOLD_NOT_MET");
    // Only 1 unique signer counted, threshold was 2
    expect(error.valid).toBe(1);
  });

  it("classical single-sig landmarks still work (backward compat)", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark, envelopes } = assembleBatch(
      [{ kind: "did-document", subject: "did:cc:single", content_hash: "sha256:abc" }],
      keys,
      { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:single" },
    );
    expect(landmark.snapshots[0].signature).toBeDefined();
    expect(landmark.snapshots[0].signatures).toBeUndefined();
    const cache = new LandmarkCache({ signatureVerifier: ed25519.makeVerifierFromLandmark(landmark) });
    cache.ingest(landmark);
    expect(verify(envelopes[0], cache).ok).toBe(true);
  });
});
