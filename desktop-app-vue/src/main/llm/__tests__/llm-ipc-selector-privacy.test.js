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
