/**
 * Integration: --resume role alternation through the REAL stack.
 *
 * Unlike the unit tests (which inject a fake agentLoop), this drives the real
 * runtime agentLoop → chatWithTools and mocks ONLY the LLM fetch layer. The mock
 * provider behaves like Anthropic/Bedrock: it rejects a payload containing two
 * consecutive non-system messages of the same role ("roles must alternate").
 *
 * A resumed session whose previous run produced no assistant response leaves a
 * trailing `user` turn; before the 2.1.187 parity fix the new prompt was sent
 * right after it → two consecutive `user` messages → the mock 400s → the run
 * fails. With the fix the runner merges them, the mock accepts, and the run
 * completes.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn(function () {
    return { getResolvedSkills: vi.fn(() => []), loadAll: vi.fn(() => []) };
  }),
}));

const { runAgentHeadless } = await import(
  "../../src/runtime/headless-runner.js"
);

function fakeGate() {
  return {
    setSessionPolicy: () => {},
    setConfirmer: () => {},
    decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
  };
}

/** Store seams that inject a resumed history and swallow persistence. */
function resumeStoreDeps(history) {
  return {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => fakeGate(),
    writeOut: () => {},
    writeErr: () => {},
    sessionExists: () => true,
    rebuildMessages: () => history,
    startSession: () => {},
    appendUserMessage: () => {},
    appendAssistantMessage: () => {},
    appendTokenUsage: () => {},
    appendCompactEvent: () => {},
    getLastSessionId: () => "sid",
  };
}

/** First non-system pair sharing a role, or null if strictly alternating. */
function firstConsecutiveRole(messages) {
  const nonSys = messages.filter((m) => m && m.role !== "system");
  for (let i = 1; i < nonSys.length; i++) {
    if (nonSys[i].role === nonSys[i - 1].role) return nonSys[i].role;
  }
  return null;
}

describe("Integration: --resume role alternation (real agentLoop, mocked fetch)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("forwards an alternating payload when resuming a no-response session", async () => {
    let captured = null;
    // Anthropic-like provider: 400 on consecutive same-role turns.
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      captured = body.messages;
      const dupe = firstConsecutiveRole(body.messages);
      if (dupe) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: `messages: roles must alternate (saw consecutive ${dupe})`,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { role: "assistant", content: "resumed-ok" },
          prompt_eval_count: 5,
          eval_count: 2,
          done: true,
        }),
      };
    });

    // history ends with a bare user turn → degenerate resume.
    const r = await runAgentHeadless(
      {
        prompt: "continue please",
        resume: "sid",
        provider: "ollama",
        model: "test",
        baseUrl: "http://localhost:11434",
        outputFormat: "json",
      },
      resumeStoreDeps([{ role: "user", content: "original task" }]),
    );

    // The provider must have been called with a strictly alternating payload…
    expect(captured).not.toBeNull();
    expect(firstConsecutiveRole(captured)).toBeNull();
    // …and the merged user turn carries both prompts.
    const users = captured.filter((m) => m.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0].content).toContain("original task");
    expect(users[0].content).toContain("continue please");
    // …and the run succeeded (no 400, real reply surfaced).
    expect(r.isError).toBeFalsy();
    expect(r.exitCode).toBe(0);
    expect(String(r.result)).toContain("resumed-ok");
  });

  it("healthy alternating resume is unaffected (two separate user turns)", async () => {
    let captured = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = JSON.parse(init.body).messages;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { role: "assistant", content: "ok" },
          done: true,
        }),
      };
    });

    const r = await runAgentHeadless(
      {
        prompt: "c",
        resume: "sid",
        provider: "ollama",
        model: "test",
        baseUrl: "http://localhost:11434",
        outputFormat: "json",
      },
      resumeStoreDeps([
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ]),
    );

    expect(firstConsecutiveRole(captured)).toBeNull();
    const users = captured.filter((m) => m.role === "user");
    expect(users.map((m) => m.content)).toEqual(["a", "c"]);
    expect(r.exitCode).toBe(0);
  });
});
