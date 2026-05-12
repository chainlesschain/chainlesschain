"use strict";

/**
 * LandmarkCache strict PQ mode (#21 B.6).
 *
 * Verifies opt-in strict mode that rejects landmarks containing any
 * classical-algorithm signature (currently: Ed25519). Mixed federations
 * remain accepted in default mode for back-compat.
 *
 * See lib/landmark-cache.js _assertStrictPqMode for the semantic
 * (Reading A: every member must use SLH-DSA, no hybrid pair per member).
 */

import { describe, it, expect } from "vitest";

const {
  assembleBatch,
  assembleBatchFederated,
  ed25519,
  slhDsa,
  LandmarkCache,
  CLASSICAL_ALGS,
  isClassicalAlg,
} = require("../lib/index.js");

const META = {
  namespace: "mtc/v1/did/000001",
  issuer: "mtca:cc:strict-pq",
  issuedAt: "2026-04-26T12:00:00Z",
  expiresAt: "2030-01-01T12:00:00Z",
};

function multiAlgVerifier(landmark) {
  const ed = ed25519.makeVerifierFromLandmark(landmark);
  const slh = slhDsa.makeVerifierFromLandmark(landmark);
  return (signingInput, sig) =>
    ed(signingInput, sig) || slh(signingInput, sig);
}

describe("LandmarkCache strict PQ mode (#21 B.6)", () => {
  it("exposes CLASSICAL_ALGS + isClassicalAlg helpers", () => {
    expect(Array.isArray(CLASSICAL_ALGS)).toBe(true);
    expect(CLASSICAL_ALGS).toContain("Ed25519");
    expect(isClassicalAlg("Ed25519")).toBe(true);
    expect(isClassicalAlg("SLH-DSA-SHA2-128F")).toBe(false);
    expect(isClassicalAlg(undefined)).toBe(false);
    expect(isClassicalAlg(null)).toBe(false);
    expect(isClassicalAlg("")).toBe(false);
  });

  it("default mode accepts mixed Ed25519+SLH-DSA federation (regression)", () => {
    const signers = [
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:classical", signer: ed25519 },
      { ...slhDsa.generateKeyPair(), issuer: "mtca:cc:pqc", signer: slhDsa },
    ];
    const { landmark } = assembleBatchFederated(
      [{ kind: "did-document", subject: "did:cc:mixed", content_hash: "sha256:abc" }],
      signers,
      { ...META, issuer: "mtca:cc:fed-mixed", threshold: 2 },
    );

    const cache = new LandmarkCache({ signatureVerifier: multiAlgVerifier(landmark) });
    expect(() => cache.ingest(landmark)).not.toThrow();
  });

  it("strict mode rejects mixed federation where any partial sig is Ed25519", () => {
    const signers = [
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:classical", signer: ed25519 },
      { ...slhDsa.generateKeyPair(), issuer: "mtca:cc:pqc", signer: slhDsa },
    ];
    const { landmark } = assembleBatchFederated(
      [{ kind: "did-document", subject: "did:cc:mixed", content_hash: "sha256:abc" }],
      signers,
      { ...META, issuer: "mtca:cc:fed-mixed", threshold: 2 },
    );

    const cache = new LandmarkCache({
      signatureVerifier: multiAlgVerifier(landmark),
      strictPqMode: true,
    });
    try {
      cache.ingest(landmark);
      throw new Error("expected STRICT_PQ_MODE_VIOLATION");
    } catch (e) {
      expect(e.code).toBe("STRICT_PQ_MODE_VIOLATION");
      // The Ed25519 sig comes through either publisher_signature (signers[0])
      // OR the snapshot signature index 0 — both are legitimate violations.
      expect(["publisher_signature", "snapshot_signature"]).toContain(e.violation);
      expect(e.alg).toBe("Ed25519");
    }
  });

  it("strict mode accepts all-SLH-DSA federation", () => {
    const signers = [
      { ...slhDsa.generateKeyPair(), issuer: "mtca:cc:pqc-a", signer: slhDsa },
      { ...slhDsa.generateKeyPair(), issuer: "mtca:cc:pqc-b", signer: slhDsa },
      { ...slhDsa.generateKeyPair(), issuer: "mtca:cc:pqc-c", signer: slhDsa },
    ];
    const { landmark } = assembleBatchFederated(
      [{ kind: "did-document", subject: "did:cc:pqc-only", content_hash: "sha256:def" }],
      signers,
      { ...META, issuer: "mtca:cc:fed-pqc", threshold: 2 },
    );
    expect(landmark.publisher_signature.alg).toBe("SLH-DSA-SHA2-128F");
    landmark.snapshots[0].signatures.forEach((sig) => {
      expect(sig.alg).toBe("SLH-DSA-SHA2-128F");
    });

    const cache = new LandmarkCache({
      signatureVerifier: multiAlgVerifier(landmark),
      strictPqMode: true,
    });
    const result = cache.ingest(landmark);
    expect(result.accepted).toBe(1);
  });

  it("strict mode rejects single-signer Ed25519 landmark", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META);
    expect(landmark.publisher_signature.alg).toBe("Ed25519");
    expect(landmark.snapshots[0].signature.alg).toBe("Ed25519");

    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      strictPqMode: true,
    });
    try {
      cache.ingest(landmark);
      throw new Error("expected STRICT_PQ_MODE_VIOLATION");
    } catch (e) {
      expect(e.code).toBe("STRICT_PQ_MODE_VIOLATION");
      // publisher_signature is checked first
      expect(e.violation).toBe("publisher_signature");
      expect(e.alg).toBe("Ed25519");
    }
  });

  it("strict mode accepts single-signer SLH-DSA landmark", () => {
    const keys = slhDsa.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META, slhDsa);
    expect(landmark.publisher_signature.alg).toBe("SLH-DSA-SHA2-128F");
    expect(landmark.snapshots[0].signature.alg).toBe("SLH-DSA-SHA2-128F");

    const cache = new LandmarkCache({
      signatureVerifier: slhDsa.makeVerifierFromLandmark(landmark),
      strictPqMode: true,
    });
    const result = cache.ingest(landmark);
    expect(result.accepted).toBe(1);
  });

  it("strict mode rejects hand-mutated Ed25519 publisher_signature even if all snapshot sigs are SLH-DSA", () => {
    const signers = [
      { ...slhDsa.generateKeyPair(), issuer: "mtca:cc:pqc-a", signer: slhDsa },
      { ...slhDsa.generateKeyPair(), issuer: "mtca:cc:pqc-b", signer: slhDsa },
    ];
    const { landmark } = assembleBatchFederated(
      [{ a: 1 }],
      signers,
      { ...META, issuer: "mtca:cc:fed-tampered", threshold: 2 },
    );
    // Hand-mutate publisher_signature.alg to "Ed25519" while leaving snap sigs
    // as SLH-DSA. This isn't a natural producer output — it simulates an
    // attacker downgrading publisher_signature label on the wire.
    landmark.publisher_signature.alg = "Ed25519";

    const cache = new LandmarkCache({
      signatureVerifier: multiAlgVerifier(landmark),
      strictPqMode: true,
    });
    try {
      cache.ingest(landmark);
      throw new Error("expected STRICT_PQ_MODE_VIOLATION");
    } catch (e) {
      expect(e.code).toBe("STRICT_PQ_MODE_VIOLATION");
      expect(e.violation).toBe("publisher_signature");
      expect(e.alg).toBe("Ed25519");
    }
  });

  it("strict mode + verifyPublisherSignature compose without conflict (both gates pass)", () => {
    const keys = slhDsa.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }, { b: 2 }], keys, META, slhDsa);

    const cache = new LandmarkCache({
      signatureVerifier: slhDsa.makeVerifierFromLandmark(landmark),
      strictPqMode: true,
      verifyPublisherSignature: true,
    });
    const result = cache.ingest(landmark);
    expect(result.accepted).toBe(1);
  });

  it("strict mode runs gate BEFORE verifyPublisherSignature (fails fast on alg, not sig bytes)", () => {
    // Single-signer Ed25519 with tampered publisher_signature.sig.
    // Without strict mode, this would fail BAD_LANDMARK_SIG.
    // With strict mode, it should fail STRICT_PQ_MODE_VIOLATION first (alg check
    // runs before sig verify), proving the gate ordering is correct.
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, META);
    const original = landmark.publisher_signature.sig;
    landmark.publisher_signature.sig =
      original[0] === "A" ? "B" + original.slice(1) : "A" + original.slice(1);

    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
      strictPqMode: true,
      verifyPublisherSignature: true,
    });
    try {
      cache.ingest(landmark);
      throw new Error("expected STRICT_PQ_MODE_VIOLATION");
    } catch (e) {
      expect(e.code).toBe("STRICT_PQ_MODE_VIOLATION");
    }
  });
});
