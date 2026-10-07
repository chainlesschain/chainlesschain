import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  createProjectGoalMonitoringController,
} = require("../project-goal-monitoring-host.js");
const { createProjectGoalHost } = require("../project-goal-ipc.js");
const owner = "did:chainless:owner";

describe("desktop goal monitoring native storage and lifecycle owner", () => {
  let directory, db, actor, now, event, window, electron, controller, host;
  function createDb(file) {
    const native = new Database(file);
    native.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT);`);
    native
      .prepare("INSERT INTO projects VALUES (?,?,?,?,0)")
      .run("p1", owner, "active", now);
    return native;
  }
  function options() {
    return {
      database: { getDatabase: () => db },
      electron,
      getCurrentUserDid: () => actor,
      clock: () => now,
      // Injected for domain tests. Real ACL protection has a separate assertion.
      protectDirectory: vi.fn((path) => {
        mkdirSync(path, { recursive: true });
        return path;
      }),
      protectFile: vi.fn((path) => path),
    };
  }
  function goal() {
    return host.create(event, {
      projectId: "p1",
      objective: "Follow risk",
      budgetPolicy: { maxRuns: 5 },
    });
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-desktop-goal-host-"));
    now = Date.now();
    actor = owner;
    db = createDb(join(directory, "project.db"));
    window = { isDestroyed: vi.fn(() => false) };
    electron = {
      app: { getPath: vi.fn(() => join(directory, "app-data")) },
      BrowserWindow: { fromWebContents: vi.fn(() => window) },
    };
    event = {
      sender: {},
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    controller = createProjectGoalMonitoringController(options());
    host = createProjectGoalHost({
      database: { getDatabase: () => db },
      electron,
      getCurrentUserDid: () => actor,
      monitoringController: controller,
      clock: () => now,
    });
  });
  afterEach(async () => {
    await controller?.close();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it("derives an independent native scheduler path solely from trusted app/database state", async () => {
    const engine = await controller.initialize();
    expect(engine.store.file).not.toBe(db.name);
    expect(
      relative(
        join(directory, "app-data", "goal-monitoring"),
        engine.store.file,
      ),
    ).toMatch(/^[a-f0-9]{64}[\\/]scheduler\.sqlite$/);
    expect(engine.store.db.constructor).toBe(db.constructor);
    expect(existsSync(engine.store.file)).toBe(true);
    expect(electron.app.getPath).toHaveBeenCalledWith("userData");
    const g = goal();
    expect((await host.status(event, { id: g.id })).executionState).toBe(
      "idle",
    );
  });
  it("uses the authenticated session in both default metadata and background providers", async () => {
    const auth = require("../project-goal-auth-session.js");
    auth.configureProjectGoalAuth({
      getDid: () => actor,
      getUKeyManager: () => null,
    });
    await controller.close();
    const opts = options();
    delete opts.getCurrentUserDid;
    controller = createProjectGoalMonitoringController(opts);
    const defaults = createProjectGoalHost({
      database: { getDatabase: () => db },
      electron,
      monitoringController: controller,
      clock: () => now,
    });
    try {
      expect(() =>
        defaults.create(event, { projectId: "p1", objective: "X" }),
      ).toThrow("GOAL_IDENTITY_REQUIRED");
      auth.authenticateProjectGoalPassword(
        auth.beginProjectGoalAuthentication(),
      );
      const g = defaults.create(event, { projectId: "p1", objective: "X" });
      await defaults.start(event, {
        id: g.id,
        expectedRevision: 1,
        intervalMs: 60_000,
      });
      auth.clearProjectGoalAuth();
      expect(actor).toBe(owner);
      expect(await (await controller.initialize()).tick()).toMatchObject({
        reason: "identity-locked",
      });
      expect(() => defaults.read(event, { id: g.id })).toThrow(
        "GOAL_IDENTITY_REQUIRED",
      );
    } finally {
      auth.disposeProjectGoalAuth();
    }
  });
  it("invokes start/check/status/stop against live native goals", async () => {
    const g = goal();
    expect(
      await host.start(event, {
        id: g.id,
        expectedRevision: 1,
        intervalMs: 60_000,
      }),
    ).toMatchObject({ monitor: { enabled: 1 } });
    expect(
      await host.check(event, {
        id: g.id,
        expectedRevision: 1,
        requestId: "manual",
      }),
    ).toMatchObject({ status: "succeeded" });
    expect(await host.status(event, { id: g.id })).toMatchObject({
      usage: { checks: 1 },
    });
    expect(
      await host.stop(event, { id: g.id, expectedRevision: 1 }),
    ).toMatchObject({
      goal: { status: "paused" },
      monitor: { enabled: 0 },
      executionState: "paused",
    });
  });
  it("keeps background authorization independent from the original renderer window", async () => {
    const g = goal();
    await host.start(event, {
      id: g.id,
      expectedRevision: 1,
      intervalMs: 60_000,
    });
    window.isDestroyed.mockReturnValue(true);
    const engine = await controller.initialize();
    await engine.tick();
    expect(engine.status({ id: g.id }).usage.checks).toBe(1);
    await expect(host.status(event, { id: g.id })).rejects.toThrow(
      "GOAL_WINDOW_UNAVAILABLE",
    );
  });
  it.each(["start", "stop", "check", "status"])(
    "rejects an untrusted %s caller before opening a scheduler",
    async (method) => {
      await expect(
        host[method](
          {
            ...event,
            senderFrame: { url: "https://untrusted.example", parent: null },
          },
          { id: "g1" },
        ),
      ).rejects.toThrow("GOAL_UNTRUSTED_SENDER");
      expect(electron.app.getPath).not.toHaveBeenCalled();
    },
  );
  it("rechecks the sender after asynchronous controller initialization", async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const engine = { status: vi.fn() };
    const delayed = createProjectGoalHost({
      database: db,
      electron,
      getCurrentUserDid: () => actor,
      monitoringController: {
        initialize: () => pending,
        close: async () => {},
      },
    });
    const reading = delayed.status(event, { id: "g1" });
    window.isDestroyed.mockReturnValue(true);
    release(engine);
    await expect(reading).rejects.toThrow("GOAL_WINDOW_UNAVAILABLE");
    expect(engine.status).not.toHaveBeenCalled();
  });
  it("rejects renderer-supplied execution identities and storage paths", async () => {
    const g = goal();
    await expect(
      host.check(event, {
        id: g.id,
        expectedRevision: 1,
        requestId: "manual",
        actor: "did:other",
        file: "evil.db",
      }),
    ).rejects.toThrow("GOAL_MONITOR_INVALID_REQUEST");
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cc_project_goal_checks").get().n,
    ).toBe(0);
  });
  it("waits while identity is locked and authorizes every subsequent command", async () => {
    const g = goal();
    await host.start(event, {
      id: g.id,
      expectedRevision: 1,
      intervalMs: 60_000,
    });
    const engine = await controller.initialize();
    actor = null;
    expect(await engine.tick()).toMatchObject({
      status: "waiting",
      reason: "identity-locked",
    });
    await expect(host.status(event, { id: g.id })).rejects.toThrow(
      "GOAL_IDENTITY_REQUIRED",
    );
    actor = "did:other";
    await expect(host.status(event, { id: g.id })).rejects.toThrow(
      "GOAL_NOT_FOUND_OR_DENIED",
    );
  });
  it("restores only explicitly enabled goals when the desktop controller restarts", async () => {
    const g = goal();
    await host.start(event, {
      id: g.id,
      expectedRevision: 1,
      intervalMs: 60_000,
    });
    await controller.close();
    controller = createProjectGoalMonitoringController(options());
    const engine = await controller.initialize();
    await engine.tick();
    expect(engine.status({ id: g.id }).usage.checks).toBe(1);
  });
  it("locks and drains the old engine before rotating a replaced database connection", async () => {
    const old = await controller.initialize();
    const previous = db;
    db = createDb(join(directory, "second.db"));
    expect(await old.tick()).toMatchObject({
      status: "waiting",
      reason: "identity-locked",
    });
    const fresh = await controller.initialize();
    expect(old.store.closed).toBe(true);
    expect(fresh).not.toBe(old);
    expect(fresh.store.file).not.toBe(old.store.file);
    previous.close();
  });
  it("drains and shares shutdown before the host may close its project connection", async () => {
    const engine = await controller.initialize();
    const closing = controller.close();
    expect(controller.close()).toBe(closing);
    await closing;
    expect(engine.store.closed).toBe(true);
    expect(db.open).toBe(true);
    expect(() => controller.initialize()).toThrow("GOAL_MONITOR_HOST_CLOSED");
  });
  it("refuses database fallbacks that lack a native transaction", async () => {
    await controller.close();
    controller = createProjectGoalMonitoringController({
      ...options(),
      database: { prepare: vi.fn(), exec: vi.fn() },
    });
    await expect(controller.initialize()).rejects.toThrow(
      "GOAL_NATIVE_DATABASE_REQUIRED",
    );
    expect(electron.app.getPath).not.toHaveBeenCalled();
  });
  it.each([false, undefined, Promise.resolve("later")])(
    "rejects non-confirming storage protection %s before opening the scheduler",
    async (result) => {
      await controller.close();
      controller = createProjectGoalMonitoringController({
        ...options(),
        protectDirectory: () => result,
      });
      await expect(controller.initialize()).rejects.toThrow();
      expect(existsSync(join(directory, "app-data", "goal-monitoring"))).toBe(
        false,
      );
    },
  );
  it("uses actual platform owner-only protection in the production opener", async () => {
    await controller.close();
    const opts = options();
    delete opts.protectDirectory;
    delete opts.protectFile;
    controller = createProjectGoalMonitoringController(opts);
    const engine = await controller.initialize();
    const {
      inspectPrivatePaths,
    } = require("@chainlesschain/session-core/private-storage");
    const [inspected] = inspectPrivatePaths([engine.store.file]);
    expect(inspected.ok).toBe(true);
  }, 90_000);
});
