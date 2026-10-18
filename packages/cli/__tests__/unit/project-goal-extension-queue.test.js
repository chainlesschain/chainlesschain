import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  proposeGoalExtensionAction,
  collectGoalExtensions,
} from "../../src/lib/plugin-runtime/goal-extensions.js";
import {
  trustPlugin,
  _deps as trustDeps,
} from "../../src/lib/plugin-runtime/trust.js";
import {
  consentPluginCapabilities,
  revokeCapabilityConsent,
  _deps as consentDeps,
} from "../../src/lib/plugin-runtime/capability-consent.js";
import { normalizeCapabilities } from "../../src/lib/plugin-runtime/capabilities.js";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");
const {
  ProjectGoalWorkflow,
} = require("@chainlesschain/session-core/project-goal-workflow");
const {
  ProjectGoalExtensionQueue,
} = require("@chainlesschain/session-core/project-goal-extension-queue");
const owner = "did:chainless:owner",
  plugin = {
    name: "native-draft-extension",
    scope: "project",
    version: "1.0.0",
  };
let directory,
  db,
  workflow,
  queue,
  actor,
  admission,
  goal,
  source,
  now,
  confirm;
function open() {
  db = new Database(path.join(directory, "project.sqlite"));
  workflow = new ProjectGoalWorkflow({
    db,
    getActor: () => actor,
    clock: () => now,
    approvalGate: new ApprovalGate({ confirm: (...args) => confirm(...args) }),
    verifyExtensionIntent: (context) =>
      queue.verifyIntentInTransaction(context),
  });
  queue = new ProjectGoalExtensionQueue({
    workflow,
    plugin,
    authorizeExtension: (context) => admission(context),
    clock: () => now,
  });
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
function goalRef() {
  return {
    id: goal.id,
    storeId: goal.storeId,
    revision: goal.revision,
    controlGeneration: goal.controlGeneration,
  };
}
function request(extra = {}) {
  return {
    type: "task.description.update",
    goalRef: goalRef(),
    sourceRef: source.id,
    requestId: "request-1",
    title: "Review delivery",
    description: "Review deadline and dependencies",
    ...extra,
  };
}
function count() {
  return db
    .prepare("SELECT COUNT(*) AS n FROM cc_project_goal_extension_drafts")
    .get().n;
}
beforeEach(() => {
  directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-goal-extension-queue-"),
  );
  actor = owner;
  now = 1791244800000;
  admission = () => "host-grant:1";
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
  vi.unstubAllEnvs();
  if (db?.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("native pending-only extension queue", () => {
  it("maps SDK naming explicitly and persists a suggestion without native intent, task mutation or receipt", () => {
    const result = queue.enqueue(request());
    expect(result).toEqual({
      proposalId: expect.stringMatching(/^goal-extension-/),
      state: "pending-confirmation",
    });
    expect(queue.get({ id: result.proposalId })).toMatchObject({
      plugin,
      actorDid: owner,
      state: "pending-confirmation",
      source: {
        proposalId: source.id,
        reviewId: source.reviewId,
        reviewDigest: source.reviewDigest,
        actionType: "task.update-description",
      },
    });
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM cc_project_goal_workflow WHERE kind='intent'",
        )
        .get().n,
    ).toBe(0);
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
    expect(
      db.prepare("SELECT count(*) AS n FROM cc_business_action_runs").get().n,
    ).toBe(0);
    expect(queue.execute).toBeUndefined();
  });
  it("replays exactly after closing every SQLite handle and rejects changed parameters", () => {
    const result = queue.enqueue(request());
    db.close();
    open();
    expect(queue.enqueue(request())).toEqual(result);
    expect(count()).toBe(1);
    expect(() => queue.enqueue(request({ description: "Changed" }))).toThrow(
      "REQUEST_CONFLICT",
    );
  });
  it.each(["disabled", "re-enabled"])(
    "retains storage but denies old drafts after %s admission",
    (change) => {
      const result = queue.enqueue(request());
      admission = () => (change === "disabled" ? null : "host-grant:2");
      expect(() => queue.get({ id: result.proposalId })).toThrow();
      expect(() => queue.enqueue(request())).toThrow();
      expect(count()).toBe(1);
      if (change === "re-enabled") {
        expect(queue.list({ goalRef: goalRef() })).toMatchObject({
          entries: [],
          unavailableCount: 1,
        });
        queue.enqueue(request({ requestId: "explicit-new-request" }));
        expect(count()).toBe(2);
      }
    },
  );
  it("rolls back if the host grant changes before queue commit", () => {
    let calls = 0;
    admission = () => (++calls === 1 ? "host-grant:1" : "host-grant:2");
    expect(() => queue.enqueue(request())).toThrow("SOURCE_CHANGED");
    expect(count()).toBe(0);
  });
  it.each(["pause", "revision", "owner", "actor", "source"])(
    "rejects stale or unauthorized %s reads and writes",
    (change) => {
      const result = queue.enqueue(request());
      if (change === "pause")
        workflow.goals.revise({
          id: goal.id,
          expectedRevision: goal.revision,
          patch: { status: "paused" },
        });
      if (change === "revision")
        workflow.goals.revise({
          id: goal.id,
          expectedRevision: goal.revision,
          patch: { objective: "New goal" },
        });
      if (change === "owner")
        db.prepare("UPDATE projects SET user_id='did:other'").run();
      if (change === "actor") actor = "did:other";
      if (change === "source")
        db.prepare(
          "UPDATE project_tasks SET description='Changed',updated_at=11",
        ).run();
      expect(() => queue.get({ id: result.proposalId })).toThrow();
      expect(() =>
        queue.enqueue(request({ requestId: "request-2" })),
      ).toThrow();
      expect(count()).toBe(1);
    },
  );
  it("binds the exact native review even when repeated risk checks keep the proposal ID", () => {
    const oldSource = source,
      result = queue.enqueue(request());
    now += 1000;
    observe();
    expect(source.id).toBe(oldSource.id);
    expect(source.reviewId).not.toBe(oldSource.reviewId);
    expect(() => queue.get({ id: result.proposalId })).toThrow(
      "SOURCE_CHANGED",
    );
    expect(queue.list({ goalRef: goalRef() })).toMatchObject({
      entries: [],
      unavailableCount: 1,
    });
  });
  it("rejects another goal, action and already prepared native proposal", () => {
    const other = workflow.goals.create({
      projectId: "p1",
      objective: "Other",
    });
    expect(() =>
      queue.enqueue(
        request({
          goalRef: {
            ...goalRef(),
            id: other.id,
            revision: other.revision,
            controlGeneration: other.controlGeneration,
          },
        }),
      ),
    ).toThrow();
    expect(() => queue.enqueue(request({ type: "task.create" }))).toThrow(
      "UNSUPPORTED_ACTION",
    );
    workflow.prepare({
      goalId: goal.id,
      proposalId: source.id,
      expectedRevision: goal.revision,
      requestId: "native-request",
      description: "Owner preview",
    });
    expect(() => queue.enqueue(request())).toThrow("ALREADY_PREPARED");
    expect(count()).toBe(0);
  });
  it("does not accept caller authority, arbitrary code or successful receipts", () => {
    for (const patch of [
      { actorDid: owner },
      { approved: true },
      { state: "succeeded" },
      { execute: "code" },
    ])
      expect(() => queue.enqueue(request(patch))).toThrow();
    expect(() =>
      queue.enqueue(request({ description: "x".repeat(8193) })),
    ).toThrow();
    expect(() =>
      queue.enqueue(request({ description: "\0".repeat(8192) })),
    ).toThrow("RECORD_LIMIT");
    admission = async () => "not-sync";
    expect(() => queue.enqueue(request())).toThrow("NOT_ADMITTED");
    expect(count()).toBe(0);
  });
  it("bounds storage and cursor pages including unavailable records", () => {
    for (let i = 0; i < 100; i++)
      queue.enqueue(request({ requestId: `request-${i}` }));
    expect(() =>
      queue.enqueue(request({ requestId: "over-capacity" })),
    ).toThrow("QUEUE_FULL");
    const first = queue.list({ goalRef: goalRef(), limit: 20 });
    expect(first.entries).toHaveLength(20);
    const next = queue.list({
      goalRef: goalRef(),
      limit: 20,
      afterId: first.nextCursor,
    });
    expect(next.entries).toHaveLength(20);
    expect(next.entries[0].id).not.toBe(first.entries[0].id);
    admission = () => "host-grant:2";
    expect(queue.list({ goalRef: goalRef(), limit: 2 })).toMatchObject({
      entries: [],
      unavailableCount: 2,
      nextCursor: expect.any(String),
    });
  });
  it("requires an immediate native source-check transaction and rejects damaged records", () => {
    expect(() =>
      workflow.assertExtensionSourceInTransaction({
        goalRef: goalRef(),
        sourceRef: source.id,
        nativeActionType: "task.update-description",
      }),
    ).toThrow("TRANSACTION_REQUIRED");
    const result = queue.enqueue(request());
    db.prepare(
      "UPDATE cc_project_goal_extension_drafts SET record_json='{}'",
    ).run();
    expect(() => queue.get({ id: result.proposalId })).toThrow(
      "RECORD_CORRUPT",
    );
    expect(() => queue.list({ goalRef: goalRef() })).toThrow("RECORD_CORRUPT");
  });
  it("checks identity again if admission changes the active actor", () => {
    const result = queue.enqueue(request());
    admission = () => {
      actor = "did:other";
      return "host-grant:1";
    };
    expect(() => queue.get({ id: result.proposalId })).toThrow();
  });
});

describe("durable trusted draft conversion and native confirmation", () => {
  const conversions = () =>
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM cc_project_goal_extension_conversions",
      )
      .get().n;
  function save() {
    return queue.enqueue(request()).proposalId;
  }
  it("pins one native intent and carries the immutable draft reference into actual action evidence", async () => {
    const id = save(),
      prepared = queue.prepareDraft({ id });
    expect(prepared.intent.status).toBe("prepared");
    expect(prepared.intent.extensionRef.draftId).toBe(id);
    expect(
      prepared.intent.preview.request.input.goalIntent.extensionRef,
    ).toEqual(prepared.intent.extensionRef);
    expect(queue.prepareDraft({ id })).toEqual(prepared);
    expect(conversions()).toBe(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
    const receipt = await workflow.execute({ intentId: prepared.intent.id });
    expect(receipt.run.status).toBe("succeeded");
    expect(confirm).toHaveBeenCalledOnce();
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe(request().description);
    expect(
      receipt.evidence.find((e) => e.kind === "project-goal-intent").reference
        .extensionRef,
    ).toEqual(prepared.intent.extensionRef);
    admission = () => null;
    expect(
      workflow.getIntent({ intentId: prepared.intent.id }).receipt.run.id,
    ).toBe(receipt.run.id);
    expect(
      (await workflow.execute({ intentId: prepared.intent.id })).replayed,
    ).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });
  it("recovers an interrupted native preview after reopen without replacing the conversion or request", () => {
    const id = save();
    vi.spyOn(workflow.descriptionActions, "preview").mockImplementationOnce(
      () => {
        throw new Error("interrupted preview");
      },
    );
    expect(() => queue.prepareDraft({ id })).toThrow("interrupted preview");
    const before = queue.get({ id }).conversion;
    expect(before.status).toBe("draft");
    db.close();
    open();
    const prepared = queue.prepareDraft({ id });
    expect(prepared.intent.id).toBe(before.intentId);
    expect(prepared.intent.extensionRef).toEqual(before.extensionRef);
    expect(conversions()).toBe(1);
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM cc_project_goal_workflow WHERE kind='intent'",
        )
        .get().n,
    ).toBe(1);
  });
  it("recovers when conversion committed before native prepare and rejects absent or asynchronous host authority", () => {
    const id = save();
    workflow.verifyExtensionIntent = null;
    expect(() => queue.prepareDraft({ id })).toThrow(
      "EXTENSION_AUTHORITY_REQUIRED",
    );
    expect(conversions()).toBe(1);
    expect(queue.get({ id }).conversion.status).toBe("preparing");
    workflow.verifyExtensionIntent = async () => true;
    expect(() => queue.prepareDraft({ id })).toThrow("EXTENSION_REJECTED");
    workflow.verifyExtensionIntent = (context) =>
      queue.verifyIntentInTransaction(context);
    expect(queue.prepareDraft({ id }).intent.status).toBe("prepared");
    expect(conversions()).toBe(1);
  });
  it("retains an already prepared native intent when its response is lost", () => {
    const id = save(),
      original = workflow.prepare.bind(workflow);
    vi.spyOn(workflow, "prepare").mockImplementationOnce((input) => {
      original(input);
      throw new Error("response lost");
    });
    expect(() => queue.prepareDraft({ id })).toThrow("response lost");
    const before = queue.get({ id }).conversion;
    db.close();
    open();
    expect(queue.prepareDraft({ id }).intent.id).toBe(before.intentId);
    expect(conversions()).toBe(1);
  });
  it.each(["disabled", "re-enabled", "new-review"])(
    "blocks ordinary read/execute/list bypass after %s",
    async (change) => {
      const id = save(),
        prepared = queue.prepareDraft({ id });
      if (change === "disabled") admission = () => null;
      if (change === "re-enabled") admission = () => "host-grant:2";
      if (change === "new-review") {
        now += 1000;
        observe();
      }
      expect(() =>
        workflow.getIntent({ intentId: prepared.intent.id }),
      ).toThrow("EXTENSION_REJECTED");
      await expect(
        workflow.execute({ intentId: prepared.intent.id }),
      ).rejects.toThrow("EXTENSION_REJECTED");
      const list = workflow.list({ goalId: goal.id });
      expect(
        list.proposals.find((e) => e.proposal.id === source.id),
      ).toMatchObject({ intent: null, intentUnavailable: true });
      expect(JSON.stringify(list)).not.toContain(request().description);
      expect(confirm).not.toHaveBeenCalled();
      expect(
        db.prepare("SELECT count(*) AS n FROM cc_business_action_runs").get().n,
      ).toBe(0);
    },
  );
  it("denies a confirmation invalidated by revocation and replays its terminal receipt without another write", async () => {
    const id = save(),
      prepared = queue.prepareDraft({ id });
    confirm.mockImplementation(async () => {
      admission = () => null;
      return true;
    });
    await expect(
      workflow.execute({ intentId: prepared.intent.id }),
    ).rejects.toThrow("EXTENSION_REJECTED");
    const saved = workflow.getIntent({ intentId: prepared.intent.id });
    expect(saved.receipt.run.status).toBe("denied");
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
    expect(
      (await workflow.execute({ intentId: prepared.intent.id })).run.status,
    ).toBe("denied");
    expect(confirm).toHaveBeenCalledOnce();
  });
  it("allows only the exact conversion to resume a native source already claimed by an intent", () => {
    const id = save(),
      other = queue.enqueue(request({ requestId: "other-draft" })).proposalId;
    const prepared = queue.prepareDraft({ id });
    expect(() => queue.prepareDraft({ id: other })).toThrow("ALREADY_PREPARED");
    expect(conversions()).toBe(1);
    expect(() =>
      workflow.prepare({
        goalId: goal.id,
        proposalId: source.id,
        expectedRevision: goal.revision,
        requestId: prepared.intent.requestId,
        description: "changed description",
        extensionRef: prepared.intent.extensionRef,
      }),
    ).toThrow("INTENT_CONFLICT");
    expect(() => queue.prepareDraft({ id, actorDid: owner })).toThrow(
      "INVALID_REQUEST",
    );
  });
  it("does not expose pending converted previews through a workflow with no extension verifier", async () => {
    const id = save(),
      prepared = queue.prepareDraft({ id });
    const bare = new ProjectGoalWorkflow({
      db,
      getActor: () => actor,
      clock: () => now,
    });
    expect(() => bare.getIntent({ intentId: prepared.intent.id })).toThrow(
      "EXTENSION_AUTHORITY_REQUIRED",
    );
    expect(
      bare
        .list({ goalId: goal.id })
        .proposals.find((e) => e.proposal.id === source.id),
    ).toMatchObject({ intent: null, intentUnavailable: true });
    await expect(
      bare.execute({ intentId: prepared.intent.id }),
    ).rejects.toThrow("EXTENSION_AUTHORITY_REQUIRED");
  });
  it("reconstructs unresolved native history before a queue callback is installed and never redispatches", async () => {
    const id = save(),
      prepared = queue.prepareDraft({ id });
    confirm.mockImplementation(() => new Promise(() => {}));
    void workflow.descriptionActions.execute(prepared.intent.preview.request);
    await new Promise((resolve) => setImmediate(resolve));
    expect(
      workflow.getIntent({ intentId: prepared.intent.id }).intent.status,
    ).toBe("running");
    admission = () => null;
    db.close();
    open();
    expect(
      workflow.getIntent({ intentId: prepared.intent.id }).executionState,
    ).toBe("unresolved");
    expect(
      db
        .prepare(
          "SELECT json_extract(record_json,'$.status') AS status FROM cc_project_goal_usage WHERE operation_id=?",
        )
        .get(prepared.intent.id).status,
    ).toBe("unknown");
    expect(
      (await workflow.execute({ intentId: prepared.intent.id })).executionState,
    ).toBe("unresolved");
    expect(confirm).toHaveBeenCalledOnce();
    expect(
      db.prepare("SELECT description FROM project_tasks").get().description,
    ).toBe("Original");
  });
  it("enforces native UTF-8 description bounds before reserving a conversion", () => {
    const id = queue.enqueue(
      request({ description: "汉".repeat(4000) }),
    ).proposalId;
    expect(() => queue.prepareDraft({ id })).toThrow(
      "NATIVE_DESCRIPTION_LIMIT",
    );
    expect(conversions()).toBe(0);
  });
});

describe("CLI SDK to actual native queue adapter", () => {
  it("requires real declared plugin trust/consent and independent host project authority", async () => {
    const cwd = path.join(directory, "workspace"),
      nameDir = path.join(
        cwd,
        ".chainlesschain/plugins",
        plugin.name,
        plugin.version,
      );
    fs.mkdirSync(nameDir, { recursive: true });
    const permissions = { goalExtension: ["proposal:task.description.update"] };
    fs.writeFileSync(
      path.join(nameDir, "plugin.json"),
      JSON.stringify({
        name: plugin.name,
        version: plugin.version,
        permissions,
        goalExtension: {
          apiVersion: "1.0.0",
          hosts: { cli: "*" },
          events: [],
          panels: [],
          proposals: ["task.description.update"],
        },
      }),
    );
    fs.writeFileSync(
      path.join(path.dirname(nameDir), ".active"),
      plugin.version,
    );
    vi.spyOn(trustDeps, "storePath").mockReturnValue(
      path.join(directory, "trust.json"),
    );
    vi.spyOn(trustDeps, "workspaceTrustStorePath").mockReturnValue(
      path.join(directory, "workspace-trust.json"),
    );
    vi.spyOn(consentDeps, "storePath").mockReturnValue(
      path.join(directory, "consent.json"),
    );
    vi.stubEnv(
      "CC_PLUGIN_TRANSACTION_HOME",
      path.join(directory, "transactions"),
    );
    const options = {
      cwd,
      managedSettingsFile: path.join(directory, "no-managed.json"),
      env: {
        ...process.env,
        CC_PLUGINS: "1",
        CC_PLUGIN_SCOPES: "project",
        CHAINLESSCHAIN_HOME: path.join(directory, "home"),
      },
      host: {
        id: "cli",
        version: "0.166.104",
        capabilities: ["proposal:task.description.update"],
      },
      authorize: () => true,
      enqueueProposal: (context) => queue.enqueueFromGoalExtension(context),
    };
    admission = () =>
      collectGoalExtensions(options).extensions.some(
        (entry) =>
          entry.name === plugin.name &&
          entry.version === plugin.version &&
          entry.scope === plugin.scope,
      )
        ? "cli-grant:1"
        : null;
    await expect(
      proposeGoalExtensionAction(plugin, request(), options),
    ).rejects.toThrow("not currently admitted");
    trustPlugin(plugin.name, {
      scope: plugin.scope,
      version: plugin.version,
      workspaceRoot: cwd,
    });
    consentPluginCapabilities(plugin.name, {
      scope: plugin.scope,
      version: plugin.version,
      capabilities: normalizeCapabilities(permissions),
    });
    const result = await proposeGoalExtensionAction(plugin, request(), options);
    expect(queue.get({ id: result.proposalId }).source.reviewId).toBe(
      source.reviewId,
    );
    revokeCapabilityConsent(plugin.name, { scope: plugin.scope });
    expect(() => queue.get({ id: result.proposalId })).toThrow("NOT_ADMITTED");
    await expect(
      proposeGoalExtensionAction(
        plugin,
        request({ requestId: "second" }),
        options,
      ),
    ).rejects.toThrow();
    expect(count()).toBe(1);
    actor = "did:other";
    expect(() =>
      queue.enqueue(request({ requestId: "forged-actor" })),
    ).toThrow();
  });
});
