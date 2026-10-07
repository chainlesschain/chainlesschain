import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { createProjectGoalHost } = require("../project-goal-ipc.js");
const owner = "did:chainless:owner";
describe("trusted native goal acceptance and independent controls IPC", () => {
  let db, actor, window, event, electron, host, goal, engine;
  beforeEach(() => {
    db = new Database(":memory:");
    actor = owner;
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT);
      INSERT INTO projects VALUES ('p1','${owner}','active',10,0);
      INSERT INTO project_tasks VALUES ('t1','p1','pending',10,0,20,NULL);`);
    window = { isDestroyed: vi.fn(() => false) };
    event = {
      sender: {},
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    electron = {
      BrowserWindow: { fromWebContents: vi.fn(() => window) },
      dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
    };
    engine = {
      stopOccurrence: vi.fn(() => ({ status: "stop-requested" })),
      endFollowUp: vi.fn(() => ({ executionState: "ended" })),
    };
    host = createProjectGoalHost({
      database: { getDatabase: () => db },
      getCurrentUserDid: () => actor,
      electron,
      clock: () => 1791244800000,
      monitoringController: {
        initialize: vi.fn(async () => engine),
        close: vi.fn(),
      },
    });
    goal = host.create(event, { projectId: "p1", objective: "Check delivery" });
  });
  afterEach(() => {
    if (db?.open) db.close();
  });
  const input = (id = "request1") => ({
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId: id,
  });
  function configure(manual = false) {
    const result = host.configureAcceptance(event, {
      goalId: goal.id,
      expectedRevision: goal.revision,
      acceptanceCriteria: manual
        ? [
            {
              id: "owner",
              kind: "manual",
              description: "Owner verified the delivered files",
            },
          ]
        : [
            {
              id: "tasks",
              kind: "business-assertion",
              description: "All tasks completed",
            },
          ],
      assertions: manual
        ? []
        : [{ criterionId: "tasks", type: "all-tasks-completed" }],
    });
    goal = result.goal;
  }
  it("checks actual rows and cannot complete from renderer supplied progress or approval", () => {
    configure();
    expect(host.completeGoal(event, input()).completed).toBe(false);
    expect(() =>
      host.completeGoal(event, {
        ...input("request2"),
        met: true,
        approved: true,
      }),
    ).toThrow("GOAL_COMPLETION_INVALID_REQUEST");
    db.exec("UPDATE project_tasks SET status='completed'");
    const result = host.completeGoal(event, input("request3"));
    expect(result.completed).toBe(true);
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(
      host.acceptanceStatus(event, { goalId: goal.id }).reports[0].id,
    ).toBe(result.report.id);
  });
  it("records manual acceptance only through a strict native dialog owned by the live renderer", async () => {
    configure(true);
    expect(host.checkAcceptance(event, input("check")).report.met).toBe(false);
    const acknowledgement = await host.acknowledgeAcceptance(
      event,
      input("ack"),
    );
    expect(acknowledgement.acknowledgement.status).toBe("accepted");
    const [parent, dialog] = electron.dialog.showMessageBox.mock.calls[0];
    expect(parent).toBe(window);
    expect(dialog).toMatchObject({ defaultId: 0, cancelId: 0, noLink: true });
    expect(dialog.detail).toContain("Owner verified the delivered files");
    expect(host.completeGoal(event, input("complete")).completed).toBe(true);
  });
  it.each([
    "navigation",
    "window",
    "identity",
    "logout",
    "revision",
    "database",
  ])("revokes a pending owner confirmation on %s", async (change) => {
    configure(true);
    const original = db;
    electron.dialog.showMessageBox.mockImplementation(async () => {
      if (change === "navigation")
        event.senderFrame.url = "https://untrusted.example";
      if (change === "window") window.isDestroyed.mockReturnValue(true);
      if (change === "identity") actor = "did:other";
      if (change === "logout") actor = null;
      if (change === "revision")
        host.revise(event, {
          id: goal.id,
          expectedRevision: goal.revision,
          patch: { objective: "Different scope" },
        });
      if (change === "database") db = new Database(":memory:");
      return { response: 1 };
    });
    await expect(
      host.acknowledgeAcceptance(event, input("ack")),
    ).rejects.toThrow();
    const stored = JSON.parse(
      original
        .prepare(
          "SELECT record_json FROM cc_project_goal_acceptance WHERE kind='ack'",
        )
        .get().record_json,
    );
    expect(stored.status).toBe("denied");
    if (db !== original) db.close();
    db = original;
  });
  it.each([
    "configureAcceptance",
    "acceptanceStatus",
    "acknowledgeAcceptance",
    "checkAcceptance",
    "completeGoal",
  ])(
    "requires a trusted source for %s before opening an acceptance service",
    (method) => {
      const bad = {
        ...event,
        senderFrame: { url: "https://untrusted.example", parent: null },
      };
      expect(() => host[method](bad, {})).toThrow("GOAL_UNTRUSTED_SENDER");
      expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
    },
  );
  it("passes single-occurrence stop and ending follow-up to distinct authenticated engine operations", async () => {
    const stop = {
      id: goal.id,
      expectedRevision: goal.revision,
      occurrenceId: "occ1",
      expectedFence: 1,
      requestId: "stop1",
    };
    await host.stopOccurrence(event, stop);
    expect(engine.stopOccurrence).toHaveBeenCalledWith(stop);
    await host.endFollowUp(event, {
      id: goal.id,
      expectedRevision: goal.revision,
    });
    expect(engine.endFollowUp).toHaveBeenCalledWith({
      id: goal.id,
      expectedRevision: goal.revision,
    });
    actor = null;
    await expect(
      host.endFollowUp(event, { id: goal.id, expectedRevision: goal.revision }),
    ).rejects.toThrow("GOAL_IDENTITY_REQUIRED");
    expect(engine.endFollowUp).toHaveBeenCalledTimes(1);
  });
});
