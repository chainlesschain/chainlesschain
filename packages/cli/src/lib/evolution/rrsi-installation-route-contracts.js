/** Local route declarations only: no installer authorization or durable pin. */
import { createHash, createPublicKey } from "node:crypto";
import {
  rrsiCanonical,
  rrsiDigest,
  rrsiEnvelope,
  rrsiExact,
  rrsiFail,
  rrsiId,
  snapshotRrsiData,
  verifyRrsiEnvelope,
} from "./rrsi-data.js";
import { verifyRrsiTenantIndexAnchorSignature } from "./rrsi-tenant-index-anchor-contracts.js";

export const RRSI_INSTALLATION_ROUTE_HOLD_CODE =
  "CC_RRSI_INSTALLATION_ROUTE_HOLD";
export const RRSI_INSTALLATION_ROUTE_ROOT_SCHEMA =
  "chainlesschain.rrsi-installation-route-root/v1";
export const RRSI_INSTALLATION_ROUTES_SCHEMA =
  "chainlesschain.rrsi-installation-routes/v1";
export const RRSI_INSTALLATION_ROUTE_HIGHWATER_SCHEMA =
  "chainlesschain.rrsi-installation-route-highwater/v1";
export const RRSI_INSTALLATION_ROUTE_MAX_ANCHORS = 64;
const ROOT_KEYS = [
  "installationId",
  "tenantId",
  "routingScope",
  "rootPublicKeySpki",
  "rootPublicKeyDigest",
];
const FIXED_ANCHOR_KEYS = [
  "deploymentId",
  "tenantId",
  "routingScope",
  "indexId",
  "ledgerIdentity",
  "artifactScope",
  "storageGraphDigest",
  "rootPublicKeyDigest",
];
const HIGHWATER_KEYS = [
  "installationId",
  "tenantId",
  "rootRecordDigest",
  "routesDigest",
  "anchorRevision",
  "anchorDigest",
  "checkpoint",
  "restrictionHistory",
];
const FALSE_AUTHORITY = Object.freeze({
  selectedContextOnly: true,
  rootAuthorityVerified: false,
  installationBindingSignatureVerified: false,
  routingPinVerified: false,
  historyTransferVerified: false,
  journalPrefixVerified: false,
  restrictionHistoryVerified: false,
  crossProcessRollbackProtectionVerified: false,
  tenantWideIndexAuthorityVerified: false,
  generationProvenanceVerified: false,
  grantsMutationOrPromotionAuthority: false,
  decision: "HOLD",
});
const same = (a, b) => rrsiCanonical(a) === rrsiCanonical(b);
function hold(message) {
  rrsiFail(message, RRSI_INSTALLATION_ROUTE_HOLD_CODE);
}

export function buildRrsiInstallationRouteRoot(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, ROOT_KEYS, "installation route root input");
  rrsiId(value.installationId, "installation ID");
  rrsiId(value.tenantId, "installation tenant ID");
  if (value.routingScope !== "installation")
    hold("root scope must be installation");
  rrsiDigest(value.rootPublicKeyDigest, "declared root key digest");
  if (
    typeof value.rootPublicKeySpki !== "string" ||
    value.rootPublicKeySpki.length !== 59
  )
    hold("root key must be canonical Ed25519 SPKI");
  const bytes = Buffer.from(value.rootPublicKeySpki, "base64url");
  if (
    bytes.length !== 44 ||
    bytes.toString("base64url") !== value.rootPublicKeySpki
  )
    hold("root key encoding differs");
  let key;
  try {
    key = createPublicKey({ key: bytes, format: "der", type: "spki" });
  } catch {
    hold("root key cannot be parsed");
  }
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !key.export({ format: "der", type: "spki" }).equals(bytes)
  )
    hold("root key must be exact Ed25519 SPKI");
  if (
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
    value.rootPublicKeyDigest
  )
    hold("root key digest differs");
  return rrsiEnvelope(
    RRSI_INSTALLATION_ROUTE_ROOT_SCHEMA,
    "rootRecordDigest",
    value,
  );
}

export function verifyRrsiInstallationRouteRoot(input) {
  return verifyRrsiEnvelope(
    input,
    RRSI_INSTALLATION_ROUTE_ROOT_SCHEMA,
    "rootRecordDigest",
    ROOT_KEYS,
    buildRrsiInstallationRouteRoot,
  );
}

function signedPacket(value) {
  // The existing verifier enforces exact fields and signatures, not root trust.
  verifyRrsiTenantIndexAnchorSignature(value);
  return value.anchor;
}

export function checkRrsiInstallationAnchorContinuation(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, ["previous", "next"], "route continuation input");
  const previous = signedPacket(value.previous),
    next = signedPacket(value.next);
  if (
    previous.routingScope !== "installation" ||
    next.routingScope !== "installation"
  )
    hold("continuation scope must be installation");
  if (value.previous.publicKeySpki !== value.next.publicKeySpki)
    hold("continuation cannot change root key");
  for (const name of FIXED_ANCHOR_KEYS)
    if (!same(previous[name], next[name]))
      hold(`continuation cannot change ${name}`);
  let continuation;
  if (next.revision === previous.revision) {
    if (next.anchorDigest !== previous.anchorDigest)
      hold("same revision has a different anchor");
    continuation = "same-anchor";
  } else {
    if (next.revision !== previous.revision + 1)
      hold("continuation revision must increase exactly once");
    if (next.previousAnchorDigest !== previous.anchorDigest)
      hold("continuation predecessor differs");
    if (!same(next.checkpoint, previous.checkpoint))
      hold("checkpoint advancement requires independent journal prefix proof");
    if (!same(next.restrictionHistory, previous.restrictionHistory))
      hold("restriction change requires independent retained history proof");
    continuation = "declared-successor";
  }
  return rrsiEnvelope(
    "chainlesschain.rrsi-installation-route-continuation-check/v1",
    "continuationCheckDigest",
    {
      previousAnchorDigest: previous.anchorDigest,
      nextAnchorDigest: next.anchorDigest,
      continuation,
      declaredContinuationConsistent: true,
      ...FALSE_AUTHORITY,
    },
  );
}

export function buildRrsiInstallationRoutes(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, ["root", "packets"], "installation routes input");
  const root = verifyRrsiInstallationRouteRoot(value.root);
  if (
    !Array.isArray(value.packets) ||
    value.packets.length < 1 ||
    value.packets.length > RRSI_INSTALLATION_ROUTE_MAX_ANCHORS
  )
    hold("routes require one to 64 signed anchors");
  for (let index = 0; index < value.packets.length; index++) {
    const packet = value.packets[index],
      anchor = signedPacket(packet);
    if (
      packet.publicKeySpki !== root.rootPublicKeySpki ||
      anchor.rootPublicKeyDigest !== root.rootPublicKeyDigest
    )
      hold("route signer differs from declared root");
    if (
      anchor.tenantId !== root.tenantId ||
      anchor.routingScope !== root.routingScope
    )
      hold("route tenant or scope differs from root");
    if (index === 0) {
      if (anchor.revision !== 1) hold("routes must retain the first anchor");
    } else {
      const checked = checkRrsiInstallationAnchorContinuation({
        previous: value.packets[index - 1],
        next: packet,
      });
      if (checked.continuation !== "declared-successor")
        hold("routes cannot append a duplicate anchor");
    }
  }
  return rrsiEnvelope(RRSI_INSTALLATION_ROUTES_SCHEMA, "routesDigest", {
    rootRecordDigest: root.rootRecordDigest,
    packets: value.packets,
  });
}

export function verifyRrsiInstallationRoutes(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, ["root", "routes"], "installation routes verification");
  const root = verifyRrsiInstallationRouteRoot(value.root);
  return verifyRrsiEnvelope(
    value.routes,
    RRSI_INSTALLATION_ROUTES_SCHEMA,
    "routesDigest",
    ["rootRecordDigest", "packets"],
    (core) => buildRrsiInstallationRoutes({ root, packets: core.packets }),
  );
}

export function buildRrsiInstallationRouteHighwater(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, ["root", "routes"], "route highwater input");
  const root = verifyRrsiInstallationRouteRoot(value.root);
  const routes = verifyRrsiInstallationRoutes({ root, routes: value.routes });
  const tail = routes.packets.at(-1).anchor;
  return rrsiEnvelope(
    RRSI_INSTALLATION_ROUTE_HIGHWATER_SCHEMA,
    "highwaterDigest",
    {
      installationId: root.installationId,
      tenantId: root.tenantId,
      rootRecordDigest: root.rootRecordDigest,
      routesDigest: routes.routesDigest,
      anchorRevision: tail.revision,
      anchorDigest: tail.anchorDigest,
      checkpoint: tail.checkpoint,
      restrictionHistory: tail.restrictionHistory,
    },
  );
}

export function verifyRrsiInstallationRouteSnapshot(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, ["root", "routes", "highwater"], "route snapshot input");
  const root = verifyRrsiInstallationRouteRoot(value.root);
  const routes = verifyRrsiInstallationRoutes({ root, routes: value.routes });
  const highwater = verifyRrsiEnvelope(
    value.highwater,
    RRSI_INSTALLATION_ROUTE_HIGHWATER_SCHEMA,
    "highwaterDigest",
    HIGHWATER_KEYS,
    () => buildRrsiInstallationRouteHighwater({ root, routes }),
  );
  return rrsiEnvelope(
    "chainlesschain.rrsi-installation-route-snapshot-check/v1",
    "snapshotCheckDigest",
    {
      installationId: root.installationId,
      tenantId: root.tenantId,
      rootRecordDigest: root.rootRecordDigest,
      routesDigest: routes.routesDigest,
      highwaterDigest: highwater.highwaterDigest,
      anchorDigest: highwater.anchorDigest,
      anchorRevision: highwater.anchorRevision,
      declaredRouteConsistent: true,
      signaturesVerifiedRelativeToDeclaredKey: true,
      ...FALSE_AUTHORITY,
    },
  );
}
