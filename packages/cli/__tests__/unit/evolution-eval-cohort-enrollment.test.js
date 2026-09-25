import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  createEvolutionEvalCohortEnrollmentAuthority as createAuthority,
  enrollEvolutionEvalCohort as enroll,
  resolveEvolutionEvalCohortEnrollment as resolveEnrollment,
  createEvolutionEvalCohortSlotAdmissionAuthority as slotAuthority,
  sealEvolutionEvalCohort as seal,
  resolveEvolutionEvalCohortReconciliation as reconcile,
} from "../../src/lib/evolution/evolution-eval-cohort-enrollment.js";
import {
  admitEvolutionEvalLaunch as admit,
  resolveEvolutionEvalLaunch,
  createEvolutionEvalLaunchAdmissionAuthority,
  captureEvolutionEvalLaunchAdmissionBinding as binding,
} from "../../src/lib/evolution/evolution-eval-launch-admission.js";
import { buildPmExplorationEffectSlotManifest } from "../../src/lib/evolution/pm-exploration-benchmark.js";
import {
  cleanupEvalLaunchAdmissionFixtures,
  lookupEvalLaunchAdmission,
} from "./evolution-eval-launch-admission-fixture.js";
import {
  setupEvalCohortEnrollmentFixture as setup,
  cohortDigest as digest,
} from "./evolution-eval-cohort-enrollment-fixture.js";

afterEach(cleanupEvalLaunchAdmissionFixtures);
const lookup = { cohortId: "cohort:one" };
const slotLookup = { ...lookup, slotId: "slot:one" };

describe("signed cohort enrollment and Ledger admission inventory", () => {
  it("binds different PM/matrix plans, seals actual admissions and reopens retained evidence", async () => {
    const { resources, cohortOptions, registration, input } = setup();
    const authority = createAuthority(cohortOptions);
    const enrolled = enroll(authority, registration);
    const admission = slotAuthority(authority, slotLookup);
    expect(binding(admission)).toMatchObject({
      mode: "enrolled-cohort",
      descriptor: { planDigest: registration.slots[0].evaluationPlanDigest },
      expectedRequest: { requestDigest: input.requestDigest },
    });
    expect(binding(admission).descriptor.planDigest).not.toBe(
      registration.plan.planDigest,
    );
    const first = await admit(admission, input);
    expect(first.evidence.schema).toMatch(/\/v2$/);
    expect(first.evidence.enrollmentDigest).toBe(enrolled.enrollmentDigest);
    const report = await seal(authority, lookup);
    expect(report).toMatchObject({
      admissionInventoryAuthenticated: true,
      executionCoverageAuthenticated: false,
      cohortCompletenessAuthenticated: false,
      promotionAuthority: false,
      plannedTestObservationsPerArm:
        registration.manifest.plannedTestObservationsPerArm,
      inventory: {
        admissions: [
          {
            slotId: "slot:one",
            runId: input.runId,
            admissionDigest: first.admissionDigest,
          },
        ],
        unadmittedSlotIds: ["slot:two", "slot:three"],
      },
    });
    const reopened = createEvolutionLedgerFileBackend(resources.backendOptions);
    const recovered = createAuthority({
      ...cohortOptions,
      ledger: reopened.ledger,
    });
    expect(resolveEnrollment(recovered, lookup)).toEqual(enrolled);
    expect(await reconcile(recovered, lookup)).toEqual(report);
    await expect(
      admit(slotAuthority(recovered, slotLookup), input),
    ).rejects.toThrow(/sealed/);
    await expect(
      resolveEvolutionEvalLaunch(
        slotAuthority(recovered, slotLookup),
        lookupEvalLaunchAdmission(input),
      ),
    ).resolves.toEqual(first);
  });

  it("does not turn an empty inventory into execution or cohort completeness", async () => {
    const { cohortOptions, registration } = setup();
    const authority = createAuthority(cohortOptions);
    enroll(authority, registration);
    const result = await seal(authority, lookup);
    expect(result.inventory.admissions).toEqual([]);
    expect(result.inventory.unadmittedSlotIds).toEqual(
      registration.manifest.slotIds,
    );
    expect(result.cohortCompletenessAuthenticated).toBe(false);
    await expect(seal(authority, lookup)).rejects.toThrow(/sealed/);
  });

  it("rejects incomplete, reordered, duplicate, or tampered manifests and slot schedules", () => {
    const { cohortOptions, registration, backend } = setup();
    const authority = createAuthority(cohortOptions);
    const bad = [
      { ...registration, slots: registration.slots.slice(1) },
      { ...registration, slots: [...registration.slots].reverse() },
      {
        ...registration,
        slots: [
          registration.slots[0],
          registration.slots[0],
          registration.slots[2],
        ],
      },
      {
        ...registration,
        manifest: {
          ...registration.manifest,
          manifestDigest: digest("tampered"),
        },
      },
      {
        ...registration,
        manifest: {
          ...registration.manifest,
          plannedTestObservationsPerArm: 1,
        },
      },
      {
        ...registration,
        slots: registration.slots.map((slot) => ({
          ...slot,
          evaluationPlanDigest: "bad",
        })),
      },
    ];
    for (const source of bad) expect(() => enroll(authority, source)).toThrow();
    expect(backend.ledger.verify().sequence).toBe(0);
  });

  it("rejects absent enrollment, unknown slots, forged bindings, and post-result re-enrollment", async () => {
    const { cohortOptions, options, registration, input } = setup();
    const authority = createAuthority(cohortOptions);
    expect(() => slotAuthority(authority, slotLookup)).toThrow(/absent/);
    expect(() =>
      createEvolutionEvalLaunchAdmissionAuthority({
        ...options,
        cohortSlotBinding: {},
      }),
    ).toThrow(/branded/);
    expect(
      binding(createEvolutionEvalLaunchAdmissionAuthority(options)).mode,
    ).toBe("legacy-single-slot");
    enroll(authority, registration);
    expect(() =>
      slotAuthority(authority, { ...lookup, slotId: "unregistered" }),
    ).toThrow(/not in/);
    await admit(slotAuthority(authority, slotLookup), input);
    expect(() =>
      enroll(authority, {
        ...registration,
        manifest: buildPmExplorationEffectSlotManifest({
          plan: registration.plan,
          cohortId: "cohort:one",
          slotIds: ["slot:one"],
        }),
        slots: registration.slots.slice(0, 1),
      }),
    ).toThrow(/already/);
  });

  it.each(["requestDigest", "policyDigest", "evaluationAuthorityRoot"])(
    "rejects %s substitution before admission storage",
    async (field) => {
      const { cohortOptions, registration, input, backend } = setup();
      const authority = createAuthority(cohortOptions);
      enroll(authority, registration);
      await expect(
        admit(slotAuthority(authority, slotLookup), {
          ...input,
          [field]: digest("replacement"),
        }),
      ).rejects.toThrow(/enrolled slot/);
      expect(backend.ledger.verify().sequence).toBe(1);
    },
  );

  it("rejects forged signatures and anchor/key/scope substitution on durable readback", () => {
    const { cohortOptions, registration, backend } = setup();
    const forged = createAuthority({
      ...cohortOptions,
      signer: { sign: () => "A".repeat(86) },
    });
    expect(() => enroll(forged, registration)).toThrow(/signature/);
    expect(backend.ledger.verify().sequence).toBe(0);
    const authority = createAuthority(cohortOptions);
    enroll(authority, registration);
    expect(() =>
      resolveEnrollment(
        createAuthority({
          ...cohortOptions,
          publicKey: generateKeyPairSync("ed25519").publicKey,
        }),
        lookup,
      ),
    ).toThrow(/signature/);
    expect(() =>
      resolveEnrollment(
        createAuthority({
          ...cohortOptions,
          descriptor: { ...cohortOptions.descriptor, keyId: "rotated" },
        }),
        lookup,
      ),
    ).toThrow(/scope/);
    expect(() =>
      enroll(
        createAuthority({
          ...cohortOptions,
          descriptor: { ...cohortOptions.descriptor, keyId: "rotated" },
        }),
        registration,
      ),
    ).toThrow(/already/);
  });

  it("captures registration before reentrant signer mutation and rejects duplicate issuance with CAS", () => {
    const { resources, cohortOptions, registration } = setup();
    const competing = createAuthority({
      ...cohortOptions,
      ledger: createEvolutionLedgerFileBackend(resources.backendOptions).ledger,
    });
    let winner;
    const authority = createAuthority({
      ...cohortOptions,
      signer: {
        sign(request) {
          winner = enroll(competing, registration);
          registration.slots[0].requestDigest = digest("mutated");
          return cohortOptions.signer.sign(request);
        },
      },
    });
    expect(() => enroll(authority, registration)).toThrow();
    expect(resolveEnrollment(competing, lookup)).toEqual(winner);
    expect(winner.evidence.slots[0].requestDigest).not.toBe(
      registration.slots[0].requestDigest,
    );
  });

  it("sealing loses CAS when an admission commits during the seal signature", async () => {
    const { cohortOptions, registration, input, backend } = setup();
    let competing;
    let slot;
    const authority = createAuthority({
      ...cohortOptions,
      signer: {
        sign(request) {
          if (
            request.message.startsWith(
              "chainlesschain.evolution-eval-cohort-seal/v1",
            )
          )
            competing = admit(slot, input);
          return cohortOptions.signer.sign(request);
        },
      },
    });
    enroll(authority, registration);
    slot = slotAuthority(authority, slotLookup);
    await expect(seal(authority, lookup)).rejects.toThrow();
    await expect(competing).resolves.toMatchObject({ authenticated: true });
    expect(backend.ledger.verify().sequence).toBe(2);
    const retry = createAuthority(cohortOptions);
    expect((await seal(retry, lookup)).inventory.admissions).toHaveLength(1);
  });

  it("a captured pre-seal slot authority cannot admit after the durable seal", async () => {
    const { cohortOptions, registration, input, backend } = setup();
    const authority = createAuthority(cohortOptions);
    enroll(authority, registration);
    const capturedSlot = slotAuthority(authority, slotLookup);
    const sealing = seal(authority, lookup);
    await sealing;
    await expect(admit(capturedSlot, input)).rejects.toThrow(/sealed/);
    expect(backend.ledger.verify().sequence).toBe(2);
  });

  it("requires a seal and rejects caller-provided subsets or legacy/unregistered Ledger launches", async () => {
    const { cohortOptions, options, registration, input } = setup();
    const authority = createAuthority(cohortOptions);
    enroll(authority, registration);
    await expect(reconcile(authority, lookup)).rejects.toThrow(/seal/);
    await expect(
      reconcile(authority, { ...lookup, admissions: [] }),
    ).rejects.toThrow(/exactly/);
    await admit(
      createEvolutionEvalLaunchAdmissionAuthority({
        ...options,
        descriptor: { ...options.descriptor, slotId: "hidden-outside-slot" },
      }),
      input,
    );
    await expect(seal(authority, lookup)).rejects.toThrow(/legacy/);
  });

  it("detects legacy bypasses added after a valid seal instead of reporting a stale complete inventory", async () => {
    const { cohortOptions, options, registration, input } = setup();
    const authority = createAuthority(cohortOptions);
    enroll(authority, registration);
    await seal(authority, lookup);
    await admit(
      createEvolutionEvalLaunchAdmissionAuthority({
        ...options,
        descriptor: { ...options.descriptor, slotId: "bypass" },
      }),
      input,
    );
    await expect(reconcile(authority, lookup)).rejects.toThrow(/legacy/);
  });

  it("rejects enrollment after any stream admission and keeps mixed-cohort events visible", async () => {
    const { cohortOptions, options, registration, input } = setup();
    await admit(createEvolutionEvalLaunchAdmissionAuthority(options), input);
    expect(() => enroll(createAuthority(cohortOptions), registration)).toThrow(
      /before enrollment/,
    );
  });

  it("recovers a committed enrollment after its append acknowledgement is lost", () => {
    const { resources, cohortOptions, registration } = setup();
    const failing = createEvolutionLedgerFileBackend({
      ...resources.backendOptions,
      crashHook(phase) {
        if (phase === "after-head")
          throw new Error("lost enrollment acknowledgement");
      },
    });
    expect(() =>
      enroll(
        createAuthority({ ...cohortOptions, ledger: failing.ledger }),
        registration,
      ),
    ).toThrow();
    const reopened = createEvolutionLedgerFileBackend(resources.backendOptions);
    const authority = createAuthority({
      ...cohortOptions,
      ledger: reopened.ledger,
    });
    expect(resolveEnrollment(authority, lookup)).toMatchObject({
      authenticated: true,
      durable: true,
    });
    expect(() => enroll(authority, registration)).toThrow(/already/);
  });

  it("authenticates other preregistered cohorts instead of treating their events as an unchecked exclusion", async () => {
    const { cohortOptions, registration, input, backend } = setup();
    const authority = createAuthority(cohortOptions);
    enroll(authority, registration);
    const secondManifest = buildPmExplorationEffectSlotManifest({
      plan: registration.plan,
      cohortId: "cohort:two",
      slotIds: registration.manifest.slotIds,
    });
    enroll(authority, { ...registration, manifest: secondManifest });
    await admit(
      slotAuthority(authority, { cohortId: "cohort:two", slotId: "slot:one" }),
      { ...input, runId: "eval:second", runNonce: "nonce:second" },
    );
    expect((await seal(authority, lookup)).inventory.admissions).toHaveLength(
      0,
    );
    // A duplicate foreign-cohort event with altered identity cannot hide behind the cohort filter.
    const original = backend.ledger
      .read()
      .find((event) => event.type === "evolution.eval-attempt.admitted");
    const duplicated = Object.fromEntries(
      [
        "type",
        "tenantId",
        "artifactTenantId",
        "correlationId",
        "decision",
        "skillName",
        "reason",
        "sourceRefs",
        "subjectRef",
        "timestamp",
      ].map((key) => [key, original[key]]),
    );
    backend.ledger.appendDomainEvent({
      ...duplicated,
      eventId: "injected-duplicate-foreign-admission",
    });
    await expect(reconcile(authority, lookup)).rejects.toThrow(/substitution/);
  });

  it("recovers a committed seal after acknowledgement loss and keeps every unused slot closed", async () => {
    const { resources, cohortOptions, registration, input } = setup();
    const original = createAuthority(cohortOptions);
    enroll(original, registration);
    await admit(slotAuthority(original, slotLookup), input);
    const failing = createEvolutionLedgerFileBackend({
      ...resources.backendOptions,
      crashHook(phase) {
        if (phase === "after-head")
          throw new Error("lost seal acknowledgement");
      },
    });
    await expect(
      seal(
        createAuthority({ ...cohortOptions, ledger: failing.ledger }),
        lookup,
      ),
    ).rejects.toThrow();
    const reopened = createEvolutionLedgerFileBackend(resources.backendOptions);
    const recovered = createAuthority({
      ...cohortOptions,
      ledger: reopened.ledger,
    });
    expect(
      (await reconcile(recovered, lookup)).inventory.admissions,
    ).toHaveLength(1);
    await expect(
      admit(slotAuthority(recovered, { ...lookup, slotId: "slot:two" }), {
        ...input,
        requestDigest: registration.slots[1].requestDigest,
      }),
    ).rejects.toThrow(/sealed/);
    expect(reopened.ledger.verify().sequence).toBe(3);
  });

  it("recovers committed strict admission with an unknown execution outcome without reopening its slot", async () => {
    const { resources, cohortOptions, registration, input } = setup();
    enroll(createAuthority(cohortOptions), registration);
    const failing = createEvolutionLedgerFileBackend({
      ...resources.backendOptions,
      crashHook(phase) {
        if (phase === "after-head")
          throw new Error("lost admission acknowledgement");
      },
    });
    const failedAuthority = createAuthority({
      ...cohortOptions,
      ledger: failing.ledger,
    });
    await expect(
      admit(slotAuthority(failedAuthority, slotLookup), input),
    ).rejects.toThrow();
    const recovered = createAuthority({
      ...cohortOptions,
      ledger: createEvolutionLedgerFileBackend(resources.backendOptions).ledger,
    });
    await expect(
      admit(slotAuthority(recovered, slotLookup), input),
    ).rejects.toThrow(/occupied/);
    const report = await seal(recovered, lookup);
    expect(report.inventory.admissions).toHaveLength(1);
    expect(report.executionCoverageAuthenticated).toBe(false);
    expect(report.plannedTestObservationsPerArm).toBe(
      registration.manifest.plannedTestObservationsPerArm,
    );
  });

  it("rejects changed retained artifact bytes even after a successful seal", async () => {
    const { resources, cohortOptions, registration } = setup();
    const authority = createAuthority(cohortOptions);
    enroll(authority, registration);
    await seal(authority, lookup);
    const directory = path.join(resources.root, "artifacts", "files");
    const file = fs
      .readdirSync(directory)
      .find((name) => name.endsWith(".json"));
    const target = path.join(directory, file);
    fs.chmodSync(target, 0o600);
    fs.writeFileSync(target, '{"substituted":true}');
    await expect(reconcile(authority, lookup)).rejects.toThrow();
  });
});
