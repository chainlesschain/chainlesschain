import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import {
  createGoal,
  getGoal,
  createGoalFileAdapter,
  recordProgress,
  deleteGoal,
  freezeGoalForProject,
  restoreTransferredGoal,
  goalFileStoreId,
  listGoals,
} from "../../src/lib/goal-store.js";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  ProjectGoalTransferService,
} = require("@chainlesschain/session-core/project-goal-transfer");
const {
  PersonalProjectGoalService,
} = require("@chainlesschain/session-core/project-goal-service");
const {
  createGoalTransfer,
  validateGoalTransfer,
  verifyGoalTransferCancellation,
} = require("@chainlesschain/session-core/goal-transfer-contract");
const owner = "did:chainless:owner";

describe("explicit CLI to native project goal handoff", () => {
  let root, db, actor, service, goal, descriptor, output, dbFile;
  const sourceFile = () => path.join(root, `${goal.id}.json`);
  const options = () => ({ root });
  const freeze = (target = descriptor) =>
    freezeGoalForProject(
      goal.id,
      { target, output, expectedRevision: 1 },
      options(),
    );
  const packet = () => JSON.parse(fs.readFileSync(output, "utf8"));
  const goals = () =>
    new PersonalProjectGoalService({ db, getActor: () => actor });
  function open() {
    db = new Database(dbFile);
    service = new ProjectGoalTransferService({ db, getActor: () => actor });
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-transfer-"));
    dbFile = path.join(root, "project.db");
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
      owner,
      "active",
      10,
    );
    goal = createGoal(
      {
        objective: "Deliver a real project",
        keyResults: ["Complete task A", "Check task B"],
      },
      options(),
    );
    descriptor = service.prepare({
      projectId: "p1",
      requestId: "handoff-1",
    }).target;
    output = path.join(root, "handoff.export");
  });
  afterEach(() => {
    if (db?.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("freezes all source write paths, retains exact bytes, imports once and stores the original mapping", () => {
    const raw = fs.readFileSync(sourceFile(), "utf8"),
      result = freeze();
    expect(fs.readFileSync(result.backupFile, "utf8")).toBe(raw);
    expect(fs.existsSync(sourceFile())).toBe(false);
    expect(getGoal(goal.id, options())).toBeNull();
    expect(listGoals(options())).toEqual([]);
    expect(() => recordProgress(goal.id, { progress: 50 }, options())).toThrow(
      "GOAL_TRANSFER_FROZEN",
    );
    expect(() => deleteGoal(goal.id, options())).toThrow(
      "GOAL_TRANSFER_FROZEN",
    );
    expect(() =>
      createGoal({ id: goal.id, objective: "replace" }, options()),
    ).toThrow("GOAL_TRANSFER_FROZEN");
    const adapter = createGoalFileAdapter(options());
    expect(() => adapter.get(goal.id)).toThrow("GOAL_TRANSFER_FROZEN");
    expect(adapter.list()).toEqual([]);
    expect(() => adapter.compareAndSwap(goal.id, 1, (g) => g)).toThrow();
    const imported = service.importTransfer(packet());
    expect(imported.state).toBe("imported");
    expect(imported.source).toEqual({
      storeId: goalFileStoreId(root),
      id: goal.id,
      revision: 1,
      digest: packet().source.digest,
    });
    expect(imported.goal).toMatchObject({
      ownerRef: owner,
      status: "paused",
      revision: 1,
      controlGeneration: 0,
      objective: goal.objective,
      executionState: "idle",
      triggerRefs: [],
      allowedActionTypes: [],
      authorizationRefs: [],
      memoryRefs: [],
      completion: null,
    });
    expect(imported.goal.id).not.toBe(goal.id);
    expect(imported.goal.keyResults).toEqual(goal.keyResults);
    expect(service.importTransfer(packet()).goal.id).toBe(imported.goal.id);
    expect(goals().list({ projectId: "p1" })).toHaveLength(1);
    expect(service.status({ targetId: descriptor.id })).not.toHaveProperty(
      "backup",
    );
    db.close();
    open();
    expect(service.importTransfer(packet()).goal.id).toBe(imported.goal.id);
    expect(freeze().digest).toBe(result.digest);
  });
  it("atomically cancels an untouched target and restores the original adapter bytes", () => {
    const raw = fs.readFileSync(sourceFile(), "utf8");
    freeze();
    const imported = service.importTransfer(packet());
    const cancelled = service.cancel({ targetId: descriptor.id });
    expect(goals().get({ id: imported.goal.id })).toBeNull();
    expect(
      verifyGoalTransferCancellation(cancelled.cancellation, descriptor).state,
    ).toBe("cancelled");
    expect(
      restoreTransferredGoal(goal.id, cancelled.cancellation, options()).state,
    ).toBe("restored");
    expect(fs.readFileSync(sourceFile(), "utf8")).toBe(raw);
    expect(getGoal(goal.id, options())).toEqual(goal);
    expect(() => service.importTransfer(packet())).toThrow(
      "GOAL_TRANSFER_CANCELLED",
    );
    expect(service.cancel({ targetId: descriptor.id })).toEqual(cancelled);
    expect(
      restoreTransferredGoal(goal.id, cancelled.cancellation, options()).state,
    ).toBe("restored");
    recordProgress(goal.id, { progress: 12 }, options());
    restoreTransferredGoal(goal.id, cancelled.cancellation, options());
    expect(getGoal(goal.id, options()).revision).toBe(2);
  });
  it("cancels before import or after failed import without resurrecting an old package", () => {
    freeze();
    const cancelled = service.cancel({ targetId: descriptor.id });
    restoreTransferredGoal(goal.id, cancelled.cancellation, options());
    expect(() => service.importTransfer(packet())).toThrow(
      "GOAL_TRANSFER_CANCELLED",
    );
    expect(goals().list({ projectId: "p1" })).toEqual([]);
  });
  it("rejects unsigned, modified and other-target cancellation receipts", () => {
    freeze();
    const receipt = service.cancel({ targetId: descriptor.id }).cancellation;
    expect(() =>
      restoreTransferredGoal(
        goal.id,
        { ...receipt, signature: "A".repeat(86) + "==" },
        options(),
      ),
    ).toThrow();
    expect(() =>
      restoreTransferredGoal(
        goal.id,
        { ...receipt, at: new Date(Date.now() + 10000).toISOString() },
        options(),
      ),
    ).toThrow();
    const other = service.prepare({ projectId: "p1", requestId: "other" });
    expect(() =>
      restoreTransferredGoal(
        goal.id,
        service.cancel({ targetId: other.target.id }).cancellation,
        options(),
      ),
    ).toThrow();
    expect(getGoal(goal.id, options())).toBeNull();
  });
  it("never rolls back over a revised goal", () => {
    freeze();
    const imported = service.importTransfer(packet());
    goals().revise({
      id: imported.goal.id,
      expectedRevision: 1,
      patch: { objective: "New project work" },
    });
    expect(() => service.cancel({ targetId: descriptor.id })).toThrow(
      "GOAL_TRANSFER_ROLLBACK_HAS_CHANGES",
    );
    expect(service.status({ targetId: descriptor.id }).state).toBe("imported");
    expect(getGoal(goal.id, options())).toBeNull();
  });
  it("rejects rollback over independent goal activity even without a changed revision", () => {
    freeze();
    const imported = service.importTransfer(packet());
    db.exec(
      "CREATE TABLE cc_project_goal_future_adapter(goal_id TEXT PRIMARY KEY,result TEXT)",
    );
    db.prepare("INSERT INTO cc_project_goal_future_adapter VALUES (?,?)").run(
      imported.goal.id,
      "unknown",
    );
    expect(() => service.cancel({ targetId: descriptor.id })).toThrow(
      "GOAL_TRANSFER_ROLLBACK_HAS_CHANGES",
    );
    expect(goals().get({ id: imported.goal.id })).not.toBeNull();
  });
  it("rolls back the goal insertion when journal persistence fails", () => {
    freeze();
    db.exec(
      "CREATE TRIGGER fail_import BEFORE UPDATE ON cc_project_goal_transfers BEGIN SELECT RAISE(ABORT,'fail journal'); END",
    );
    expect(() => service.importTransfer(packet())).toThrow(
      "GOAL_STORAGE_FAILED",
    );
    expect(goals().list({ projectId: "p1" })).toEqual([]);
    expect(service.status({ targetId: descriptor.id }).state).toBe("prepared");
    db.exec("DROP TRIGGER fail_import");
    expect(service.importTransfer(packet()).state).toBe("imported");
  });
  it("rolls back deletion if signing or cancellation persistence fails", () => {
    freeze();
    const imported = service.importTransfer(packet());
    db.exec(
      "CREATE TRIGGER fail_cancel BEFORE UPDATE ON cc_project_goal_transfers BEGIN SELECT RAISE(ABORT,'fail journal'); END",
    );
    expect(() => service.cancel({ targetId: descriptor.id })).toThrow(
      "GOAL_STORAGE_FAILED",
    );
    expect(goals().get({ id: imported.goal.id })).not.toBeNull();
    expect(service.status({ targetId: descriptor.id }).state).toBe("imported");
  });
  it("pins the target to its current owner, project and database", () => {
    freeze();
    actor = "did:other";
    expect(() => service.importTransfer(packet())).toThrow(
      "GOAL_NOT_FOUND_OR_DENIED",
    );
    expect(() => service.status({ targetId: descriptor.id })).toThrow(
      "GOAL_NOT_FOUND_OR_DENIED",
    );
    actor = owner;
    db.prepare("UPDATE projects SET updated_at=11 WHERE id='p1'").run();
    expect(() => service.importTransfer(packet())).toThrow(
      "GOAL_PROJECT_VERSION_CONFLICT",
    );
    // Version change does not prevent durable cancellation while ownership is valid.
    expect(service.cancel({ targetId: descriptor.id }).state).toBe("cancelled");
  });
  it("does not import to an organization-bound project", () => {
    db.exec("ALTER TABLE projects ADD COLUMN org_id TEXT");
    db.prepare("UPDATE projects SET org_id='org1' WHERE id='p1'").run();
    expect(() =>
      service.prepare({ projectId: "p1", requestId: "new" }),
    ).toThrow("GOAL_ORGANIZATION_UNSUPPORTED");
  });
  it("does not accept a changed target or source snapshot", () => {
    freeze();
    const value = packet();
    expect(() =>
      service.importTransfer({ ...value, backup: value.backup + " " }),
    ).toThrow("GOAL_TRANSFER_INVALID");
    const other = service.prepare({ projectId: "p2", requestId: "new" }).target;
    const changed = createGoalTransfer({
      target: { ...other, id: descriptor.id },
      backup: value.backup,
      storeId: value.source.storeId,
    });
    expect(() => service.importTransfer(changed)).toThrow(
      "GOAL_TRANSFER_TARGET_MISMATCH",
    );
  });
  it("forbids a second active mapping for the same standalone goal", () => {
    freeze();
    service.importTransfer(packet());
    const other = service.prepare({ projectId: "p2", requestId: "new" }).target;
    const duplicate = createGoalTransfer({
      target: other,
      backup: packet().backup,
      storeId: packet().source.storeId,
    });
    expect(() => service.importTransfer(duplicate)).toThrow(
      "GOAL_TRANSFER_SOURCE_ALREADY_IMPORTED",
    );
    expect(goals().list({ projectId: "p2" })).toEqual([]);
  });
  it("preserves old unversioned bytes and source completion claims only as history", () => {
    const old = {
      id: goal.id,
      objective: "Legacy done",
      status: "done",
      progress: 100,
      keyResults: [],
      createdAt: goal.createdAt,
    };
    const raw = JSON.stringify(old, null, 1) + "\n";
    fs.writeFileSync(sourceFile(), raw);
    freeze();
    const result = service.importTransfer(packet());
    expect(result.goal).toMatchObject({
      objective: "Legacy done",
      progress: 100,
      status: "paused",
      completion: null,
    });
    const receipt = service.cancel({ targetId: descriptor.id }).cancellation;
    restoreTransferredGoal(goal.id, receipt, options());
    expect(fs.readFileSync(sourceFile(), "utf8")).toBe(raw);
  });
  it("validates source revision before freezing and leaves it fully usable on rejection", () => {
    expect(() =>
      freezeGoalForProject(
        goal.id,
        { target: descriptor, output, expectedRevision: 2 },
        options(),
      ),
    ).toThrow("GOAL_REVISION_CONFLICT");
    expect(getGoal(goal.id, options())).toEqual(goal);
    expect(fs.existsSync(sourceFile() + ".transfer")).toBe(false);
  });
  it("refuses active triggers and execution rather than migrating their authority", () => {
    const edited = { ...goal, nextCheckAt: new Date().toISOString() };
    fs.writeFileSync(sourceFile(), JSON.stringify(edited));
    expect(() => freeze()).toThrow("GOAL_TRANSFER_INVALID");
    expect(fs.existsSync(sourceFile())).toBe(true);
  });
  it("does not overwrite an existing export", () => {
    fs.writeFileSync(output, "keep");
    expect(() => freeze()).toThrow("GOAL_TRANSFER_OUTPUT_EXISTS");
    expect(getGoal(goal.id, options())).toEqual(goal);
    expect(fs.readFileSync(output, "utf8")).toBe("keep");
  });
  it("keeps a failed export frozen and resumes only the original destination", () => {
    output = path.join(root, "missing", "export");
    expect(() => freeze()).toThrow();
    expect(getGoal(goal.id, options())).toBeNull();
    const other = service.prepare({ projectId: "p1", requestId: "new" }).target;
    expect(() => freeze(other)).toThrow("GOAL_TRANSFER_CONFLICT");
    fs.mkdirSync(path.dirname(output));
    expect(freeze().state).toBe("frozen");
    expect(service.importTransfer(packet()).state).toBe("imported");
  });
  it("recovers a durable freeze journal created before the source rename", () => {
    const raw = fs.readFileSync(sourceFile(), "utf8");
    freeze();
    fs.writeFileSync(sourceFile(), raw);
    fs.unlinkSync(output);
    expect(freeze().state).toBe("frozen");
    expect(fs.existsSync(sourceFile())).toBe(false);
    expect(service.importTransfer(packet()).state).toBe("imported");
  });
  it("recovers interrupted source restoration without exposing an active source early", () => {
    freeze();
    const receipt = service.cancel({ targetId: descriptor.id }).cancellation;
    const file = sourceFile() + ".transfer",
      marker = JSON.parse(fs.readFileSync(file, "utf8"));
    marker.state = "restoring";
    marker.cancellation = receipt;
    fs.writeFileSync(file, JSON.stringify(marker));
    expect(getGoal(goal.id, options())).toBeNull();
    expect(restoreTransferredGoal(goal.id, receipt, options()).state).toBe(
      "restored",
    );
    expect(getGoal(goal.id, options())).toEqual(goal);
  });
  it("refuses to overwrite a source changed outside the aware adapter", () => {
    freeze();
    const receipt = service.cancel({ targetId: descriptor.id }).cancellation;
    fs.writeFileSync(sourceFile(), "unrelated new data");
    expect(() => restoreTransferredGoal(goal.id, receipt, options())).toThrow(
      "GOAL_TRANSFER_SOURCE_CHANGED",
    );
    expect(fs.readFileSync(sourceFile(), "utf8")).toBe("unrelated new data");
  });
  it("rejects corrupted journals and oversized or invalid UTF-8 sources before transfer", () => {
    fs.writeFileSync(sourceFile(), Buffer.from([0xff]));
    expect(() => freeze()).toThrow();
    fs.writeFileSync(sourceFile(), "x".repeat(65537));
    expect(() => freeze()).toThrow();
    fs.writeFileSync(sourceFile() + ".transfer", "{}");
    expect(() => getGoal(goal.id, options())).toThrow(
      "GOAL_TRANSFER_RECORD_CORRUPT",
    );
  });
  it("requires strict source exclusion and does not modify an unavailable live lock", () => {
    const dir = sourceFile() + ".lock";
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
        token: "live-owner",
      }),
    );
    expect(() => freeze()).toThrow("Could not acquire state lock");
    expect(fs.existsSync(sourceFile() + ".transfer")).toBe(false);
    expect(getGoal(goal.id, options())).toEqual(goal);
  });
  it("does not allow accessors to execute while validating a transfer", () => {
    freeze();
    const value = packet();
    let executed = false;
    Object.defineProperty(value, "backup", {
      enumerable: true,
      get() {
        executed = true;
        return "";
      },
    });
    expect(() => validateGoalTransfer(value)).toThrow();
    expect(executed).toBe(false);
  });
  it("keeps an expired target cancellable but never imports after its deadline", () => {
    freeze();
    const expired = new ProjectGoalTransferService({
      db,
      getActor: () => actor,
      clock: () => Date.parse(descriptor.expiresAt),
    });
    expect(() => expired.importTransfer(packet())).toThrow(
      "GOAL_TRANSFER_TARGET_EXPIRED",
    );
    const cancellation = expired.cancel({
      targetId: descriptor.id,
    }).cancellation;
    restoreTransferredGoal(goal.id, cancellation, options());
    expect(getGoal(goal.id, options())).toEqual(goal);
  });
  it("does not accept personal project authority disguised as an unversioned CLI backup", () => {
    const original = {
      id: goal.id,
      objective: "Owned",
      status: "active",
      ownerRef: owner,
      createdAt: goal.createdAt,
    };
    expect(() =>
      createGoalTransfer({
        target: descriptor,
        backup: JSON.stringify(original),
        storeId: goalFileStoreId(root),
      }),
    ).toThrow("GOAL_TRANSFER_INVALID");
  });
  it("resumes a semantically identical target regardless of JSON property order", () => {
    const result = freeze();
    expect(
      freeze(Object.fromEntries(Object.entries(descriptor).reverse())).digest,
    ).toBe(result.digest);
  });
  it("fails closed if a retained native backup or its source mapping is corrupted", () => {
    freeze();
    service.importTransfer(packet());
    db.prepare(
      "UPDATE cc_project_goal_transfers SET record_digest='sha256:bad' WHERE id=?",
    ).run(descriptor.id);
    expect(() => service.status({ targetId: descriptor.id })).toThrow(
      "GOAL_TRANSFER_RECORD_CORRUPT",
    );
    expect(() => service.cancel({ targetId: descriptor.id })).toThrow(
      "GOAL_TRANSFER_RECORD_CORRUPT",
    );
  });
});
