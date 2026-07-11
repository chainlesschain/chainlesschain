/**
 * 用量归因 — headless runner side.
 *
 * Attributed child-loop usage (spawn_sub_agent / isolated run_skill) must:
 *  - stay OUT of the result envelope's `usage` (main-loop-only semantics
 *    unchanged),
 *  - be persisted as its OWN token_usage event carrying the attribution
 *    frame (no double count with the end-of-run main aggregate),
 *  - still flow on the stream as ordinary token_usage events.
 * Compact tool_call records ({tool, is_error, skill?} — never args) are
 * persisted for every tool call so `cc session usage --by tool|mcp` works
 * for headless sessions too.
 *
 * The agent loop is faked via deps.agentLoop (deterministic events); every
 * store write is captured via the deps store seam — no disk, no LLM.
 */
import { describe, it, expect, vi } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

const ATTR = {
  origin: "subagent",
  subagentId: "sub-9",
  role: "researcher",
  parentSessionId: "s-attr",
  depth: 1,
};

function fakeLoop() {
  // eslint-disable-next-line require-yield
  return async function* (_messages, _opts) {
    yield { type: "run-started", runId: "r1", sessionId: "s-attr" };
    yield {
      type: "tool-executing",
      tool: "run_skill",
      args: { skill_name: "csv-clean", input: "x" },
    };
    yield { type: "tool-result", tool: "run_skill", result: { ok: 1 } };
    yield {
      type: "tool-executing",
      tool: "mcp__github__search_issues",
      args: { q: "bug" },
    };
    yield {
      type: "tool-result",
      tool: "mcp__github__search_issues",
      result: { error: "rate limited" },
      error: "rate limited",
    };
    // attributed child usage (as drained from the sink by the real loop)
    yield {
      type: "token-usage",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { input_tokens: 40, output_tokens: 15 },
      attribution: ATTR,
    };
    // main-loop usage
    yield {
      type: "token-usage",
      provider: "anthropic",
      model: "claude-opus-4-8",
      usage: { input_tokens: 100, output_tokens: 20 },
    };
    yield { type: "response-complete", content: "done" };
    yield { type: "run-ended", runId: "r1", reason: "complete" };
  };
}

function makeDeps() {
  const out = [];
  const writes = { tokenUsage: [], toolCalls: [], assistant: [], user: [] };
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => ({
      setSessionPolicy: () => {},
      setConfirmer: () => {},
      decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
    }),
    writeOut: (s) => out.push(s),
    writeErr: () => {},
    agentLoop: fakeLoop(),
    // store seam — capture instead of disk
    sessionExists: () => false,
    rebuildMessages: () => [],
    startSession: () => {},
    appendUserMessage: (id, c) => writes.user.push({ id, c }),
    appendAssistantMessage: (id, c) => writes.assistant.push({ id, c }),
    appendTokenUsage: (id, u) => writes.tokenUsage.push({ id, u }),
    appendToolCallCompact: (id, rec) => writes.toolCalls.push({ id, rec }),
    appendCompactEvent: () => {},
    getLastSessionId: () => null,
    verifySession: () => ({ status: "verified" }),
  };
  return { deps, out, writes };
}

describe("headless runner usage attribution", () => {
  it("envelope usage excludes attributed child spend; attributed events + tool calls persist", async () => {
    const { deps, out, writes } = makeDeps();
    const r = await runAgentHeadless(
      {
        prompt: "go",
        outputFormat: "json",
        sessionId: "s-attr",
        persistSession: true,
      },
      deps,
    );
    expect(r.exitCode).toBe(0);

    // envelope usage = main loop only (40/15 child spend excluded)
    const env = JSON.parse(out.join("").trim().split("\n").at(-1));
    expect(env.usage).toEqual({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });

    // persisted: attributed record FIRST, then the unchanged main aggregate
    expect(writes.tokenUsage).toHaveLength(2);
    expect(writes.tokenUsage[0].u).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { input_tokens: 40, output_tokens: 15 },
      attribution: ATTR,
    });
    expect(writes.tokenUsage[1].u).toEqual({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });

    // compact tool_call records: skill hint on run_skill, error flag from
    // the tool result, never args
    expect(writes.toolCalls).toHaveLength(2);
    expect(writes.toolCalls[0].rec).toMatchObject({
      tool: "run_skill",
      isError: false,
      skill: "csv-clean",
    });
    expect(writes.toolCalls[0].rec.args).toBeUndefined();
    expect(writes.toolCalls[1].rec).toMatchObject({
      tool: "mcp__github__search_issues",
      isError: true,
    });
  });

  it("stream mode forwards attributed usage as ordinary token_usage events (wire shape unchanged)", async () => {
    const { deps, out } = makeDeps();
    await runAgentHeadless({ prompt: "go", outputFormat: "stream-json" }, deps);
    const lines = out
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const usageLines = lines.filter((l) => l.type === "token_usage");
    expect(usageLines).toHaveLength(2);
    // both events carry the standard {type, usage} shape
    expect(usageLines[0].usage).toEqual({
      input_tokens: 40,
      output_tokens: 15,
    });
    expect(usageLines[1].usage).toEqual({
      input_tokens: 100,
      output_tokens: 20,
    });
  });

  it("without persistence nothing is written (one-shot run unchanged)", async () => {
    const { deps, writes } = makeDeps();
    await runAgentHeadless({ prompt: "go", outputFormat: "text" }, deps);
    expect(writes.tokenUsage).toHaveLength(0);
    expect(writes.toolCalls).toHaveLength(0);
  });
});
