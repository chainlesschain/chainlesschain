import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  CHANNELS,
  createTaskDescriptionHost,
  registerTaskDescriptionIPC,
} = require("../task-description-ipc.js");

describe("personal task description desktop authority", () => {
  let db;
  let actor;
  let electron;
  let event;
  let window;
  let host;
  const owner = "did:chainlesschain:owner";

  function makeHost(database = { getDatabase: () => db }) {
    return createTaskDescriptionHost({
      database,
      getCurrentUserDid: () => actor,
      electron,
    });
  }

  function preview(overrides = {}) {
    return host.preview(event, {
      taskId: "task-1",
      description: "Reviewed task description",
      idempotencyKey: "desktop-change-1",
      ...overrides,
    });
  }

  function description() {
    return db
      .prepare("SELECT description FROM project_tasks WHERE id = ?")
      .get("task-1").description;
  }

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT,
        status TEXT, updated_at INTEGER, deleted INTEGER DEFAULT 0
      );
      CREATE TABLE project_tasks (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_type TEXT,
        description TEXT NOT NULL, status TEXT, org_id TEXT, workspace_id TEXT,
        updated_at INTEGER NOT NULL, created_at INTEGER, completed_at INTEGER,
        sync_status TEXT, deleted INTEGER DEFAULT 0, due_date INTEGER, blocked_by TEXT
      );
    `);
    db.prepare(
      "INSERT INTO projects (id, user_id, name, status, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("project-1", owner, "Personal project", "active", 10);
    db.prepare(
      "INSERT INTO project_tasks (id, project_id, task_type, description, status, updated_at, created_at, sync_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "task-1",
      "project-1",
      "query_info",
      "Original description",
      "pending",
      10,
      10,
      "synced",
    );
    actor = owner;
    window = { isDestroyed: vi.fn(() => false) };
    electron = {
      BrowserWindow: { fromWebContents: vi.fn(() => window) },
      dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
      ipcMain: { handle: vi.fn() },
    };
    event = {
      sender: {},
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    host = makeHost();
  });

  afterEach(() => db.close());

  it("previews and executes the real shared service with a native owner confirmation", async () => {
    const result = preview();
    expect(description()).toBe("Original description");
    const executed = await host.execute(event, { request: result.request });
    expect(description()).toBe("Reviewed task description");
    expect(executed.run.status).toBe("succeeded");
    expect(executed.replayed).toBe(false);
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    const [parent, options] = electron.dialog.showMessageBox.mock.calls[0];
    expect(parent).toBe(window);
    expect(options).toMatchObject({ defaultId: 0, cancelId: 0 });
    expect(options.detail).toContain("Original description");
    expect(options.detail).toContain("Reviewed task description");
    expect(options.detail).toContain(owner);
    expect(options.detail).toContain(result.request.actionDigest);
    expect(host.getRun(event, { runId: executed.run.id }).run.id).toBe(
      executed.run.id,
    );
  });

  it("ignores renderer identity and approval flags and still asks the native owner", async () => {
    const result = preview({ actorDid: "did:attacker", approved: true });
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    const cancelled = await host.execute(event, {
      request: result.request,
      actorDid: owner,
      approved: true,
      approval: { decision: "allow" },
      policy: "autopilot",
    });
    expect(cancelled.run.status).toBe("cancelled");
    expect(description()).toBe("Original description");
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it("does not elevate another user from a forged owner claim", () => {
    actor = "did:chainlesschain:other";
    expect(() => preview({ actorDid: owner })).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("rejects locked identity before opening a dialog", () => {
    actor = null;
    expect(() => preview()).toThrow("BUSINESS_ACTION_IDENTITY_REQUIRED");
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("refuses a user switch while native confirmation is open", async () => {
    const result = preview();
    electron.dialog.showMessageBox.mockImplementation(async () => {
      actor = "did:chainlesschain:other";
      return { response: 1 };
    });
    await expect(async () =>
      host.execute(event, { request: result.request }),
    ).rejects.toThrow();
    expect(description()).toBe("Original description");
  });

  it("refuses a destroyed parent window after native confirmation", async () => {
    const result = preview();
    electron.dialog.showMessageBox.mockImplementation(async () => {
      window.isDestroyed.mockReturnValue(true);
      return { response: 1 };
    });
    await expect(async () =>
      host.execute(event, { request: result.request }),
    ).rejects.toThrow();
    expect(description()).toBe("Original description");
  });

  it("enforces trusted sender even when the global guard is disabled", () => {
    const previous = process.env.CC_IPC_SENDER_GUARD;
    process.env.CC_IPC_SENDER_GUARD = "off";
    try {
      event.senderFrame.url = "https://attacker.example";
      expect(() => preview()).toThrow("BUSINESS_ACTION_UNTRUSTED_SENDER");
    } finally {
      if (previous === undefined) delete process.env.CC_IPC_SENDER_GUARD;
      else process.env.CC_IPC_SENDER_GUARD = previous;
    }
  });

  it("refuses iframe requests", () => {
    event.senderFrame.parent = {};
    expect(() => preview()).toThrow("BUSINESS_ACTION_UNTRUSTED_SENDER");
  });

  it("requires a native transaction-capable database", () => {
    host = makeHost({ getDatabase: () => ({ prepare: db.prepare.bind(db) }) });
    expect(() => preview()).toThrow("ACTION_NATIVE_DATABASE_REQUIRED");
    expect(description()).toBe("Original description");
  });

  it("does not authorize organization tasks through personal project ownership", () => {
    db.prepare("UPDATE project_tasks SET org_id = ? WHERE id = ?").run(
      "org-1",
      "task-1",
    );
    expect(() => preview()).toThrow("ACTION_ORGANIZATION_UNSUPPORTED");
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("does not truncate the text that the native owner reviews", async () => {
    const longDescription = `${"A".repeat(8000)}\u202eend`;
    const result = preview({ description: longDescription });
    await host.execute(event, { request: result.request });
    expect(electron.dialog.showMessageBox.mock.calls[0][1].detail).toContain(
      `${"A".repeat(8000)}\\u202eend`,
    );
    expect(description()).toBe(longDescription);
  });

  it("serves only the registered controlled IPC operations", () => {
    registerTaskDescriptionIPC(
      { getDatabase: () => db },
      {
        electron,
        getCurrentUserDid: () => actor,
      },
    );
    expect(electron.ipcMain.handle.mock.calls.map(([name]) => name)).toEqual(
      Object.values(CHANNELS),
    );
    const handler = electron.ipcMain.handle.mock.calls[0][1];
    expect(
      handler(event, {
        taskId: "task-1",
        description: "From IPC",
        idempotencyKey: "ipc-change",
      }).after.description,
    ).toBe("From IPC");
  });

  it("serves authorized task lists, bounded detail and action history", async () => {
    const listing = host.listTasks(event, {
      projectId: "project-1",
      actorDid: "did:attacker",
      limit: undefined,
    });
    expect(listing.tasks).toHaveLength(1);
    expect(listing.tasks[0]).toMatchObject({
      id: "task-1",
      taskType: "query_info",
      status: "pending",
    });
    expect(host.readTask(event, { taskId: "task-1" })).toMatchObject({
      editable: true,
      description: "Original description",
    });
    const executed = await host.execute(event, { request: preview().request });
    expect(
      host.listRuns(event, { taskId: "task-1", beforeId: undefined }).runs[0]
        .run.id,
    ).toBe(executed.run.id);
    actor = "did:chainlesschain:other";
    for (const read of [
      () => host.listTasks(event, { projectId: "project-1" }),
      () => host.readTask(event, { taskId: "task-1" }),
      () => host.listRuns(event, { taskId: "task-1" }),
    ]) {
      expect(read).toThrow("ACTION_NOT_FOUND_OR_DENIED");
    }
  });

  it("evaluates real authorized rows and reads the saved risk source under current ownership", () => {
    db.prepare(
      "UPDATE project_tasks SET due_date=1,blocked_by=NULL WHERE id='task-1'",
    ).run();
    const evaluated = host.evaluateRisk(event, {
      projectId: "project-1",
      actorDid: "did:attacker",
      asOf: "2000-01-01T00:00:00.000Z",
    });
    expect(evaluated.review.actorDid).toBe(owner);
    expect(evaluated.evaluation.status).toBe("evaluated");
    expect(evaluated.evaluation.summary.overdueTaskCount).toBe(1);
    expect(evaluated.sourceSnapshot.tasks[0].blocked_by).toEqual([]);
    expect(
      host.getRiskReview(event, { reviewId: evaluated.review.id }),
    ).toEqual(evaluated);
    actor = "did:chainlesschain:other";
    expect(() =>
      host.getRiskReview(event, { reviewId: evaluated.review.id }),
    ).toThrow();
  });

  it("enforces the window and sender checks for every added reader", () => {
    const calls = [
      () => host.listTasks(event, { projectId: "project-1" }),
      () => host.readTask(event, { taskId: "task-1" }),
      () => host.listRuns(event, { taskId: "task-1" }),
      () => host.evaluateRisk(event, { projectId: "project-1" }),
      () => host.getRiskReview(event, { reviewId: "unknown" }),
    ];
    event.senderFrame.url = "https://attacker.example";
    for (const call of calls)
      expect(call).toThrow("BUSINESS_ACTION_UNTRUSTED_SENDER");
    event.senderFrame.url = "http://localhost:5173";
    window.isDestroyed.mockReturnValue(true);
    for (const call of calls)
      expect(call).toThrow("BUSINESS_ACTION_WINDOW_UNAVAILABLE");
  });

  it("makes unresolved receipt history available without enabling another task edit", async () => {
    let finish;
    electron.dialog.showMessageBox.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const prepared = preview();
    const pending = host.execute(event, { request: prepared.request });
    expect(host.readTask(event, { taskId: "task-1" })).toMatchObject({
      editable: false,
      reason: "ACTION_UNRESOLVED_ACTION",
    });
    expect(host.listRuns(event, { taskId: "task-1" }).runs[0].run.status).toBe(
      "running",
    );
    expect(() => preview({ idempotencyKey: "new-key" })).toThrow(
      "ACTION_UNRESOLVED_ACTION",
    );
    finish({ response: 0 });
    expect((await pending).run.status).toBe("cancelled");
    expect(host.readTask(event, { taskId: "task-1" }).editable).toBe(true);
  });
});
