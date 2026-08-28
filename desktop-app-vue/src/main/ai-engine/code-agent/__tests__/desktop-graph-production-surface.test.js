import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

describe("Desktop Graph production surface guard", () => {
  it("binds WorkflowManager and Specialized Agents to the late App Server pilot", () => {
    const workflowPhase = source("../../../ipc/phases/phase-8-9-extras.js");
    const agentsPhase = source("../../../ipc/phases/phase-9-15-core.js");

    expect(workflowPhase).toContain(
      "app?.codingAgentBootstrap?.appServerPilot || null",
    );
    expect(agentsPhase).toContain(
      "app?.codingAgentBootstrap?.appServerPilot || null",
    );
    expect(workflowPhase).toContain("graphClientProvider:");
    expect(agentsPhase).toContain("graphClientProvider:");
  });

  it("forwards the Graph provider through the lazy Agents IPC factory", () => {
    const agentsIpc = source("../../agents/agents-ipc.js");

    expect(agentsIpc).toContain(
      "graphClientProvider: dependencies.graphClientProvider",
    );
    expect(agentsIpc).toContain(
      "graphAuthorityMode: dependencies.graphAuthorityMode",
    );
    expect(agentsIpc).toContain(
      "await getAgentCoordinator().cancelTask(taskId, reason)",
    );
  });

  it("awaits canonical Workflow cancellation before replying or deleting", () => {
    const workflowIpc = source("../../../workflow/workflow-ipc.js");
    const workflowPipeline = source("../../../workflow/workflow-pipeline.js");

    expect(workflowIpc).toContain("await workflow.cancel(reason)");
    expect(workflowIpc).toContain(
      "await this.workflowManager.deleteWorkflow(workflowId)",
    );
    expect(workflowPipeline).toContain('surface: "desktop_workflow_manager"');
    expect(workflowPipeline).toContain(
      'throw graphControlError("quality-gate override")',
    );
  });

  it("exposes fixed renderer capabilities with exact production channels", () => {
    const preload = source("../../../../preload/index.js");
    const agentsStore = source("../../../../renderer/stores/agents.ts");
    const workflowStore = source("../../../../renderer/stores/workflow.ts");
    const workflowProgress = source(
      "../../../../renderer/components/workflow/WorkflowProgress.vue",
    );
    const workflowMonitor = source(
      "../../../../renderer/pages/WorkflowMonitorPage.vue",
    );

    for (const channel of [
      "agents:assign-task",
      "agents:get-task-status",
      "agents:cancel-task",
      "agents:reconcile-task",
      "workflow:start",
      "workflow:get-status",
      "workflow:cancel",
      "workflow:reconcile",
    ]) {
      expect(preload).toContain(`ipcRenderer.invoke("${channel}"`);
    }
    expect(preload).toContain("specializedAgents: {");
    expect(preload).toContain("workflowManager: {");
    expect(agentsStore).toContain("electronAPI.specializedAgents");
    expect(agentsStore).not.toMatch(/electronAPI\.invoke\(["']agents:/u);
    for (const renderer of [workflowStore, workflowProgress, workflowMonitor]) {
      expect(renderer).toContain("electronAPI.workflowManager");
      expect(renderer).not.toContain("window.ipc");
    }
  });
});
