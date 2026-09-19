import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerCoreHandlers } = require("../llm-ipc-core");
const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");

describe("LLM core IPC failure privacy", () => {
  const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let handlers;
  let managerRef;
  let getLLMConfig;

  beforeEach(() => {
    vi.resetAllMocks();
    handlers = {};
    managerRef = { current: {} };
    getLLMConfig = vi.fn();
    registerCoreHandlers({
      ipcMain: {
        handle(channel, handler) {
          handlers[channel] = handler;
        },
      },
      managerRef,
      detectTaskType: vi.fn(() => "general"),
      isTestMode: false,
      getLLMConfig,
      llmPrivacy: createLlmIpcPrivacy("core", sink),
    });
  });

  it("projects every top-level handler failure", async () => {
    const secret = "sk-core-secret-prompt-response";
    const hostileError = new Proxy(new Error(secret), {
      get() {
        throw new Error("caught error accessor was invoked");
      },
    });
    const reject = vi.fn(async () => {
      throw hostileError;
    });
    managerRef.current = {
      checkStatus: reject,
      query: reject,
      queryStream: reject,
      listModels: reject,
      clearContext() {
        throw hostileError;
      },
      embeddings: reject,
    };
    getLLMConfig.mockImplementation(() => {
      throw hostileError;
    });

    const status = await handlers["llm:check-status"]();
    expect(status).toMatchObject({
      available: false,
      error: "LLM service unavailable",
      code: "CC_LLM_IPC_UNAVAILABLE",
      component: "core",
      operation: "check-status",
    });

    const failures = [
      ["llm:query", [null, secret, {}], "query"],
      ["llm:query-stream", [null, secret, {}], "query-stream"],
      ["llm:get-config", [], "get-config"],
      ["llm:set-config", [null, { apiKey: secret }], "set-config"],
      ["llm:clear-context", [null, secret], "clear-context"],
      ["llm:embeddings", [null, secret], "embeddings"],
    ];

    for (const [channel, args, operation] of failures) {
      await expect(handlers[channel](...args)).rejects.toMatchObject({
        message: "LLM IPC operation failed",
        code: "CC_LLM_IPC_OPERATION_FAILED",
        component: "core",
        operation,
      });
    }

    await expect(handlers["llm:list-models"]()).resolves.toEqual([]);

    managerRef.current = null;
    await expect(
      handlers["llm:chat"](null, { messages: [] }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      operation: "chat",
    });
    await expect(
      handlers["llm:chat-with-template"](null, {
        templateId: secret,
        variables: { text: secret },
      }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      operation: "chat-with-template",
    });

    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(status)).not.toContain(secret);
  });

  it("preserves the governance code without returning the original error", async () => {
    const original = Object.assign(new Error("private governed failure"), {
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      cause: new Error("private cause"),
    });
    managerRef.current = {
      query: vi.fn(async () => {
        throw original;
      }),
    };

    let received;
    try {
      await handlers["llm:query"](null, "private prompt", {});
    } catch (error) {
      received = error;
    }

    expect(received).not.toBe(original);
    expect(received).toMatchObject({
      message: "Governed Desktop model request failed",
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      component: "core",
      operation: "query",
    });
    expect(received.cause).toBeUndefined();
  });

  it("projects private config values before returning to the renderer", async () => {
    const secret = "sk-core-config-secret";
    getLLMConfig.mockReturnValue({
      getAll: () => ({
        provider: "openai",
        openai: {
          apiKey: secret,
          baseURL: "https://private-tenant.example.test/v1",
          organization: "private-org",
          model: "gpt-safe-model",
        },
        systemPrompt: "private system prompt",
        options: { temperature: 0.2 },
        streamEnabled: true,
      }),
    });

    const result = await handlers["llm:get-config"]();

    expect(result.openai).toMatchObject({
      apiKey: "",
      apiKeyConfigured: true,
      baseURL: "",
      baseURLConfigured: true,
      organization: "",
      organizationConfigured: true,
      model: "gpt-safe-model",
    });
    expect(result.systemPrompt).toBe("");
    expect(result.systemPromptConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("private-tenant");
    expect(JSON.stringify(result)).not.toContain("private system prompt");
  });

  it("keeps top-level core catches on the privacy boundary", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "llm-ipc-core.js"),
      "utf8",
    );
    const retiredMessages = [
      "LLM查询失败",
      "LLM 聊天失败",
      "模板聊天失败",
      "LLM流式查询失败",
      "获取LLM配置失败",
      "设置LLM配置失败",
      "列出模型失败",
      "清除上下文失败",
      "生成嵌入失败",
    ];

    for (const message of retiredMessages) {
      expect(source).not.toContain(message);
    }
    expect(source).not.toMatch(/error\s*:\s*error\.message/u);
    expect(source).not.toContain("errorMonitor.analyzeError(error)");
  });
});
