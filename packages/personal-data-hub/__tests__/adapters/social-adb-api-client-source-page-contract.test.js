"use strict";

import { describe, expect, it, vi } from "vitest";

const {
  BilibiliApiClient,
} = require("../../lib/adapters/social-bilibili-adb/api-client");
const {
  KuaishouApiClient,
} = require("../../lib/adapters/social-kuaishou-adb/api-client");
const {
  ToutiaoApiClient,
} = require("../../lib/adapters/social-toutiao-adb/api-client");
const {
  WeiboApiClient,
} = require("../../lib/adapters/social-weibo-adb/api-client");
const {
  XhsApiClient,
} = require("../../lib/adapters/social-xiaohongshu-adb/api-client");

function makeJsonFetch(resolveResponse) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const response = await resolveResponse(String(url), opts);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response),
    };
  };
  return { fetch, calls };
}

function passthroughSignProvider() {
  return {
    signUrl: vi.fn(async (url) => new URL(String(url))),
    signedHeaders: vi.fn(async () => ({})),
  };
}

const cases = [
  {
    name: "bilibili",
    createClient(fetch) {
      const client = new BilibiliApiClient({ fetch });
      client.setMintedBuvid3ForTest("TEST_BUVID3");
      client.setWbiMixinKeyForTest("a".repeat(32));
      return client;
    },
    invoke(client, opts) {
      return client.fetchFollows("SESSDATA=test", 123, opts);
    },
    explicit: { code: -412, message: "anti-spider" },
    unknown: { code: 0, data: {} },
    pageResponse(url) {
      const page = Number(new URL(url).searchParams.get("pn"));
      return {
        code: 0,
        data: {
          list: [
            {
              mid: page,
              uname: `user-${page}`,
              mtime: 1700000000 + page,
            },
          ],
          has_more: page === 1,
        },
      };
    },
    ids: (items) => items.map((item) => String(item.mid)),
    assertSecondRequest(call) {
      expect(new URL(call.url).searchParams.get("pn")).toBe("2");
    },
  },
  {
    name: "kuaishou",
    createClient(fetch) {
      return new KuaishouApiClient({
        fetch,
        signProvider: passthroughSignProvider(),
      });
    },
    invoke(client, opts) {
      return client.fetchWatchHistory("userId=123", opts);
    },
    explicit: { errors: [{ message: "unauthorized" }] },
    unknown: { data: { visionFeedRecommend: {} } },
    malformed: {
      data: {
        visionFeedRecommend: {
          feeds: [
            { photo: { caption: "missing id" } },
            {
              photo: {
                id: "valid",
                caption: "valid",
                timestamp: 1700000000,
              },
            },
          ],
          pcursor: "no_more",
        },
      },
    },
    pageResponse(_url, opts) {
      const cursor = JSON.parse(opts.body).variables.pcursor;
      const page = cursor ? 2 : 1;
      return {
        data: {
          visionFeedRecommend: {
            feeds: [
              {
                photo: {
                  id: String(page),
                  caption: `photo-${page}`,
                  timestamp: 1700000000 + page,
                },
              },
            ],
            pcursor: page === 1 ? "cursor-2" : "no_more",
          },
        },
      };
    },
    ids: (items) => items.map((item) => item.photoId),
    assertSecondRequest(call) {
      expect(JSON.parse(call.opts.body).variables.pcursor).toBe("cursor-2");
    },
  },
  {
    name: "toutiao",
    createClient(fetch) {
      return new ToutiaoApiClient({
        fetch,
        signProvider: passthroughSignProvider(),
      });
    },
    invoke(client, opts) {
      return client.fetchCollection("sessionid=test", opts);
    },
    explicit: { err_no: 1, message: "params illegal", data: [] },
    unknown: { err_no: 0, data: {} },
    malformed: {
      err_no: 0,
      data: [
        { title: "missing id" },
        {
          group_id: "valid",
          title: "valid",
          behot_time: 1700000000,
        },
      ],
      has_more: false,
    },
    pageResponse(url) {
      const offset = Number(new URL(url).searchParams.get("offset") || 0);
      const page = offset > 0 ? 2 : 1;
      return {
        err_no: 0,
        data: [
          {
            group_id: String(page),
            title: `saved-${page}`,
            behot_time: 1700000000 + page,
          },
        ],
        has_more: page === 1,
        next_offset: page,
      };
    },
    ids: (items) => items.map((item) => item.itemId),
    assertSecondRequest(call) {
      expect(new URL(call.url).searchParams.get("offset")).toBe("1");
    },
  },
  {
    name: "weibo",
    createClient(fetch) {
      return new WeiboApiClient({ fetch });
    },
    invoke(client, opts) {
      return client.fetchFavourites("SUB=test", opts);
    },
    explicit: { ok: -100, msg: "anti-bot" },
    unknown: { ok: 1, data: {} },
    pageResponse(url) {
      const page = Number(new URL(url).searchParams.get("page"));
      return {
        ok: 1,
        data: {
          favorites: [
            {
              favorited_time: "1716383021",
              status: {
                mid: String(page),
                text: `favorite-${page}`,
              },
            },
          ],
          maxPage: 2,
        },
      };
    },
    ids: (items) => items.map((item) => item.mid),
    assertSecondRequest(call) {
      expect(new URL(call.url).searchParams.get("page")).toBe("2");
    },
  },
  {
    name: "xiaohongshu",
    createClient(fetch) {
      return new XhsApiClient({
        fetch,
        signProvider: passthroughSignProvider(),
      });
    },
    invoke(client, opts) {
      return client.fetchLiked("a1=fingerprint", "fingerprint", opts);
    },
    explicit: { success: false, code: -100, msg: "expired" },
    unknown: { success: true, code: 0, data: {} },
    malformed: {
      success: true,
      code: 0,
      data: {
        notes: [
          { display_title: "missing id" },
          { note_id: "valid", display_title: "valid" },
        ],
        has_more: false,
      },
    },
    pageResponse(url) {
      const cursor = new URL(url).searchParams.get("cursor");
      const page = cursor ? 2 : 1;
      return {
        success: true,
        code: 0,
        data: {
          notes: [
            {
              note_id: String(page),
              display_title: `liked-${page}`,
            },
          ],
          has_more: page === 1,
          cursor: page === 1 ? "cursor-2" : "done",
        },
      };
    },
    ids: (items) => items.map((item) => item.noteId),
    assertSecondRequest(call) {
      expect(new URL(call.url).searchParams.get("cursor")).toBe("cursor-2");
    },
  },
];

const DEEP_PAGE_COUNT = 11;
const DEEP_PAGE_SIZE = 20;

function deepPageItems(page, createItem) {
  return Array.from({ length: DEEP_PAGE_SIZE }, (_, index) => {
    const id = (page - 1) * DEEP_PAGE_SIZE + index + 1;
    return createItem(id);
  });
}

function deepPageResponse(name, url, opts) {
  if (name === "bilibili") {
    const page = Number(new URL(url).searchParams.get("pn"));
    return {
      code: 0,
      data: {
        list: deepPageItems(page, (id) => ({
          mid: id,
          uname: `user-${id}`,
          mtime: 1700000000 + id,
        })),
        has_more: page < DEEP_PAGE_COUNT,
      },
    };
  }

  if (name === "kuaishou") {
    const variables = JSON.parse(opts.body).variables;
    const page = variables.pcursor
      ? Number(String(variables.pcursor).split("-").at(-1))
      : 1;
    return {
      data: {
        visionFeedRecommend: {
          feeds: deepPageItems(page, (id) => ({
            photo: {
              id: String(id),
              caption: `photo-${id}`,
              timestamp: 1700000000 + id,
            },
          })),
          pcursor: page < DEEP_PAGE_COUNT ? `cursor-${page + 1}` : "no_more",
        },
      },
    };
  }

  if (name === "toutiao") {
    const offset = Number(new URL(url).searchParams.get("offset") || 0);
    const page = Math.floor(offset / DEEP_PAGE_SIZE) + 1;
    return {
      err_no: 0,
      data: deepPageItems(page, (id) => ({
        group_id: String(id),
        title: `saved-${id}`,
        behot_time: 1700000000 + id,
      })),
      has_more: page < DEEP_PAGE_COUNT,
      next_offset: page * DEEP_PAGE_SIZE,
    };
  }

  if (name === "weibo") {
    const page = Number(new URL(url).searchParams.get("page"));
    return {
      ok: 1,
      data: {
        favorites: deepPageItems(page, (id) => ({
          favorited_time: String(1700000000 + id),
          status: {
            mid: String(id),
            text: `favorite-${id}`,
          },
        })),
        maxPage: DEEP_PAGE_COUNT,
      },
    };
  }

  const cursor = new URL(url).searchParams.get("cursor");
  const page = cursor ? Number(cursor.split("-").at(-1)) : 1;
  return {
    success: true,
    code: 0,
    data: {
      notes: deepPageItems(page, (id) => ({
        note_id: String(id),
        display_title: `liked-${id}`,
      })),
      has_more: page < DEEP_PAGE_COUNT,
      cursor: page < DEEP_PAGE_COUNT ? `cursor-${page + 1}` : "done",
    },
  };
}

function expectFiniteRequestPageSize(name, calls) {
  for (const call of calls) {
    expect(call.url).not.toContain("Infinity");
  }
  if (name === "kuaishou") {
    for (const call of calls) {
      expect(Number.isFinite(JSON.parse(call.opts.body).variables.count)).toBe(
        true,
      );
    }
  }
  if (name === "toutiao") {
    for (const call of calls) {
      const count = Number(new URL(call.url).searchParams.get("count"));
      expect(Number.isFinite(count)).toBe(true);
    }
  }
}

describe("social ADB API client strict source-page matrix", () => {
  it.each(cases)(
    "$name rejects an explicit source error instead of returning []",
    async ({ createClient, explicit, invoke }) => {
      const { fetch } = makeJsonFetch(() => explicit);
      const client = createClient(fetch);

      await expect(invoke(client, {})).rejects.toMatchObject({
        name: "SourcePageError",
        code: "SOURCE_PAGE_ERROR",
      });
      expect(client.lastErrorCode).not.toBe(0);
    },
  );

  it.each(cases)(
    "$name rejects an unknown list envelope instead of treating it as empty",
    async ({ createClient, invoke, unknown }) => {
      const { fetch } = makeJsonFetch(() => unknown);
      const client = createClient(fetch);

      await expect(invoke(client, {})).rejects.toMatchObject({
        name: "SourcePageError",
        code: "SOURCE_PAGE_UNRECOGNIZED",
      });
    },
  );

  it.each(cases)(
    "$name follows source pagination, calls the page hook, and honors maxPages",
    async ({
      assertSecondRequest,
      createClient,
      ids,
      invoke,
      pageResponse,
    }) => {
      const paged = makeJsonFetch(pageResponse);
      const pageHook = vi.fn();
      const client = createClient(paged.fetch);

      const all = await invoke(client, {
        beforeSourceRequest: pageHook,
        maxPages: 2,
      });

      expect(ids(all)).toEqual(["1", "2"]);
      expect(paged.calls).toHaveLength(2);
      expect(pageHook.mock.calls.map(([request]) => request.page)).toEqual([
        1, 2,
      ]);
      assertSecondRequest(paged.calls[1]);

      const bounded = makeJsonFetch(pageResponse);
      const boundedHook = vi.fn();
      const boundedClient = createClient(bounded.fetch);
      const firstPageOnly = await invoke(boundedClient, {
        beforeSourceRequest: boundedHook,
        maxPages: 1,
      });

      expect(ids(firstPageOnly)).toEqual(["1"]);
      expect(bounded.calls).toHaveLength(1);
      expect(boundedHook).toHaveBeenCalledOnce();
    },
  );

  it.each(cases)(
    "$name stops a repeated source page without returning duplicate items",
    async ({ createClient, ids, invoke, pageResponse }) => {
      let repeatedResponse;
      const repeated = makeJsonFetch(async (url, opts) => {
        if (repeatedResponse === undefined) {
          repeatedResponse = await pageResponse(url, opts);
        }
        return repeatedResponse;
      });
      const pageHook = vi.fn();
      const client = createClient(repeated.fetch);

      const items = await invoke(client, {
        beforeSourceRequest: pageHook,
        maxPages: 5,
      });

      expect(ids(items)).toEqual(["1"]);
      expect(repeated.calls).toHaveLength(2);
      expect(pageHook).toHaveBeenCalledTimes(2);
    },
  );

  it.each(cases)(
    "$name drains past the old default page and result budgets",
    async ({ createClient, ids, invoke, name }) => {
      const paged = makeJsonFetch((url, opts) =>
        deepPageResponse(name, url, opts),
      );
      const client = createClient(paged.fetch);

      const items = await invoke(client, {});
      const itemIds = ids(items);

      expect(itemIds).toHaveLength(DEEP_PAGE_COUNT * DEEP_PAGE_SIZE);
      expect(new Set(itemIds).size).toBe(DEEP_PAGE_COUNT * DEEP_PAGE_SIZE);
      expect(paged.calls).toHaveLength(DEEP_PAGE_COUNT);
      expectFiniteRequestPageSize(name, paged.calls);
    },
  );

  it.each(cases)(
    "$name preserves completed-page results when the next transport fails",
    async ({ createClient, ids, invoke, pageResponse }) => {
      let callCount = 0;
      const partial = makeJsonFetch(async (url, opts) => {
        callCount += 1;
        if (callCount > 1) throw new Error("transport failed");
        return pageResponse(url, opts);
      });
      const client = createClient(partial.fetch);

      const items = await invoke(client, { maxPages: 2 });

      expect(ids(items)).toEqual(["1"]);
      expect(partial.calls).toHaveLength(2);
      expect(client.lastErrorCode).toBe(-2);
    },
  );

  it.each(cases.filter((entry) => entry.malformed))(
    "$name filters malformed leading rows before applying the result limit",
    async ({ createClient, ids, invoke, malformed }) => {
      const source = makeJsonFetch(() => malformed);
      const client = createClient(source.fetch);

      const items = await invoke(client, { limit: 1 });

      expect(ids(items)).toEqual(["valid"]);
    },
  );
});
