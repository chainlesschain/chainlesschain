import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ProjectRiskReviewService,
} = require("../../../session-core/lib/project-risk-review-service.js");

describe("authorized native project risk snapshots and immutable review history", () => {
  const owner = "did:chainless:owner";
  const instant = 1791244800000;
  let directory, file, db, actor, now, service;
  function reopen() {
    if (db?.open) db.close();
    db = new Database(file);
    service = new ProjectRiskReviewService({
      db,
      getActor: () => actor,
      now: () => now,
    });
  }
  function review() {
    return service.evaluate({ projectId: "p1" });
  }
  function read(id) {
    return service.getReview({ reviewId: id });
  }
  function count() {
    return db
      .prepare("SELECT COUNT(*) AS total FROM cc_project_risk_reviews")
      .get().total;
  }
  function addTask(id, overrides = {}) {
    const task = {
      id,
      project_id: "p1",
      status: "pending",
      due_date: null,
      blocked_by: null,
      updated_at: instant - 1000,
      deleted: 0,
      org_id: null,
      workspace_id: null,
      ...overrides,
    };
    db.prepare(
      `INSERT INTO project_tasks
      (id,project_id,status,due_date,blocked_by,updated_at,deleted,org_id,workspace_id)
      VALUES (@id,@project_id,@status,@due_date,@blocked_by,@updated_at,@deleted,@org_id,@workspace_id)`,
    ).run(task);
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-project-risk-review-"));
    file = join(directory, "test.db");
    db = new Database(file);
    // Baseline SQL statuses, plus the actual enterprise migration's nullable columns.
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
      CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,
        description TEXT DEFAULT 'private task description',status TEXT CHECK(status IN ('pending','running','completed','failed')),
        updated_at INTEGER,deleted INTEGER DEFAULT 0,due_date INTEGER,blocked_by TEXT,org_id TEXT,workspace_id TEXT);
      CREATE TABLE organization_projects (id TEXT PRIMARY KEY,org_id TEXT);
      CREATE TABLE workspace_resources (workspace_id TEXT,resource_type TEXT,resource_id TEXT);`);
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      owner,
      "active",
      instant - 1000,
    );
    addTask("t1", { due_date: instant - 1 });
    actor = owner;
    now = instant;
    reopen();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("reads current owned rows, normalizes SQL NULL dependencies, and saves selected facts only", () => {
    const result = review();
    expect(result.review).toMatchObject({
      projectId: "p1",
      actorDid: owner,
      createdAt: "2026-10-06T00:00:00.000Z",
    });
    expect(result.sourceSnapshot).toMatchObject({
      sourceSchema: "desktop.project-tasks/v1",
      readStatus: "complete",
      tasks: [{ id: "t1", blocked_by: [] }],
    });
    expect(result.evaluation.status).toBe("evaluated");
    expect(result.evaluation.summary).toEqual({
      taskCount: 1,
      unresolvedTaskCount: 1,
      riskTaskCount: 1,
      overdueTaskCount: 1,
      blockedTaskCount: 0,
    });
    expect(count()).toBe(1);
    expect(Object.isFrozen(result.sourceSnapshot.tasks[0])).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private task description");
    expect(
      JSON.stringify(db.prepare("SELECT * FROM cc_project_risk_reviews").all()),
    ).not.toContain("private task description");
    expect(Object.hasOwn(result, "actionRun")).toBe(false);
    expect(Object.hasOwn(result, "approval")).toBe(false);
  });

  it("preserves the recorded asOf and source rows after reopen and later task changes", () => {
    const first = review();
    now += 86400000;
    db.prepare(
      "UPDATE project_tasks SET status='completed',updated_at=? WHERE id='t1'",
    ).run(now);
    reopen();
    expect(read(first.review.id)).toEqual(first);
    const next = review();
    expect(next.review.id).not.toBe(first.review.id);
    expect(next.sourceSnapshot.asOf).not.toBe(first.sourceSnapshot.asOf);
    expect(next.evaluation.summary.overdueTaskCount).toBe(0);
    expect(count()).toBe(2);
  });

  it("counts completed dependencies as satisfied and failed dependencies as unresolved", () => {
    addTask("done", { status: "completed" });
    addTask("failed", { status: "failed" });
    db.prepare("UPDATE project_tasks SET blocked_by=? WHERE id='t1'").run(
      '["done","failed"]',
    );
    const result = review();
    expect(
      result.evaluation.tasks[0].blockingTaskRefs.map((ref) => ref.id),
    ).toEqual(["failed"]);
  });

  it.each(["", "broken", "{}"])(
    "retains malformed dependency data %s as an insufficient review",
    (blockedBy) => {
      db.prepare("UPDATE project_tasks SET blocked_by=? WHERE id='t1'").run(
        blockedBy,
      );
      const result = review();
      expect(result.evaluation).toMatchObject({
        status: "insufficient-data",
        reasonCodes: ["INVALID_DEPENDENCIES"],
      });
      expect(result.sourceSnapshot.tasks[0].blocked_by).toBe(blockedBy);
      expect(read(result.review.id)).toEqual(result);
    },
  );

  it("does not hide missing, cross-project or deleted dependencies", () => {
    addTask("deleted", { deleted: 1 });
    addTask("other-project", { project_id: "p2" });
    for (const missing of ["deleted", "other-project", "absent"]) {
      db.prepare("UPDATE project_tasks SET blocked_by=? WHERE id='t1'").run(
        JSON.stringify([missing]),
      );
      expect(review().evaluation).toMatchObject({
        status: "insufficient-data",
        reasonCodes: ["MISSING_DEPENDENCY"],
      });
    }
  });

  it.each(["bad/id", "", " ", null])(
    "refuses invalid source task IDs without saving an unreadable review: %s",
    (id) => {
      db.prepare("UPDATE project_tasks SET id=? WHERE id='t1'").run(id);
      expect(() => review()).toThrow("PROJECT_RISK_SOURCE_INVALID");
      expect(count()).toBe(0);
    },
  );

  it("records an explicit schema-incomplete snapshot when risk columns are absent", () => {
    db.exec("ALTER TABLE project_tasks DROP COLUMN blocked_by");
    const result = review();
    expect(result.sourceSnapshot).toMatchObject({
      readStatus: "schema-incomplete",
      tasks: [],
    });
    expect(result.evaluation).toMatchObject({
      status: "insufficient-data",
      reasonCodes: ["SOURCE_SCHEMA_INCOMPLETE"],
    });
    expect(read(result.review.id)).toEqual(result);
  });

  it("accepts 1000 active tasks and refuses a truncated 1001-task assessment", () => {
    db.prepare("DELETE FROM project_tasks").run();
    db.transaction(() => {
      for (let index = 0; index < 1000; index++) addTask(`task-${index}`);
    })();
    const full = review();
    expect(full.evaluation.summary.taskCount).toBe(1000);
    addTask("overflow");
    const partial = review();
    expect(partial.sourceSnapshot).toMatchObject({
      readStatus: "task-limit-exceeded",
      tasks: [],
    });
    expect(partial.evaluation).toMatchObject({
      status: "insufficient-data",
      reasonCodes: ["TASK_LIMIT_EXCEEDED"],
      summary: null,
    });
    expect(read(partial.review.id)).toEqual(partial);
  });

  it.each([null, "device-123", "default-user"])(
    "refuses absent or non-DID identity %s",
    (value) => {
      actor = value;
      expect(() => review()).toThrow("PROJECT_RISK_AUTHENTICATION_REQUIRED");
      expect(count()).toBe(0);
    },
  );

  it("does not treat a device-ID/default-user owner as the current DID", () => {
    db.prepare("UPDATE projects SET user_id='device-123'").run();
    expect(() => review()).toThrow("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    expect(count()).toBe(0);
  });

  it.each(["deleted", "owner"])(
    "rechecks current project %s for historical reads",
    (kind) => {
      const recorded = review();
      if (kind === "deleted") db.prepare("UPDATE projects SET deleted=1").run();
      else db.prepare("UPDATE projects SET user_id='did:other'").run();
      expect(() => read(recorded.review.id)).toThrow(
        "PROJECT_RISK_NOT_FOUND_OR_DENIED",
      );
      expect(() => review()).toThrow("PROJECT_RISK_NOT_FOUND_OR_DENIED");
    },
  );

  it("hides another actor's review even when the project later belongs to them", () => {
    const recorded = review();
    actor = "did:other";
    db.prepare("UPDATE projects SET user_id=?").run(actor);
    expect(() => read(recorded.review.id)).toThrow(
      "PROJECT_RISK_NOT_FOUND_OR_DENIED",
    );
  });

  it.each(["org_id", "workspace_id"])(
    "rejects an entire project containing active scoped tasks: %s",
    (column) => {
      const recorded = review();
      addTask("scoped", { [column]: "org-or-workspace" });
      expect(() => review()).toThrow("PROJECT_RISK_ORGANIZATION_UNSUPPORTED");
      expect(() => read(recorded.review.id)).toThrow(
        "PROJECT_RISK_ORGANIZATION_UNSUPPORTED",
      );
      expect(count()).toBe(1);
    },
  );

  it("rejects organizational tasks beyond the collection limit without filtering them away", () => {
    db.transaction(() => {
      for (let index = 0; index < 1000; index++) addTask(`task-${index}`);
    })();
    addTask("zz-scope", { org_id: "org" });
    expect(() => review()).toThrow("PROJECT_RISK_ORGANIZATION_UNSUPPORTED");
  });

  it("excludes deleted organizational tasks consistently with personal action ownership", () => {
    addTask("old-scope", { org_id: "org", deleted: 1 });
    expect(review().evaluation.summary.taskCount).toBe(1);
  });

  it.each(["organization-project", "workspace-project", "workspace-task"])(
    "rejects association-only organization membership: %s",
    (kind) => {
      const recorded = review();
      if (kind === "organization-project")
        db.prepare(
          "INSERT INTO organization_projects VALUES ('p1','org')",
        ).run();
      else
        db.prepare(
          "INSERT INTO workspace_resources VALUES ('workspace',?,?)",
        ).run(
          kind === "workspace-project" ? "project" : "task",
          kind === "workspace-project" ? "p1" : "t1",
        );
      expect(() => review()).toThrow("PROJECT_RISK_ORGANIZATION_UNSUPPORTED");
      expect(() => read(recorded.review.id)).toThrow(
        "PROJECT_RISK_ORGANIZATION_UNSUPPORTED",
      );
    },
  );

  it.each(["deleted", "moved", "missing"])(
    "does not expose historical task references after current task access is revoked: %s",
    (kind) => {
      const recorded = review();
      if (kind === "deleted")
        db.prepare("UPDATE project_tasks SET deleted=1").run();
      if (kind === "moved")
        db.prepare("UPDATE project_tasks SET project_id='other'").run();
      if (kind === "missing") db.prepare("DELETE FROM project_tasks").run();
      expect(() => read(recorded.review.id)).toThrow(
        "PROJECT_RISK_NOT_FOUND_OR_DENIED",
      );
    },
  );

  it.each(["source_json", "evaluation_json", "content_digest", "created_at"])(
    "rejects corrupted stored %s",
    (column) => {
      const recorded = review();
      db.prepare(`UPDATE cc_project_risk_reviews SET ${column}=?`).run(
        column === "content_digest" ? "sha256:fake" : "{}",
      );
      expect(() => read(recorded.review.id)).toThrow(
        "PROJECT_RISK_REVIEW_CORRUPT",
      );
    },
  );

  it("recomputes the rule result even when a changed conclusion has a self-consistent content digest", () => {
    const recorded = JSON.parse(JSON.stringify(review()));
    recorded.evaluation.summary.overdueTaskCount = 0;
    const canonical = (value) => {
      if (value === null || typeof value !== "object")
        return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
        .join(",")}}`;
    };
    const digest = `sha256:${createHash("sha256").update(canonical(recorded)).digest("hex")}`;
    db.prepare(
      "UPDATE cc_project_risk_reviews SET evaluation_json=?,content_digest=?",
    ).run(JSON.stringify(recorded.evaluation), digest);
    expect(() => read(recorded.review.id)).toThrow(
      "PROJECT_RISK_REVIEW_CORRUPT",
    );
  });

  it("limits source allocation and leaves no record for oversized evidence", () => {
    db.prepare("UPDATE project_tasks SET blocked_by=?").run(
      "x".repeat(2 * 1024 * 1024 + 1),
    );
    expect(() => review()).toThrow("PROJECT_RISK_EVIDENCE_TOO_LARGE");
    expect(count()).toBe(0);
  });

  it.each([Infinity, Buffer.from("[]")])(
    "refuses non-JSON SQLite values instead of serializing changed facts: %s",
    (value) => {
      const column = typeof value === "number" ? "due_date" : "blocked_by";
      db.prepare(`UPDATE project_tasks SET ${column}=?`).run(value);
      expect(() => review()).toThrow("PROJECT_RISK_SOURCE_INVALID");
      expect(count()).toBe(0);
    },
  );

  it("rejects an oversized stored review before parsing its contents", () => {
    const recorded = review();
    db.prepare("UPDATE cc_project_risk_reviews SET source_json=?").run(
      "x".repeat(2 * 1024 * 1024 + 1),
    );
    expect(() => read(recorded.review.id)).toThrow(
      "PROJECT_RISK_REVIEW_CORRUPT",
    );
  });

  it("turns native read errors into fixed failures rather than empty successful reviews", () => {
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql) => {
      if (sql.includes("SELECT id,project_id,status"))
        throw new Error("database failure with secret details");
      return prepare(sql);
    });
    expect(() => review()).toThrow("PROJECT_RISK_READ_FAILED");
    expect(count()).toBe(0);
  });

  it("rolls back an aborted review insert without claiming a saved result", () => {
    db.exec(
      "CREATE TRIGGER reject_review BEFORE INSERT ON cc_project_risk_reviews BEGIN SELECT RAISE(ABORT,'save denied'); END",
    );
    expect(() => review()).toThrow("PROJECT_RISK_READ_FAILED");
    expect(count()).toBe(0);
  });

  it("refuses nested transactions and invalid caller-controlled identity fields", () => {
    expect(() => db.transaction(() => review())()).toThrow(
      "PROJECT_RISK_TRANSACTION_BUSY",
    );
    expect(() => service.evaluate({ projectId: "p1", actor: owner })).toThrow(
      "PROJECT_RISK_INVALID_REQUEST",
    );
    expect(() =>
      service.evaluate({ projectId: "p1", asOf: "2020-01-01T00:00:00.000Z" }),
    ).toThrow("PROJECT_RISK_INVALID_REQUEST");
    expect(count()).toBe(0);
  });

  it("does not invoke request accessors", () => {
    const getter = vi.fn(() => "p1");
    const input = Object.defineProperty({}, "projectId", {
      enumerable: true,
      get: getter,
    });
    expect(() => service.evaluate(input)).toThrow(
      "PROJECT_RISK_INVALID_REQUEST",
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects invalid host clocks and unsupported database handles", () => {
    now = NaN;
    expect(() => review()).toThrow("PROJECT_RISK_INVALID_CLOCK");
    expect(
      () => new ProjectRiskReviewService({ db: {}, getActor: () => owner }),
    ).toThrow("PROJECT_RISK_NATIVE_DATABASE_REQUIRED");
    expect(count()).toBe(0);
  });
});
