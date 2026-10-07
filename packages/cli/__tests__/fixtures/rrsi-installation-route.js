// TEST ONLY: self-selected keys and plain local files, no installation authority.
import fs from "node:fs";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { rrsiCanonical, rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import {
  buildRrsiTenantIndexAnchor,
  serializeRrsiTenantIndexAnchorSignatureMessage,
} from "../../src/lib/evolution/rrsi-tenant-index-anchor-contracts.js";
import {
  buildRrsiInstallationRouteRoot,
  buildRrsiInstallationRoutes,
  buildRrsiInstallationRouteHighwater,
} from "../../src/lib/evolution/rrsi-installation-route-contracts.js";

export const routeDigest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const routeNames = ["root.json", "routes.json", "highwater.json"];
export function signRouteAnchor(input, keys) {
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
export function makeRouteFixture({
  tenantId = "tenant-a",
  installationId = "installation-a",
  graph = "graph-a",
  keys = generateKeyPairSync("ed25519"),
} = {}) {
  const publicBytes = keys.publicKey.export({ format: "der", type: "spki" });
  const root = buildRrsiInstallationRouteRoot({
    installationId,
    tenantId,
    routingScope: "installation",
    rootPublicKeySpki: publicBytes.toString("base64url"),
    rootPublicKeyDigest: routeDigest(publicBytes),
  });
  const ledgerIdentity = {
    ledgerId: "ledger-test",
    identityDigest: routeDigest("journal"),
    epoch: "epoch-test",
  };
  const firstInput = {
    deploymentId: "deployment-a",
    tenantId,
    routingScope: "installation",
    indexId: `rrsi-text.${rrsiHash("chainlesschain.rrsi-observed-text-index/v1", tenantId).slice(7)}`,
    ledgerIdentity,
    artifactScope: {
      artifactTenantId: "artifacts-a",
      audience: "route-test",
      purpose: "evolution-ledger",
    },
    storageGraphDigest: routeDigest(graph),
    rootPublicKeyDigest: root.rootPublicKeyDigest,
    revision: 1,
    previousAnchorDigest: null,
    checkpoint: {
      ...ledgerIdentity,
      sequence: 10,
      headDigest: routeDigest("head"),
    },
    restrictionHistory: {
      recordCount: 2,
      tailRecordDigest: routeDigest("tail"),
      restrictionsDigest: routeDigest("restrictions"),
    },
  };
  const first = signRouteAnchor(firstInput, keys);
  const secondInput = {
    ...firstInput,
    revision: 2,
    previousAnchorDigest: first.anchor.anchorDigest,
  };
  const second = signRouteAnchor(secondInput, keys);
  const routes = buildRrsiInstallationRoutes({
    root,
    packets: [first, second],
  });
  const highwater = buildRrsiInstallationRouteHighwater({ root, routes });
  return { root, routes, highwater, firstInput, secondInput, keys };
}
export function writeRouteFixture(directory, value) {
  for (const [name, record] of [
    ["root.json", value.root],
    ["routes.json", value.routes],
    ["highwater.json", value.highwater],
  ])
    fs.writeFileSync(path.join(directory, name), `${rrsiCanonical(record)}\n`);
}
export function routeSelection(directory, value) {
  return {
    directory,
    installationId: value.root.installationId,
    tenantId: value.root.tenantId,
    rootRecordDigest: value.root.rootRecordDigest,
  };
}
