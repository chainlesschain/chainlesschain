import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  automationCenterRuntimeActionErrorEnvelope,
  buildAutomationCenterRuntimeProjection,
  runAutomationCenterRuntimeAction,
} from "../../src/lib/automation-center-runtime.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

const CHECKPOINT_CAPABILITY = Object.freeze({
  schemaVersion: 1,
  pauseResume: "checkpoint_v1",
  safePoints: ["before_execute", "adapter_checkpoint"],
});
const NO_CAPABILITY = Object.freeze({
  schemaVersion: 1,
  pauseResume: "none",
  safePoints: [],
});

function expectCode(action, code) {
  try {
    action();
  } catch (error) {
    expect(error?.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("Automation Center scheduler runtime controls", () => {
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), "cc-center-runtime-"));
    const file = join(dir, "scheduler.db");
    const now = 1_786_700_000_000;
    const store = openSchedulerStore({
      file,
      Database,
      clock: () => now,
    });
    cleanups.push(() => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });
    store.createJob({
      id: "automation-job",
      kind: "automation",
      trigger: { type: "schedule" },
      payload: { secretPayload: "payload-must-not-leak" },
      authority: {
        schemaVersion: 1,
        principal: { type: "agent", id: "principal-must-not-leak" },
        tenantId: "tenant-must-not-leak",
        workspaceId: "workspace-must-not-leak",
        requestedCapabilities: ["secret.capability"],
        authorizationRefs: {
          decisionId: "decision-must-not-leak",
          policyRevision: "private-policy",
          grantIds: [],
          approvalIds: [],
          delegationIds: [],
        },
      },
      maxAttempts: 3,
    });
    const occurrence = store.enqueueOccurrence({
      jobId: "automation-job",
      scheduledFor: now,
      triggerKey: "center-runtime:first",
    });
    const claim = store.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "owner-must-not-leak",
      leaseMs: 60_000,
    });
    store.db
      .prepare(
        "UPDATE occurrences SET last_error_json = ? WHERE occurrence_id = ?",
      )
      .run('{"body":"error-body-must-not-leak"}', occurrence.id);
    return { store, occurrence, claim, now };
  }

  function projection(store, capability = CHECKPOINT_CAPABILITY) {
    return buildAutomationCenterRuntimeProjection(store, {
      capabilityForKind: () => capability,
    });
  }

  it("only previews checkpoint-capable runtimes and emits exact fenced argv", () => {
    const f = fixture();
    const item = projection(f.store).items[0];
    expect(item).toMatchObject({
      id: f.occurrence.id,
      jobKind: "automation",
      status: "running",
      fence: f.claim.fence,
      controlRevision: 0,
    });
    expect(item.actions).toEqual([
      {
        id: "pause",
        available: true,
        reason: null,
        preview: {
          executor: "cli",
          argv: [
            "automation",
            "center-runtime-action",
            f.occurrence.id,
            "pause",
            "--expected-fence",
            String(f.claim.fence),
            "--expected-control-revision",
            "0",
            "--json",
          ],
          mutates: true,
        },
      },
      {
        id: "resume",
        available: false,
        reason: "occurrence_not_paused",
        preview: null,
      },
    ]);

    const unsupported = projection(f.store, NO_CAPABILITY).items[0];
    expect(unsupported.runtimeControl).toBeNull();
    expect(unsupported.actions).toEqual([
      {
        id: "pause",
        available: false,
        reason: "runtime_control_unsupported",
        preview: null,
      },
      {
        id: "resume",
        available: false,
        reason: "runtime_control_unsupported",
        preview: null,
      },
    ]);
  });

  it("pauses one exact running fence and makes its deterministic request idempotent", () => {
    const f = fixture();
    const input = {
      capabilityForKind: () => CHECKPOINT_CAPABILITY,
      occurrenceId: f.occurrence.id,
      action: "pause",
      expectedFence: f.claim.fence,
      expectedControlRevision: 0,
    };
    expectCode(
      () =>
        runAutomationCenterRuntimeAction(f.store, {
          ...input,
          expectedFence: f.claim.fence + 1,
        }),
      "AUTOMATION_CENTER_RUNTIME_FENCE_CONFLICT",
    );

    const first = runAutomationCenterRuntimeAction(f.store, input);
    expect(first).toMatchObject({
      schemaVersion: 1,
      action: "pause",
      deduplicated: false,
      occurrence: { id: f.occurrence.id, status: "running" },
      control: { state: "pause_requested", revision: 1 },
    });
    expect(runAutomationCenterRuntimeAction(f.store, input)).toMatchObject({
      requestId: first.requestId,
      deduplicated: true,
      control: { state: "pause_requested", revision: 1 },
    });
    expectCode(
      () =>
        runAutomationCenterRuntimeAction(f.store, {
          ...input,
          expectedControlRevision: 999,
        }),
      "AUTOMATION_CENTER_RUNTIME_REVISION_CONFLICT",
    );
    expect(projection(f.store).items[0]).toMatchObject({
      status: "pause_requested",
      controlRevision: 1,
      actions: [
        {
          id: "pause",
          available: false,
          reason: "pause_already_requested",
          preview: null,
        },
        expect.objectContaining({ id: "resume", available: false }),
      ],
    });
  });

  it("resumes a paused occurrence with exact revision CAS and rejects drift", () => {
    const f = fixture();
    const pausedRequest = runAutomationCenterRuntimeAction(f.store, {
      capabilityForKind: () => CHECKPOINT_CAPABILITY,
      occurrenceId: f.occurrence.id,
      action: "pause",
      expectedFence: f.claim.fence,
      expectedControlRevision: 0,
    });
    f.store.ackOccurrencePause({
      occurrenceId: f.occurrence.id,
      ownerId: "owner-must-not-leak",
      fence: f.claim.fence,
      requestId: pausedRequest.requestId,
      expectedRevision: pausedRequest.control.revision,
      safePoint: "adapter_checkpoint",
      checkpoint: { privateCursor: "checkpoint-must-not-leak" },
    });
    const item = projection(f.store).items[0];
    expect(item).toMatchObject({ status: "paused", controlRevision: 2 });
    const resume = item.actions.find((entry) => entry.id === "resume");
    expect(resume.preview.argv).toEqual([
      "automation",
      "center-runtime-action",
      f.occurrence.id,
      "resume",
      "--expected-fence",
      String(f.claim.fence),
      "--expected-control-revision",
      "2",
      "--json",
    ]);

    const input = {
      capabilityForKind: () => CHECKPOINT_CAPABILITY,
      occurrenceId: f.occurrence.id,
      action: "resume",
      expectedFence: f.claim.fence,
      expectedControlRevision: 2,
    };
    expectCode(
      () =>
        runAutomationCenterRuntimeAction(f.store, {
          ...input,
          expectedControlRevision: 1,
        }),
      "AUTOMATION_CENTER_RUNTIME_REVISION_CONFLICT",
    );
    const first = runAutomationCenterRuntimeAction(f.store, input);
    expect(first).toMatchObject({
      action: "resume",
      deduplicated: false,
      control: { state: "resumed", revision: 3 },
    });
    expect(runAutomationCenterRuntimeAction(f.store, input)).toMatchObject({
      requestId: first.requestId,
      deduplicated: true,
      control: { state: "resumed", revision: 3 },
    });
  });

  it("never projects occurrence payload, authority, owner, checkpoint or error body", () => {
    const f = fixture();
    const encoded = JSON.stringify(projection(f.store));
    for (const secret of [
      "payload-must-not-leak",
      "principal-must-not-leak",
      "tenant-must-not-leak",
      "workspace-must-not-leak",
      "decision-must-not-leak",
      "private-policy",
      "secret.capability",
      "owner-must-not-leak",
      "error-body-must-not-leak",
    ]) {
      expect(encoded).not.toContain(secret);
    }
  });

  it("emits a fixed JSON error envelope without reflecting native secrets", () => {
    const f = fixture();
    const error = Object.assign(
      new Error("token=super-secret-value at C:\\private\\scheduler.db"),
      {
        code: "SQLITE_IOERR_WRITE",
        details: { token: "super-secret-value" },
      },
    );
    const envelope = automationCenterRuntimeActionErrorEnvelope(error, {
      occurrenceId: f.occurrence.id,
      action: "pause",
    });
    expect(envelope).toEqual({
      schema: "chainlesschain.automation-center-runtime-action-error/v1",
      schemaVersion: 1,
      authority: "cli",
      ok: false,
      occurrenceId: f.occurrence.id,
      action: "pause",
      error: {
        code: "AUTOMATION_CENTER_RUNTIME_ACTION_FAILED",
        message: "Automation Center runtime action failed",
        retryable: false,
      },
    });
    expect(JSON.stringify(envelope)).not.toContain("super-secret-value");
    expect(JSON.stringify(envelope)).not.toContain("scheduler.db");
  });

  it("bounds store enumeration at 200 and rejects non-allowlisted filters", () => {
    const f = fixture();
    for (let index = 1; index <= 205; index += 1) {
      f.store.enqueueOccurrence({
        jobId: "automation-job",
        scheduledFor: f.now + index,
        triggerKey: `center-runtime:${index}`,
      });
    }
    // The production claimant serializes occurrences for one job. Populate
    // running rows directly here so the read boundary itself is tested with
    // more than its maximum result size.
    f.store.db
      .prepare(
        `UPDATE occurrences
         SET status = 'running', attempt = 1, fence = 1,
             lease_owner = 'bounded-owner', lease_expires_at = ?`,
      )
      .run(f.now + 60_000);
    expect(
      f.store.listRuntimeControlOccurrences({ limit: 10_000 }),
    ).toHaveLength(200);
    expectCode(
      () => f.store.listRuntimeControlOccurrences({ statuses: ["succeeded"] }),
      "SCHEDULER_INVALID_ARGUMENT",
    );
    expectCode(
      () =>
        f.store.listRuntimeControlOccurrences({ jobKinds: ["test.adapter"] }),
      "SCHEDULER_INVALID_ARGUMENT",
    );
  });
});
