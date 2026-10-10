import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEvolutionEvalReadonlyAudit,
  captureEvolutionEvalReadonlyAudit,
} from "../../src/lib/evolution/evolution-eval-readonly-audit.js";
import {
  createEvolutionEvalLaunchAdmissionAuthority,
  admitEvolutionEvalLaunch,
  resolveEvolutionEvalLaunch,
  resolveEvolutionEvalLaunchFromReadonlyAudit,
} from "../../src/lib/evolution/evolution-eval-launch-admission.js";
import {
  createEvolutionEvalCohortEnrollmentAuthority,
  enrollEvolutionEvalCohort,
  createEvolutionEvalCohortSlotAdmissionAuthority,
} from "../../src/lib/evolution/evolution-eval-cohort-enrollment.js";
import { isEvolutionLedgerV2Journal } from "../../src/lib/evolution/evolution-ledger-v2-journal.js";
import {
  openLedgerV2Fixture,
  v2FixtureDomainEvent,
} from "../fixtures/evolution-ledger-v2-store.js";
import {
  setupEvalLaunchAdmissionFixture,
  lookupEvalLaunchAdmission,
  cleanupEvalLaunchAdmissionFixtures,
} from "./evolution-eval-launch-admission-fixture.js";
import { setupEvalCohortEnrollmentFixture } from "./evolution-eval-cohort-enrollment-fixture.js";

const roots = [];
const tempDirectory = fs.realpathSync.native(os.tmpdir());
const LARGE_COLLECTION_FUNCTIONAL_TIMEOUT_MS = 180_000;
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function v2Store(options = {}) {
  const root = fs.mkdtempSync(path.join(tempDirectory, "cc-eval-audit-test-"));
  roots.push(root);
  return { ...openLedgerV2Fixture(root, options), root };
}

afterEach(() => {
  cleanupEvalLaunchAdmissionFixtures();
  for (const directory of roots.splice(0)) {
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== tempDirectory ||
      !path.basename(target).startsWith("cc-eval-audit-test-")
    )
      throw new Error(
        "refusing to remove a directory outside this test's roots",
      );
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("genuine Eval read-only journal snapshots", () => {
  it("captures the actual v2 journal and rejects copied, Proxy and foreign-journal tokens", () => {
    const store = v2Store();
    expect(isEvolutionLedgerV2Journal(store.journal)).toBe(true);
    store.journal.appendDomainEvent(v2FixtureDomainEvent(store, "audit-first"));
    const audit = createEvolutionEvalReadonlyAudit(store.journal);
    const captured = captureEvolutionEvalReadonlyAudit(audit, store.journal);
    expect(captured.events).toEqual(store.journal.read());
    expect(captured.events).toHaveLength(captured.identity.sequence);
    const current = store.journal.verify();
    expect(captured.identity).toEqual(
      Object.fromEntries(
        Object.keys(captured.identity).map((field) => [field, current[field]]),
      ),
    );
    expect(captured.eventsById("audit-first")).toHaveLength(1);
    expect(captured.assertUnchanged()).toEqual(captured.identity);
    expect(() =>
      captureEvolutionEvalReadonlyAudit({ ...audit }, store.journal),
    ).toThrow(/genuine read-only audit/);
    expect(() =>
      captureEvolutionEvalReadonlyAudit(
        JSON.parse(JSON.stringify(audit)),
        store.journal,
      ),
    ).toThrow(/genuine read-only audit/);
    const traps = vi.fn();
    expect(() =>
      captureEvolutionEvalReadonlyAudit(
        new Proxy(audit, { get: traps, getPrototypeOf: traps }),
        store.journal,
      ),
    ).toThrow(/genuine read-only audit/);
    expect(traps).not.toHaveBeenCalled();

    // Even another genuine handle of the same durable store is not this journal.
    const reopened = openLedgerV2Fixture(store.root);
    expect(reopened.journal.verify().ledgerId).toBe(captured.identity.ledgerId);
    expect(() =>
      captureEvolutionEvalReadonlyAudit(audit, reopened.journal),
    ).toThrow(/same Ledger journal/);
    expect(() =>
      createEvolutionEvalReadonlyAudit({ ...store.journal }),
    ).toThrow(/genuine Ledger/);
  });

  it(
    "retains and freezes the entire verified event collection above aggregate document limits",
    () => {
      // This functional fixture repeatedly verifies 600 durable events and
      // exceeds 2 MiB. Give only this case a bounded budget; the timings below
      // diagnose host work and do not establish a production latency SLO.
      const count = 600;
      const startedAt = performance.now();
      const phases = [];
      let observed = null;
      const runStage = (name, operation) => {
        const phaseStartedAt = performance.now();
        console.info(
          "[eval-readonly-large-collection]",
          JSON.stringify({ stage: name, event: "start" }),
        );
        let outcome = "threw";
        try {
          const result = operation();
          outcome = "returned";
          return result;
        } finally {
          const phase = {
            stage: name,
            durationMs: Math.round(performance.now() - phaseStartedAt),
            outcome,
          };
          phases.push(phase);
          console.info(
            "[eval-readonly-large-collection]",
            JSON.stringify({ ...phase, event: "end" }),
          );
        }
      };
      try {
        const fixture = runStage("setup fixture", () =>
          setupEvalLaunchAdmissionFixture(),
        );
        const { ledger } = fixture.options;
        const subject = runStage("store subject", () =>
          fixture.options.artifactPorts.putCanonical(
            "evolution-eval-child-evidence",
            { schema: "test-only-audit-source" },
            {
              audience: fixture.options.descriptor.audience,
              purpose: "evolution-ledger",
              retention: "ledger",
            },
          ),
        );
        runStage("append complete event batch", () =>
          ledger.appendDomainEventBatch(
            Array.from({ length: count }, (_, index) => ({
              artifactTenantId: fixture.options.descriptor.artifactTenantId,
              correlationId: null,
              decision: "committed",
              eventId: `audit-large-${index}`,
              reason: "x".repeat(4096),
              skillName: null,
              sourceRefs: [],
              subjectRef: subject.ref,
              tenantId: fixture.options.descriptor.tenantId,
              type: "test.eval-readonly-audit",
              timestamp: fixture.input.admittedAt,
            })),
          ),
        );
        const audit = runStage("create verified audit", () =>
          createEvolutionEvalReadonlyAudit(ledger),
        );
        const captured = runStage("capture verified snapshot", () =>
          captureEvolutionEvalReadonlyAudit(audit, ledger),
        );
        runStage("assert complete immutable snapshot", () => {
          observed = {
            eventCount: captured.events.length,
            sequence: captured.identity.sequence,
            serializedBytes: Buffer.byteLength(JSON.stringify(captured.events)),
          };
          expect(captured.events).toHaveLength(count);
          expect(captured.identity.sequence).toBe(count);
          expect(captured.events.map((event) => event.sequence)).toEqual(
            Array.from({ length: count }, (_, index) => index + 1),
          );
          expect(observed.serializedBytes).toBeGreaterThan(2 * 1024 * 1024);
          expect(captured.eventsById(`audit-large-${count - 1}`)).toEqual([
            captured.events.at(-1),
          ]);
          for (const event of captured.events) {
            expect(Object.isFrozen(event)).toBe(true);
            expect(Object.isFrozen(event.subjectRef)).toBe(true);
            expect(Object.isFrozen(event.sourceRefs)).toBe(true);
          }
          expect(Object.isFrozen(captured.events)).toBe(true);
          expect(Object.isFrozen(captured.eventsById("audit-large-0"))).toBe(
            true,
          );
          expect(() => captured.events.pop()).toThrow(TypeError);
          expect(() => {
            captured.events[0].subjectRef.digest = digest("substituted");
          }).toThrow(TypeError);
          expect(() => captured.eventsById("audit-large-0").push(null)).toThrow(
            TypeError,
          );
        });
        runStage("verify final journal head", () => {
          expect(captured.assertUnchanged()).toEqual(captured.identity);
        });
      } finally {
        console.info(
          "[eval-readonly-large-collection]",
          JSON.stringify({
            event: "summary",
            functionalBudgetMs: LARGE_COLLECTION_FUNCTIONAL_TIMEOUT_MS,
            expectedEventCount: count,
            observed,
            durationMs: Math.round(performance.now() - startedAt),
            phases,
          }),
        );
      }
    },
    LARGE_COLLECTION_FUNCTIONAL_TIMEOUT_MS,
  );

  it("permanently invalidates an audit after a separate v2 writer changes its head", () => {
    const store = v2Store();
    store.journal.appendDomainEvent(
      v2FixtureDomainEvent(store, "before-writer"),
    );
    const audit = createEvolutionEvalReadonlyAudit(store.journal);
    const captured = captureEvolutionEvalReadonlyAudit(audit, store.journal);
    const originalLength = captured.events.length;
    const writer = openLedgerV2Fixture(store.root);
    writer.journal.appendDomainEvent(
      v2FixtureDomainEvent(writer, "after-writer"),
    );

    expect(captured.events).toHaveLength(originalLength);
    expect(captured.eventsById("after-writer")).toEqual([]);
    expect(() => captured.assertUnchanged()).toThrow(/Ledger changed/);
    expect(() => captured.assertUnchanged()).toThrow(/invalidated/);
    expect(() => captured.eventsById("before-writer")).toThrow(/invalidated/);
    expect(() =>
      captureEvolutionEvalReadonlyAudit(audit, store.journal),
    ).toThrow(/invalidated/);
    const fresh = createEvolutionEvalReadonlyAudit(store.journal);
    const current = captureEvolutionEvalReadonlyAudit(fresh, store.journal);
    expect(current.eventsById("after-writer")).toHaveLength(1);
    expect(current.assertUnchanged().sequence).toBe(originalLength + 1);
    expect(() =>
      captureEvolutionEvalReadonlyAudit(audit, store.journal),
    ).toThrow(/invalidated/);
  });

  it("permanently invalidates after a verification error even when the original HEAD bytes are restored", async () => {
    const fixture = setupEvalLaunchAdmissionFixture();
    const { ledger } = fixture.options;
    const authority = createEvolutionEvalLaunchAdmissionAuthority(
      fixture.options,
    );
    const admitted = await admitEvolutionEvalLaunch(authority, fixture.input);
    const audit = createEvolutionEvalReadonlyAudit(ledger);
    const captured = captureEvolutionEvalReadonlyAudit(audit, ledger);
    const originalHead = fs.readFileSync(ledger.headPath);
    let verificationError;
    let auditError;
    try {
      fs.writeFileSync(ledger.headPath, "not-json\n");
      try {
        ledger.verify();
      } catch (error) {
        verificationError = error;
      }
      expect(verificationError).toMatchObject({
        code: "CC_EVOLUTION_LEDGER_CORRUPT",
        message: "ledger HEAD contains invalid JSON",
      });
      try {
        captured.assertUnchanged();
      } catch (error) {
        auditError = error;
      }
      // The original verification failure propagates, rather than being
      // converted into a normal head mismatch or swallowed as a retry.
      expect(auditError).toMatchObject({
        name: verificationError.name,
        code: verificationError.code,
        message: verificationError.message,
      });
    } finally {
      fs.writeFileSync(ledger.headPath, originalHead);
    }

    expect(ledger.verify()).toMatchObject(captured.identity);
    expect(() => captured.assertUnchanged()).toThrow(/invalidated/);
    expect(() => captured.eventsById(admitted.eventId)).toThrow(/invalidated/);
    expect(() => captureEvolutionEvalReadonlyAudit(audit, ledger)).toThrow(
      /invalidated/,
    );
    const fresh = createEvolutionEvalReadonlyAudit(ledger);
    const current = captureEvolutionEvalReadonlyAudit(fresh, ledger);
    expect(current.eventsById(admitted.eventId)).toHaveLength(1);
    expect(current.assertUnchanged()).toEqual(captured.identity);
    expect(() => captureEvolutionEvalReadonlyAudit(audit, ledger)).toThrow(
      /invalidated/,
    );
  });
});

describe("Eval launch resolution inside a read-only audit", () => {
  it("preserves genuine enrolled admission bindings on v2 and requires final head closure", async () => {
    const fixture = setupEvalCohortEnrollmentFixture({
      now: "2026-09-05T00:00:00.000Z",
    });
    const scope = fixture.cohortOptions.descriptor;
    const store = v2Store({
      tenantId: scope.tenantId,
      artifactTenantId: scope.artifactTenantId,
      audience: scope.audience,
    });
    const cohort = createEvolutionEvalCohortEnrollmentAuthority({
      ...fixture.cohortOptions,
      ledger: store.journal,
      artifactPorts: store.artifactPorts,
      ledgerArtifactResolver: store.resolver,
      now: store.clock,
    });
    const enrolled = enrollEvolutionEvalCohort(cohort, fixture.registration);
    const authority = createEvolutionEvalCohortSlotAdmissionAuthority(cohort, {
      cohortId: fixture.registration.manifest.cohortId,
      slotId: fixture.registration.slots[0].slotId,
    });
    const admitted = await admitEvolutionEvalLaunch(authority, fixture.input);
    const audit = createEvolutionEvalReadonlyAudit(store.journal);
    const captured = captureEvolutionEvalReadonlyAudit(audit, store.journal);
    const lookup = lookupEvalLaunchAdmission(fixture.input);
    const resolved = await resolveEvolutionEvalLaunchFromReadonlyAudit(
      authority,
      lookup,
      audit,
    );
    expect(resolved).toMatchObject({
      schema:
        "chainlesschain.evolution-eval-launch-admission-audit-resolution/v1",
      admissionDigest: admitted.admissionDigest,
      eventId: admitted.eventId,
      eventSequence: admitted.eventSequence,
      evidence: admitted.evidence,
      auditHead: captured.identity,
      authenticated: true,
      historicalSnapshotOnly: true,
      requiresFinalAuditHeadCheck: true,
      readyForExecution: false,
      cohortCompletenessAuthenticated: false,
      promotionAuthority: false,
    });
    expect(resolved.evidence.enrollmentDigest).toBe(enrolled.enrollmentDigest);
    expect(captured.eventsById(admitted.eventId)[0].sourceRefs).toEqual([
      enrolled.enrollmentRef,
    ]);
    expect(Object.isFrozen(resolved.evidence.descriptor)).toBe(true);
    expect(await resolveEvolutionEvalLaunch(authority, lookup)).toEqual(
      admitted,
    );
    expect(captured.assertUnchanged()).toEqual(captured.identity);

    store.journal.appendDomainEvent(
      v2FixtureDomainEvent(store, "between-audit-and-close"),
    );
    // The helper deliberately reads the old immutable view, not a new live head.
    expect(
      (
        await resolveEvolutionEvalLaunchFromReadonlyAudit(
          authority,
          lookup,
          audit,
        )
      ).auditHead,
    ).toEqual(captured.identity);
    expect(() => captured.assertUnchanged()).toThrow(/Ledger changed/);
    await expect(
      resolveEvolutionEvalLaunchFromReadonlyAudit(authority, lookup, audit),
    ).rejects.toThrow(/invalidated/);
  });

  it("still verifies Ed25519, descriptor, lookup and authority brands without invoking the signer", async () => {
    const fixture = setupEvalLaunchAdmissionFixture();
    const signer = { sign: vi.fn(fixture.options.signer.sign) };
    const authority = createEvolutionEvalLaunchAdmissionAuthority({
      ...fixture.options,
      signer,
    });
    const admitted = await admitEvolutionEvalLaunch(authority, fixture.input);
    signer.sign.mockClear();
    const audit = createEvolutionEvalReadonlyAudit(fixture.options.ledger);
    const captured = captureEvolutionEvalReadonlyAudit(
      audit,
      fixture.options.ledger,
    );
    const lookup = lookupEvalLaunchAdmission(fixture.input);
    expect(
      (
        await resolveEvolutionEvalLaunchFromReadonlyAudit(
          authority,
          lookup,
          audit,
        )
      ).evidence,
    ).toEqual(admitted.evidence);

    const wrongKey = createEvolutionEvalLaunchAdmissionAuthority({
      ...fixture.options,
      publicKey: generateKeyPairSync("ed25519").publicKey,
    });
    await expect(
      resolveEvolutionEvalLaunchFromReadonlyAudit(wrongKey, lookup, audit),
    ).rejects.toThrow(/signature/);
    const wrongScope = createEvolutionEvalLaunchAdmissionAuthority({
      ...fixture.options,
      descriptor: {
        ...fixture.options.descriptor,
        manifestDigest: digest("wrong-manifest"),
      },
    });
    await expect(
      resolveEvolutionEvalLaunchFromReadonlyAudit(wrongScope, lookup, audit),
    ).rejects.toThrow(/scope/);
    for (const changed of [
      { runId: "another-run" },
      { runNonce: "another-nonce" },
      { requestDigest: digest("another-request") },
    ])
      await expect(
        resolveEvolutionEvalLaunchFromReadonlyAudit(
          authority,
          { ...lookup, ...changed },
          audit,
        ),
      ).rejects.toThrow(/lookup/);
    await expect(
      resolveEvolutionEvalLaunchFromReadonlyAudit(
        { ...authority },
        lookup,
        audit,
      ),
    ).rejects.toThrow(/trusted launch admission authority/);
    await expect(
      resolveEvolutionEvalLaunchFromReadonlyAudit(authority, lookup, {
        ...audit,
      }),
    ).rejects.toThrow(/genuine read-only audit/);
    expect(signer.sign).not.toHaveBeenCalled();
    expect(captured.assertUnchanged()).toEqual(captured.identity);
  });

  it("re-resolves retained artifact bytes instead of trusting a previously captured event", async () => {
    const fixture = setupEvalLaunchAdmissionFixture();
    const authority = createEvolutionEvalLaunchAdmissionAuthority(
      fixture.options,
    );
    await admitEvolutionEvalLaunch(authority, fixture.input);
    const audit = createEvolutionEvalReadonlyAudit(fixture.options.ledger);
    const directory = path.join(fixture.resources.root, "artifacts", "files");
    const file = fs
      .readdirSync(directory)
      .find((entry) => entry.endsWith(".json"));
    expect(file).toBeTruthy();
    const artifactPath = path.join(directory, file);
    fs.chmodSync(artifactPath, 0o600);
    fs.writeFileSync(artifactPath, '{"substituted":true}');
    await expect(
      resolveEvolutionEvalLaunchFromReadonlyAudit(
        authority,
        lookupEvalLaunchAdmission(fixture.input),
        audit,
      ),
    ).rejects.toThrow();
  });
});
