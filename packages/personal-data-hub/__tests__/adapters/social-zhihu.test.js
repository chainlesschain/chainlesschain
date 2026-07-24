"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  ZhihuAdapter,
  extractData,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/social-zhihu");
const { createJsonSourceFetch } = require("../../lib/source-http");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-zhihu-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "z_c0=abc; d_c0=xyz";

const SNAPSHOT = JSON.stringify({
  schemaVersion: 1,
  snapshottedAt: 1716383000000,
  account: { urlToken: "alice", name: "Alice" },
  events: [
    {
      kind: "answer",
      id: "answer-101",
      answerId: "101",
      questionTitle: "如何评价 X?",
      excerpt: "<p>我认为 X 很好</p>",
      voteupCount: 42,
      commentCount: 3,
      createdTime: 1716300000,
      url: "https://www.zhihu.com/answer/101",
    },
    {
      kind: "favourite",
      id: "fav-202",
      itemId: "202",
      title: "好文收藏",
      collectionName: "技术",
      capturedAt: 1716310000000,
    },
    {
      kind: "follow",
      id: "follow-bob",
      memberToken: "bob",
      name: "Bob",
      headline: "工程师",
      avatarUrl: "https://pic/bob.jpg",
      capturedAt: 1716320000000,
    },
  ],
});

describe("constants", () => {
  it("exposes name/version/schema", () => {
    expect(NAME).toBe("social-zhihu");
    expect(VERSION).toBe("0.2.0");
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
});

describe("extractData", () => {
  it("pulls data/items arrays; tolerant of bad shapes", () => {
    expect(extractData({ data: [{ id: 1 }] })).toHaveLength(1);
    expect(extractData({ items: [{ id: 1 }] })).toHaveLength(1);
    expect(extractData({})).toEqual([]);
    expect(extractData(null)).toEqual([]);
  });
});

describe("ZhihuAdapter snapshot mode", () => {
  it("authenticate validates inputPath readability", async () => {
    const p = writeTmp(SNAPSHOT);
    try {
      const a = new ZhihuAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe(
        "snapshot-file",
      );
      const bad = await a.authenticate({
        inputPath: path.join(os.tmpdir(), "nope-z.json"),
      });
      expect(bad.ok).toBe(false);
      expect(bad.reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync yields all 3 kinds + normalize answer→post, favourite→like, follow→person", async () => {
    const p = writeTmp(SNAPSHOT);
    try {
      const a = new ZhihuAdapter();
      const real = await collect(a.sync({ inputPath: p }));
      expect(real).toHaveLength(3);
      expect(real.map((x) => x.kind)).toEqual([
        "answer",
        "favourite",
        "follow",
      ]);

      const ans = a.normalize(real[0]);
      expect(ans.events[0].subtype).toBe("post");
      expect(ans.events[0].content.text).toBe("我认为 X 很好"); // html stripped
      expect(ans.events[0].extra.voteupCount).toBe(42);
      expect(ans.events[0].extra.questionTitle).toBe("如何评价 X?");

      const fav = a.normalize(real[1]);
      expect(fav.events[0].subtype).toBe("like");
      expect(fav.events[0].content.title).toBe("好文收藏");

      const fol = a.normalize(real[2]);
      expect(fol.persons[0].subtype).toBe("contact");
      expect(fol.persons[0].names).toEqual(["Bob"]);
      expect(fol.persons[0].identifiers["zhihu-token"]).toEqual(["bob"]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("respects include filter + limit", async () => {
    const p = writeTmp(SNAPSHOT);
    try {
      const a = new ZhihuAdapter();
      const onlyFollow = await collect(
        a.sync({ inputPath: p, include: { answer: false, favourite: false } }),
      );
      expect(onlyFollow.map((x) => x.kind)).toEqual(["follow"]);
      const limited = await collect(a.sync({ inputPath: p, limit: 1 }));
      expect(limited).toHaveLength(1);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("schemaVersion mismatch throws", async () => {
    const p = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    try {
      const a = new ZhihuAdapter();
      await expect(collect(a.sync({ inputPath: p }))).rejects.toThrow(
        /schemaVersion mismatch/,
      );
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("normalize throws on unknown kind", () => {
    const a = new ZhihuAdapter();
    expect(() => a.normalize({ kind: "bogus", payload: {} })).toThrow(
      /unknown kind/,
    );
  });
});

describe("ZhihuAdapter cookie-api mode", () => {
  it("authenticate cookie mode requires urlToken", async () => {
    const noTok = new ZhihuAdapter({ account: { cookies: COOKIES } });
    expect((await noTok.authenticate()).reason).toBe("NO_ACCOUNT_URL_TOKEN");
    const ok = new ZhihuAdapter({
      account: { cookies: COOKIES, urlToken: "alice" },
    });
    expect(await ok.authenticate()).toEqual({
      ok: true,
      account: "alice",
      mode: "cookie",
    });
  });

  it("accepts transient cookie + accountId without mutating the adapter", async () => {
    const a = new ZhihuAdapter({ fetchFn: async () => ({ data: [] }) });
    expect(
      await a.authenticate({
        cookie: COOKIES,
        accountId: "alice",
      }),
    ).toEqual({
      ok: true,
      account: "alice",
      mode: "cookie",
    });
    expect(
      (
        await a.authenticate({
          cookie: COOKIES,
        })
      ).reason,
    ).toBe("NO_ACCOUNT_URL_TOKEN");
    expect(a.account).toBe(null);
    expect(a._cookieAuth).toBe(null);

    const configured = new ZhihuAdapter({
      account: { cookies: COOKIES, urlToken: "configured-token" },
      fetchFn: async () => ({ data: [], paging: { is_end: true } }),
    });
    expect(
      (
        await configured.authenticate({
          cookie: "z_c0=another-account",
        })
      ).reason,
    ).toBe("NO_ACCOUNT_URL_TOKEN");
    await expect(
      collect(
        configured.sync({
          cookie: "z_c0=another-account",
        }),
      ),
    ).rejects.toThrow(/opts\.accountId required/u);
  });

  it("sync fetches answers/followees/collections, paginates, normalizes", async () => {
    const byUrl = (url) => {
      if (url.includes("/answers")) return "answers";
      if (url.includes("/followees")) return "followees";
      if (url.includes("/collections")) return "collections";
      return "?";
    };
    const data = {
      answers: [
        {
          id: "A1",
          question: { title: "Q1" },
          excerpt: "ans1",
          voteup_count: 9,
          created_time: 1716300000,
        },
      ],
      followees: [{ url_token: "bob", name: "Bob", headline: "eng" }],
      collections: [{ id: "C1", title: "我的收藏", is_public: true }],
    };
    const calls = [];
    let watermarkComplete = false;
    const fetchFn = async ({ url, cookies, query, headers }) => {
      const k = byUrl(url);
      calls.push({ k, cookies, offset: query.offset, headers });
      // single page each
      return {
        data: data[k],
        paging: { is_end: true },
      };
    };
    const a = new ZhihuAdapter({
      account: { cookies: COOKIES, urlToken: "alice" },
      fetchFn,
    });
    const items = await collect(
      a.sync({
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );
    expect(items.map((x) => x.kind).sort()).toEqual([
      "answer",
      "favourite",
      "follow",
    ]);
    expect(calls.every((c) => c.cookies === COOKIES)).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[0].headers).toMatchObject({
      referer: "https://www.zhihu.com/people/alice",
      "x-requested-with": "XMLHttpRequest",
    });

    const ans = a.normalize(items.find((x) => x.kind === "answer"));
    expect(ans.events[0].content.title).toBe("Q1");
    expect(ans.events[0].extra.voteupCount).toBe(9);
    const fol = a.normalize(items.find((x) => x.kind === "follow"));
    expect(fol.persons[0].names).toEqual(["Bob"]);
    expect(fol.persons[0].identifiers["zhihu-token"]).toEqual(["bob"]);
    const fav = a.normalize(items.find((x) => x.kind === "favourite"));
    expect(fav.events[0].content.title).toBe("我的收藏");
    expect(a.watermarkStrategy).toBe("max-captured-at");
    expect(a.watermarkRequiresCompleteScan).toBe(true);
    expect(watermarkComplete).toBe(true);
  });

  it("invokes signProvider when configured", async () => {
    const signCalls = [];
    const fetchCalls = [];
    const a = new ZhihuAdapter({
      account: { cookies: COOKIES, urlToken: "alice" },
      fetchFn: async (request) => {
        fetchCalls.push(request);
        return {
          data: [{ id: "A1", question: { title: "Q" }, excerpt: "x" }],
          paging: { is_end: true },
        };
      },
      signProvider: async (ctx) => {
        signCalls.push(ctx);
        return {
          xZse96: "x-zse-96-value",
          query: { sign: "must-not-enter-url" },
          headers: {
            cookie: "must-not-override-cookie",
            "x-extra": "must-not-be-forwarded",
          },
        };
      },
      // only answers to keep it short
    });
    const items = await collect(
      a.sync({ include: { follow: false, favourite: false } }),
    );
    expect(items.length).toBeGreaterThan(0);
    expect(signCalls.length).toBeGreaterThan(0);
    expect(signCalls[0].cookies).toBe(COOKIES);
    expect(fetchCalls[0].headers["x-zse-96"]).toBe("x-zse-96-value");
    expect(fetchCalls[0].headers).not.toHaveProperty("cookie");
    expect(fetchCalls[0].headers).not.toHaveProperty("x-extra");
    expect(fetchCalls[0].query).not.toHaveProperty("sign");
  });

  it("respects opts.limit across kinds", async () => {
    const a = new ZhihuAdapter({
      account: { cookies: COOKIES, urlToken: "alice" },
      fetchFn: async ({ query }) =>
        query.offset === 0
          ? {
              data: [
                { id: "A1", question: { title: "Q" }, excerpt: "x" },
                { id: "A2", question: { title: "Q2" }, excerpt: "y" },
              ],
              paging: { is_end: true },
            }
          : { data: [], paging: { is_end: true } },
    });
    const items = await collect(a.sync({ limit: 1 }));
    expect(items).toHaveLength(1);
  });

  it("unknown responses yield zero without advancing the watermark", async () => {
    let watermarkComplete = false;
    const a = new ZhihuAdapter({
      account: { cookies: COOKIES, urlToken: "alice" },
      fetchFn: async () => "not-json-login-redirect",
    });
    expect(
      await collect(
        a.sync({
          markWatermarkComplete: () => {
            watermarkComplete = true;
          },
        }),
      ),
    ).toEqual([]);
    expect(watermarkComplete).toBe(false);
  });

  it("shares maxPages across streams and only checkpoints a complete scan", async () => {
    const operations = [];
    let budgetedComplete = false;
    const budgeted = new ZhihuAdapter({
      account: { cookies: COOKIES, urlToken: "alice" },
      fetchFn: async () => ({
        data: Array.from({ length: 20 }, (_, index) => ({
          id: `A-${index}`,
          question: { title: `Q-${index}` },
          excerpt: "x",
        })),
        paging: { is_end: false },
      }),
    });
    expect(
      await collect(
        budgeted.sync({
          maxPages: 1,
          beforeSourceRequest: ({ operation }) => operations.push(operation),
          markWatermarkComplete: () => {
            budgetedComplete = true;
          },
        }),
      ),
    ).toHaveLength(20);
    expect(operations).toEqual(["answer"]);
    expect(budgetedComplete).toBe(false);

    let emptyComplete = false;
    const validEmpty = new ZhihuAdapter({
      account: { cookies: COOKIES, urlToken: "alice" },
      fetchFn: async () => ({
        data: [],
        paging: { is_end: true },
      }),
    });
    expect(
      await collect(
        validEmpty.sync({
          maxPages: 3,
          markWatermarkComplete: () => {
            emptyComplete = true;
          },
        }),
      ),
    ).toEqual([]);
    expect(emptyComplete).toBe(true);
  });

  it("composes runtime credentials with the constrained host transport", async () => {
    const calls = [];
    const sourceFetch = createJsonSourceFetch({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            data: [],
            paging: { is_end: true },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });
    const a = new ZhihuAdapter({ fetchFn: sourceFetch });

    expect(
      await collect(
        a.sync({
          cookie: COOKIES,
          accountId: "alice",
          maxPages: 3,
        }),
      ),
    ).toEqual([]);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.init.method === "GET")).toBe(true);
    expect(
      calls.every((call) => call.init.headers.get("cookie") === COOKIES),
    ).toBe(true);
    expect(
      calls.every(
        (call) =>
          call.init.headers.get("referer") ===
          "https://www.zhihu.com/people/alice",
      ),
    ).toBe(true);
    expect(
      calls.every(
        (call) =>
          call.init.headers.get("x-requested-with") === "XMLHttpRequest",
      ),
    ).toBe(true);
    expect(calls.every((call) => !call.url.includes("z_c0"))).toBe(true);
    expect(a.account).toBe(null);
    expect(a._cookieAuth).toBe(null);
  });

  it("surfaces HTTP authentication failures without completing the watermark", async () => {
    let watermarkComplete = false;
    const sourceFetch = createJsonSourceFetch({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 602,
              message: "authentication required",
            },
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
    });
    const a = new ZhihuAdapter({ fetchFn: sourceFetch });

    await expect(
      collect(
        a.sync({
          cookie: COOKIES,
          accountId: "alice",
          markWatermarkComplete: () => {
            watermarkComplete = true;
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "SOURCE_HTTP_ERROR",
      status: 401,
    });
    expect(watermarkComplete).toBe(false);
  });

  it("default fetch throws when no fetchFn", async () => {
    const a = new ZhihuAdapter({
      account: { cookies: COOKIES, urlToken: "alice" },
    });
    await expect(collect(a.sync({}))).rejects.toThrow(/no fetchFn configured/);
  });

  it("sync with no input/cookie throws", async () => {
    const a = new ZhihuAdapter();
    await expect(collect(a.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
