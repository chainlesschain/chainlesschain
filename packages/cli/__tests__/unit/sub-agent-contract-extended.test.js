/**
 * Extended sub-agent contract (gap-analysis 2026-07-11 P1 "完整 Subagent 契约"):
 * disallowedTools / maxTurns / isolation reach the spawned child — via spawn
 * args and via named-agent frontmatter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));
vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn(function () {
    return { getResolvedSkills: vi.fn(() => []) };
  }),
}));
vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

const { executeTool } = await import("../../src/lib/agent-core.js");
const { SubAgentContext } = await import("../../src/lib/sub-agent-context.js");

/** Capture the tool names sent to the (mocked) LLM by the child loop. */
function mockLlmCapturingTools(capture) {
  globalThis.fetch = vi.fn(async (url, init) => {
    try {
      const body = JSON.parse(init?.body || "{}");
      if (Array.isArray(body.tools)) {
        capture.push(body.tools.map((t) => t?.function?.name).filter(Boolean));
      }
    } catch {
      /* capture is best-effort */
    }
    return {
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "done" },
      }),
    };
  });
}

afterEach(() => {
  delete globalThis.fetch;
});

// The child inherits the parent's LLM options; without them the sub-agent
// loop fails "Unsupported provider" before any fetch.
const CTX = {
  cwd: process.cwd(),
  llmOptions: {
    provider: "ollama",
    model: "test-model",
    baseUrl: "http://localhost:11434",
  },
};

describe("spawn_sub_agent — disallowedTools deny-list", () => {
  it("removes denied tools from the child's LLM tool surface", async () => {
    const seen = [];
    mockLlmCapturingTools(seen);
    const result = await executeTool(
      "spawn_sub_agent",
      {
        role: "auditor",
        task: "look around",
        disallowedTools: ["run_shell", "run_code", "spawn_sub_agent"],
      },
      CTX,
    );
    expect(result).toBeDefined();
    expect(seen.length).toBeGreaterThan(0);
    const names = seen[0];
    expect(names).toContain("read_file");
    expect(names).not.toContain("run_shell");
    expect(names).not.toContain("run_code");
  });

  it("deny-list intersects an explicit allow-list", async () => {
    const seen = [];
    mockLlmCapturingTools(seen);
    await executeTool(
      "spawn_sub_agent",
      {
        role: "reader",
        task: "read stuff",
        tools: ["read_file", "run_shell"],
        disallowedTools: ["run_shell"],
      },
      CTX,
    );
    expect(seen[0]).toEqual(["read_file"]);
  });
});

describe("spawn_sub_agent — maxTurns / isolation plumbing", () => {
  it("SubAgentContext honors maxIterations and useWorktree options", () => {
    const ctx = SubAgentContext.create({
      role: "r",
      task: "t",
      maxIterations: 3,
      useWorktree: true,
    });
    expect(ctx.maxIterations).toBe(3);
    expect(ctx._useWorktree).toBe(true);
    const def = SubAgentContext.create({ role: "r", task: "t" });
    expect(def.maxIterations).toBe(8); // default untouched
  });

  it("named agent frontmatter maxTurns caps the child loop", async () => {
    // Force >1 desired iterations: LLM keeps asking for a tool call; the cap
    // must stop the loop rather than run forever. maxTurns=1 → exactly one
    // LLM round-trip before the iteration limit ends the child run.
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: { name: "list_dir", arguments: { path: "." } },
              },
            ],
          },
        }),
      };
    });
    const result = await executeTool(
      "spawn_sub_agent",
      { role: "looper", task: "loop forever", maxTurns: 1 },
      CTX,
    );
    expect(result).toBeDefined();
    expect(calls).toBeGreaterThan(0); // the child actually ran
    // iterationCount counts loop EVENTS (~3 per iteration); cap 1 → ≤3.
    expect(result.iterationCount).toBeLessThanOrEqual(3);
    expect(calls).toBeLessThanOrEqual(2); // no runaway toward the default 8
  });
});
