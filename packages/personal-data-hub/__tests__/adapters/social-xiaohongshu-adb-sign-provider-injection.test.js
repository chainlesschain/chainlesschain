"use strict";

/**
 * Phase 6b — verify signProvider injection in XhsApiClient + collector.
 *
 * Tests both paths:
 *  - Bridge path (signedHeaders returns non-empty) → uses bridge headers
 *  - Fallback path (NullSignProvider OR bridge returns {}) → in-process md5
 *
 * Uses a fake fetch + fake signProvider to verify wiring without spawning
 * Electron WebContentsView.
 */

import { describe, it, expect, vi } from "vitest";

const {
  XhsApiClient,
} = require("../../lib/adapters/social-xiaohongshu-adb/api-client");
const {
  collect,
} = require("../../lib/adapters/social-xiaohongshu-adb/collector");
const { NULL_SIGN_PROVIDER } = require("../../lib/sign-providers");

function makeFakeFetch(responses) {
  const calls = [];
  const fakeFetch = async (urlStr, opts) => {
    calls.push({ url: urlStr, opts });
    for (const [pattern, payload] of responses) {
      if (urlStr.includes(pattern)) {
        const resolved =
          typeof payload === "function" ? await payload(urlStr, opts) : payload;
        return {
          ok: resolved.status == null || resolved.status === 200,
          status: resolved.status || 200,
          text: async () => resolved.body,
        };
      }
    }
    throw new Error("fake fetch: no response for " + urlStr);
  };
  return { fakeFetch, calls };
}

const HAPPY_RESPONSES = [
  [
    "/user/me",
    {
      body: JSON.stringify({
        code: 0,
        data: { user_id: "5e8c8f7e", nickname: "Alice" },
      }),
    },
  ],
  [
    "user_posted",
    {
      body: JSON.stringify({
        code: 0,
        data: { notes: [{ note_id: "N1", title: "n", time: 1 }] },
      }),
    },
  ],
  [
    "note/like/page",
    {
      body: JSON.stringify({
        code: 0,
        data: { notes: [{ note_id: "L1", title: "l" }] },
      }),
    },
  ],
  [
    "user/follow/list",
    {
      body: JSON.stringify({
        code: 0,
        data: { users: [{ user_id: "U1", nickname: "x" }] },
      }),
    },
  ],
];

// ─── XhsApiClient direct injection ──────────────────────────────────────

describe("XhsApiClient — signProvider injection", () => {
  it("defaults to NULL_SIGN_PROVIDER when no opts.signProvider", () => {
    const client = new XhsApiClient({ fetch: () => {} });
    expect(client.signProvider).toBe(NULL_SIGN_PROVIDER);
  });

  it("uses opts.signProvider verbatim when provided", () => {
    const fakeProvider = { signedHeaders: vi.fn(async () => ({})) };
    const client = new XhsApiClient({
      fetch: () => {},
      signProvider: fakeProvider,
    });
    expect(client.signProvider).toBe(fakeProvider);
  });

  it("falls back to in-process md5 when provider returns {}", async () => {
    const { fakeFetch, calls } = makeFakeFetch(HAPPY_RESPONSES);
    const fakeProvider = { signedHeaders: vi.fn(async () => ({})) };
    const client = new XhsApiClient({
      fetch: fakeFetch,
      signProvider: fakeProvider,
    });
    await client.fetchNotes("a1=fp; web_session=s", "fp", "5e8c8f7e");
    const notesCall = calls.find((c) => c.url.includes("user_posted"));
    // Fallback used → in-process X-S/X-T headers should be set
    expect(notesCall.opts.headers["X-S"]).toMatch(/^XYW_/);
    expect(notesCall.opts.headers["X-T"]).toMatch(/^\d+$/);
    expect(client._bridgeHits).toBe(0);
    expect(client._fallbackHits).toBe(1);
  });

  it("uses bridge headers when provider returns non-empty", async () => {
    const { fakeFetch, calls } = makeFakeFetch(HAPPY_RESPONSES);
    const fakeProvider = {
      signedHeaders: vi.fn(async () => ({
        "X-s": "XYW_bridge_value",
        "X-t": "1716383021000",
        "X-s-common": "common_value",
      })),
    };
    const client = new XhsApiClient({
      fetch: fakeFetch,
      signProvider: fakeProvider,
    });
    await client.fetchNotes("a1=fp; web_session=s", "fp", "5e8c8f7e");
    const notesCall = calls.find((c) => c.url.includes("user_posted"));
    expect(notesCall.opts.headers["X-s"]).toBe("XYW_bridge_value");
    expect(notesCall.opts.headers["X-t"]).toBe("1716383021000");
    expect(notesCall.opts.headers["X-s-common"]).toBe("common_value");
    // Bridge headers used — no fallback X-S/X-T injected
    expect(notesCall.opts.headers["X-S"]).toBeUndefined();
    expect(client._bridgeHits).toBe(1);
    expect(client._fallbackHits).toBe(0);
  });

  it("does NOT call signedHeaders for /user/me (no X-S required)", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const fakeProvider = { signedHeaders: vi.fn(async () => ({})) };
    const client = new XhsApiClient({
      fetch: fakeFetch,
      signProvider: fakeProvider,
    });
    await client.fetchMe("a1=fp; web_session=s");
    expect(fakeProvider.signedHeaders).not.toHaveBeenCalled();
  });

  it("calls signedHeaders for fetchNotes / fetchLiked / fetchFollows", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const fakeProvider = { signedHeaders: vi.fn(async () => ({})) };
    const client = new XhsApiClient({
      fetch: fakeFetch,
      signProvider: fakeProvider,
    });
    await client.fetchNotes("a1=fp; web_session=s", "fp", "5e8c8f7e");
    await client.fetchLiked("a1=fp; web_session=s", "fp");
    await client.fetchFollows("a1=fp; web_session=s", "fp", "5e8c8f7e");
    expect(fakeProvider.signedHeaders).toHaveBeenCalledTimes(3);
  });

  it("forwards `<path>|` as purpose to signedHeaders", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const fakeProvider = { signedHeaders: vi.fn(async () => ({})) };
    const client = new XhsApiClient({
      fetch: fakeFetch,
      signProvider: fakeProvider,
    });
    await client.fetchNotes("a1=fp; web_session=s", "fp", "5e8c8f7e");
    const [, purpose] = fakeProvider.signedHeaders.mock.calls[0];
    expect(purpose).toMatch(/^\/api\/sns\/web\/v2\/user_posted.*\|$/);
  });
});

// ─── collector lifecycle ────────────────────────────────────────────────

describe("collector — signProvider lifecycle", () => {
  it("warms up bridge before X-S endpoints", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const apiClient = new XhsApiClient({ fetch: fakeFetch });
    const warmedUp = [];
    const fakeProvider = {
      warmUp: vi.fn(async (cookie) => warmedUp.push(cookie)),
      signedHeaders: vi.fn(async () => ({})),
      shutdown: vi.fn(async () => {}),
    };
    const bridge = {
      invoke: vi.fn(async () => ({
        cookie: "a1=fp; web_session=s",
        a1: "fp",
        diagnostic: {},
      })),
    };
    await collect(bridge, {
      apiClient,
      signProvider: fakeProvider,
      stagingDir: require("node:os").tmpdir(),
    });
    expect(fakeProvider.warmUp).toHaveBeenCalledOnce();
    expect(warmedUp[0]).toBe("a1=fp; web_session=s");
  });

  it("shuts down bridge in finally — happy path", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const apiClient = new XhsApiClient({ fetch: fakeFetch });
    const fakeProvider = {
      warmUp: vi.fn(async () => {}),
      signedHeaders: vi.fn(async () => ({})),
      shutdown: vi.fn(async () => {}),
    };
    const bridge = {
      invoke: vi.fn(async () => ({
        cookie: "a1=fp; web_session=s",
        a1: "fp",
        diagnostic: {},
      })),
    };
    await collect(bridge, {
      apiClient,
      signProvider: fakeProvider,
      stagingDir: require("node:os").tmpdir(),
    });
    expect(fakeProvider.shutdown).toHaveBeenCalledOnce();
  });

  it("shuts down bridge in finally — even on fetchMe failure", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["/user/me", { body: JSON.stringify({ code: 0, data: {} }) }],
    ]);
    const apiClient = new XhsApiClient({ fetch: fakeFetch });
    const fakeProvider = {
      warmUp: vi.fn(async () => {}),
      signedHeaders: vi.fn(async () => ({})),
      shutdown: vi.fn(async () => {}),
    };
    const bridge = {
      invoke: vi.fn(async () => ({
        cookie: "a1=fp; web_session=s",
        a1: "fp",
        diagnostic: {},
      })),
    };
    const result = await collect(bridge, {
      apiClient,
      signProvider: fakeProvider,
      stagingDir: require("node:os").tmpdir(),
    });
    expect(result.meFetchFailed).toBe(true);
    expect(fakeProvider.shutdown).toHaveBeenCalledOnce();
  });

  it("tolerates warmUp throw (falls back to in-process md5)", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const fakeProvider = {
      warmUp: vi.fn(async () => {
        throw new Error("xhs.com 403 — anti-bot blocked");
      }),
      signedHeaders: vi.fn(async () => ({})),
      shutdown: vi.fn(async () => {}),
    };
    // Inject same provider into the apiClient too — real wiring path
    // creates them together inside collector.
    const apiClient = new XhsApiClient({
      fetch: fakeFetch,
      signProvider: fakeProvider,
    });
    const bridge = {
      invoke: vi.fn(async () => ({
        cookie: "a1=fp; web_session=s",
        a1: "fp",
        diagnostic: {},
      })),
    };
    const result = await collect(bridge, {
      apiClient,
      signProvider: fakeProvider,
      stagingDir: require("node:os").tmpdir(),
    });
    // Sync proceeded — fallback md5 used instead of bridge for all 3
    // X-S endpoints (bridge.signedHeaders returns {} so client falls
    // back). Note lastErrorCode gets cleared by successful subsequent
    // fetchMe so we check _fallbackHits instead.
    expect(result.meFetchFailed).toBe(false);
    expect(apiClient._fallbackHits).toBeGreaterThanOrEqual(3);
    expect(apiClient._bridgeHits).toBe(0);
    // shutdown still runs in finally
    expect(fakeProvider.shutdown).toHaveBeenCalledOnce();
  });

  it("reports signProvider diagnostic in collect result", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    // Subclass to control constructor.name (vitest mocks can't override it
    // on plain object literals — constructor.name is read-only on Object).
    class XhsSignBridge {
      constructor() {
        this.warmUp = vi.fn(async () => {});
        this.signedHeaders = vi.fn(async () => ({
          "X-s": "bridge",
          "X-t": "1",
          "X-s-common": "c",
        }));
        this.shutdown = vi.fn(async () => {});
      }
    }
    const fakeProvider = new XhsSignBridge();
    const apiClient = new XhsApiClient({
      fetch: fakeFetch,
      signProvider: fakeProvider,
    });
    const bridge = {
      invoke: vi.fn(async () => ({
        cookie: "a1=fp; web_session=s",
        a1: "fp",
        diagnostic: {},
      })),
    };
    const result = await collect(bridge, {
      apiClient,
      signProvider: fakeProvider,
      stagingDir: require("node:os").tmpdir(),
    });
    expect(result.signProviderUsed).toBe("XhsSignBridge");
    expect(result.signProviderHits).toBe(3); // 3 X-S endpoints all hit bridge
    expect(result.signProviderFallbacks).toBe(0);
  });

  it("undefined signProvider → no warmUp/shutdown, fallback md5 used", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    // Pre-construct apiClient with fakeFetch but no signProvider — client
    // defaults to NULL_SIGN_PROVIDER which returns {} from signedHeaders.
    const apiClient = new XhsApiClient({ fetch: fakeFetch });
    const bridge = {
      invoke: vi.fn(async () => ({
        cookie: "a1=fp; web_session=s",
        a1: "fp",
        diagnostic: {},
      })),
    };
    const result = await collect(bridge, {
      apiClient,
      stagingDir: require("node:os").tmpdir(),
    });
    // No bridge → in-process fallback throughout
    expect(result.signProviderUsed).toBe("none");
    expect(result.signProviderHits).toBe(0);
    // 3 X-S endpoints called fallback md5 each
    expect(result.signProviderFallbacks).toBeGreaterThanOrEqual(3);
  });
});
