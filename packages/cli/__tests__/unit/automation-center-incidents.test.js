import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  automationCenterIncidentActionErrorEnvelope,
  runAutomationCenterIncidentAction,
} from "../../src/lib/automation-center-incidents.js";
import { buildAutomationCenterProjection } from "../../src/lib/automation-center.js";
import {
  cancelAutomationExecutionIncident,
  getAutomationExecutionIncident,
  resolveAutomationExecutionIncidentsForSucceededRun,
  upsertAutomationExecutionIncident,
} from "../../src/lib/automation-execution-incident.js";
import {
  createFlow,
  ensureAutomationTables,
} from "../../src/lib/automation-engine.js";
import {
  automationSchedulerExecutionId,
  automationSchedulerJobId,
} from "../../src/lib/scheduler-kernel/automation-adapter.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";
import { RoutineStore } from "../../src/lib/routine-store.js";

describe("Automation Center incident actions", () => {
  const cleanups = [];
  const now = 1_786_700_000_000;
  const incidentCode = "AUTOMATION_EXECUTION_PERMISSION_DENIED";

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function authority() {
    return {
      schemaVersion: 1,
      principal: { type: "agent", id: "center-incident-test" },
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      requestedCapabilities: ["automation.execute"],
      authorizationRefs: {
        decisionId: "decision-1",
        policyRevision: "policy-1",
        grantIds: ["grant-1"],
        approvalIds: [],
        delegationIds: [],
      },
    };
  }

  function fixture({ occurrenceErrorCode = incidentCode } = {}) {
    const db = new Database(":memory:");
    cleanups.push(() => db.close());
    ensureAutomationTables(db);
    const flow = createFlow(db, {
      name: "Incident retry flow",
      createdBy: "did:test:center-incidents",
      nodes: [],
      edges: [],
    });

    const schedulerDir = mkdtempSync(join(tmpdir(), "cc-center-incident-"));
    cleanups.push(() => rmSync(schedulerDir, { recursive: true, force: true }));
    const schedulerStore = openSchedulerStore({
      file: join(schedulerDir, "scheduler.db"),
      clock: () => now,
    });
    const routineStore = new RoutineStore({
      dir: join(schedulerDir, "routines"),
      now: () => now,
    });
    cleanups.push(() => schedulerStore.close());
    schedulerStore.createJob({
      id: automationSchedulerJobId(flow.id),
      kind: "automation.test",
      trigger: { type: "schedule" },
      payload: { flow: { id: flow.id } },
      authority: authority(),
      maxAttempts: 1,
    });
    const occurrence = schedulerStore.enqueueOccurrence({
      jobId: automationSchedulerJobId(flow.id),
      scheduledFor: now,
      triggerKey: "center-incident-test",
    });
    const claim = schedulerStore.claimNext({
      ownerId: "center-incident-worker",
      leaseMs: 1_000,
    });
    const deadLetter = schedulerStore.settle({
      occurrenceId: occurrence.id,
      ownerId: "center-incident-worker",
      fence: claim.fence,
      outcome: "failed",
      error: { code: occurrenceErrorCode, message: "denied internally" },
      retryable: false,
    });
    const incident = upsertAutomationExecutionIncident(db, {
      runId: automationSchedulerExecutionId(occurrence.id),
      flowId: flow.id,
      occurrenceId: occurrence.id,
      triggerType: "schedule",
      category: "permission",
      code: incidentCode,
      authorityDigest: "a".repeat(64),
      boundary: {
        deniedPermissions: ["automation:connector:secret-system"],
        schedulerFence: deadLetter.fence,
      },
      details: {
        reasonCode: incidentCode,
        recoveryCode: "OPERATOR_INTERNAL_ONLY",
      },
    });
    return {
      db,
      flow,
      incident,
      schedulerStore,
      routineStore,
      occurrence,
      deadLetter,
    };
  }

  it("projects sanitized open incidents with exact retry and cancel CLI previews", () => {
    const f = fixture();
    const center = buildAutomationCenterProjection(f.db, {
      now: () => now,
      routineStore: f.routineStore,
    });
    const projected = center.items[0].incidents[0];
    expect(projected.actions).toEqual([
      expect.objectContaining({
        id: "retry",
        available: true,
        preview: {
          executor: "cli",
          argv: [
            "automation",
            "center-incident-action",
            f.incident.incidentId,
            "retry",
            "--expected-revision",
            "1",
            "--json",
          ],
          mutates: true,
        },
      }),
      expect.objectContaining({
        id: "cancel",
        available: true,
        preview: expect.objectContaining({
          argv: [
            "automation",
            "center-incident-action",
            f.incident.incidentId,
            "cancel",
            "--expected-revision",
            "1",
            "--json",
          ],
        }),
      }),
    ]);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("boundary");
    expect(serialized).not.toContain("details");
    expect(serialized).not.toContain("secret-system");
    expect(serialized).not.toContain("OPERATOR_INTERNAL_ONLY");
  });

  it("rejects stale revisions and cancels with incident CAS", () => {
    const f = fixture();
    expect(() =>
      runAutomationCenterIncidentAction(f.db, undefined, {
        incidentId: f.incident.incidentId,
        action: "cancel",
        expectedRevision: f.incident.revision + 1,
        now: () => now,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "AUTOMATION_CENTER_INCIDENT_STALE" }),
    );

    const result = runAutomationCenterIncidentAction(f.db, undefined, {
      incidentId: f.incident.incidentId,
      action: "cancel",
      expectedRevision: f.incident.revision,
      now: () => now,
    });
    expect(result).toMatchObject({
      schema: "chainlesschain.automation-center-incident-action/v1",
      schemaVersion: 1,
      ok: true,
      action: "cancel",
      incident: {
        status: "cancelled",
        revision: 2,
        actions: expect.any(Array),
      },
    });
    expect(
      getAutomationExecutionIncident(f.db, f.incident.incidentId),
    ).toMatchObject({
      status: "cancelled",
      revision: 2,
      resolutionCode: "OPERATOR_CANCELLED",
    });
  });

  it("fails closed when scheduler evidence differs or the incident is manual", () => {
    const mismatched = fixture({
      occurrenceErrorCode: "OTHER_BOUNDARY_DENIAL",
    });
    expect(() =>
      runAutomationCenterIncidentAction(
        mismatched.db,
        mismatched.schedulerStore,
        {
          incidentId: mismatched.incident.incidentId,
          action: "retry",
          expectedRevision: mismatched.incident.revision,
        },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_CENTER_INCIDENT_EVIDENCE_CONFLICT",
      }),
    );

    const manual = upsertAutomationExecutionIncident(mismatched.db, {
      runId: "manual-run",
      flowId: mismatched.flow.id,
      occurrenceId: "manual-occurrence",
      triggerType: "manual",
      category: "budget",
      code: "AUTOMATION_EXECUTION_BUDGET_EXCEEDED",
      authorityDigest: "b".repeat(64),
      boundary: { budgetRevision: 1 },
      details: { reasonCode: "AUTOMATION_EXECUTION_BUDGET_EXCEEDED" },
    });
    expect(() =>
      runAutomationCenterIncidentAction(mismatched.db, undefined, {
        incidentId: manual.incidentId,
        action: "retry",
        expectedRevision: manual.revision,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_CENTER_INCIDENT_RETRY_UNSUPPORTED",
      }),
    );
  });

  it("retries idempotently and leaves the incident open", () => {
    const f = fixture();
    const input = {
      incidentId: f.incident.incidentId,
      action: "retry",
      expectedRevision: f.incident.revision,
    };
    const first = runAutomationCenterIncidentAction(
      f.db,
      f.schedulerStore,
      input,
    );
    const second = runAutomationCenterIncidentAction(
      f.db,
      f.schedulerStore,
      input,
    );
    expect(first.result).toMatchObject({
      deduplicated: false,
      occurrence: {
        occurrenceId: f.occurrence.id,
        status: "retry_wait",
        fence: f.deadLetter.fence,
      },
    });
    expect(second.result).toMatchObject({
      requestId: first.result.requestId,
      deduplicated: true,
    });
    expect(
      getAutomationExecutionIncident(f.db, f.incident.incidentId),
    ).toMatchObject({
      status: "open",
      revision: f.incident.revision,
    });
  });

  it("issues a new retry request after the requeued attempt fails again", () => {
    const f = fixture();
    const input = {
      incidentId: f.incident.incidentId,
      action: "retry",
      expectedRevision: f.incident.revision,
    };
    const first = runAutomationCenterIncidentAction(
      f.db,
      f.schedulerStore,
      input,
    );
    const claim = f.schedulerStore.claimNext({
      ownerId: "center-incident-worker-2",
      leaseMs: 1_000,
    });
    expect(claim.id).toBe(f.occurrence.id);
    const failedAgain = f.schedulerStore.settle({
      occurrenceId: claim.id,
      ownerId: "center-incident-worker-2",
      fence: claim.fence,
      outcome: "failed",
      error: { code: incidentCode, message: "still denied internally" },
      retryable: false,
    });
    expect(failedAgain.status).toBe("dead_letter");

    const second = runAutomationCenterIncidentAction(
      f.db,
      f.schedulerStore,
      input,
    );
    expect(second.result).toMatchObject({
      deduplicated: false,
      occurrence: {
        occurrenceId: f.occurrence.id,
        status: "retry_wait",
        fence: failedAgain.fence,
      },
    });
    expect(second.result.requestId).not.toBe(first.result.requestId);
  });

  it("CAS-resolves only open incidents for the exact succeeded run", () => {
    const f = fixture();
    const alreadyClosed = upsertAutomationExecutionIncident(f.db, {
      runId: f.incident.runId,
      flowId: f.flow.id,
      occurrenceId: f.occurrence.id,
      triggerType: "schedule",
      category: "connector",
      code: "AUTOMATION_EXECUTION_CONNECTOR_DENIED",
      authorityDigest: "c".repeat(64),
      boundary: { connector: "slack" },
      details: { reasonCode: "AUTOMATION_EXECUTION_CONNECTOR_DENIED" },
    });
    cancelAutomationExecutionIncident(f.db, alreadyClosed.incidentId, {
      expectedRevision: alreadyClosed.revision,
      resolutionCode: "OPERATOR_CANCELLED",
      now: () => now - 1,
    });

    const result = resolveAutomationExecutionIncidentsForSucceededRun(
      f.db,
      f.incident.runId,
      { now: () => now },
    );
    expect(result).toEqual({
      runId: f.incident.runId,
      resolutionCode: "EXECUTION_SUCCEEDED",
      resolvedCount: 1,
      resolvedIncidentIds: [f.incident.incidentId],
    });
    expect(
      getAutomationExecutionIncident(f.db, f.incident.incidentId),
    ).toMatchObject({
      status: "resolved",
      revision: 2,
      resolutionCode: "EXECUTION_SUCCEEDED",
    });
    expect(
      getAutomationExecutionIncident(f.db, alreadyClosed.incidentId),
    ).toMatchObject({
      status: "cancelled",
      revision: 2,
      resolutionCode: "OPERATOR_CANCELLED",
    });
    expect(
      resolveAutomationExecutionIncidentsForSucceededRun(
        f.db,
        f.incident.runId,
        { now: () => now + 1 },
      ).resolvedCount,
    ).toBe(0);
  });

  it("emits a versioned JSON error without serializing internal details", () => {
    const incidentId = "a".repeat(64);
    const error = new Error(
      "retry denied: token=super-secret-value C:\\private\\scheduler.db",
    );
    error.code = "AUTOMATION_CENTER_INCIDENT_STALE";
    error.details = { token: "must-not-leak" };
    expect(
      automationCenterIncidentActionErrorEnvelope(error, {
        incidentId,
        action: "retry",
      }),
    ).toEqual({
      schema: "chainlesschain.automation-center-incident-action-error/v1",
      schemaVersion: 1,
      authority: "cli",
      ok: false,
      incidentId,
      action: "retry",
      error: {
        code: "AUTOMATION_CENTER_INCIDENT_STALE",
        message: "Automation Center incident action failed",
        retryable: false,
      },
    });
    expect(
      JSON.stringify(
        automationCenterIncidentActionErrorEnvelope(error, {
          incidentId,
          action: "retry",
        }),
      ),
    ).not.toContain("super-secret-value");
  });
});
