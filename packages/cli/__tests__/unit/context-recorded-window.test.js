import { describe, it, expect, vi } from "vitest";
import { Command } from "commander";
import { registerContextCommand } from "../../src/commands/context.js";
import { readEvents } from "../../src/harness/jsonl-session-store.js";

vi.mock("../../src/harness/jsonl-session-store.js", () => ({
  rebuildMessages: () => [],
  getLastSessionId: () => "s",
  sessionExists: () => true,
  readEvents: vi.fn(),
}));
vi.mock("../../src/lib/context-memory-kernel/index.js", () => ({
  createCliContextMemoryRuntime: () => {
    throw new Error("not needed for window report");
  },
}));

describe("stored request window", () => {
  it.each([false, true])(
    "uses the last main request, with model override=%s",
    async (override) => {
      readEvents.mockReturnValue([
        { type: "session_start", data: { provider: "ollama", model: "old" } },
        {
          type: "token_usage",
          data: {
            provider: "openai",
            model: "gpt-6-astra",
            contextWindow: 1000000,
          },
        },
        {
          type: "token_usage",
          data: {
            provider: "openai",
            model: "gpt-4o",
            contextWindow: 128000,
            attribution: { origin: "subagent" },
          },
        },
      ]);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = new Command();
        registerContextCommand(program);
        await program.parseAsync(
          [
            "context",
            "s",
            "--json",
            ...(override ? ["--model", "gpt-4o"] : []),
          ],
          { from: "user" },
        );
        const report = JSON.parse(log.mock.calls.at(-1)[0]);
        expect(report.contextWindow).toBe(override ? 128000 : 1000000);
        expect(report.provider).toBe("openai");
      } finally {
        log.mockRestore();
      }
    },
  );
});
