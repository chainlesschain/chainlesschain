"use strict";

import { describe, it, expect } from "vitest";

const { assembleBatchFederated, ed25519, slhDsa, LandmarkCache } = require("../lib/index.js");

/**
 * makeVerifierFromLandmark must enforce the content-address binding
 * pubkey_id === sha256(JCS(jwk)). Otherwise a landmark can declare ONE key
 * under several distinct pubkey_ids; since the federated threshold counter in
 * landmark-cache dedups by sig.pubkey_id, a single key would satisfy an M-of-N
 * multi-signature — a Sybil forge of the federation threshold ("one node can't
 * fake a multi-sig"). It also blocks binding a pinned/trusted pubkey_id to an
 * attacker-controlled key.
 */

const CASES = [
  { name: "Ed25519", signer: ed25519, mkSigner: () => ({ ...ed25519.generateKeyPair(), issuer: "mtca:cc:real" }) },
  { name: "SLH-DSA", signer: slhDsa, mkSigner: () => ({ ...slhDsa.generateKeyPair(), issuer: "mtca:cc:real", signer: slhDsa }) },
];

describe("makeVerifierFromLandmark — pubkey_id content-address binding (anti-Sybil threshold forge)", () => {
  for (const c of CASES) {
    it(`${c.name}: one key declared under two pubkey_ids cannot satisfy 2-of-2`, () => {
      // Start from a clean 1-of-1 federated landmark signed by the attacker's
      // single key — the structure (tree_head, signing input, real sig) is valid.
      const { landmark } = assembleBatchFederated(
        [{ kind: "did-document", subject: "did:cc:victim", content_hash: "sha256:" + Buffer.alloc(32, 7).toString("base64url") }],
        [c.mkSigner()],
        { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:fed" },
      );
      const snap = landmark.snapshots[0];
      expect(snap.threshold).toBe(1);
      const realSig = snap.signatures[0];
      const realAnchor = landmark.trust_anchors[0];

      // Forge a phantom co-signer = the SAME key under a DIFFERENT pubkey_id,
      // and demand threshold 2. The phantom signature reuses the real sig bytes
      // (same key over the same signing input → genuinely verifies under a
      // mapping that trusts FAKE_ID → this key).
      const FAKE_ID = "sha256:" + Buffer.alloc(32, 0).toString("base64url");
      expect(FAKE_ID).not.toBe(realAnchor.pubkey_id);
      landmark.trust_anchors.push({
        issuer: "mtca:cc:phantom",
        alg: realAnchor.alg,
        pubkey_id: FAKE_ID,
        pubkey_jwk: realAnchor.pubkey_jwk, // same key bytes!
      });
      snap.signatures.push({ ...realSig, pubkey_id: FAKE_ID });
      snap.threshold = 2;

      const cache = new LandmarkCache({ signatureVerifier: c.signer.makeVerifierFromLandmark(landmark) });
      let error;
      try {
        cache.ingest(landmark);
      } catch (e) {
        error = e;
      }
      // Binding check drops the phantom anchor (pubkey_id ≠ sha256(JCS(jwk))),
      // so only the one real key counts → 1 < 2 → threshold not met.
      expect(error?.code).toBe("FEDERATION_THRESHOLD_NOT_MET");
      expect(error.valid).toBe(1);
    });

    it(`${c.name}: an honest single-signer landmark still verifies (regression)`, () => {
      const { landmark } = assembleBatchFederated(
        [{ kind: "did-document", subject: "did:cc:ok", content_hash: "sha256:abc" }],
        [c.mkSigner()],
        { namespace: "mtc/v1/did/000001", issuer: "mtca:cc:fed" },
      );
      const cache = new LandmarkCache({ signatureVerifier: c.signer.makeVerifierFromLandmark(landmark) });
      expect(() => cache.ingest(landmark)).not.toThrow();
      expect(cache.size()).toBe(1);
    });
  }
});
