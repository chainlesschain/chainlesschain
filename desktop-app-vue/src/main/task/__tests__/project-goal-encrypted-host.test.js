import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { SQLCipherWrapper } = require("../../database/sqlcipher-wrapper.js");
const {
  currentProjectGoalDatabase,
} = require("../project-goal-native-database.js");
const { createProjectGoalHost } = require("../project-goal-ipc.js");
const {
  createProjectGoalMonitoringController,
} = require("../project-goal-monitoring-host.js");

// Real production wrapper and real native SQLite; encryption itself is covered
// by the separate Electron ABI probe, not by this injected Node driver.
describe("project goal composition through the desktop SQLCipher wrapper", () => {
  let root, wrapper, database, options, event, controller, host;
  const actor = "did:chainless:encrypted-host";
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-wrapper-"));
    wrapper = new SQLCipherWrapper(path.join(root, "project.db"), {}, Database);
    wrapper.open();
    wrapper.db
      .exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT);`);
    wrapper.db
      .prepare("INSERT INTO projects VALUES (?,?,?,?,0)")
      .run("p1", actor, "active", Date.now());
    database = { getDatabase: () => wrapper };
    const window = { isDestroyed: () => false };
    event = {
      sender: {},
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    options = {
      database,
      electron: {
        app: { getPath: () => path.join(root, "user-data") },
        BrowserWindow: { fromWebContents: () => window },
      },
      getCurrentUserDid: () => actor,
      getAuthenticationGeneration: () => 1,
      validateSender: () => ({ trusted: true }),
      graphMode: () => "canonical",
      autoStart: false,
      protectDirectory: (directory) => {
        fs.mkdirSync(directory, { recursive: true });
        return directory;
      },
      protectFile: (file) => file,
    };
    controller = createProjectGoalMonitoringController(options);
    host = createProjectGoalHost({
      ...options,
      monitoringController: controller,
    });
  });
  afterEach(async () => {
    await controller?.close();
    wrapper?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates a goal through IPC and commits canonical Graph on the same native project connection", async () => {
    const goal = host.create(event, {
      projectId: "p1",
      objective: "Check wrapped project",
      budgetPolicy: { maxRuns: 5 },
    });
    expect(host.read(event, { id: goal.id }).id).toBe(goal.id);
    const engine = await controller.initialize();
    expect(engine.state.db).toBe(wrapper.db);
    expect(engine.graphAuthority.authority.eventStore.rolloutStore.db).not.toBe(
      wrapper.db,
    );
    expect(
      await host.check(event, {
        id: goal.id,
        expectedRevision: 1,
        requestId: "wrapped-check",
      }),
    ).toMatchObject({ status: "succeeded" });
    expect(host.read(event, { id: goal.id })).toMatchObject({
      schema: "chainlesschain.goal/v2",
      requiresGraphAwareHost: true,
    });
    expect(await host.status(event, { id: goal.id })).toMatchObject({
      usage: { checks: 1 },
    });
  });

  it("rejects a closed wrapper without calling its auto-reopening getHandle", async () => {
    const getHandle = vi.spyOn(wrapper, "getHandle");
    wrapper.close();
    expect(() =>
      host.create(event, { projectId: "p1", objective: "Closed" }),
    ).toThrow("GOAL_NATIVE_DATABASE_REQUIRED");
    await expect(controller.initialize()).rejects.toThrow(
      "GOAL_NATIVE_DATABASE_REQUIRED",
    );
    expect(wrapper.db).toBeNull();
    expect(getHandle).not.toHaveBeenCalled();
  });

  it("preserves raw native identity and readonly state", () => {
    const file = wrapper.db.name;
    expect(currentProjectGoalDatabase(wrapper.db)).toBe(wrapper.db);
    const readonly = new Database(file, { readonly: true });
    try {
      expect(currentProjectGoalDatabase({ getDatabase: () => readonly })).toBe(
        readonly,
      );
      expect(readonly.readonly).toBe(true);
    } finally {
      readonly.close();
    }
  });

  it("does not unwrap lookalike objects or call arbitrary getHandle methods", () => {
    const lookalike = { db: wrapper.db, getHandle: vi.fn(() => wrapper.db) };
    expect(currentProjectGoalDatabase(lookalike)).toBe(lookalike);
    const unsupported = createProjectGoalHost({
      ...options,
      database: lookalike,
    });
    expect(() =>
      unsupported.create(event, { projectId: "p1", objective: "Unsupported" }),
    ).toThrow("GOAL_NATIVE_DATABASE_REQUIRED");
    expect(lookalike.getHandle).not.toHaveBeenCalled();
  });

  it("rotates the engine when the same wrapper closes and reopens its native connection", async () => {
    const goal = host.create(event, {
      projectId: "p1",
      objective: "Retained goal",
    });
    const first = await controller.initialize();
    const original = wrapper.db;
    wrapper.close();
    wrapper.open();
    const second = await controller.initialize();
    expect(wrapper.db).not.toBe(original);
    expect(second).not.toBe(first);
    expect(first.store.db.open).toBe(false);
    expect(second.state.db).toBe(wrapper.db);
    expect(host.read(event, { id: goal.id }).id).toBe(goal.id);
  });

  it("rejects a connection reopened during asynchronous Graph host loading", async () => {
    await controller.close();
    let release;
    const imported =
      import("../../../../../packages/cli/src/host/project-goal-graph.js");
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    controller = createProjectGoalMonitoringController({
      ...options,
      graphHostLoader: () => waiting,
    });
    const opening = controller.initialize();
    wrapper.close();
    wrapper.open();
    release(await imported);
    await expect(opening).rejects.toThrow("GOAL_MONITOR_DATABASE_CHANGED");
    expect(
      wrapper.db.prepare("SELECT phase FROM cc_project_goal_graph_store").get()
        .phase,
    ).toBe("initializing");
  });
});
