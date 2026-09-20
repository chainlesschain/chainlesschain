import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");
const {
  COMPRESSOR_CHANNELS,
  registerPromptCompressorIPC,
  unregisterPromptCompressorIPC,
} = require("../prompt-compressor-ipc");

const STAGE_KEY = "CHAINLESSCHAIN_CONTEXT_MEMORY_DESKTOP_STAGE";
let originalStage;

function compressor() {
  const state = {
    enableDeduplication: true,
    enableSummarization: false,
    enableTruncation: true,
    maxHistoryMessages: 10,
    maxTotalTokens: 4000,
    similarityThreshold: 0.9,
  };
  return {
    get maxTotalTokens() {
      return state.maxTotalTokens;
    },
    getStats: vi.fn(() => ({
      enabled: true,
      strategies: {
        deduplication: state.enableDeduplication,
        summarization: state.enableSummarization,
        truncation: state.enableTruncation,
        privateStrategy: true,
      },
      config: {
        maxHistoryMessages: state.maxHistoryMessages,
        maxTotalTokens: state.maxTotalTokens,
        similarityThreshold: state.similarityThreshold,
        privateConfig: "private-config",
      },
      privateValue: "private-stats",
    })),
    updateConfig: vi.fn((config) => Object.assign(state, config)),
    compress: vi.fn(async (messages) => ({
      messages: messages.map((message) => ({
        ...message,
        privateValue: "private-message-extension",
      })),
      originalTokens: 10,
      compressedTokens: 6,
      compressionRatio: 0.6,
      strategy: "deduplication",
      processingTime: 4,
      tokensSaved: 4,
      privateValue: "private-result",
    })),
  };
}

function harness() {
  const handlers = new Map();
  const instances = new Map();
  let actorDid = "did:key:compressor-a";
  const authorize = vi.fn(async (_event, operation) => ({
    actorDid,
    operation,
    tenantId: actorDid,
  }));
  const ipcMain = {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
  };
  const ipcGuard = {
    isModuleRegistered: vi.fn(() => false),
    markModuleRegistered: vi.fn(),
    unmarkModuleRegistered: vi.fn(),
  };
  const compressorFactory = vi.fn(({ actorDid: owner }) => {
    const instance = compressor();
    instances.set(owner, instance);
    return instance;
  });
  registerPromptCompressorIPC({
    ipcMain,
    ipcGuard,
    compressorFactory,
    coreAuthorization: { authorize },
    compressorPrivacy: createLlmIpcPrivacy("compressor", {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  });
  return {
    authorize,
    compressorFactory,
    handlers,
    instances,
    ipcGuard,
    ipcMain,
    setActor(value) {
      actorDid = value;
    },
  };
}

describe("prompt compressor IPC authorization", () => {
  beforeEach(() => {
    originalStage = process.env[STAGE_KEY];
    process.env[STAGE_KEY] = "shadow";
  });

  afterEach(() => {
    if (originalStage === undefined) {
      delete process.env[STAGE_KEY];
    } else {
      process.env[STAGE_KEY] = originalStage;
    }
  });

  it("authorizes every channel before compressor access", async () => {
    const setup = harness();
    setup.authorize.mockRejectedValueOnce(new Error("private-policy-reason"));

    expect(new Set(setup.handlers.keys())).toEqual(
      new Set(COMPRESSOR_CHANNELS),
    );
    await expect(
      setup.handlers.get("compressor:get-config")({ sender: "renderer" }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_UNAUTHORIZED",
      component: "compressor",
      operation: "compressor-get-config",
    });
    expect(setup.compressorFactory).not.toHaveBeenCalled();
  });

  it("projects configuration and isolates it by actor", async () => {
    const setup = harness();
    const initial = await setup.handlers.get("compressor:get-config")({});
    expect(initial).toEqual({
      success: true,
      config: {
        enabled: true,
        strategies: {
          deduplication: true,
          summarization: false,
          truncation: true,
        },
        config: {
          maxHistoryMessages: 10,
          maxTotalTokens: 4000,
          similarityThreshold: 0.9,
        },
      },
    });
    expect(JSON.stringify(initial)).not.toContain("private");

    await setup.handlers.get("compressor:set-config")(
      {},
      { maxTotalTokens: 1234, enableDeduplication: false },
    );
    expect(
      setup.instances.get("did:key:compressor-a").updateConfig,
    ).toHaveBeenCalledWith({
      maxTotalTokens: 1234,
      enableDeduplication: false,
    });

    setup.setActor("did:key:compressor-b");
    const other = await setup.handlers.get("compressor:get-config")({});
    expect(other.config.config.maxTotalTokens).toBe(4000);
    expect(other.config.strategies.deduplication).toBe(true);
    expect(setup.compressorFactory).toHaveBeenCalledTimes(2);
  });

  it("normalizes messages and projects compression results", async () => {
    const setup = harness();
    const messages = [
      { role: "system", content: "Keep this private prompt bounded" },
      { role: "user", content: "Compress this history" },
    ];

    const result = await setup.handlers.get("compressor:compress")(
      {},
      {
        messages,
        preserveSystemMessage: true,
        preserveLastUserMessage: false,
      },
    );

    expect(result).toEqual({
      success: true,
      messages,
      originalTokens: 10,
      compressedTokens: 6,
      compressionRatio: 0.6,
      strategy: "deduplication",
      tokensSaved: 4,
      processingTime: 4,
    });
    expect(JSON.stringify(result)).not.toContain("private-message-extension");
    expect(
      setup.instances.get("did:key:compressor-a").compress,
    ).toHaveBeenCalledWith(messages, {
      preserveSystemMessage: true,
      preserveLastUserMessage: false,
    });

    await expect(
      setup.handlers.get("compressor:get-history")({}, { limit: 10 }),
    ).resolves.toEqual(
      expect.objectContaining({ success: true, totalCount: 1 }),
    );
    setup.setActor("did:key:compressor-b");
    await expect(
      setup.handlers.get("compressor:get-stats")({}),
    ).resolves.toEqual({
      success: true,
      stats: {
        totalCompressions: 0,
        totalTokensSaved: 0,
        averageCompressionRatio: 1,
        averageProcessingTime: 0,
        strategyDistribution: {},
        recentCompressions: [],
      },
    });
  });

  it("returns bounded previews, estimates, recommendations and receipts", async () => {
    const setup = harness();
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index === 0 ? "system" : "user",
      content: index > 9 ? "duplicate content" : `message ${index}`,
    }));

    const preview = await setup.handlers.get("compressor:preview")(
      {},
      { messages },
    );
    expect(preview.preview).toEqual(
      expect.objectContaining({
        applicableStrategies: ["deduplication", "truncation"],
        recommendation: expect.stringMatching(
          /^(recommended|moderate|not-needed)$/u,
        ),
      }),
    );

    const estimate = await setup.handlers.get("compressor:estimate-tokens")(
      {},
      { content: messages.slice(0, 2) },
    );
    expect(estimate.success).toBe(true);
    expect(estimate.breakdown).toHaveLength(2);
    expect(estimate.breakdown[0]).toEqual(
      expect.objectContaining({ index: 0, role: "system" }),
    );

    const recommendations = await setup.handlers.get(
      "compressor:get-recommendations",
    )({}, { messages, targetTokens: 1 });
    expect(recommendations.success).toBe(true);
    expect(recommendations.recommendations.length).toBeGreaterThan(0);
    expect(JSON.stringify(recommendations)).not.toContain("description");

    await setup.handlers.get("compressor:compress")({}, { messages });
    await expect(
      setup.handlers.get("compressor:clear-history")({}),
    ).resolves.toEqual({ success: true, clearedCount: 1 });
    await expect(
      setup.handlers.get("compressor:reset-config")({}),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
  });

  it("rejects active objects, unknown fields and renderer identity claims", async () => {
    const setup = harness();
    const expected = {
      success: false,
      error: "LLM IPC operation failed",
      code: "CC_LLM_IPC_OPERATION_FAILED",
    };
    const accessor = {};
    const getter = vi.fn(() => []);
    Object.defineProperty(accessor, "messages", {
      enumerable: true,
      get: getter,
    });

    expect(
      await setup.handlers.get("compressor:preview")({}, accessor),
    ).toEqual(expected);
    expect(getter).not.toHaveBeenCalled();
    expect(
      await setup.handlers.get("compressor:preview")(
        {},
        new Proxy({ messages: [] }, {}),
      ),
    ).toEqual(expected);
    expect(
      await setup.handlers.get("compressor:set-config")(
        {},
        { userId: "did:key:attacker" },
      ),
    ).toEqual(expected);
    expect(
      await setup.handlers.get("compressor:set-config")(
        {},
        { enableSummarization: true },
      ),
    ).toEqual(expected);
    expect(setup.compressorFactory).not.toHaveBeenCalled();
  });

  it("preserves the canonical legacy-writer fence after authorization", async () => {
    process.env[STAGE_KEY] = "canonical_default";
    const setup = harness();

    await expect(
      setup.handlers.get("compressor:compress")({}, { messages: [] }),
    ).resolves.toEqual({
      success: false,
      error: "Legacy Desktop Context/Memory writer is fenced",
      code: "CONTEXT_MEMORY_LEGACY_WRITER_FENCED",
      replacement: "coding-agent:app-server-context-compact",
    });
    expect(setup.authorize).toHaveBeenCalledWith({}, "compressor-compress");
    expect(setup.compressorFactory).not.toHaveBeenCalled();
  });

  it("fails closed when an injected compressor already enables summarization", async () => {
    const setup = harness();
    await setup.handlers.get("compressor:get-config")({});
    const instance = setup.instances.get("did:key:compressor-a");
    instance.getStats.mockReturnValue({
      enabled: true,
      strategies: {
        deduplication: true,
        summarization: true,
        truncation: true,
      },
      config: {
        maxHistoryMessages: 10,
        maxTotalTokens: 4000,
        similarityThreshold: 0.9,
      },
    });

    await expect(
      setup.handlers.get("compressor:compress")({}, { messages: [] }),
    ).resolves.toEqual({
      success: false,
      error: "LLM IPC operation failed",
      code: "CC_LLM_IPC_OPERATION_FAILED",
    });
    expect(instance.compress).not.toHaveBeenCalled();
  });

  it("unregisters every handler and keeps dynamic diagnostics out of source", () => {
    const setup = harness();
    setup.ipcGuard.isModuleRegistered.mockReturnValue(true);

    unregisterPromptCompressorIPC({
      ipcMain: setup.ipcMain,
      ipcGuard: setup.ipcGuard,
    });

    expect(setup.ipcMain.removeHandler).toHaveBeenCalledTimes(10);
    expect(setup.handlers.size).toBe(0);
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    for (const file of ["prompt-compressor-ipc.js", "prompt-compressor.js"]) {
      const source = fs.readFileSync(path.join(testDir, "..", file), "utf8");
      expect(source).not.toMatch(/\.message\b/u);
      expect(source).not.toMatch(
        /\b(?:logger|console)\.(?:info|warn|error)\s*\(/u,
      );
    }
  });
});
