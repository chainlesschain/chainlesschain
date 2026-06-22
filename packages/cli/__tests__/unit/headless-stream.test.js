/**
 * Unit tests for the streaming-input headless runner (--input-format stream-json).
 * The agent loop, bootstrap, approval gate, and stdin are all injected, so the
 * multi-turn orchestration is tested without a real model, DB, or pipe.
 */

import { describe, it, expect, vi } from "vitest";
import {
  parseInputEvent,
  readJsonLines,
  runAgentHeadlessStream,
} from "../../src/runtime/headless-stream.js";

describe("parseInputEvent", () => {
  it("returns null for blank lines", () => {
    expect(parseInputEvent("")).toBeNull();
    expect(parseInputEvent("   ")).toBeNull();
  });

  it("flags invalid JSON", () => {
    const r = parseInputEvent("{not json");
    expect(r.error).toMatch(/invalid JSON/);
  });

  it("parses {type:user, message:{content:'..'}}", () => {
    expect(
      parseInputEvent('{"type":"user","message":{"content":"hi"}}'),
    ).toEqual({
      text: "hi",
    });
  });

  it("parses content blocks array", () => {
    const line =
      '{"type":"user","message":{"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}}';
    expect(parseInputEvent(line)).toEqual({ text: "ab" });
  });

  it("parses shorthand {text} and {prompt} and {role,content}", () => {
    expect(parseInputEvent('{"text":"x"}')).toEqual({ text: "x" });
    expect(parseInputEvent('{"prompt":"y"}')).toEqual({ text: "y" });
    expect(parseInputEvent('{"role":"user","content":"z"}')).toEqual({
      text: "z",
    });
  });

  it("returns null when content is empty/whitespace", () => {
    expect(parseInputEvent('{"text":"   "}')).toBeNull();
  });
});

describe("readJsonLines", () => {
  async function* src(...chunks) {
    for (const c of chunks) yield c;
  }
  it("splits a single chunk on newlines", async () => {
    const out = [];
    for await (const l of readJsonLines(src("a\nb\nc\n"))) out.push(l);
    expect(out).toEqual(["a", "b", "c"]);
  });
  it("reassembles lines spanning chunk boundaries", async () => {
    const out = [];
    for await (const l of readJsonLines(src("he", "llo\nwor", "ld\n")))
      out.push(l);
    expect(out).toEqual(["hello", "world"]);
  });
  it("flushes a trailing line with no final newline", async () => {
    const out = [];
    for await (const l of readJsonLines(src("a\nb"))) out.push(l);
    expect(out).toEqual(["a", "b"]);
  });
  it("reassembles a multi-byte UTF-8 char split across Buffer chunks (no mojibake)", async () => {
    // process.stdin yields Buffers; a 3-byte Chinese char split at a chunk
    // boundary must not corrupt into U+FFFD. `你` = bytes 9..11 of this line;
    // cut=10 splits it mid-character.
    const line = Buffer.from('{"text":"你好"}\n', "utf-8");
    const a = line.subarray(0, 10);
    const b = line.subarray(10);
    const out = [];
    for await (const l of readJsonLines(src(a, b))) out.push(l);
    expect(out).toEqual(['{"text":"你好"}']);
  });
});

describe("runAgentHeadlessStream", () => {
  const baseDeps = (over = {}) => {
    const lines = [];
    return {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: (s) => lines.push(s),
      writeErr: () => {},
      _lines: lines,
      ...over,
    };
  };

  async function* input(...jsonObjs) {
    yield jsonObjs.map((o) => JSON.stringify(o)).join("\n") + "\n";
  }

  const parseEmitted = (lines) =>
    lines
      .join("")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));

  it("runs one turn per event, emitting init + per-turn result + end", async () => {
    const seen = [];
    const agentLoop = async function* (messages) {
      seen.push(messages.map((m) => m.role));
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      yield { type: "response-complete", content: "reply:" + lastUser.content };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input(
        { type: "user", message: { content: "first" } },
        { type: "user", text: "second" },
      ),
    });

    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false },
      deps,
    );

    const events = parseEmitted(deps._lines);
    expect(events[0]).toMatchObject({
      type: "system",
      subtype: "init",
      input_format: "stream-json",
    });
    const results = events.filter((e) => e.type === "result");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      turn: 1,
      subtype: "success",
      result: "reply:first",
    });
    expect(results[1]).toMatchObject({
      turn: 2,
      subtype: "success",
      result: "reply:second",
    });
    expect(events.at(-1)).toMatchObject({
      type: "system",
      subtype: "end",
      turns: 2,
    });
    expect(outcome).toEqual({ exitCode: 0, turns: 2 });
  });

  it("threads autoCheckpoint into the loop options, keyed by sessionId", async () => {
    const captured = [];
    const agentLoop = async function* (_messages, loopOptions) {
      captured.push(loopOptions);
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
    });
    await runAgentHeadlessStream(
      { expandFileRefs: false, autoCheckpoint: true, sessionId: "sess-x" },
      deps,
    );
    expect(captured[0].autoCheckpoint).toBe(true);
    // agent-core falls back to sessionId, so the panel can `cc checkpoint
    // list -s <sessionId>` to find these snapshots.
    expect(captured[0].checkpointSession).toBe("sess-x");
  });

  it("auto-checkpoint stays OFF when not requested (no behavior change)", async () => {
    const captured = [];
    const agentLoop = async function* (_messages, loopOptions) {
      captured.push(loopOptions);
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);
    expect(captured[0].autoCheckpoint).toBe(false);
  });

  it("carries conversation history across turns", async () => {
    const seen = [];
    const agentLoop = async function* (messages) {
      seen.push(messages.map((m) => m.role));
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ text: "one" }, { text: "two" }),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);

    // Turn 1: [system, user]. Turn 2: prior assistant + new user appended.
    expect(seen[0]).toEqual(["system", "user"]);
    expect(seen[1]).toEqual(["system", "user", "assistant", "user"]);
  });

  it("emits an error result for an invalid JSON line and keeps going", async () => {
    const agentLoop = async function* () {
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    async function* rawInput() {
      yield '{bad json\n{"text":"good"}\n';
    }
    const deps = baseDeps({ agentLoop, input: rawInput() });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false },
      deps,
    );

    const events = parseEmitted(deps._lines);
    const errors = events.filter((e) => e.type === "result" && e.is_error);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/invalid JSON/);
    // the good line still produced a successful turn
    expect(
      events.some((e) => e.type === "result" && e.subtype === "success"),
    ).toBe(true);
    expect(outcome.exitCode).toBe(1); // a parse error → non-zero exit
  });

  it("reports max_turns when a turn exhausts its iteration budget", async () => {
    const agentLoop = async function* () {
      yield { type: "iteration-budget-exhausted", budget: 1 };
      yield { type: "run-ended", reason: "budget-exhausted" };
    };
    const deps = baseDeps({ agentLoop, input: input({ text: "go" }) });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, maxTurns: 1 },
      deps,
    );
    const events = parseEmitted(deps._lines);
    const result = events.find((e) => e.type === "result");
    expect(result).toMatchObject({
      subtype: "error_max_turns",
      is_error: true,
    });
    expect(outcome.exitCode).toBe(1);
  });

  it("expands @file refs in a streamed user event when enabled", async () => {
    const agentLoop = async function* (messages) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      yield { type: "response-complete", content: lastUser.content };
      yield { type: "run-ended", reason: "complete" };
    };
    const expandFileRefs = vi.fn(() => ({
      prompt: "look @x.js\n<file>injected</file>",
      refs: [{ rel: "x.js" }],
      warnings: [],
    }));
    const deps = baseDeps({
      agentLoop,
      expandFileRefs,
      input: input({ text: "look @x.js" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(expandFileRefs).toHaveBeenCalledOnce();
    const events = parseEmitted(deps._lines);
    const result = events.find((e) => e.type === "result");
    expect(result.result).toContain("injected");
  });
});

describe("runAgentHeadlessStream — custom slash-command macros (panel parity)", () => {
  const baseDeps = (over = {}) => {
    const lines = [];
    return {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: (s) => lines.push(s),
      writeErr: () => {},
      _lines: lines,
      ...over,
    };
  };
  async function* input(...objs) {
    yield objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
  }
  const captureUser = () => {
    const seen = [];
    const opts = [];
    return {
      seen,
      opts,
      agentLoop: async function* (messages, options) {
        seen.push(
          [...messages].reverse().find((m) => m.role === "user").content,
        );
        opts.push(options);
        yield { type: "response-complete", content: "ok" };
        yield { type: "run-ended", reason: "complete" };
      },
    };
  };
  const matchedMacro = (over = {}) => ({
    matched: true,
    promptText: "command body",
    warnings: [],
    name: "c",
    scope: "project",
    model: null,
    allowedTools: null,
    ...over,
  });

  it("expands a resolved /name macro and skips the @file pass for that turn", async () => {
    const { seen, agentLoop } = captureUser();
    const resolveSlashMacro = vi.fn(async (text) => ({
      matched: true,
      promptText: "EXPANDED: review the diff",
      warnings: [],
      name: "git:review",
      scope: "project",
    }));
    const expandFileRefs = vi.fn(async (p) => ({
      prompt: p + " [@]",
      warnings: [],
    }));
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro,
      expandFileRefs,
      input: input({ type: "user", text: "/git:review HEAD" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(resolveSlashMacro).toHaveBeenCalledOnce();
    expect(seen[0]).toBe("EXPANDED: review the diff"); // expanded, no @file suffix
    expect(expandFileRefs).not.toHaveBeenCalled();
  });

  it("leaves a non-slash turn untouched and still runs @file expansion", async () => {
    const { seen, agentLoop } = captureUser();
    const resolveSlashMacro = vi.fn();
    const expandFileRefs = vi.fn(async (p) => ({
      prompt: p + " [@]",
      warnings: [],
    }));
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro,
      expandFileRefs,
      input: input({ type: "user", text: "plain question" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(resolveSlashMacro).not.toHaveBeenCalled(); // not a /token
    expect(seen[0]).toBe("plain question [@]");
  });

  it("slashMacros:false disables expansion (literal /name reaches the loop)", async () => {
    const { seen, agentLoop } = captureUser();
    const resolveSlashMacro = vi.fn();
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro,
      expandFileRefs: async (p) => ({ prompt: p, warnings: [] }),
      input: input({ type: "user", text: "/git:review" }),
    });
    await runAgentHeadlessStream({ slashMacros: false }, deps);
    expect(resolveSlashMacro).not.toHaveBeenCalled();
    expect(seen[0]).toBe("/git:review");
  });

  it("an unmatched /token falls through to @file expansion", async () => {
    const { seen, agentLoop } = captureUser();
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro: async () => ({
        matched: false,
        promptText: "/etc/hosts",
        warnings: [],
      }),
      expandFileRefs: async (p) => ({ prompt: p + " [@]", warnings: [] }),
      input: input({ type: "user", text: "/etc/hosts is broken" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(seen[0]).toBe("/etc/hosts is broken [@]");
  });

  it("applies a command's model: frontmatter to that turn's loopOptions", async () => {
    const { opts, agentLoop } = captureUser();
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro: async () => matchedMacro({ model: "claude-opus-4-8" }),
      input: input({ type: "user", text: "/deploy" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(opts[0].model).toBe("claude-opus-4-8");
  });

  it("applies a command's allowed-tools: frontmatter to that turn's loopOptions", async () => {
    const { opts, agentLoop } = captureUser();
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro: async () =>
        matchedMacro({ allowedTools: "read_file, search_files" }),
      input: input({ type: "user", text: "/audit" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(opts[0].enabledToolNames).toEqual(["read_file", "search_files"]);
  });

  it("a non-frontmatter turn keeps the base model/tools (no override)", async () => {
    const { opts, agentLoop } = captureUser();
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro: async () => matchedMacro(), // matched, no model/tools
      input: input({ type: "user", text: "/plain" }),
    });
    await runAgentHeadlessStream({ model: "base-model" }, deps);
    expect(opts[0].model).toBe("base-model"); // unchanged
    expect(opts[0].enabledToolNames).toBeNull(); // base (no allow-list)
  });
});
