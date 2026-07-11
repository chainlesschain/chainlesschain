/**
 * 用量归因 — REAL SubAgentContext forwards its child loop's token-usage
 * events through options.onUsage (the seam _executeSpawnSubAgent /
 * isolated run_skill wire to the parent run's usage sink).
 *
 * The child loop is driven with an injected chatFn (no live provider);
 * SubAgentContext runs REAL here (unlike agent-usage-attribution.test.js,
 * which mocks it to test the loop side).
 */
import { describe, it, expect, vi } from "vitest";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";

describe("SubAgentContext onUsage forwarding", () => {
  it("forwards real provider-reported usage from the child loop", async () => {
    const forwarded = [];
    const subCtx = SubAgentContext.create({
      role: "researcher",
      task: "count things",
      cwd: process.cwd(),
      onUsage: (u) => forwarded.push(u),
    });

    const chatFn = vi.fn(async () => ({
      message: { content: "child answer" },
      usage: { input_tokens: 11, output_tokens: 4 },
    }));
    const result = await subCtx.run("count things", {
      chatFn,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      autoCompact: false,
      runnableProviderFallback: false,
    });

    expect(result.summary).toContain("child answer");
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { input_tokens: 11, output_tokens: 4 },
      attribution: null, // the child loop's own top-level usage is unattributed
    });
  });

  it("a throwing onUsage never breaks the child run (best-effort)", async () => {
    const subCtx = SubAgentContext.create({
      role: "r",
      task: "t",
      cwd: process.cwd(),
      onUsage: () => {
        throw new Error("listener boom");
      },
    });
    const result = await subCtx.run("t", {
      chatFn: async () => ({
        message: { content: "ok" },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      autoCompact: false,
      runnableProviderFallback: false,
    });
    expect(result.summary).toContain("ok");
  });

  it("without onUsage the run is unchanged (no seam, no throw)", async () => {
    const subCtx = SubAgentContext.create({
      role: "r",
      task: "t",
      cwd: process.cwd(),
    });
    const result = await subCtx.run("t", {
      chatFn: async () => ({
        message: { content: "plain" },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      autoCompact: false,
      runnableProviderFallback: false,
    });
    expect(result.summary).toContain("plain");
  });
});
