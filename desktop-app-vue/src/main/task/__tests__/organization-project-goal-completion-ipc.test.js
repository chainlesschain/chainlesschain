import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const {
  organizationProjectFixture,
} = require("./fixtures/organization-project-host-fixture.cjs");
const {
  OrganizationProjectAuthority,
} = require("@chainlesschain/session-core/organization-project-authority");
const {
  OrganizationProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/organization-project-goal-monitoring");
const {
  openSchedulerStore,
} = require("@chainlesschain/session-core/scheduler-store");
const Database = require("better-sqlite3");
const tasks = {
  id: "tasks",
  kind: "business-assertion",
  description: "Every project task is completed",
};
const manual = {
  id: "manual",
  kind: "manual",
  description: "An authorized member reviewed delivery",
};
const taskAssertion = { criterionId: "tasks", type: "all-tasks-completed" };

describe("organization goal independent native acceptance", () => {
  let f,
    dialog,
    directory,
    engine,
    store,
    goal,
    permissions,
    workflowIds,
    rejectDone,
    rejectedWrites;
  const request = (requestId = "check-1") => ({
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId,
  });
  const status = () =>
    f.host.getGoalAcceptanceStatus(f.event, { goalId: goal.id });
  const usage = async () =>
    (await f.host.getGoalStatus(f.event, { id: goal.id })).usage;
  const finishTasks = () =>
    f.db
      .prepare(
        "UPDATE project_tasks SET status='completed',updated_at=updated_at+1 WHERE project_id='p1'",
      )
      .run();
  async function configure(
    criteria = [tasks],
    assertions = [taskAssertion],
    requestId = "configure-1",
  ) {
    const result = await f.host.configureGoalAcceptance(f.event, {
      ...request(requestId),
      acceptanceCriteria: criteria,
      assertions,
    });
    if (result.goal) goal = result.goal;
    return result;
  }
  async function attest() {
    f.setActor(f.identities.owner);
    const policy = { orgId: "org1", permissions, workflowIds };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
    f.setActor(f.identities.requester);
  }
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-goal-completion-"));
    dialog = vi.fn(async () => ({ response: 1 }));
    f = organizationProjectFixture(dialog, {
      goalMonitoringController: {
        initialize: async () => {
          if (!engine) {
            store = openSchedulerStore({
              file: join(directory, "scheduler.sqlite"),
              Database,
              clock: f.getNow,
              protectStorage: () => true,
            });
            const authority = new OrganizationProjectAuthority({
              db: f.db,
              getActor: f.getActor,
              now: f.getNow,
              confirm: () => false,
            });
            engine = new OrganizationProjectGoalMonitoringEngine({
              db: f.db,
              getActor: f.getActor,
              authority,
              store,
              clock: f.getNow,
            });
          }
          return engine;
        },
        close: async () => {
          await engine?.close();
          store?.close();
        },
      },
    });
    ({ permissions, workflowIds } = await f.setup());
    for (const grant of permissions)
      grant.permissions.push(
        "goal.read",
        "goal.create",
        "goal.update",
        "goal.check",
        "goal.monitor",
        "goal.propose",
        "goal.accept",
        "risk.read",
        "risk.evaluate",
      );
    await attest();
    rejectDone = false;
    rejectedWrites = 0;
    f.db.function("test_completion_write_guard", (stage) => {
      if (rejectDone === stage) {
        rejectedWrites++;
        throw new Error("Native completion commit rejected");
      }
      return 1;
    });
    // Install before native source/schema capture, so the rollback test reaches the actual CAS.
    f.db.exec(
      "CREATE TRIGGER test_completion_cas_failure AFTER UPDATE OF goal_json ON cc_organization_project_goals WHEN json_extract(NEW.goal_json,'$.status')='done' BEGIN SELECT test_completion_write_guard('goal'); END;",
    );
    f.db.exec(
      "CREATE TRIGGER test_completion_report_failure AFTER INSERT ON cc_organization_project_goal_acceptance WHEN NEW.kind='report' BEGIN SELECT test_completion_write_guard('report'); END;",
    );
    f.db.exec(
      "CREATE TRIGGER test_completion_source_failure AFTER INSERT ON cc_organization_project_goal_acceptance WHEN NEW.kind='source' BEGIN SELECT test_completion_write_guard('source'); END;",
    );
    f.db.exec(
      "CREATE TRIGGER test_completion_fence_failure AFTER INSERT ON cc_organization_project_goal_acceptance WHEN NEW.kind='fence' BEGIN SELECT test_completion_write_guard('fence'); END;",
    );
    f.db.exec(
      "CREATE TRIGGER test_completion_usage_failure AFTER INSERT ON cc_organization_project_goal_usage BEGIN SELECT test_completion_write_guard('usage'); END;",
    );
    f.db.exec(
      "CREATE TRIGGER test_completion_monitor_failure AFTER UPDATE ON cc_organization_project_goal_monitor_states BEGIN SELECT test_completion_write_guard('monitor'); END;",
    );
    f.db.exec(
      "CREATE TRIGGER test_completion_unknown_action AFTER UPDATE OF description ON project_tasks BEGIN SELECT test_completion_write_guard('action'); END;",
    );
    ({ goal } = await f.host.createGoal(f.event, {
      projectId: "p1",
      requestId: "create",
      objective: "Independently verify delivery",
      budgetPolicy: { maxRuns: 30 },
    }));
    dialog.mockClear();
  });
  afterEach(async () => {
    await f?.host.close();
    engine = null;
    store = null;
    f?.db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("lets an authorized noncreator configure, acknowledge, and complete with shared evidence", async () => {
    f.setActor(f.identities.first);
    const configured = await configure([tasks, manual]);
    expect(configured.goal.revision).toBe(2);
    expect(configured.goal.ownerRef).toBe(f.identities.requester);
    finishTasks();
    const acknowledgement = await f.host.acknowledgeGoalAcceptance(f.event, {
      ...request("ack-1"),
      criterionIds: ["manual"],
    });
    expect(acknowledgement.acknowledgement.actorDid).toBe(f.identities.first);
    const checked = await f.host.checkGoalAcceptance(f.event, request());
    expect(checked).toMatchObject({
      completed: false,
      report: { met: true, actorDid: f.identities.first },
    });
    f.setActor(f.identities.second);
    const completed = await f.host.completeGoal(f.event, request("complete-1"));
    expect(completed).toMatchObject({
      completed: true,
      goal: { status: "done", ownerRef: f.identities.requester },
      report: { met: true },
    });
    expect(dialog).toHaveBeenCalledTimes(3);
    for (const call of dialog.mock.calls) {
      expect(call[0]).toBe(f.parent);
      expect(call[1]).toMatchObject({
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
    }
    f.setActor(f.identities.second);
    const shared = await status();
    expect(shared.goal.status).toBe("done");
    expect(shared.reports).toHaveLength(2);
    expect(shared.acknowledgements).toHaveLength(1);
    expect((await usage()).totalRuns).toBe(2);
  });
  it.each(["empty", "incomplete", "risk"])(
    "does not infer completion from %s source data",
    async (scenario) => {
      if (scenario === "risk") {
        await configure(
          [
            {
              id: "risk",
              kind: "business-assertion",
              description: "Overdue signals resolved",
            },
          ],
          [
            {
              criterionId: "risk",
              type: "selected-risk-signals-cleared",
              reasonCodes: ["OVERDUE_INCOMPLETE_TASK"],
            },
          ],
        );
        f.db.prepare("UPDATE project_tasks SET due_date=1 WHERE id='t1'").run();
      } else await configure();
      if (scenario === "empty") f.db.prepare("DELETE FROM project_tasks").run();
      const result = await f.host.checkGoalAcceptance(f.event, request());
      expect(result.report.met).toBe(false);
      expect(result.completed).toBe(false);
      expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
    },
  );
  it("re-evaluates fresh task state instead of trusting an earlier met report", async () => {
    await configure();
    finishTasks();
    expect(
      (await f.host.checkGoalAcceptance(f.event, request())).report.met,
    ).toBe(true);
    f.db
      .prepare(
        "UPDATE project_tasks SET status='pending',updated_at=updated_at+1 WHERE id='t1'",
      )
      .run();
    const result = await f.host.completeGoal(
      f.event,
      request("complete-stale"),
    );
    expect(result.completed).toBe(false);
    expect(result.report.met).toBe(false);
    expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
  });
  it("replays exact configure, acknowledgement, check, and completion requests after lost replies", async () => {
    const configInput = {
      ...request("config-replay"),
      acceptanceCriteria: [tasks, manual],
      assertions: [taskAssertion],
    };
    const configured = await f.host.configureGoalAcceptance(
      f.event,
      configInput,
    );
    goal = configured.goal;
    expect(
      (await f.host.configureGoalAcceptance(f.event, configInput)).replayed,
    ).toBe(true);
    const ack = { ...request("ack-replay"), criterionIds: ["manual"] };
    finishTasks();
    await f.host.acknowledgeGoalAcceptance(f.event, ack);
    expect(
      (await f.host.acknowledgeGoalAcceptance(f.event, ack)).replayed,
    ).toBe(true);
    const check = request("check-replay"),
      checked = await f.host.checkGoalAcceptance(f.event, check);
    expect((await f.host.checkGoalAcceptance(f.event, check)).report.id).toBe(
      checked.report.id,
    );
    const complete = request("complete-replay");
    let committed;
    await expect(
      (async () => {
        committed = await f.host.completeGoal(f.event, complete);
        throw new Error("IPC response lost");
      })(),
    ).rejects.toThrow("IPC response lost");
    const replay = await f.host.completeGoal(f.event, complete);
    expect(replay.replayed).toBe(true);
    expect(replay.completed).toBe(true);
    expect(replay.report.id).toBe(committed.report.id);
    expect((await usage()).totalRuns).toBe(2);
    expect(dialog).toHaveBeenCalledTimes(3);
  });
  it("cancels configuration and final completion without changing the goal", async () => {
    dialog.mockResolvedValueOnce({ response: 0 });
    expect(await configure()).toMatchObject({ status: "cancelled" });
    expect(f.host.getGoal(f.event, { id: goal.id }).revision).toBe(1);
    await configure();
    finishTasks();
    dialog.mockResolvedValueOnce({ response: 0 });
    const result = await f.host.completeGoal(
      f.event,
      request("cancel-complete"),
    );
    expect(result).toMatchObject({ status: "cancelled" });
    expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
    expect((await usage()).totalRuns).toBe(0);
  });
  it("records cancelled manual acknowledgement without satisfying the criterion", async () => {
    await configure([manual], []);
    dialog.mockResolvedValueOnce({ response: 0 });
    const result = await f.host.acknowledgeGoalAcceptance(f.event, {
      ...request("cancel-ack"),
      criterionIds: ["manual"],
    });
    expect(result.acknowledgement.status).toBe("cancelled");
    expect(
      (await f.host.checkGoalAcceptance(f.event, request())).report.met,
    ).toBe(false);
  });
  it("requires fresh human acceptance after tasks change but preserves the configured plan", async () => {
    await configure([tasks, manual]);
    await f.host.acknowledgeGoalAcceptance(f.event, {
      ...request("old-human-acceptance"),
      criterionIds: ["manual"],
    });
    finishTasks();
    expect(
      (await f.host.checkGoalAcceptance(f.event, request("new-facts"))).report
        .met,
    ).toBe(false);
    f.setActor(f.identities.first);
    await f.host.acknowledgeGoalAcceptance(f.event, {
      ...request("fresh-human-acceptance"),
      criterionIds: ["manual"],
    });
    f.setActor(f.identities.second);
    expect(
      (await f.host.completeGoal(f.event, request("cross-member-complete")))
        .completed,
    ).toBe(true);
  });
  it.each(["identity", "task", "revision", "expiry", "membership"])(
    "rejects completion when %s changes inside native confirmation",
    async (change) => {
      await configure();
      finishTasks();
      dialog.mockImplementationOnce(async () => {
        if (change === "identity") f.setActor(f.identities.requester);
        if (change === "task")
          f.db
            .prepare(
              "UPDATE project_tasks SET status='pending',updated_at=updated_at+1 WHERE id='t1'",
            )
            .run();
        if (change === "revision")
          await f.host.reviseGoal(f.event, {
            id: goal.id,
            expectedRevision: goal.revision,
            requestId: "dialog-revise",
            patch: { objective: "Changed during confirmation" },
          });
        if (change === "expiry") f.setNow(100000001);
        if (change === "membership")
          f.db
            .prepare(
              "UPDATE organization_members SET status='removed' WHERE member_did=?",
            )
            .run(f.identities.requester);
        return { response: 1 };
      });
      const result = await f.host
        .completeGoal(f.event, request("changed"))
        .catch(() => null);
      expect(result?.completed).not.toBe(true);
      expect(
        JSON.parse(
          f.db
            .prepare(
              "SELECT goal_json FROM cc_organization_project_goals WHERE id=?",
            )
            .get(goal.id).goal_json,
        ).status,
      ).toBe("active");
    },
  );
  it("requires explicit acceptance permission and cannot mark done via generic revise", async () => {
    await expect(
      f.host.reviseGoal(f.event, {
        id: goal.id,
        expectedRevision: goal.revision,
        requestId: "generic-done",
        patch: { status: "done" },
      }),
    ).rejects.toThrow();
    permissions.find(
      (grant) => grant.actorDid === f.identities.requester,
    ).permissions = permissions
      .find((grant) => grant.actorDid === f.identities.requester)
      .permissions.filter((permission) => permission !== "goal.accept");
    await attest();
    dialog.mockClear();
    await expect(configure()).rejects.toThrow();
    expect(dialog).not.toHaveBeenCalled();
  });
  it.each(["configure", "acknowledge"])(
    "fences same-identity reauthentication during %s confirmation",
    async (operation) => {
      if (operation === "acknowledge") await configure([manual], []);
      dialog.mockClear();
      dialog.mockImplementationOnce(async () => {
        f.setActor(f.identities.requester);
        return { response: 1 };
      });
      const pending =
        operation === "configure"
          ? configure()
          : f.host.acknowledgeGoalAcceptance(f.event, {
              ...request("reauth-ack"),
              criterionIds: ["manual"],
            });
      await expect(pending).rejects.toThrow("ORG_AUTH_IDENTITY_CHANGED");
      expect(dialog).toHaveBeenCalledTimes(1);
      expect(f.host.getGoal(f.event, { id: goal.id }).revision).toBe(
        goal.revision,
      );
      if (operation === "acknowledge")
        expect((await status()).acknowledgements).toHaveLength(0);
    },
  );
  it.each([
    { acceptanceCriteria: [] },
    { assertions: [{ criterionId: "tasks", type: "renderer-progress" }] },
    { actorDid: "did:owner" },
    { expectedAuthority: {} },
  ])(
    "rejects invalid configuration before native confirmation: %j",
    async (extra) => {
      await expect(
        f.host.configureGoalAcceptance(f.event, {
          ...request("invalid"),
          acceptanceCriteria: [tasks],
          assertions: [taskAssertion],
          ...extra,
        }),
      ).rejects.toThrow();
      expect(dialog).not.toHaveBeenCalled();
      expect(f.host.getGoal(f.event, { id: goal.id }).revision).toBe(1);
    },
  );
  it.each(["goal", "source", "fence", "report", "usage", "monitor"])(
    "rolls back evidence, budget, goal, and monitor when native %s persistence fails",
    async (stage) => {
      await configure();
      finishTasks();
      await f.host.startGoalMonitoring(f.event, {
        id: goal.id,
        expectedRevision: goal.revision,
        requestId: "rollback-monitor",
        intervalMs: 60000,
        expiresAt: 3600000,
      });
      const before = await status();
      const evidenceCount = () =>
        f.db
          .prepare(
            "SELECT count(*) AS n FROM cc_organization_project_goal_acceptance",
          )
          .get().n;
      const previousEvidenceCount = evidenceCount();
      const riskCount = () =>
        f.db
          .prepare(
            "SELECT count(*) AS n FROM cc_organization_project_risk_reviews",
          )
          .get().n;
      const previousRiskCount = riskCount();
      const previousMonitor = (
        await f.host.getGoalStatus(f.event, { id: goal.id })
      ).monitor;
      rejectDone = stage;
      await expect(
        f.host.completeGoal(f.event, request("write-failure")),
      ).rejects.toThrow();
      expect(rejectedWrites).toBe(1);
      expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
      expect((await status()).reports).toEqual(before.reports);
      expect(evidenceCount()).toBe(previousEvidenceCount);
      expect(riskCount()).toBe(previousRiskCount);
      expect((await usage()).totalRuns).toBe(0);
      expect(
        (await f.host.getGoalStatus(f.event, { id: goal.id })).monitor,
      ).toEqual(previousMonitor);
    },
  );
  it("stops future periodic scheduling when completion commits", async () => {
    await configure();
    finishTasks();
    const { monitor } = await f.host.startGoalMonitoring(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "monitor",
      intervalMs: 60000,
      expiresAt: 3600000,
    });
    expect(
      (await f.host.completeGoal(f.event, request("complete-monitor")))
        .completed,
    ).toBe(true);
    const stopped = (await f.host.getGoalStatus(f.event, { id: goal.id }))
      .monitor;
    expect(stopped.id).toBe(monitor.id);
    expect(stopped.enabled).toBe(false);
    expect(stopped.aborted).not.toBe(true);
  });
  it("includes another member's unresolved intent from an earlier goal revision", async () => {
    ({ goal } = await f.host.reviseGoal(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "enable",
      patch: { allowedActionTypes: ["task.update-description"] },
    }));
    f.db.prepare("UPDATE project_tasks SET due_date=1 WHERE id='t1'").run();
    f.setActor(f.identities.owner);
    await f.host.checkGoalNow(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "check-actions",
    });
    const { suggestions } = await f.host.listGoalSuggestions(f.event, {
      goalId: goal.id,
    });
    const prepared = await f.host.prepareGoalAction(f.event, {
      goalId: goal.id,
      suggestionId: suggestions[0].suggestion.id,
      expectedRevision: goal.revision,
      requestId: "other-member-intent",
      description: "Pending team follow-up",
    });
    await f.host.submitGoalAction(f.event, {
      intentId: prepared.intent.id,
      workflowId: workflowIds[0],
    });
    f.setActor(f.identities.requester);
    await configure(
      [
        {
          id: "actions",
          kind: "business-assertion",
          description: "All goal actions resolved",
        },
      ],
      [{ criterionId: "actions", type: "all-goal-actions-resolved" }],
    );
    const result = await f.host.checkGoalAcceptance(
      f.event,
      request("pending-history"),
    );
    expect(result.report.met).toBe(false);
    expect(result.completed).toBe(false);
    expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
  });
  it("rejects final confirmation when a new goal action intent appears during the dialog", async () => {
    ({ goal } = await f.host.reviseGoal(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "enable",
      patch: { allowedActionTypes: ["task.update-description"] },
    }));
    await configure(
      [
        {
          id: "actions",
          kind: "business-assertion",
          description: "All goal actions resolved",
        },
      ],
      [{ criterionId: "actions", type: "all-goal-actions-resolved" }],
    );
    f.db.prepare("UPDATE project_tasks SET due_date=1 WHERE id='t1'").run();
    await f.host.checkGoalNow(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "new-action-source",
    });
    const { suggestions } = await f.host.listGoalSuggestions(f.event, {
      goalId: goal.id,
    });
    dialog.mockImplementationOnce(async () => {
      await f.host.prepareGoalAction(f.event, {
        goalId: goal.id,
        suggestionId: suggestions[0].suggestion.id,
        expectedRevision: goal.revision,
        requestId: "dialog-new-action",
        description: "New action requiring review",
      });
      return { response: 1 };
    });
    const result = await f.host
      .completeGoal(f.event, request("dialog-actions"))
      .catch(() => null);
    expect(result?.completed).not.toBe(true);
    expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
  });
  it("blocks acceptance of a prior member's unknown native action even without an action criterion", async () => {
    ({ goal } = await f.host.reviseGoal(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "unknown-enable",
      patch: { allowedActionTypes: ["task.update-description"] },
    }));
    f.db.prepare("UPDATE project_tasks SET due_date=1 WHERE id='t1'").run();
    f.setActor(f.identities.owner);
    await f.host.checkGoalNow(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "unknown-source",
    });
    const { suggestions } = await f.host.listGoalSuggestions(f.event, {
      goalId: goal.id,
    });
    const prepared = await f.host.prepareGoalAction(f.event, {
      goalId: goal.id,
      suggestionId: suggestions[0].suggestion.id,
      expectedRevision: goal.revision,
      requestId: "unknown-intent",
      description: "Native action with uncertain receipt",
    });
    const { proposal } = await f.host.submitGoalAction(f.event, {
      intentId: prepared.intent.id,
      workflowId: workflowIds[0],
    });
    for (const [step, actor] of [
      f.identities.first,
      f.identities.second,
    ].entries()) {
      f.setActor(actor);
      await f.host.respondProposal(f.event, {
        proposalId: proposal.proposalId,
        step,
        decision: "approve",
      });
    }
    f.setActor(f.identities.owner);
    rejectDone = "action";
    await f.host
      .executeProposal(f.event, { proposalId: proposal.proposalId })
      .catch(() => null);
    expect(rejectedWrites).toBe(1);
    rejectDone = false;
    f.setActor(f.identities.requester);
    await configure([manual], []);
    await f.host.acknowledgeGoalAcceptance(f.event, {
      ...request("unknown-ack"),
      criterionIds: ["manual"],
    });
    const checked = await f.host.checkGoalAcceptance(
      f.event,
      request("unknown-report"),
    );
    expect(checked.completed).toBe(false);
    expect(checked.report.met).toBe(false);
    expect(checked.report.blockedReason).toMatch(/UNRESOLVED|UNKNOWN/);
    expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
  });
});
