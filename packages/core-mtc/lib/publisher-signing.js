"use strict";

/**
 * Strip per-snapshot signature bytes when canonicalizing a landmark for
 * publisher_signature signing/verification.
 *
 * Producer (batch.js, governance-multisig.js mirror) and verifier
 * (landmark-cache.js) both feed this stripped form into the JCS so they
 * agree byte-for-byte. Stripping the per-member sigs preserves M-of-N
 * threshold tolerance: tampering with up to N-T per-member sigs leaves
 * publisher_signature valid because the stripped JCS is identical, and
 * tree_head verification still rejects the landmark only when fewer than
 * T sigs verify. Without stripping, ANY per-member sig mutation would
 * invalidate publisher_signature even when threshold is satisfied —
 * defeating the whole point of M-of-N.
 *
 * Publisher_signature still binds: namespace, trust_anchors order,
 * published_at, snapshot count + tree_head_id + threshold + alg/pubkey_id
 * of each per-member sig. Only the raw `sig` bytes are placeholder-d.
 */
function _stripSigsForPublisher(landmark) {
  return {
    ...landmark,
    publisher_signature: {
      ...landmark.publisher_signature,
      sig: "",
    },
    snapshots: landmark.snapshots.map((s) => {
      const next = { ...s };
      if (next.signature && typeof next.signature === "object") {
        next.signature = { ...next.signature, sig: "" };
      }
      if (Array.isArray(next.signatures)) {
        next.signatures = next.signatures.map((m) => ({ ...m, sig: "" }));
      }
      return next;
    }),
  };
}

module.exports = { _stripSigsForPublisher };
