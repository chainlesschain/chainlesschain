/** Real local history prefixes. Installation/root/routing authority remains HOLD. */
import { isProxy } from "node:util/types";
import { captureRrsiObservedTextIndex } from "./rrsi-observed-text-index.js";
import { verifyRrsiTenantIndexAnchorSignature } from "./rrsi-tenant-index-anchor-contracts.js";
import { rrsiCanonical, rrsiEnvelope, snapshotRrsiData } from "./rrsi-data.js";

export const RRSI_TENANT_INDEX_ANCHOR_HISTORY_HOLD_CODE =
  "CC_RRSI_ANCHOR_HISTORY_HOLD";
const same = (a, b) => rrsiCanonical(a) === rrsiCanonical(b);
const FIXED_KEYS = [
  "deploymentId",
  "tenantId",
  "routingScope",
  "indexId",
  "ledgerIdentity",
  "artifactScope",
  "storageGraphDigest",
  "rootPublicKeyDigest",
];
function hold(message, cause) {
  throw Object.assign(new Error(message, cause ? { cause } : undefined), {
    code: RRSI_TENANT_INDEX_ANCHOR_HISTORY_HOLD_CODE,
  });
}
function guard(operation) {
  try {
    return operation();
  } catch (cause) {
    if (cause?.code === RRSI_TENANT_INDEX_ANCHOR_HISTORY_HOLD_CODE) throw cause;
    hold(
      "anchor history could not authenticate the original local prefix",
      cause,
    );
  }
}
function own(value, names) {
  if (
    !value ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== names.length
  )
    hold("anchor history requires exact plain own fields");
  return Object.fromEntries(
    names.map((name) => {
      const field = Object.getOwnPropertyDescriptor(value, name);
      if (!field?.enumerable || !("value" in field))
        hold("anchor history cannot use accessors");
      return [name, field.value];
    }),
  );
}

export function inspectRrsiTenantIndexHistory(input) {
  return guard(() => {
    const request = own(input, ["observedTextIndex"]);
    const captured = captureRrsiObservedTextIndex(request.observedTextIndex);
    const history = captured.captureHistoryCheckpoints({ checkpoints: [] });
    history.recheck();
    return history.snapshot;
  });
}

export function verifyRrsiTenantIndexAnchorHistory(input) {
  return guard(() => {
    const request = own(input, ["observedTextIndex", "previous", "current"]);
    const index = captureRrsiObservedTextIndex(request.observedTextIndex);
    const data = snapshotRrsiData({
      previous: request.previous,
      current: request.current,
    });
    verifyRrsiTenantIndexAnchorSignature(data.previous);
    verifyRrsiTenantIndexAnchorSignature(data.current);
    const previous = data.previous.anchor,
      current = data.current.anchor;
    if (
      previous.routingScope !== "installation" ||
      current.routingScope !== "installation"
    )
      hold("local history verification requires installation scope");
    if (data.previous.publicKeySpki !== data.current.publicKeySpki)
      hold("local anchor history cannot change root key");
    for (const key of FIXED_KEYS)
      if (!same(previous[key], current[key]))
        hold(`local anchor history cannot change ${key}`);
    if (current.revision === previous.revision) {
      if (current.anchorDigest !== previous.anchorDigest)
        hold("same revision has a different history anchor");
    } else if (
      current.revision !== previous.revision + 1 ||
      current.previousAnchorDigest !== previous.anchorDigest
    )
      hold("local history anchor must be the exact declared successor");
    for (const anchor of [previous, current]) {
      if (
        anchor.tenantId !== index.descriptor.tenantId ||
        anchor.indexId !== index.descriptor.indexId ||
        !same(anchor.ledgerIdentity, index.descriptor.ledgerIdentity) ||
        !same(anchor.artifactScope, {
          artifactTenantId: index.descriptor.artifactTenantId,
          audience: index.descriptor.audience,
          purpose: index.descriptor.purpose,
        })
      )
        hold("history anchor differs from the original observed index scope");
    }
    if (previous.checkpoint.sequence > current.checkpoint.sequence)
      hold("local history anchor cannot move its checkpoint backward");
    const history = index.captureHistoryCheckpoints({
      checkpoints: [previous.checkpoint, current.checkpoint],
    });
    const snapshot = history.snapshot;
    if (!same(current.checkpoint, snapshot.current.checkpoint))
      hold("current anchor is not the actual captured journal head");
    for (const [anchor, prefix] of [
      [previous, snapshot.prefixes[0]],
      [current, snapshot.prefixes[1]],
    ])
      if (!same(anchor.restrictionHistory, prefix.restrictionHistory))
        hold(
          "anchor restriction declaration differs from retained prefix history",
        );
    history.recheck();
    return rrsiEnvelope(
      "chainlesschain.rrsi-tenant-index-anchor-history-check/v1",
      "historyCheckDigest",
      {
        previousAnchorDigest: previous.anchorDigest,
        currentAnchorDigest: current.anchorDigest,
        indexDescriptorDigest: snapshot.indexDescriptorDigest,
        localCompositionDigest: snapshot.localCompositionDigest,
        artifactStoreDirectoryBoundaryDigest:
          snapshot.artifactStoreDirectoryBoundaryDigest,
        artifactStoreDirectoryBoundaryRechecked: true,
        artifactStoreBoundaryScope: "root-and-files-directories",
        previous: snapshot.prefixes[0],
        current: snapshot.current,
        signaturesVerifiedRelativeToExplicitKey: true,
        localJournalPrefixVerified: true,
        localRestrictionPrefixVerified: true,
        localRetainedHistoryReplayed: true,
        selectedContextOnly: true,
        storageGraphDigestVerified: false,
        rootAuthorityVerified: false,
        installationBindingSignatureVerified: false,
        routingPinVerified: false,
        crossProcessRollbackProtectionVerified: false,
        historyTransferVerified: false,
        originCutoverAuthenticated: false,
        tenantWideIndexAuthorityVerified: false,
        generationProvenanceVerified: false,
        grantsMutationOrPromotionAuthority: false,
        decision: "HOLD",
      },
    );
  });
}
