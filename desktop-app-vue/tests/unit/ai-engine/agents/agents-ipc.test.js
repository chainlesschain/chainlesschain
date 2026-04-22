import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  AGENTS_IPC_CHANNELS,
  registerAgentsIPC,
  unregisterAgentsIPC,
} = require("../../../../src/main/ai-engine/agents/agents-ipc.js");

function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    removeHandler: vi.fn((channel) => {
      delete handlers[channel];
    }),
  };
}

describe("agents-ipc", () => {
  let ipcMainMock;
  let createTemplateManager;
  let createAgentRegistry;
  let createAgentCoordinator;
  let templateManager;
  let agentRegistry;
  let agentCoordinator;

  beforeEach(() => {
    ipcMainMock = createMockIpcMain();

    templateManager = {
      listTemplates: vi.fn().mockReturnValue([{ id: "tpl-1", name: "Planner" }]),
      getTemplate: vi.fn().mockReturnValue({ id: "tpl-1", name: "Planner" }),
      createTemplate: vi
        .fn()
        .mockImplementation((template) => ({ id: "tpl-2", ...template })),
      updateTemplate: vi
        .fn()
        .mockImplementation((templateId, updates) => ({ id: templateId, ...updates })),
      deleteTemplate: vi.fn().mockReturnValue(true),
    };

    agentRegistry = {
      deploy: vi
        .fn()
        .mockResolvedValue({ id: "agent-1", templateId: "tpl-1", status: "running" }),
      terminate: vi.fn().mockResolvedValue({ agentId: "agent-1", terminated: true }),
      listInstances: vi.fn().mockReturnValue([{ id: "agent-1" }]),
      getStatus: vi.fn().mockReturnValue({ id: "agent-1", status: "running" }),
    };

    agentCoordinator = {
      assignTask: vi.fn().mockResolvedValue({ success: true, taskId: "task-1" }),
      getTaskStatus: vi.fn().mockReturnValue({ success: true, status: "running" }),
      cancelTask: vi.fn().mockReturnValue({ success: true, cancelled: true }),
      orchestrate: vi.fn().mockResolvedValue({ success: true, result: "done" }),
      getPlan: vi.fn().mockReturnValue({ stages: 2 }),
      getPerformance: vi.fn().mockReturnValue({ success: true, data: { p95: 10 } }),
      getSystemStatistics: vi.fn().mockReturnValue({ agents: 1, tasks: 2 }),
    };

    createTemplateManager = vi.fn(() => templateManager);
    createAgentRegistry = vi.fn(() => agentRegistry);
    createAgentCoordinator = vi.fn(() => agentCoordinator);

    registerAgentsIPC({
      database: { name: "db" },
      ipcMain: ipcMainMock,
      createTemplateManager,
      createAgentRegistry,
      createAgentCoordinator,
    });
  });

  it("registers all channels and clears stale handlers first", () => {
    expect(Object.keys(ipcMainMock.handlers)).toHaveLength(AGENTS_IPC_CHANNELS.length);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledTimes(AGENTS_IPC_CHANNELS.length);
    expect(ipcMainMock.handlers["agents:list-templates"]).toBeTypeOf("function");
  });

  it("lazy-initializes managers once and reuses them across handlers", async () => {
    await ipcMainMock.handlers["agents:list-templates"]({}, {});
    await ipcMainMock.handlers["agents:deploy-agent"]({}, { templateId: "tpl-1" });
    await ipcMainMock.handlers["agents:assign-task"]({}, {
      agentId: "agent-1",
      taskDescription: "Implement feature",
    });
    await ipcMainMock.handlers["agents:get-statistics"]({});

    expect(createTemplateManager).toHaveBeenCalledTimes(1);
    expect(createAgentRegistry).toHaveBeenCalledTimes(1);
    expect(createAgentCoordinator).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["agents:get-template", {}, "Template ID is required"],
    ["agents:create-template", {}, "Template name and type are required"],
    ["agents:update-template", {}, "Template ID is required"],
    ["agents:update-template", { templateId: "tpl-1" }, "No updates provided"],
    ["agents:delete-template", {}, "Template ID is required"],
    ["agents:deploy-agent", {}, "Template ID is required"],
    ["agents:terminate-agent", {}, "Agent ID is required"],
    ["agents:get-status", {}, "Agent ID is required"],
    ["agents:assign-task", {}, "Agent ID is required"],
    ["agents:assign-task", { agentId: "agent-1" }, "Task description is required"],
    ["agents:get-task-status", {}, "Task ID is required"],
    ["agents:cancel-task", {}, "Task ID is required"],
    ["agents:orchestrate", {}, "Task description is required"],
    ["agents:get-plan", {}, "Task description is required"],
  ])("validates %s payloads", async (channel, payload, error) => {
    const result = await ipcMainMock.handlers[channel]({}, payload);
    expect(result).toEqual({ success: false, error });
  });

  it("handles template CRUD success and not-found branches", async () => {
    const listResult = await ipcMainMock.handlers["agents:list-templates"]({}, {
      filters: { type: "planner" },
    });
    expect(templateManager.listTemplates).toHaveBeenCalledWith({ type: "planner" });
    expect(listResult.total).toBe(1);

    const getResult = await ipcMainMock.handlers["agents:get-template"]({}, {
      templateId: "tpl-1",
    });
    expect(templateManager.getTemplate).toHaveBeenCalledWith("tpl-1");
    expect(getResult).toEqual({
      success: true,
      data: { id: "tpl-1", name: "Planner" },
    });

    const createResult = await ipcMainMock.handlers["agents:create-template"]({}, {
      template: { name: "Builder", type: "executor" },
    });
    expect(templateManager.createTemplate).toHaveBeenCalledWith({
      name: "Builder",
      type: "executor",
    });
    expect(createResult.data.id).toBe("tpl-2");

    const updateResult = await ipcMainMock.handlers["agents:update-template"]({}, {
      templateId: "tpl-1",
      updates: { name: "Builder v2" },
    });
    expect(templateManager.updateTemplate).toHaveBeenCalledWith("tpl-1", {
      name: "Builder v2",
    });
    expect(updateResult.data.name).toBe("Builder v2");

    const deleteResult = await ipcMainMock.handlers["agents:delete-template"]({}, {
      templateId: "tpl-1",
    });
    expect(templateManager.deleteTemplate).toHaveBeenCalledWith("tpl-1");
    expect(deleteResult).toEqual({
      success: true,
      data: { templateId: "tpl-1", deleted: true },
    });

    templateManager.getTemplate.mockReturnValueOnce(null);
    templateManager.updateTemplate.mockReturnValueOnce(null);
    templateManager.deleteTemplate.mockReturnValueOnce(false);

    await expect(
      ipcMainMock.handlers["agents:get-template"]({}, { templateId: "missing" }),
    ).resolves.toEqual({
      success: false,
      error: "Template not found: missing",
    });
    await expect(
      ipcMainMock.handlers["agents:update-template"]({}, {
        templateId: "missing",
        updates: { name: "x" },
      }),
    ).resolves.toEqual({
      success: false,
      error: "Template not found: missing",
    });
    await expect(
      ipcMainMock.handlers["agents:delete-template"]({}, { templateId: "missing" }),
    ).resolves.toEqual({
      success: false,
      error: "Template not found: missing",
    });
  });

  it("handles registry handlers and agent status lookups", async () => {
    const deployResult = await ipcMainMock.handlers["agents:deploy-agent"]({}, {
      templateId: "tpl-1",
      config: { env: "prod" },
    });
    expect(agentRegistry.deploy).toHaveBeenCalledWith("tpl-1", { env: "prod" });
    expect(deployResult.data.id).toBe("agent-1");

    const terminateResult = await ipcMainMock.handlers["agents:terminate-agent"]({}, {
      agentId: "agent-1",
      reason: "done",
    });
    expect(agentRegistry.terminate).toHaveBeenCalledWith("agent-1", "done");
    expect(terminateResult.data.terminated).toBe(true);

    const instancesResult = await ipcMainMock.handlers["agents:list-instances"]({}, {
      filters: { status: "running" },
    });
    expect(agentRegistry.listInstances).toHaveBeenCalledWith({ status: "running" });
    expect(instancesResult.total).toBe(1);

    const statusResult = await ipcMainMock.handlers["agents:get-status"]({}, {
      agentId: "agent-1",
    });
    expect(agentRegistry.getStatus).toHaveBeenCalledWith("agent-1");
    expect(statusResult.data.status).toBe("running");

    agentRegistry.getStatus.mockReturnValueOnce(null);
    await expect(
      ipcMainMock.handlers["agents:get-status"]({}, { agentId: "missing" }),
    ).resolves.toEqual({
      success: false,
      error: "Agent not found: missing",
    });
  });

  it("handles coordinator task, planning, and analytics flows", async () => {
    const assignResult = await ipcMainMock.handlers["agents:assign-task"]({}, {
      agentId: "agent-1",
      taskDescription: "Ship feature",
      options: { priority: "high" },
    });
    expect(agentCoordinator.assignTask).toHaveBeenCalledWith(
      "agent-1",
      "Ship feature",
      { priority: "high" },
    );
    expect(assignResult).toEqual({ success: true, taskId: "task-1" });

    const taskStatusResult = await ipcMainMock.handlers["agents:get-task-status"]({}, {
      taskId: "task-1",
    });
    expect(agentCoordinator.getTaskStatus).toHaveBeenCalledWith("task-1");
    expect(taskStatusResult.status).toBe("running");

    const cancelResult = await ipcMainMock.handlers["agents:cancel-task"]({}, {
      taskId: "task-1",
      reason: "changed scope",
    });
    expect(agentCoordinator.cancelTask).toHaveBeenCalledWith("task-1", "changed scope");
    expect(cancelResult.cancelled).toBe(true);

    const orchestrateResult = await ipcMainMock.handlers["agents:orchestrate"]({}, {
      taskDescription: "Coordinate a release",
      options: { dryRun: true },
    });
    expect(agentCoordinator.orchestrate).toHaveBeenCalledWith("Coordinate a release", {
      dryRun: true,
    });
    expect(orchestrateResult.result).toBe("done");

    const planResult = await ipcMainMock.handlers["agents:get-plan"]({}, {
      taskDescription: "Coordinate a release",
      options: { depth: 2 },
    });
    expect(agentCoordinator.getPlan).toHaveBeenCalledWith("Coordinate a release", {
      depth: 2,
    });
    expect(planResult).toEqual({ success: true, data: { stages: 2 } });

    const performanceResult = await ipcMainMock.handlers["agents:get-performance"]({}, {
      options: { period: "7d" },
    });
    expect(agentCoordinator.getPerformance).toHaveBeenCalledWith({ period: "7d" });
    expect(performanceResult.success).toBe(true);

    const statisticsResult = await ipcMainMock.handlers["agents:get-statistics"]({});
    expect(agentCoordinator.getSystemStatistics).toHaveBeenCalled();
    expect(statisticsResult).toEqual({
      success: true,
      data: { agents: 1, tasks: 2 },
    });
  });

  it("normalizes thrown handler errors", async () => {
    templateManager.listTemplates.mockImplementationOnce(() => {
      throw new Error("database unavailable");
    });

    const result = await ipcMainMock.handlers["agents:list-templates"]({}, {});
    expect(result).toEqual({
      success: false,
      error: "database unavailable",
    });
  });

  it("tolerates IPC cleanup edge cases", () => {
    const handlersWithoutRemove = {};
    expect(() =>
      registerAgentsIPC({
        database: { name: "default-db" },
        ipcMain: {
          handle: vi.fn((channel, handler) => {
            handlersWithoutRemove[channel] = handler;
          }),
        },
        createTemplateManager,
        createAgentRegistry,
        createAgentCoordinator,
      }),
    ).not.toThrow();
    expect(Object.keys(handlersWithoutRemove)).toHaveLength(AGENTS_IPC_CHANNELS.length);

    const throwingIpc = {
      handlers: {},
      handle: vi.fn((channel, handler) => {
        throwingIpc.handlers[channel] = handler;
      }),
      removeHandler: vi.fn(() => {
        throw new Error("already removed");
      }),
    };
    expect(() =>
      registerAgentsIPC({
        database: { name: "db" },
        ipcMain: throwingIpc,
        createTemplateManager,
        createAgentRegistry,
        createAgentCoordinator,
      }),
    ).not.toThrow();
  });

  it("unregisters all handlers", () => {
    const testIpc = createMockIpcMain();
    unregisterAgentsIPC({ ipcMain: testIpc });
    expect(testIpc.removeHandler).toHaveBeenCalledTimes(AGENTS_IPC_CHANNELS.length);
  });
});
