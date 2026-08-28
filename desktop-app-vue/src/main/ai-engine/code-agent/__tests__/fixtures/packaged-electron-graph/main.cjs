/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain } = require("electron");

const JOURNEY_SCHEMA = "chainlesschain.desktop-packaged-graph-journey/v1";
const OUTPUT_DIGEST = `sha256:${"d".repeat(64)}`;
const STATE_DIR = path.resolve(
  process.env.CC_PACKAGED_GRAPH_STATE_DIR || path.join(process.cwd(), "state"),
);
const MODE = process.env.CC_PACKAGED_GRAPH_MODE;
const OUTPUT_PATH = path.resolve(
  process.env.CC_PACKAGED_GRAPH_OUTPUT || path.join(STATE_DIR, `${MODE}.json`),
);
const WORKFLOW_ID = "packaged-window-restart-workflow";
const AGENT_TASK_ID = "packaged-window-agent-task";
const SESSION_ID = "packaged-window-team-session";
const ENTRIES = Object.freeze([
  {
    entryId: "desktop-team",
    bindingSurface: "desktop_team",
    entityId: SESSION_ID,
    runId: `desktop-team:${SESSION_ID}`,
    nodeId: "recover-team-session",
    prompt: "resume the exact packaged Desktop team session",
  },
  {
    entryId: "desktop-specialized-agents",
    bindingSurface: "desktop_specialized_agents",
    entityId: AGENT_TASK_ID,
    runId: `desktop-specialized-task:${AGENT_TASK_ID}`,
    nodeId: "recover-specialized-agent",
    prompt: "resume the exact packaged Desktop specialized agent task",
  },
  {
    entryId: "desktop-workflow-manager",
    bindingSurface: "desktop_workflow_manager",
    entityId: WORKFLOW_ID,
    runId: `desktop-workflow:${WORKFLOW_ID}`,
    nodeId: "recover-workflow-state",
    prompt: "resume the exact packaged BrowserWindow durable input",
  },
]);
const PRIMARY_ENTRY = ENTRIES.at(-1);
const GRAPH_RUN_ID = PRIMARY_ENTRY.runId;

if (!new Set(["writer", "recover", "rollback"]).has(MODE)) {
  throw new Error(
    "CC_PACKAGED_GRAPH_MODE must be writer, recover, or rollback",
  );
}

app.setPath("userData", path.join(STATE_DIR, "user-data"));

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex")}`;
}

function definition(entry) {
  return {
    schemaVersion: 1,
    id: entry.runId,
    revision: 1,
    nodes: [
      {
        id: entry.nodeId,
        kind: "task",
        dependsOn: [],
        inputs: [],
        outputs: [],
        effectClass: "workspace_write",
        idempotencyKey: `desktop-packaged-window-recovery:${entry.entryId}`,
        workspaceIsolation: "declared_scope",
        writeSet: ["state/**"],
        retryLimit: 0,
      },
    ],
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: { turns: 2 },
    allowedCapabilities: [],
    metadata: {
      originSurface: "desktop",
      kind: "packaged_window_recovery",
      entryId: entry.entryId,
    },
  };
}

async function loadProductionModules() {
  const production = path.join(__dirname, "production");
  const databaseModule = await import(
    pathToFileURL(path.join(production, "database.mjs")).href
  );
  const registryModule = require(
    path.join(production, "desktop-graph-run-registry.cjs"),
  );
  const sessionModule = require(
    path.join(
      production,
      "ai-engine",
      "code-agent",
      "session-state-manager.cjs",
    ),
  );
  const graphModuleDirectory = path.join(
    production,
    "packages",
    "cli",
    "src",
    "lib",
    "app-server",
  );
  const graphModule = await import(
    pathToFileURL(path.join(graphModuleDirectory, "graph-runtime.mjs")).href
  );
  const rolloutModule = await import(
    pathToFileURL(path.join(graphModuleDirectory, "rollout-store.mjs")).href
  );
  return {
    DatabaseManager: databaseModule.DatabaseManager,
    DesktopGraphRunRegistry: registryModule.DesktopGraphRunRegistry,
    SessionStateManager: sessionModule.SessionStateManager,
    AppServerGraphRuntime: graphModule.AppServerGraphRuntime,
    JsonlRolloutStore: rolloutModule.JsonlRolloutStore,
  };
}

function writeExclusive(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function readStoreEvents(store, threadId) {
  try {
    return store.read(threadId);
  } catch (error) {
    if (error?.code === "CC_ROLLOUT_THREAD_NOT_FOUND") return [];
    throw error;
  }
}

function collectStoreEvidence({
  database,
  registry,
  rolloutStore,
  runtime,
  sessionManager,
}) {
  const bindings = Object.fromEntries(
    ENTRIES.map((entry) => [
      entry.entryId,
      registry.get(entry.bindingSurface, entry.entityId),
    ]),
  );
  const agentTask = database
    .prepare("SELECT * FROM agent_task_history WHERE id = ?")
    .get(AGENT_TASK_ID);
  const sessionState = {
    plan: sessionManager.readPlan(SESSION_ID),
    progress: sessionManager.readProgress(SESSION_ID),
    tasks: sessionManager.readTasks(SESSION_ID),
    mode: sessionManager.getStage(SESSION_ID),
  };
  const graphStores = (entry) => [
    {
      store: "GraphEventStore",
      value: readStoreEvents(rolloutStore, entry.runId),
    },
    {
      store: "AppServerGraphRequestReceipt",
      value: readStoreEvents(rolloutStore, runtime._requestThread(entry.runId)),
    },
    {
      store: "AppServerGraphExecutorReceipt",
      value: readStoreEvents(rolloutStore, `graph-executor:${entry.runId}`),
    },
  ];
  const team = ENTRIES[0];
  const specialized = ENTRIES[1];
  const workflow = ENTRIES[2];
  const stores = [
    {
      surface: "desktop",
      entryId: team.entryId,
      store: "SessionStateManager",
      value: sessionState,
    },
    ...graphStores(team).map((store) => ({
      surface: "desktop",
      entryId: team.entryId,
      ...store,
    })),
    {
      surface: "desktop",
      entryId: specialized.entryId,
      store: "agent_task_history",
      value: agentTask,
    },
    {
      surface: "desktop",
      entryId: specialized.entryId,
      store: "desktop_graph_run_bindings",
      value: bindings[specialized.entryId],
    },
    ...graphStores(specialized).map((store) => ({
      surface: "desktop",
      entryId: specialized.entryId,
      ...store,
    })),
    {
      surface: "desktop",
      entryId: workflow.entryId,
      store: "desktop_graph_run_bindings",
      value: bindings[workflow.entryId],
    },
    ...graphStores(workflow).map((store) => ({
      surface: "desktop",
      entryId: workflow.entryId,
      ...store,
    })),
  ];
  return stores.map(({ surface, entryId, store, value }) => ({
    surface,
    entryId,
    store,
    recordCount: Array.isArray(value) ? value.length : value ? 1 : 0,
    stateDigest: digest({ surface, entryId, store, value }),
  }));
}

async function openJourney() {
  const {
    DatabaseManager,
    DesktopGraphRunRegistry,
    SessionStateManager,
    AppServerGraphRuntime,
    JsonlRolloutStore,
  } = await loadProductionModules();
  const databasePath = path.join(STATE_DIR, "desktop.db");
  const rolloutDirectory = path.join(STATE_DIR, "rollouts");
  const database = new DatabaseManager(databasePath, {
    encryptionEnabled: false,
  });
  await database.initialize();
  if (database.adapter !== null || typeof database.db?.export !== "function") {
    throw new Error("packaged journey requires the production sql.js path");
  }
  const registry = new DesktopGraphRunRegistry({ database });
  if (typeof SessionStateManager !== "function") {
    throw new Error("packaged SessionStateManager bundle is unavailable");
  }
  const sessionManager = new SessionStateManager({
    projectRoot: path.join(STATE_DIR, "project"),
  });
  const rolloutStore = new JsonlRolloutStore({ directory: rolloutDirectory });
  const recoveredPrompts = {};
  const runtime = new AppServerGraphRuntime({
    rolloutStore,
    executeNode:
      MODE !== "recover"
        ? async () => new Promise(() => {})
        : async ({ input }) => {
            const entry = ENTRIES.find(
              (candidate) => candidate.prompt === input.prompt,
            );
            if (!entry)
              throw new Error("recovered Graph input is not entry-bound");
            recoveredPrompts[entry.entryId] = input.prompt;
            return {
              status: "succeeded",
              terminalEvidence: { outputDigest: OUTPUT_DIGEST },
              usage: { turns: 1, tokens: 1, wallMs: 1 },
            };
          },
  });

  if (MODE === "writer") {
    sessionManager.writeIntent(SESSION_ID, {
      goal: "recover the packaged Desktop team session",
    });
    sessionManager.writePlan(SESSION_ID, {
      title: "Packaged Desktop recovery",
      steps: ["persist cutpoint", "recover after process kill"],
      approved: true,
    });
    sessionManager.writeTasks(SESSION_ID, {
      stage: "execute",
      tasks: [{ id: "recover", status: "running" }],
    });
    sessionManager.appendProgress(SESSION_ID, "packaged Graph cutpoint ready");
    database
      .prepare(
        `INSERT INTO agent_task_history
           (id, agent_id, template_type, task_description, started_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        AGENT_TASK_ID,
        "packaged-agent",
        "graph-recovery",
        "recover after packaged process kill",
        Date.now(),
      );
    const projections = {};
    for (const entry of ENTRIES) {
      const projection = runtime.start({
        definition: definition(entry),
        inputs: {
          [entry.nodeId]: { prompt: entry.prompt },
        },
        runId: entry.runId,
        originSurface: "desktop",
        authorityMode: "canonical",
      });
      projections[entry.entryId] = projection;
      registry.record({
        surface: entry.bindingSurface,
        entityId: entry.entityId,
        graphRunId: entry.runId,
        authorityMode: "canonical",
        lifecycleStatus: projection.status,
        metadata: { title: `Packaged recovery ${entry.entryId}` },
        lastProjection: projection,
      });
    }
    return {
      database,
      registry,
      sessionManager,
      rolloutStore,
      runtime,
      projection: projections[PRIMARY_ENTRY.entryId],
      projections,
      recoveredPrompt: null,
      recoveredPrompts,
    };
  }

  const previous = {};
  for (const entry of ENTRIES) {
    previous[entry.entryId] = registry.get(
      entry.bindingSurface,
      entry.entityId,
    );
    if (previous[entry.entryId]?.graphRunId !== entry.runId) {
      throw new Error(
        `packaged recovery could not hydrate ${entry.entryId} binding`,
      );
    }
  }
  const restoredCutpointStores =
    MODE === "rollback"
      ? collectStoreEvidence({
          database,
          registry,
          rolloutStore,
          runtime,
          sessionManager,
        })
      : null;
  const projections = {};
  for (const entry of ENTRIES) {
    const projection =
      MODE === "rollback"
        ? runtime.status(entry.runId)
        : await runtime.resume(entry.runId, { waitForCompletion: true });
    projections[entry.entryId] = projection;
    registry.updateProjection(entry.bindingSurface, entry.entityId, projection);
  }
  if (MODE === "recover") {
    sessionManager.updateTaskStatus(SESSION_ID, "recover", "completed", {
      outputDigest: OUTPUT_DIGEST,
    });
    sessionManager.appendProgress(
      SESSION_ID,
      "packaged Graph recovery settled",
    );
    database
      .prepare(
        `UPDATE agent_task_history
         SET completed_at = ?, success = 1, result = ?
         WHERE id = ?`,
      )
      .run(
        Date.now(),
        JSON.stringify({ outputDigest: OUTPUT_DIGEST }),
        AGENT_TASK_ID,
      );
  }
  return {
    database,
    registry,
    sessionManager,
    rolloutStore,
    runtime,
    projection: projections[PRIMARY_ENTRY.entryId],
    projections,
    recoveredPrompt: recoveredPrompts[PRIMARY_ENTRY.entryId] || null,
    recoveredPrompts,
    previous,
    restoredCutpointStores,
  };
}

async function main() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(path.join(STATE_DIR, "user-data", "logs"), {
    recursive: true,
  });
  const journey = await openJourney();
  const token = crypto.randomUUID();
  let startReceipt = null;

  ipcMain.handle("p1-3:packaged-graph:start", async (event) => {
    if (startReceipt) return startReceipt;
    startReceipt = {
      token,
      mode: MODE,
      graphRunId: GRAPH_RUN_ID,
      status: journey.projection.status,
      eventHead: journey.projection.eventHead,
      rendererProcessId:
        event.processId || event.senderFrame?.processId || null,
      webContentsId: event.sender.id,
      rendererUrl: event.senderFrame?.url || null,
    };
    return startReceipt;
  });

  ipcMain.handle("p1-3:packaged-graph:acknowledge", async (_event, receipt) => {
    if (!startReceipt || receipt?.token !== token) {
      throw new Error(
        "renderer acknowledgement is not bound to the main receipt",
      );
    }
    const binding = journey.registry.get(
      "desktop_workflow_manager",
      WORKFLOW_ID,
    );
    const result = {
      schema: JOURNEY_SCHEMA,
      mode: MODE,
      status: MODE === "writer" ? "cutpoint_ready" : "passed",
      workflowId: WORKFLOW_ID,
      graphRunId: GRAPH_RUN_ID,
      graphStatus: journey.projection.status,
      authorityGeneration: journey.projection.authorityGeneration,
      eventHead: journey.projection.eventHead,
      recoveredPrompt: journey.recoveredPrompt,
      entries: Object.fromEntries(
        ENTRIES.map((entry) => {
          const projection = journey.projections[entry.entryId];
          const entryBinding = journey.registry.get(
            entry.bindingSurface,
            entry.entityId,
          );
          return [
            entry.entryId,
            {
              graphRunId: entry.runId,
              graphStatus: projection.status,
              eventHead: projection.eventHead,
              authorityGeneration: projection.authorityGeneration,
              recoveredPrompt: journey.recoveredPrompts[entry.entryId] || null,
              bindingStatus: entryBinding?.lifecycleStatus || null,
              bindingEventHead: entryBinding?.lastProjection?.eventHead || null,
            },
          ];
        }),
      ),
      binding: {
        lifecycleStatus: binding?.lifecycleStatus || null,
        graphRunId: binding?.graphRunId || null,
        eventHead: binding?.lastProjection?.eventHead || null,
        authorityGeneration:
          binding?.lastProjection?.authorityGeneration || null,
      },
      runtime: {
        electron: process.versions.electron || null,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        asar: app.getAppPath().endsWith("app.asar"),
      },
      window: {
        rendererProcessId: startReceipt.rendererProcessId,
        webContentsId: startReceipt.webContentsId,
        rendererUrl: startReceipt.rendererUrl,
        renderedStatus: String(receipt.renderedStatus || ""),
        rendererObservedAt: Number(receipt.rendererObservedAt) || null,
      },
      stores: collectStoreEvidence(journey),
      restoredCutpointStores: journey.restoredCutpointStores || null,
    };
    result.evidenceDigest = digest(result);
    writeExclusive(OUTPUT_PATH, result);
    if (MODE !== "writer") {
      journey.database.close();
      setTimeout(() => app.quit(), 25);
    }
    return { acknowledged: true, evidenceDigest: result.evidenceDigest };
  });

  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await window.loadFile(path.join(__dirname, "renderer.html"));
  globalThis.__p13PackagedGraphJourney = { journey, window };
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
