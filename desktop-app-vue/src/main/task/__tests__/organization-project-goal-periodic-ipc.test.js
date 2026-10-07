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

describe("organization periodic goal native IPC consent", () => {
  let f,
    dialog,
    directory,
    engine,
    store,
    controller,
    goal,
    database,
    generation,
    openingHook,
    permissions,
    workflowIds;
  const startInput = (extra = {}) => ({
    id: goal.id,
    expectedRevision: goal.revision,
    requestId: "start-1",
    intervalMs: 60_000,
    expiresAt: f.getNow() + 3600_000,
    ...extra,
  });
  const start = (extra) =>
    f.host.startGoalMonitoring(f.event, startInput(extra));
  const stopInput = (monitor, extra = {}) => ({
    id: goal.id,
    monitorId: monitor.id,
    requestId: "stop-1",
    mode: "periodic",
    ...extra,
  });
  const status = () => f.host.getGoalStatus(f.event, { id: goal.id });
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
    directory = mkdtempSync(join(tmpdir(), "cc-org-periodic-ipc-"));
    generation = 1;
    openingHook = null;
    dialog = vi.fn(async () => ({ response: 1 }));
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
            getAuthenticationGeneration: () => generation,
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
    ({ permissions, workflowIds } = await f.setup());
    for (const grant of permissions)
      grant.permissions.push(
        "goal.read",
        "goal.create",
        "goal.update",
        "goal.check",
        "goal.monitor",
        "risk.read",
        "risk.evaluate",
      );
    await attest();
    ({ goal } = await f.host.createGoal(f.event, {
      projectId: "p1",
      requestId: "create",
      objective: "Track overdue project tasks",
      budgetPolicy: { maxRuns: 20 },
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
  it("binds consent to the enabling member and replays lost start/stop replies without another dialog", async () => {
    f.setActor(f.identities.first);
    const request = startInput();
    const saved = await f.host.startGoalMonitoring(f.event, request);
    expect(saved.monitor).toMatchObject({
      executorDid: f.identities.first,
      enabled: true,
      intervalMs: 60_000,
      goalRevision: 1,
    });
    expect(goal.ownerRef).toBe(f.identities.requester);
    expect(await f.host.startGoalMonitoring(f.event, request)).toEqual({
      ...saved,
      replayed: true,
    });
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0][0]).toBe(f.parent);
    expect(dialog.mock.calls[0][1]).toMatchObject({
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    expect(dialog.mock.calls[0][1].detail).toContain(f.identities.first);
    f.setActor(f.identities.requester);
    const stop = stopInput(saved.monitor);
    const stopped = await f.host.stopGoalMonitoring(f.event, stop);
    expect(stopped.monitor.enabled).toBe(false);
    expect(await f.host.stopGoalMonitoring(f.event, stop)).toEqual({
      ...stopped,
      replayed: true,
    });
    expect(dialog).toHaveBeenCalledTimes(2);
  });
  it("cancels native start and stop without changing consent", async () => {
    dialog.mockResolvedValueOnce({ response: 0 });
    expect(await start()).toEqual({ status: "cancelled" });
    expect((await status()).monitor).toBeNull();
    const { monitor } = await start();
    dialog.mockResolvedValueOnce({ response: 0 });
    expect(
      await f.host.stopGoalMonitoring(f.event, stopInput(monitor)),
    ).toEqual({ status: "cancelled" });
    expect((await status()).monitor.enabled).toBe(true);
  });
  it.each([
    { intervalMs: 1 },
    { expiresAt: 0 },
    { expiresAt: 1000 + 86400_001 },
    { expectedRevision: 0 },
    { actorDid: "did:owner" },
    { file: "renderer.sqlite" },
    { expectedAuthority: {} },
  ])("rejects invalid start before native confirmation: %j", async (extra) => {
    await expect(start(extra)).rejects.toThrow();
    expect(dialog).not.toHaveBeenCalled();
  });
  it.each(["identity", "navigation", "database", "membership"])(
    "rejects start after %s changes during native confirmation",
    async (change) => {
      dialog.mockImplementationOnce(async () => {
        if (change === "identity") f.setActor(f.identities.requester);
        if (change === "navigation")
          f.event.sender.emit(
            "did-start-navigation",
            {},
            "http://localhost:5173/other",
            false,
            true,
          );
        if (change === "database") database = {};
        if (change === "membership")
          f.db
            .prepare(
              "UPDATE organization_members SET status='removed' WHERE member_did=?",
            )
            .run(f.identities.requester);
        return { response: 1 };
      });
      await expect(start()).rejects.toThrow(/ORG_AUTH_|GOAL_/);
      expect(
        f.db
          .prepare(
            "SELECT count(*) AS n FROM cc_organization_project_goal_monitor_consents",
          )
          .get().n,
      ).toBe(0);
    },
  );
  it("fences stale stop requests from a replacement monitor", async () => {
    const old = await start();
    f.setActor(f.identities.first);
    const replacement = await start({ requestId: "replace" });
    dialog.mockClear();
    await expect(
      f.host.stopGoalMonitoring(f.event, stopInput(old.monitor)),
    ).rejects.toThrow("GOAL_MONITOR_VERSION_CONFLICT");
    expect(dialog).not.toHaveBeenCalled();
    expect((await status()).monitor.id).toBe(replacement.monitor.id);
    expect((await status()).monitor.enabled).toBe(true);
  });
  it("allows an explicitly authorized stop after risk-evaluation permission is removed", async () => {
    const { monitor } = await start();
    permissions.find(
      (grant) => grant.actorDid === f.identities.requester,
    ).permissions = ["goal.read", "goal.monitor"];
    await attest();
    dialog.mockClear();
    expect(
      (await f.host.stopGoalMonitoring(f.event, stopInput(monitor))).monitor
        .enabled,
    ).toBe(false);
    expect(dialog).toHaveBeenCalledTimes(1);
  });
  it("checks only as the unlocked executor and allows legitimate task data changes", async () => {
    await start();
    await controller.initialize();
    f.setNow(61_000);
    f.setActor(f.identities.first);
    await engine.tick();
    expect((await status()).usage.checks).toBe(0);
    f.setActor(f.identities.requester);
    f.db
      .prepare(
        "UPDATE project_tasks SET description='Legitimate edit',due_date=1,updated_at=60000 WHERE id='t1'",
      )
      .run();
    f.db.prepare("UPDATE projects SET updated_at=60000 WHERE id='p1'").run();
    await engine.tick();
    expect((await status()).usage.checks).toBe(1);
    expect((await status()).monitor.enabled).toBe(true);
    expect(dialog).toHaveBeenCalledTimes(1);
  });
  it("rechecks authentication after asynchronous native controller initialization", async () => {
    openingHook = () => f.setActor(f.identities.requester);
    await expect(start()).rejects.toThrow("ORG_AUTH_IDENTITY_CHANGED");
    expect(dialog).not.toHaveBeenCalled();
  });
  it("rejects invalid stop mode before native confirmation and fences stop-time reauthentication", async () => {
    const { monitor } = await start();
    dialog.mockClear();
    await expect(
      f.host.stopGoalMonitoring(
        f.event,
        stopInput(monitor, { mode: "kill-all" }),
      ),
    ).rejects.toThrow();
    expect(dialog).not.toHaveBeenCalled();
    dialog.mockImplementationOnce(async () => {
      f.setActor(f.identities.requester);
      return { response: 1 };
    });
    await expect(
      f.host.stopGoalMonitoring(f.event, stopInput(monitor)),
    ).rejects.toThrow("ORG_AUTH_IDENTITY_CHANGED");
    expect((await status()).monitor.enabled).toBe(true);
  });
  it("stops periodic work without cancelling subsequent explicit manual checks", async () => {
    const { monitor } = await start();
    expect(
      (
        await f.host.stopGoalMonitoring(
          f.event,
          stopInput(monitor, { mode: "abort" }),
        )
      ).monitor.enabled,
    ).toBe(false);
    expect(
      (
        await f.host.checkGoalNow(f.event, {
          id: goal.id,
          expectedRevision: 1,
          requestId: "manual-after-abort",
        })
      ).status,
    ).toBe("succeeded");
    f.setNow(61_000);
    await engine.tick();
    expect((await status()).usage.checks).toBe(1);
    expect((await status()).monitor.enabled).toBe(false);
  });
  it("does not silently reactivate consent after a goal revision changes and is restored", async () => {
    await start();
    await f.host.reviseGoal(f.event, {
      id: goal.id,
      expectedRevision: 1,
      requestId: "pause",
      patch: { status: "paused" },
    });
    await f.host.reviseGoal(f.event, {
      id: goal.id,
      expectedRevision: 2,
      requestId: "resume",
      patch: { status: "active" },
    });
    f.setNow(61_000);
    await engine.tick();
    expect((await status()).usage.checks).toBe(0);
    expect((await status()).monitor.enabled).toBe(false);
    f.setNow(121_000);
    await engine.tick();
    expect((await status()).usage.checks).toBe(0);
  });
  it("rejects a stale start confirmation when another native confirmation installed a monitor", async () => {
    let replacement;
    dialog.mockImplementationOnce(async () => {
      replacement = await start({ requestId: "racing-start" });
      return { response: 1 };
    });
    await expect(start()).rejects.toThrow("GOAL_MONITOR_VERSION_CONFLICT");
    expect((await status()).monitor.id).toBe(replacement.monitor.id);
    expect(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM cc_organization_project_goal_monitor_consents",
        )
        .get().n,
    ).toBe(1);
  });
  it("pins authentication generation across a native periodic check transaction", async () => {
    await start();
    f.db.function("periodic_reauthenticate", () => {
      generation++;
      return 1;
    });
    f.db.exec(
      "CREATE TRIGGER test_periodic_reauthenticate BEFORE INSERT ON cc_organization_project_goal_checks BEGIN SELECT periodic_reauthenticate(); END;",
    );
    f.setNow(61_000);
    await engine.tick().catch(() => {});
    expect((await status()).usage.checks).toBe(0);
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
  });
  it("expires consent without changing the goal or preventing explicit manual checks", async () => {
    await start({ expiresAt: 61_000 });
    f.setNow(61_000);
    await engine.tick();
    expect((await status()).monitor.enabled).toBe(false);
    expect((await status()).usage.checks).toBe(0);
    expect(
      (
        await f.host.checkGoalNow(f.event, {
          id: goal.id,
          expectedRevision: 1,
          requestId: "manual-after-expiry",
        })
      ).status,
    ).toBe("succeeded");
    expect(f.host.getGoal(f.event, { id: goal.id }).status).toBe("active");
  });
});
