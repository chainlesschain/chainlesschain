import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  TaskDescriptionActionService,
  createTaskDescriptionPreview,
} = require("@chainlesschain/session-core/task-description-action-service");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");

describe("native personal task description action and durable evidence", () => {
  const owner = "did:chainless:owner";
  let directory, file, db, actor, confirm, service;
  function open() {
    db = new Database(file);
    service = new TaskDescriptionActionService({
      db,
      getActor: () => actor,
      approvalGate: new ApprovalGate({ confirm }),
    });
  }
  function request(
    description = "Reviewed description",
    key = "operation-one",
  ) {
    return service.preview({ taskId: "t1", description, idempotencyKey: key })
      .request;
  }
  function task() {
    return db.prepare("SELECT * FROM project_tasks WHERE id='t1'").get();
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-controlled-task-"));
    file = join(directory, "test.db");
    db = new Database(file);
    // Actual baseline task states; no enterprise title/created_by assumptions.
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,task_type TEXT NOT NULL,
        description TEXT NOT NULL,status TEXT CHECK(status IN ('pending','running','completed','failed')),
        updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT);
      CREATE TABLE organization_projects (id TEXT PRIMARY KEY,org_id TEXT);`);
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      owner,
      "active",
      10,
    );
    db.prepare("INSERT INTO project_tasks VALUES (?,?,?,?,?,?,0,?)").run(
      "t1",
      "p1",
      "query_info",
      "Original description",
      "pending",
      10,
      "synced",
    );
    db.close();
    actor = owner;
    confirm = vi.fn(async () => true);
    open();
  });
  afterEach(() => {
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("prepares the same version binding offline without claiming authority", () => {
    const offline = createTaskDescriptionPreview({
      task: task(),
      project: db.prepare("SELECT * FROM projects WHERE id='p1'").get(),
      description: "Reviewed description",
      idempotencyKey: "operation-one",
    });
    expect(offline.authority).toBe("unverified-snapshot");
    expect(offline.request).toEqual(request());
    expect(task().description).toBe("Original description");
  });

  it("commits the real edit and evidence together, retaining no input text in receipts", async () => {
    const prepared = request();
    const result = await service.execute(prepared);
    expect(result.run.status).toBe("succeeded");
    expect(result.run.afterVersion).not.toBe(prepared.expectedVersion);
    expect(task()).toMatchObject({
      description: "Reviewed description",
      sync_status: "pending",
    });
    expect(service.getRun(result.run.id)).toEqual({
      run: result.run,
      evidence: result.evidence,
    });
    const saved = JSON.stringify(
      db.prepare("SELECT * FROM cc_business_action_runs").all(),
    );
    for (const secret of [
      "Original description",
      "Reviewed description",
      "operation-one",
    ])
      expect(saved).not.toContain(secret);
    expect(result.evidence.map((e) => e.kind)).toEqual([
      "local-user-confirmation",
      "sqlite-task-description-update",
    ]);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: "strict",
        riskLevel: "high",
        actorDid: owner,
        request: prepared,
      }),
    );
  });

  it("returns a durable prior receipt after reopen without repeating confirmation or write", async () => {
    const prepared = request();
    const first = await service.execute(prepared);
    const updatedAt = task().updated_at;
    db.close();
    open();
    const replay = await service.execute(prepared);
    expect(replay.run).toEqual(first.run);
    expect(replay.replayed).toBe(true);
    expect(task().updated_at).toBe(updatedAt);
    expect(confirm).toHaveBeenCalledTimes(1);
    db.prepare("UPDATE project_tasks SET status='completed'").run();
    expect(service.getRun(first.run.id).run.status).toBe("succeeded");
    expect((await service.execute(prepared)).replayed).toBe(true);
    db.exec("ALTER TABLE project_tasks ADD COLUMN result_data TEXT");
    db.prepare("UPDATE project_tasks SET result_data=?,description=?").run(
      "large result".repeat(10000),
      "large description".repeat(1000),
    );
    expect(service.getRun(first.run.id).run.status).toBe("succeeded");
    expect((await service.execute(prepared)).run).toEqual(first.run);
  });

  it("rejects key reuse with a different action binding", async () => {
    await service.execute(request());
    await expect(
      service.execute(request("Different content")),
    ).rejects.toMatchObject({ code: "ACTION_IDEMPOTENCY_CONFLICT" });
    expect(task().description).toBe("Reviewed description");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("admits one concurrent attempt and returns its running receipt to duplicates", async () => {
    let decide;
    confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          decide = resolve;
        }),
    );
    const prepared = request();
    const pending = service.execute(prepared);
    const duplicate = await service.execute(prepared);
    expect(duplicate).toMatchObject({
      replayed: true,
      run: { status: "running" },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    decide(true);
    expect((await pending).run.status).toBe("succeeded");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM cc_business_action_runs").get()
        .count,
    ).toBe(1);
  });

  it("leaves an interrupted running admission blocked after reopening", async () => {
    confirm.mockImplementation(() => new Promise(() => {}));
    const prepared = request();
    void service.execute(prepared);
    db.close();
    open();
    const recovered = await service.execute(prepared);
    expect(recovered).toMatchObject({
      replayed: true,
      executionState: "unresolved",
      run: { status: "running" },
    });
    expect(task().description).toBe("Original description");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("rolls back the source edit when its success receipt cannot be saved", async () => {
    db.exec(`CREATE TRIGGER deny_success_receipt BEFORE UPDATE ON cc_business_action_runs
      WHEN json_extract(NEW.run_json,'$.status')='succeeded' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;`);
    const prepared = request();
    await expect(service.execute(prepared)).rejects.toMatchObject({
      code: "ACTION_OUTCOME_UNKNOWN",
    });
    expect(task().description).toBe("Original description");
    db.close();
    open();
    const again = await service.execute(prepared);
    expect(again.run.status).toBe("running");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("records cancellation and never reuses it to write", async () => {
    confirm.mockResolvedValue(false);
    const prepared = request();
    const cancelled = await service.execute(prepared);
    expect(cancelled.run).toMatchObject({
      status: "cancelled",
      afterVersion: null,
      executionRef: null,
    });
    confirm.mockResolvedValue(true);
    expect((await service.execute(prepared)).run.status).toBe("cancelled");
    expect(task().description).toBe("Original description");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("records a failed confirmation as a gate denial, not a user's cancellation", async () => {
    confirm.mockRejectedValue(new Error("private native dialog failure"));
    const denied = await service.execute(request());
    expect(denied.run.status).toBe("denied");
    expect(denied.evidence[0]).toMatchObject({
      kind: "approval-gate-decision",
      via: "confirm-error",
    });
    expect(JSON.stringify(denied)).not.toContain(
      "private native dialog failure",
    );
    expect(task().description).toBe("Original description");
  });

  it("checks the actual resulting field before issuing success evidence", async () => {
    db.exec(
      "CREATE TRIGGER alter_description AFTER UPDATE ON project_tasks BEGIN UPDATE project_tasks SET description='unexpected result' WHERE id=NEW.id; END",
    );
    await expect(service.execute(request())).rejects.toThrow(
      "ACTION_OUTCOME_UNKNOWN",
    );
    expect(task().description).toBe("Original description");
  });

  it.each(["description", "updated_at", "status"])(
    "rejects a stale %s before confirmation",
    async (field) => {
      const prepared = request();
      const sql = {
        description: "UPDATE project_tasks SET description='Other writer'",
        updated_at: "UPDATE project_tasks SET updated_at=11",
        status: "UPDATE project_tasks SET status='running'",
      }[field];
      db.exec(sql);
      await expect(service.execute(prepared)).rejects.toThrow();
      expect(confirm).not.toHaveBeenCalled();
      expect(
        db
          .prepare("SELECT COUNT(*) AS count FROM cc_business_action_runs")
          .get().count,
      ).toBe(0);
    },
  );

  it("checks concurrent source changes again after confirmation", async () => {
    const prepared = request();
    confirm.mockImplementation(async () => {
      db.exec("UPDATE project_tasks SET description='Concurrent edit'");
      return true;
    });
    await expect(service.execute(prepared)).rejects.toMatchObject({
      code: "ACTION_VERSION_CONFLICT",
    });
    expect(task().description).toBe("Concurrent edit");
    const row = db
      .prepare("SELECT run_json FROM cc_business_action_runs")
      .get();
    expect(JSON.parse(row.run_json).status).toBe("denied");
  });

  it("rechecks ownership after confirmation and denies later receipt access after ownership transfer", async () => {
    const first = await service.execute(request());
    const prepared = request("Next description", "operation-two");
    confirm.mockImplementation(async () => {
      db.prepare("UPDATE projects SET user_id=?").run("did:chainless:other");
      return true;
    });
    await expect(service.execute(prepared)).rejects.toMatchObject({
      code: "ACTION_NOT_FOUND_OR_DENIED",
    });
    expect(task().description).toBe("Reviewed description");
    expect(() => service.getRun(first.run.id)).toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
  });

  it("does not accept an offline owner claim or a forged approval as authority", async () => {
    const prepared = request();
    actor = "did:chainless:other";
    await expect(service.execute(prepared)).rejects.toThrow(
      "ACTION_NOT_FOUND_OR_DENIED",
    );
    actor = owner;
    await expect(
      service.execute({ ...prepared, approved: true }),
    ).rejects.toThrow("ACTION_INVALID_REQUEST");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("refuses organization and workspace paths including legacy organization mapping", () => {
    db.exec("INSERT INTO organization_projects VALUES ('p1','org1')");
    expect(() => request()).toThrow("ACTION_ORGANIZATION_UNSUPPORTED");
    db.exec(
      "DELETE FROM organization_projects; ALTER TABLE project_tasks ADD COLUMN workspace_id TEXT; UPDATE project_tasks SET workspace_id='w1'",
    );
    expect(() => request()).toThrow("ACTION_ORGANIZATION_UNSUPPORTED");
  });

  it.each([
    {
      decision: "allow",
      via: "policy",
      policy: "autopilot",
      riskLevel: "high",
    },
    {
      decision: "allow",
      via: "user-confirm",
      policy: "strict",
      riskLevel: "high",
      authorization: { unconsumed: true },
    },
  ])(
    "requires direct native confirmation and refuses unconsumed authorization handles",
    async (decision) => {
      service.approvalGate = { decide: async () => decision };
      expect((await service.execute(request())).run.status).toBe("denied");
      expect(task().description).toBe("Original description");
    },
  );

  it("rejects damaged stored evidence without returning it as verified lineage", async () => {
    const result = await service.execute(request());
    db.prepare("UPDATE cc_business_action_runs SET evidence_json=?").run("[]");
    expect(() => service.getRun(result.run.id)).toThrow(
      "ACTION_RECEIPT_CORRUPT",
    );
  });

  it("requires a bijection between evidence records and references", async () => {
    const result = await service.execute(request());
    db.prepare("UPDATE cc_business_action_runs SET evidence_json=?").run(
      JSON.stringify([result.evidence[0], result.evidence[0]]),
    );
    expect(() => service.getRun(result.run.id)).toThrow(
      "ACTION_RECEIPT_CORRUPT",
    );
  });

  it("bounds descriptions and refuses native writes inside another caller's transaction", () => {
    expect(() => request("界".repeat(3000))).toThrow(
      "ACTION_INVALID_DESCRIPTION",
    );
    db.exec("BEGIN");
    try {
      expect(() => request()).toThrow("ACTION_TRANSACTION_BUSY");
    } finally {
      db.exec("ROLLBACK");
    }
  });
});
