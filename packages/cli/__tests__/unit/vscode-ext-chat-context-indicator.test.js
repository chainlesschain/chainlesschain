/**
 * Persistent context-window indicator (Claude-Code parity). After each turn the
 * panel asks `cc context <id> --json` and renders a compact used/window line.
 * Covers the pure arg builder + JSON parser and the provider orchestration
 * (result event → ctxStatus post). Headless (no vscode host; injected runCliText).
 */
import { describe, it, expect, vi } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import {
  buildIntrospectArgs,
  parseContextStatus,
  contextStatusFromUsage,
} from "../../../vscode-extension/src/chat/introspect-commands.js";

describe("buildIntrospectArgs — json", () => {
  it("appends --json for context when requested, never for cost", () => {
    expect(buildIntrospectArgs("context", "s1", { json: true })).toEqual([
      "context",
      "s1",
      "--json",
    ]);
    expect(
      buildIntrospectArgs("context", "s1", {
        model: "m",
        provider: "p",
        json: true,
      }),
    ).toEqual(["context", "s1", "--model", "m", "--provider", "p", "--json"]);
    // cost ignores json (no such flag)
    expect(buildIntrospectArgs("cost", "s1", { json: true })).toEqual([
      "cost",
      "s1",
    ]);
  });
});

describe("parseContextStatus", () => {
  it("derives total/window/pct/overflow from cc context --json", () => {
    expect(
      parseContextStatus(
        JSON.stringify({ contextWindow: 200000, totalTokens: 12000 }),
      ),
    ).toEqual({ total: 12000, window: 200000, pct: 6, overflow: false });
  });

  it("flags overflow by ratio and by the overflows field", () => {
    expect(
      parseContextStatus(
        JSON.stringify({ contextWindow: 1000, totalTokens: 1500 }),
      ),
    ).toMatchObject({ pct: 150, overflow: true });
    expect(
      parseContextStatus(
        JSON.stringify({
          contextWindow: 1000,
          totalTokens: 10,
          overflows: true,
        }),
      ),
    ).toMatchObject({ overflow: true });
  });

  it("returns null for bad JSON or missing window/total", () => {
    expect(parseContextStatus("not json")).toBe(null);
    expect(parseContextStatus("")).toBe(null);
    expect(parseContextStatus(JSON.stringify({ totalTokens: 5 }))).toBe(null);
    expect(
      parseContextStatus(JSON.stringify({ contextWindow: 0, totalTokens: 5 })),
    ).toBe(null);
  });
});

describe("contextStatusFromUsage", () => {
  it("sums the last call's prompt + completion tokens against the window", () => {
    expect(
      contextStatusFromUsage(
        {
          input_tokens: 30000,
          output_tokens: 500,
          cache_read_input_tokens: 10000,
        },
        200000,
      ),
    ).toEqual({ total: 40500, window: 200000, pct: 20, overflow: false });
  });

  it("counts cache_creation tokens and flags overflow", () => {
    expect(
      contextStatusFromUsage(
        { input_tokens: 900, cache_creation_input_tokens: 200 },
        1000,
      ),
    ).toMatchObject({ total: 1100, pct: 110, overflow: true });
  });

  it("returns null on missing usage, zero totals, or a bad window", () => {
    expect(contextStatusFromUsage(null, 1000)).toBe(null);
    expect(contextStatusFromUsage({}, 1000)).toBe(null);
    expect(contextStatusFromUsage({ input_tokens: 5 }, 0)).toBe(null);
    expect(contextStatusFromUsage({ input_tokens: 5 }, NaN)).toBe(null);
  });
});

// --- provider orchestration ---

function makeMemento(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    update: (k, v) => m.set(k, v),
  };
}

function makeProvider({ runCliText, config = {} } = {}) {
  const posted = [];
  const vscode = {
    commands: { executeCommand() {} },
    window: {},
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: (k) => config[k] }),
    },
  };
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession: () => ({ running: true }), runCliText },
    state: makeMemento({}),
    getBridgeEnv: () => ({}),
  });
  provider.view = {
    webview: { postMessage: (msg) => (posted.push(msg), Promise.resolve()) },
  };
  return { provider, posted };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ChatViewProvider — context indicator refresh", () => {
  it("posts ctxStatus after a result, querying cc context --json for the session", async () => {
    const runCliText = vi.fn(async () =>
      JSON.stringify({ contextWindow: 200000, totalTokens: 12000 }),
    );
    const { provider, posted } = makeProvider({ runCliText });
    provider._handleMessage({ type: "ready" });
    const convId = provider._convs.activeId();
    const onEvent = provider._makeOnEvent(convId);
    onEvent({ type: "system", subtype: "init", session_id: "sess-1" });
    onEvent({ type: "result", subtype: "success", is_error: false });
    await tick();
    const ctx = posted.find((p) => p.kind === "ctxStatus");
    expect(ctx).toMatchObject({ total: 12000, window: 200000, pct: 6 });
    expect(runCliText.mock.calls[0][0].args).toEqual(
      expect.arrayContaining(["context", "sess-1", "--json"]),
    );
  });

  it("skips when the conversation has no session id yet", async () => {
    const runCliText = vi.fn(async () => "{}");
    const { provider, posted } = makeProvider({ runCliText });
    provider._handleMessage({ type: "ready" });
    const onEvent = provider._makeOnEvent(provider._convs.activeId());
    onEvent({ type: "result", is_error: false }); // no init → no session id
    await tick();
    expect(runCliText).not.toHaveBeenCalled();
    expect(posted.find((p) => p.kind === "ctxStatus")).toBeUndefined();
  });

  it("derives later turns locally from token_usage — ONE probe, no per-turn spawn", async () => {
    const runCliText = vi.fn(async () =>
      JSON.stringify({ contextWindow: 200000, totalTokens: 12000 }),
    );
    const { provider, posted } = makeProvider({ runCliText });
    provider._handleMessage({ type: "ready" });
    const convId = provider._convs.activeId();
    const onEvent = provider._makeOnEvent(convId);
    onEvent({ type: "system", subtype: "init", session_id: "sess-1" });
    // Turn 1: usage is already recorded, but the window is unknown → probes.
    onEvent({
      type: "token_usage",
      usage: { input_tokens: 100, output_tokens: 5 },
    });
    onEvent({ type: "result", is_error: false });
    await tick();
    expect(runCliText).toHaveBeenCalledTimes(1);
    // Turn 2: window cached → derived locally, NO second spawn.
    onEvent({
      type: "token_usage",
      usage: {
        input_tokens: 30000,
        output_tokens: 500,
        cache_read_input_tokens: 10000,
      },
    });
    onEvent({ type: "result", is_error: false });
    await tick();
    expect(runCliText).toHaveBeenCalledTimes(1);
    const last = posted.filter((p) => p.kind === "ctxStatus").pop();
    expect(last).toMatchObject({
      total: 40500,
      window: 200000,
      pct: 20,
      overflow: false,
    });
  });

  it("re-probes after an LLM reconfigure (the cached window is dropped)", async () => {
    const runCliText = vi.fn(async () =>
      JSON.stringify({ contextWindow: 200000, totalTokens: 12000 }),
    );
    const { provider } = makeProvider({ runCliText });
    provider._handleMessage({ type: "ready" });
    const convId = provider._convs.activeId();
    const onEvent = provider._makeOnEvent(convId);
    onEvent({ type: "system", subtype: "init", session_id: "sess-1" });
    onEvent({
      type: "token_usage",
      usage: { input_tokens: 100, output_tokens: 5 },
    });
    onEvent({ type: "result", is_error: false });
    await tick();
    expect(runCliText).toHaveBeenCalledTimes(1); // cached now
    provider._reloadLlmConfig(); // model may have changed → window invalid
    onEvent({
      type: "token_usage",
      usage: { input_tokens: 200, output_tokens: 5 },
    });
    onEvent({ type: "result", is_error: false });
    await tick();
    expect(runCliText).toHaveBeenCalledTimes(2);
  });

  it("still probes per turn when the provider emits no token_usage (fallback)", async () => {
    const runCliText = vi.fn(async () =>
      JSON.stringify({ contextWindow: 200000, totalTokens: 12000 }),
    );
    const { provider } = makeProvider({ runCliText });
    provider._handleMessage({ type: "ready" });
    const convId = provider._convs.activeId();
    const onEvent = provider._makeOnEvent(convId);
    onEvent({ type: "system", subtype: "init", session_id: "sess-1" });
    onEvent({ type: "result", is_error: false });
    await tick();
    onEvent({ type: "result", is_error: false });
    await tick();
    expect(runCliText).toHaveBeenCalledTimes(2); // status quo preserved
  });

  it("respects the chainlesschain.chat.contextIndicator=false kill-switch", async () => {
    const runCliText = vi.fn(async () => "{}");
    const { provider } = makeProvider({
      runCliText,
      config: { contextIndicator: false },
    });
    provider._handleMessage({ type: "ready" });
    const onEvent = provider._makeOnEvent(provider._convs.activeId());
    onEvent({ type: "system", subtype: "init", session_id: "s" });
    onEvent({ type: "result", is_error: false });
    await tick();
    expect(runCliText).not.toHaveBeenCalled();
  });
});
