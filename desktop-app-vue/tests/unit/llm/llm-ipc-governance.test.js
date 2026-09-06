import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const managerModule = require("../../../src/main/llm/llm-manager.js");
const {
  registerCoreHandlers,
} = require("../../../src/main/llm/llm-ipc-core.js");
const {
  registerSelectorHandlers,
} = require("../../../src/main/llm/llm-ipc-selector.js");
const {
  createDesktopModelIngressHost,
  prepareDesktopModelRequest,
} = require("../../../src/main/evolution/desktop-model-ingress.js");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  managerModule._setLLMDepsForTesting(null);
  managerModule._setLLMManagerInstance(null);
});

describe("native IPC configuration authority continuity", () => {
  it.each([
    ["llm:set-config", false],
    ["llm:set-config", true],
    ["llm:switch-provider", false],
    ["llm:switch-provider", true],
  ])(
    "preserves host and references for %s (failure=%s)",
    async (channel, failure) => {
      vi.stubEnv("MOCK_LLM", "false");
      const source = vi.fn(async () => {
        throw new Error("original evidence authority reached");
      });
      const forged = vi.fn(async () => {
        throw new Error("forged authority reached");
      });
      const host = createDesktopModelIngressHost(source);
      const settings = {
        provider: "openai",
        model: "updated",
        enableManusOptimizations: false,
        enableStateBus: false,
        desktopModelIngressHost: createDesktopModelIngressHost(forged),
      };
      const storedConfig = {
        set: vi.fn(),
        setProvider: vi.fn(),
        save: vi.fn(),
        getManagerConfig: () => settings,
      };
      const previous = new managerModule.LLMManager(
        { ...settings, model: "original" },
        host,
      );
      previous.tokenTracker = { recordUsage: vi.fn(), on: vi.fn() };
      previous.responseCache = { getEvidenceReceipt: vi.fn() };
      previous.promptCompressor = { llmManager: previous };
      managerModule._setLLMManagerInstance(previous);
      managerModule._setLLMDepsForTesting({
        OpenAIClient: class {
          constructor() {
            if (failure) throw new Error("client initialization denied");
          }
          async checkStatus() {
            return { available: true, models: [] };
          }
        },
      });
      const handlers = new Map();
      const managerRef = { current: previous };
      const app = { llmManager: previous };
      const ctx = {
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        managerRef,
        app,
        database: {},
        getLLMConfig: () => storedConfig,
      };
      registerCoreHandlers(ctx);
      registerSelectorHandlers(ctx);
      const pending = handlers.get(channel)(
        {},
        channel === "llm:set-config" ? { model: "updated" } : "openai",
      );
      expect(managerRef.current).toBe(previous);
      if (failure) {
        await expect(pending).rejects.toThrow("client initialization denied");
        expect(managerRef.current).toBe(previous);
        expect(app.llmManager).toBe(previous);
        expect(managerModule.getLLMManager()).toBe(previous);
        expect(previous.promptCompressor.llmManager).toBe(previous);
      } else {
        await expect(pending).resolves.toBe(true);
        const next = managerRef.current;
        expect(next).not.toBe(previous);
        expect(next).toBeInstanceOf(managerModule.LLMManager);
        expect(app.llmManager).toBe(next);
        expect(managerModule.getLLMManager()).toBe(next);
        expect(next.responseCache).toBe(previous.responseCache);
        expect(next.tokenTracker).toBe(previous.tokenTracker);
        expect(next.promptCompressor).toBe(previous.promptCompressor);
        expect(next.promptCompressor.llmManager).toBe(next);
        await expect(
          prepareDesktopModelRequest(next.client, {
            messages: [{ role: "user", content: "hello" }],
          }),
        ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
        expect(source).toHaveBeenCalledOnce();
        expect(forged).not.toHaveBeenCalled();
      }
    },
  );
});
