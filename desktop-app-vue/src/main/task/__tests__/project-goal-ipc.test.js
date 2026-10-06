import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  CHANNELS,
  createProjectGoalHost,
  registerProjectGoalIPC,
} = require("../project-goal-ipc.js");

describe("project goal desktop identity and fixed IPC boundary", () => {
  const owner = "did:chainless:owner";
  let db, actor, window, electron, event, host;
  function dependencies() {
    return {
      database: { getDatabase: () => db },
      getCurrentUserDid: () => actor,
      electron,
    };
  }
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0)",
    );
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      owner,
      "active",
      10,
    );
    actor = owner;
    window = { isDestroyed: vi.fn(() => false) };
    electron = {
      BrowserWindow: { fromWebContents: vi.fn(() => window) },
      ipcMain: { handle: vi.fn() },
    };
    event = {
      sender: {},
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    host = createProjectGoalHost(dependencies());
  });
  afterEach(() => db.close());
  it("creates and reads an authorized goal without launching work", () => {
    const goal = host.create(event, {
      projectId: "p1",
      objective: "Follow project",
    });
    expect(goal.ownerRef).toBe(owner);
    expect(host.read(event, { id: goal.id })).toEqual(goal);
    expect(host.list(event, { projectId: "p1" })).toEqual([goal]);
    expect(goal.executionState).toBe("idle");
    expect(goal.triggerRefs).toEqual([]);
    expect(
      host.revise(event, {
        id: goal.id,
        expectedRevision: 1,
        patch: { status: "paused" },
      }),
    ).toMatchObject({ revision: 2, controlGeneration: 1, status: "paused" });
  });
  it.each(["https://untrusted.example", "http://localhost:5173/embedded"])(
    "rejects an untrusted frame before storing goal metadata: %s",
    (url) => {
      const requestEvent = {
        ...event,
        senderFrame: { url, parent: url.includes("embedded") ? {} : null },
      };
      expect(() =>
        host.create(requestEvent, { projectId: "p1", objective: "X" }),
      ).toThrow("GOAL_UNTRUSTED_SENDER");
      expect(
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE name='cc_project_goals'")
          .get(),
      ).toBeUndefined();
    },
  );
  it("rejects unavailable windows, locked identity and supplied identity", () => {
    window.isDestroyed.mockReturnValue(true);
    expect(() =>
      host.create(event, { projectId: "p1", objective: "X" }),
    ).toThrow("GOAL_WINDOW_UNAVAILABLE");
    window.isDestroyed.mockReturnValue(false);
    actor = null;
    expect(() =>
      host.create(event, { projectId: "p1", objective: "X" }),
    ).toThrow("GOAL_IDENTITY_REQUIRED");
    actor = owner;
    expect(() =>
      host.create(event, {
        projectId: "p1",
        objective: "X",
        ownerRef: "did:other",
      }),
    ).toThrow("GOAL_INVALID_REQUEST");
  });
  it("registers only metadata endpoints and rechecks the current actor", () => {
    const handlers = new Map();
    electron.ipcMain.handle.mockImplementation((name, handler) =>
      handlers.set(name, handler),
    );
    registerProjectGoalIPC(db, dependencies());
    expect([...handlers.keys()]).toEqual(Object.values(CHANNELS));
    const goal = handlers.get(CHANNELS.create)(event, {
      projectId: "p1",
      objective: "X",
    });
    actor = "did:other";
    expect(handlers.get(CHANNELS.read)(event, { id: goal.id })).toBeNull();
    expect(handlers.has("project:goal-complete")).toBe(false);
    expect(handlers.has("project:goal-execute")).toBe(false);
  });
});
