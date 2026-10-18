import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  createProjectGoalHost,
  CHANNELS,
  registerProjectGoalIPC,
} = require("../project-goal-ipc.js");
const {
  ProjectGoalWorkflow,
} = require("@chainlesschain/session-core/project-goal-workflow");
const {
  ProjectGoalDeliveryDrafts,
} = require("../project-goal-delivery-drafts.js");
const owner = "did:chainless:owner";
let directory,
  db,
  actor,
  authGeneration,
  window,
  event,
  electron,
  host,
  workflow,
  goal,
  source;
let now;
function open() {
  db = new Database(path.join(directory, "project.sqlite"));
  host = createProjectGoalHost({
    database: { getDatabase: () => db },
    getCurrentUserDid: () => actor,
    getAuthenticationGeneration: () => authGeneration,
    electron,
    clock: () => now,
  });
  workflow = new ProjectGoalWorkflow({
    db,
    getActor: () => actor,
    clock: () => now,
  });
}
function goalRef() {
  return {
    id: goal.id,
    storeId: goal.storeId,
    revision: goal.revision,
    controlGeneration: goal.controlGeneration,
  };
}
const status = () => host.deliveryDraftStatus(event, { goalRef: goalRef() });
const configure = (enabled) =>
  host.configureDeliveryDrafts(event, {
    goalRef: goalRef(),
    expectedEpoch: status().epoch,
    enabled,
  });
const propose = (requestId = "draft-request") =>
  host.proposeDeliveryDraft(event, {
    goalRef: goalRef(),
    sourceRef: source.id,
    requestId,
  });
const count = () =>
  db.prepare("SELECT COUNT(*) AS n FROM cc_project_goal_extension_drafts").get()
    .n;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-delivery-drafts-ipc-"));
  actor = owner;
  authGeneration = 0;
  now = 1791244800000;
  window = { isDestroyed: vi.fn(() => false) };
  event = {
    sender: {},
    senderFrame: { url: "http://localhost:5173", parent: null },
  };
  electron = {
    BrowserWindow: { fromWebContents: vi.fn(() => window) },
    ipcMain: { handle: vi.fn() },
    dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
  };
  open();
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
    CREATE TABLE project_tasks (id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,
    created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
    INSERT INTO projects VALUES ('p1','${owner}','active',10,0);
    INSERT INTO project_tasks VALUES ('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
  goal = host.create(event, { projectId: "p1", objective: "Follow delivery" });
  goal = host.revise(event, {
    id: goal.id,
    expectedRevision: goal.revision,
    patch: { allowedActionTypes: ["task.update-description"] },
  });
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
});
afterEach(() => {
  if (db?.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("trusted built-in delivery draft host", () => {
  it("starts disabled and only enables after a native scoped confirmation", async () => {
    expect(status()).toMatchObject({
      enabled: false,
      epoch: 0,
      savedCount: 0,
      plugin: {
        name: "project-delivery-drafts",
        scope: "desktop-builtin",
        version: "0.1.0",
      },
    });
    expect(() => propose()).toThrow("NOT_ADMITTED");
    expect(count()).toBe(0);
    expect(await configure(true)).toMatchObject({ enabled: true, epoch: 1 });
    const [parent, dialog] = electron.dialog.showMessageBox.mock.calls[0];
    expect(parent).toBe(window);
    expect(dialog).toMatchObject({ cancelId: 0, defaultId: 0, noLink: true });
    expect(dialog.detail).toContain(owner);
    expect(dialog.detail).toContain("Follow delivery");
    expect(dialog.detail).toContain("proposal:task.description.update");
    expect(dialog.detail).toContain(
      "desktop-builtin:project-delivery-drafts@0.1.0",
    );
  });
  it("persists only pending built-in rule drafts, deduplicates requests, and survives reopen", async () => {
    await configure(true);
    const result = propose();
    expect(propose()).toEqual(result);
    expect(count()).toBe(1);
    const draft = host.readDeliveryDraft(event, { id: result.proposalId });
    expect(draft).toMatchObject({
      origin: "builtin-rule",
      state: "pending-confirmation",
      source: {
        proposalId: source.id,
        reviewId: source.reviewId,
        reviewDigest: source.reviewDigest,
      },
      proposal: { type: "task.description.update" },
    });
    expect(draft).not.toHaveProperty("intentId");
    expect(draft).not.toHaveProperty("receipt");
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_workflow WHERE kind='intent'",
        )
        .get().n,
    ).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cc_business_action_runs").get().n,
    ).toBe(0);
    db.close();
    open();
    expect(status()).toMatchObject({ enabled: true, savedCount: 1 });
    expect(propose()).toEqual(result);
    expect(
      host.listDeliveryDrafts(event, { goalRef: goalRef(), limit: 1 }),
    ).toMatchObject({
      entries: [draft],
      unavailableCount: 0,
      nextCursor: null,
    });
  });
  it("disables without deleting history and requires a fresh request after re-enabling", async () => {
    await configure(true);
    const draft = propose();
    expect(await configure(false)).toMatchObject({
      enabled: false,
      epoch: 2,
      savedCount: 1,
    });
    expect(() =>
      host.readDeliveryDraft(event, { id: draft.proposalId }),
    ).toThrow("NOT_ADMITTED");
    expect(() => propose("other")).toThrow("NOT_ADMITTED");
    expect(await configure(true)).toMatchObject({
      enabled: true,
      epoch: 3,
      savedCount: 1,
    });
    expect(() =>
      host.readDeliveryDraft(event, { id: draft.proposalId }),
    ).toThrow("SOURCE_CHANGED");
    expect(() => propose()).toThrow("SOURCE_CHANGED");
    expect(
      host.listDeliveryDrafts(event, { goalRef: goalRef() }),
    ).toMatchObject({ entries: [], unavailableCount: 1 });
    expect(propose("explicit-new-request").state).toBe("pending-confirmation");
    expect(count()).toBe(2);
  });
  it("cancellation does not grant or save anything", async () => {
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await configure(true)).toMatchObject({ enabled: false, epoch: 0 });
    expect(
      db
        .prepare("SELECT count(*) AS n FROM cc_project_goal_builtin_grants")
        .get().n,
    ).toBe(0);
    expect(count()).toBe(0);
  });
  it.each([
    "identity",
    "logout",
    "authentication",
    "frame",
    "window",
    "database",
    "goal",
  ])("invalidates native consent after %s changes", async (change) => {
    const original = db;
    electron.dialog.showMessageBox.mockImplementation(async () => {
      if (change === "identity") actor = "did:other";
      if (change === "logout") actor = null;
      if (change === "authentication") authGeneration++;
      if (change === "frame") event.senderFrame = { ...event.senderFrame };
      if (change === "window") window.isDestroyed.mockReturnValue(true);
      if (change === "database") db = new Database(":memory:");
      if (change === "goal")
        workflow.goals.revise({
          id: goal.id,
          expectedRevision: goal.revision,
          patch: { status: "paused" },
        });
      return { response: 1 };
    });
    await expect(configure(true)).rejects.toThrow();
    expect(
      original
        .prepare("SELECT count(*) AS n FROM cc_project_goal_builtin_grants")
        .get().n,
    ).toBe(0);
    if (db !== original) db.close();
    db = original;
  });
  it("rejects a stale epoch changed by another trusted native consent while the dialog is open", async () => {
    electron.dialog.showMessageBox.mockImplementation(async () => {
      const other = new ProjectGoalDeliveryDrafts({
        workflow,
        confirm: async () => true,
        clock: () => now,
      });
      await other.configure({
        goalRef: goalRef(),
        enabled: true,
        expectedEpoch: 0,
      });
      await other.configure({
        goalRef: goalRef(),
        enabled: false,
        expectedEpoch: 1,
      });
      return { response: 1 };
    });
    await expect(configure(true)).rejects.toThrow("GRANT_CONFLICT");
    expect(status()).toMatchObject({ enabled: false, epoch: 2 });
  });
  it.each(["archived-before", "archived-during", "expired-during"])(
    "refuses a live grant when project/expiry becomes %s",
    async (change) => {
      if (change === "expired-during")
        goal = workflow.goals.revise({
          id: goal.id,
          expectedRevision: goal.revision,
          patch: { expiresAt: new Date(now + 1000).toISOString() },
        });
      if (change === "archived-before")
        db.prepare("UPDATE projects SET status='archived'").run();
      electron.dialog.showMessageBox.mockImplementation(async () => {
        if (change === "archived-during")
          db.prepare("UPDATE projects SET status='archived'").run();
        if (change === "expired-during") now += 1001;
        return { response: 1 };
      });
      await expect(configure(true)).rejects.toThrow();
      expect(
        db
          .prepare("SELECT count(*) AS n FROM cc_project_goal_builtin_grants")
          .get().n,
      ).toBe(0);
    },
  );
  it("pins dialog request data before awaiting and rejects arbitrary plugin/authority/text input", async () => {
    const input = { goalRef: goalRef(), expectedEpoch: 0, enabled: true };
    electron.dialog.showMessageBox.mockImplementation(async () => {
      input.enabled = false;
      input.goalRef.id = "other";
      return { response: 1 };
    });
    expect(await host.configureDeliveryDrafts(event, input)).toMatchObject({
      enabled: true,
    });
    for (const patch of [
      { plugin: { name: "fake" } },
      { actorDid: owner },
      { admitted: true },
      { description: "renderer text" },
      { state: "succeeded" },
    ])
      expect(() =>
        host.proposeDeliveryDraft(event, {
          goalRef: goalRef(),
          sourceRef: source.id,
          requestId: "bad",
          ...patch,
        }),
      ).toThrow("INVALID_REQUEST");
    expect(count()).toBe(0);
  });
  it.each([
    "deliveryDraftStatus",
    "configureDeliveryDrafts",
    "proposeDeliveryDraft",
    "listDeliveryDrafts",
    "readDeliveryDraft",
    "prepareDeliveryDraft",
  ])("requires a trusted live window for %s", (method) => {
    expect(() =>
      host[method](
        {
          ...event,
          senderFrame: { url: "https://untrusted.example", parent: null },
        },
        {},
      ),
    ).toThrow("UNTRUSTED_SENDER");
    actor = null;
    expect(() => host[method](event, {})).toThrow("IDENTITY_REQUIRED");
  });
  it("keeps a fixed registered IPC surface and fails closed on corrupted native grants", async () => {
    await configure(true);
    db.prepare(
      "UPDATE cc_project_goal_builtin_grants SET record_json='{}'",
    ).run();
    expect(() => status()).toThrow("GRANT_CORRUPT");
    expect(() => propose()).toThrow("GRANT_CORRUPT");
    registerProjectGoalIPC(db, {
      getCurrentUserDid: () => actor,
      electron,
      clock: () => now,
    });
    expect(electron.ipcMain.handle.mock.calls.map(([name]) => name)).toEqual(
      Object.values(CHANNELS),
    );
    expect(
      Object.values(CHANNELS).filter((name) =>
        name.includes("delivery-drafts"),
      ),
    ).toHaveLength(6);
  });
  it("converts by draft ID only and uses the existing native confirmation with extension provenance", async () => {
    await configure(true);
    const saved = propose();
    const prepared = host.prepareDeliveryDraft(event, { id: saved.proposalId });
    expect(prepared.intent.status).toBe("prepared");
    expect(prepared.intent.extensionRef.draftId).toBe(saved.proposalId);
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
    const result = await host.executeIntent(event, {
      intentId: prepared.intent.id,
    });
    expect(result.run.status).toBe("succeeded");
    const detail = electron.dialog.showMessageBox.mock.calls[1][1].detail;
    expect(detail).toContain(saved.proposalId);
    expect(detail).toContain(prepared.intent.extensionRef.conversionId);
    expect(detail).toContain(prepared.intent.preview.after.description);
    expect(
      result.evidence.find((e) => e.kind === "project-goal-intent").reference
        .extensionRef,
    ).toEqual(prepared.intent.extensionRef);
    await configure(false);
    expect(
      host.readIntent(event, { intentId: prepared.intent.id }).receipt.run.id,
    ).toBe(result.run.id);
    expect(
      (await host.executeIntent(event, { intentId: prepared.intent.id }))
        .replayed,
    ).toBe(true);
    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(2);
  });
  it("revokes pending native previews across all ordinary IPC entrypoints", async () => {
    await configure(true);
    const saved = propose(),
      draft = host.readDeliveryDraft(event, { id: saved.proposalId });
    const prepared = host.prepareDeliveryDraft(event, { id: saved.proposalId });
    await configure(false);
    expect(() =>
      host.readIntent(event, { intentId: prepared.intent.id }),
    ).toThrow("EXTENSION_REJECTED");
    await expect(
      host.executeIntent(event, { intentId: prepared.intent.id }),
    ).rejects.toThrow("EXTENSION_REJECTED");
    const result = host.proposals(event, { goalId: goal.id });
    expect(
      result.proposals.find((e) => e.proposal.id === source.id),
    ).toMatchObject({ intent: null, intentUnavailable: true });
    expect(JSON.stringify(result)).not.toContain(draft.proposal.description);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cc_business_action_runs").get().n,
    ).toBe(0);
  });
  it("settles a native confirmation rejected after disabling instead of losing its admitted receipt", async () => {
    await configure(true);
    const saved = propose(),
      prepared = host.prepareDeliveryDraft(event, { id: saved.proposalId });
    electron.dialog.showMessageBox.mockImplementation(async () => {
      await configure(false);
      return { response: 1 };
    });
    await expect(
      host.executeIntent(event, { intentId: prepared.intent.id }),
    ).rejects.toThrow("EXTENSION_REJECTED");
    expect(
      host.readIntent(event, { intentId: prepared.intent.id }).receipt.run
        .status,
    ).toBe("denied");
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
  });
  it.each(["authentication", "same-url-frame"])(
    "invalidates an execution confirmation after %s changes",
    async (change) => {
      await configure(true);
      const saved = propose(),
        prepared = host.prepareDeliveryDraft(event, { id: saved.proposalId });
      electron.dialog.showMessageBox.mockImplementation(async () => {
        if (change === "authentication") authGeneration++;
        else event.senderFrame = { ...event.senderFrame };
        return { response: 1 };
      });
      await expect(
        host.executeIntent(event, { intentId: prepared.intent.id }),
      ).rejects.toThrow();
      expect(
        db.prepare("SELECT description FROM project_tasks").get().description,
      ).toBe("Original");
      expect(
        host.readIntent(event, { intentId: prepared.intent.id }).receipt.run
          .status,
      ).toBe("denied");
    },
  );
  it("rejects renderer-selected conversion input and copied extension references on ordinary prepare", async () => {
    await configure(true);
    const saved = propose();
    for (const patch of [
      { actorDid: owner },
      { description: "changed" },
      { approval: true },
      { extensionRef: {} },
    ])
      expect(() =>
        host.prepareDeliveryDraft(event, { id: saved.proposalId, ...patch }),
      ).toThrow("INVALID_REQUEST");
    const prepared = host.prepareDeliveryDraft(event, { id: saved.proposalId });
    expect(() =>
      host.prepareIntent(event, {
        goalId: goal.id,
        proposalId: source.id,
        expectedRevision: goal.revision,
        requestId: prepared.intent.requestId,
        description: prepared.intent.description,
        extensionRef: prepared.intent.extensionRef,
      }),
    ).toThrow("USE_DRAFT_ID");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_extension_conversions",
        )
        .get().n,
    ).toBe(1);
  });
});
