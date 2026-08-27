"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const {
  DesktopGraphRunRegistry,
} = require("../../desktop-graph-run-registry.js");
const {
  buildWorkflowGraph,
} = require("../../desktop-graph-execution-adapter.js");
const { DEFAULT_STAGES } = require("../../../../workflow/workflow-stage.js");

async function main() {
  const [databasePath, rolloutDirectory, readyPath] = process.argv.slice(2);
  if (!databasePath || !rolloutDirectory || !readyPath) {
    throw new Error(
      "databasePath, rolloutDirectory, and readyPath are required",
    );
  }
  const repositoryRoot = path.resolve(__dirname, "../../../../../../../");
  const rolloutModule = await import(
    pathToFileURL(
      path.join(
        repositoryRoot,
        "packages/cli/src/lib/app-server/rollout-store.js",
      ),
    ).href
  );
  const runtimeModule = await import(
    pathToFileURL(
      path.join(
        repositoryRoot,
        "packages/cli/src/lib/app-server/graph-runtime.js",
      ),
    ).href
  );
  const database = new DatabaseSync(databasePath);
  const registry = new DesktopGraphRunRegistry({ database });
  const rolloutStore = new rolloutModule.JsonlRolloutStore({
    directory: rolloutDirectory,
  });
  const runtime = new runtimeModule.AppServerGraphRuntime({
    rolloutStore,
    executeNode: async () => new Promise(() => {}),
  });
  const workflowId = "disk-restart-workflow";
  const graphRunId = `desktop-workflow:${workflowId}`;
  const graph = buildWorkflowGraph(
    {
      id: workflowId,
      title: "Disk restart workflow",
      description: "Recover after the writer process is terminated",
      stages: DEFAULT_STAGES,
    },
    { request: "resume the exact durable input" },
  );
  const projection = runtime.start({
    definition: graph.definition,
    inputs: graph.inputs,
    runId: graphRunId,
    originSurface: "desktop",
    authorityMode: "canonical",
  });
  registry.record({
    surface: "desktop_workflow_manager",
    entityId: workflowId,
    graphRunId,
    authorityMode: "canonical",
    lifecycleStatus: projection.status,
    metadata: {
      title: "Disk restart workflow",
      description: "Recover after the writer process is terminated",
      startedAt: Date.now(),
    },
    lastProjection: projection,
  });
  fs.writeFileSync(
    readyPath,
    JSON.stringify({ workflowId, graphRunId, eventHead: projection.eventHead }),
    { encoding: "utf8", flag: "wx" },
  );

  // Keep the SQLite connection and runtime live until the parent terminates
  // this process. No graceful close hook is registered intentionally.
  globalThis.__desktopGraphKillFixture = { database, registry, runtime };
  setInterval(() => {}, 1_000);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
