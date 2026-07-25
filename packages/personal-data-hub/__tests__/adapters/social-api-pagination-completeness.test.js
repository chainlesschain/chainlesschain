"use strict";

import { describe, expect, it } from "vitest";

const { ZhihuAdapter } = require("../../lib/adapters/social-zhihu");
const { DoubanAdapter } = require("../../lib/adapters/social-douban");
const { CsdnAdapter } = require("../../lib/adapters/social-csdn");
const { DongchediAdapter } = require("../../lib/adapters/social-dongchedi");

async function collect(iterable) {
  const rows = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

describe("social cookie API default pagination", () => {
  it("collects more than ten Zhihu pages before completing", async () => {
    const offsets = [];
    let complete = false;
    const adapter = new ZhihuAdapter({
      account: { cookies: "z_c0=token", urlToken: "alice" },
      fetchFn: async ({ query }) => {
        offsets.push(query.offset);
        return {
          data: Array.from({ length: 20 }, (_, index) => ({
            id: `answer-${query.offset + index}`,
            question: { title: `question-${query.offset + index}` },
            excerpt: "answer",
            created_time: 1716300000 - query.offset - index,
          })),
          paging: { is_end: query.offset === 200 },
        };
      },
    });

    const rows = await collect(
      adapter.sync({
        include: { favourite: false, follow: false },
        markWatermarkComplete: () => {
          complete = true;
        },
      }),
    );

    expect(rows).toHaveLength(220);
    expect(offsets).toEqual(
      Array.from({ length: 11 }, (_, index) => index * 20),
    );
    expect(complete).toBe(true);
  });

  it("collects more than ten Douban pages before completing", async () => {
    const starts = [];
    let complete = false;
    const adapter = new DoubanAdapter({
      account: { cookies: "bid=token", userId: "alice" },
      fetchFn: async ({ query }) => {
        starts.push(query.start);
        return {
          interests: Array.from({ length: 20 }, (_, index) => ({
            id: `interest-${query.start + index}`,
            status: "done",
            create_time: "2024-01-01 00:00:00",
            subject: {
              id: `subject-${query.start + index}`,
              title: `subject-${query.start + index}`,
              type: "book",
            },
          })),
          total: 220,
        };
      },
    });

    const rows = await collect(
      adapter.sync({
        include: { follow: false, review: false },
        markWatermarkComplete: () => {
          complete = true;
        },
      }),
    );

    expect(rows).toHaveLength(220);
    expect(starts).toEqual(
      Array.from({ length: 11 }, (_, index) => index * 20),
    );
    expect(complete).toBe(true);
  });

  it("collects more than ten CSDN pages before completing", async () => {
    const pages = [];
    let complete = false;
    const adapter = new CsdnAdapter({
      account: { cookies: "UserToken=token", username: "alice" },
      fetchFn: async ({ query }) => {
        pages.push(query.page);
        return {
          list:
            query.page <= 11
              ? [
                  {
                    articleId: `article-${query.page}`,
                    title: `article-${query.page}`,
                    createdTime: 1716300000 - query.page,
                  },
                ]
              : [],
        };
      },
    });

    const rows = await collect(
      adapter.sync({
        include: { favourite: false, follow: false },
        markWatermarkComplete: () => {
          complete = true;
        },
      }),
    );

    expect(rows).toHaveLength(11);
    expect(pages).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(complete).toBe(true);
  });

  it("collects more than ten Dongchedi pages before completing", async () => {
    const offsets = [];
    let complete = false;
    const adapter = new DongchediAdapter({
      account: { cookies: "sessionid=token", userId: "alice" },
      fetchFn: async ({ query }) => {
        offsets.push(query.offset);
        return {
          data: {
            list: [
              {
                group_id: `favourite-${query.offset}`,
                title: `favourite-${query.offset}`,
                create_time: 1716300000 - query.offset,
              },
            ],
            has_more: query.offset < 10,
          },
        };
      },
    });

    const rows = await collect(
      adapter.sync({
        include: { follow: false },
        markWatermarkComplete: () => {
          complete = true;
        },
      }),
    );

    expect(rows).toHaveLength(11);
    expect(offsets).toEqual(Array.from({ length: 11 }, (_, index) => index));
    expect(complete).toBe(true);
  });
});
