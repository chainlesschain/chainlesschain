import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  createProjectGoalHost,
  registerProjectGoalIPC,
  CHANNELS,
} = require("../project-goal-ipc");
const {
  ProjectGoalWorkflow,
} = require("@chainlesschain/session-core/project-goal-workflow");
const owner = "did:chainless:owner";
let db, host, goal, actor, now, event, electron, manager, model, sources;
const ref = () => ({
  id: goal.id,
  storeId: goal.storeId,
  revision: goal.revision,
  controlGeneration: goal.controlGeneration,
});
const input = (type = "task.create", extra = {}) => ({
  goalRef: ref(),
  sourceRef: sources[type],
  requestId: "model-request-1",
  type,
  useMemory: false,
  ...(type === "task.create" ? { taskType: "analyze_data" } : {}),
  ...extra,
});
const status = (requestId = "model-request-1") =>
  host.modelDraftStatus(event, { goalId: goal.id, requestId });
const count = (table) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
function open() {
  host = createProjectGoalHost({
    database: db,
    electron,
    getCurrentUserDid: () => actor,
    clock: () => now,
    monitoringController: { initialize() {}, close() {} },
    modelDraftDependencies: {
      getManager: () => manager,
      captureModel: () => model,
    },
  });
}
function observe() {
  const w = new ProjectGoalWorkflow({
    db,
    getActor: () => actor,
    clock: () => now,
  });
  const review = w.risk.evaluate({ projectId: "p1" });
  db.transaction(() =>
    w.observeInTransaction({ goalId: goal.id, reviewId: review.review.id }),
  ).immediate();
  sources = Object.fromEntries(
    w
      .list({ goalId: goal.id })
      .proposals.filter((r) => r.current)
      .map((r) => [
        r.proposal.actionType === "task.create"
          ? "task.create"
          : "task.description.update",
        r.proposal.id,
      ]),
  );
}
async function memory(expiresAt) {
  const saved = await host.memoryCreate(event, {
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId: "memory-1",
    category: "user-fact",
    content: "Owner-approved confidential delivery preference",
    ...(expiresAt ? { expiresAt } : {}),
  });
  goal = saved.goal;
  observe();
  return host.memoryList(event, { goalId: goal.id }).items[0];
}
function revokeMemory(item) {
  goal = host.memoryRevoke(event, {
    goalId: goal.id,
    expectedRevision: goal.revision,
    requestId: "revoke-memory",
    memoryId: item.memoryId,
    memoryVersion: item.currentVersion,
  }).goal;
}
beforeEach(() => {
  db = new Database(":memory:");
  actor = owner;
  now = 1791321600000;
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
    CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
    INSERT INTO projects VALUES('p1','${owner}','active',10,0);
    INSERT INTO project_tasks VALUES('t1','p1','query_info','Original task', 'pending',10,10,0,'synced',20,NULL);`);
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
  });
  event = {
    sender: Object.assign(new EventEmitter(), { isDestroyed: () => false }),
    senderFrame: { url: "http://localhost:5173", parent: null },
  };
  electron = {
    BrowserWindow: { fromWebContents: () => window },
    dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
    ipcMain: { handle: vi.fn() },
  };
  manager = {};
  model = {
    provider: "ollama",
    model: "fixture-model",
    endpoint: "http://127.0.0.1:11434",
    check: vi.fn(),
    run: vi.fn(async (_messages, options) => {
      options.checkAuthority();
      options.beforeDispatch({ runId: "evidence-run-1", tenantId: "tenant-1" });
      return {
        summary: JSON.stringify({
          title: "Review delivery",
          description: "Model-generated pending suggestion",
        }),
        usage: { promptTokens: 5, completionTokens: 3 },
      };
    }),
  };
  open();
  goal = host.create(event, { projectId: "p1", objective: "Follow delivery" });
  goal = host.revise(event, {
    id: goal.id,
    expectedRevision: goal.revision,
    patch: { allowedActionTypes: ["task.create", "task.update-description"] },
  });
  observe();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (db.open) db.close();
});

describe("native on-demand model drafts with output-time memory authorization", () => {
  it("lists body-free request history after restart and blocks new identities while one outcome is unknown", async () => {
    model.run.mockImplementation(async (_messages, options) => {
      options.beforeDispatch({ runId: "evidence-run-1", tenantId: "tenant-1" });
      throw new Error("lost response");
    });
    const request = input();
    await host.generateModelDraft(event, request);
    open();
    const page = host.modelDraftRequests(event, { goalId: goal.id, limit: 20 });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      requestId: request.requestId,
      state: "unknown",
    });
    expect(JSON.stringify(page)).not.toMatch(
      /memoryToken|model-generated|messages|endpoint/i,
    );
    await expect(
      host.generateModelDraft(event, {
        ...request,
        requestId: "replacement-request",
      }),
    ).rejects.toThrow("OPERATION_PENDING");
    expect(model.run).toHaveBeenCalledOnce();
    host.revokeModelDraft(event, {
      goalId: goal.id,
      requestId: request.requestId,
    });
    expect(
      host.modelDraftRequests(event, { goalId: goal.id }).entries[0].state,
    ).toBe("revoked");
    actor = "did:other";
    expect(() => host.modelDraftRequests(event, { goalId: goal.id })).toThrow();
  });
  it("bounds a stalled dispatch and retains unknown usage without accepting late output", async () => {
    vi.useFakeTimers();
    let finish;
    model.run.mockImplementation((_messages, options) => {
      options.beforeDispatch({ runId: "evidence-run-1", tenantId: "tenant-1" });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const request = input();
    const pending = host.generateModelDraft(event, request);
    await vi.advanceTimersByTimeAsync(30001);
    expect((await pending).state).toBe("unknown");
    finish({
      summary: JSON.stringify({
        title: "Late",
        description: "Must not be saved",
      }),
      usage: { promptTokens: 5, completionTokens: 3 },
    });
    await Promise.resolve();
    expect(count("cc_project_goal_extension_drafts")).toBe(0);
    expect((await host.generateModelDraft(event, request)).state).toBe(
      "unknown",
    );
    expect(model.run).toHaveBeenCalledOnce();
  });
  it("does not redispatch a request ID after goal revision changes", async () => {
    const request = input();
    await host.generateModelDraft(event, request);
    goal = host.revise(event, {
      id: goal.id,
      expectedRevision: goal.revision,
      patch: { objective: "Revised objective" },
    });
    observe();
    await expect(host.generateModelDraft(event, input())).rejects.toThrow(
      "REQUEST_CONFLICT",
    );
    expect(model.run).toHaveBeenCalledOnce();
    expect(status().state).toBe("saved");
  });
  it.each(["task.create", "task.description.update"])(
    "saves %s pending only and requires separate current native preview/confirmation",
    async (type) => {
      const request = input(type);
      const saved = await host.generateModelDraft(event, request);
      expect(saved).toMatchObject({
        state: "saved",
        type,
        requestId: request.requestId,
      });
      expect(count("project_tasks")).toBe(1);
      expect(count("cc_business_action_runs")).toBe(0);
      expect(model.run).toHaveBeenCalledOnce();
      expect(electron.dialog.showMessageBox).toHaveBeenCalledOnce();
      const text = electron.dialog.showMessageBox.mock.calls[0][1].detail;
      expect(text).toContain("拟发送的完整资料");
      expect(text).toContain("fixture-model");
      expect(await host.generateModelDraft(event, request)).toEqual(saved);
      expect(model.run).toHaveBeenCalledOnce();
      open();
      const draft = host.readModelDraft(event, { id: saved.proposalId });
      expect(draft.proposal.description).toContain("Model-generated");
      expect(
        host.listModelDrafts(event, { goalRef: ref(), type }).entries,
      ).toHaveLength(1);
      const prepared = host.prepareModelDraft(event, { id: saved.proposalId });
      expect(count("project_tasks")).toBe(1);
      const executed = await host.executeIntent(event, {
        intentId: prepared.intent.id,
      });
      expect(executed.run.status).toBe("succeeded");
      expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(2);
      expect(count("project_tasks")).toBe(type === "task.create" ? 2 : 1);
      host.revokeModelDraft(event, {
        goalId: goal.id,
        requestId: request.requestId,
      });
      expect(
        (await host.executeIntent(event, { intentId: prepared.intent.id }))
          .replayed,
      ).toBe(true);
      const usage = JSON.parse(
        db
          .prepare(
            "SELECT record_json FROM cc_project_goal_usage WHERE json_extract(record_json,'$.domain')='model'",
          )
          .get().record_json,
      );
      expect(usage).toMatchObject({
        status: "settled",
        usage: { tokens: 8, costUsd: null, runs: 1 },
      });
    },
  );
  it("uses memory only by explicit selection and stores a body-free journal proof", async () => {
    await memory();
    const saved = await host.generateModelDraft(
      event,
      input("task.create", { useMemory: true }),
    );
    expect(saved.state).toBe("saved");
    expect(model.run.mock.calls[0][0][1].content).toContain(
      "confidential delivery preference",
    );
    expect(
      db.prepare("SELECT record_json FROM cc_project_goal_model_drafts").get()
        .record_json,
    ).not.toMatch(/confidential|Model-generated|apiKey/);
    expect(
      host.readModelDraft(event, { id: saved.proposalId }).proposal.taskType,
    ).toBe("analyze_data");
  });
  it("does not include existing memory when selection is off", async () => {
    await memory();
    await host.generateModelDraft(event, input());
    expect(model.run.mock.calls[0][0][1].content).not.toContain("confidential");
  });
  it("declines native consent without dispatch or usage reservation and never resends that identity", async () => {
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    const request = input();
    expect((await host.generateModelDraft(event, request)).state).toBe(
      "denied",
    );
    expect(model.run).not.toHaveBeenCalled();
    expect(count("cc_project_goal_usage")).toBe(0);
    electron.dialog.showMessageBox.mockResolvedValue({ response: 1 });
    expect((await host.generateModelDraft(event, request)).state).toBe(
      "denied",
    );
    expect(model.run).not.toHaveBeenCalled();
  });
  it("pins caller action/type/identity before native consent awaits", async () => {
    const request = input();
    electron.dialog.showMessageBox.mockImplementationOnce(async () => {
      request.taskType = "deploy_project";
      request.sourceRef = "injected";
      request.requestId = "new-request";
      return { response: 1 };
    });
    const saved = await host.generateModelDraft(event, request);
    expect(saved).toMatchObject({
      requestId: "model-request-1",
      taskType: "analyze_data",
      state: "saved",
    });
  });
  it.each(["maxTokens", "maxCostUsd", "maxRuns"])(
    "rejects insufficient or unbounded %s budget before consent/dispatch",
    async (key) => {
      goal = host.revise(event, {
        id: goal.id,
        expectedRevision: goal.revision,
        patch: {
          budgetPolicy: {
            maxTokens: null,
            maxCostUsd: null,
            maxRuns: null,
            maxTimeMs: null,
            [key]: key === "maxCostUsd" ? 1 : 1,
          },
        },
      });
      observe();
      if (key === "maxRuns") {
        const workflow = new ProjectGoalWorkflow({
          db,
          getActor: () => actor,
          clock: () => now,
        });
        db.transaction(() => {
          workflow.usage.reserve({ goal, actor, operationId: "existing-run" });
          workflow.usage.settle({
            operationId: "existing-run",
            actor,
            goalId: goal.id,
            status: "settled",
            usage: { runs: 1, tokens: 0, costUsd: 0, elapsedMs: 0 },
          });
        }).immediate();
      }
      await expect(host.generateModelDraft(event, input())).rejects.toThrow(
        /GOAL_USAGE_/,
      );
      expect(model.run).not.toHaveBeenCalled();
      expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
    },
  );
  it("retains an unknown dispatched identity and unknown usage across host restart", async () => {
    model.run.mockImplementation(async (_messages, options) => {
      options.beforeDispatch({ runId: "evidence-run-1", tenantId: "tenant-1" });
      throw new Error("provider disconnected");
    });
    const request = input();
    expect((await host.generateModelDraft(event, request)).state).toBe(
      "unknown",
    );
    open();
    expect(status().state).toBe("unknown");
    expect((await host.generateModelDraft(event, request)).state).toBe(
      "unknown",
    );
    expect(model.run).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        db.prepare("SELECT record_json FROM cc_project_goal_usage").get()
          .record_json,
      ).status,
    ).toBe("unknown");
    expect(count("cc_project_goal_extension_drafts")).toBe(0);
  });
  it.each(["extra action", "invalid JSON", "oversized body"])(
    "rejects %s without accepting task authority from the model",
    async (kind) => {
      const original = model.run.getMockImplementation();
      model.run.mockImplementation(async (...args) => {
        const r = await original(...args);
        r.summary =
          kind === "invalid JSON"
            ? "not json"
            : JSON.stringify({
                title: "Title",
                description:
                  kind === "oversized body" ? "x".repeat(8193) : "Text",
                ...(kind === "extra action" ? { type: "task.create" } : {}),
              });
        return r;
      });
      const result = await host.generateModelDraft(event, input());
      expect(result.state).toBe("unknown");
      expect(count("cc_project_goal_extension_drafts")).toBe(0);
      expect(count("project_tasks")).toBe(1);
      expect(count("cc_project_goal_usage")).toBe(1);
    },
  );
  it("denies memory revocation during inference before publishing or saving output", async () => {
    const item = await memory();
    const original = model.run.getMockImplementation();
    model.run.mockImplementation(async (...args) => {
      const r = await original(...args);
      revokeMemory(item);
      return r;
    });
    expect(
      (
        await host.generateModelDraft(
          event,
          input("task.create", { useMemory: true }),
        )
      ).state,
    ).toBe("unknown");
    expect(count("cc_project_goal_extension_drafts")).toBe(0);
  });
  it("hides an expired memory-derived draft and refuses its unconfirmed intent", async () => {
    await memory(new Date(now + 1000).toISOString());
    const saved = await host.generateModelDraft(
      event,
      input("task.create", { useMemory: true }),
    );
    const prepared = host.prepareModelDraft(event, { id: saved.proposalId });
    now += 2000;
    expect(() =>
      host.readModelDraft(event, { id: saved.proposalId }),
    ).toThrow();
    expect(
      host.listModelDrafts(event, { goalRef: ref(), type: "task.create" }),
    ).toMatchObject({ entries: [], unavailableCount: 1 });
    await expect(
      host.executeIntent(event, { intentId: prepared.intent.id }),
    ).rejects.toThrow();
    expect(count("project_tasks")).toBe(1);
  });
  it("revokes a model draft during task confirmation and preserves completed receipt replay", async () => {
    const saved = await host.generateModelDraft(event, input());
    const prepared = host.prepareModelDraft(event, { id: saved.proposalId });
    electron.dialog.showMessageBox.mockImplementation(async () => {
      host.revokeModelDraft(event, {
        goalId: goal.id,
        requestId: "model-request-1",
      });
      return { response: 1 };
    });
    await expect(
      host.executeIntent(event, { intentId: prepared.intent.id }),
    ).rejects.toThrow();
    expect(count("project_tasks")).toBe(1);
    expect(status().state).toBe("revoked");
    expect(() =>
      host.readModelDraft(event, { id: saved.proposalId }),
    ).toThrow();
  });
  it("cannot resurrect native consent after individual draft revocation", async () => {
    let finish;
    electron.dialog.showMessageBox.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const pending = host.generateModelDraft(event, input());
    host.revokeModelDraft(event, {
      goalId: goal.id,
      requestId: "model-request-1",
    });
    finish({ response: 1 });
    expect((await pending).state).toBe("revoked");
    expect(model.run).not.toHaveBeenCalled();
  });
  it.each(["provider", "source", "navigation", "identity"])(
    "rechecks %s before socket dispatch and keeps the request body-free",
    async (kind) => {
      model.run.mockImplementation(async (_messages, options) => {
        if (kind === "provider") manager = {};
        if (kind === "source")
          db.exec("UPDATE project_tasks SET updated_at=99");
        if (kind === "navigation") event.sender.emit("did-start-navigation");
        if (kind === "identity") actor = "did:other";
        options.beforeDispatch({
          runId: "evidence-run-1",
          tenantId: "tenant-1",
        });
        throw new Error("must not dispatch");
      });
      const result = host.generateModelDraft(event, input());
      if (["identity", "navigation"].includes(kind))
        await expect(result).rejects.toThrow();
      else expect((await result).state).toBe("failed");
      expect(count("cc_project_goal_usage")).toBe(0);
      expect(count("cc_project_goal_extension_drafts")).toBe(0);
    },
  );
  it("rejects changed action/task type under the same identity and corrupt stored proofs", async () => {
    const request = input();
    const saved = await host.generateModelDraft(event, request);
    await expect(
      host.generateModelDraft(event, { ...request, taskType: "query_info" }),
    ).rejects.toThrow("REQUEST_CONFLICT");
    db.exec(
      "UPDATE cc_project_goal_model_drafts SET content_digest='tampered'",
    );
    expect(() => host.readModelDraft(event, { id: saved.proposalId })).toThrow(
      "CORRUPT",
    );
    expect(() =>
      host.listModelDrafts(event, { goalRef: ref(), type: "task.create" }),
    ).toThrow("CORRUPT");
  });
  it.each([
    ["volcengine", "https://ark.cn-beijing.volces.com/api/v3", "火山引擎云端"],
    ["custom", "http://192.168.31.79:8889/v1", "局域网 OpenAI"],
  ])(
    "native consent identifies %s and its actual destination",
    async (provider, endpoint, label) => {
      model.provider = provider;
      model.endpoint = endpoint;
      const saved = await host.generateModelDraft(event, input());
      expect(saved.state).toBe("saved");
      const dialog = electron.dialog.showMessageBox.mock.calls[0][1];
      expect(dialog.message).toContain(label);
      expect(dialog.detail).toContain(`提供方：${JSON.stringify(provider)}`);
      expect(dialog.detail).toContain(endpoint);
      expect(dialog.detail).toContain("拟发送的完整资料");
      expect(count("project_tasks")).toBe(1);
    },
  );
  it("registers only fixed model endpoints and rejects renderer-supplied model/authority fields", async () => {
    for (const key of [
      "model",
      "provider",
      "messages",
      "memoryToken",
      "approved",
      "actorDid",
    ])
      await expect(
        host.generateModelDraft(event, { ...input(), [key]: "injected" }),
      ).rejects.toThrow();
    expect(model.run).not.toHaveBeenCalled();
    registerProjectGoalIPC(db, {
      electron,
      getCurrentUserDid: () => actor,
      monitoringController: { initialize() {}, close() {} },
    });
    for (const method of [
      "generateModelDraft",
      "modelDraftStatus",
      "modelDraftRequests",
      "listModelDrafts",
      "readModelDraft",
      "prepareModelDraft",
      "revokeModelDraft",
    ])
      expect(
        electron.ipcMain.handle.mock.calls.some(
          ([channel]) => channel === CHANNELS[method],
        ),
      ).toBe(true);
  });
});
