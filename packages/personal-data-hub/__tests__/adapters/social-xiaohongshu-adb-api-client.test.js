"use strict";

import { describe, it, expect, vi } from "vitest";

const {
  XhsApiClient,
  _internals,
} = require("../../lib/adapters/social-xiaohongshu-adb/api-client");
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

const ME_OK = {
  body: JSON.stringify({
    code: 0,
    success: true,
    data: { user_id: "5e8c8f7e000000000100abcd", nickname: "Alice" },
  }),
};

describe("parseCount", () => {
  it("parses 万 suffix (1.2万 → 12000)", () => {
    expect(_internals.parseCount("1.2万")).toBe(12000);
  });

  it("parses w+ / W+ suffix (10w+ → 100000)", () => {
    expect(_internals.parseCount("10w+")).toBe(100000);
    expect(_internals.parseCount("10W+")).toBe(100000);
  });

  it("parses bare w / W suffix (3w → 30000)", () => {
    expect(_internals.parseCount("3w")).toBe(30000);
    expect(_internals.parseCount("3W")).toBe(30000);
  });

  it("parses 亿 suffix (1.5亿 → 150000000)", () => {
    expect(_internals.parseCount("1.5亿")).toBe(150000000);
  });

  it("parses plain integer string", () => {
    expect(_internals.parseCount("234")).toBe(234);
  });

  it("returns 0 for empty / non-string / non-numeric", () => {
    expect(_internals.parseCount("")).toBe(0);
    expect(_internals.parseCount(null)).toBe(0);
    expect(_internals.parseCount(42)).toBe(0);
    expect(_internals.parseCount("abc")).toBe(0);
    expect(_internals.parseCount("x万")).toBe(0);
  });
});

describe("normalizeMs", () => {
  it("passes ms through, multiplies seconds, returns 0 for invalid", () => {
    expect(_internals.normalizeMs(1700000000000)).toBe(1700000000000);
    expect(_internals.normalizeMs(1700000000)).toBe(1700000000 * 1000);
    expect(_internals.normalizeMs(0)).toBe(0);
    expect(_internals.normalizeMs(-1)).toBe(0);
    expect(_internals.normalizeMs("1700000000")).toBe(0);
  });
});

describe("XhsApiClient — construction", () => {
  it("defaults to NULL_SIGN_PROVIDER", () => {
    const c = new XhsApiClient({ fetch: () => {} });
    expect(c.signProvider).toBe(NULL_SIGN_PROVIDER);
  });

  it("normalizes baseUrl to trailing slash", () => {
    const c = new XhsApiClient({
      fetch: () => {},
      baseUrl: "https://edith.example.com",
    });
    expect(c.baseUrl).toBe("https://edith.example.com/");
  });

  it("throws when fetch unavailable", () => {
    vi.stubGlobal("fetch", undefined);
    try {
      expect(() => new XhsApiClient({})).toThrow(/fetch not available/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("XhsApiClient — fetchMe (cookies-only, no X-S)", () => {
  it("returns {userId, nickname} and sends desktop-Chrome headers without X-S", async () => {
    const { fakeFetch, calls } = makeFakeFetch([["user/me", ME_OK]]);
    const c = new XhsApiClient({ fetch: fakeFetch });
    const me = await c.fetchMe("a1=fp; web_session=tok");
    expect(me).toEqual({
      userId: "5e8c8f7e000000000100abcd",
      nickname: "Alice",
    });
    expect(calls).toHaveLength(1);
    const headers = calls[0].opts.headers;
    expect(headers.Cookie).toBe("a1=fp; web_session=tok");
    // xhs web is desktop-tuned — UA must NOT be mobile
    expect(headers["User-Agent"]).toContain("Windows NT 10.0");
    expect(headers.Referer).toBe("https://www.xiaohongshu.com/");
    // /user/me is the unsigned endpoint
    expect(headers["X-S"]).toBeUndefined();
    expect(headers["X-T"]).toBeUndefined();
    expect(c.lastErrorCode).toBe(0);
  });

  it("returns null with -7 when user_id blank (web_session missing)", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "user/me",
        { body: JSON.stringify({ code: 0, data: { nickname: "Ghost" } }) },
      ],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch });
    expect(await c.fetchMe("a1=fp")).toBe(null);
    expect(c.lastErrorCode).toBe(-7);
    expect(c.lastErrorMessage).toMatch(/web_session/);
  });

  it("returns null on HTTP error status (461 anti-bot)", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["user/me", { status: 461, body: "blocked" }],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch });
    expect(await c.fetchMe("a1=fp")).toBe(null);
    expect(c.lastErrorCode).toBe(461);
  });

  it("returns null with -4 on non-JSON body (login redirect HTML)", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["user/me", { body: "<html>login</html>" }],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch });
    expect(await c.fetchMe("a1=fp")).toBe(null);
    expect(c.lastErrorCode).toBe(-4);
  });

  it("returns null with -3 on truncated JSON", async () => {
    const { fakeFetch } = makeFakeFetch([["user/me", { body: '{"code":0,' }]]);
    const c = new XhsApiClient({ fetch: fakeFetch });
    expect(await c.fetchMe("a1=fp")).toBe(null);
    expect(c.lastErrorCode).toBe(-3);
  });

  it("returns null with -5 on success=false", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["user/me", { body: JSON.stringify({ success: false, data: {} }) }],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch });
    expect(await c.fetchMe("a1=fp")).toBe(null);
    expect(c.lastErrorCode).toBe(-5);
  });

  it("surfaces xhs business error code + msg", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "user/me",
        { body: JSON.stringify({ code: -100, msg: "登录已过期" }) },
      ],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch });
    expect(await c.fetchMe("a1=fp")).toBe(null);
    expect(c.lastErrorCode).toBe(-100);
    expect(c.lastErrorMessage).toBe("登录已过期");
  });

  it("returns null with -2 on network throw", async () => {
    const c = new XhsApiClient({
      fetch: async () => {
        throw new Error("ECONNRESET");
      },
    });
    expect(await c.fetchMe("a1=fp")).toBe(null);
    expect(c.lastErrorCode).toBe(-2);
    expect(c.lastErrorMessage).toMatch(/ECONNRESET/);
  });
});

describe("XhsApiClient — signProvider injection (bridge vs fallback)", () => {
  const NOTES_OK = {
    body: JSON.stringify({
      code: 0,
      data: {
        notes: [
          {
            note_id: "N1",
            display_title: "Note one",
            type: "normal",
            time: 1700000000,
            interact_info: {
              liked_count: "1.2万",
              collected_count: "10w+",
              comment_count: "234",
            },
          },
        ],
      },
    }),
  };

  it("uses bridge headers verbatim when bridge produces them", async () => {
    const { fakeFetch, calls } = makeFakeFetch([["user_posted", NOTES_OK]]);
    const sign = {
      signedHeaders: vi.fn(async (_url, _purpose) => ({
        "X-s": "XYW_BRIDGE",
        "X-t": "1716383021000",
        "X-s-common": "common",
      })),
    };
    const c = new XhsApiClient({ fetch: fakeFetch, signProvider: sign });
    const notes = await c.fetchNotes("a1=fp; web_session=t", "fp", "U1");
    expect(notes).toHaveLength(1);
    expect(sign.signedHeaders).toHaveBeenCalledOnce();
    // purpose = "<path+query>|" (GET — empty body after pipe)
    const [, purpose] = sign.signedHeaders.mock.calls[0];
    expect(purpose).toMatch(/^\/api\/sns\/web\/v2\/user_posted\?/);
    expect(purpose.endsWith("|")).toBe(true);
    expect(calls[0].opts.headers["X-s"]).toBe("XYW_BRIDGE");
    // bridge path must NOT also attach the fallback md5 X-S
    expect(calls[0].opts.headers["X-S"]).toBeUndefined();
    expect(c._bridgeHits).toBe(1);
    expect(c._fallbackHits).toBe(0);
  });

  it("falls back to in-process computeXsXt when bridge returns {} (NULL provider)", async () => {
    const { fakeFetch, calls } = makeFakeFetch([["user_posted", NOTES_OK]]);
    const c = new XhsApiClient({
      fetch: fakeFetch,
      now: () => 1716383021000,
    });
    const notes = await c.fetchNotes("a1=fp; web_session=t", "fp", "U1");
    // unlike Kuaishou (-99 short-circuit), xhs degrades to best-effort md5
    // and the HTTP request IS made
    expect(notes).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.headers["X-S"]).toMatch(/^XYW_/);
    expect(calls[0].opts.headers["X-T"]).toBe("1716383021000");
    expect(c._fallbackHits).toBe(1);
    expect(c._bridgeHits).toBe(0);
  });

  it("skips signing entirely when a1 missing", async () => {
    const { fakeFetch, calls } = makeFakeFetch([["user_posted", NOTES_OK]]);
    const sign = { signedHeaders: vi.fn(async () => ({ "X-s": "X" })) };
    const c = new XhsApiClient({ fetch: fakeFetch, signProvider: sign });
    await c.fetchNotes("web_session=t", null, "U1");
    expect(sign.signedHeaders).not.toHaveBeenCalled();
    expect(calls[0].opts.headers["X-S"]).toBeUndefined();
    expect(calls[0].opts.headers["X-s"]).toBeUndefined();
  });
});

describe("XhsApiClient — fetchNotes parsing", () => {
  it("parses notes with count strings + seconds→ms timestamp", async () => {
    const { fakeFetch, calls } = makeFakeFetch([
      [
        "user_posted",
        {
          body: JSON.stringify({
            code: 0,
            data: {
              notes: [
                {
                  note_id: "N1",
                  display_title: "Note one",
                  desc: "desc",
                  type: "video",
                  time: 1700000000,
                  interact_info: {
                    liked_count: "1.2万",
                    collected_count: "10w+",
                    comment_count: "234",
                  },
                },
              ],
            },
          }),
        },
      ],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch, now: () => 1 });
    const notes = await c.fetchNotes("a1=fp", "fp", "U1");
    expect(notes[0]).toEqual({
      noteId: "N1",
      title: "Note one",
      desc: "desc",
      type: "video",
      createdAt: 1700000000 * 1000,
      likedCount: 12000,
      collectedCount: 100000,
      commentCount: 234,
    });
    // request carries user_id param
    expect(calls[0].url).toContain("user_id=U1");
  });

  it("accepts id alias, skips entries without any id, applies limit", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "user_posted",
        {
          body: JSON.stringify({
            code: 0,
            data: {
              notes: [
                { id: "ALIAS", title: "t" },
                { title: "no id — skipped" },
                { note_id: "N2" },
                { note_id: "N3-over-limit" },
              ],
            },
          }),
        },
      ],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch, now: () => 1 });
    const notes = await c.fetchNotes("a1=fp", "fp", "U1", { limit: 3 });
    // limit caps the SCAN window (first 3 entries), so the skipped
    // no-id entry leaves 2 results
    expect(notes.map((n) => n.noteId)).toEqual(["ALIAS", "N2"]);
    expect(notes[0].title).toBe("t");
    expect(notes[1].title).toBe("(no title)");
  });

  it("returns [] on endpoint failure", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["user_posted", { status: 461, body: "sig rejected" }],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch, now: () => 1 });
    expect(await c.fetchNotes("a1=fp", "fp", "U1")).toEqual([]);
    expect(c.lastErrorCode).toBe(461);
  });
});

describe("XhsApiClient — fetchLiked parsing", () => {
  it("parses liked notes (likedAt left 0 for collector to fill)", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "note/like/page",
        {
          body: JSON.stringify({
            code: 0,
            data: {
              notes: [
                {
                  note_id: "L1",
                  display_title: "Liked one",
                  user: { nickname: "AuthorX" },
                },
                { title: "no note_id — skipped" },
              ],
            },
          }),
        },
      ],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch, now: () => 1 });
    const liked = await c.fetchLiked("a1=fp", "fp");
    expect(liked).toHaveLength(1);
    expect(liked[0]).toEqual({
      noteId: "L1",
      title: "Liked one",
      likedAt: 0,
      authorNickname: "AuthorX",
    });
  });

  it("returns [] when data.notes missing", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["note/like/page", { body: JSON.stringify({ code: 0, data: {} }) }],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch, now: () => 1 });
    expect(await c.fetchLiked("a1=fp", "fp")).toEqual([]);
  });
});

describe("XhsApiClient — fetchFollows parsing", () => {
  it("parses follow list with userId passthrough", async () => {
    const { fakeFetch, calls } = makeFakeFetch([
      [
        "follow/list",
        {
          body: JSON.stringify({
            code: 0,
            data: {
              users: [
                {
                  user_id: "F1",
                  nickname: "FollowOne",
                  image: "https://a/f1.jpg",
                },
                { nickname: "no user_id — skipped" },
                { user_id: "F2" },
              ],
            },
          }),
        },
      ],
    ]);
    const c = new XhsApiClient({ fetch: fakeFetch, now: () => 1 });
    const follows = await c.fetchFollows("a1=fp", "fp", "U1");
    expect(follows).toHaveLength(2);
    expect(follows[0]).toEqual({
      userId: "F1",
      nickname: "FollowOne",
      image: "https://a/f1.jpg",
      followedAt: 0,
    });
    expect(follows[1].nickname).toBe("(unnamed)");
    expect(calls[0].url).toContain("user_id=U1");
  });
});
