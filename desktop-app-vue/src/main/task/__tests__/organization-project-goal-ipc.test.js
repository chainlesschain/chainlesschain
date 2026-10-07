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

describe("organization goal IPC with native SQLite and independent scheduler", () => {
  let f, dialog, directory, engine, store, controller, database, openingHook;
  const reader = "did:goal-reader";
  const input = (extra = {}) => ({
    projectId: "p1",
    requestId: "create-1",
    objective: "Review project risk",
    budgetPolicy: { maxRuns: 2 },
    ...extra,
  });
  const create = (extra) => f.host.createGoal(f.event, input(extra));
  const count = () =>
    f.db
      .prepare("SELECT count(*) AS n FROM cc_organization_project_goals")
      .get().n;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "cc-org-goal-ipc-"));
    dialog = vi.fn(async () => ({ response: 1 }));
    openingHook = null;
    controller = {
      initialize: vi.fn(async () => {
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
        if (openingHook) await openingHook();
        return engine;
      }),
      close: async () => {
        await engine?.close();
        store?.close();
      },
    };
    f = organizationProjectFixture(dialog, {
      database: { getDatabase: () => database },
      goalMonitoringController: controller,
    });
    database = f.db;
    const { permissions, workflowIds } = await f.setup();
    for (const grant of permissions)
      grant.permissions.push(
        "goal.read",
        "goal.create",
        "goal.update",
        "goal.check",
        "risk.read",
        "risk.evaluate",
      );
    f.db
      .prepare(
        "INSERT INTO organization_members VALUES('goal-reader','org1',?,'member','active','Reader')",
      )
      .run(reader);
    permissions.push({
      actorDid: reader,
      projectId: "p1",
      permissions: ["goal.read"],
      expiresAt: 100000000,
    });
    const policy = { orgId: "org1", permissions, workflowIds };
    await f.host.attestPolicy(f.event, {
      ...policy,
      expectedDigest: f.host.previewPolicy(f.event, policy).digest,
    });
    f.setActor(f.identities.requester);
    dialog.mockClear();
  });
  afterEach(async () => {
    await f?.host.close();
    engine = null;
    store = null;
    f?.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it("shows the actual title and every changed definition field before writing", async () => {
    const created = await create({ title: "Initial organization title" });
    expect(dialog.mock.calls[0][1].detail).toContain(
      "Initial organization title",
    );
    await f.host.reviseGoal(f.event, {
      id: created.goal.id,
      expectedRevision: 1,
      requestId: "revise-title",
      patch: { title: "Revised organization title" },
    });
    const detail = dialog.mock.calls[1][1].detail;
    expect(detail).toContain("Initial organization title");
    expect(detail).toContain("Revised organization title");
    expect(f.host.getGoal(f.event, { id: created.goal.id }).title).toBe(
      "Revised organization title",
    );
  });

  it("confirms once and replays original create/revise requests after lost replies", async () => {
    let saved;
    await expect(
      (async () => {
        saved = await create();
        throw new Error("IPC response lost");
      })(),
    ).rejects.toThrow("IPC response lost");
    expect(await create()).toEqual({ ...saved, replayed: true });
    expect(count()).toBe(1);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0][0]).toBe(f.parent);
    expect(dialog.mock.calls[0][1]).toMatchObject({
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    expect(dialog.mock.calls[0][1].detail).toContain("Review project risk");
    const revision = {
      id: saved.goal.id,
      expectedRevision: 1,
      requestId: "revise-1",
      patch: { objective: "New objective" },
    };
    const changed = await f.host.reviseGoal(f.event, revision);
    expect(changed.goal.revision).toBe(2);
    expect(await f.host.reviseGoal(f.event, revision)).toEqual({
      ...changed,
      replayed: true,
    });
    expect(dialog).toHaveBeenCalledTimes(2);
  });
  it("cancels native create and revise without persisting mutations", async () => {
    dialog.mockResolvedValueOnce({ response: 0 });
    expect(await create()).toEqual({ status: "cancelled" });
    expect(count()).toBe(0);
    const { goal } = await create();
    dialog.mockResolvedValueOnce({ response: 0 });
    expect(
      await f.host.reviseGoal(f.event, {
        id: goal.id,
        expectedRevision: 1,
        requestId: "cancel",
        patch: { status: "paused" },
      }),
    ).toEqual({ status: "cancelled" });
    expect(f.host.getGoal(f.event, { id: goal.id })).toEqual(goal);
  });
  it.each([
    { actorDid: "did:owner" },
    { expectedAuthority: {} },
    { objective: "" },
    { requestId: "" },
    { budgetPolicy: { maxRuns: -1 } },
  ])("validates create before native confirmation: %j", async (extra) => {
    await expect(create(extra)).rejects.toThrow();
    expect(dialog).not.toHaveBeenCalled();
    expect(count()).toBe(0);
  });
  it.each([
    { status: "completed" },
    { completion: { accepted: true } },
    { ownerRef: "did:owner" },
    { projectRef: {} },
    {},
  ])("validates revise before native confirmation: %j", async (patch) => {
    const { goal } = await create();
    dialog.mockClear();
    await expect(
      f.host.reviseGoal(f.event, {
        id: goal.id,
        expectedRevision: 1,
        requestId: "invalid-revise",
        patch,
      }),
    ).rejects.toThrow();
    expect(dialog).not.toHaveBeenCalled();
    expect(f.host.getGoal(f.event, { id: goal.id })).toEqual(goal);
  });
  it("rejects changed replay content and stale revisions before opening a dialog", async () => {
    const { goal } = await create();
    await f.host.reviseGoal(f.event, {
      id: goal.id,
      expectedRevision: 1,
      requestId: "revision",
      patch: { status: "paused" },
    });
    dialog.mockClear();
    await expect(create({ objective: "Different content" })).rejects.toThrow(
      "GOAL_REQUEST_CONFLICT",
    );
    await expect(
      f.host.reviseGoal(f.event, {
        id: goal.id,
        expectedRevision: 1,
        requestId: "stale",
        patch: { status: "abandoned" },
      }),
    ).rejects.toThrow("GOAL_REVISION_CONFLICT");
    expect(dialog).not.toHaveBeenCalled();
    expect(count()).toBe(1);
  });
  it("paginates shared metadata without duplicates and rejects invalid cursors", async () => {
    const ids = [];
    for (const requestId of ["page-a", "page-b", "page-c"])
      ids.push((await create({ requestId })).goal.id);
    f.setActor(reader);
    const first = f.host.listGoals(f.event, { projectId: "p1", limit: 2 });
    expect(first.goals).toHaveLength(2);
    const last = f.host.listGoals(f.event, {
      projectId: "p1",
      limit: 2,
      afterId: first.nextCursor,
    });
    expect(last.nextCursor).toBeNull();
    expect(
      [...first.goals, ...last.goals].map((goal) => goal.id).sort(),
    ).toEqual(ids.sort());
    expect(() =>
      f.host.listGoals(f.event, { projectId: "p1", afterId: "missing" }),
    ).toThrow("GOAL_INVALID_CURSOR");
  });
  it.each(["create", "revise"])(
    "rejects dialog-time session, frame, database, and membership changes for %s",
    async (operation) => {
      const { goal } = await create();
      for (const change of [
        () => f.setActor(f.identities.requester),
        () =>
          f.event.sender.emit(
            "did-start-navigation",
            {},
            "http://localhost:5173/other",
            false,
            true,
          ),
        () => {
          f.event.senderFrame = { ...f.event.senderFrame };
          f.event.sender.mainFrame = f.event.senderFrame;
        },
        () => {
          database = {};
        },
        () =>
          f.db
            .prepare(
              "UPDATE organization_members SET status='removed' WHERE member_did=?",
            )
            .run(f.identities.requester),
      ]) {
        dialog.mockImplementationOnce(async () => {
          change();
          return { response: 1 };
        });
        const attempt =
          operation === "create"
            ? create({ requestId: "second" })
            : f.host.reviseGoal(f.event, {
                id: goal.id,
                expectedRevision: 1,
                requestId: "revise",
                patch: { objective: "Changed" },
              });
        await expect(attempt).rejects.toThrow(/ORG_AUTH_|GOAL_/);
        database = f.db;
        expect(count()).toBe(1);
        expect(
          f.db
            .prepare("SELECT revision FROM cc_organization_project_goals")
            .get().revision,
        ).toBe(1);
      }
    },
  );
  it("shares goal metadata with goal-only readers while protecting task and risk access", async () => {
    const { goal } = await create();
    f.setActor(reader);
    expect(f.host.getGoal(f.event, { id: goal.id })).toEqual(goal);
    expect(f.host.listGoals(f.event, { projectId: "p1" }).goals).toEqual([
      goal,
    ]);
    expect(f.host.context(f.event, { projectId: "p1" })).toMatchObject({
      mode: "organization",
      permissions: ["goal.read"],
    });
    expect(await f.host.getGoalStatus(f.event, { id: goal.id })).toMatchObject({
      goal,
      manualOnly: false,
      monitor: null,
    });
    expect(() => f.host.readTask(f.event, { taskId: "t1" })).toThrow();
    expect(() => f.host.evaluateRisk(f.event, { projectId: "p1" })).toThrow();
    await expect(
      f.host.listGoalChecks(f.event, { id: goal.id }),
    ).rejects.toThrow();
    await expect(
      f.host.checkGoalNow(f.event, {
        id: goal.id,
        expectedRevision: 1,
        requestId: "denied",
      }),
    ).rejects.toThrow();
  });
  it("checks under each current member, shares budgets, and preserves creator attribution", async () => {
    const { goal } = await create();
    const check = (requestId) =>
      f.host.checkGoalNow(f.event, {
        id: goal.id,
        expectedRevision: 1,
        requestId,
      });
    const first = await check("first");
    expect(first.status).toBe("succeeded");
    expect((await check("first")).occurrenceId).toBe(first.occurrenceId);
    f.setActor(f.identities.first);
    expect((await check("second")).status).toBe("succeeded");
    expect(
      (await f.host.getGoalStatus(f.event, { id: goal.id })).usage.checks,
    ).toBe(2);
    await expect(check("over-budget")).rejects.toThrow(
      "GOAL_USAGE_BUDGET_EXHAUSTED",
    );
    expect(f.host.getGoal(f.event, { id: goal.id }).ownerRef).toBe(
      f.identities.requester,
    );
    expect(
      (await f.host.listGoalChecks(f.event, { id: goal.id })).checks.length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      await f.host.getGoalCheck(f.event, {
        id: goal.id,
        occurrenceId: first.occurrenceId,
      }),
    ).toBeTruthy();
    expect(
      f.db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toBe("Original task");
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(store.db).not.toBe(f.db);
  });
  it.each(["getGoalStatus", "listGoalChecks", "getGoalCheck", "checkGoalNow"])(
    "rejects same-DID reauthentication across awaited initialization: %s",
    async (method) => {
      const { goal } = await create();
      openingHook = () => f.setActor(f.identities.requester);
      const params = {
        id: goal.id,
        ...(method === "checkGoalNow"
          ? { expectedRevision: 1, requestId: "aba" }
          : method === "getGoalCheck"
            ? { occurrenceId: "missing" }
            : {}),
      };
      await expect(f.host[method](f.event, params)).rejects.toThrow(
        "ORG_AUTH_IDENTITY_CHANGED",
      );
      expect(
        f.db
          .prepare(
            "SELECT count(*) AS n FROM cc_organization_project_goal_checks",
          )
          .get().n,
      ).toBe(0);
    },
  );
  it("rolls back native risk/check writes when reauthentication occurs inside SQLite", async () => {
    const { goal } = await create();
    await controller.initialize();
    f.db.function("reauthenticate_goal_session", () => {
      f.setActor(f.identities.requester);
      return 1;
    });
    f.db.exec(
      "CREATE TRIGGER test_goal_check_reauthentication BEFORE INSERT ON cc_organization_project_goal_checks BEGIN SELECT reauthenticate_goal_session(); END;",
    );
    await expect(
      f.host.checkGoalNow(f.event, {
        id: goal.id,
        expectedRevision: 1,
        requestId: "native-aba",
      }),
    ).rejects.toThrow("ORG_AUTH_IDENTITY_CHANGED");
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_goal_checks",
        )
        .get().n,
    ).toBe(0);
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_risk_reviews",
        )
        .get().n,
    ).toBe(0);
    expect(
      (await f.host.getGoalStatus(f.event, { id: goal.id })).usage.checks,
    ).toBe(0);
  });
});
