"use strict";

import { describe, it, expect, vi } from "vitest";

const {
  KuaishouApiClient,
  _internals,
} = require("../../lib/adapters/social-kuaishou-adb/api-client");
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

const HAPPY_GRAPHQL_RESPONSE = {
  body: JSON.stringify({
    data: {
      visionFeedRecommend: {
        feeds: [
          {
            photo: {
              id: "P1",
              caption: "Watch 1",
              timestamp: 1700000000,
              duration: 30,
            },
            author: { id: "AUTH1", name: "AuthorOne" },
          },
        ],
      },
    },
  }),
};

const apiPhPayload = encodeURIComponent(
  JSON.stringify({
    user_id: "12345",
    user_name: "Alice",
    kuaishou_id: "alice_ks",
    headurl: "https://a.example/avatar.jpg",
    sex: "F",
    city: "Beijing",
  }),
);

describe("KuaishouApiClient — extractUid", () => {
  it("prefers direct userId cookie", () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(c.extractUid("userId=12345; did=anon")).toBe("12345");
  });

  it("falls back to api_ph nested user_id", () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(c.extractUid(`kuaishou.web.cp.api_ph=${apiPhPayload}`)).toBe(
      "12345",
    );
  });

  it("returns null when only anti-bot cookies present", () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(c.extractUid("did=anonid; ttwid=x")).toBe(null);
    expect(c.lastErrorCode).toBe(-7);
  });

  it("returns null on empty cookie", () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(c.extractUid("")).toBe(null);
    expect(c.lastErrorCode).toBe(-1);
  });

  it("returns null on userId=0 sentinel", () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(c.extractUid("userId=0")).toBe(null);
  });
});

describe("KuaishouApiClient — fetchProfile (cookie parse, no HTTP)", () => {
  it("parses URL-encoded api_ph JSON", async () => {
    // NO fetch needed — pure cookie parse
    const c = new KuaishouApiClient({ fetch: () => {} });
    const p = await c.fetchProfile(
      `userId=12345; kuaishou.web.cp.api_ph=${apiPhPayload}`,
    );
    expect(p).toMatchObject({
      uid: "12345",
      nickname: "Alice",
      kuaishouId: "alice_ks",
      avatarUrl: "https://a.example/avatar.jpg",
      sex: "F",
      city: "Beijing",
    });
  });

  it("returns null when api_ph absent", async () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(await c.fetchProfile("userId=12345")).toBe(null);
    expect(c.lastErrorCode).toBe(-8);
  });

  it("returns null on un-decodable api_ph (non-JSON)", async () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(
      await c.fetchProfile(`kuaishou.web.cp.api_ph=${encodeURIComponent("base64junk")}`),
    ).toBe(null);
    expect(c.lastErrorCode).toBe(-9);
  });

  it("returns null when JSON lacks user_id", async () => {
    const cookie = `kuaishou.web.cp.api_ph=${encodeURIComponent(
      JSON.stringify({ user_name: "noUid" }),
    )}`;
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(await c.fetchProfile(cookie)).toBe(null);
    expect(c.lastErrorCode).toBe(-7);
  });

  it("normalizes user_id from number to string", async () => {
    const cookie = `kuaishou.web.cp.api_ph=${encodeURIComponent(
      JSON.stringify({ user_id: 98765, user_name: "Num" }),
    )}`;
    const c = new KuaishouApiClient({ fetch: () => {} });
    const p = await c.fetchProfile(cookie);
    expect(p.uid).toBe("98765");
  });

  it("treats user_id=0 as missing (guest)", async () => {
    const cookie = `kuaishou.web.cp.api_ph=${encodeURIComponent(
      JSON.stringify({ user_id: "0", user_name: "Guest" }),
    )}`;
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(await c.fetchProfile(cookie)).toBe(null);
  });
});

describe("KuaishouApiClient — signProvider injection", () => {
  it("defaults to NULL_SIGN_PROVIDER", () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(c.signProvider).toBe(NULL_SIGN_PROVIDER);
  });

  it("3 signed endpoints SHORT-CIRCUIT (-99) when NullSignProvider", async () => {
    const { fakeFetch, calls } = makeFakeFetch([]);
    const c = new KuaishouApiClient({ fetch: fakeFetch });
    const w = await c.fetchWatchHistory("userId=1");
    const p = await c.fetchProfilePhotos("userId=1", "1");
    const s = await c.fetchSearchHistory("userId=1");
    expect(w).toEqual([]);
    expect(p).toEqual([]);
    expect(s).toEqual([]);
    expect(c.lastErrorCode).toBe(-99);
    expect(c._fallbackHits).toBe(3);
    expect(c._bridgeHits).toBe(0);
    // Critical: no HTTP traffic when bridge cold
    expect(calls).toHaveLength(0);
  });

  it("sends GraphQL POST with __NS_sig3 query + kpf/kpn headers when bridge present", async () => {
    const { fakeFetch, calls } = makeFakeFetch([
      ["graphql", HAPPY_GRAPHQL_RESPONSE],
    ]);
    const sign = {
      signUrl: vi.fn(async (url, _purpose) => {
        const u = new URL(String(url));
        u.searchParams.set("__NS_sig3", "BRIDGE_SIG");
        return u;
      }),
      signedHeaders: vi.fn(async (_url, _purpose) => ({
        kpf: "PC_WEB",
        kpn: "KUAISHOU_VISION",
      })),
    };
    const c = new KuaishouApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchWatchHistory("userId=1", { limit: 5 });
    expect(items).toHaveLength(1);
    expect(items[0].photoId).toBe("P1");
    expect(sign.signUrl).toHaveBeenCalledOnce();
    expect(sign.signedHeaders).toHaveBeenCalledOnce();
    expect(calls[0].url).toContain("__NS_sig3=BRIDGE_SIG");
    expect(calls[0].opts.method).toBe("POST");
    expect(calls[0].opts.headers.kpf).toBe("PC_WEB");
    expect(calls[0].opts.headers.kpn).toBe("KUAISHOU_VISION");
    // body MUST be valid JSON with operationName + variables + query
    const body = JSON.parse(calls[0].opts.body);
    expect(body.operationName).toBe("visionFeedRecommend");
    expect(body.variables).toEqual({ pcursor: "", count: 5 });
    expect(c._bridgeHits).toBe(1);
    expect(c._fallbackHits).toBe(0);
  });

  it("forwards <op>|<body> purpose to signUrl + signedHeaders", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["graphql", { body: JSON.stringify({ data: {} }) }],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("__NS_sig3", "X");
        return u;
      }),
      signedHeaders: vi.fn(async () => ({})),
    };
    const c = new KuaishouApiClient({ fetch: fakeFetch, signProvider: sign });
    await c.fetchWatchHistory("userId=1");
    const [, signPurpose] = sign.signUrl.mock.calls[0];
    expect(signPurpose).toMatch(/^visionFeedRecommend\|/);
    // purpose carries the exact body bytes for hash matching
    expect(signPurpose).toContain('"pcursor"');
    expect(signPurpose).toContain('"count"');
    // signedHeaders receives same purpose
    const [, hdrPurpose] = sign.signedHeaders.mock.calls[0];
    expect(hdrPurpose).toBe(signPurpose);
  });
});

describe("KuaishouApiClient — fetchWatchHistory parsing", () => {
  const sign = {
    signUrl: vi.fn(async (url) => {
      const u = new URL(String(url));
      u.searchParams.set("__NS_sig3", "X");
      return u;
    }),
    signedHeaders: vi.fn(async () => ({ kpf: "PC_WEB", kpn: "KUAISHOU_VISION" })),
  };

  it("parses nested photo + author", async () => {
    const { fakeFetch } = makeFakeFetch([["graphql", HAPPY_GRAPHQL_RESPONSE]]);
    const c = new KuaishouApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchWatchHistory("userId=1");
    expect(items[0]).toMatchObject({
      photoId: "P1",
      caption: "Watch 1",
      authorName: "AuthorOne",
      authorId: "AUTH1",
      duration: 30,
    });
    expect(items[0].viewedAt).toBe(1700000000 * 1000);
  });

  it("handles flat-shape items (no nested photo)", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "graphql",
        {
          body: JSON.stringify({
            data: {
              visionFeedRecommend: {
                feeds: [
                  {
                    id: "FLAT1",
                    caption: "Flat watch",
                    timestamp: 1700001000,
                  },
                ],
              },
            },
          }),
        },
      ],
    ]);
    const c = new KuaishouApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchWatchHistory("userId=1");
    expect(items[0].photoId).toBe("FLAT1");
  });

  it("returns [] on GraphQL errors response", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "graphql",
        {
          body: JSON.stringify({
            errors: [{ message: "401 unauthorized" }],
          }),
        },
      ],
    ]);
    const c = new KuaishouApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchWatchHistory("userId=1");
    expect(items).toEqual([]);
    expect(c.lastErrorCode).toBe(-5);
    expect(c.lastErrorMessage).toMatch(/401 unauthorized/);
  });

  it("returns [] on HTTP 412 anti-bot", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["graphql", { status: 412, body: "<html>blocked" }],
    ]);
    const c = new KuaishouApiClient({ fetch: fakeFetch, signProvider: sign });
    expect(await c.fetchWatchHistory("userId=1")).toEqual([]);
    expect(c.lastErrorCode).toBe(412);
  });
});

describe("KuaishouApiClient — fetchProfilePhotos parsing", () => {
  const sign = {
    signUrl: vi.fn(async (url) => {
      const u = new URL(String(url));
      u.searchParams.set("__NS_sig3", "X");
      return u;
    }),
    signedHeaders: vi.fn(async () => ({ kpf: "PC_WEB", kpn: "KUAISHOU_VISION" })),
  };

  it("parses own posted photos", async () => {
    const { fakeFetch, calls } = makeFakeFetch([
      [
        "graphql",
        {
          body: JSON.stringify({
            data: {
              visionProfilePhotoList: {
                feeds: [
                  {
                    photo: {
                      id: "OWN1",
                      caption: "My photo",
                      timestamp: 1700002000,
                    },
                  },
                ],
              },
            },
          }),
        },
      ],
    ]);
    const c = new KuaishouApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchProfilePhotos("userId=1", "12345");
    expect(items[0]).toMatchObject({
      photoId: "OWN1",
      caption: "My photo",
    });
    // body must carry userId variable
    const body = JSON.parse(calls[0].opts.body);
    expect(body.variables.userId).toBe("12345");
    expect(body.variables.page).toBe("profile");
  });
});

describe("KuaishouApiClient — fetchSearchHistory parsing", () => {
  const sign = {
    signUrl: vi.fn(async (url) => {
      const u = new URL(String(url));
      u.searchParams.set("__NS_sig3", "X");
      return u;
    }),
    signedHeaders: vi.fn(async () => ({ kpf: "PC_WEB", kpn: "KUAISHOU_VISION" })),
  };

  it("parses recentSearchList object shape", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "graphql",
        {
          body: JSON.stringify({
            data: {
              visionSearchPhoto: {
                recentSearchList: [
                  { keyword: "AI", time: 1700003000 },
                  { keyword: "rust", time: 1700004000 },
                ],
              },
            },
          }),
        },
      ],
    ]);
    const c = new KuaishouApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchSearchHistory("userId=1");
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ keyword: "AI", searchedAt: 1700003000 * 1000 });
  });

  it("falls back to data.visionSearchPhoto.history shape", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "graphql",
        {
          body: JSON.stringify({
            data: {
              visionSearchPhoto: {
                history: [{ keyword: "fallback", time: 1 }],
              },
            },
          }),
        },
      ],
    ]);
    const c = new KuaishouApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchSearchHistory("userId=1");
    expect(items[0].keyword).toBe("fallback");
  });

  it("returns [] when both shapes missing", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "graphql",
        {
          body: JSON.stringify({
            data: { visionSearchPhoto: {} },
          }),
        },
      ],
    ]);
    const c = new KuaishouApiClient({ fetch: fakeFetch, signProvider: sign });
    expect(await c.fetchSearchHistory("userId=1")).toEqual([]);
  });
});

describe("normalizeMs", () => {
  it("passes ms through, multiplies seconds, returns 0 for invalid", () => {
    expect(_internals.normalizeMs(1700000000000)).toBe(1700000000000);
    expect(_internals.normalizeMs(1700000000)).toBe(1700000000 * 1000);
    expect(_internals.normalizeMs(0)).toBe(0);
    expect(_internals.normalizeMs(-1)).toBe(0);
  });
});

describe("api_ph base64 fallback (v0.3)", () => {
  const profileJson = JSON.stringify({
    user_id: "424242",
    user_name: "B64User",
    kuaishou_id: "b64_ks",
  });
  const b64 = Buffer.from(profileJson, "utf-8").toString("base64");

  it("apiPhDecodeCandidates yields base64-decoded JSON as 2nd candidate", () => {
    const cands = _internals.apiPhDecodeCandidates(encodeURIComponent(b64));
    expect(cands).toHaveLength(2);
    expect(cands[1]).toBe(profileJson);
  });

  it("apiPhDecodeCandidates yields 1 candidate for plain JSON (no double decode)", () => {
    const cands = _internals.apiPhDecodeCandidates(
      encodeURIComponent(profileJson),
    );
    expect(cands).toEqual([profileJson]);
  });

  it("apiPhDecodeCandidates suppresses garbage base64 (decoded ≠ JSON)", () => {
    expect(_internals.apiPhDecodeCandidates("base64junk")).toEqual([
      "base64junk",
    ]);
  });

  it("apiPhDecodeCandidates handles url-safe base64 (- _ alphabet)", () => {
    const urlSafe = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const cands = _internals.apiPhDecodeCandidates(urlSafe);
    expect(cands[1]).toBe(profileJson);
  });

  it("fetchProfile parses base64-encoded api_ph", async () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    const p = await c.fetchProfile(
      `kuaishou.web.cp.api_ph=${encodeURIComponent(b64)}`,
    );
    expect(p).toMatchObject({
      uid: "424242",
      nickname: "B64User",
      kuaishouId: "b64_ks",
    });
    expect(c.lastErrorCode).toBe(0);
  });

  it("fetchProfile still rejects non-JSON non-base64 payload with -9", async () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(
      await c.fetchProfile(
        `kuaishou.web.cp.api_ph=${encodeURIComponent("%%not-b64%%")}`,
      ),
    ).toBe(null);
    expect(c.lastErrorCode).toBe(-9);
  });

  it("extractUid falls back to base64 api_ph nested user_id", () => {
    const c = new KuaishouApiClient({ fetch: () => {} });
    expect(
      c.extractUid(`kuaishou.web.cp.api_ph=${encodeURIComponent(b64)}`),
    ).toBe("424242");
  });
});
