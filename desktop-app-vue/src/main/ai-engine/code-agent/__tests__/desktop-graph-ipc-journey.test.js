import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { MemoryRolloutStore } from "../../../../../../packages/cli/src/lib/app-server/rollout-store.js";
import { AppServerGraphRuntime } from "../../../../../../packages/cli/src/lib/app-server/graph-runtime.js";

vi.mock("../../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const require = createRequire(import.meta.url);
const { AgentCoordinator } = require("../../agents/agent-coordinator.js");
const { registerAgentsIPC } = require("../../agents/agents-ipc.js");
const { WorkflowManager } = require("../../../workflow/workflow-pipeline.js");
const { registerWorkflowIPC } = require("../../../workflow/workflow-ipc.js");

const OUTPUT = `sha256:${"d".repeat(64)}`;

function ipcHarness() {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel),
  };
  return {
    ipcMain,
    invoke(channel, payload = {}) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`IPC handler is unavailable: ${channel}`);
      return handler({}, payload);
    },
  };
}

function pilot(runtime) {
  return {
    graphRun: (request) => runtime.run(request),
    graphStatus: ({ runId }) => runtime.status(runId),
    graphCancel: ({ runId, reason }) => runtime.cancel(runId, reason),
  };
}

function progressEmitter() {
  return {
    createTracker: () => ({
      setPercent: vi.fn(),
      complete: vi.fn(),
      error: vi.fn(),
      cancel: vi.fn(),
    }),
    setMainWindow: vi.fn(),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitForWorkflow(ipc, workflowId, expectedStatus) {
  for (let index = 0; index < 100; index += 1) {
    const response = await ipc.invoke("workflow:get-status", { workflowId });
    if (response.data?.overall?.status === expectedStatus) return response.data;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`workflow ${workflowId} did not reach ${expectedStatus}`);
}

describe("Desktop Graph production IPC journey", () => {
  it("fails closed before bootstrap, then executes Agents and Workflow through one real Graph runtime", async () => {
    const executeNode = vi.fn(async () => ({
      status: "succeeded",
      terminalEvidence: { outputDigest: OUTPUT },
    }));
    const runtime = new AppServerGraphRuntime({
      rolloutStore: new MemoryRolloutStore(),
      executeNode,
    });
    let activePilot = null;
    const legacyExecute = vi.fn();
    const agentsIpc = ipcHarness();
    registerAgentsIPC({
      ipcMain: agentsIpc.ipcMain,
      database: null,
      graphClientProvider: () => activePilot,
      graphAuthorityMode: () => "canonical",
      createTemplateManager: () => ({}),
      createAgentRegistry: () => ({
        getInstance: () => ({ execute: legacyExecute }),
      }),
      createAgentCoordinator: (options) => new AgentCoordinator(options),
    });

    const unavailable = await agentsIpc.invoke("agents:assign-task", {
      agentId: "agent-1",
      taskDescription: "prove fail closed",
    });
    expect(unavailable).toMatchObject({
      success: false,
      code: "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
    });
    expect(legacyExecute).not.toHaveBeenCalled();

    activePilot = pilot(runtime);
    const assigned = await agentsIpc.invoke("agents:assign-task", {
      agentId: "agent-1",
      taskDescription: "execute through the canonical kernel",
    });
    expect(assigned).toMatchObject({
      success: true,
      data: {
        status: "completed",
        graphAuthority: {
          status: "succeeded",
          authorityMode: "canonical",
          authoritySource: "graph_kernel",
          authorityGeneration: 1,
          projectionVersion: 1,
        },
      },
    });
    const taskStatus = await agentsIpc.invoke("agents:get-task-status", {
      taskId: assigned.data.taskId,
    });
    expect(taskStatus.data).toMatchObject({
      authoritySource: "graph_kernel",
      graphRunId: assigned.data.result.graphRunId,
      graphAuthority: {
        writerId: expect.stringContaining("app-server:"),
        eventHead: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(legacyExecute).not.toHaveBeenCalled();

    const workflowIpc = ipcHarness();
    const workflowManager = new WorkflowManager({
      progressEmitter: progressEmitter(),
      graphClientProvider: () => activePilot,
      graphAuthorityMode: () => "canonical",
    });
    registerWorkflowIPC({
      workflowManager,
      ipcMain: workflowIpc.ipcMain,
    });
    const created = await workflowIpc.invoke("workflow:create", {
      id: "ipc-canonical-workflow",
      title: "Canonical IPC workflow",
    });
    expect(created.success).toBe(true);
    await workflowIpc.invoke("workflow:start", {
      workflowId: created.data.workflowId,
      input: { request: "ship through Graph" },
      context: {},
    });
    const workflowStatus = await waitForWorkflow(
      workflowIpc,
      created.data.workflowId,
      "completed",
    );
    expect(workflowStatus).toMatchObject({
      authorityMode: "canonical",
      authoritySource: "graph_kernel",
      graphRunId: `desktop-workflow:${created.data.workflowId}`,
      graphAuthority: {
        status: "succeeded",
        authorityGeneration: 1,
        writerId: expect.stringContaining("app-server:"),
        eventHead: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        projectionVersion: 1,
      },
      reconciliationRequired: false,
    });
    expect(executeNode).toHaveBeenCalledTimes(7);
  });

  it("projects an unknown specialized-agent effect as reconciliation_required without legacy fallback", async () => {
    const executeNode = vi.fn(async () => {
      throw new Error("executor disappeared after dispatch");
    });
    const runtime = new AppServerGraphRuntime({
      rolloutStore: new MemoryRolloutStore(),
      executeNode,
    });
    const legacyExecute = vi.fn();
    const ipc = ipcHarness();
    registerAgentsIPC({
      ipcMain: ipc.ipcMain,
      database: null,
      graphClientProvider: () => pilot(runtime),
      graphAuthorityMode: () => "canonical",
      createTemplateManager: () => ({}),
      createAgentRegistry: () => ({
        getInstance: () => ({ execute: legacyExecute }),
      }),
      createAgentCoordinator: (options) => new AgentCoordinator(options),
    });

    const assigned = await ipc.invoke("agents:assign-task", {
      agentId: "agent-unknown-effect",
      taskDescription: "do not guess whether this write committed",
    });

    expect(assigned).toMatchObject({
      success: false,
      code: "CC_GRAPH_RECONCILIATION_REQUIRED",
      reconciliationRequired: true,
      data: {
        status: "reconciliation_required",
        graphAuthority: {
          status: "reconciliation_required",
          authorityMode: "canonical",
          authoritySource: "graph_kernel",
          reconciliationEffectIds: [expect.any(String)],
        },
      },
    });
    const status = await ipc.invoke("agents:get-task-status", {
      taskId: assigned.data.taskId,
    });
    expect(status.data).toMatchObject({
      status: "reconciliation_required",
      authoritySource: "graph_kernel",
      graphAuthority: {
        status: "reconciliation_required",
      },
    });
    expect(executeNode).toHaveBeenCalledOnce();
    expect(legacyExecute).not.toHaveBeenCalled();
  });

  it("does not misreport an in-flight workflow write as cancelled", async () => {
    const started = deferred();
    const executeNode = vi.fn(
      ({ signal }) =>
        new Promise((resolve, reject) => {
          started.resolve();
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const runtime = new AppServerGraphRuntime({
      rolloutStore: new MemoryRolloutStore(),
      executeNode,
    });
    const ipc = ipcHarness();
    const workflowManager = new WorkflowManager({
      progressEmitter: progressEmitter(),
      graphClientProvider: () => pilot(runtime),
      graphAuthorityMode: () => "canonical",
    });
    registerWorkflowIPC({
      workflowManager,
      ipcMain: ipc.ipcMain,
    });
    const created = await ipc.invoke("workflow:create", {
      id: "ipc-cancel-race-workflow",
      title: "Canonical cancellation race",
    });
    await ipc.invoke("workflow:start", {
      workflowId: created.data.workflowId,
      input: { request: "cancel this in-flight write" },
      context: {},
    });
    await started.promise;

    const cancelled = await ipc.invoke("workflow:cancel", {
      workflowId: created.data.workflowId,
      reason: "operator cancelled",
    });
    expect(cancelled).toMatchObject({
      success: false,
      code: "CC_GRAPH_RECONCILIATION_REQUIRED",
      reconciliationRequired: true,
      data: {
        overall: { status: "reconciliation_required" },
        graphAuthority: { status: "reconciliation_required" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const status = await ipc.invoke("workflow:get-status", {
      workflowId: created.data.workflowId,
    });
    expect(status.data).toMatchObject({
      overall: { status: "reconciliation_required" },
      authorityMode: "canonical",
      authoritySource: "graph_kernel",
      graphAuthority: {
        status: "reconciliation_required",
        authorityGeneration: 1,
        writerId: expect.stringContaining("app-server:"),
      },
      reconciliationRequired: true,
    });
    expect(executeNode).toHaveBeenCalledOnce();
  });
});
