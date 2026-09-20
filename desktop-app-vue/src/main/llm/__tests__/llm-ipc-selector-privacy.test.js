import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");
const { registerSelectorHandlers } = require("../llm-ipc-selector");

describe("LLM selector IPC privacy boundary", () => {
  const sink = { info: vi.fn(), error: vi.fn() };
  let handlers;

  beforeEach(() => {
    vi.resetAllMocks();
    handlers = {};
  });

  it("does not inspect or expose caught errors", async () => {
    let inspected = false;
    const secret = "sk-selector-secret-config";
    const hostileError = new Proxy(new Error(secret), {
      get() {
        inspected = true;
        throw new Error("caught error was inspected");
      },
      getOwnPropertyDescriptor() {
        inspected = true;
        throw new Error("caught error descriptor was inspected");
      },
    });
    const llmSelector = {
      getAllCharacteristics: vi.fn(() => {
        throw hostileError;
      }),
      getTaskTypes: vi.fn(),
      selectBestLLM: vi.fn(() => {
        throw hostileError;
      }),
      generateSelectionReport: vi.fn(() => {
        throw hostileError;
      }),
    };
    const privacy = createLlmIpcPrivacy("selector", sink);
    registerSelectorHandlers({
      ipcMain: { handle: (channel, handler) => (handlers[channel] = handler) },
      managerRef: { current: null },
      llmSelector,
      database: null,
      app: null,
      coreAuthorization: { authorize: vi.fn(async () => true) },
      llmPrivacy: privacy,
    });

    const calls = [
      ["llm:get-selector-info"],
      ["llm:select-best", {}],
      ["llm:generate-report", "private-task"],
      ["llm:switch-provider", "private-provider"],
    ];

    for (const [channel, argument] of calls) {
      await expect(handlers[channel](null, argument)).rejects.toMatchObject({
        message: "LLM IPC operation failed",
        code: "CC_LLM_IPC_OPERATION_FAILED",
        component: "selector",
      });
    }

    expect(inspected).toBe(false);
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(secret);
  });

  it("fails closed for dynamic component and operation identifiers", () => {
    const privacy = createLlmIpcPrivacy("private-component", sink);

    const error = privacy.failure("private-operation");

    expect(error).toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      component: "unknown",
      operation: "unknown",
    });
    expect(sink.error).toHaveBeenCalledWith("[LLM IPC] operation failed", {
      component: "unknown",
      operation: "unknown",
    });
  });

  it("authorizes and projects selector inputs and success results", async () => {
    const secret = "private-selector-extension";
    const authorize = vi.fn(async () => true);
    const getConfiguration = vi.fn();
    const llmSelector = {
      getAllCharacteristics: vi.fn(() => ({
        ollama: {
          name: "Ollama",
          cost: 0,
          speed: 70,
          quality: 75,
          contextLength: 4096,
          capabilities: ["chat", "embedding"],
          suitable: ["offline", "privacy"],
          requiresInternet: false,
          endpoint: secret,
        },
      })),
      getTaskTypes: vi.fn(() => ({
        chat: {
          name: "Chat",
          prioritize: ["speed", "contextLength"],
          prompt: secret,
        },
      })),
      selectBestLLM: vi.fn(() => ({
        provider: "ollama",
        model: secret,
      })),
      generateSelectionReport: vi.fn(() => [
        {
          provider: "ollama",
          name: "Ollama",
          score: 95,
          configured: true,
          healthy: true,
          characteristics: {
            cost: 0,
            speed: 70,
            quality: 75,
            contextLength: 4096,
            endpoint: secret,
          },
          config: secret,
        },
      ]),
    };
    registerSelectorHandlers({
      ipcMain: { handle: (channel, handler) => (handlers[channel] = handler) },
      managerRef: { current: null },
      llmSelector,
      database: {},
      app: null,
      getLLMConfig: getConfiguration,
      coreAuthorization: { authorize },
      llmPrivacy: createLlmIpcPrivacy("selector", sink),
    });
    const event = Object.freeze({ sender: "main-renderer" });

    const info = await handlers["llm:get-selector-info"](event);
    const selected = await handlers["llm:select-best"](event, {
      taskType: "chat",
      strategy: "speed",
      excludes: ["openai"],
    });
    const report = await handlers["llm:generate-report"](event, "chat");

    expect(info.characteristics.ollama).toEqual({
      name: "Ollama",
      cost: 0,
      speed: 70,
      quality: 75,
      contextLength: 4096,
      capabilities: ["chat", "embedding"],
      suitable: ["offline", "privacy"],
      requiresInternet: false,
    });
    expect(info.taskTypes.chat).toEqual({
      name: "Chat",
      prioritize: ["speed", "contextLength"],
    });
    expect(selected).toEqual({ provider: "ollama" });
    expect(report).toEqual([
      {
        provider: "ollama",
        name: "Ollama",
        score: 95,
        configured: true,
        healthy: true,
        characteristics: {
          cost: 0,
          speed: 70,
          quality: 75,
          contextLength: 4096,
        },
      },
    ]);
    expect(JSON.stringify({ info, selected, report })).not.toContain(secret);
    expect(authorize.mock.calls.map((call) => call[1])).toEqual([
      "get-selector-info",
      "select-best",
      "generate-report",
    ]);

    await expect(
      handlers["llm:select-best"](event, { prompt: secret }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      component: "selector",
      operation: "select-best",
    });
    await expect(
      handlers["llm:switch-provider"](event, secret),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      component: "selector",
      operation: "switch-provider",
    });
    expect(getConfiguration).not.toHaveBeenCalled();
  });

  it("rejects selector requests before selector or configuration access", async () => {
    const llmSelector = {
      getAllCharacteristics: vi.fn(),
      getTaskTypes: vi.fn(),
      selectBestLLM: vi.fn(),
      generateSelectionReport: vi.fn(),
    };
    const getConfiguration = vi.fn();
    registerSelectorHandlers({
      ipcMain: { handle: (channel, handler) => (handlers[channel] = handler) },
      managerRef: { current: null },
      llmSelector,
      database: {},
      app: null,
      getLLMConfig: getConfiguration,
      coreAuthorization: {
        authorize: vi.fn(async () => {
          throw new Error("private authorization reason");
        }),
      },
      llmPrivacy: createLlmIpcPrivacy("selector", sink),
    });

    for (const channel of [
      "llm:get-selector-info",
      "llm:select-best",
      "llm:generate-report",
      "llm:switch-provider",
    ]) {
      await expect(handlers[channel]({}, {})).rejects.toMatchObject({
        code: "CC_LLM_IPC_UNAUTHORIZED",
        component: "selector",
      });
    }
    expect(llmSelector.getAllCharacteristics).not.toHaveBeenCalled();
    expect(llmSelector.selectBestLLM).not.toHaveBeenCalled();
    expect(llmSelector.generateSelectionReport).not.toHaveBeenCalled();
    expect(getConfiguration).not.toHaveBeenCalled();
  });

  it("prevents the selector handler from bypassing the boundary", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "llm-ipc-selector.js"),
      "utf8",
    );

    expect(source).not.toMatch(/utils\/logger\.js/u);
    expect(source).not.toMatch(
      /\blogger\.(?:debug|info|warn|error|fatal)\s*\(/u,
    );
    expect(source).not.toMatch(/console\.(?:debug|info|warn|error|log)\s*\(/u);
    expect(source).not.toMatch(/throw\s+error\b/u);
    expect(source).not.toMatch(/managerConfig\.(?:model|baseURL)/u);
  });
});
