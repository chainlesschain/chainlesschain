"use strict";

import { describe, it, expect, vi } from "vitest";
const os = require("node:os");

const {
  collect,
  collectAndSync,
} = require("../../lib/adapters/social-toutiao-adb/collector");
const {
  ToutiaoApiClient,
} = require("../../lib/adapters/social-toutiao-adb/api-client");

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
    "passport/account/info/v2",
    {
      body: JSON.stringify({
        status_code: 0,
        data: {
          user_id: "12345",
          screen_name: "Alice",
          avatar_url: "https://a/x.jpg",
        },
      }),
    },
  ],
  [
    "api/news/feed/v90",
    {
      body: JSON.stringify({
        data: [{ group_id: "G1", title: "T1", behot_time: 1700000000 }],
      }),
    },
  ],
  [
    "article/v2/tab_comments",
    {
      body: JSON.stringify({
        data: [{ group_id: "C1", title: "Saved", behot_time: 1700001000 }],
      }),
    },
  ],
  [
    "api/search/content",
    {
      body: JSON.stringify({
        data: { user_search_history: [{ keyword: "kw", time: 1700002000 }] },
      }),
    },
  ],
];

function makeBridge(invokeResult, accountResult) {
  return {
    invoke: vi.fn(async (method) => {
      if (method === "toutiao.account") {
        // Mirror real wiring: a separate extension. Tests that don't wire it
        // get a throw (collector falls through gracefully).
        if (accountResult === undefined) {
          throw new Error("toutiao.account not wired in this test");
        }
        return accountResult;
      }
      return invokeResult;
    }),
  };
}

const COOKIE_PAYLOAD = {
  cookie: "sessionid=abc; passport_uid=12345",
  uid: "12345",
  diagnostic: { cookieCount: 2, hadEncrypted: false, cookieNames: ["sessionid", "passport_uid"] },
};

describe("collect — happy path with signProvider", () => {
  it("warmUp → signed endpoints → shutdown", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const calls = [];
    const sign = {
      warmUp: vi.fn(async (c) => calls.push({ warmUp: c })),
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "BRIDGE_SIG");
        return u;
      }),
      shutdown: vi.fn(async () => calls.push("shutdown")),
    };
    const client = new ToutiaoApiClient({
      fetch: fakeFetch,
      signProvider: sign,
    });
    const r = await collect(makeBridge(COOKIE_PAYLOAD), {
      apiClient: client,
      signProvider: sign,
      stagingDir: os.tmpdir(),
    });
    expect(sign.warmUp).toHaveBeenCalledWith(COOKIE_PAYLOAD.cookie);
    expect(sign.shutdown).toHaveBeenCalledOnce();
    expect(r.uid).toBe("12345");
    expect(r.nickname).toBe("Alice");
    expect(r.profileFetchFailed).toBe(false);
    expect(r.eventCounts.feed).toBe(1);
    expect(r.eventCounts.collection).toBe(1);
    expect(r.eventCounts.search).toBe(1);
    expect(r.eventCounts.profile).toBe(1);
    expect(r.signProviderHits).toBe(3); // 3 signed endpoints
    expect(r.signProviderFallbacks).toBe(0);
  });
});

describe("collect — fallback path (no signProvider)", () => {
  it("3 signed endpoints short-circuit; profile still emitted", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const client = new ToutiaoApiClient({ fetch: fakeFetch });
    const r = await collect(makeBridge(COOKIE_PAYLOAD), {
      apiClient: client,
      stagingDir: os.tmpdir(),
    });
    expect(r.uid).toBe("12345");
    expect(r.profileFetchFailed).toBe(false);
    expect(r.eventCounts.profile).toBe(1);
    expect(r.eventCounts.feed).toBe(0); // short-circuit
    expect(r.eventCounts.collection).toBe(0);
    expect(r.eventCounts.search).toBe(0);
    expect(r.signProviderUsed).toBe("none");
    expect(r.signProviderHits).toBe(0);
    expect(r.signProviderFallbacks).toBe(3);
  });
});

describe("collect — profile fetch fails", () => {
  it("emits empty snapshot with cookie-derived uid + profileFetchFailed=true", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "passport/account/info/v2",
        {
          body: JSON.stringify({
            status_code: 1,
            status_msg: "token expired",
          }),
        },
      ],
    ]);
    const client = new ToutiaoApiClient({ fetch: fakeFetch });
    const r = await collect(makeBridge(COOKIE_PAYLOAD), {
      apiClient: client,
      stagingDir: os.tmpdir(),
    });
    expect(r.profileFetchFailed).toBe(true);
    expect(r.uid).toBe("12345"); // from cookie pre-extract
    expect(r.eventCounts.total).toBe(0);
    expect(r.lastErrorCode).toBe(1);
  });

  it("falls back to 'unknown-user' uid when cookie pre-extract also empty", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "passport/account/info/v2",
        { body: JSON.stringify({ status_code: 1, status_msg: "expired" }) },
      ],
    ]);
    const client = new ToutiaoApiClient({ fetch: fakeFetch });
    const r = await collect(
      makeBridge({
        cookie: "sessionid=abc",
        uid: null,
        diagnostic: {},
      }),
      { apiClient: client, stagingDir: os.tmpdir() },
    );
    expect(r.uid).toBe(null);
    expect(r.profileFetchFailed).toBe(true);
  });

  it("profile permission-denied (error_code 16) BUT cookie uid + signer → feed/collection/search still collect", async () => {
    // Real-device 2026-06-11: logged-in Toutiao returns passport error_code 16
    // 该应用无权限. We must NOT abort — feed is cookie-identified, so with a
    // SignBridge the signed endpoints still flow. Profile event is skipped, but
    // the headline error (16) is surfaced and feed/collection/search collect.
    const { fakeFetch } = makeFakeFetch([
      [
        "passport/account/info/v2",
        {
          body: JSON.stringify({
            message: "error",
            data: { error_code: 16, description: "该应用无权限" },
          }),
        },
      ],
      ...HAPPY_RESPONSES.slice(1), // feed / comments / search responses
    ]);
    const sign = {
      warmUp: vi.fn(async () => {}),
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "BRIDGE_SIG");
        return u;
      }),
      shutdown: vi.fn(async () => {}),
    };
    const client = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const r = await collect(makeBridge(COOKIE_PAYLOAD), {
      apiClient: client,
      signProvider: sign,
      stagingDir: os.tmpdir(),
    });
    expect(r.profileFetchFailed).toBe(true);
    expect(r.uid).toBe("12345"); // cookie-derived
    expect(r.lastErrorCode).toBe(16); // headline profile error preserved
    expect(r.lastErrorMessage).toBe("该应用无权限");
    expect(r.eventCounts.profile).toBe(0); // no profile event
    expect(r.eventCounts.feed).toBe(1); // ← previously 0 (aborted before signing)
    expect(r.eventCounts.collection).toBe(1);
    expect(r.eventCounts.search).toBe(1);
    expect(r.eventCounts.total).toBe(3);
  });

  it("profile error_code 16 + NO cookie uid → recovers uid from local account_db, collects signed endpoints", async () => {
    // Real-device 2026-06-11: web profile permission-denied AND the WebView
    // cookie jar has no numeric uid. The collector asks the bridge for
    // 'toutiao.account' (local account_db) and proceeds with that uid.
    const { fakeFetch } = makeFakeFetch([
      [
        "passport/account/info/v2",
        { body: JSON.stringify({ message: "error", data: { error_code: 16, description: "该应用无权限" } }) },
      ],
      ...HAPPY_RESPONSES.slice(1),
    ]);
    const sign = {
      warmUp: vi.fn(async () => {}),
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "BRIDGE_SIG");
        return u;
      }),
      shutdown: vi.fn(async () => {}),
    };
    const bridge = {
      invoke: vi.fn(async (m) => {
        if (m === "toutiao.cookies") return { cookie: "sessionid=abc", uid: null, diagnostic: {} };
        if (m === "toutiao.account") return { uid: "92585279158", nickname: "小明", secUid: "MS4w" };
        throw new Error("unknown " + m);
      }),
    };
    const client = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const r = await collect(bridge, { apiClient: client, signProvider: sign, stagingDir: os.tmpdir() });
    expect(r.profileFetchFailed).toBe(true);
    expect(r.profileSource).toBe("local-account-db");
    expect(r.uid).toBe("92585279158");
    expect(r.nickname).toBe("小明");
    expect(r.lastErrorCode).toBe(16); // headline web error preserved
    expect(r.eventCounts.profile).toBe(1); // profile event from local account
    expect(r.eventCounts.feed).toBe(1);
    expect(r.eventCounts.collection).toBe(1);
    expect(r.eventCounts.search).toBe(1);
  });
});

describe("collect — bridge warmUp failure", () => {
  it("tolerates warmUp throw (falls through to fallback path)", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const sign = {
      warmUp: vi.fn(async () => {
        throw new Error("toutiao.com 403 — anti-bot blocked");
      }),
      signUrl: vi.fn(async () => null),
      shutdown: vi.fn(async () => {}),
    };
    const client = new ToutiaoApiClient({
      fetch: fakeFetch,
      signProvider: sign,
    });
    const r = await collect(makeBridge(COOKIE_PAYLOAD), {
      apiClient: client,
      signProvider: sign,
      stagingDir: os.tmpdir(),
    });
    expect(r.profileFetchFailed).toBe(false); // profile uses no _sig
    expect(r.eventCounts.feed).toBe(0); // signed endpoints fall through
    expect(client._fallbackHits).toBe(3);
    expect(sign.shutdown).toHaveBeenCalledOnce();
  });
});

describe("collect — malformed bridge payload", () => {
  it("throws when bridge.invoke returns no cookie", async () => {
    const bridge = { invoke: vi.fn(async () => ({ uid: "1" })) };
    await expect(
      collect(bridge, { stagingDir: os.tmpdir() }),
    ).rejects.toThrow(/malformed payload/);
  });

  it("throws when bridge missing invoke", async () => {
    await expect(collect({}, {})).rejects.toThrow(
      /bridge must expose invoke/,
    );
  });
});

describe("collect — signProviderUsed diagnostic", () => {
  it("reports class name when bridge present", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    class ToutiaoSignBridge {
      constructor() {
        this.warmUp = vi.fn(async () => {});
        this.signUrl = vi.fn(async (url) => {
          const u = new URL(String(url));
          u.searchParams.set("_signature", "X");
          return u;
        });
        this.shutdown = vi.fn(async () => {});
      }
    }
    const sign = new ToutiaoSignBridge();
    const client = new ToutiaoApiClient({
      fetch: fakeFetch,
      signProvider: sign,
    });
    const r = await collect(makeBridge(COOKIE_PAYLOAD), {
      apiClient: client,
      signProvider: sign,
      stagingDir: os.tmpdir(),
    });
    expect(r.signProviderUsed).toBe("ToutiaoSignBridge");
  });

  it("reports 'none' when no bridge", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const client = new ToutiaoApiClient({ fetch: fakeFetch });
    const r = await collect(makeBridge(COOKIE_PAYLOAD), {
      apiClient: client,
      stagingDir: os.tmpdir(),
    });
    expect(r.signProviderUsed).toBe("none");
  });
});

describe("collectAndSync", () => {
  it("orchestrates collect + registry.syncAdapter + cleanup", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const client = new ToutiaoApiClient({ fetch: fakeFetch });
    const registry = {
      syncAdapter: vi.fn(async (name) => ({ adapter: name, status: "ok" })),
    };
    const r = await collectAndSync(makeBridge(COOKIE_PAYLOAD), registry, {
      apiClient: client,
      stagingDir: os.tmpdir(),
    });
    expect(registry.syncAdapter).toHaveBeenCalledWith(
      "social-toutiao",
      expect.objectContaining({ inputPath: expect.stringContaining(".json") }),
    );
    expect(r.adapter).toBe("social-toutiao");
    expect(r.toutiao.uid).toBe("12345");
    expect(r.toutiao.eventCounts.profile).toBe(1);
  });
});
