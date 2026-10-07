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
const {
  createBusinessActionRequest,
} = require("@chainlesschain/session-core/business-object-contract");

describe("organization goal suggestions bind native approval and action execution", () => {
  let f,
    dialog,
    directory,
    engine,
    store,
    goal,
    workflowIds,
    permissions,
    rejectTaskWrite,
    failedWrites;
  const body = () =>
    f.db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
      .description;
  const usage = async () =>
    (await f.host.getGoalStatus(f.event, { id: goal.id })).usage;
  const list = () => f.host.listGoalSuggestions(f.event, { goalId: goal.id });
  async function attest() {
    f.setActor(f.identities.owner);
    const policy = { orgId: "org1", permissions, workflowIds };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
    f.setActor(f.identities.requester);
  }
  async function prepare(create = false, extra = {}) {
    const actionType = create ? "task.create" : "task.update-description";
    const entry = (await list()).suggestions.find(
      (item) => item.suggestion.actionType === actionType,
    );
    expect(entry).toBeTruthy();
    return f.host.prepareGoalAction(f.event, {
      goalId: goal.id,
      suggestionId: entry.suggestion.id,
      expectedRevision: goal.revision,
      requestId: `prepare-${create}`,
      description: "Human-reviewed goal follow-up",
      ...(create ? { taskType: "query_info" } : {}),
      ...extra,
    });
  }
  const submit = (prepared, create = false) =>
    f.host.submitGoalAction(f.event, {
      intentId: prepared.intent.id,
      workflowId: workflowIds[create ? 1 : 0],
    });
  async function approve(proposal) {
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
    f.setActor(f.identities.requester);
  }
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-goal-workflow-"));
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
    rejectTaskWrite = false;
    failedWrites = 0;
    f.db.function("test_goal_write_guard", () => {
      if (rejectTaskWrite) {
        failedWrites++;
        throw new Error("test goal action transaction failure");
      }
      return 1;
    });
    // Install before capturing source schema fences, then arm only the rollback test.
    f.db.exec(
      "CREATE TRIGGER test_goal_task_write_failure AFTER UPDATE OF description ON project_tasks BEGIN SELECT test_goal_write_guard(); END;",
    );
    for (const grant of permissions)
      grant.permissions.push(
        "goal.read",
        "goal.create",
        "goal.update",
        "goal.check",
        "goal.propose",
        "risk.read",
        "risk.evaluate",
      );
    await attest();
    f.db.prepare("UPDATE project_tasks SET due_date=1 WHERE id='t1'").run();
    ({ goal } = await f.host.createGoal(f.event, {
      projectId: "p1",
      requestId: "goal",
      objective: "Human-reviewed overdue task follow-up",
      budgetPolicy: { maxRuns: 4 },
    }));
    ({ goal } = await f.host.reviseGoal(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "enable-actions",
      patch: { allowedActionTypes: ["task.create", "task.update-description"] },
    }));
    expect(
      (
        await f.host.checkGoalNow(f.event, {
          id: goal.id,
          expectedRevision: goal.revision,
          requestId: "risk-check",
        })
      ).status,
    ).toBe("succeeded");
    expect(
      (await list()).suggestions
        .map((entry) => entry.suggestion.actionType)
        .sort(),
    ).toEqual(["task.create", "task.update-description"]);
    dialog.mockClear();
  });
  afterEach(async () => {
    await f?.host.close();
    engine = null;
    store = null;
    f?.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it.each([false, true])(
    "requires two distinct reviewers then native requester confirmation for goal actions (create=%s)",
    async (create) => {
      const prepared = await prepare(create);
      expect(prepared.preview.request.input.goalIntent.goalId).toBe(goal.id);
      expect(prepared.intent.actorDid).toBe(f.identities.requester);
      expect(body()).toBe("Original task");
      expect(dialog).not.toHaveBeenCalled();
      const submitted = await submit(prepared, create);
      await approve(submitted.proposal);
      const saved = await f.host.executeProposal(f.event, {
        proposalId: submitted.proposal.proposalId,
      });
      expect(saved.run.status).toBe("succeeded");
      expect(dialog).toHaveBeenCalledTimes(3);
      for (const call of dialog.mock.calls) {
        expect(call[0]).toBe(f.parent);
        expect(call[1]).toMatchObject({
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        expect(call[1].detail).toContain(goal.id);
      }
      const result = await f.host.getGoalAction(f.event, {
        intentId: prepared.intent.id,
      });
      expect(result.receipt.run.id).toBe(saved.run.id);
      expect((await usage()).totalRuns).toBe(2);
      if (create)
        expect(
          f.db
            .prepare(
              "SELECT count(*) AS n FROM project_tasks WHERE description=?",
            )
            .get("Human-reviewed goal follow-up").n,
        ).toBe(1);
      else expect(body()).toBe("Human-reviewed goal follow-up");
      expect(
        (
          await f.host.executeProposal(f.event, {
            proposalId: submitted.proposal.proposalId,
          })
        ).replayed,
      ).toBe(true);
      expect(dialog).toHaveBeenCalledTimes(3);
      expect((await usage()).totalRuns).toBe(2);
    },
  );
  it("replays original prepare/submit requests after lost replies without duplicate approvals", async () => {
    let prepared, submitted;
    await expect(
      (async () => {
        prepared = await prepare();
        throw new Error("prepare IPC response lost");
      })(),
    ).rejects.toThrow("prepare IPC response lost");
    expect((await prepare()).intent.id).toBe(prepared.intent.id);
    await expect(
      (async () => {
        submitted = await submit(prepared);
        throw new Error("submit IPC response lost");
      })(),
    ).rejects.toThrow("submit IPC response lost");
    expect((await submit(prepared)).proposal.proposalId).toBe(
      submitted.proposal.proposalId,
    );
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_action_approvals")
        .get().n,
    ).toBe(1);
    expect(dialog).not.toHaveBeenCalled();
    expect((await usage()).totalRuns).toBe(1);
  });
  it("rejects cross-goal suggestion substitution and unknown renderer authority fields", async () => {
    const { goal: other } = await f.host.createGoal(f.event, {
      projectId: "p1",
      requestId: "other",
      objective: "Another goal",
    });
    dialog.mockClear();
    await expect(prepare(false, { goalId: other.id })).rejects.toThrow();
    await expect(
      prepare(false, { actorDid: f.identities.owner }),
    ).rejects.toThrow();
    expect(dialog).not.toHaveBeenCalled();
    expect((await usage()).totalRuns).toBe(1);
  });
  it("does not let another member replace the prepared requester's shared intent", async () => {
    const prepared = await prepare();
    f.setActor(f.identities.owner);
    await expect(
      prepare(false, { requestId: "other-member" }),
    ).rejects.toThrow();
    f.setActor(f.identities.requester);
    expect(
      (await f.host.getGoalAction(f.event, { intentId: prepared.intent.id }))
        .intent.actorDid,
    ).toBe(f.identities.requester);
  });
  it.each(["paused", "source", "policy"])(
    "refuses stale goal execution after %s changes",
    async (change) => {
      const submitted = await submit(await prepare());
      await approve(submitted.proposal);
      dialog.mockClear();
      if (change === "paused")
        await f.host.reviseGoal(f.event, {
          id: goal.id,
          expectedRevision: goal.revision,
          requestId: "pause",
          patch: { status: "paused" },
        });
      if (change === "source")
        f.db.prepare("UPDATE project_tasks SET due_date=2 WHERE id='t1'").run();
      if (change === "policy") await attest();
      dialog.mockClear();
      await expect(
        Promise.resolve().then(() =>
          f.host.executeProposal(f.event, {
            proposalId: submitted.proposal.proposalId,
          }),
        ),
      ).rejects.toThrow();
      expect(body()).toBe("Original task");
      expect(dialog).not.toHaveBeenCalled();
      expect(
        f.db
          .prepare(
            "SELECT consumed_run_id FROM cc_organization_action_approvals WHERE request_id=?",
          )
          .get(submitted.proposal.approvalId).consumed_run_id,
      ).toBeNull();
    },
  );
  it("rejects same-DID reauthentication during final native confirmation", async () => {
    const submitted = await submit(await prepare());
    await approve(submitted.proposal);
    dialog.mockImplementationOnce(async () => {
      f.setActor(f.identities.requester);
      return { response: 1 };
    });
    await expect(
      f.host.executeProposal(f.event, {
        proposalId: submitted.proposal.proposalId,
      }),
    ).rejects.toThrow();
    expect(body()).toBe("Original task");
    expect(
      f.db
        .prepare(
          "SELECT consumed_run_id FROM cc_organization_action_approvals WHERE request_id=?",
        )
        .get(submitted.proposal.approvalId).consumed_run_id,
    ).toBeNull();
  });
  it("rechecks the goal revision when it is changed during final native confirmation", async () => {
    const submitted = await submit(await prepare());
    await approve(submitted.proposal);
    dialog.mockImplementationOnce(async () => {
      await f.host.reviseGoal(f.event, {
        id: goal.id,
        expectedRevision: goal.revision,
        requestId: "dialog-revision",
        patch: { objective: "A revised team objective" },
      });
      return { response: 1 };
    });
    const result = await f.host
      .executeProposal(f.event, { proposalId: submitted.proposal.proposalId })
      .catch(() => null);
    expect(result?.run?.status).not.toBe("succeeded");
    expect(body()).toBe("Original task");
    expect(
      f.db
        .prepare(
          "SELECT consumed_run_id FROM cc_organization_action_approvals WHERE request_id=?",
        )
        .get(submitted.proposal.approvalId).consumed_run_id,
    ).toBeNull();
  });
  it("shares checks and the action admission budget across authorized members", async () => {
    await prepare();
    expect((await usage()).totalRuns).toBe(1);
    for (const actor of [
      f.identities.owner,
      f.identities.first,
      f.identities.second,
    ]) {
      f.setActor(actor);
      expect(
        (
          await f.host.checkGoalNow(f.event, {
            id: goal.id,
            expectedRevision: goal.revision,
            requestId: `budget-${actor}`,
          })
        ).status,
      ).toBe("succeeded");
    }
    expect((await usage()).totalRuns).toBe(4);
    f.setActor(f.identities.requester);
    dialog.mockClear();
    await expect(prepare(true)).rejects.toThrow(/BUDGET/);
    expect(dialog).not.toHaveBeenCalled();
    expect(body()).toBe("Original task");
  });
  it("keeps generic organization proposals independent from goal budget accounting", async () => {
    const preview = f.host.previewDescription(f.event, {
      taskId: "t1",
      description: "Independent organization work",
      idempotencyKey: "generic",
    });
    const proposal = f.host.submitProposal(f.event, {
      projectId: "p1",
      workflowId: workflowIds[0],
      request: preview.request,
    });
    await approve(proposal);
    expect(
      (
        await f.host.executeProposal(f.event, {
          proposalId: proposal.proposalId,
        })
      ).run.status,
    ).toBe("succeeded");
    expect(body()).toBe("Independent organization work");
    expect((await usage()).totalRuns).toBe(1);
  });
  it("rejects goal proposals without explicit goal.propose permission", async () => {
    permissions.find(
      (grant) => grant.actorDid === f.identities.requester,
    ).permissions = permissions
      .find((grant) => grant.actorDid === f.identities.requester)
      .permissions.filter((permission) => permission !== "goal.propose");
    await attest();
    dialog.mockClear();
    await expect(prepare()).rejects.toThrow();
    expect(dialog).not.toHaveBeenCalled();
    expect(body()).toBe("Original task");
  });
  it("requires goal and risk read permission from each goal-action reviewer", async () => {
    permissions.find(
      (grant) => grant.actorDid === f.identities.first,
    ).permissions = permissions
      .find((grant) => grant.actorDid === f.identities.first)
      .permissions.filter((permission) => permission !== "risk.read");
    await attest();
    await f.host.checkGoalNow(f.event, {
      id: goal.id,
      expectedRevision: goal.revision,
      requestId: "current-policy-check",
    });
    const prepared = await prepare();
    dialog.mockClear();
    await expect(
      Promise.resolve().then(() => submit(prepared)),
    ).rejects.toThrow("ORG_AUTH_NOT_FOUND_OR_DENIED");
    expect(dialog).not.toHaveBeenCalled();
    expect(body()).toBe("Original task");
  });
  it("cancels an unexecuted goal proposal without charging an action run", async () => {
    const prepared = await prepare(),
      submitted = await submit(prepared);
    expect((await usage()).totalRuns).toBe(1);
    await f.host.cancelProposal(f.event, {
      proposalId: submitted.proposal.proposalId,
    });
    expect((await usage()).totalRuns).toBe(1);
    expect(body()).toBe("Original task");
    expect(
      (await f.host.getGoalAction(f.event, { intentId: prepared.intent.id }))
        .receipt?.run?.status,
    ).not.toBe("succeeded");
  });
  it("records cancelled final native confirmation without a task write or charged action", async () => {
    const prepared = await prepare(),
      submitted = await submit(prepared);
    await approve(submitted.proposal);
    dialog.mockResolvedValueOnce({ response: 0 });
    const result = await f.host.executeProposal(f.event, {
      proposalId: submitted.proposal.proposalId,
    });
    expect(result.run.status).toBe("cancelled");
    expect(body()).toBe("Original task");
    expect((await usage()).totalRuns).toBe(1);
    expect(
      (await f.host.getGoalAction(f.event, { intentId: prepared.intent.id }))
        .receipt.run.status,
    ).toBe("cancelled");
    expect(
      f.db
        .prepare(
          "SELECT consumed_run_id FROM cc_organization_action_approvals WHERE request_id=?",
        )
        .get(submitted.proposal.approvalId).consumed_run_id,
    ).toBeNull();
  });
  it("cannot launder a modified goal intent through generic proposal submission", async () => {
    const prepared = await prepare();
    const request = structuredClone(prepared.preview.request);
    request.input.goalIntent.goalId = "another-goal";
    await expect(
      Promise.resolve().then(() =>
        f.host.submitProposal(f.event, {
          projectId: "p1",
          workflowId: workflowIds[0],
          request,
        }),
      ),
    ).rejects.toThrow();
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_action_approvals")
        .get().n,
    ).toBe(0);
    expect(body()).toBe("Original task");
  });
  it("rejects a recomputed request that strips the goal intent but reuses its prepared nonce", async () => {
    const prepared = await prepare();
    const source = prepared.preview.request;
    const input = structuredClone(source.input);
    delete input.goalIntent;
    const request = createBusinessActionRequest({
      actionType: source.actionType,
      actionVersion: source.actionVersion,
      target: source.target,
      expectedVersion: source.expectedVersion,
      input,
      idempotencyKey: source.idempotencyKey,
    });
    await expect(
      Promise.resolve().then(() =>
        f.host.submitProposal(f.event, {
          projectId: "p1",
          workflowId: workflowIds[0],
          request,
        }),
      ),
    ).rejects.toThrow();
    expect(
      f.db
        .prepare("SELECT count(*) AS n FROM cc_organization_action_approvals")
        .get().n,
    ).toBe(0);
    expect(body()).toBe("Original task");
  });
  it("rolls back task mutation and approval consumption when native SQLite rejects the write", async () => {
    const prepared = await prepare(),
      submitted = await submit(prepared);
    await approve(submitted.proposal);
    rejectTaskWrite = true;
    const result = await f.host
      .executeProposal(f.event, { proposalId: submitted.proposal.proposalId })
      .catch(() => null);
    expect(result?.run?.status).not.toBe("succeeded");
    expect(failedWrites).toBe(1);
    expect(dialog).toHaveBeenCalledTimes(3);
    expect(body()).toBe("Original task");
    expect(
      f.db
        .prepare(
          "SELECT consumed_run_id FROM cc_organization_action_approvals WHERE request_id=?",
        )
        .get(submitted.proposal.approvalId).consumed_run_id,
    ).toBeNull();
    const readback = await f.host.getGoalAction(f.event, {
      intentId: prepared.intent.id,
    });
    expect(readback.receipt?.run?.status).not.toBe("succeeded");
  });
});
