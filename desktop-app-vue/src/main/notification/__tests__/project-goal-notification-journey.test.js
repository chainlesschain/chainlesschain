import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  openSchedulerStore,
} = require("@chainlesschain/session-core/scheduler-store");
const {
  ProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/project-goal-monitoring");
const { registerNotificationIPC } = require("../notification-ipc.js");
const owner = "did:chainless:notice-owner";
const instant = Date.parse("2026-10-07T01:00:00Z");

describe("real monitor to persistent notification to default IPC source recheck", () => {
  let directory,
    db,
    engine,
    actor,
    now,
    generation,
    handlers,
    event,
    electron,
    show;
  function open() {
    db = new Database(join(directory, "project.db"));
    const store = openSchedulerStore({
      file: join(directory, "scheduler.db"),
      Database,
      protectStorage: () => true,
      clock: () => now,
    });
    engine = new ProjectGoalMonitoringEngine({
      db,
      store,
      getActor: () => actor,
      clock: () => now,
      leaseMs: 60_000,
    });
    handlers = new Map();
    const window = { isDestroyed: () => false };
    event = {
      sender: { isDestroyed: () => false },
      senderFrame: { url: "app://renderer/index.html", parent: null },
    };
    show = vi.fn();
    electron = {
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      BrowserWindow: { fromWebContents: () => window },
      Notification: class {
        static isSupported() {
          return true;
        }
        show() {
          show();
        }
      },
    };
    registerNotificationIPC({
      database: { getDatabase: () => db },
      electron,
      getActor: () => actor,
      getAuthGeneration: () => generation,
      validateSender: () => ({ trusted: true }),
      // Deliberately use the production, default source projection service.
    });
  }
  const call = (name, ...args) =>
    handlers.get(`notification:${name}`)(event, ...args);
  const rows = () =>
    db.prepare("SELECT * FROM notifications ORDER BY id").all();
  const count = (table) =>
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  const goal = (
    notificationPolicy = { channel: "in-app", mode: "changes-only" },
  ) =>
    engine.state.goals.create({
      projectId: "p1",
      objective: "PRIVATE GOAL OBJECTIVE",
      notificationPolicy,
    });
  const check = (g, requestId = "manual-a") =>
    engine.checkNow({ id: g.id, expectedRevision: g.revision, requestId });
  async function reopen() {
    await engine.close();
    db.close();
    open();
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-notice-journey-"));
    actor = owner;
    now = instant;
    generation = 1;
    open();
    db.exec(`
      CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT,org_id TEXT,workspace_id TEXT);
      CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT);
      CREATE TABLE workspace_resources(workspace_id TEXT,resource_type TEXT,resource_id TEXT);
    `);
    db.prepare("INSERT INTO projects VALUES ('p1',?,'active',?,0)").run(
      owner,
      now,
    );
    db.prepare(
      "INSERT INTO project_tasks VALUES ('t1','p1','pending',?,0,?,NULL,NULL,NULL)",
    ).run(now, now - 1);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await engine?.close();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("commits check and projection together; retry/reopen preserve one occurrence and read state", async () => {
    const g = goal();
    expect((await check(g)).status).toBe("succeeded");
    const listed = await call("get-goals");
    expect(listed.success).toBe(true);
    expect(listed.notifications.length).toBeGreaterThan(0);
    expect(JSON.stringify(listed)).not.toContain("PRIVATE GOAL OBJECTIVE");
    const notice = listed.notifications[0];
    expect(await call("open-goal", notice.id)).toMatchObject({
      success: true,
      target: { goalId: g.id, projectId: "p1", storeId: g.storeId },
    });
    await call("mark-read", notice.id);
    const before = rows().length;
    await check(g);
    expect(rows()).toHaveLength(before);
    expect(count("cc_project_goal_checks")).toBe(1);
    await reopen();
    const listedAgain = await call("get-goals");
    expect(
      listedAgain.notifications.find((item) => item.id === notice.id).is_read,
    ).toBe(1);
    expect(show).not.toHaveBeenCalled();
  });
  it("unchanged risk updates last checked source without making the existing notice unread", async () => {
    const g = goal();
    await check(g);
    const first = rows().find((row) => {
      const event = engine.state.notifications.open({ id: row.id }).event;
      return event.kind === "risk-added";
    });
    const prior = JSON.parse(first.data).sourceVersion;
    await call("mark-read", first.id);
    now++;
    await check(g, "manual-b");
    const current = (await call("get-goals")).notifications.find(
      (item) => item.id === first.id,
    );
    expect(current.is_read).toBe(1);
    expect(JSON.parse(current.data).sourceVersion).not.toBe(prior);
    expect(count("cc_project_goal_checks")).toBe(2);
    expect(
      rows().filter(
        (row) =>
          engine.state.notifications.open({ id: row.id }).event.kind ===
          "risk-added",
      ),
    ).toHaveLength(1);
  });
  it("quiet delivery survives reopen and the background tick flushes without rechecking", async () => {
    const g = goal({
      channel: "in-app",
      mode: "changes-only",
      quietHours: { timeZone: "UTC", startMinute: 0, endMinute: 120 },
    });
    await check(g);
    expect(rows()).toEqual([]);
    await reopen();
    now = Date.parse("2026-10-07T02:00:00Z");
    await engine.tick();
    expect((await call("get-goals")).notifications.length).toBeGreaterThan(0);
    expect(count("cc_project_goal_checks")).toBe(1);
    expect(show).not.toHaveBeenCalled();
  });
  it("silent policy records checks but has no in-app or OS delivery", async () => {
    await check(goal({ channel: "in-app", mode: "silent" }));
    await engine.tick();
    expect(count("cc_project_goal_checks")).toBe(1);
    expect(rows()).toEqual([]);
    expect((await call("get-goals")).notifications).toEqual([]);
    expect(show).not.toHaveBeenCalled();
  });
  it("rolls check, usage and notification back on a failed projection insert", async () => {
    const g = goal();
    db.exec(
      "CREATE TRIGGER fail_notice BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'projection failure'); END;",
    );
    expect((await check(g)).status).toBe("dead_letter");
    expect(count("cc_project_goal_checks")).toBe(0);
    expect(count("cc_project_risk_reviews")).toBe(0);
    expect(count("cc_project_goal_notice_events")).toBe(0);
    expect(engine.status({ id: g.id }).usage.checks).toBe(0);
    expect(rows()).toEqual([]);
  });
  it.each(["owner", "task", "digest", "actor"])(
    "rechecks current %s before list/open/read/count and never uses the old reference as authority",
    async (change) => {
      const g = goal();
      await check(g);
      const notice = rows()[0];
      if (change === "owner")
        db.prepare("UPDATE projects SET user_id=?").run("did:other");
      if (change === "task")
        db.exec("UPDATE project_tasks SET org_id='org-other'");
      if (change === "digest")
        db.exec("UPDATE cc_project_risk_reviews SET content_digest='corrupt'");
      if (change === "actor") {
        actor = "did:other";
        generation++;
      }
      expect((await call("get-goals")).notifications).toEqual([]);
      expect((await call("get-all")).notifications).toEqual([]);
      expect((await call("get-unread-count")).count).toBe(0);
      expect((await call("open-goal", notice.id)).success).toBe(false);
      await expect(call("mark-read", notice.id)).rejects.toMatchObject({
        code: "NOTIFICATION_NOT_FOUND_OR_DENIED",
      });
      expect(
        db
          .prepare("SELECT is_read FROM notifications WHERE id=?")
          .get(notice.id).is_read,
      ).toBe(0);
    },
  );
  it("does not replay a pending quiet notification after Goal control changes", async () => {
    const g = goal({
      channel: "in-app",
      mode: "changes-only",
      quietHours: { timeZone: "UTC", startMinute: 0, endMinute: 120 },
    });
    await check(g);
    engine.stop({ id: g.id, expectedRevision: g.revision });
    now = Date.parse("2026-10-07T02:00:00Z");
    await reopen();
    await engine.tick();
    expect(rows()).toEqual([]);
    expect(count("cc_project_goal_checks")).toBe(1);
  });
  it("Goal-only pagination skips ordinary notification rows and denied projections", async () => {
    await check(goal());
    const expected = rows().length;
    const insert = db.prepare(
      "INSERT INTO notifications VALUES(?,?,'system','Normal','Normal',NULL,0,?)",
    );
    db.transaction(() => {
      for (let i = 0; i < 130; i++) insert.run(`normal-${i}`, owner, now + 100);
    }).immediate();
    expect((await call("get-goals", { limit: 50 })).notifications).toHaveLength(
      expected,
    );
    expect(
      (await call("get-goals", { limit: 1, offset: 1 })).notifications,
    ).toHaveLength(expected > 1 ? 1 : 0);
  });
  it("reports a damaged pending notice without stopping another Goal's due check", async () => {
    const quiet = goal({
      channel: "in-app",
      mode: "changes-only",
      quietHours: { timeZone: "UTC", startMinute: 0, endMinute: 120 },
    });
    await check(quiet);
    db.exec("UPDATE cc_project_risk_reviews SET content_digest='corrupt'");
    const other = goal();
    engine.start({
      id: other.id,
      expectedRevision: other.revision,
      intervalMs: 60_000,
    });
    now = Date.parse("2026-10-07T02:00:00Z");
    const outcome = await engine.tick();
    expect(outcome.incidents).toHaveLength(1);
    expect(outcome.incidents[0].code).toMatch(/PROJECT_RISK|GOAL_NOTICE/);
    expect(engine.status({ id: other.id }).usage.checks).toBe(1);
    expect((await call("get-goals")).notifications.length).toBeGreaterThan(0);
  });
});
