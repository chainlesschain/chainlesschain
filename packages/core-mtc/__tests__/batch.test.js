"use strict";

import { describe, it, expect } from "vitest";

const {
  assembleBatch,
  ed25519,
  LandmarkCache,
  verify,
  SCHEMA_LANDMARK,
  SCHEMA_ENVELOPE,
  SCHEMA_TREE_HEAD,
} = require("../lib/index.js");

describe("assembleBatch", () => {
  it("produces landmark + N envelopes with valid inclusion proofs", () => {
    const keys = ed25519.generateKeyPair();
    const leaves = Array.from({ length: 4 }, (_, i) => ({
      kind: "did-document",
      content_hash: "sha256:" + Buffer.alloc(32, i).toString("base64url"),
      issued_at: "2026-04-26T10:00:00Z",
      subject: `did:cc:zQ3shTest${i}`,
    }));

    const { landmark, envelopes, treeHeadId } = assembleBatch(leaves, keys, {
      namespace: "mtc/v1/did/000001",
      issuer: "mtca:cc:zQ3shTest",
      issuedAt: "2026-04-26T12:00:00Z",
      expiresAt: "2026-05-03T12:00:00Z",
    });

    expect(landmark.schema).toBe(SCHEMA_LANDMARK);
    expect(landmark.snapshots).toHaveLength(1);
    expect(landmark.snapshots[0].tree_head_id).toBe(treeHeadId);
    expect(landmark.snapshots[0].tree_head.schema).toBe(SCHEMA_TREE_HEAD);
    expect(landmark.snapshots[0].tree_head.tree_size).toBe(4);
    expect(landmark.trust_anchors).toHaveLength(1);

    expect(envelopes).toHaveLength(4);
    for (let i = 0; i < envelopes.length; i++) {
      expect(envelopes[i].schema).toBe(SCHEMA_ENVELOPE);
      expect(envelopes[i].tree_head_id).toBe(treeHeadId);
      expect(envelopes[i].inclusion_proof.leaf_index).toBe(i);
      expect(envelopes[i].inclusion_proof.tree_size).toBe(4);
    }

    // Round-trip: envelopes verify against landmark
    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
    });
    cache.ingest(landmark);
    const now = Date.parse("2026-04-27T00:00:00Z");
    for (const env of envelopes) {
      const r = verify(env, cache, { now });
      expect(r.ok, `envelope ${env.inclusion_proof.leaf_index}: ${r.code}`).toBe(true);
    }
  });

  it("rejects non-array leaves and missing meta", () => {
    const keys = ed25519.generateKeyPair();
    expect(() => assembleBatch([], keys, { namespace: "x", issuer: "y" })).toThrow(/non-empty/);
    expect(() => assembleBatch([{}], keys, {})).toThrow(/namespace/);
    expect(() => assembleBatch([{}], { secretKey: null, publicKey: null }, { namespace: "x", issuer: "y" })).toThrow(/secretKey/);
  });

  it("namespace prefix in landmark is parent of tree_head namespace", () => {
    const keys = ed25519.generateKeyPair();
    const { landmark } = assembleBatch([{ a: 1 }], keys, {
      namespace: "mtc/v1/audit/org-42/000007",
      issuer: "mtca:cc:zQ3shTest",
    });
    expect(landmark.namespace).toBe("mtc/v1/audit/org-42");
    expect(landmark.snapshots[0].tree_head.namespace).toBe(
      "mtc/v1/audit/org-42/000007",
    );
  });
});
