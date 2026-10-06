/** Real retained enrollment/admission files with test-only signing keys. */
import { generateKeyPairSync, sign } from "node:crypto";
import { openRrsiHistoryStore } from "./rrsi-history-store.js";
import { rrsiFixtureDigest as digest } from "./rrsi-shadow-fixture.js";
import {
  buildRrsiEvalCampaignPlan,
  rrsiEvalQueryStreamId,
  RRSI_COHORT_REGISTRATION_SCHEMA,
} from "../../src/lib/evolution/rrsi-cohort-registration.js";
import {
  createEvolutionEvalCohortEnrollmentAuthority,
  enrollRrsiEvalCampaign,
  enrollEvolutionEvalCohort,
} from "../../src/lib/evolution/evolution-eval-cohort-enrollment.js";

export function openRrsiNativeCohortStore(root, input) {
  const campaign = input.planContext.context.campaign;
  const value = openRrsiHistoryStore(root, {
    initialize: true,
    campaignOverrides: { tenantId: campaign.tenantId, goalId: campaign.goalId },
  });
  value.adapter.registerCampaign(campaign);
  const keys = generateKeyPairSync("ed25519");
  const rootPlan = buildRrsiEvalCampaignPlan(
    value.adapter.resolveCampaignRoot(),
  );
  const authority = createEvolutionEvalCohortEnrollmentAuthority({
    descriptor: {
      tenantId: campaign.tenantId,
      artifactTenantId: "rrsi-artifacts",
      streamId: rrsiEvalQueryStreamId(rootPlan, {
        queryOrdinal: 1,
        batch: { stage: input.planContext.stage },
      }),
      audience: "rrsi-runtime",
      purpose: "evolution-ledger",
      authorityId: "test-native-row-enrollment",
      keyId: "test-native-row-key",
      trustPolicyDigest: digest("TEST native row enrollment trust"),
    },
    publicKey: keys.publicKey,
    signer: {
      sign: ({ message }) =>
        sign(null, Buffer.from(message), keys.privateKey).toString("base64url"),
    },
    artifactPorts: value.store.artifactPorts,
    ledger: value.store.backend.ledger,
    ledgerArtifactResolver: value.store.resolver,
    now: value.store.clock,
    rrsiHistoryAdapter: value.adapter,
  });
  enrollRrsiEvalCampaign(authority);
  const batch = value.adapter.reserveNativeBatch(input);
  const resolution = value.adapter.resolveNativeBatch({
    batchDigest: batch.batchDigest,
  });
  const cohortIds = [
    ...new Set(resolution.batch.children.map((child) => child.cohortId)),
  ];
  const enroll = (cohortId) =>
    enrollEvolutionEvalCohort(authority, {
      schema: RRSI_COHORT_REGISTRATION_SCHEMA,
      batchDigest: batch.batchDigest,
      cohortId,
    });
  return {
    ...value,
    authority,
    batch,
    resolution,
    cohortIds,
    enrollAll: () => cohortIds.map(enroll),
    enroll,
  };
}
