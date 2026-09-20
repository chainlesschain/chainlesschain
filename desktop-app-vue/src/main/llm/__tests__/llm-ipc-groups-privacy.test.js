import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerAlertHandlers } = require("../llm-ipc-alert");
const { registerBudgetHandlers } = require("../llm-ipc-budgets");
const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");
const { registerRetentionHandlers } = require("../llm-ipc-retention");
const { registerStreamHandlers } = require("../llm-ipc-stream");
const { registerTestDataHandlers } = require("../llm-ipc-test-data");
const { registerTokenHandlers } = require("../llm-ipc-token");

function captureHandlers() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
}

function hostileFailure(secret) {
  return new Proxy(new Error(secret), {
    get() {
      throw new Error("caught error accessor was invoked");
    },
    getOwnPropertyDescriptor() {
      throw new Error("caught error descriptor was invoked");
    },
  });
}

describe("LLM auxiliary IPC privacy boundaries", () => {
  const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns fixed failures for alert, budget, retention and test-data operations", async () => {
    const secret = "private-db-error-with-tenant-path";
    const failure = hostileFailure(secret);
    const database = {
      prepare() {
        throw failure;
      },
    };
    const { handlers, ipcMain } = captureHandlers();

    registerAlertHandlers({
      ipcMain,
      database,
      alertPrivacy: createLlmIpcPrivacy("alert", sink),
    });
    registerBudgetHandlers({
      ipcMain,
      database,
      budgetPrivacy: createLlmIpcPrivacy("budgets", sink),
    });
    registerRetentionHandlers({
      ipcMain,
      database,
      retentionPrivacy: createLlmIpcPrivacy("retention", sink),
    });
    registerTestDataHandlers({
      ipcMain,
      database: null,
      testDataPrivacy: createLlmIpcPrivacy("test-data", sink),
    });

    await expect(handlers.get("llm:get-alert-history")()).resolves.toEqual([]);
    await expect(handlers.get("llm:get-model-budgets")()).resolves.toEqual([]);
    await expect(
      handlers.get("llm:get-retention-config")(),
    ).resolves.toBeNull();

    const failures = [
      ["llm:add-alert", [{ title: secret }], "alert", "add-alert"],
      ["llm:dismiss-alert", [secret], "alert", "dismiss-alert"],
      ["llm:clear-alert-history", [], "alert", "clear-alert-history"],
      ["llm:set-model-budget", [{}], "budgets", "set-model-budget"],
      ["llm:delete-model-budget", [{}], "budgets", "delete-model-budget"],
      ["llm:set-retention-config", [{}], "retention", "set-retention-config"],
      ["llm:cleanup-old-data", [], "retention", "cleanup-old-data"],
      ["llm:generate-test-data", [], "test-data", "generate-test-data"],
    ];

    for (const [channel, args, component, operation] of failures) {
      await expect(handlers.get(channel)(null, ...args)).rejects.toMatchObject({
        message: "LLM IPC operation failed",
        code: "CC_LLM_IPC_OPERATION_FAILED",
        component,
        operation,
      });
    }

    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(secret);
  });

  it("returns fixed failures for every token operation", async () => {
    const secret = "private-token-provider-model-error";
    const failure = hostileFailure(secret);
    const reject = vi.fn(async () => {
      throw failure;
    });
    const throwSync = vi.fn(() => {
      throw failure;
    });
    const tokenTracker = {
      getUsageStats: reject,
      getTimeSeriesData: reject,
      getCostBreakdown: reject,
      getBudgetConfig: reject,
      saveBudgetConfig: reject,
      exportCostReport: reject,
    };
    const responseCache = { clear: reject, getStats: reject };
    const managerRef = {
      current: {
        resumeService: reject,
        pauseService: reject,
        calculateCostEstimate: throwSync,
        canPerformOperation: reject,
      },
    };
    const { handlers, ipcMain } = captureHandlers();
    registerTokenHandlers({
      ipcMain,
      managerRef,
      tokenTracker,
      responseCache,
      tokenPrivacy: createLlmIpcPrivacy("token", sink),
    });

    const failures = [
      ["llm:get-usage-stats", [{}], "get-usage-stats"],
      ["llm:get-time-series", [{}], "get-time-series"],
      ["llm:get-cost-breakdown", [{}], "get-cost-breakdown"],
      ["llm:get-budget", [], "get-budget"],
      ["llm:set-budget", ["private-user", {}], "set-budget"],
      ["llm:export-cost-report", [{}], "export-cost-report"],
      ["llm:clear-cache", [], "clear-cache"],
      ["llm:get-cache-stats", [], "get-cache-stats"],
      ["llm:resume-service", [], "resume-service"],
      ["llm:pause-service", [], "pause-service"],
      [
        "llm:calculate-cost-estimate",
        [
          {
            provider: "private-provider",
            model: "private-model",
            inputTokens: 1,
            outputTokens: 1,
          },
        ],
        "calculate-cost-estimate",
      ],
      ["llm:can-perform-operation", [1], "can-perform-operation"],
    ];

    for (const [channel, args, operation] of failures) {
      await expect(handlers.get(channel)(null, ...args)).rejects.toMatchObject({
        message: "LLM IPC operation failed",
        code: "CC_LLM_IPC_OPERATION_FAILED",
        component: "token",
        operation,
      });
    }

    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(secret);
  });

  it("projects stream events, stats, successes and operation failures", async () => {
    const secret = "private-stream-chunk-and-error";
    const send = vi.fn();
    const app = {};
    const { handlers, ipcMain } = captureHandlers();
    registerStreamHandlers({
      ipcMain,
      app,
      mainWindow: { webContents: { send } },
      streamPrivacy: createLlmIpcPrivacy("stream", sink),
    });

    const created = await handlers.get("llm:create-stream-controller")(
      null,
      {},
    );
    const controller = app.streamControllers.get(created.controllerId);
    controller.emit("chunk", { chunk: secret, provider: secret });
    controller.emit("pause", { reason: secret, timestamp: secret });
    controller.emit("resume", { result: secret });
    controller.emit("cancel", { reason: secret });
    controller.emit("complete", { result: secret, stats: { secret } });
    controller.emit("stream-error", { error: secret, stack: secret });

    for (const [channel, event] of [
      ["llm:stream-chunk", "chunk"],
      ["llm:stream-pause", "pause"],
      ["llm:stream-resume", "resume"],
      ["llm:stream-cancel", "cancel"],
      ["llm:stream-complete", "complete"],
    ]) {
      expect(send).toHaveBeenCalledWith(channel, {
        controllerId: created.controllerId,
        code: "CC_LLM_STREAM_EVENT",
        component: "stream-controller",
        event,
      });
    }
    expect(send).toHaveBeenCalledWith("llm:stream-error", {
      controllerId: created.controllerId,
      code: "CC_LLM_STREAM_FAILED",
      component: "stream-controller",
      event: "stream-error",
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain(secret);

    controller.getStats = () => ({
      status: "running",
      totalChunks: 4,
      processedChunks: 3,
      duration: 20,
      throughput: 150,
      averageChunkTime: 5,
      isPaused: true,
      bufferedChunks: 2,
      bufferedBytes: 40,
      droppedBufferedChunks: 1,
      pauseWaiters: 2,
      droppedPausedChunks: 1,
      startTime: secret,
      result: secret,
    });
    await expect(
      handlers.get("llm:get-stream-stats")(null, created.controllerId),
    ).resolves.toEqual({
      status: "running",
      totalChunks: 4,
      processedChunks: 3,
      duration: 20,
      throughput: 150,
      averageChunkTime: 5,
      isPaused: true,
      bufferedChunks: 2,
      bufferedBytes: 40,
      droppedBufferedChunks: 1,
      pauseWaiters: 2,
      droppedPausedChunks: 1,
    });

    controller.pause = vi.fn();
    controller.resume = vi.fn();
    controller.cancel = vi.fn();
    await expect(
      handlers.get("llm:pause-stream")(null, created.controllerId),
    ).resolves.toEqual({ success: true });
    await expect(
      handlers.get("llm:resume-stream")(null, created.controllerId),
    ).resolves.toEqual({ success: true });
    await expect(
      handlers.get("llm:cancel-stream")(null, created.controllerId, secret),
    ).resolves.toEqual({ success: true });

    await expect(
      handlers.get("llm:pause-stream")(null, "missing-private-controller"),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      component: "stream",
      operation: "pause-stream",
    });
  });

  it("keeps every auxiliary source file on the fixed boundary", () => {
    const files = [
      ["llm-ipc.js", "bootstrap"],
      ["llm-ipc-alert.js", "alert"],
      ["llm-ipc-budgets.js", "budgets"],
      ["llm-ipc-retention.js", "retention"],
      ["llm-ipc-stream.js", "stream"],
      ["llm-ipc-test-data.js", "test-data"],
      ["llm-ipc-token.js", "token"],
    ];

    for (const [file, component] of files) {
      const source = fs.readFileSync(
        path.resolve(__dirname, "..", file),
        "utf8",
      );
      expect(source).not.toMatch(/utils\/logger\.js/u);
      expect(source).not.toMatch(
        /\blogger\.(?:debug|info|warn|error|fatal)\s*\(/u,
      );
      expect(source).not.toMatch(
        /console\.(?:debug|info|warn|error|log)\s*\(/u,
      );
      expect(source).not.toMatch(/throw\s+error\b/u);
      expect(source).not.toMatch(/\berror\.message\b/u);

      const privacy = createLlmIpcPrivacy(component, sink);
      const eventNames = [
        ...source.matchAll(/privacy\.event\("([a-z-]+)"\)/gu),
      ].map((match) => match[1]);
      for (const eventName of eventNames) {
        privacy.event(eventName);
        expect(sink.info).toHaveBeenLastCalledWith("[LLM IPC] internal event", {
          component,
          event: eventName,
        });
      }
    }
  });
});
