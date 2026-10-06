import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  TaskCreateActionService,
  TaskDescriptionActionService,
} = require("@chainlesschain/session-core/task-description-action-service");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");

describe("canonical personal task creation", () => {
  let db, service, actor, confirm;
  const owner = "did:chainless:owner";
  const rows = () => db.prepare("SELECT * FROM project_tasks").all();
  const request = (key = "create-one") =>
    service.preview({
      projectId: "p1",
      taskType: "query_info",
      description: "New task",
      idempotencyKey: key,
    }).request;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,task_type TEXT NOT NULL,
      description TEXT NOT NULL,status TEXT CHECK(status IN ('pending','running','completed','failed')),
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted INTEGER DEFAULT 0,sync_status TEXT);`);
    db.prepare("INSERT INTO projects VALUES ('p1',?,'active',1,0)").run(owner);
    actor = owner;
    confirm = vi.fn(async () => true);
    service = new TaskCreateActionService({
      db,
      getActor: () => actor,
      approvalGate: new ApprovalGate({ confirm }),
      now: () => 10,
    });
  });
  afterEach(() => db.close());
  it("creates only after confirmation and persists a verifiable new Task reference", async () => {
    const prepared = request();
    expect(rows()).toEqual([]);
    const result = await service.execute(prepared);
    expect(result.run.status).toBe("succeeded");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      project_id: "p1",
      task_type: "query_info",
      description: "New task",
      status: "pending",
      sync_status: "pending",
    });
    expect(result.evidence[1].createdTaskRef.id).toBe(rows()[0].id);
    expect(service.getRun(result.run.id).run).toEqual(result.run);
    expect(service.listProjectRuns({ projectId: "p1" }).runs[0].run).toEqual(
      result.run,
    );
    const edits = new TaskDescriptionActionService({
      db,
      getActor: () => actor,
      approvalGate: new ApprovalGate({ confirm }),
    });
    expect(edits.readTask(rows()[0].id).editable).toBe(true);
    const stored = JSON.stringify(
      db.prepare("SELECT * FROM cc_business_action_runs").all(),
    );
    expect(stored).not.toContain("New task");
    expect(stored).not.toContain("create-one");
  });
  it("does not duplicate a confirmed operation on repeat invocation", async () => {
    const prepared = request();
    const result = await service.execute(prepared);
    const replay = await service.execute(prepared);
    expect(replay.run).toEqual(result.run);
    expect(replay.replayed).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("retains cancellation evidence without creating a task", async () => {
    confirm.mockResolvedValue(false);
    const result = await service.execute(request());
    expect(result.run.status).toBe("cancelled");
    expect(rows()).toHaveLength(0);
    expect(service.getRun(result.run.id).run.status).toBe("cancelled");
  });
  it.each(["default-user", "device-123", "did:other"])(
    "does not claim project ownership for %s",
    (value) => {
      db.prepare("UPDATE projects SET user_id=?").run(value);
      expect(() => request()).toThrow("ACTION_NOT_FOUND_OR_DENIED");
    },
  );
  it("rejects organizational workspace resources", () => {
    db.exec(
      "CREATE TABLE workspace_resources(resource_type TEXT,resource_id TEXT); INSERT INTO workspace_resources VALUES ('project','p1')",
    );
    expect(() => request()).toThrow("ACTION_ORGANIZATION_UNSUPPORTED");
  });
  it("checks ownership again after the native dialog", async () => {
    const prepared = request();
    confirm.mockImplementation(async () => {
      db.prepare("UPDATE projects SET user_id='did:other'").run();
      return true;
    });
    await expect(service.execute(prepared)).rejects.toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    expect(rows()).toHaveLength(0);
    expect(
      JSON.parse(
        db.prepare("SELECT run_json FROM cc_business_action_runs").get()
          .run_json,
      ).status,
    ).toBe("denied");
  });
  it("rejects separately prepared stale project revisions", async () => {
    const first = request(),
      second = request("create-two");
    await service.execute(first);
    await expect(service.execute(second)).rejects.toThrow(
      "ACTION_VERSION_CONFLICT",
    );
    expect(rows()).toHaveLength(1);
  });
  it("blocks new keys while confirmation remains unresolved", async () => {
    let release;
    confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = service.execute(request());
    expect(() => request("create-two")).toThrow("ACTION_UNRESOLVED_ACTION");
    release(false);
    await pending;
    expect(rows()).toHaveLength(0);
  });
  it("rolls back task and project mutation when evidence cannot commit", async () => {
    db.exec(
      "CREATE TRIGGER reject_success BEFORE UPDATE ON cc_business_action_runs WHEN json_extract(NEW.run_json,'$.status')='succeeded' BEGIN SELECT RAISE(ABORT,'blocked'); END",
    );
    const prepared = request();
    await expect(service.execute(prepared)).rejects.toThrow(
      "ACTION_OUTCOME_UNKNOWN",
    );
    expect(rows()).toHaveLength(0);
    expect(db.prepare("SELECT updated_at FROM projects").get().updated_at).toBe(
      1,
    );
    const replay = await service.execute(prepared);
    expect(replay.executionState).toBe("unresolved");
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("rejects arbitrary legacy fields and unsupported task types", () => {
    expect(() =>
      service.preview({
        projectId: "p1",
        taskType: "shell",
        description: "text",
        idempotencyKey: "x",
      }),
    ).toThrow("ACTION_INVALID_TASK_TYPE");
    expect(() =>
      service.preview({
        projectId: "p1",
        taskType: "query_info",
        description: "text",
        idempotencyKey: "x",
        actorDid: owner,
      }),
    ).toThrow("ACTION_INVALID_REQUEST");
  });
});
