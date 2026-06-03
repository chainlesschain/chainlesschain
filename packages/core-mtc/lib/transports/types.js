"use strict";

/**
 * LandmarkTransport — abstract interface for distributing landmarks
 * between MTCA nodes and verifier nodes.
 *
 * Design (decoupled from libp2p/IPFS so we can test offline and ship
 * multiple backends):
 *   - publish(landmark) → returns { cid, namespace, tree_size }
 *   - subscribe(namespacePrefix, onAnnouncement) → returns unsubscribe fn
 *   - fetch(cid) → returns landmark JSON
 *   - close() → tear down resources
 *
 * Announcement payload (kept small — fits a typical pub/sub message):
 *   { namespace, cid, tree_size, published_at }
 *
 * The transport NEVER verifies signatures or schemas; it just moves bytes.
 * The receiving node feeds fetched landmarks into its own LandmarkCache,
 * which does all the cryptographic work.
 *
 * Implementations:
 *   - InMemoryTransport: single-process pub/sub via shared broker
 *   - FilesystemTransport: drop-zone directory (offline / LAN sync)
 *   - (future) Libp2pTransport: gossipsub + IPFS pin (Phase 1.5+)
 */

// A prefix must be `mtc/v1/<kind>` or `mtc/v1/<kind>/<scope>` where scope
// is NOT purely 6+ digits (which would be a batch-seq, i.e. a full namespace).
const SUBSCRIPTION_PREFIX_RE = /^mtc\/v1\/[a-z]+(\/(?!\d{6,}$)[a-zA-Z0-9_-]+)?$/;

function validateNamespacePrefix(prefix) {
  if (typeof prefix !== "string" || !SUBSCRIPTION_PREFIX_RE.test(prefix)) {
    const e = new Error(
      `Invalid namespace prefix: ${prefix} — expected mtc/v1/<kind>[/<scope>]`,
    );
    e.code = "BAD_NAMESPACE_PREFIX";
    throw e;
  }
}

/**
 * Extract the (kind/scope) prefix from a full snapshot namespace
 * (which contains a trailing batch-seq).
 *
 *   mtc/v1/did/000142            → mtc/v1/did
 *   mtc/v1/audit/acme/000007     → mtc/v1/audit/acme
 */
function namespaceToPrefix(namespace) {
  const parts = namespace.split("/");
  if (parts.length < 4) return namespace;
  return parts.slice(0, -1).join("/");
}

/**
 * Build an announcement payload from a landmark.
 * Picks the largest tree_size snapshot if the landmark contains many.
 */
function announcementFromLandmark(landmark, cid) {
  if (!landmark || !Array.isArray(landmark.snapshots) || landmark.snapshots.length === 0) {
    throw new Error("announcementFromLandmark: landmark missing snapshots");
  }
  let maxSize = 0;
  let pickedNs = null;
  for (const snap of landmark.snapshots) {
    if (snap.tree_head && snap.tree_head.tree_size > maxSize) {
      maxSize = snap.tree_head.tree_size;
      pickedNs = snap.tree_head.namespace;
    }
  }
  return {
    namespace: pickedNs,
    namespace_prefix: namespaceToPrefix(pickedNs),
    cid,
    tree_size: maxSize,
    published_at: landmark.published_at,
  };
}

/**
 * Compare two namespace prefixes — returns true if `subscriptionPrefix`
 * matches `announcementPrefix` (subscription is broader or equal).
 *
 *   sub=mtc/v1/did, ann=mtc/v1/did       → true
 *   sub=mtc/v1/did, ann=mtc/v1/audit     → false
 *   sub=mtc/v1/audit, ann=mtc/v1/audit/acme → true (broader sub matches scoped ann)
 *   sub=mtc/v1/audit/acme, ann=mtc/v1/audit/globex → false
 */
function prefixMatches(subscriptionPrefix, announcementPrefix) {
  if (subscriptionPrefix === announcementPrefix) return true;
  return announcementPrefix.startsWith(subscriptionPrefix + "/");
}

module.exports = {
  validateNamespacePrefix,
  namespaceToPrefix,
  announcementFromLandmark,
  prefixMatches,
  SUBSCRIPTION_PREFIX_RE,
};
