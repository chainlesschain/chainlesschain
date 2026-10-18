import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { ApprovalGate } = require("../../../session-core/lib/approval-gate.js");
const {
  ProjectGoalWorkflow,
} = require("../../../session-core/lib/project-goal-workflow.js");
const {
  ProjectGoalExternalDrafts,
} = require("../../../session-core/lib/project-goal-external-drafts.js");
const {
  ProjectGoalExtensionQueue,
} = require("../../../session-core/lib/project-goal-extension-queue.js");
const {
  digestBusinessObjectContent: digest,
} = require("../../../session-core/lib/business-object-contract.js");
const owner = "did:chainless:owner";
const plugin = {
  name: "delivery-extension",
  scope: "project",
  version: "1.0.0",
};
const access = {
  schema: "chainlesschain.goal-draft-access/v1",
  plugin,
  declarationDigest: digest({ proposals: ["task.description.update"] }),
};
let directory, db, workflow, external, actor, goal, source, now, confirm;
function open() {
  db = new Database(path.join(directory, "project.sqlite"));
  workflow = new ProjectGoalWorkflow({
    db,
    getActor: () => actor,
    clock: () => now,
    approvalGate: new ApprovalGate({ confirm: (...args) => confirm(...args) }),
    verifyExtensionIntent: (context) =>
      external.verifyIntentInTransaction(context),
  });
  external = new ProjectGoalExternalDrafts({ workflow, clock: () => now });
}
function ref() {
  return {
    id: goal.id,
    storeId: goal.storeId,
    revision: goal.revision,
    controlGeneration: goal.controlGeneration,
  };
}
function authorize(nextAccess = access, expectedEpoch) {
  expectedEpoch ??= external.grantStatus({
    goalRef: ref(),
    access: nextAccess,
  }).epoch;
  return external.grant({ goalRef: ref(), access: nextAccess, expectedEpoch });
}
function lease(grant) {
  return { goalRef: ref(), grantRef: { id: grant.id, epoch: grant.epoch } };
}
function proposal(extra = {}) {
  return {
    type: "task.description.update",
    goalRef: ref(),
    sourceRef: source.id,
    requestId: "request-1",
    title: "Review delivery",
    description: "Review deadline and dependencies",
    ...extra,
  };
}
function enqueue(grant, extra = {}) {
  return external.enqueue({ ...lease(grant), proposal: proposal(extra) });
}
function receipt(grant, raw = proposal()) {
  return external.submissionReceipt({
    ...lease(grant),
    requestId: raw.requestId,
    inputDigest: digest(raw),
  });
}
function native(grant, saved) {
  return { goalRef: ref(), id: grant.id, draftId: saved.proposalId };
}
function observe() {
  const review = workflow.risk.evaluate({ projectId: "p1" });
  db.transaction(() =>
    workflow.observeInTransaction({
      goalId: goal.id,
      reviewId: review.review.id,
    }),
  ).immediate();
  source = workflow
    .list({ goalId: goal.id })
    .proposals.find(
      (item) => item.proposal.actionType === "task.update-description",
    ).proposal;
}
function count(table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}
function alterGrant(grant, mutate) {
  const row = db
    .prepare(
      "SELECT record_json FROM cc_project_goal_external_grants WHERE id=?",
    )
    .get(grant.id);
  const record = JSON.parse(row.record_json);
  mutate(record);
  db.prepare(
    "UPDATE cc_project_goal_external_grants SET record_json=?,content_digest=? WHERE id=?",
  ).run(JSON.stringify(record), digest(record), grant.id);
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-external-drafts-"));
  actor = owner;
  now = 1791244800000;
  confirm = vi.fn(async () => true);
  open();
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
    CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,
      created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
    INSERT INTO projects VALUES ('p1','${owner}','active',10,0);
    INSERT INTO project_tasks VALUES ('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
  goal = workflow.goals.create({ projectId: "p1", objective: "Delivery" });
  goal = workflow.goals.revise({
    id: goal.id,
    expectedRevision: goal.revision,
    patch: { allowedActionTypes: ["task.update-description", "task.create"] },
  });
  observe();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (db?.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("native external pending grants", () => {
  it("reads an absent authorization without writing, then grants and reopens the exact authority idempotently", () => {
    const changes = db.prepare("SELECT total_changes() AS n").get().n;
    const before = external.grantStatus({ goalRef: ref(), access });
    expect(before).toMatchObject({ epoch: 0, enabled: false, savedCount: 0 });
    expect(count("cc_project_goal_external_grants")).toBe(0);
    expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(changes);
    const granted = authorize();
    expect(granted).toEqual({ ...before, enabled: true, epoch: 1 });
    const after = db.prepare("SELECT total_changes() AS n").get().n;
    expect(authorize()).toEqual(granted);
    expect(external.assertGrant(lease(granted))).toEqual(granted);
    expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(after);
  });
  it("does not let a late confirmation reopen a concurrently revoked grant", () => {
    const grant = authorize();
    const before = external.grantStatus({ goalRef: ref(), access });
    const revoked = external.revoke({
      goalRef: ref(),
      id: grant.id,
      expectedEpoch: grant.epoch,
    });
    expect(revoked).toMatchObject({ enabled: false, epoch: 2 });
    expect(() => authorize(access, before.epoch)).toThrow("CONFLICT");
    expect(
      external.revoke({ goalRef: ref(), id: grant.id, expectedEpoch: 2 }),
    ).toEqual(revoked);
    expect(authorize()).toMatchObject({
      id: grant.id,
      enabled: true,
      epoch: 3,
    });
  });
  it.each(["declaration", "goal revision"])(
    "rotates the epoch when %s changes",
    (change) => {
      const first = authorize();
      if (change === "goal revision")
        goal = workflow.goals.revise({
          id: goal.id,
          expectedRevision: goal.revision,
          patch: { objective: "Changed" },
        });
      const updated = authorize(
        change === "declaration"
          ? { ...access, declarationDigest: digest("new declaration") }
          : access,
      );
      expect(updated).toMatchObject({ id: first.id, epoch: 2 });
      expect(() => external.assertGrant(lease(first))).toThrow("GRANT_CHANGED");
    },
  );
  it("saves only pending drafts and server-bound plugin identity, with no native execution or task write", () => {
    const grant = authorize(),
      saved = enqueue(grant);
    expect(saved).toMatchObject({ state: "pending-confirmation" });
    expect(external.readDraft(native(grant, saved))).toMatchObject({
      plugin,
      origin: "extension-suggestion",
      admissionEpoch: `${grant.id}:1`,
      proposal: proposal(),
    });
    expect(count("cc_project_goal_extension_drafts")).toBe(1);
    expect(count("cc_business_action_runs")).toBe(0);
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM cc_project_goal_workflow WHERE kind='intent'",
        )
        .get().n,
    ).toBe(0);
    expect(
      db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toBe("Original");
    expect(external.execute).toBeUndefined();
    expect(external.assertGrant(lease(grant)).savedCount).toBe(1);
    expect(() =>
      external.enqueue({
        ...lease(grant),
        plugin: { ...plugin, name: "spoofed" },
        proposal: proposal(),
      }),
    ).toThrow("INVALID_REQUEST");
    expect(() => enqueue(grant, { type: "task.create" })).toThrow(
      "INVALID_REQUEST",
    );
  });
  it("recovers a lost submission response after source freshness changes without resubmission", () => {
    const grant = authorize(),
      raw = proposal(),
      saved = enqueue(grant);
    expect(enqueue(grant)).toEqual(saved);
    db.exec("UPDATE project_tasks SET updated_at=99");
    expect(() => enqueue(grant)).toThrow();
    expect(receipt(grant, raw)).toEqual({
      state: "saved",
      proposalId: saved.proposalId,
      requestId: raw.requestId,
      inputDigest: digest(raw),
    });
    expect(receipt(grant, proposal({ requestId: "absent" }))).toMatchObject({
      state: "not-found",
      proposalId: null,
    });
    expect(() =>
      receipt(grant, proposal({ description: "Different body" })),
    ).toThrow("REQUEST_CONFLICT");
    expect(count("cc_project_goal_extension_drafts")).toBe(1);
  });
  it("rejects conflicting duplicates and rolls back a failed pending insert", () => {
    const grant = authorize();
    enqueue(grant);
    expect(() => enqueue(grant, { description: "Different" })).toThrow(
      "REQUEST_CONFLICT",
    );
    db.exec(
      "CREATE TRIGGER reject_external BEFORE INSERT ON cc_project_goal_extension_drafts BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    expect(() => enqueue(grant, { requestId: "request-2" })).toThrow(
      "fixture failure",
    );
    expect(receipt(grant, proposal({ requestId: "request-2" }))).toMatchObject({
      state: "not-found",
    });
    expect(external.assertGrant(lease(grant)).savedCount).toBe(1);
  });
  it("survives all SQLite handles closing and still prepares and executes under native confirmation", async () => {
    const grant = authorize(),
      saved = enqueue(grant);
    db.close();
    open();
    expect(receipt(grant)).toMatchObject({
      state: "saved",
      proposalId: saved.proposalId,
    });
    const prepared = external.prepareDraft(native(grant, saved));
    expect(external.prepareDraft(native(grant, saved)).intent.id).toBe(
      prepared.intent.id,
    );
    expect(external.describeIntent(prepared.intent.id)).toEqual({
      plugin,
      declarationDigest: access.declarationDigest,
      grantId: grant.id,
      epoch: 1,
    });
    expect(confirm).not.toHaveBeenCalled();
    const result = await workflow.execute({ intentId: prepared.intent.id });
    expect(result.run.status).toBe("succeeded");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toBe(proposal().description);
    expect(receipt(grant)).toMatchObject({ state: "saved" });
  });
  it("revokes old prepared intents permanently across re-enable while retaining historical records", async () => {
    const grant = authorize(),
      saved = enqueue(grant),
      prepared = external.prepareDraft(native(grant, saved));
    external.revoke({
      goalRef: ref(),
      id: grant.id,
      expectedEpoch: grant.epoch,
    });
    expect(() => external.readDraft(native(grant, saved))).toThrow();
    expect(() => receipt(grant)).toThrow();
    await expect(
      workflow.execute({ intentId: prepared.intent.id }),
    ).rejects.toThrow();
    const renewed = authorize();
    expect(renewed.epoch).toBe(3);
    expect(() => external.prepareDraft(native(renewed, saved))).toThrow();
    expect(() => receipt(renewed)).toThrow("GRANT_CHANGED");
    expect(
      external.listDrafts({ goalRef: ref(), id: renewed.id }),
    ).toMatchObject({ entries: [], unavailableCount: 1 });
    expect(count("cc_project_goal_extension_drafts")).toBe(1);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("rechecks the individual grant after the actual native confirmation", async () => {
    const grant = authorize(),
      saved = enqueue(grant),
      prepared = external.prepareDraft(native(grant, saved));
    confirm.mockImplementation(async () => {
      external.revoke({ goalRef: ref(), id: grant.id, expectedEpoch: 1 });
      return true;
    });
    await expect(
      workflow.execute({ intentId: prepared.intent.id }),
    ).rejects.toThrow();
    expect(
      db.prepare("SELECT description FROM project_tasks WHERE id='t1'").get()
        .description,
    ).toBe("Original");
  });
  it.each([
    "actor",
    "store",
    "goal",
    "epoch",
    "paused",
    "action",
    "expired",
    "project",
  ])("rejects invalid %s authority", (kind) => {
    const grant = authorize(),
      input = lease(grant);
    if (kind === "actor") actor = "did:other";
    if (kind === "store") input.goalRef.storeId = "wrong-store";
    if (kind === "goal") input.goalRef.id = "wrong-goal";
    if (kind === "epoch") input.grantRef.epoch++;
    if (kind === "paused") {
      goal = workflow.goals.revise({
        id: goal.id,
        expectedRevision: goal.revision,
        patch: { status: "paused" },
      });
      input.goalRef = ref();
    }
    if (kind === "action") {
      goal = workflow.goals.revise({
        id: goal.id,
        expectedRevision: goal.revision,
        patch: { allowedActionTypes: ["task.create"] },
      });
      input.goalRef = ref();
    }
    if (kind === "expired") {
      goal = workflow.goals.revise({
        id: goal.id,
        expectedRevision: goal.revision,
        patch: { expiresAt: new Date(now + 1000).toISOString() },
      });
      input.goalRef = ref();
      now += 2000;
    }
    if (kind === "project") db.exec("UPDATE projects SET status='archived'");
    expect(() => external.assertGrant(input)).toThrow();
  });
  it("cannot use one plugin grant to read or prepare another plugin's draft", () => {
    const first = authorize(),
      saved = enqueue(first);
    const other = authorize({
      ...access,
      plugin: { ...plugin, name: "other-extension" },
    });
    expect(() => external.readDraft(native(other, saved))).toThrow();
    expect(() => external.prepareDraft(native(other, saved))).toThrow();
    expect(receipt(other)).toMatchObject({ state: "not-found" });
  });
  it("does not identify unrelated extension suggestions as externally granted merely by plugin scope", () => {
    const queue = new ProjectGoalExtensionQueue({
      workflow,
      plugin,
      clock: () => now,
      authorizeExtension: () => "different-host-authority:1",
    });
    workflow.verifyExtensionIntent = (context) =>
      queue.verifyIntentInTransaction(context);
    const saved = queue.enqueue(proposal());
    const prepared = queue.prepareDraft({ id: saved.proposalId });
    expect(external.describeIntent(prepared.intent.id)).toBeNull();
    expect(
      db
        .transaction(() =>
          external.verifyIntentInTransaction({
            intent: prepared.intent,
            actor: owner,
            phase: "read",
          }),
        )
        .immediate(),
    ).toBe(false);
    expect(count("cc_project_goal_external_grants")).toBe(0);
  });
  it("returns a bounded body-free source page without writes and excludes stale sources", () => {
    const grant = authorize(),
      before = db.prepare("SELECT total_changes() AS n").get().n;
    db.pragma("query_only = ON");
    const page = external.sourcePage(lease(grant));
    expect(page.entries).toContainEqual({
      id: source.id,
      sourceTaskId: "t1",
      reviewId: source.reviewId,
      reviewDigest: source.reviewDigest,
    });
    expect(page.scannedCount).toBeLessThanOrEqual(20);
    expect(JSON.stringify(page)).not.toContain("Original");
    expect(db.prepare("SELECT total_changes() AS n").get().n).toBe(before);
    expect(external.assertGrant(lease(grant))).toMatchObject({ id: grant.id });
    expect(external.grantStatus({ goalRef: ref(), access })).toMatchObject({
      id: grant.id,
    });
    expect(external.listGrants({ goalRef: ref() }).entries).toHaveLength(1);
    expect(receipt(grant)).toMatchObject({ state: "not-found" });
    db.pragma("query_only = OFF");
    db.exec("UPDATE project_tasks SET updated_at=99");
    expect(external.sourcePage(lease(grant))).toMatchObject({
      entries: [],
      unavailableCount: page.scannedCount,
    });
  });
  it("advances source cursors by bounded scanned records, including unavailable sources", () => {
    const grant = authorize();
    const original = db
      .prepare("SELECT record_json FROM cc_project_goal_workflow WHERE id=?")
      .get(source.id);
    for (let index = 0; index < 25; index++) {
      const record = JSON.parse(original.record_json);
      record.id = `goal-proposal-${index.toString(16).padStart(64, "0")}`;
      record.goalRevision = Math.max(1, goal.revision - 1);
      db.prepare(
        "INSERT INTO cc_project_goal_workflow VALUES (?,?,?,?,?,?)",
      ).run(
        record.id,
        "proposal",
        goal.id,
        owner,
        JSON.stringify(record),
        digest(record),
      );
    }
    const first = external.sourcePage(lease(grant));
    expect(first.scannedCount).toBe(20);
    expect(first.nextCursor).toBeTruthy();
    expect(first.unavailableCount).toBe(20);
    const second = external.sourcePage({
      ...lease(grant),
      afterId: first.nextCursor,
    });
    expect(second.scannedCount).toBeLessThanOrEqual(20);
    expect(second.entries).toContainEqual(
      expect.objectContaining({ id: source.id }),
    );
    expect(second.nextCursor).toBeNull();
  });
  it("does not downgrade corrupt source or grant records into empty history", () => {
    const grant = authorize();
    db.prepare(
      "UPDATE cc_project_goal_workflow SET content_digest='corrupt' WHERE id=?",
    ).run(source.id);
    expect(() => external.sourcePage(lease(grant))).toThrow("CORRUPT");
    db.prepare(
      "UPDATE cc_project_goal_external_grants SET record_json=? WHERE id=?",
    ).run(" ".repeat(8193), grant.id);
    expect(() => external.grantStatus({ goalRef: ref(), access })).toThrow(
      "CORRUPT",
    );
    expect(() => external.listGrants({ goalRef: ref() })).toThrow("CORRUPT");
  });
  it("rejects a digest-valid grant whose actor, store, project or plugin binding was changed", () => {
    const grant = authorize();
    alterGrant(grant, (record) => {
      record.projectId = "another-project";
    });
    expect(() => external.assertGrant(lease(grant))).toThrow("GRANT_NOT_FOUND");
    alterGrant(grant, (record) => {
      record.goalRef.storeId = "another-store";
    });
    expect(() => external.assertGrant(lease(grant))).toThrow("CORRUPT");
  });
  it("rejects corrupted pending receipts even when the source is no longer current", () => {
    const grant = authorize(),
      saved = enqueue(grant);
    db.exec("UPDATE project_tasks SET updated_at=99");
    db.prepare(
      "UPDATE cc_project_goal_extension_drafts SET content_digest='bad' WHERE id=?",
    ).run(saved.proposalId);
    expect(() => receipt(grant)).toThrow("CORRUPT");
  });
  it("bounds grants and paginates a single actor and goal only", () => {
    for (let index = 0; index < 100; index++)
      authorize({
        ...access,
        plugin: { ...plugin, name: `extension-${index}` },
      });
    expect(() => authorize()).toThrow("GRANT_LIMIT");
    const first = external.listGrants({ goalRef: ref() });
    expect(first.entries).toHaveLength(20);
    const second = external.listGrants({
      goalRef: ref(),
      afterId: first.nextCursor,
    });
    expect(second.entries).toHaveLength(20);
    expect(
      new Set([...first.entries, ...second.entries].map((entry) => entry.id))
        .size,
    ).toBe(40);
    expect(() =>
      external.listGrants({ goalRef: ref(), afterId: "bad" }),
    ).toThrow();
  });
  it("strictly rejects extra authority fields, builtin labels and out-of-transaction verification", () => {
    expect(() =>
      external.grant({
        goalRef: ref(),
        access,
        expectedEpoch: 0,
        trusted: true,
      }),
    ).toThrow("INVALID_REQUEST");
    expect(() =>
      authorize({ ...access, plugin: { ...plugin, scope: "desktop-builtin" } }),
    ).toThrow("INVALID_REQUEST");
    expect(() => authorize({ ...access, trusted: true })).toThrow(
      "INVALID_REQUEST",
    );
    expect(() =>
      external.verifyIntentInTransaction({
        intent: {},
        actor: owner,
        phase: "read",
      }),
    ).toThrow("TRANSACTION_REQUIRED");
  });
});
