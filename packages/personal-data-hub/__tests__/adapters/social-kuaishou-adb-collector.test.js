"use strict";

import { describe, it, expect, vi } from "vitest";
const os = require("node:os");

const {
  collect,
  collectAndSync,
} = require("../../lib/adapters/social-kuaishou-adb/collector");
const {
  KuaishouApiClient,
} = require("../../lib/adapters/social-kuaishou-adb/api-client");

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

function gqlBody(opName, dataFn) {
  return async (urlStr, opts) => {
    const reqBody = JSON.parse(opts.body);
    if (reqBody.operationName !== opName) {
      return { body: JSON.stringify({ data: {} }) };
    }
    return { body: JSON.stringify({ data: dataFn() }) };
  };
}

const HAPPY_RESPONSES = [
  // Single graphql endpoint — switch on operationName via body inspection
  [
    "graphql",
    async (urlStr, opts) => {
      const reqBody = JSON.parse(opts.body);
      let data = {};
      if (reqBody.operationName === "visionFeedRecommend") {
        data = {
          visionFeedRecommend: {
            feeds: [
              {
                photo: { id: "W1", caption: "watched", timestamp: 1700000000 },
                author: { id: "AUTH", name: "Author" },
              },
            ],
          },
        };
      } else if (reqBody.operationName === "visionProfilePhotoList") {
        data = {
          visionProfilePhotoList: {
            feeds: [
              {
                photo: { id: "OWN1", caption: "my", timestamp: 1700001000 },
              },
            ],
          },
        };
      } else if (reqBody.operationName === "visionSearchPhoto") {
        data = {
          visionSearchPhoto: {
            recentSearchList: [{ keyword: "kw", time: 1700002000 }],
          },
        };
      }
      return { body: JSON.stringify({ data }) };
    },
  ],
];

const apiPhPayload = encodeURIComponent(
  JSON.stringify({
    user_id: "12345",
    user_name: "Alice",
  }),
);

const COOKIE_PAYLOAD = {
  cookie: `userId=12345; kuaishou.web.cp.api_ph=${apiPhPayload}`,
  uid: "12345",
  diagnostic: { cookieCount: 5, hadEncrypted: false, cookieNames: [] },
};

function makeBridge(invokeResult) {
  return {
    invoke: vi.fn(async () => invokeResult),
  };
}

describe("collect — happy path with signProvider", () => {
  it("warmUp → 3 signed endpoints → shutdown", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const lifecycle = [];
    const sign = {
      warmUp: vi.fn(async (c) => lifecycle.push({ warmUp: c })),
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("__NS_sig3", "BRIDGE_SIG");
        return u;
      }),
      signedHeaders: vi.fn(async () => ({
        kpf: "PC_WEB",
        kpn: "KUAISHOU_VISION",
      })),
      shutdown: vi.fn(async () => lifecycle.push("shutdown")),
    };
    const client = new KuaishouApiClient({
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
    expect(r.eventCounts.profile).toBe(1);
    expect(r.eventCounts.watch).toBe(1);
    expect(r.eventCounts.collect).toBe(1);
    expect(r.eventCounts.search).toBe(1);
    expect(r.signProviderHits).toBe(3);
    expect(r.signProviderFallbacks).toBe(0);
  });
});

describe("collect — fallback path (no signProvider)", () => {
  it("3 signed endpoints short-circuit; profile from cookie still emitted", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const client = new KuaishouApiClient({ fetch: fakeFetch });
    const r = await collect(makeBridge(COOKIE_PAYLOAD), {
      apiClient: client,
      stagingDir: os.tmpdir(),
    });
    expect(r.uid).toBe("12345");
    expect(r.profileFetchFailed).toBe(false);
    expect(r.eventCounts.profile).toBe(1); // pure cookie parse
    expect(r.eventCounts.watch).toBe(0); // short-circuit
    expect(r.eventCounts.collect).toBe(0);
    expect(r.eventCounts.search).toBe(0);
    expect(r.signProviderUsed).toBe("none");
    expect(r.signProviderHits).toBe(0);
    expect(r.signProviderFallbacks).toBe(3);
  });
});

describe("collect — profile fetch fails (no api_ph)", () => {
  it("emits empty snapshot with cookie-derived uid + profileFetchFailed=true", async () => {
    const cookiePayload = {
      cookie: "userId=12345", // no api_ph → fetchProfile fails
      uid: "12345",
      diagnostic: {},
    };
    const { fakeFetch } = makeFakeFetch([]);
    const client = new KuaishouApiClient({ fetch: fakeFetch });
    const r = await collect(makeBridge(cookiePayload), {
      apiClient: client,
      stagingDir: os.tmpdir(),
    });
    expect(r.profileFetchFailed).toBe(true);
    expect(r.uid).toBe("12345"); // cookie pre-extract
    expect(r.eventCounts.total).toBe(0);
    expect(r.lastErrorCode).toBe(-8);
  });
});

describe("collect — bridge warmUp failure", () => {
  it("tolerates warmUp throw; signed endpoints fall through to short-circuit", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const sign = {
      warmUp: vi.fn(async () => {
        throw new Error("kuaishou.com 403");
      }),
      signUrl: vi.fn(async () => null),
      signedHeaders: vi.fn(async () => ({})),
      shutdown: vi.fn(async () => {}),
    };
    const client = new KuaishouApiClient({
      fetch: fakeFetch,
      signProvider: sign,
    });
    const r = await collect(makeBridge(COOKIE_PAYLOAD), {
      apiClient: client,
      signProvider: sign,
      stagingDir: os.tmpdir(),
    });
    expect(r.profileFetchFailed).toBe(false); // profile pure cookie parse
    expect(r.eventCounts.watch).toBe(0);
    expect(client._fallbackHits).toBe(3);
    expect(sign.shutdown).toHaveBeenCalledOnce();
  });
});

describe("collect — malformed bridge payload", () => {
  it("throws when bridge returns no cookie", async () => {
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
    class KuaishouSignBridge {
      constructor() {
        this.warmUp = vi.fn(async () => {});
        this.signUrl = vi.fn(async (url) => {
          const u = new URL(String(url));
          u.searchParams.set("__NS_sig3", "X");
          return u;
        });
        this.signedHeaders = vi.fn(async () => ({
          kpf: "PC_WEB",
          kpn: "KUAISHOU_VISION",
        }));
        this.shutdown = vi.fn(async () => {});
      }
    }
    const sign = new KuaishouSignBridge();
    const client = new KuaishouApiClient({
      fetch: fakeFetch,
      signProvider: sign,
    });
    const r = await collect(makeBridge(COOKIE_PAYLOAD), {
      apiClient: client,
      signProvider: sign,
      stagingDir: os.tmpdir(),
    });
    expect(r.signProviderUsed).toBe("KuaishouSignBridge");
  });
});

describe("collectAndSync", () => {
  it("orchestrates collect + registry.syncAdapter + cleanup", async () => {
    const { fakeFetch } = makeFakeFetch(HAPPY_RESPONSES);
    const client = new KuaishouApiClient({ fetch: fakeFetch });
    const registry = {
      syncAdapter: vi.fn(async (name) => ({ adapter: name, status: "ok" })),
    };
    const r = await collectAndSync(makeBridge(COOKIE_PAYLOAD), registry, {
      apiClient: client,
      stagingDir: os.tmpdir(),
    });
    expect(registry.syncAdapter).toHaveBeenCalledWith(
      "social-kuaishou",
      expect.objectContaining({ inputPath: expect.stringContaining(".json") }),
    );
    expect(r.adapter).toBe("social-kuaishou");
    expect(r.kuaishou.uid).toBe("12345");
    expect(r.kuaishou.eventCounts.profile).toBe(1);
  });
});
