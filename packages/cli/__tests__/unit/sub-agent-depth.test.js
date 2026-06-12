/**
 * Nested sub-agent depth cap (Claude-Code 2.1.172 parity: 5 levels).
 * Sub-agents already carry spawn_sub_agent in their default toolset — this
 * verifies the new depth threading stops runaway recursion at the gate.
 */
import { describe, it, expect } from "vitest";
import { executeTool, MAX_SUB_AGENT_DEPTH } from "../../src/runtime/agent-core.js";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";

describe("MAX_SUB_AGENT_DEPTH gate", () => {
  it("refuses a spawn at the cap before any other validation", async () => {
    const res = await executeTool(
      "spawn_sub_agent",
      {}, // even invalid args — depth check comes first
      { subAgentDepth: MAX_SUB_AGENT_DEPTH },
    );
    expect(res.error).toMatch(/max nesting depth \(5\) reached/);
  });

  it("below the cap, falls through to normal arg validation", async () => {
    const res = await executeTool(
      "spawn_sub_agent",
      {},
      { subAgentDepth: MAX_SUB_AGENT_DEPTH - 1 },
    );
    expect(res.error).toMatch(/requires 'task'/); // gate passed, args invalid
  });

  it("main loop (no depth in context) is depth 0 and may spawn", async () => {
    const res = await executeTool("spawn_sub_agent", {}, {});
    expect(res.error).toMatch(/requires 'task'/);
  });
});

describe("SubAgentContext depth threading", () => {
  it("stores depth (default 1 for direct children)", () => {
    const child = SubAgentContext.create({ role: "r", task: "t" });
    expect(child.depth).toBe(1);
    const grandchild = SubAgentContext.create({
      role: "r",
      task: "t",
      depth: 3,
    });
    expect(grandchild.depth).toBe(3);
  });
});
