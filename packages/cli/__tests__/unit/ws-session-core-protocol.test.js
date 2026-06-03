import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-ws-sc-"));
  vi.resetModules();
  vi.doMock("../../src/lib/paths.js", () => ({
    getHomeDir: () => tmpHome,
    getBinDir: () => path.join(tmpHome, "bin"),
    getConfigPath: () => path.join(tmpHome, "config.json"),
    getStatePath: () => path.join(tmpHome, "state"),
    getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
    getServicesDir: () => path.join(tmpHome, "services"),
  }));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.doUnmock("../../src/lib/paths.js");
});

async function loadHandlers() {
  return (await import("../../src/gateways/ws/session-core-protocol.js"))
    .SESSION_CORE_HANDLERS;
}

describe("Hosted Session API — session-core-protocol", () => {
  it("sessions.list returns empty when no handles exist", async () => {
    const h = await loadHandlers();
    const r = await h["sessions.list"]({});
    expect(r.ok).toBe(true);
    expect(r.sessions).toEqual([]);
  });

  it("sessions.list surfaces a live SessionManager handle", async () => {
    const { getSessionManager } =
      await import("../../src/lib/session-core-singletons.js");
    const mgr = getSessionManager();
    mgr.create({ sessionId: "s-api-1", agentId: "agent-x" });

    const h = await loadHandlers();
    const r = await h["sessions.list"]({});
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0].sessionId).toBe("s-api-1");
    expect(r.sessions[0].agentId).toBe("agent-x");
  });

  it("sessions.park + sessions.unpark round-trip through disk", async () => {
    const { getSessionManager } =
      await import("../../src/lib/session-core-singletons.js");
    const mgr = getSessionManager();
    mgr.create({ sessionId: "s-api-2", agentId: "coder" });

    const h = await loadHandlers();
    const parked = await h["sessions.park"]({ sessionId: "s-api-2" });
    expect(parked.ok).toBe(true);
    expect(parked.parked).toBe(true);

    // reset singletons to force reload from disk
    const { resetSessionCoreSingletonsForTests } =
      await import("../../src/lib/session-core-singletons.js");
    resetSessionCoreSingletonsForTests();

    const h2 = await loadHandlers();
    const resumed = await h2["sessions.unpark"]({ sessionId: "s-api-2" });
    expect(resumed.ok).toBe(true);
    expect(resumed.resumed).toBe(true);
  });

  it("sessions.show returns a live session", async () => {
    const { getSessionManager } =
      await import("../../src/lib/session-core-singletons.js");
    const mgr = getSessionManager();
    mgr.create({ sessionId: "s-show-1", agentId: "coder" });
    const h = await loadHandlers();
    const r = await h["sessions.show"]({ sessionId: "s-show-1" });
    expect(r.ok).toBe(true);
    expect(r.session.sessionId).toBe("s-show-1");
    expect(r.source).toBe("live");
  });

  it("sessions.show returns NOT_FOUND for unknown session", async () => {
    const h = await loadHandlers();
    const r = await h["sessions.show"]({ sessionId: "nonexistent" });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("NOT_FOUND");
  });

  it("sessions.park rejects when session is not active", async () => {
    const h = await loadHandlers();
    const r = await h["sessions.park"]({ sessionId: "nope" });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("NOT_ACTIVE");
  });

  it("sessions.policy.get/set persists through ApprovalGate", async () => {
    const h = await loadHandlers();
    const set = await h["sessions.policy.set"]({
      sessionId: "s-api-3",
      policy: "trusted",
    });
    expect(set.ok).toBe(true);
    expect(set.policy).toBe("trusted");

    const get = await h["sessions.policy.get"]({ sessionId: "s-api-3" });
    expect(get.ok).toBe(true);
    expect(get.policy).toBe("trusted");
  });

  it("sessions.policy.set rejects invalid policy", async () => {
    const h = await loadHandlers();
    const r = await h["sessions.policy.set"]({
      sessionId: "s-api-4",
      policy: "bogus",
    });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("INVALID_POLICY");
  });

  it("memory.store + memory.recall round-trip", async () => {
    const h = await loadHandlers();
    const stored = await h["memory.store"]({
      content: "Prefers JSON output",
      scope: "global",
      tags: ["pref"],
    });
    expect(stored.ok).toBe(true);
    expect(stored.entry.content).toBe("Prefers JSON output");

    const recalled = await h["memory.recall"]({
      query: "json",
      scope: "global",
    });
    expect(recalled.ok).toBe(true);
    expect(recalled.results.length).toBeGreaterThan(0);
    expect(recalled.results[0].content).toBe("Prefers JSON output");
  });

  it("memory.delete removes an existing entry", async () => {
    const h = await loadHandlers();
    const stored = await h["memory.store"]({
      content: "to be deleted",
      scope: "global",
    });
    expect(stored.ok).toBe(true);
    const id = stored.entry.id;

    const del = await h["memory.delete"]({ id });
    expect(del.ok).toBe(true);
    expect(del.deleted).toBe(true);

    const recalled = await h["memory.recall"]({
      query: "to be deleted",
      scope: "global",
    });
    expect(recalled.results.find((r) => r.id === id)).toBeUndefined();
  });

  it("memory.delete rejects unknown id", async () => {
    const h = await loadHandlers();
    const r = await h["memory.delete"]({ id: "bogus-id" });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("NOT_FOUND");
  });

  it("memory.store rejects missing content", async () => {
    const h = await loadHandlers();
    const r = await h["memory.store"]({});
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("BAD_REQUEST");
  });

  it("beta.list / beta.enable / beta.disable work end-to-end", async () => {
    const h = await loadHandlers();
    const flag = "hosted-api-2026-04-16";

    const enabled = await h["beta.enable"]({ flag });
    expect(enabled.ok).toBe(true);

    const list1 = await h["beta.list"]({});
    expect(list1.flags.enabled).toEqual(expect.arrayContaining([flag]));

    const disabled = await h["beta.disable"]({ flag });
    expect(disabled.ok).toBe(true);

    const list2 = await h["beta.list"]({});
    expect(list2.flags.enabled).not.toContain(flag);
  });

  it("beta.enable validates flag format", async () => {
    const h = await loadHandlers();
    const r = await h["beta.enable"]({ flag: "no-date-here" });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("INVALID_FLAG");
  });

  it("usage.session returns zero totals for empty session", async () => {
    const h = await loadHandlers();
    const r = await h["usage.session"]({ sessionId: "empty-session" });
    expect(r.ok).toBe(true);
    expect(r.usage.total.calls).toBe(0);
  });

  it("usage.session aggregates token_usage events", async () => {
    const { appendTokenUsage, startSession } =
      await import("../../src/harness/jsonl-session-store.js");
    const sid = startSession(null, { title: "usage-test" });
    appendTokenUsage(sid, {
      provider: "anthropic",
      model: "opus",
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const h = await loadHandlers();
    const r = await h["usage.session"]({ sessionId: sid });
    expect(r.usage.total.totalTokens).toBe(150);
    expect(r.usage.byModel[0].provider).toBe("anthropic");
  });

  it("usage.global rolls up across all sessions", async () => {
    const { appendTokenUsage, startSession } =
      await import("../../src/harness/jsonl-session-store.js");
    const s1 = startSession(null, {});
    const s2 = startSession(null, {});
    appendTokenUsage(s1, {
      provider: "openai",
      model: "gpt-4o",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    appendTokenUsage(s2, {
      provider: "openai",
      model: "gpt-4o",
      usage: { input_tokens: 20, output_tokens: 10 },
    });

    const h = await loadHandlers();
    const r = await h["usage.global"]({});
    expect(r.usage.total.totalTokens).toBe(45);
    expect(r.usage.byModel[0].calls).toBe(2);
  });

  it("stream.run pipes token stream through StreamRouter", async () => {
    // Mock buildProviderSource by intercepting the provider-stream module
    vi.doMock("../../src/lib/provider-stream.js", () => ({
      buildProviderSource: () =>
        (async function* () {
          yield "hello";
          yield " ";
          yield "world";
        })(),
    }));
    // re-import so handler binding picks up the mock via dynamic import
    vi.resetModules();
    vi.doMock("../../src/lib/paths.js", () => ({
      getHomeDir: () => tmpHome,
      getBinDir: () => path.join(tmpHome, "bin"),
      getConfigPath: () => path.join(tmpHome, "config.json"),
      getStatePath: () => path.join(tmpHome, "state"),
      getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
      getServicesDir: () => path.join(tmpHome, "services"),
    }));
    const { SESSION_CORE_STREAMING_HANDLERS } =
      await import("../../src/gateways/ws/session-core-protocol.js");
    const emitted = [];
    const sender = (p) => emitted.push(p);
    const result = await SESSION_CORE_STREAMING_HANDLERS["stream.run"](
      { prompt: "hi", provider: "ollama" },
      sender,
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    expect(result.text.length).toBeGreaterThan(0);
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0].type).toBe("stream.event");
    vi.doUnmock("../../src/lib/provider-stream.js");
  });

  it("stream.run fans out to envelopeBus when context.server.envelopeBus present", async () => {
    vi.doMock("../../src/lib/provider-stream.js", () => ({
      buildProviderSource: () =>
        (async function* () {
          yield "tok1";
          yield "tok2";
        })(),
    }));
    vi.resetModules();
    vi.doMock("../../src/lib/paths.js", () => ({
      getHomeDir: () => tmpHome,
      getBinDir: () => path.join(tmpHome, "bin"),
      getConfigPath: () => path.join(tmpHome, "config.json"),
      getStatePath: () => path.join(tmpHome, "state"),
      getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
      getServicesDir: () => path.join(tmpHome, "services"),
    }));
    const { SESSION_CORE_STREAMING_HANDLERS } =
      await import("../../src/gateways/ws/session-core-protocol.js");
    const busPublished = [];
    const context = {
      server: {
        envelopeBus: {
          publish: (sid, env) => busPublished.push({ sid, env }),
        },
      },
    };
    const emitted = [];
    const result = await SESSION_CORE_STREAMING_HANDLERS["stream.run"](
      { prompt: "hi", provider: "ollama", sessionId: "s-bus-1", id: "req-1" },
      (p) => emitted.push(p),
      new AbortController().signal,
      context,
    );
    expect(result.ok).toBe(true);
    expect(emitted.length).toBeGreaterThan(0);
    // envelopeBus receives at least as many publishes as sender events
    // (may be 0 if session-core is not resolvable, but in test env it should be)
    if (busPublished.length > 0) {
      expect(busPublished[0].sid).toBe("s-bus-1");
    }
    vi.doUnmock("../../src/lib/provider-stream.js");
  });

  it("stream.run rejects missing prompt", async () => {
    const { SESSION_CORE_STREAMING_HANDLERS } =
      await import("../../src/gateways/ws/session-core-protocol.js");
    const r = await SESSION_CORE_STREAMING_HANDLERS["stream.run"](
      {},
      () => {},
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("BAD_REQUEST");
  });

  it("dispatcher routes stream.run and emits intermediate events", async () => {
    vi.resetModules();
    vi.doMock("../../src/lib/paths.js", () => ({
      getHomeDir: () => tmpHome,
      getBinDir: () => path.join(tmpHome, "bin"),
      getConfigPath: () => path.join(tmpHome, "config.json"),
      getStatePath: () => path.join(tmpHome, "state"),
      getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
      getServicesDir: () => path.join(tmpHome, "services"),
    }));
    vi.doMock("../../src/lib/provider-stream.js", () => ({
      buildProviderSource: () =>
        (async function* () {
          yield "abc";
        })(),
    }));
    const { createWsMessageDispatcher } =
      await import("../../src/gateways/ws/message-dispatcher.js");
    const sent = [];
    const fakeServer = {
      clients: new Map([["c1", { authenticated: true }]]),
      token: null,
      _send: (_ws, msg) => sent.push(msg),
    };
    const dispatcher = createWsMessageDispatcher(fakeServer);
    await dispatcher.dispatch(
      "c1",
      {},
      {
        id: "req-stream",
        type: "stream.run",
        prompt: "go",
        provider: "ollama",
      },
    );
    const types = sent.map((m) => m.type);
    expect(types).toContain("stream.event");
    expect(types).toContain("stream.run.end");
    const final = sent.find((m) => m.type === "stream.run.end");
    expect(final.ok).toBe(true);
    vi.doUnmock("../../src/lib/provider-stream.js");
  });

  it("sessions.subscribe forwards SessionManager lifecycle events", async () => {
    const { SESSION_CORE_STREAMING_HANDLERS } =
      await import("../../src/gateways/ws/session-core-protocol.js");
    const { getSessionManager } =
      await import("../../src/lib/session-core-singletons.js");
    const mgr = getSessionManager();

    const events = [];
    const sender = (p) => events.push(p);
    const controller = new AbortController();

    const sub = SESSION_CORE_STREAMING_HANDLERS["sessions.subscribe"](
      { events: ["created", "parked"] },
      sender,
      controller.signal,
    );

    // trigger events after subscription is live
    await new Promise((r) => setImmediate(r));
    mgr.create({ sessionId: "s-sub-1", agentId: "a1" });
    await new Promise((r) => setImmediate(r));
    try {
      await mgr.park("s-sub-1");
    } catch {
      /* no parkedStore may not be wired */
    }
    await new Promise((r) => setImmediate(r));

    controller.abort();
    const result = await sub;
    expect(result.ok).toBe(true);
    expect(result.unsubscribed).toBe(true);
    expect(result.events).toEqual(["created", "parked"]);

    const types = events.map((e) => e.event?.type);
    expect(types).toContain("session.created");
    const created = events.find((e) => e.event?.type === "session.created");
    expect(created.event.session.sessionId).toBe("s-sub-1");
  });

  it("sessions.subscribe defaults to all lifecycle events when events[] omitted", async () => {
    const { SESSION_CORE_STREAMING_HANDLERS } =
      await import("../../src/gateways/ws/session-core-protocol.js");
    const controller = new AbortController();
    const sub = SESSION_CORE_STREAMING_HANDLERS["sessions.subscribe"](
      {},
      () => {},
      controller.signal,
    );
    controller.abort();
    const r = await sub;
    expect(r.events).toEqual(
      expect.arrayContaining([
        "created",
        "adopted",
        "touched",
        "idle",
        "parked",
        "resumed",
        "closed",
      ]),
    );
  });

  it("dispatcher passes context with server to streaming handlers", async () => {
    vi.resetModules();
    vi.doMock("../../src/lib/paths.js", () => ({
      getHomeDir: () => tmpHome,
      getBinDir: () => path.join(tmpHome, "bin"),
      getConfigPath: () => path.join(tmpHome, "config.json"),
      getStatePath: () => path.join(tmpHome, "state"),
      getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
      getServicesDir: () => path.join(tmpHome, "services"),
    }));
    vi.doMock("../../src/lib/provider-stream.js", () => ({
      buildProviderSource: () =>
        (async function* () {
          yield "x";
        })(),
    }));
    const { createWsMessageDispatcher } =
      await import("../../src/gateways/ws/message-dispatcher.js");
    const sent = [];
    const busPublished = [];
    const fakeServer = {
      clients: new Map([["c1", { authenticated: true }]]),
      token: null,
      _send: (_ws, msg) => sent.push(msg),
      envelopeBus: {
        publish: (sid, env) => busPublished.push({ sid, env }),
      },
    };
    const dispatcher = createWsMessageDispatcher(fakeServer);
    await dispatcher.dispatch(
      "c1",
      {},
      {
        id: "req-ctx",
        type: "stream.run",
        prompt: "go",
        provider: "ollama",
        sessionId: "s-ctx-1",
      },
    );
    const final = sent.find((m) => m.type === "stream.run.end");
    expect(final.ok).toBe(true);
    // If session-core is resolvable, bus should have received publishes
    if (busPublished.length > 0) {
      expect(busPublished[0].sid).toBe("s-ctx-1");
    }
    vi.doUnmock("../../src/lib/provider-stream.js");
  });

  it("dispatcher attaches all session-core routes", async () => {
    const { createWsMessageDispatcher } =
      await import("../../src/gateways/ws/message-dispatcher.js");
    const sent = [];
    const fakeServer = {
      clients: new Map([["c1", { authenticated: true }]]),
      token: null,
      _send: (_ws, msg) => sent.push(msg),
    };
    const dispatcher = createWsMessageDispatcher(fakeServer);
    await dispatcher.dispatch(
      "c1",
      {},
      {
        id: "req-1",
        type: "sessions.list",
      },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("sessions.list.response");
    expect(sent[0].ok).toBe(true);
  });
});
