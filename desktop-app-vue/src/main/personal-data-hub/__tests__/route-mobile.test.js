/**
 * route-mobile dispatcher unit tests (Phase 14.1.1 follow-up).
 *
 * Verifies the kebab-case → hub-method mapping + Android-envelope wrapping
 * for the 21 methods routeMobileCommand can hit from Android P2P.
 *
 * `hubWiring.getHub()` is mocked via the module's exported `_DISPATCH` table
 * — we call dispatch functions directly against a hand-built fake hub so the
 * real LocalVault / LLMManager singletons are never touched.
 */

import { describe, it, expect } from "vitest";
import { _DISPATCH, dispatchPersonalDataHubMethod } from "../route-mobile.js";

// Build a minimal fake hub matching the surface route-mobile expects. Each
// stub records its last call so tests can assert params were forwarded.
function makeFakeHub(overrides = {}) {
  const calls = {};
  const fake = {
    engine: {
      ask: async (q, opts) => ({ answer: `A:${q}`, opts, isLocal: true }),
    },
    vault: {
      db: {},
      schemaVersion: () => 7,
      stats: () => ({ events: 100, persons: 10 }),
      queryEvents: (filter) => {
        calls.queryEvents = filter;
        return [
          { id: "e1", subtype: "order", source: "taobao", ingestedAt: 1000 },
        ];
      },
      queryAudit: (filter) => {
        calls.queryAudit = filter;
        return [{ at: 100, action: "ingest" }];
      },
    },
    registry: {
      list: () => [{ name: "email-imap", version: "1.0", capabilities: [] }],
      syncAdapter: async (name, options) => {
        calls.syncAdapter = { name, options };
        return { adapter: name, ingested: 5 };
      },
      syncAll: async (options) => {
        calls.syncAll = { options };
        return [
          { adapter: "a", ingested: 1 },
          { adapter: "b", ingested: 2 },
        ];
      },
      unregister: (name) => {
        calls.unregister = name;
        return true;
      },
    },
    llm: { name: "ollama:qwen", isLocal: true },
    kgSink: {},
    ragSink: null,
    hubDir: "/fake/.chainlesschain/hub",
    registerMockAdapter: ({ name, count, seed }) => {
      calls.registerMock = { name, count, seed };
      return { name, version: "1.0", capabilities: [] };
    },
    eventDetail: (id) => ({
      event: { id, subtype: "order", source: "x", ingestedAt: 1 },
    }),
    testEmailAuth: async ({ account }) => {
      calls.testEmailAuth = account;
      return { ok: true };
    },
    registerEmailAdapter: async ({ account, opts }) => {
      calls.registerEmail = { account, opts };
      return { name: "email-imap@" + account.email, version: "1.0" };
    },
    unregisterEmailAdapter: async (email) => {
      calls.unregisterEmail = email;
      return { ok: true, removed: email };
    },
    listEmailAccounts: () => [
      { email: "me@qq.com", provider: "qq", registeredAt: 1 },
    ],
    registerAlipayAdapter: async ({ account, opts }) => {
      calls.registerAlipay = { account, opts };
      return { name: "alipay@" + account.email, version: "1.0" };
    },
    unregisterAlipayAdapter: async (email) => {
      calls.unregisterAlipay = email;
      return { ok: true, removed: email };
    },
    listAlipayAccounts: () => [
      { email: "a@b.com", hasZipPassword: true, registeredAt: 2 },
    ],
    importAlipayBill: async (p) => {
      calls.importAlipayBill = p;
      return { adapter: "alipay-bill", ingested: 500 };
    },
    _calls: calls,
    ...overrides,
  };
  return fake;
}

describe("route-mobile DISPATCH table", () => {
  it("ask propagates question + options and surfaces engine missing", async () => {
    const hub = makeFakeHub();
    const r = await _DISPATCH.ask(hub, {
      question: "天气",
      options: { topK: 3 },
    });
    expect(r.answer).toBe("A:天气");
    expect(r.opts.topK).toBe(3);

    const noEngine = makeFakeHub({ engine: null });
    await expect(_DISPATCH.ask(noEngine, { question: "x" })).rejects.toThrow(
      /Analysis engine unavailable/,
    );
  });

  it("stats returns vault + adapters + hubDir + llm summary", async () => {
    const hub = makeFakeHub();
    const r = await _DISPATCH.stats(hub);
    expect(r.vault.events).toBe(100);
    expect(r.adapters[0].name).toBe("email-imap");
    expect(r.hubDir).toBe("/fake/.chainlesschain/hub");
    expect(r.llm.name).toBe("ollama:qwen");
    expect(r.llm.isLocal).toBe(true);
  });

  it("health reports vault.ok + kg/rag sink state + llm fallback", async () => {
    const hub = makeFakeHub();
    const r = await _DISPATCH.health(hub);
    expect(r.vault.ok).toBe(true);
    expect(r.vault.schemaVersion).toBe(7);
    expect(r.kgSink.ok).toBe(true);
    expect(r.ragSink.ok).toBe(false); // ragSink: null in fake

    const noLlm = makeFakeHub({ llm: null });
    const r2 = await _DISPATCH.health(noLlm);
    expect(r2.llm.ok).toBe(false);
    expect(r2.llm.reason).toMatch(/unavailable/i);
  });

  it("list-adapters wraps in AdaptersResponse envelope (matches Android model)", async () => {
    const hub = makeFakeHub();
    const r = await _DISPATCH["list-adapters"](hub);
    expect(r).toHaveProperty("adapters");
    expect(r.adapters).toBeInstanceOf(Array);
    expect(r.adapters[0].name).toBe("email-imap");
  });

  it("sync-adapter forwards name + options", async () => {
    const hub = makeFakeHub();
    await _DISPATCH["sync-adapter"](hub, {
      name: "email-imap",
      options: { since: 100 },
    });
    expect(hub._calls.syncAdapter).toEqual({
      name: "email-imap",
      options: { since: 100 },
    });
  });

  it("sync-all wraps array result in SyncReportList envelope", async () => {
    const hub = makeFakeHub();
    const r = await _DISPATCH["sync-all"](hub, {});
    expect(r).toHaveProperty("reports");
    expect(r.reports).toHaveLength(2);
  });

  it("query-events wraps in EventsResponse envelope and forwards all filters", async () => {
    const hub = makeFakeHub();
    const r = await _DISPATCH["query-events"](hub, {
      subtype: "order",
      since: 100,
      until: 200,
      actor: "x",
      adapter: "taobao",
      limit: 50,
    });
    expect(r).toHaveProperty("events");
    expect(r.events).toHaveLength(1);
    expect(hub._calls.queryEvents).toEqual({
      subtype: "order",
      since: 100,
      until: 200,
      actor: "x",
      adapter: "taobao",
      limit: 50,
    });
  });

  it("recent-audit wraps in AuditRowsResponse envelope", async () => {
    const hub = makeFakeHub();
    const r = await _DISPATCH["recent-audit"](hub, {
      action: "ingest",
      limit: 20,
    });
    expect(r).toHaveProperty("rows");
    expect(r.rows).toHaveLength(1);
    expect(hub._calls.queryAudit.action).toBe("ingest");
  });

  it("register-email forwards account + opts to registerEmailAdapter", async () => {
    const hub = makeFakeHub();
    const account = {
      provider: "qq",
      email: "me@qq.com",
      authCode: "AUTHCODE16CHARS!",
    };
    await _DISPATCH["register-email"](hub, { account, opts: { foo: 1 } });
    expect(hub._calls.registerEmail.account.email).toBe("me@qq.com");
    expect(hub._calls.registerEmail.opts.foo).toBe(1);
  });

  it("list-email-accounts wraps in EmailAccountsResponse envelope", async () => {
    const hub = makeFakeHub();
    const r = await _DISPATCH["list-email-accounts"](hub);
    expect(r).toHaveProperty("accounts");
    expect(r.accounts[0].email).toBe("me@qq.com");
  });

  it("list-alipay-accounts wraps in AlipayAccountsResponse envelope", async () => {
    const hub = makeFakeHub();
    const r = await _DISPATCH["list-alipay-accounts"](hub);
    expect(r).toHaveProperty("accounts");
    expect(r.accounts[0].email).toBe("a@b.com");
  });

  it("unregister returns ok + removed name (Android UnregisterResponse)", async () => {
    const hub = makeFakeHub();
    const r = await _DISPATCH.unregister(hub, { name: "mock" });
    expect(r.ok).toBe(true);
    expect(r.removed).toBe("mock");
  });

  it("stream methods require ctx.sendEventToPeer (mobile-only entry)", async () => {
    const hub = makeFakeHub();
    await expect(_DISPATCH["sync-adapter-stream"](hub, { name: "x" }, {})).rejects.toThrow(
      /sendEventToPeer/,
    );
    await expect(_DISPATCH["sync-all-stream"](hub, {}, {})).rejects.toThrow(
      /sendEventToPeer/,
    );
  });
});

// ==================== Phase 14.3 streaming wiring ====================

describe("sync-adapter-stream wiring", () => {
  it("returns streamId + name immediately, runs sync in background", async () => {
    const hub = makeFakeHub();
    // Track when sync actually completes vs when streamId is returned
    let syncResolve;
    const syncPromise = new Promise((resolve) => { syncResolve = resolve; });
    hub.registry.syncAdapter = async (name) => {
      await syncPromise; // block until test resolves
      return { adapter: name, ingested: 42, durationMs: 1000 };
    };

    const events = [];
    const ctx = {
      sendEventToPeer: (method, params) => events.push({ method, params }),
    };

    const ret = await _DISPATCH["sync-adapter-stream"](
      hub,
      { name: "email-imap" },
      ctx,
    );
    expect(ret.streamId).toMatch(/^pdh-sa-/);
    expect(ret.name).toBe("email-imap");
    // sync hasn't resolved yet — no done event sent
    expect(events.find((e) => e.params.kind === "done")).toBeUndefined();

    // Now let sync finish
    syncResolve();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const doneEvent = events.find((e) => e.params.kind === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent.method).toBe("personal-data-hub.sync.progress");
    expect(doneEvent.params.adapter).toBe("email-imap");
    expect(doneEvent.params.report.ingested).toBe(42);
  });

  it("forwards onSyncEvent fires to sendEventToPeer during sync", async () => {
    const hub = makeFakeHub();
    let capturedHook = null;
    hub.registry.syncAdapter = async (name) => {
      // Simulate registry firing mid-sync events
      if (capturedHook) {
        capturedHook({ kind: "connecting", adapter: name });
        capturedHook({
          kind: "fetching",
          adapter: name,
          partition: "INBOX",
          detail: { uidsScanned: 100 },
        });
      }
      return { adapter: name, ingested: 10 };
    };
    // Replace the onSyncEvent setter to capture what route-mobile installs.
    Object.defineProperty(hub.registry, "onSyncEvent", {
      get() { return capturedHook; },
      set(v) { capturedHook = v; },
      configurable: true,
    });

    const events = [];
    const ctx = {
      sendEventToPeer: (method, params) => events.push({ method, params }),
    };

    await _DISPATCH["sync-adapter-stream"](hub, { name: "email-imap" }, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Three events total: connecting, fetching, done
    expect(events.map((e) => e.params.kind)).toEqual([
      "connecting",
      "fetching",
      "done",
    ]);
    expect(events[1].params.partition).toBe("INBOX");
    expect(events[1].params.detail.uidsScanned).toBe(100);
  });

  it("sync failure emits error kind event with message", async () => {
    const hub = makeFakeHub();
    hub.registry.syncAdapter = async () => {
      throw new Error("IMAP auth failed");
    };

    const events = [];
    const ctx = {
      sendEventToPeer: (method, params) => events.push({ method, params }),
    };

    await _DISPATCH["sync-adapter-stream"](hub, { name: "email-imap" }, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const errorEvent = events.find((e) => e.params.kind === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.params.adapter).toBe("email-imap");
    expect(errorEvent.params.message).toMatch(/IMAP auth failed/);
  });

  it("sync-all-stream returns streamId with no name (multi-adapter)", async () => {
    const hub = makeFakeHub();
    hub.registry.syncAll = async () => [
      { adapter: "a", ingested: 1 },
      { adapter: "b", ingested: 2 },
    ];

    const events = [];
    const ctx = {
      sendEventToPeer: (method, params) => events.push({ method, params }),
    };

    const ret = await _DISPATCH["sync-all-stream"](hub, {}, ctx);
    expect(ret.streamId).toMatch(/^pdh-saa-/);
    expect(ret.name).toBeUndefined();

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const doneEvent = events.find((e) => e.params.kind === "done");
    expect(doneEvent.params.adapter).toBe("*");
    expect(doneEvent.params.report).toHaveLength(2);
  });

  it("restores original onSyncEvent after sync done", async () => {
    const hub = makeFakeHub();
    const originalHook = (msg) => {};
    let currentHook = originalHook;
    Object.defineProperty(hub.registry, "onSyncEvent", {
      get() { return currentHook; },
      set(v) { currentHook = v; },
      configurable: true,
    });
    hub.registry.syncAdapter = async () => ({ adapter: "x", ingested: 0 });

    const ctx = { sendEventToPeer: () => {} };
    await _DISPATCH["sync-adapter-stream"](hub, { name: "x" }, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(hub.registry.onSyncEvent).toBe(originalHook);
  });
});

describe("dispatchPersonalDataHubMethod entry point", () => {
  it("rejects unknown actions with a clear error", async () => {
    await expect(
      dispatchPersonalDataHubMethod("nonexistent-action", {}),
    ).rejects.toThrow(/Unknown personal-data-hub action: nonexistent-action/);
  });

  it("rejects camelCase typo (must be kebab-case)", async () => {
    // The whole point of the kebab vs camel guard at the defaults level is
    // that camelCase invocations never reach approval — but if they do reach
    // dispatch, they should bounce off the table here too.
    await expect(
      dispatchPersonalDataHubMethod("registerEmail", { account: {} }),
    ).rejects.toThrow(/Unknown personal-data-hub action: registerEmail/);
  });
});
