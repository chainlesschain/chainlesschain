/**
 * agents-ipc → AgentRegistry method contract
 *
 * Regression: agents-ipc.js handlers called methods that do not exist on
 * AgentRegistry — deploy() (real: createAgentInstance), listInstances() (real:
 * getActiveInstances), getStatus() (real: getInstance), terminate() (added as a
 * wrapper). Each threw "X is not a function", caught by safeHandle and returned
 * as {success:false}, so the channels were silently non-functional.
 *
 * These tests inject a stub registry exposing ONLY the real method names, so if
 * a handler is reverted to a non-existent name the stub throws → {success:false}
 * → the test fails.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));
vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerAgentsIPC } = require("../agents-ipc.js");

function harness(registry) {
  const handlers = new Map();
  const ipcMain = {
    handle: (ch, fn) => handlers.set(ch, fn),
    removeHandler: () => {},
  };
  registerAgentsIPC({
    ipcMain,
    database: null,
    createAgentRegistry: () => registry,
    createTemplateManager: () => ({
      listTemplates: async () => ({ templates: [], total: 0 }),
    }),
    createAgentCoordinator: () => ({}),
  });
  return handlers;
}

describe("agents-ipc → AgentRegistry method contract", () => {
  it("deploy-agent calls createAgentInstance (not the missing deploy())", async () => {
    const registry = {
      createAgentInstance: vi.fn(async () => ({ id: "i1" })),
    };
    const res = await harness(registry).get("agents:deploy-agent")(
      {},
      { templateId: "t1", config: {} },
    );
    expect(res.success).toBe(true);
    expect(registry.createAgentInstance).toHaveBeenCalledWith("t1", {});
  });

  it("list-instances calls getActiveInstances (not the missing listInstances())", async () => {
    const registry = {
      getActiveInstances: vi.fn(() => [{ id: "a" }, { id: "b" }]),
    };
    const res = await harness(registry).get("agents:list-instances")({}, {});
    expect(res.success).toBe(true);
    expect(res.total).toBe(2);
    expect(registry.getActiveInstances).toHaveBeenCalled();
  });

  it("get-status calls getInstance (not the missing getStatus())", async () => {
    const registry = {
      getInstance: vi.fn(() => ({ id: "x", state: "running" })),
    };
    const res = await harness(registry).get("agents:get-status")(
      {},
      { agentId: "x" },
    );
    expect(res.success).toBe(true);
    expect(registry.getInstance).toHaveBeenCalledWith("x");
  });
});
