/**
 * 用量归因 — headless runner side.
 *
 * Attributed child-loop usage (spawn_sub_agent / isolated run_skill) must:
 *  - stay OUT of the result envelope's `usage` (main-loop-only semantics
 *    unchanged),
 *  - be persisted as its OWN token_usage event carrying the attribution
 *    frame (no double count with the end-of-run main aggregate),
 *  - still flow on the stream as ordinary token_usage events.
 * Compact tool_call records ({tool, is_error, skill?, plugin?} — never args)
 * are persisted for every tool call so
 * `cc session usage --by tool|mcp|plugin` works for headless sessions too.
 *
 * The agent loop is faked via deps.agentLoop (deterministic events); every
 * store write is captured via the deps store seam — no disk, no LLM.
 */
import { describe, it, expect } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

const ATTR = {
  origin: "subagent",
  subagentId: "sub-9",
  role: "researcher",
  parentSessionId: "s-attr",
  depth: 1,
};

function fakeLoop() {
  return async function* () {
    yield { type: "run-started", runId: "r1", sessionId: "s-attr" };
    yield {
      type: "tool-executing",
      tool_use_id: "skill-call",
      tool: "run_skill",
      args: { skill_name: "csv-clean", input: "x" },
    };
    yield {
      type: "tool-result",
      tool_use_id: "skill-call",
      tool: "run_skill",
      result: { ok: 1, toolTelemetryRecord: { durationMs: 12 } },
    };
    yield {
      type: "tool-executing",
      tool_use_id: "mcp-call",
      tool: "mcp__github__search_issues",
      args: { q: "bug" },
    };
    yield {
      type: "tool-executing",
      tool_use_id: "shell-call",
      tool: "run_shell",
      args: { command: "acme-lint" },
    };
    yield {
      type: "tool-result",
      tool_use_id: "mcp-call",
      tool: "mcp__github__search_issues",
      result: { error: "rate limited" },
      error: "rate limited",
    };
    yield {
      type: "tool-result",
      tool_use_id: "shell-call",
      tool: "run_shell",
      result: {
        toolTelemetryRecord: { durationMs: 34 },
        plugin_bin: {
          plugin: "acme-tools",
          version: "2.1.0",
          bin: "acme-lint",
        },
      },
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
  const writes = {
    tokenUsage: [],
    toolCalls: [],
    llmRetries: [],
    assistant: [],
    user: [],
    events: [],
  };
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
    appendLlmRetryCompact: (id, rec) => writes.llmRetries.push({ id, rec }),
    appendEvent: (id, type, data) => writes.events.push({ id, type, data }),
    appendCompactEvent: () => {},
    appendAuthorityEvent: () => true,
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
    expect(
      r.exitCode,
      JSON.stringify({ result: r, output: out, writes }, null, 2),
    ).toBe(0);

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
      usage: {
        input_tokens: 40,
        output_tokens: 15,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      attribution: ATTR,
    });
    expect(writes.tokenUsage[1].u).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-8",
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });

    // compact tool_call records: skill hint on run_skill, error flag from
    // the tool result, never args
    expect(writes.toolCalls).toHaveLength(3);
    expect(writes.toolCalls[0].rec).toMatchObject({
      id: "skill-call",
      tool: "run_skill",
      isError: false,
      skill: "csv-clean",
      durationMs: 12,
    });
    expect(writes.toolCalls[0].rec.args).toBeUndefined();
    expect(writes.toolCalls[1].rec).toMatchObject({
      id: "mcp-call",
      tool: "mcp__github__search_issues",
      isError: true,
    });
    expect(writes.toolCalls[1].rec.durationMs).toEqual(expect.any(Number));
    expect(writes.toolCalls[1].rec.durationMs).toBeGreaterThanOrEqual(0);
    expect(writes.toolCalls[2].rec).toMatchObject({
      id: "shell-call",
      tool: "run_shell",
      isError: false,
      plugin: "acme-tools",
      pluginVersion: "2.1.0",
      durationMs: 34,
    });
    expect(
      writes.events.filter((event) => event.type === "tool_call_started"),
    ).toHaveLength(3);
  }, 15000);

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

  it("persists failed-attempt timing when a single headless run auto-retries", async () => {
    const { deps, writes } = makeDeps();
    deps.agentLoop = async function* (_messages, options) {
      options.onStreamRetry?.(
        1,
        Object.assign(new Error("secret proxy URL"), { code: "ECONNRESET" }),
        {
          durationMs: 321,
          provider: "openai",
          model: "gpt-4o",
        },
      );
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const result = await runAgentHeadless(
      {
        prompt: "go",
        outputFormat: "text",
        sessionId: "s-retry",
        persistSession: true,
      },
      deps,
    );
    expect(result.exitCode).toBe(0);
    expect(writes.llmRetries).toEqual([
      {
        id: "s-retry",
        rec: {
          attempt: 1,
          durationMs: 321,
          provider: "openai",
          model: "gpt-4o",
          reason: "connection_reset",
        },
      },
    ]);
    expect(JSON.stringify(writes.llmRetries)).not.toContain("secret");
  });

  it("persists child settlements through the synchronous hook without replay writes", async () => {
    const { deps, writes } = makeDeps();
    deps.agentLoop = async function* (_messages, options) {
      const known = {
        type: "token-usage",
        callId: "child-known-1",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        source: "subagent",
        usage: { input_tokens: 11, output_tokens: 4 },
        attribution: ATTR,
      };
      const unknown = {
        type: "model-usage-unknown",
        callId: "child-unknown-1",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        source: "subagent",
        code: "provider_usage_missing",
        attribution: ATTR,
      };
      options.onUsageSettlement(known);
      yield { ...known, ledgerPersisted: true };
      options.onUsageSettlement(unknown);
      yield { ...unknown, ledgerPersisted: true };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };

    const result = await runAgentHeadless(
      {
        prompt: "go",
        outputFormat: "json",
        sessionId: "s-child-settlement",
        persistSession: true,
      },
      deps,
    );

    expect(result.exitCode).toBe(0);
    expect(writes.tokenUsage).toHaveLength(1);
    expect(writes.tokenUsage[0].u).toMatchObject({
      callId: "child-known-1",
      attribution: ATTR,
    });
    expect(
      writes.events.filter(({ type }) => type === "model_usage_unknown"),
    ).toEqual([
      expect.objectContaining({
        id: "s-child-settlement",
        data: expect.objectContaining({
          callId: "child-unknown-1",
          code: "provider_usage_missing",
        }),
      }),
    ]);
  });
});
