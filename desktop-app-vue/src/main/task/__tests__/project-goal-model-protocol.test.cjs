"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");
const Database = require("better-sqlite3");
const {
  ProjectGoalWorkflow,
} = require("@chainlesschain/session-core/project-goal-workflow");
const {
  ProjectGoalMemoryService,
} = require("@chainlesschain/session-core/project-goal-memory");
const {
  ContextMemoryKernel,
  NativeSqliteMemoryPort,
} = require("@chainlesschain/context-memory-kernel");
const { ProjectGoalModelDrafts } = require("../project-goal-model-drafts");
const {
  createDesktopModelIngressHost,
} = require("../../evolution/desktop-model-ingress");

// Only inactive providers/health probes are substituted. Actual manager branding,
// signed ingress/projector, model adapter, SQLite and literal loopback socket run.
function loadManager() {
  const original = Module._load;
  Module._load = function (request, ...args) {
    if (request === "axios")
      return {
        create: () => ({
          get: async () => {
            throw new Error("inactive health probe");
          },
          post: () => {
            throw new Error("MUTABLE AXIOS MUST NOT DISPATCH");
          },
        }),
      };
    if (
      args[0]?.filename?.endsWith("llm-manager.js") &&
      [
        "./openai-client",
        "./anthropic-client",
        "./gemini-client",
        "./mistral-client",
        "./volcengine-tools",
        "./manus-optimizations",
      ].includes(request)
    )
      return {};
    return original.call(this, request, ...args);
  };
  try {
    return require("../../llm/llm-manager");
  } finally {
    Module._load = original;
  }
}
let managers;
async function fixture(mode) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-goal-model-protocol-"),
  );
  const db = new Database(path.join(directory, "project.sqlite"));
  const actor = "did:chainless:owner",
    now = 1791321600000;
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
    CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
    INSERT INTO projects VALUES('p1','${actor}','active',10,0);
    INSERT INTO project_tasks VALUES('t1','p1','query_info','Original','pending',10,10,0,'synced',20,NULL);`);
  let service;
  const workflow = new ProjectGoalWorkflow({
    db,
    getActor: () => actor,
    clock: () => now,
    verifyExtensionIntent: (context) =>
      service.queue.verifyIntentInTransaction(context),
  });
  const memory = new ProjectGoalMemoryService({
    db,
    getActor: () => actor,
    clock: () => now,
    memoryHostFactory: ({ scope, authorize }) => {
      const port = new NativeSqliteMemoryPort({ db, scope, authorize });
      return {
        port,
        kernel: new ContextMemoryKernel({
          memoryPort: port,
          reconciliationPort: port,
          clock: () => now,
        }),
      };
    },
  });
  let goal = workflow.goals.create({
    projectId: "p1",
    objective: "Review delivery",
  });
  goal = workflow.goals.revise({
    id: goal.id,
    expectedRevision: goal.revision,
    patch: { allowedActionTypes: ["task.create"] },
  });
  goal = (
    await memory.create({
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId: "memory-1",
      category: "user-fact",
      content: "Sensitive current goal preference",
    })
  ).goal;
  const item = memory.list({ goalId: goal.id }).items[0];
  const revoke = () => {
    goal = memory.revoke({
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId: "revoke",
      memoryId: item.memoryId,
      memoryVersion: item.currentVersion,
    }).goal;
  };
  const review = workflow.risk.evaluate({ projectId: "p1" });
  db.transaction(() =>
    workflow.observeInTransaction({
      goalId: goal.id,
      reviewId: review.review.id,
    }),
  ).immediate();
  const source = workflow
    .list({ goalId: goal.id })
    .proposals.find((r) => r.current && r.proposal.actionType === "task.create")
    .proposal.id;
  const state = { requests: 0, bodies: [], compositions: [] };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    state.requests++;
    state.bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
    if (mode === "revoke-response") revoke();
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        model: "goal-test:latest",
        done: mode !== "incomplete",
        done_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify({
            title: "Model review",
            description: "Pending suggestion from actual governed protocol",
          }),
          ...(mode === "tool-output" ? { tool_calls: [{}] } : {}),
        },
        prompt_eval_count: 31,
        eval_count: 12,
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const repo = path.resolve(__dirname, "../../../../..");
  const { createAgentEvolutionRuntimeComposition } = await import(
    pathToFileURL(
      path.join(
        repo,
        "packages/cli/src/lib/evolution/agent-evolution-runtime-composition.js",
      ),
    ).href
  );
  const { createTestAgentEvolutionComposition } = await import(
    pathToFileURL(
      path.join(
        repo,
        "packages/cli/__tests__/fixtures/agent-evolution-test-deployment.js",
      ),
    ).href
  );
  const ingress = createDesktopModelIngressHost(async (context) => {
    if (mode === "revoke-preparation") revoke();
    const composition = createTestAgentEvolutionComposition(
      createAgentEvolutionRuntimeComposition,
      context,
      path.join(directory, "evidence"),
    );
    state.compositions.push(composition);
    return composition;
  });
  managers ||= loadManager();
  const manager = new managers.LLMManager(
    {
      provider: "ollama",
      ollamaURL: endpoint,
      model: "goal-test",
      enableStateBus: false,
      enableManusOptimizations: false,
    },
    ingress,
  );
  await manager.initialize();
  service = new ProjectGoalModelDrafts({
    workflow,
    memory,
    clock: () => now,
    getManager: () => manager,
    confirm: async () => true,
  });
  const request = {
    goalRef: {
      id: goal.id,
      storeId: goal.storeId,
      revision: goal.revision,
      controlGeneration: goal.controlGeneration,
    },
    sourceRef: source,
    requestId: "protocol-1",
    type: "task.create",
    taskType: "analyze_data",
    useMemory: true,
  };
  return {
    db,
    state,
    service,
    request,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      db.close();
      const resolved = path.resolve(directory);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith("cc-goal-model-protocol-"));
      fs.rmSync(resolved, { recursive: true, force: true });
    },
  };
}
test("governed local goal draft crosses actual signed ingress/projector and one socket with real token counts", async () => {
  const f = await fixture("success");
  try {
    const result = await f.service.generate(f.request);
    assert.equal(result.state, "saved");
    assert.equal(f.state.requests, 1);
    const body = f.state.bodies[0];
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.equal(body.tools, undefined);
    assert.ok(
      JSON.stringify(body.messages).includes(
        "Sensitive current goal preference",
      ),
    );
    assert.equal(
      f.service.read({ id: result.proposalId }).proposal.taskType,
      "analyze_data",
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS n FROM project_tasks").get().n,
      1,
    );
    const usage = JSON.parse(
      f.db.prepare("SELECT record_json FROM cc_project_goal_usage").get()
        .record_json,
    );
    assert.equal(usage.usage.tokens, 43);
    assert.equal(usage.usage.costUsd, null);
    assert.equal(
      (await f.service.generate(f.request)).proposalId,
      result.proposalId,
    );
    assert.equal(f.state.requests, 1);
    assert.ok(f.state.compositions.length > 0);
  } finally {
    await f.close();
  }
});
for (const mode of [
  "revoke-preparation",
  "revoke-response",
  "incomplete",
  "tool-output",
]) {
  test(`actual governed protocol refuses ${mode} without publishing a pending draft`, async () => {
    const f = await fixture(mode);
    try {
      const result = await f.service.generate(f.request);
      assert.equal(
        result.state,
        mode === "revoke-preparation" ? "failed" : "unknown",
      );
      assert.equal(f.state.requests, mode === "revoke-preparation" ? 0 : 1);
      assert.equal(
        f.db
          .prepare("SELECT COUNT(*) AS n FROM cc_project_goal_extension_drafts")
          .get().n,
        0,
      );
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM cc_project_goal_usage").get().n,
        mode === "revoke-preparation" ? 0 : 1,
      );
      await f.service.generate(f.request);
      assert.equal(f.state.requests, mode === "revoke-preparation" ? 0 : 1);
    } finally {
      await f.close();
    }
  });
}
