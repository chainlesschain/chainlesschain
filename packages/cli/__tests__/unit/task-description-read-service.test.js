import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  TaskDescriptionActionService,
} = require("@chainlesschain/session-core/task-description-action-service");
const {
  createBusinessActionRun,
} = require("@chainlesschain/session-core/business-object-contract");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");

describe("authorized bounded personal task reads and action history", () => {
  const owner = "did:chainless:owner";
  let db, actor, confirm, service;
  function addTask(taskId, projectId = "p1", deleted = 0) {
    db.prepare(
      "INSERT INTO project_tasks (id,project_id,task_type,description,status,updated_at,deleted,sync_status) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      taskId,
      projectId,
      "query_info",
      `Description ${taskId}`,
      "pending",
      10,
      deleted,
      "synced",
    );
  }
  function request(taskId = "t1", key = "operation-one") {
    return service.preview({
      taskId,
      description: `Updated ${key}`,
      idempotencyKey: key,
    }).request;
  }
  function insertUnresolved(prepared, status = "running") {
    const run = createBusinessActionRun({
      id: `unresolved-${status}`,
      request: prepared,
      status,
      startedAt: "2026-10-06T00:00:00.000Z",
      ...(status === "unknown"
        ? { completedAt: "2026-10-06T00:00:00.000Z" }
        : {}),
    });
    db.prepare(
      "INSERT INTO cc_business_action_runs VALUES (?,?,?,?,?,?,?)",
    ).run(
      run.id,
      owner,
      prepared.target.id,
      run.idempotencyDigest,
      run.invocationDigest,
      JSON.stringify(run),
      "[]",
    );
    return run;
  }
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,
        updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,result_data TEXT);
      CREATE TABLE organization_projects (id TEXT PRIMARY KEY,org_id TEXT);`);
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      owner,
      "active",
      10,
    );
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p2",
      "did:chainless:other",
      "active",
      10,
    );
    addTask("t1");
    addTask("other", "p2");
    actor = owner;
    confirm = vi.fn(async () => true);
    service = new TaskDescriptionActionService({
      db,
      getActor: () => actor,
      approvalGate: new ApprovalGate({ confirm }),
    });
  });
  afterEach(() => db.close());

  it("pages task IDs deterministically, excludes deleted rows, and limits descriptions", () => {
    addTask("t3");
    addTask("t2");
    addTask("t0", "p1", 1);
    db.prepare("UPDATE project_tasks SET description=? WHERE id='t2'").run(
      "😀".repeat(400),
    );
    const first = service.listTasks({ projectId: "p1", limit: 1 });
    expect(first).toMatchObject({
      project: { id: "p1", status: "active" },
      tasks: [{ id: "t1" }],
      nextCursor: "t1",
    });
    const second = service.listTasks({
      projectId: "p1",
      afterId: first.nextCursor,
      limit: 1,
    });
    expect(second.tasks[0]).toMatchObject({
      id: "t2",
      taskType: "query_info",
      status: "pending",
      updatedAt: 10,
    });
    expect([...second.tasks[0].descriptionPreview]).toHaveLength(256);
    expect(
      service.listTasks({
        projectId: "p1",
        afterId: second.nextCursor,
        limit: 1,
      }),
    ).toMatchObject({ tasks: [{ id: "t3" }], nextCursor: null });
    expect(() =>
      service.listTasks({ projectId: "p1", afterId: "other" }),
    ).toThrow("ACTION_INVALID_CURSOR");
  });

  it("reports editability from current state without returning result bodies", () => {
    expect(service.readTask("t1")).toEqual({
      taskId: "t1",
      projectId: "p1",
      status: "pending",
      description: "Description t1",
      editable: true,
      reason: null,
    });
    db.exec("UPDATE project_tasks SET status='running' WHERE id='t1'");
    expect(service.readTask("t1")).toMatchObject({
      editable: false,
      reason: "ACTION_TARGET_NOT_EDITABLE",
    });
    db.exec(
      "UPDATE project_tasks SET status='pending'; UPDATE projects SET status='archived' WHERE id='p1'",
    );
    expect(service.readTask("t1")).toMatchObject({
      editable: false,
      reason: "ACTION_TARGET_NOT_EDITABLE",
    });
    db.exec("UPDATE projects SET status='active' WHERE id='p1'");
    db.prepare("UPDATE project_tasks SET result_data=? WHERE id='t1'").run(
      "private-large-result".repeat(100000),
    );
    const read = service.readTask("t1");
    expect(read).toMatchObject({
      description: "Description t1",
      editable: false,
      reason: "ACTION_SOURCE_INVALID",
    });
    expect(JSON.stringify(read)).not.toContain("private-large-result");
    expect(service.listTasks({ projectId: "p1" }).tasks).toHaveLength(1);
  });

  it("truncates oversized descriptions at a UTF-8 boundary and disables editing", () => {
    db.prepare("UPDATE project_tasks SET description=? WHERE id='t1'").run(
      "😀".repeat(3000),
    );
    const read = service.readTask("t1");
    expect(read).toMatchObject({
      editable: false,
      reason: "ACTION_DESCRIPTION_TOO_LARGE",
    });
    expect(Buffer.byteLength(read.description, "utf8")).toBe(8192);
    expect(read.description).not.toContain("�");
    expect(() => service.getTask("t1")).toThrow("ACTION_INVALID_DESCRIPTION");
  });

  it("preserves embedded NUL and complete multibyte text in editable descriptions", () => {
    const original = "\ufeffVisible prefix\u0000hidden suffix😀";
    db.prepare("UPDATE project_tasks SET description=? WHERE id='t1'").run(
      original,
    );
    expect(service.readTask("t1")).toMatchObject({
      description: original,
      editable: true,
      reason: null,
    });
    db.prepare("UPDATE project_tasks SET description=? WHERE id='t1'").run(
      `x${"😀".repeat(3000)}`,
    );
    const truncated = service.readTask("t1");
    expect(truncated.reason).toBe("ACTION_DESCRIPTION_TOO_LARGE");
    expect(Buffer.byteLength(truncated.description, "utf8")).toBe(8189);
    expect(truncated.description).not.toContain("�");
  });

  it("keeps selected parent fields sufficient when project content is large and refuses parent workspaces", async () => {
    const first = await service.execute(request());
    const originalRef = service.getTask("t1").ref;
    db.exec(
      "ALTER TABLE projects ADD COLUMN metadata TEXT; ALTER TABLE projects ADD COLUMN description TEXT",
    );
    db.prepare(
      "UPDATE projects SET metadata=?,description=? WHERE id='p1'",
    ).run(
      "large-private-metadata".repeat(100000),
      "large-private-description".repeat(100000),
    );
    expect(service.getTask("t1").ref).toEqual(originalRef);
    expect(service.listTasks({ projectId: "p1" }).tasks).toHaveLength(1);
    expect(service.readTask("t1").editable).toBe(true);
    expect(service.getRun(first.run.id).run).toEqual(first.run);
    expect(service.listRuns({ taskId: "t1" }).runs).toHaveLength(1);
    db.exec(
      "ALTER TABLE projects ADD COLUMN workspace_id TEXT; UPDATE projects SET workspace_id='workspace' WHERE id='p1'",
    );
    expect(() => service.readTask("t1")).toThrow(
      "ACTION_ORGANIZATION_UNSUPPORTED",
    );
    expect(() => service.getRun(first.run.id)).toThrow(
      "ACTION_ORGANIZATION_UNSUPPORTED",
    );
  });

  it("rechecks identity and current project ownership for every read including empty pages", () => {
    expect(() => service.listTasks({ projectId: "p2" })).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    expect(() => service.readTask("other")).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    expect(() => service.listRuns({ taskId: "other" })).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    actor = null;
    expect(() => service.listTasks({ projectId: "p1" })).toThrow(
      "ACTION_AUTHENTICATION_REQUIRED",
    );
    actor = owner;
    db.prepare("UPDATE projects SET user_id=? WHERE id='p1'").run(
      "did:chainless:other",
    );
    expect(() => service.readTask("t1")).toThrow("ACTION_NOT_FOUND_OR_DENIED");
    expect(() => service.listTasks({ projectId: "p1", afterId: "t1" })).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
  });

  it("refuses an entire personal list if an undeleted task carries enterprise scope", () => {
    addTask("t2");
    db.exec(
      "ALTER TABLE project_tasks ADD COLUMN workspace_id TEXT; UPDATE project_tasks SET workspace_id='workspace' WHERE id='t2'",
    );
    expect(() => service.listTasks({ projectId: "p1", limit: 1 })).toThrow(
      "ACTION_ORGANIZATION_UNSUPPORTED",
    );
    expect(() => service.readTask("t2")).toThrow(
      "ACTION_ORGANIZATION_UNSUPPORTED",
    );
    db.exec("UPDATE project_tasks SET deleted=1 WHERE id='t2'");
    expect(
      service.listTasks({ projectId: "p1" }).tasks.map((entry) => entry.id),
    ).toEqual(["t1"]);
    db.exec("INSERT INTO organization_projects VALUES ('p1','organization')");
    expect(() => service.listTasks({ projectId: "p1" })).toThrow(
      "ACTION_ORGANIZATION_UNSUPPORTED",
    );
  });

  it.each(["project", "task"])(
    "rejects %s workspace mappings even without enterprise columns",
    async (resourceType) => {
      const prepared = request();
      db.exec(
        "CREATE TABLE workspace_resources (resource_type TEXT,resource_id TEXT,workspace_id TEXT)",
      );
      db.prepare("INSERT INTO workspace_resources VALUES (?,?,?)").run(
        resourceType,
        resourceType === "project" ? "p1" : "t1",
        "workspace",
      );
      expect(() => service.listTasks({ projectId: "p1" })).toThrow(
        "ACTION_ORGANIZATION_UNSUPPORTED",
      );
      expect(() => service.readTask("t1")).toThrow(
        "ACTION_ORGANIZATION_UNSUPPORTED",
      );
      expect(() => service.listRuns({ taskId: "t1" })).toThrow(
        "ACTION_ORGANIZATION_UNSUPPORTED",
      );
      expect(() => request()).toThrow("ACTION_ORGANIZATION_UNSUPPORTED");
      await expect(service.execute(prepared)).rejects.toThrow(
        "ACTION_ORGANIZATION_UNSUPPORTED",
      );
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it("pages insertion-ordered history and preserves authorized receipts despite oversized source content", async () => {
    const first = await service.execute(request("t1", "first"));
    const second = await service.execute(request("t1", "second"));
    const third = await service.execute(request("t1", "third"));
    db.prepare(
      "UPDATE project_tasks SET description=?,result_data=? WHERE id='t1'",
    ).run("large-description".repeat(1000), "private-result".repeat(100000));
    const page1 = service.listRuns({ taskId: "t1", limit: 2 });
    expect(page1.runs.map((entry) => entry.run.id)).toEqual([
      third.run.id,
      second.run.id,
    ]);
    expect(page1.nextCursor).toBe(second.run.id);
    const page2 = service.listRuns({
      taskId: "t1",
      beforeId: page1.nextCursor,
      limit: 2,
    });
    expect(page2.runs.map((entry) => entry.run.id)).toEqual([first.run.id]);
    expect(page2.nextCursor).toBeNull();
    expect(service.getRun(first.run.id)).toEqual({
      run: first.run,
      evidence: first.evidence,
    });
    expect(JSON.stringify(page1)).not.toContain("private-result");
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("does not allow history cursors or access to cross actors or targets", async () => {
    const run = await service.execute(request());
    addTask("t2");
    expect(() =>
      service.listRuns({ taskId: "t2", beforeId: run.run.id }),
    ).toThrow("ACTION_INVALID_CURSOR");
    db.prepare("UPDATE projects SET user_id=? WHERE id='p1'").run(
      "did:chainless:new-owner",
    );
    expect(() => service.listRuns({ taskId: "t1" })).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    expect(() => service.getRun(run.run.id)).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    actor = "did:chainless:new-owner";
    expect(service.listRuns({ taskId: "t1" })).toEqual({
      runs: [],
      nextCursor: null,
    });
    expect(() =>
      service.listRuns({ taskId: "t1", beforeId: run.run.id }),
    ).toThrow("ACTION_INVALID_CURSOR");
  });

  it.each(["running", "queued", "unknown"])(
    "blocks fresh keys around %s receipts while permitting same-key inspection",
    async (status) => {
      const prepared = request();
      const different = request("t1", "different-key");
      const run = insertUnresolved(prepared, status);
      expect(service.readTask("t1")).toMatchObject({
        editable: false,
        reason: "ACTION_UNRESOLVED_ACTION",
      });
      expect(service.listRuns({ taskId: "t1" }).runs[0].run).toEqual(run);
      expect(() => request("t1", "fresh-after-reload")).toThrow(
        "ACTION_UNRESOLVED_ACTION",
      );
      await expect(service.execute(different)).rejects.toThrow(
        "ACTION_UNRESOLVED_ACTION",
      );
      expect(await service.execute(prepared)).toMatchObject({
        run,
        replayed: true,
        executionState: "unresolved",
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(
        db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
          .description,
      ).toBe("Description t1");
    },
  );

  it("keeps a prior owner's unresolved effect blocked after transfer without disclosing its receipt", () => {
    insertUnresolved(request());
    db.prepare("UPDATE projects SET user_id=? WHERE id='p1'").run(
      "did:chainless:new-owner",
    );
    actor = "did:chainless:new-owner";
    expect(service.listRuns({ taskId: "t1" })).toEqual({
      runs: [],
      nextCursor: null,
    });
    expect(service.readTask("t1")).toMatchObject({
      editable: false,
      reason: "ACTION_UNRESOLVED_ACTION",
    });
    expect(() => request()).toThrow("ACTION_UNRESOLVED_ACTION");
  });

  it("fails closed on damaged receipts without returning an empty history or admitting a new key", async () => {
    const prepared = request();
    const different = request("t1", "different-key");
    insertUnresolved(prepared);
    db.exec(
      "UPDATE cc_business_action_runs SET run_json='private broken json'",
    );
    expect(() => service.listRuns({ taskId: "t1" })).toThrow(
      "ACTION_RECEIPT_CORRUPT",
    );
    expect(service.readTask("t1")).toMatchObject({
      editable: false,
      reason: "ACTION_RECEIPT_CORRUPT",
    });
    expect(() => request("t1", "third-key")).toThrow("ACTION_RECEIPT_CORRUPT");
    await expect(service.execute(different)).rejects.toThrow(
      "ACTION_RECEIPT_CORRUPT",
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(["run_json", "evidence_json"])(
    "bounds damaged stored %s before history decoding",
    async (column) => {
      const first = await service.execute(request());
      db.prepare(
        `UPDATE cc_business_action_runs SET ${column}=? WHERE id=?`,
      ).run(JSON.stringify("private-extra-record".repeat(10000)), first.run.id);
      expect(() => service.getRun(first.run.id)).toThrow(
        "ACTION_RECEIPT_CORRUPT",
      );
      expect(() => service.listRuns({ taskId: "t1" })).toThrow(
        "ACTION_RECEIPT_CORRUPT",
      );
    },
  );

  it("validates strict read options, bounded limits and cursor IDs", () => {
    for (const limit of [0, 101, 1.5, "1", null])
      expect(() => service.listTasks({ projectId: "p1", limit })).toThrow(
        "ACTION_INVALID_LIMIT",
      );
    for (const limit of [0, 51, 1.5, "1", null])
      expect(() => service.listRuns({ taskId: "t1", limit })).toThrow(
        "ACTION_INVALID_LIMIT",
      );
    expect(() => service.listTasks({ projectId: "p1", actor: owner })).toThrow(
      "ACTION_INVALID_REQUEST",
    );
    expect(() =>
      service.listRuns({ taskId: "t1", beforeId: "../private" }),
    ).toThrow("ACTION_INVALID_ID");
    expect(() =>
      service.listRuns({ taskId: "t1", beforeId: "missing" }),
    ).toThrow("ACTION_INVALID_CURSOR");
    const getter = vi.fn(() => "p1");
    expect(() =>
      service.listTasks(
        Object.defineProperty({}, "projectId", {
          enumerable: true,
          get: getter,
        }),
      ),
    ).toThrow("ACTION_INVALID_REQUEST");
    expect(getter).not.toHaveBeenCalled();
  });
});
