import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  registerVolcengineIPC,
  unregisterVolcengineIPC,
} = require("../volcengine-ipc");
const { createVolcengineIpcPrivacy } = require("../volcengine-ipc-privacy");

function setup(overrides = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: vi.fn(),
  };
  const selector = {
    selectByScenario: vi.fn(() => ({
      id: "model-1",
      name: "Model One",
      capabilities: ["chat"],
      pricing: { input: 1 },
      description: "description",
      contextLength: 1024,
      maxOutputTokens: 256,
    })),
    selectModel: vi.fn(),
    estimateCost: vi.fn(() => 1.25),
    listModels: vi.fn(() => []),
    ...overrides.selector,
  };
  const llmConfig = {
    setProviderConfig: vi.fn(),
    ...overrides.llmConfig,
  };
  const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const privacy = createVolcengineIpcPrivacy(sink);

  registerVolcengineIPC({
    ipcMain,
    getModelSelector: () => selector,
    getLLMConfig: () => llmConfig,
    privacy,
  });

  return { handlers, ipcMain, selector, llmConfig, sink, privacy };
}

describe("Volcengine IPC privacy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("allowlists diagnostics and failure operations", () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const privacy = createVolcengineIpcPrivacy(sink);

    privacy.event("private-event");
    const failure = privacy.failure("private-operation");

    expect(sink.info).toHaveBeenCalledWith("[VolcengineIPC] internal event", {
      component: "volcengine",
      event: "unknown",
    });
    expect(failure).toEqual({
      success: false,
      error: "Volcengine IPC operation failed",
      code: "CC_VOLCENGINE_IPC_OPERATION_FAILED",
      component: "volcengine",
      operation: "unknown",
    });
  });

  it("returns a fixed receipt for selector failures", async () => {
    const secret = "private-selector-stack-and-model";
    const { handlers, sink } = setup({
      selector: {
        selectByScenario: vi.fn(() => {
          throw new Error(secret);
        }),
      },
    });

    const result = await handlers.get("volcengine:select-model")(null, {
      scenario: "private-scenario",
    });

    expect(result).toEqual({
      success: false,
      error: "Volcengine IPC operation failed",
      code: "CC_VOLCENGINE_IPC_OPERATION_FAILED",
      component: "volcengine",
      operation: "select-model",
    });
    expect(
      JSON.stringify({ result, calls: sink.error.mock.calls }),
    ).not.toContain(secret);
  });

  it("keeps direct tool channels behind the governed ingress", async () => {
    const { handlers, sink } = setup();
    const result = await handlers.get("volcengine:chat-with-web-search")(null, {
      messages: [{ role: "user", content: "private prompt" }],
      options: { model: "private-model" },
    });

    expect(result).toEqual({
      success: false,
      error: "Governed Desktop model request failed",
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      component: "volcengine",
      operation: "chat-with-web-search",
    });
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(
      "private prompt",
    );
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(
      "private-model",
    );
  });

  it("preserves successful selector and config-update contracts", async () => {
    const { handlers, llmConfig } = setup();

    const selected = await handlers.get("volcengine:select-model")(null, {
      scenario: "chat",
    });
    const updated = await handlers.get("volcengine:update-config")(null, {
      config: { apiKey: "private-key" },
    });

    expect(selected).toEqual({
      success: true,
      data: {
        modelId: "model-1",
        modelName: "Model One",
        capabilities: ["chat"],
        pricing: { input: 1 },
        description: "description",
        contextLength: 1024,
        maxOutputTokens: 256,
      },
    });
    expect(updated.success).toBe(true);
    expect(llmConfig.setProviderConfig).toHaveBeenCalledWith("volcengine", {
      apiKey: "private-key",
    });
  });

  it("unregisters every channel through an injected IPC boundary", () => {
    const { ipcMain, privacy } = setup();

    unregisterVolcengineIPC({ ipcMain, privacy });

    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(15);
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      "volcengine:execute-function-calling",
    );
  });

  it("keeps direct logger, console and caught-error text out of IPC", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "volcengine-ipc.js"),
      "utf8",
    );

    expect(source).not.toMatch(/utils\/logger\.js/u);
    expect(source).not.toMatch(
      /\blogger\.(?:debug|info|warn|error|fatal)\s*\(/u,
    );
    expect(source).not.toMatch(/console\.(?:debug|info|warn|error|log)\s*\(/u);
    expect(source).not.toMatch(/\berror\.message\b/u);
    expect(source).not.toMatch(/catch\s*\(\s*error\s*\)/u);
  });
});
