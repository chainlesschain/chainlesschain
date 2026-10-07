// TEST ONLY: real v2 retained history and caller-selected anchor signing keys.
import { createHash, sign } from "node:crypto";
import {
  buildRrsiTenantIndexAnchor,
  serializeRrsiTenantIndexAnchorSignatureMessage,
} from "../../src/lib/evolution/rrsi-tenant-index-anchor-contracts.js";
import { rrsiFixtureDigest } from "./rrsi-shadow-fixture.js";
export function historyAnchorInput(
  index,
  point,
  keys,
  revision = 1,
  previousAnchorDigest = null,
) {
  const descriptor = index.descriptor;
  return {
    deploymentId: "history-deployment",
    tenantId: descriptor.tenantId,
    routingScope: "installation",
    indexId: descriptor.indexId,
    ledgerIdentity: descriptor.ledgerIdentity,
    artifactScope: {
      artifactTenantId: descriptor.artifactTenantId,
      audience: descriptor.audience,
      purpose: descriptor.purpose,
    },
    storageGraphDigest: rrsiFixtureDigest("declared-graph-not-physical-proof"),
    rootPublicKeyDigest: `sha256:${createHash("sha256")
      .update(keys.publicKey.export({ format: "der", type: "spki" }))
      .digest("hex")}`,
    revision,
    previousAnchorDigest,
    checkpoint: point.checkpoint,
    restrictionHistory: point.restrictionHistory,
  };
}
export function signHistoryAnchor(input, keys) {
  const anchor = buildRrsiTenantIndexAnchor(input);
  return {
    anchor,
    publicKeySpki: keys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    signature: sign(
      null,
      serializeRrsiTenantIndexAnchorSignatureMessage(anchor),
      keys.privateKey,
    ).toString("base64url"),
  };
}
