/** Signed anchor declarations. A valid signature is never tenant authority. */
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  rrsiCanonical,
  rrsiHash,
  rrsiExact,
  rrsiId,
  rrsiDigest,
  rrsiInteger,
  rrsiEnvelope,
  verifyRrsiEnvelope,
  snapshotRrsiData,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_TENANT_INDEX_ANCHOR_SCHEMA =
  "chainlesschain.rrsi-tenant-index-anchor/v1";
export const RRSI_TENANT_INDEX_ANCHOR_SIGNATURE_SCHEMA =
  "chainlesschain.rrsi-tenant-index-anchor-signature-check/v1";
export const RRSI_TENANT_INDEX_ANCHOR_HOLD_CODE =
  "CC_RRSI_TENANT_INDEX_ANCHOR_HOLD";
const SIGNATURE_DOMAIN = "chainlesschain.rrsi-tenant-index-anchor-signature/v1";
const INPUT_KEYS = [
  "deploymentId",
  "tenantId",
  "routingScope",
  "indexId",
  "ledgerIdentity",
  "artifactScope",
  "storageGraphDigest",
  "rootPublicKeyDigest",
  "revision",
  "previousAnchorDigest",
  "checkpoint",
  "restrictionHistory",
];
const sha = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const same = (a, b) => rrsiCanonical(a) === rrsiCanonical(b);
function hold(message) {
  rrsiFail(message, RRSI_TENANT_INDEX_ANCHOR_HOLD_CODE);
}
function ledgerId(value, label) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(value)
  )
    hold(`${label} is not a Ledger identifier`);
}
function journalIdentity(value) {
  rrsiExact(
    value,
    ["ledgerId", "identityDigest", "epoch"],
    "anchor journal identity",
  );
  ledgerId(value.ledgerId, "ledgerId");
  ledgerId(value.epoch, "epoch");
  rrsiDigest(value.identityDigest, "identity digest");
}

export function buildRrsiTenantIndexAnchor(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, INPUT_KEYS, "tenant index anchor input");
  rrsiId(value.deploymentId, "deployment ID");
  rrsiId(value.tenantId, "tenant ID");
  if (!["installation", "shared-tenant-authority"].includes(value.routingScope))
    hold("anchor routing scope must be explicit");
  const expectedIndex = `rrsi-text.${rrsiHash("chainlesschain.rrsi-observed-text-index/v1", value.tenantId).slice(7)}`;
  if (value.indexId !== expectedIndex)
    hold("anchor index ID must derive only from tenant");
  journalIdentity(value.ledgerIdentity);
  rrsiExact(
    value.artifactScope,
    ["artifactTenantId", "audience", "purpose"],
    "anchor artifact scope",
  );
  for (const [name, entry] of Object.entries(value.artifactScope))
    rrsiId(entry, name);
  if (value.artifactScope.purpose !== "evolution-ledger")
    hold("anchor requires original Ledger retention purpose");
  rrsiDigest(value.storageGraphDigest, "storage graph digest");
  rrsiDigest(value.rootPublicKeyDigest, "declared root public key digest");
  rrsiInteger(value.revision, "anchor revision", 1, 2 ** 31 - 1);
  if (value.revision === 1) {
    if (value.previousAnchorDigest !== null)
      hold("first anchor must not claim a predecessor");
  } else rrsiDigest(value.previousAnchorDigest, "previous anchor digest");
  rrsiExact(
    value.checkpoint,
    ["ledgerId", "identityDigest", "epoch", "sequence", "headDigest"],
    "anchor checkpoint",
  );
  const checkpointIdentity = Object.fromEntries(
    ["ledgerId", "identityDigest", "epoch"].map((name) => [
      name,
      value.checkpoint[name],
    ]),
  );
  if (!same(checkpointIdentity, value.ledgerIdentity))
    hold("anchor checkpoint belongs to another journal");
  rrsiInteger(value.checkpoint.sequence, "checkpoint sequence", 0);
  rrsiDigest(value.checkpoint.headDigest, "checkpoint head digest");
  rrsiExact(
    value.restrictionHistory,
    ["recordCount", "tailRecordDigest", "restrictionsDigest"],
    "anchor restriction history",
  );
  rrsiInteger(
    value.restrictionHistory.recordCount,
    "restriction record count",
    0,
    256,
  );
  if (value.restrictionHistory.recordCount > value.checkpoint.sequence)
    hold("restriction count exceeds the declared journal checkpoint");
  if (value.restrictionHistory.recordCount === 0) {
    if (value.restrictionHistory.tailRecordDigest !== null)
      hold("empty restriction history must have no tail");
  } else
    rrsiDigest(
      value.restrictionHistory.tailRecordDigest,
      "restriction tail digest",
    );
  rrsiDigest(
    value.restrictionHistory.restrictionsDigest,
    "restriction set digest",
  );
  return rrsiEnvelope(RRSI_TENANT_INDEX_ANCHOR_SCHEMA, "anchorDigest", value);
}

export function verifyRrsiTenantIndexAnchor(input) {
  return verifyRrsiEnvelope(
    input,
    RRSI_TENANT_INDEX_ANCHOR_SCHEMA,
    "anchorDigest",
    INPUT_KEYS,
    buildRrsiTenantIndexAnchor,
  );
}

/** Exact domain-separated bytes for an external signer; no signer default. */
export function serializeRrsiTenantIndexAnchorSignatureMessage(anchor) {
  const checked = verifyRrsiTenantIndexAnchor(anchor);
  return Buffer.from(`${SIGNATURE_DOMAIN}\0${rrsiCanonical(checked)}`, "utf8");
}

/**
 * Mathematical verification against an explicitly supplied public key only.
 * This deliberately creates no trusted-root brand, pin store or routing grant.
 */
export function verifyRrsiTenantIndexAnchorSignature(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(
    value,
    ["anchor", "publicKeySpki", "signature"],
    "anchor signature input",
  );
  const anchor = verifyRrsiTenantIndexAnchor(value.anchor);
  if (
    typeof value.publicKeySpki !== "string" ||
    value.publicKeySpki.length > 128
  )
    hold("anchor public key must be bounded canonical Ed25519 SPKI");
  const publicBytes = Buffer.from(value.publicKeySpki, "base64url");
  if (
    publicBytes.length !== 44 ||
    publicBytes.toString("base64url") !== value.publicKeySpki
  )
    hold("anchor public key SPKI encoding differs");
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: publicBytes,
      format: "der",
      type: "spki",
    });
  } catch {
    hold("anchor public key SPKI cannot be parsed");
  }
  if (
    publicKey.asymmetricKeyType !== "ed25519" ||
    !publicKey.export({ format: "der", type: "spki" }).equals(publicBytes)
  )
    hold("anchor public key must be exact Ed25519 SPKI");
  if (sha(publicBytes) !== anchor.rootPublicKeyDigest)
    hold("anchor public key differs from the declared root digest");
  if (typeof value.signature !== "string" || value.signature.length !== 86)
    hold("anchor signature must be bounded canonical Ed25519 bytes");
  const signatureBytes = Buffer.from(value.signature, "base64url");
  if (
    signatureBytes.length !== 64 ||
    signatureBytes.toString("base64url") !== value.signature
  )
    hold("anchor signature encoding differs");
  if (
    !verify(
      null,
      serializeRrsiTenantIndexAnchorSignatureMessage(anchor),
      publicKey,
      signatureBytes,
    )
  )
    hold("anchor signature was rejected");
  return rrsiEnvelope(
    RRSI_TENANT_INDEX_ANCHOR_SIGNATURE_SCHEMA,
    "signatureCheckDigest",
    {
      anchorDigest: anchor.anchorDigest,
      publicKeyDigest: anchor.rootPublicKeyDigest,
      declaredDeploymentId: anchor.deploymentId,
      declaredTenantId: anchor.tenantId,
      declaredRoutingScope: anchor.routingScope,
      signatureVerifiedRelativeToKey: true,
      rootAuthorityVerified: false,
      routingPinVerified: false,
      historyTransferVerified: false,
      tenantWideIndexAuthorityVerified: false,
      generationProvenanceVerified: false,
      grantsMutationOrPromotionAuthority: false,
      decision: "HOLD",
    },
  );
}
