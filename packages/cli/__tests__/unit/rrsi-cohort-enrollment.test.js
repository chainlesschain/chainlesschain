import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign, createPrivateKey } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { openRrsiHistoryStore } from "../fixtures/rrsi-history-store.js";
import {
  rrsiNativeBatchFixture,
  rotateNativeBatchCandidate,
  signNativeChildSettlement,
} from "../fixtures/rrsi-native-batch.js";
import { rrsiFixtureDigest as digest } from "../fixtures/rrsi-shadow-fixture.js";
import { openLedgerV2Fixture } from "../fixtures/evolution-ledger-v2-store.js";
import { createRrsiHistoryLedgerAdapter } from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import {
  buildRrsiEvalCampaignPlan,
  rrsiEvalQueryStreamId,
  RRSI_COHORT_REGISTRATION_SCHEMA,
} from "../../src/lib/evolution/rrsi-cohort-registration.js";
import {
  createEvolutionEvalCohortEnrollmentAuthority,
  enrollRrsiEvalCampaign,
  resolveRrsiEvalCampaign,
  enrollEvolutionEvalCohort,
  resolveEvolutionEvalCohortEnrollment,
  createEvolutionEvalCohortSlotAdmissionAuthority,
  sealEvolutionEvalCohort,
  resolveEvolutionEvalCohortReconciliation,
} from "../../src/lib/evolution/evolution-eval-cohort-enrollment.js";
import {
  admitEvolutionEvalLaunch,
  resolveEvolutionEvalLaunch,
  captureEvolutionEvalLaunchAdmissionBinding,
} from "../../src/lib/evolution/evolution-eval-launch-admission.js";

const roots = [];
const input = rrsiNativeBatchFixture();
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture({
  journalV2 = false,
  signedRoot = true,
  statisticsPreregistered = false,
} = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(tmpdir()), "rrsi-enrollment-"),
  );
  roots.push(root);
  let value = openRrsiHistoryStore(root, { initialize: true });
  if (journalV2) {
    const store = openLedgerV2Fixture(path.join(root, "native-v2"), {
      tenantId: input.planContext.context.campaign.tenantId,
      artifactTenantId: "rrsi-artifacts",
      audience: "rrsi-runtime",
    });
    const adapter = createRrsiHistoryLedgerAdapter({
      backend: store.backend,
      artifactPorts: store.artifactPorts,
      ledgerArtifactResolver: store.resolver,
      descriptor: {
        tenantId: input.planContext.context.campaign.tenantId,
        artifactTenantId: "rrsi-artifacts",
        goalId: input.planContext.context.campaign.goalId,
        audience: "rrsi-runtime",
        purpose: "evolution-ledger",
      },
      settlementVerifier: value.settlementVerifier,
      now: store.clock,
    });
    value = { ...value, store, adapter };
  }
  value.adapter.registerCampaign(input.planContext.context.campaign);
  if (statisticsPreregistered) {
    value.adapter.registerNativeStatisticsScope({
      execution: input.planContext.executionContract,
    });
    value.adapter.registerNativeStatisticsPlan(input);
  }
  const keys = generateKeyPairSync("ed25519");
  const plan = buildRrsiEvalCampaignPlan(value.adapter.resolveCampaignRoot());
  const options = {
    descriptor: {
      tenantId: input.planContext.context.campaign.tenantId,
      artifactTenantId: "rrsi-artifacts",
      streamId: rrsiEvalQueryStreamId(plan, {
        queryOrdinal: 1,
        batch: { stage: "selection" },
      }),
      audience: "rrsi-runtime",
      purpose: "evolution-ledger",
      authorityId: "test-native-enrollment",
      keyId: "test-native-key",
      trustPolicyDigest: digest("TEST native cohort trust"),
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
  };
  const authority = createEvolutionEvalCohortEnrollmentAuthority(options);
  if (signedRoot) enrollRrsiEvalCampaign(authority);
  const batch = statisticsPreregistered
    ? value.adapter.reserveNativeBatchV2(input)
    : value.adapter.reserveNativeBatch(input);
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
  const first = resolution.batch.children[0];
  const fresh = batch.children.find((child) => child.childId === first.childId);
  const slot = (extra = {}) =>
    createEvolutionEvalCohortSlotAdmissionAuthority(authority, {
      cohortId: first.cohortId,
      slotId: first.slotId,
      ...extra,
    });
  const request = () => ({
    runId: "test-native-run",
    runNonce: "test-native-run-nonce",
    requestDigest: first.requestDigest,
    policyDigest: first.expectedContext.policyDigest,
    evaluationAuthorityRoot: first.expectedContext.evaluationAuthorityRoot,
    tenantId: input.planContext.context.campaign.tenantId,
    admittedAt: new Date(value.store.clock()).toISOString(),
    deadlineAt: new Date(value.store.clock() + 60000).toISOString(),
  });
  return {
    ...value,
    root,
    options,
    authority,
    batch,
    resolution,
    cohortIds,
    first,
    fresh,
    slot,
    request,
    enroll,
    enrollAll: () => cohortIds.map(enroll),
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      !resolved.startsWith(
        fs.realpathSync.native(tmpdir()) + path.sep + "rrsi-enrollment-",
      )
    )
      throw new Error("unsafe fixture cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("RRSI signed native query enrollment", () => {
  it("carries preregistration through every signed sibling, actual admission and seal on a v2 journal", async () => {
    const value = fixture({ journalV2: true, statisticsPreregistered: true });
    const enrolled = value.enrollAll();
    expect(enrolled).toHaveLength(12);
    const statistics = value.resolution.statisticsRegistration;
    // Enrollment is complete and these assertions do not mutate the journal.
    // Read its authenticated snapshot once instead of replaying it per sibling.
    const enrollmentEvents = value.store.backend.ledger.read({
      afterSequence: 0,
      limit: 1000,
    });
    for (const enrollment of enrolled) {
      expect(enrollment.evidence.plan.schema).toBe(
        "chainlesschain.rrsi-cohort-plan/v2",
      );
      expect(enrollment.evidence.manifest.schema).toBe(
        "chainlesschain.rrsi-cohort-manifest/v2",
      );
      expect(
        enrollment.evidence.manifest.statisticsRegistration
          .statisticsPlanDigest,
      ).toBe(statistics.statisticsPlanDigest);
      const event = enrollmentEvents.find(
        (item) => item.sequence === enrollment.enrollmentSequence,
      );
      expect(event.sourceRefs).toHaveLength(4);
      expect(event.sourceRefs.map((ref) => ref.ref)).toEqual(
        expect.arrayContaining([
          statistics.scopeRegistrationRecord.ref.ref,
          statistics.planRegistrationRecord.ref.ref,
        ]),
      );
    }
    const authority = value.slot({ freshChild: value.fresh });
    const admitted = await admitEvolutionEvalLaunch(authority, value.request());
    const first = enrolled.find(
      (entry) => entry.evidence.cohortId === value.first.cohortId,
    );
    expect(admitted.evidence.enrollmentDigest).toBe(first.enrollmentDigest);
    const request = value.request();
    expect(
      await resolveEvolutionEvalLaunch(authority, {
        runId: request.runId,
        runNonce: request.runNonce,
        requestDigest: request.requestDigest,
      }),
    ).toMatchObject({ admissionDigest: admitted.admissionDigest });
    await sealEvolutionEvalCohort(value.authority, {
      cohortId: value.first.cohortId,
    });
    const reconciled = await resolveEvolutionEvalCohortReconciliation(
      value.authority,
      { cohortId: value.first.cohortId },
    );
    expect(reconciled.inventory.admissions).toHaveLength(1);
    const substituted = clone(first.evidence);
    const registration = {
      plan: substituted.plan,
      manifest: substituted.manifest,
      slots: substituted.slots,
    };
    registration.plan.statisticsRegistration.statisticsPlanDigest = digest(
      "TEST unrelated statistics plan",
    );
    expect(() =>
      enrollEvolutionEvalCohort(value.authority, registration),
    ).toThrow(/differs from committed History/);
  }, 300000);
  it("enrolls a new candidate query after the previous stream admission without refreshing consumed quota", async () => {
    const value = fixture();
    value.enrollAll();
    await admitEvolutionEvalLaunch(
      value.slot({ freshChild: value.fresh }),
      value.request(),
    );
    await sealEvolutionEvalCohort(value.authority, {
      cohortId: value.first.cohortId,
    });
    const privateKey = createPrivateKey(
      fs.readFileSync(
        path.join(value.root, "test-control", "settlement-private.pem"),
      ),
    );
    for (const child of value.batch.children) {
      if (child.childId === value.first.childId) {
        value.adapter.settle(
          signNativeChildSettlement(value, child, privateKey),
        );
        continue;
      }
      const arms = Object.keys(child.bindings.armReservationDigests);
      value.adapter.settle(
        signNativeChildSettlement(value, child, privateKey, {
          statusByArm: Object.fromEntries(
            arms.map((arm) => [arm, "not-started"]),
          ),
          usageByArm: Object.fromEntries(
            arms.map((arm) => [
              arm,
              {
                tokens: 0,
                toolCalls: 0,
                wallClockMs: 0,
                costMicrounits: 0,
                executions: 0,
              },
            ]),
          ),
          executionUnitsByArm: Object.fromEntries(
            arms.map((arm) => [
              arm,
              {
                actorInvocations: 0,
                gradeInvocations: 0,
                safetyInvocations: 0,
                resetOperations: 0,
                providerRequests: 0,
              },
            ]),
          ),
        }),
      );
    }
    const next = value.adapter.reserveNativeBatch(
      rotateNativeBatchCandidate(input, { freshInvocations: true }),
    );
    const resolution = value.adapter.resolveNativeBatch({
      batchDigest: next.batchDigest,
    });
    expect(resolution.queryOrdinal).toBe(2);
    const root = resolveRrsiEvalCampaign(value.authority);
    const query = createEvolutionEvalCohortEnrollmentAuthority({
      ...value.options,
      descriptor: {
        ...value.options.descriptor,
        streamId: rrsiEvalQueryStreamId(root.evidence.plan, resolution),
      },
    });
    expect(resolveRrsiEvalCampaign(query).enrollmentDigest).toBe(
      root.enrollmentDigest,
    );
    const nextCohort = resolution.batch.children[0].cohortId;
    const enrolled = enrollEvolutionEvalCohort(query, {
      schema: RRSI_COHORT_REGISTRATION_SCHEMA,
      batchDigest: next.batchDigest,
      cohortId: nextCohort,
    });
    expect(enrolled.evidence.plan.queryOrdinal).toBe(2);
    expect(value.adapter.inspect().selectionQueries).toBe(2);
    expect(value.adapter.inspect().candidateCount).toBe(2);
  }, 180000);
  it("binds the shared campaign root, complete partition denominator and original native plan", () => {
    const value = fixture();
    expect(resolveRrsiEvalCampaign(value.authority)).toMatchObject({
      authenticated: true,
      productionAdmissionVerified: false,
      promotionAuthority: false,
    });
    const enrolled = value.enroll(value.first.cohortId);
    expect(enrolled.evidence.schema).toBe(
      "chainlesschain.evolution-eval-cohort-enrollment/v2",
    );
    expect(enrolled.evidence.manifest).toMatchObject({
      batchDigest: value.batch.batchDigest,
      plannedObservationsPerArmByPartition: {
        [value.first.candidateArm]: { select: 120 },
        [value.first.baselineArm]: { select: 120 },
      },
      nativeExecutionDenominatorVerified: false,
    });
    expect(enrolled.evidence.slots[0].evaluationPlanDigest).toBe(
      value.first.nativePlanDigest,
    );
    expect(enrolled.evidence.slots[0].evaluationPlanDigest).not.toBe(
      enrolled.evidence.plan.planDigest,
    );
    expect(enrolled.evidence.manifest.reservationRecord).toEqual(
      value.resolution.reservationRecord,
    );
    expect(() => enrollRrsiEvalCampaign(value.authority)).toThrow(
      /already enrolled/,
    );
  });
  it("refuses native enrollment without the signed shared campaign root", () => {
    const value = fixture({ signedRoot: false });
    expect(() => value.enroll(value.first.cohortId)).toThrow(
      /campaign root is absent/,
    );
    expect(value.adapter.inspect().selectionQueries).toBe(1);
  });
  it("cannot consume a fresh child before every sibling cohort is enrolled", async () => {
    const value = fixture();
    value.enroll(value.first.cohortId);
    await expect(
      admitEvolutionEvalLaunch(
        value.slot({ freshChild: value.fresh }),
        value.request(),
      ),
    ).rejects.toThrow(/enrollment is absent/);
    expect(
      value.adapter.inspect().executions.every((entry) => !entry.dispatched),
    ).toBe(true);
  });
  it("atomically dispatches before admission CAS, binds the live run, then audits without fresh capability", async () => {
    const value = fixture();
    value.enrollAll();
    const live = value.slot({ freshChild: value.fresh });
    const binding = captureEvolutionEvalLaunchAdmissionBinding(live);
    expect(binding).toMatchObject({
      registrationKind: "rrsi-native",
      historyBinding: {
        batchDigest: value.batch.batchDigest,
        childId: value.first.childId,
      },
    });
    expect(binding.descriptor.planDigest).toBe(value.first.nativePlanDigest);
    const request = value.request();
    const admission = await admitEvolutionEvalLaunch(live, request);
    expect(admission.evidence.schema).toBe(
      "chainlesschain.evolution-eval-launch-admission/v2",
    );
    expect(
      value.adapter.inspect().executions.filter((entry) => entry.dispatched),
    ).toHaveLength(2);
    await expect(
      admitEvolutionEvalLaunch(live, { ...request, runId: "another-run" }),
    ).rejects.toThrow(/permit has already been consumed/);
    expect(
      value.adapter
        .inspect()
        .executions.filter((entry) => entry.dispatched)
        .every((entry) => entry.status === "dispatch-intent"),
    ).toBe(true);
    const audit = value.slot();
    expect(
      await resolveEvolutionEvalLaunch(audit, {
        runId: request.runId,
        runNonce: request.runNonce,
        requestDigest: request.requestDigest,
      }),
    ).toEqual(admission);
    await expect(
      admitEvolutionEvalLaunch(audit, { ...request, runId: "recovered-run" }),
    ).rejects.toThrow(/fresh paired child/);
    const sealed = await sealEvolutionEvalCohort(value.authority, {
      cohortId: value.first.cohortId,
    });
    expect(sealed).toMatchObject({
      admissionInventoryAuthenticated: true,
      executionCoverageAuthenticated: false,
      nativeExecutionDenominatorVerified: false,
    });
    expect(sealed.inventory.admissions).toHaveLength(1);
    expect(
      await resolveEvolutionEvalCohortReconciliation(value.authority, {
        cohortId: value.first.cohortId,
      }),
    ).toEqual(sealed);
  }, 180000);
  it("keeps durable paired intent when signing fails and never grants a recovered live permit", async () => {
    const value = fixture();
    value.enrollAll();
    const failing = createEvolutionEvalCohortEnrollmentAuthority({
      ...value.options,
      signer: {
        sign() {
          throw new Error("TEST signer unavailable after dispatch");
        },
      },
    });
    const slot = createEvolutionEvalCohortSlotAdmissionAuthority(failing, {
      cohortId: value.first.cohortId,
      slotId: value.first.slotId,
      freshChild: value.fresh,
    });
    await expect(
      admitEvolutionEvalLaunch(slot, value.request()),
    ).rejects.toThrow(/signer unavailable/);
    expect(
      value.adapter
        .inspect()
        .executions.filter((entry) => entry.dispatched)
        .every((entry) => entry.status === "unknown"),
    ).toBe(true);
    await expect(
      admitEvolutionEvalLaunch(
        value.slot({ freshChild: value.fresh }),
        value.request(),
      ),
    ).rejects.toThrow(/fresh child capability/);
    await expect(
      resolveEvolutionEvalLaunch(value.slot(), {
        runId: "test-native-run",
        runNonce: "test-native-run-nonce",
        requestDigest: value.first.requestDigest,
      }),
    ).rejects.toThrow(/absent or ambiguous/);
    await sealEvolutionEvalCohort(value.authority, {
      cohortId: value.first.cohortId,
    });
    expect(
      value.adapter.inspect().chargedResourcesByArm.rrsi.maxCostMicrounits,
    ).toBe("8000");
  }, 180000);
  it("rejects copied capabilities and arbitrary sub streams without invoking supplied accessors", async () => {
    const value = fixture();
    value.enrollAll();
    await expect(
      admitEvolutionEvalLaunch(
        value.slot({ freshChild: clone(value.fresh) }),
        value.request(),
      ),
    ).rejects.toThrow(/fresh child capability/);
    const otherStream = createEvolutionEvalCohortEnrollmentAuthority({
      ...value.options,
      descriptor: {
        ...value.options.descriptor,
        streamId: "arbitrary-renamed-stream",
      },
    });
    expect(() =>
      enrollEvolutionEvalCohort(otherStream, {
        schema: RRSI_COHORT_REGISTRATION_SCHEMA,
        batchDigest: value.batch.batchDigest,
        cohortId: value.first.cohortId,
      }),
    ).toThrow(/global History query stream/);
    let reads = 0;
    const substituted = {};
    Object.defineProperty(substituted, "bindings", {
      get() {
        reads++;
        return value.fresh.bindings;
      },
    });
    await expect(
      admitEvolutionEvalLaunch(
        value.slot({ freshChild: substituted }),
        value.request(),
      ),
    ).rejects.toThrow(/fresh child capability/);
    expect(reads).toBe(0);
  }, 180000);
  it("rejects declaration substitution, storage substitution and late enrollment", async () => {
    const value = fixture();
    const enrolled = value.enroll(value.first.cohortId);
    const source = {
      plan: clone(enrolled.evidence.plan),
      manifest: clone(enrolled.evidence.manifest),
      slots: clone(enrolled.evidence.slots),
    };
    source.slots[0].evaluationPlanDigest = source.plan.planDigest;
    expect(() => enrollEvolutionEvalCohort(value.authority, source)).toThrow(
      /differs from committed History/,
    );
    expect(() =>
      createEvolutionEvalCohortEnrollmentAuthority({
        ...value.options,
        rrsiHistoryAdapter: {},
      }),
    ).toThrow(/branded RRSI history/);
    for (const id of value.cohortIds.filter(
      (id) => id !== value.first.cohortId,
    ))
      value.enroll(id);
    await admitEvolutionEvalLaunch(
      value.slot({ freshChild: value.fresh }),
      value.request(),
    );
    expect(() => value.enroll(value.cohortIds[1])).toThrow(/already enrolled/);
    expect(
      resolveEvolutionEvalCohortEnrollment(value.authority, {
        cohortId: value.first.cohortId,
      }).enrollmentDigest,
    ).toBe(enrolled.enrollmentDigest);
  }, 180000);
  it("uses the same migrated v2 journal for campaign, cohorts, dispatch, admission and seal", async () => {
    const value = fixture({ journalV2: true });
    value.enrollAll();
    const admission = await admitEvolutionEvalLaunch(
      value.slot({ freshChild: value.fresh }),
      value.request(),
    );
    expect(admission.authenticated).toBe(true);
    const sealed = await sealEvolutionEvalCohort(value.authority, {
      cohortId: value.first.cohortId,
    });
    expect(sealed.inventory.admissions[0].admissionDigest).toBe(
      admission.admissionDigest,
    );
    expect(value.store.backend.ledger.verify().sequence).toBeGreaterThan(
      value.resolution.reservationRecord.sequence,
    );
    expect(
      value.adapter.inspect().executions.filter((entry) => entry.dispatched),
    ).toHaveLength(2);
  }, 300000);
});
