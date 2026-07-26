"use strict";

import { describe, expect, it } from "vitest";

const {
  BilibiliApiClient,
} = require("../../lib/adapters/social-bilibili-adb/api-client");
const {
  XhsApiClient,
} = require("../../lib/adapters/social-xiaohongshu-adb/api-client");
const {
  ToutiaoApiClient,
} = require("../../lib/adapters/social-toutiao-adb/api-client");
const {
  KuaishouApiClient,
} = require("../../lib/adapters/social-kuaishou-adb/api-client");
const {
  WeiboApiClient,
} = require("../../lib/adapters/social-weibo-adb/api-client");

function unavailableFetch() {
  throw new Error("network should be replaced by the test seam");
}

function repeatedBilibiliHistory() {
  const client = new BilibiliApiClient({ fetch: unavailableFetch });
  client._prepareRequest = async (cookie, url) => ({ cookie, url });
  client._doGetJson = async () => ({
    data: {
      list: [
        {
          bvid: "BV-repeat",
          title: "Repeated history",
          view_at: 1_716_383_021,
        },
      ],
      cursor: { max: 1, view_at: 1 },
    },
  });
  return client.fetchHistory("SESSDATA=test");
}

function repeatedXhsNotes(opts = {}) {
  const client = new XhsApiClient({ fetch: unavailableFetch });
  client._doGetJson = async () => ({
    data: {
      notes: [
        {
          note_id: "note-repeat",
          display_title: "Repeated note",
          time: 1_716_383_021,
        },
      ],
      has_more: true,
      cursor: "same-cursor",
    },
  });
  return client.fetchNotes("a1=test", "test", "user-1", opts);
}

function repeatedToutiaoFeed() {
  const client = new ToutiaoApiClient({ fetch: unavailableFetch });
  client._doGetJson = async () => ({
    data: [
      {
        group_id: "feed-repeat",
        title: "Repeated feed item",
        behot_time: 1_716_383_021,
      },
    ],
    has_more: true,
    next_max_behot_time: 1,
  });
  return client.fetchFeed("sessionid=test");
}

function repeatedKuaishouWatch() {
  const client = new KuaishouApiClient({ fetch: unavailableFetch });
  client._signedGraphQL = async () => ({
    data: {
      visionFeedRecommend: {
        feeds: [
          {
            photo: {
              id: "photo-repeat",
              caption: "Repeated photo",
              timestamp: 1_716_383_021,
            },
            author: { id: "author-1", name: "Author" },
          },
        ],
        hasMore: true,
        pcursor: "same-cursor",
      },
    },
  });
  return client.fetchWatchHistory("userId=1");
}

function repeatedWeiboPosts() {
  const client = new WeiboApiClient({ fetch: unavailableFetch });
  client._doGetJson = async () => ({
    ok: 1,
    data: {
      cards: [
        {
          card_type: 9,
          mblog: {
            id: "post-repeat",
            text: "Repeated post",
            created_at: "1716383021",
          },
        },
      ],
      cardlistInfo: { since_id: "same-cursor" },
    },
  });
  return client.fetchPosts("SUB=test", 1);
}

describe("ADB social API default pagination", () => {
  it.each([
    ["Bilibili", repeatedBilibiliHistory],
    ["Xiaohongshu", repeatedXhsNotes],
    ["Toutiao", repeatedToutiaoFeed],
    ["Kuaishou", repeatedKuaishouWatch],
    ["Weibo", repeatedWeiboPosts],
  ])(
    "%s fails closed when an unbounded source page repeats",
    async (_name, run) => {
      await expect(run()).rejects.toMatchObject({
        code: "SOURCE_PAGE_STALLED",
      });
    },
  );

  it("preserves explicit finite maxPages sampling", async () => {
    await expect(repeatedXhsNotes({ maxPages: 2 })).resolves.toHaveLength(1);
  });
});
