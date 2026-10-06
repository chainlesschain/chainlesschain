import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  PersonalProjectGoalService,
} = require("@chainlesschain/session-core/project-goal-service");
const owner = "did:chainless:owner";

describe("native personal project goal repository", () => {
  let directory, file, db, actor, service;
  function open() {
    db = new Database(file);
    service = new PersonalProjectGoalService({ db, getActor: () => actor });
  }
  function create() {
    return service.create({
      projectId: "p1",
      objective: "Follow delivery risk",
    });
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cc-project-goal-"));
    file = join(directory, "project.db");
    actor = owner;
    open();
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0)",
    );
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p1",
      owner,
      "active",
      10,
    );
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,0)").run(
      "p2",
      "did:other",
      "active",
      10,
    );
  });
  afterEach(() => {
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it("creates a host-owned idle record and preserves it across actual reopen", () => {
    const goal = create();
    expect(goal).toMatchObject({
      ownerRef: owner,
      revision: 1,
      controlGeneration: 0,
      executionState: "idle",
      projectRef: { id: "p1", scope: { kind: "personal", id: owner } },
    });
    expect(goal.triggerRefs).toEqual([]);
    expect(service.list({ projectId: "p1" })).toEqual([goal]);
    db.close();
    open();
    expect(service.get({ id: goal.id })).toEqual(goal);
  });
  it("checks CAS inside a real transaction and invalidates old control generations", () => {
    const goal = create();
    const next = service.revise({
      id: goal.id,
      expectedRevision: 1,
      patch: { status: "paused" },
    });
    expect(next).toMatchObject({
      revision: 2,
      controlGeneration: 1,
      status: "paused",
    });
    expect(() =>
      service.revise({
        id: goal.id,
        expectedRevision: 1,
        patch: { objective: "Stale" },
      }),
    ).toThrow("GOAL_REVISION_CONFLICT");
    expect(service.get({ id: goal.id })).toEqual(next);
  });
  it("rejects supplied identities, privilege patches and caller completion claims", () => {
    expect(() =>
      service.create({
        projectId: "p1",
        objective: "X",
        ownerRef: "did:other",
      }),
    ).toThrow("GOAL_INVALID_REQUEST");
    const goal = create();
    expect(() =>
      service.revise({
        id: goal.id,
        expectedRevision: 1,
        patch: { ownerRef: "did:other" },
      }),
    ).toThrow("GOAL_INVALID_FIELDS");
    expect(() =>
      service.revise({
        id: goal.id,
        expectedRevision: 1,
        patch: { status: "done" },
      }),
    ).toThrow("GOAL_COMPLETION_EVIDENCE_REQUIRED");
    expect(() =>
      service.complete({
        id: goal.id,
        expectedRevision: 1,
        proof: { met: true },
      }),
    ).toThrow("GOAL_INVALID_REQUEST");
    expect(() =>
      service.complete({ id: goal.id, expectedRevision: 1 }),
    ).toThrow("GOAL_VERIFIER_UNAVAILABLE");
    expect(service.get({ id: goal.id }).revision).toBe(1);
  });
  it("resolves identity per operation and denies revoked project ownership", () => {
    const goal = create();
    actor = "did:other";
    expect(service.get({ id: goal.id })).toBeNull();
    expect(() => service.list({ projectId: "p1" })).toThrow(
      "GOAL_NOT_FOUND_OR_DENIED",
    );
    expect(() => service.create({ projectId: "p1", objective: "X" })).toThrow(
      "GOAL_NOT_FOUND_OR_DENIED",
    );
    actor = owner;
    db.prepare("UPDATE projects SET user_id=? WHERE id='p1'").run("did:other");
    expect(() => service.get({ id: goal.id })).toThrow(
      "GOAL_NOT_FOUND_OR_DENIED",
    );
    expect(() =>
      service.revise({
        id: goal.id,
        expectedRevision: 1,
        patch: { status: "paused" },
      }),
    ).toThrow("GOAL_NOT_FOUND_OR_DENIED");
  });
  it.each(["organization", "workspace", "direct-column"])(
    "denies %s resources on current reads",
    (kind) => {
      const goal = create();
      if (kind === "organization")
        db.exec(
          "CREATE TABLE organization_projects(id TEXT PRIMARY KEY,org_id TEXT);INSERT INTO organization_projects VALUES ('p1','org1')",
        );
      if (kind === "workspace")
        db.exec(
          "CREATE TABLE workspace_resources(resource_type TEXT,resource_id TEXT);INSERT INTO workspace_resources VALUES ('project','p1')",
        );
      if (kind === "direct-column")
        db.exec(
          "ALTER TABLE projects ADD COLUMN org_id TEXT;UPDATE projects SET org_id='org1' WHERE id='p1'",
        );
      expect(() => service.get({ id: goal.id })).toThrow(
        "GOAL_ORGANIZATION_UNSUPPORTED",
      );
      expect(() => create()).toThrow("GOAL_ORGANIZATION_UNSUPPORTED");
    },
  );
  it("rolls back when identity changes during a transform, rechecking before write", () => {
    const goal = create();
    expect(() =>
      service.adapter.compareAndSwap(goal.id, 1, (current) => {
        actor = "did:other";
        return { ...current, revision: 2 };
      }),
    ).toThrow("GOAL_IDENTITY_CHANGED");
    actor = owner;
    expect(service.get({ id: goal.id })).toEqual(goal);
  });
  it("rolls back transformed content when storage rejects the write", () => {
    const goal = create();
    db.exec(
      "CREATE TRIGGER refuse_goal_write BEFORE UPDATE ON cc_project_goals BEGIN SELECT RAISE(ABORT,'test failure'); END",
    );
    expect(() =>
      service.revise({
        id: goal.id,
        expectedRevision: 1,
        patch: { objective: "New" },
      }),
    ).toThrow("GOAL_STORAGE_FAILED");
    expect(service.get({ id: goal.id })).toEqual(goal);
  });
  it("rejects corrupt metadata and oversize source records", () => {
    const goal = create();
    db.prepare("UPDATE cc_project_goals SET revision=99 WHERE id=?").run(
      goal.id,
    );
    expect(() => service.get({ id: goal.id })).toThrow("GOAL_RECORD_CORRUPT");
    db.prepare(
      "UPDATE cc_project_goals SET revision=1,goal_json=? WHERE id=?",
    ).run("x".repeat(65537), goal.id);
    expect(() => service.get({ id: goal.id })).toThrow("GOAL_RECORD_CORRUPT");
  });
  it("bounds pagination and does not list another actor's project", () => {
    create();
    create();
    const first = service.list({ projectId: "p1", limit: 1 });
    const next = service.list({
      projectId: "p1",
      afterId: first[0].id,
      limit: 1,
    });
    expect(first).toHaveLength(1);
    expect(next).toHaveLength(1);
    expect(next[0].id).not.toBe(first[0].id);
    expect(() => service.list({ projectId: "p1", limit: 51 })).toThrow(
      "GOAL_INVALID_LIMIT",
    );
    expect(() => service.list({ projectId: "p2" })).toThrow(
      "GOAL_NOT_FOUND_OR_DENIED",
    );
  });
});
