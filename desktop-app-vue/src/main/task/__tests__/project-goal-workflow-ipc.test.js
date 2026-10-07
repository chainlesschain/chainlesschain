import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { createProjectGoalHost } = require("../project-goal-ipc.js");
const {
  ProjectGoalWorkflow,
} = require("@chainlesschain/session-core/project-goal-workflow");
const owner = "did:chainless:owner";

// Native SQLite is real; Electron window/dialog APIs are explicit test doubles.
describe("goal workflow trusted desktop IPC and native confirmation boundary", () => {
  let db, actor, window, event, electron, host, workflow, g;
  beforeEach(() => {
    db = new Database(":memory:");
    actor = owner;
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,
        created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
      INSERT INTO projects VALUES ('p1','${owner}','active',10,0);
      INSERT INTO project_tasks VALUES ('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
    window = { isDestroyed: vi.fn(() => false) };
    event = {
      sender: {},
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    electron = {
      BrowserWindow: { fromWebContents: vi.fn(() => window) },
      dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
    };
    host = createProjectGoalHost({
      database: { getDatabase: () => db },
      getCurrentUserDid: () => actor,
      electron,
      clock: () => 1791244800000,
    });
    workflow = new ProjectGoalWorkflow({
      db,
      getActor: () => actor,
      clock: () => 1791244800000,
    });
    g = host.create(event, { projectId: "p1", objective: "Follow delivery" });
    g = host.revise(event, {
      id: g.id,
      expectedRevision: g.revision,
      patch: { allowedActionTypes: ["task.create", "task.update-description"] },
    });
    const review = workflow.risk.evaluate({ projectId: "p1" });
    db.transaction(() =>
      workflow.observeInTransaction({
        goalId: g.id,
        reviewId: review.review.id,
      }),
    ).immediate();
  });
  afterEach(() => {
    if (db?.open) db.close();
  });
  function prepare(type = "task.create") {
    const proposal = host
      .proposals(event, { goalId: g.id })
      .proposals.find((item) => item.proposal.actionType === type).proposal;
    return host.prepareIntent(event, {
      goalId: g.id,
      proposalId: proposal.id,
      expectedRevision: g.revision,
      requestId: "native-request",
      description: "Owner decision\u202e",
      ...(type === "task.create" ? { taskType: "query_info" } : {}),
    });
  }
  it.each(["task.create", "task.update-description"])(
    "displays current goal/source/version and writes %s only after native confirmation",
    async (type) => {
      const prepared = prepare(type);
      expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
      const receipt = await host.executeIntent(event, {
        intentId: prepared.intent.id,
      });
      expect(receipt.run.status).toBe("succeeded");
      const [parent, dialog] = electron.dialog.showMessageBox.mock.calls[0];
      expect(parent).toBe(window);
      expect(dialog).toMatchObject({ defaultId: 0, cancelId: 0, noLink: true });
      expect(dialog.detail).toContain("Follow delivery");
      expect(dialog.detail).toContain(
        prepared.intent.preview.request.expectedVersion,
      );
      expect(dialog.detail).toContain(prepared.intent.reviewId);
      expect(dialog.detail).toContain("\\u202e");
      expect(
        host.readIntent(event, { intentId: prepared.intent.id }).receipt.run,
      ).toEqual(receipt.run);
      const replay = await host.executeIntent(event, {
        intentId: prepared.intent.id,
      });
      expect(replay.replayed).toBe(true);
      expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["pause", "logout", "window", "database", "navigation", "identity"])(
    "rejects an old native confirmation after %s changes",
    async (change) => {
      const prepared = prepare();
      const original = db;
      electron.dialog.showMessageBox.mockImplementation(async () => {
        if (change === "pause")
          host.revise(event, {
            id: g.id,
            expectedRevision: g.revision,
            patch: { status: "paused" },
          });
        if (change === "logout") actor = null;
        if (change === "window") window.isDestroyed.mockReturnValue(true);
        if (change === "database") db = new Database(":memory:");
        if (change === "navigation")
          event.senderFrame.url = "https://untrusted.example";
        if (change === "identity") actor = "did:chainless:other";
        return { response: 1 };
      });
      await expect(
        host.executeIntent(event, { intentId: prepared.intent.id }),
      ).rejects.toThrow();
      expect(
        original.prepare("SELECT count(*) AS n FROM project_tasks").get().n,
      ).toBe(1);
      expect(
        JSON.parse(
          original.prepare("SELECT run_json FROM cc_business_action_runs").get()
            .run_json,
        ).status,
      ).toBe("denied");
      if (db !== original) db.close();
      db = original;
    },
  );
  it.each(["proposals", "prepareIntent", "executeIntent", "readIntent"])(
    "checks trusted sender for %s before reading business data",
    (method) => {
      expect(() =>
        host[method](
          {
            ...event,
            senderFrame: { url: "https://evil.example", parent: null },
          },
          {},
        ),
      ).toThrow("GOAL_UNTRUSTED_SENDER");
      expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
    },
  );
  it("rejects renderer-selected requests and serialized approval objects", async () => {
    const prepared = prepare();
    await expect(
      host.executeIntent(event, {
        intentId: prepared.intent.id,
        approval: true,
        request: prepared.intent.preview.request,
      }),
    ).rejects.toThrow("ACTION_GOAL_INVALID_REQUEST");
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });
  it("records native cancellation without creating a task", async () => {
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    const prepared = prepare();
    expect(
      (await host.executeIntent(event, { intentId: prepared.intent.id })).run
        .status,
    ).toBe("cancelled");
    expect(db.prepare("SELECT count(*) AS n FROM project_tasks").get().n).toBe(
      1,
    );
  });
});
