/** Read-only effective Skill parent binding; never replaces mutation CAS or admission. */
import { isProxy } from "node:util/types";
import { captureSkillReleaseRegistryReader } from "./skill-release-registry.js";
import { verifyRrsiCampaign } from "./rrsi-contracts.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiDigest,
  rrsiInteger,
  rrsiCanonical,
  rrsiEnvelope,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_PARENT_BINDING_SCHEMA =
  "chainlesschain.rrsi-effective-parent-binding/v1";
export const RRSI_PARENT_READBACK_SCHEMA =
  "chainlesschain.rrsi-effective-parent-readback/v1";
const BINDINGS = new WeakMap();

function options(input) {
  const keys = [
    "campaign",
    "releaseRegistry",
    "transactionLedger",
    "expectedParent",
  ];
  if (
    !input ||
    typeof input !== "object" ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== keys.length
  )
    rrsiFail("effective parent composition requires plain own fields");
  return Object.fromEntries(
    keys.map((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("effective parent composition cannot use accessors");
      return [key, field.value];
    }),
  );
}

function readParent(reader, campaign, expected) {
  const current = reader.readActive(campaign.goalId);
  if (
    !current ||
    current.state.tenantId !== campaign.tenantId ||
    current.release.tenantId !== campaign.tenantId ||
    current.state.skillName !== campaign.goalId ||
    current.release.skillName !== campaign.goalId ||
    current.state.activeReleaseDigest !== campaign.parentReleaseDigest ||
    current.release.releaseDigest !== campaign.parentReleaseDigest ||
    current.state.revision !== expected.revision ||
    current.state.stateDigest !== expected.stateDigest ||
    current.release.contentDigest !== expected.contentDigest
  )
    rrsiFail(
      "effective parent differs from frozen active release, content or revision",
      "CC_RRSI_PARENT_DRIFT",
    );
  // Preserve the campaign's initial anchor even when the registry LKG moves.
  // A readable release does not prove activation, stability or suitability.
  const parent = reader.readRelease(campaign.parentReleaseDigest);
  const anchor = reader.readRelease(campaign.anchorReleaseDigest);
  if (
    rrsiCanonical(parent) !== rrsiCanonical(current.release) ||
    anchor.tenantId !== campaign.tenantId ||
    anchor.skillName !== campaign.goalId
  )
    rrsiFail(
      "parent or campaign anchor readback differs",
      "CC_RRSI_PARENT_DRIFT",
    );
  // Detect a committed transition during multi-artifact readback. Dispatch and
  // promotion still need the registry's own atomic authorization/CAS boundary.
  const after = reader.readActive(campaign.goalId);
  if (!after || rrsiCanonical(after) !== rrsiCanonical(current))
    rrsiFail(
      "effective parent changed during readback",
      "CC_RRSI_PARENT_DRIFT",
    );
  return {
    parentContentDigest: parent.contentDigest,
    parentCandidateId: parent.candidateId,
    activeRevision: current.state.revision,
    activeStateDigest: current.state.stateDigest,
    stateTransactionId: current.state.transactionId,
    stateAuthorityReceiptDigest: current.state.authorityReceiptDigest,
    stateFence: current.state.fence,
    lastKnownGoodReleaseDigest: current.state.lastKnownGoodReleaseDigest,
    dependencyLockDigest: parent.dependencyLockDigest,
    runtimeManifestDigest: parent.runtimeManifestDigest,
    targetMatrixRoot: parent.targetMatrixRoot,
    targetRuntimes: parent.targetRuntimes,
    anchorContentDigest: anchor.contentDigest,
    anchorIdentity: {
      candidateId: anchor.candidateId,
      dependencyLockDigest: anchor.dependencyLockDigest,
      runtimeManifestDigest: anchor.runtimeManifestDigest,
      targetMatrixRoot: anchor.targetMatrixRoot,
      targetRuntimes: anchor.targetRuntimes,
    },
  };
}

export function createRrsiEffectiveParentBinding(input) {
  const value = options(input);
  const campaign = verifyRrsiCampaign(snapshotRrsiData(value.campaign));
  if (campaign.candidateKind !== "skill")
    rrsiFail(
      "Skill release parent adapter cannot authenticate a Memory-policy parent",
    );
  const reader = captureSkillReleaseRegistryReader(value.releaseRegistry);
  if (reader.tenantId !== campaign.tenantId)
    rrsiFail("effective parent registry belongs to another tenant");
  if (
    !value.transactionLedger ||
    !reader.matchesTransactionLedger(value.transactionLedger)
  )
    rrsiFail("effective parent registry uses another transaction Ledger");
  const expected = snapshotRrsiData(value.expectedParent);
  rrsiExact(
    expected,
    ["revision", "stateDigest", "contentDigest"],
    "frozen effective parent",
  );
  rrsiInteger(expected.revision, "effective parent revision", 1);
  rrsiDigest(expected.stateDigest, "effective parent state digest");
  rrsiDigest(expected.contentDigest, "effective parent content digest");
  const identity = readParent(reader, campaign, expected);
  const descriptor = rrsiEnvelope(
    RRSI_PARENT_BINDING_SCHEMA,
    "parentBindingDigest",
    {
      campaignDigest: campaign.campaignDigest,
      tenantId: campaign.tenantId,
      skillName: campaign.goalId,
      candidateKind: campaign.candidateKind,
      parentReleaseDigest: campaign.parentReleaseDigest,
      anchorReleaseDigest: campaign.anchorReleaseDigest,
      ...identity,
      registryReadbackVerified: true,
      transactionLedgerBound: true,
      transactionLedgerAuthorityVerified: false,
      productionAuthorityVerified: false,
      anchorPolicy: "frozen-campaign-anchor-artifact-reference",
      anchorArtifactIntegrityVerified: true,
      anchorHistoricalActivationVerified: false,
      anchorStabilityVerified: false,
      anchorRevocationStatusVerified: false,
      anchorDeploymentCompatibilityVerified: false,
      deploymentAdmissionVerified: false,
      historicalStabilityIndependentlyVerified: false,
      sourceProvenanceVerified: false,
      modelPricingAdmissionVerified: false,
      grantsMutationOrDispatchAuthority: false,
    },
  );
  const binding = Object.freeze({ descriptor });
  BINDINGS.set(binding, { reader, campaign, expected, identity });
  return binding;
}

/** A recovered JSON descriptor is not a live read capability. */
export function recheckRrsiEffectiveParent(binding) {
  const state = BINDINGS.get(binding);
  if (!state) rrsiFail("a branded live effective-parent binding is required");
  const identity = readParent(state.reader, state.campaign, state.expected);
  if (rrsiCanonical(identity) !== rrsiCanonical(state.identity))
    rrsiFail(
      "effective parent immutable identity changed",
      "CC_RRSI_PARENT_DRIFT",
    );
  return rrsiEnvelope(RRSI_PARENT_READBACK_SCHEMA, "parentReadbackDigest", {
    parentBindingDigest: binding.descriptor.parentBindingDigest,
    registryReadbackVerified: true,
    effectiveParentUnchanged: true,
    atomicDispatchOrPromotionAuthorized: false,
  });
}
