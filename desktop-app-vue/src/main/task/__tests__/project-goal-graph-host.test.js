import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const {
  createProjectGoalMonitoringController,
} = require("../project-goal-monitoring-host.js");
describe("desktop-owned project Graph store, loader and lifecycle", () => {
  let root, db, currentDb, controller, mode, now, options;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-desktop-goal-graph-"));
    now = Date.now();
    mode = "canonical";
    db = new Database(path.join(root, "project.db"));
    currentDb = db;
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT);`);
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      "did:chainless:owner",
      "active",
      now,
    );
    options = {
      database: { getDatabase: () => currentDb },
      electron: { app: { getPath: () => path.join(root, "user-data") } },
      getCurrentUserDid: () => "did:chainless:owner",
      clock: () => now,
      graphMode: () => mode,
      autoStart: false,
      protectDirectory: (p) => {
        fs.mkdirSync(p, { recursive: true });
        return p;
      },
      protectFile: vi.fn((p) => p),
    };
  });
  afterEach(async () => {
    await controller?.close();
    if (db?.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function open(extra = {}) {
    controller = createProjectGoalMonitoringController({
      ...options,
      ...extra,
    });
    return controller.initialize();
  }
  it("keeps the default legacy host from loading Graph or creating a second journal", async () => {
    mode = "legacy";
    const loader = vi.fn(() => {
        throw new Error("must not load");
      }),
      engine = await open({ graphHostLoader: loader });
    expect(engine.graphAuthority).toBeNull();
    expect(loader).not.toHaveBeenCalled();
    expect(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='cc_project_goal_graph_store'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      fs.existsSync(path.join(path.dirname(engine.store.file), "graph.sqlite")),
    ).toBe(false);
  });
  it("loads the supported source entry and uses a distinct protected native Graph database", async () => {
    const engine = await open(),
      graphDb = engine.graphAuthority.authority.eventStore.rolloutStore.db;
    expect(graphDb.name).toBe(
      path.join(path.dirname(engine.store.file), "graph.sqlite"),
    );
    expect(graphDb.name).not.toBe(db.name);
    expect(graphDb.name).not.toBe(engine.store.file);
    const g = engine.state.goals.create({
      projectId: "p1",
      objective: "Native Graph host",
    });
    expect(
      (
        await engine.checkNow({
          id: g.id,
          expectedRevision: 1,
          requestId: "check",
        })
      ).status,
    ).toBe("succeeded");
    expect(options.protectFile.mock.calls.flat()).toContain(graphDb.name);
    expect(
      db.prepare("SELECT phase FROM cc_project_goal_graph_store").get().phase,
    ).toBe("ready");
    await controller.close();
    expect(graphDb.open).toBe(false);
  });
  it("retains the existing native Graph identity when the flag returns to legacy", async () => {
    const first = await open(),
      file = first.graphAuthority.authority.eventStore.rolloutStore.db.name;
    const id = db
      .prepare("SELECT graph_id FROM cc_project_goal_graph_store")
      .get().graph_id;
    await controller.close();
    mode = "legacy";
    const second = await open();
    expect(second.graphAuthority.mode).toBe("legacy");
    expect(
      second.graphAuthority.authority.eventStore.rolloutStore.db.name,
    ).toBe(file);
    expect(
      db.prepare("SELECT graph_id FROM cc_project_goal_graph_store").get()
        .graph_id,
    ).toBe(id);
  });
  it("refuses a missing journal after activation even with the flag disabled", async () => {
    const engine = await open(),
      file = engine.graphAuthority.authority.eventStore.rolloutStore.db.name;
    await controller.close();
    fs.unlinkSync(file);
    mode = "legacy";
    await expect(open()).rejects.toThrow("GOAL_MONITOR_GRAPH_STORAGE_MISSING");
    expect(fs.existsSync(file)).toBe(false);
  });
  it("rejects a replaced database instead of manufacturing its old identity", async () => {
    const engine = await open(),
      file = engine.graphAuthority.authority.eventStore.rolloutStore.db.name;
    await controller.close();
    fs.unlinkSync(file);
    const other = new Database(file);
    other.exec("CREATE TABLE unrelated(id TEXT)");
    other.close();
    await expect(open()).rejects.toThrow("GOAL_MONITOR_GRAPH_STORE_CORRUPT");
    const inspect = new Database(file);
    expect(
      inspect
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='cc_project_goal_graph_identity'",
        )
        .get(),
    ).toBeUndefined();
    inspect.close();
  });
  it("fails closed after loader mismatch but can recover an unstarted initialization", async () => {
    await expect(
      open({
        graphHostLoader: async () => ({ PROJECT_GOAL_GRAPH_HOST_VERSION: 2 }),
      }),
    ).rejects.toThrow("GOAL_MONITOR_GRAPH_HOST_INCOMPATIBLE");
    expect(
      db.prepare("SELECT phase FROM cc_project_goal_graph_store").get().phase,
    ).toBe("initializing");
    await controller.close();
    expect((await open()).graphAuthority.mode).toBe("canonical");
  });
  it.each(["close", "database"])(
    "rejects a stale %s during the asynchronous host import",
    async (kind) => {
      let resolveLoader;
      const load = new Promise((r) => {
        resolveLoader = r;
      });
      controller = createProjectGoalMonitoringController({
        ...options,
        graphHostLoader: () => load,
      });
      const pending = controller.initialize();
      // initialize yields at import after the source binding has been prepared.
      await Promise.resolve();
      let closing;
      if (kind === "close") closing = controller.close();
      else currentDb = {};
      resolveLoader({
        PROJECT_GOAL_GRAPH_HOST_VERSION: 1,
        createProjectGoalGraphAuthority: () => {
          throw new Error("must not open");
        },
      });
      await expect(pending).rejects.toThrow(
        kind === "close"
          ? "GOAL_MONITOR_HOST_CLOSED"
          : "GOAL_MONITOR_DATABASE_CHANGED",
      );
      await closing;
    },
  );
  it("rejects invalid modes before any Graph database is opened", async () => {
    mode = "auto";
    await expect(open()).rejects.toThrow("GOAL_MONITOR_GRAPH_MODE_INVALID");
    expect(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='cc_project_goal_graph_store'",
        )
        .get(),
    ).toBeUndefined();
  });
});
