/**
 * Deterministic-headless batch (gap-analysis 2026-07-11,
 * docs/CLAUDE_CODE_CLI_GAP_ANALYSIS.md P0 "确定性 Headless"):
 *  - init event manifest fields (protocol_version / session_persistence /
 *    loaded_sources / policy_digest / tools_hash)
 *  - --ephemeral (no session persistence; resume replay stays read-only)
 *  - exit-code taxonomy (max-turns 3 / cost cap 4 / model 5 / config 6)
 *  - `cc agent --capabilities` manifest builder
 */

import { describe, it, expect, vi } from "vitest";
import {
  runAgentHeadless,
  resolveHeadlessSession,
} from "../../src/runtime/headless-runner.js";
import {
  STREAM_PROTOCOL_VERSION,
  computePolicyDigest,
  computeToolsHash,
  buildLoadedSources,
  buildAgentCapabilities,
} from "../../src/lib/headless-manifest.js";
import {
  HEADLESS_EXIT_CODES,
  classifyLoopError,
  exitCodeForEndReason,
} from "../../src/lib/exit-codes.cjs";

function fakeGate() {
  return {
    setSessionPolicy: () => {},
    setConfirmer: () => {},
    decide: async () => ({ decision: "allow", via: "test", policy: "test" }),
  };
}

function makeDeps(chatFn) {
  const out = [];
  const err = [];
  return {
    deps: {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => fakeGate(),
      writeOut: (s) => out.push(s),
      writeErr: (s) => err.push(s),
      chatFn,
    },
    out,
    err,
  };
}

const replyText = (content) =>
  vi.fn(async () => ({
    message: { role: "assistant", content },
    usage: { input_tokens: 7, output_tokens: 3 },
  }));

/** In-memory session store seams + event capture. */
function makeStore(seed = {}) {
  const sessions = { ...seed };
  const events = { started: [], user: [], assistant: [] };
  return {
    events,
    deps: {
      sessionExists: (id) => Object.hasOwn(sessions, id),
      rebuildMessages: (id) => sessions[id] || [],
      startSession: (id, meta) => {
        sessions[id] = [];
        events.started.push({ id, meta });
      },
      appendUserMessage: (id, content) => events.user.push({ id, content }),
      appendAssistantMessage: (id, content) =>
        events.assistant.push({ id, content }),
      appendTokenUsage: () => {},
      appendToolCallCompact: () => {},
      appendCompactEvent: () => {},
      getLastSessionId: () => null,
      verifySession: () => ({ status: "ok" }),
    },
  };
}

describe("headless-manifest — digests + loaded sources", () => {
  it("computePolicyDigest is order/duplicate-insensitive and mode-sensitive", () => {
    const a = computePolicyDigest({
      permissionMode: "auto",
      allowedTools: ["b", "a", "a"],
      disallowedTools: ["z"],
      permissionRules: { allow: ["Read(*)"], ask: [], deny: ["Bash(rm*)"] },
    });
    const b = computePolicyDigest({
      permissionMode: "auto",
      allowedTools: ["a", "b"],
      disallowedTools: ["z"],
      permissionRules: { deny: ["Bash(rm*)"], allow: ["Read(*)"], ask: [] },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    const c = computePolicyDigest({
      permissionMode: "manual",
      allowedTools: ["a", "b"],
      disallowedTools: ["z"],
      permissionRules: { allow: ["Read(*)"], ask: [], deny: ["Bash(rm*)"] },
    });
    expect(c).not.toBe(a);
  });

  it("computeToolsHash is order-insensitive and set-sensitive", () => {
    expect(computeToolsHash(["read_file", "run_shell"])).toBe(
      computeToolsHash(["run_shell", "read_file", "read_file"]),
    );
    expect(computeToolsHash(["read_file"])).not.toBe(
      computeToolsHash(["read_file", "run_shell"]),
    );
  });

  it("buildLoadedSources reflects the kill-switch env (--bare collapses it)", () => {
    const full = buildLoadedSources({
      permissionRules: { allow: ["x"], ask: [], deny: [] },
      settingsHooks: { PreToolUse: [] },
      mcp: true,
      enabledToolNames: ["run_skill"],
      env: {},
    });
    expect(full).toEqual([
      "settings-permissions",
      "settings-hooks",
      "project-memory",
      "memory-recall",
      "skills",
      "plugins",
      "mcp",
    ]);
    const bareEnv = {
      CC_PROJECT_MEMORY: "0",
      CC_MEMORY_INJECT: "0",
      CC_SKILLS: "0",
      CC_PLUGINS: "0",
    };
    const bare = buildLoadedSources({
      permissionRules: null,
      settingsHooks: null,
      mcp: false,
      enabledToolNames: ["run_skill"],
      env: bareEnv,
    });
    expect(bare).toEqual([]);
  });

  it("buildAgentCapabilities exposes protocol, tools and exit codes", () => {
    const caps = buildAgentCapabilities();
    expect(caps.protocol_version).toBe(STREAM_PROTOCOL_VERSION);
    expect(caps.agent_tools).toContain("read_file");
    expect(caps.agent_tools).toContain("run_shell");
    expect(caps.permission_modes).toContain("bypassPermissions");
    expect(caps.output_formats).toEqual(["text", "json", "stream-json"]);
    expect(caps.exit_codes.MAX_TURNS).toBe(3);
    expect(caps.exit_codes.MAX_BUDGET).toBe(4);
    expect(caps.features.ephemeral).toBe(true);
  });
});

describe("exit-codes — taxonomy", () => {
  it("classifyLoopError: provider/transport → MODEL_ERROR, else generic", () => {
    const httpErr = Object.assign(new Error("overloaded"), { status: 429 });
    expect(classifyLoopError(httpErr)).toBe(HEADLESS_EXIT_CODES.MODEL_ERROR);
    const netErr = Object.assign(new Error("refused"), {
      code: "ECONNREFUSED",
    });
    expect(classifyLoopError(netErr)).toBe(HEADLESS_EXIT_CODES.MODEL_ERROR);
    const named = Object.assign(new Error("x"), { name: "LLMProviderError" });
    expect(classifyLoopError(named)).toBe(HEADLESS_EXIT_CODES.MODEL_ERROR);
    expect(classifyLoopError(new Error("tool broke"))).toBe(
      HEADLESS_EXIT_CODES.ERROR,
    );
    expect(classifyLoopError(null)).toBe(HEADLESS_EXIT_CODES.ERROR);
  });

  it("exitCodeForEndReason maps exhaustion reasons", () => {
    expect(exitCodeForEndReason("complete", false)).toBe(0);
    expect(exitCodeForEndReason("max_turns", true)).toBe(3);
    expect(exitCodeForEndReason("budget-exhausted", true)).toBe(3);
    expect(exitCodeForEndReason("cost-budget-exhausted", true)).toBe(4);
    expect(exitCodeForEndReason("no-response", true)).toBe(1);
  });
});

describe("resolveHeadlessSession — --ephemeral", () => {
  it("forces persistence off while keeping the resume id for replay", () => {
    const r = resolveHeadlessSession(
      { resume: "sess-A", ephemeral: true },
      {},
      "fb",
    );
    expect(r).toMatchObject({
      sessionId: "sess-A",
      resumeId: "sess-A",
      persist: false,
    });
    // Without ephemeral, the same options persist (regression guard).
    expect(resolveHeadlessSession({ resume: "sess-A" }, {}, "fb").persist).toBe(
      true,
    );
  });
});

describe("runAgentHeadless — init manifest + ephemeral + exit codes", () => {
  it("emits protocol/persistence/digest fields in the init event", async () => {
    const { deps, out } = makeDeps(replyText("hi"));
    await runAgentHeadless({ prompt: "hi", outputFormat: "stream-json" }, deps);
    const init = JSON.parse(out.join("").trim().split("\n")[0]);
    expect(init).toMatchObject({
      type: "system",
      subtype: "init",
      protocol_version: STREAM_PROTOCOL_VERSION,
      session_persistence: false,
    });
    expect(init.tools_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(init.policy_digest).toMatch(/^[0-9a-f]{16}$/);
    expect(Array.isArray(init.loaded_sources)).toBe(true);
  });

  it("--ephemeral resume: replays history but writes NOTHING to the store", async () => {
    const store = makeStore({ "sess-A": [{ role: "user", content: "q" }] });
    const { deps, out } = makeDeps(replyText("a"));
    Object.assign(deps, store.deps);

    const outcome = await runAgentHeadless(
      {
        prompt: "again",
        resume: "sess-A",
        ephemeral: true,
        outputFormat: "stream-json",
      },
      deps,
    );

    expect(outcome.exitCode).toBe(0);
    const init = JSON.parse(out.join("").trim().split("\n")[0]);
    expect(init).toMatchObject({
      resumed_from: "sess-A",
      history_messages: 1,
      session_persistence: false,
    });
    expect(store.events.started).toHaveLength(0);
    expect(store.events.user).toHaveLength(0);
    expect(store.events.assistant).toHaveLength(0);
  });

  it("max-turns exhaustion exits 3 (was 1)", async () => {
    const { deps } = makeDeps();
    deps.agentLoop = async function* () {
      yield { type: "iteration-budget-exhausted", budget: 1 };
    };
    const outcome = await runAgentHeadless({ prompt: "loop" }, deps);
    expect(outcome.isError).toBe(true);
    expect(outcome.exitCode).toBe(HEADLESS_EXIT_CODES.MAX_TURNS);
  });

  it("a provider error thrown from the loop exits 5", async () => {
    const { deps } = makeDeps();
    deps.agentLoop = async function* () {
      yield { type: "run-started" };
      throw Object.assign(new Error("upstream 500"), { status: 500 });
    };
    const outcome = await runAgentHeadless({ prompt: "x" }, deps);
    expect(outcome.exitCode).toBe(HEADLESS_EXIT_CODES.MODEL_ERROR);
  });

  it("a bad --mcp-config exits 6 (config error)", async () => {
    const { deps } = makeDeps(replyText("never"));
    deps.resolveAgentMcp = async () => {
      throw new Error("mcp config file not found: nope.json");
    };
    const outcome = await runAgentHeadless(
      { prompt: "x", mcpConfig: "nope.json" },
      deps,
    );
    expect(outcome.exitCode).toBe(HEADLESS_EXIT_CODES.CONFIG_ERROR);
  });
});
