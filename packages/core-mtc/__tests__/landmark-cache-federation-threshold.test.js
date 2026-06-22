"use strict";

/**
 * LandmarkCache federated-threshold validation.
 *
 * The federated multi-sig intake must reject a malformed threshold up front,
 * symmetric with the producers (batch.js assembleBatchFederated and
 * createCrossFederationTrustAnchor both require threshold in [1, N]). A
 * threshold exceeding the signature count is unsatisfiable by construction and
 * must surface a clear BAD_FEDERATION_THRESHOLD — not a misleading
 * FEDERATION_THRESHOLD_NOT_MET that reads as "consensus fell short" when the
 * snapshot itself is malformed.
 */

import { describe, it, expect } from "vitest";

const {
  assembleBatchFederated,
  ed25519,
  slhDsa,
  LandmarkCache,
} = require("../lib/index.js");

const META = {
  namespace: "mtc/v1/did/000001",
  issuer: "mtca:cc:fed-threshold",
  issuedAt: "2026-04-26T12:00:00Z",
  expiresAt: "2030-01-01T12:00:00Z",
};

function multiAlgVerifier(landmark) {
  const ed = ed25519.makeVerifierFromLandmark(landmark);
  const slh = slhDsa.makeVerifierFromLandmark(landmark);
  return (signingInput, sig) =>
    ed(signingInput, sig) || slh(signingInput, sig);
}

describe("LandmarkCache federated-threshold validation", () => {
  function federatedLandmark() {
    const signers = [
      { ...ed25519.generateKeyPair(), issuer: "mtca:cc:a", signer: ed25519 },
      { ...slhDsa.generateKeyPair(), issuer: "mtca:cc:b", signer: slhDsa },
    ];
    return assembleBatchFederated([{ a: 1 }], signers, {
      ...META,
      threshold: 2,
    }).landmark;
  }

  it("accepts a well-formed 2-of-2 federated landmark (regression)", () => {
    const landmark = federatedLandmark();
    const cache = new LandmarkCache({
      signatureVerifier: multiAlgVerifier(landmark),
    });
    expect(cache.ingest(landmark).accepted).toBe(1);
  });

  it("rejects threshold > signature count as BAD_FEDERATION_THRESHOLD", () => {
    const landmark = federatedLandmark();
    expect(landmark.snapshots[0].signatures.length).toBe(2);
    // threshold is NOT part of the signed tree_head, so hand-setting it to an
    // unsatisfiable value reaches the federated-threshold guard (it does not
    // trip the tree_head_id check, and publisher_signature is not verified by
    // default).
    landmark.snapshots[0].threshold = 5;
    const cache = new LandmarkCache({
      signatureVerifier: multiAlgVerifier(landmark),
    });
    try {
      cache.ingest(landmark);
      throw new Error("expected BAD_FEDERATION_THRESHOLD");
    } catch (e) {
      // Pre-fix this fell through to the counting loop → FEDERATION_THRESHOLD_NOT_MET.
      expect(e.code).toBe("BAD_FEDERATION_THRESHOLD");
    }
  });

  it("still rejects threshold < 1 (lower bound preserved)", () => {
    const landmark = federatedLandmark();
    landmark.snapshots[0].threshold = 0;
    const cache = new LandmarkCache({
      signatureVerifier: multiAlgVerifier(landmark),
    });
    try {
      cache.ingest(landmark);
      throw new Error("expected BAD_FEDERATION_THRESHOLD");
    } catch (e) {
      expect(e.code).toBe("BAD_FEDERATION_THRESHOLD");
    }
  });
});
