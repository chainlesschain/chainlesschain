import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { LLMManager } = require("../../../src/main/llm/llm-manager.js");
const {
  runDesktopCachedModelWorkflow,
  runDesktopModelWorkflow,
  runDesktopToolExecution,
} = require("../../../src/main/evolution/desktop-model-ingress.js");
const terminal = { code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" };

describe("Desktop workflow admission before cached success or side effects", () => {
  it.each(["chat", "chatWithMessages", "chatStream", "chatWithMessagesStream"])(
    "%s rejects before legacy cache, compression, provider or success output",
    async (method) => {
      const manager = new LLMManager({
        provider: "ollama",
        model: "test",
        enableStateBus: false,
        enableManusOptimizations: false,
      });
      // Construct the actual manager without a host, with a legacy cache hit
      // that previously returned successfully without reaching the provider.
      manager.isInitialized = true;
      const provider = vi.fn();
      manager.client = { chat: provider, chatStream: provider };
      const cacheRead = vi.fn(async () => ({
        hit: true,
        response: { text: "unverified legacy answer", model: "test" },
      }));
      manager.responseCache = { get: cacheRead, getEvidenceReceipt: vi.fn() };
      const compress = vi.fn();
      manager.promptCompressor = { compress };
      const success = vi.fn();
      const onChunk = vi.fn();
      manager.on("chat-completed", success);
      manager.on("chat-stream-completed", success);
      const messages = Array.from({ length: 6 }, () => ({
        role: "user",
        content: "private canary conversation",
      }));

      await expect(
        method.endsWith("Stream")
          ? manager[method](messages, onChunk)
          : manager[method](messages),
      ).rejects.toMatchObject(terminal);
      expect(cacheRead).not.toHaveBeenCalled();
      expect(manager.responseCache.getEvidenceReceipt).not.toHaveBeenCalled();
      expect(compress).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
      expect(success).not.toHaveBeenCalled();
      expect(onChunk).not.toHaveBeenCalled();
    },
  );

  it("rejects exported unbound workflows before input inspection or callback effects", async () => {
    const inspect = vi.fn(() => {
      throw new Error("private input inspected");
    });
    const input = { toJSON: inspect };
    const work = vi.fn();
    const execute = vi.fn();
    await expect(
      runDesktopCachedModelWorkflow({}, input, {}, work),
    ).rejects.toMatchObject(terminal);
    await expect(
      runDesktopModelWorkflow({}, input, work),
    ).rejects.toMatchObject(terminal);
    await expect(
      runDesktopToolExecution({}, input, execute),
    ).rejects.toMatchObject(terminal);
    expect(inspect).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
