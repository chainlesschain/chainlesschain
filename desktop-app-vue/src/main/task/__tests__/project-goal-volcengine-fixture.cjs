"use strict";
// Synthetic project only. Real SQLite, manager/client brands and signed TEST
// deployment ingress. Only inactive providers and Axios health/transport are
// blocked; the goal adapter uses native HTTPS in both protocol and live probes.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const Module = require("node:module"),
  { pathToFileURL } = require("node:url");
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
const {
  createDesktopModelIngressHost,
} = require("../../evolution/desktop-model-ingress");
const { ProjectGoalModelDrafts } = require("../project-goal-model-drafts");
const {
  captureProjectGoalModel,
  ENDPOINT,
} = require("../project-goal-volcengine-model");
const SYNTHETIC_MEMORY =
  "Synthetic delivery checklist reference: AZURE-17. Assigned reviewer: Mira. The reviewer prefers a dated follow-up checklist.";
function loadManager() {
  const original = Module._load;
  Module._load = function (request, ...args) {
    if (request === "axios")
      return {
        create: () => ({
          get: async () => {
            throw new Error("Health probe disabled in evaluation");
          },
          post: () => {
            throw new Error("Axios model dispatch forbidden in evaluation");
          },
        }),
      };
    if (
      args[0]?.filename?.endsWith("llm-manager.js") &&
      [
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
// Load under the transport guard before any brand-rejection test can cache the
// real manager and its Axios dependency. The protocol mock accepts only the
// adapter's three-argument request, never a health probe from follow-redirects.
const managers = loadManager();
async function createFixture({
  apiKey = "synthetic-test-key",
  model = "synthetic-model",
  provider = "volcengine",
  endpoint = ENDPOINT,
  type = "task.create",
  useMemory = true,
  mode = "success",
  confirm = true,
} = {}) {
  // Evidence storage requires physical ancestors; macOS exposes /var through
  // a symlink to /private/var. Use the physical name for every fixture path.
  const directory = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-goal-volcengine-")),
  );
  const db = new Database(path.join(directory, "project.sqlite"));
  const actor = "did:chainless:synthetic-reviewer",
    now = Date.now();
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,updated_at INTEGER,deleted INTEGER DEFAULT 0);
    CREATE TABLE project_tasks(id TEXT PRIMARY KEY,project_id TEXT,task_type TEXT,description TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,deleted INTEGER DEFAULT 0,sync_status TEXT,due_date INTEGER,blocked_by TEXT);
    INSERT INTO projects VALUES('synthetic-project','${actor}','active',10,0);
    INSERT INTO project_tasks VALUES('synthetic-overdue','synthetic-project','query_info','Synthetic API delivery review awaiting verification','pending',10,10,0,'synced',20,NULL);`);
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
    projectId: "synthetic-project",
    objective:
      "Synthetic evaluation only: follow up overdue API delivery review, ask for verification and an owner/date checklist. Draft in English. Do not claim the review or project is complete.",
  });
  goal = workflow.goals.revise({
    id: goal.id,
    expectedRevision: goal.revision,
    patch: { allowedActionTypes: ["task.create", "task.update-description"] },
  });
  if (useMemory)
    goal = (
      await memory.create({
        goalId: goal.id,
        expectedRevision: goal.revision,
        requestId: "synthetic-memory",
        category: "user-fact",
        content: SYNTHETIC_MEMORY,
      })
    ).goal;
  const revoke = () => {
    const item = memory.list({ goalId: goal.id }).items[0];
    goal = memory.revoke({
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId: "synthetic-revoke",
      memoryId: item.memoryId,
      memoryVersion: item.currentVersion,
    }).goal;
  };
  const review = workflow.risk.evaluate({ projectId: "synthetic-project" });
  db.transaction(() =>
    workflow.observeInTransaction({
      goalId: goal.id,
      reviewId: review.review.id,
    }),
  ).immediate();
  const source = workflow
    .list({ goalId: goal.id })
    .proposals.find(
      (r) =>
        r.current &&
        r.proposal.actionType ===
          (type === "task.create" ? type : "task.update-description"),
    ).proposal.id;
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
  const state = {
    dispatchAttempts: 0,
    providerResults: [],
    consents: [],
    compositions: [],
  };
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
  const manager = new managers.LLMManager(
    {
      provider,
      baseURL: endpoint,
      apiKey,
      model,
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
    confirm: async (context) => {
      state.consents.push(context);
      return confirm;
    },
    captureModel: (value) => {
      const captured = captureProjectGoalModel(value);
      return {
        ...captured,
        async run(messages, options) {
          const result = await captured.run(messages, {
            ...options,
            beforeDispatch(evidence) {
              options.beforeDispatch(evidence);
              state.dispatchAttempts++;
            },
          });
          state.providerResults.push(result);
          return result;
        },
      };
    },
  });
  const request = {
    goalRef: {
      id: goal.id,
      storeId: goal.storeId,
      revision: goal.revision,
      controlGeneration: goal.controlGeneration,
    },
    sourceRef: source,
    requestId: "synthetic-live-1",
    type,
    ...(type === "task.create" ? { taskType: "analyze_data" } : {}),
    useMemory,
  };
  return {
    db,
    manager,
    workflow,
    memory,
    service,
    state,
    request,
    revoke,
    directory,
    close() {
      db.close();
      const resolved = fs.realpathSync.native(directory),
        base = fs.realpathSync.native(os.tmpdir());
      if (
        path.dirname(resolved) !== base ||
        !path.basename(resolved).startsWith("cc-goal-volcengine-")
      )
        throw new Error("Temporary cleanup target mismatch");
      fs.rmSync(resolved, { recursive: true, force: true });
    },
  };
}
module.exports = { createFixture, SYNTHETIC_MEMORY };
