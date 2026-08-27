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
const {
  buildSpecializedAgentsGraph,
  buildWorkflowGraph,
} = require("../desktop-graph-execution-adapter.js");
const {
  DesktopGraphRunRegistry,
  MemoryDesktopGraphRunStore,
} = require("../desktop-graph-run-registry.js");

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
    graphRun: (request) =>
      request.resume === true
        ? runtime.resume(request.runId, {
            waitForCompletion: request.waitForCompletion === true,
          })
        : runtime.run(request),
    graphStatus: ({ runId }) => runtime.status(runId),
    graphCancel: ({ runId, reason }) => runtime.cancel(runId, reason),
    graphReconcile: ({ runId, reconciliation }) =>
      runtime.reconcile(runId, reconciliation),
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

async function waitForTask(ipc, taskId, expectedStatus) {
  for (let index = 0; index < 100; index += 1) {
    const response = await ipc.invoke("agents:get-task-status", { taskId });
    if (response.data?.status === expectedStatus) return response.data;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`task ${taskId} did not reach ${expectedStatus}`);
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
    const effectId = assigned.data.graphAuthority.reconciliationEffectIds[0];
    const forged = await ipc.invoke("agents:reconcile-task", {
      taskId: assigned.data.taskId,
      reconciliation: {
        effectId,
        decision: "committed",
        receipt: { receiptDigest: "not-a-digest" },
        terminalEvidence: { outputDigest: OUTPUT },
        auditDecisionId: "desktop-agent-forged-receipt",
      },
    });
    expect(forged).toMatchObject({
      success: false,
      code: "CC_GRAPH_EFFECT_RECEIPT_REQUIRED",
      reconciliationRequired: true,
    });
    const reconciled = await ipc.invoke("agents:reconcile-task", {
      taskId: assigned.data.taskId,
      reconciliation: {
        effectId,
        decision: "committed",
        receipt: { receiptDigest: `sha256:${"c".repeat(64)}` },
        terminalEvidence: { outputDigest: OUTPUT },
        auditDecisionId: "desktop-agent-audit-1",
      },
    });
    expect(reconciled).toMatchObject({
      success: true,
      reconciliationRequired: false,
      data: {
        status: "completed",
        graphAuthority: { status: "succeeded" },
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
    const reconciled = await ipc.invoke("workflow:reconcile", {
      workflowId: created.data.workflowId,
      reconciliation: {
        effectId: status.data.graphAuthority.reconciliationEffectIds[0],
        decision: "committed",
        receipt: { receiptDigest: `sha256:${"c".repeat(64)}` },
        terminalEvidence: { outputDigest: OUTPUT },
        auditDecisionId: "desktop-workflow-audit-1",
      },
    });
    expect(reconciled).toMatchObject({
      success: true,
      reconciliationRequired: false,
      data: {
        overall: { status: "failed" },
        graphAuthority: {
          status: "partial",
          authoritySource: "graph_kernel",
          reconciliationEffectIds: [],
        },
      },
    });
    expect(executeNode).toHaveBeenCalledOnce();
  });

  it("hydrates pre-dispatch Agent and Workflow bindings after an app/runtime restart", async () => {
    const rolloutStore = new MemoryRolloutStore();
    const crashedRuntime = new AppServerGraphRuntime({
      rolloutStore,
      executeNode: async () => {
        throw new Error("the pre-dispatch runtime must not execute");
      },
    });
    const store = new MemoryDesktopGraphRunStore();
    const registry = new DesktopGraphRunRegistry({ store });

    const taskId = "restart-task-1";
    const taskRunId = `desktop-specialized-task:${taskId}`;
    const taskGraph = buildSpecializedAgentsGraph(
      {
        subtasks: [
          {
            subtaskId: taskId,
            subtask: "resume the exact specialized task",
            agentType: "code-generation",
            dependencies: [],
          },
        ],
      },
      taskId,
      {},
    );
    crashedRuntime.start({
      definition: taskGraph.definition,
      inputs: taskGraph.inputs,
      runId: taskRunId,
    });
    registry.record({
      surface: "desktop_specialized_agents",
      entityId: taskId,
      graphRunId: taskRunId,
      authorityMode: "canonical",
      lifecycleStatus: "running",
      metadata: {
        agentId: "restart-agent",
        templateType: "code-generation",
        description: "resume the exact specialized task",
        assignedAt: 1,
      },
    });

    const workflowId = "restart-workflow-1";
    const workflowRunId = `desktop-workflow:${workflowId}`;
    const workflowShape = new WorkflowManager({
      graphRunRegistry: new DesktopGraphRunRegistry(),
      progressEmitter: progressEmitter(),
      graphAuthorityMode: () => "canonical",
    }).createWorkflow({
      id: workflowId,
      title: "Restart durable workflow",
    });
    const workflowGraph = buildWorkflowGraph(workflowShape, {
      request: "resume the exact workflow",
    });
    crashedRuntime.start({
      definition: workflowGraph.definition,
      inputs: workflowGraph.inputs,
      runId: workflowRunId,
    });
    registry.record({
      surface: "desktop_workflow_manager",
      entityId: workflowId,
      graphRunId: workflowRunId,
      authorityMode: "canonical",
      lifecycleStatus: "running",
      metadata: {
        title: "Restart durable workflow",
        description: "",
        startedAt: 1,
      },
    });

    const executeNode = vi.fn(async () => ({
      status: "succeeded",
      terminalEvidence: { outputDigest: OUTPUT },
    }));
    const recoveredRuntime = new AppServerGraphRuntime({
      rolloutStore,
      executeNode,
    });
    const agentsIpc = ipcHarness();
    registerAgentsIPC({
      ipcMain: agentsIpc.ipcMain,
      database: null,
      graphRunRegistry: registry,
      graphClientProvider: () => pilot(recoveredRuntime),
      graphAuthorityMode: () => "canonical",
      createTemplateManager: () => ({}),
      createAgentRegistry: () => ({}),
      createAgentCoordinator: (options) => new AgentCoordinator(options),
    });
    const workflowIpc = ipcHarness();
    const recoveredManager = new WorkflowManager({
      graphRunRegistry: registry,
      progressEmitter: progressEmitter(),
      graphClientProvider: () => pilot(recoveredRuntime),
      graphAuthorityMode: () => "canonical",
    });
    registerWorkflowIPC({
      workflowManager: recoveredManager,
      ipcMain: workflowIpc.ipcMain,
    });

    const task = await waitForTask(agentsIpc, taskId, "completed");
    const workflow = await waitForWorkflow(
      workflowIpc,
      workflowId,
      "completed",
    );

    expect(task).toMatchObject({
      graphRunId: taskRunId,
      authoritySource: "graph_kernel",
      graphAuthority: {
        status: "succeeded",
        authorityGeneration: 2,
      },
    });
    expect(workflow).toMatchObject({
      graphRunId: workflowRunId,
      authoritySource: "graph_kernel",
      graphAuthority: {
        status: "succeeded",
        authorityGeneration: 2,
      },
    });
    const stages = await workflowIpc.invoke("workflow:get-stages", {
      workflowId,
    });
    expect(stages.data).toHaveLength(6);
    expect(stages.data.every((stage) => stage.status === "completed")).toBe(
      true,
    );
    expect(executeNode).toHaveBeenCalledTimes(7);
  });
});
