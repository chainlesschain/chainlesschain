"use strict";

import { describe, expect, it } from "vitest";

const { TaobaoAdapter } = require("../lib/adapters/shopping-taobao");
const { JdAdapter } = require("../lib/adapters/shopping-jd");
const { MeituanAdapter } = require("../lib/adapters/shopping-meituan");
const { ElemeAdapter } = require("../lib/adapters/shopping-eleme");
const { DianpingAdapter } = require("../lib/adapters/shopping-dianping");
const { PinduoduoAdapter } = require("../lib/adapters/shopping-pinduoduo");
const { XianyuAdapter } = require("../lib/adapters/shopping-xianyu");
const { VipshopAdapter } = require("../lib/adapters/shopping-vipshop");

const CASES = [
  ["shopping-taobao", TaobaoAdapter, { userId: "u-1" }, 1],
  ["shopping-jd", JdAdapter, { pin: "pin-1" }, 1],
  ["shopping-meituan", MeituanAdapter, { userId: "u-1" }, 2],
  ["shopping-eleme", ElemeAdapter, { userId: "u-1" }, 1],
  ["shopping-dianping", DianpingAdapter, { userId: "u-1" }, 1],
  ["shopping-pinduoduo", PinduoduoAdapter, { uid: "u-1" }, 1],
  ["shopping-xianyu", XianyuAdapter, { userId: "u-1" }, 2],
  ["shopping-vipshop", VipshopAdapter, { userId: "u-1" }, 1],
];

function makeOrders(count) {
  return Array.from({ length: count }, (_, index) => ({
    orderId: `order-${index + 1}`,
    merchantName: "Test merchant",
    createTime: 2_000_000_000_000 - index,
    totalAmount: 10,
  }));
}

function sourcePage(request) {
  const query = request.query || {};
  if (Number.isInteger(query.page)) return query.page;
  if (Number.isInteger(query.pageNumber)) return query.pageNumber;
  if (Number.isInteger(query.offset) && Number.isInteger(query.limit)) {
    return Math.floor(query.offset / query.limit) + 1;
  }
  return 1;
}

async function collect(iterable) {
  const records = [];
  for await (const record of iterable) records.push(record);
  return records;
}

describe("shopping cookie pagination budget", () => {
  it.each(CASES)(
    "%s accepts ephemeral cookie + accountId credentials",
    async (_name, Adapter, account) => {
      let requests = 0;
      const sourceRequests = [];
      const accountId = Object.values(account)[0];
      const adapter = new Adapter({
        fetchFn: async (request) => {
          requests += 1;
          sourceRequests.push(request);
          return { orders: makeOrders(1) };
        },
      });

      const records = await collect(
        adapter.sync({
          cookie: "sid=runtime",
          accountId,
          sinceWatermark: 0,
          pageSize: 10,
          maxPages: 2,
        }),
      );

      expect(records.length).toBeGreaterThan(0);
      expect(requests).toBeGreaterThan(0);
      expect(
        sourceRequests.every((request) => request.cookies === "sid=runtime"),
      ).toBe(true);
      expect(JSON.stringify(records)).not.toContain("sid=runtime");
      expect(JSON.stringify(records).toLowerCase()).not.toContain(
        accountId.toLowerCase(),
      );
      expect(adapter.account).toBe(null);
      expect(adapter._cookieAuth).toBe(null);
    },
  );

  it.each(CASES)(
    "%s leaves a non-empty short page incomplete when maxPages is exhausted",
    async (_name, Adapter, account) => {
      let requests = 0;
      let completions = 0;
      const pacedRequests = [];
      const adapter = new Adapter({
        account: { ...account, cookies: "sid=test" },
        fetchFn: async () => {
          requests += 1;
          return { orders: makeOrders(1) };
        },
      });

      const records = await collect(
        adapter.sync({
          sinceWatermark: 0,
          pageSize: 10,
          maxPages: 1,
          beforeSourceRequest: async (request) => {
            pacedRequests.push(request);
          },
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      );

      expect(records).toHaveLength(1);
      expect(requests).toBe(1);
      expect(pacedRequests).toHaveLength(1);
      expect(pacedRequests[0].page).toBe(1);
      expect(completions).toBe(0);
    },
  );

  it.each(CASES)(
    "%s advances the watermark only after every source is drained",
    async (_name, Adapter, account, sourceCount) => {
      let requests = 0;
      let completions = 0;
      const adapter = new Adapter({
        account: { ...account, cookies: "sid=test" },
        fetchFn: async (request) => {
          requests += 1;
          return {
            orders: sourcePage(request) === 1 ? makeOrders(1) : [],
          };
        },
      });

      const expectedRequests = sourceCount * 2;
      const records = await collect(
        adapter.sync({
          sinceWatermark: 0,
          pageSize: 10,
          maxPages: expectedRequests,
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      );

      expect(records).toHaveLength(sourceCount);
      expect(requests).toBe(expectedRequests);
      expect(completions).toBe(1);
    },
  );

  it.each(CASES)(
    "%s treats a valid empty list as fully drained",
    async (_name, Adapter, account, expectedRequests) => {
      let requests = 0;
      let completions = 0;
      const adapter = new Adapter({
        account: { ...account, cookies: "sid=test" },
        fetchFn: async () => {
          requests += 1;
          return { orders: [] };
        },
      });

      const records = await collect(
        adapter.sync({
          sinceWatermark: 0,
          maxPages: expectedRequests,
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      );

      expect(records).toHaveLength(0);
      expect(requests).toBe(expectedRequests);
      expect(completions).toBe(1);
    },
  );

  it.each([
    ["hasMore", { hasMore: false }],
    ["total", { total: 1 }],
    ["next", { next: null }],
  ])(
    "shopping-taobao honors authoritative %s completion metadata",
    async (_field, metadata) => {
      let completions = 0;
      const adapter = new TaobaoAdapter({
        account: { userId: "u-1", cookies: "sid=test" },
        fetchFn: async () => ({ orders: makeOrders(1), ...metadata }),
      });

      const records = await collect(
        adapter.sync({
          sinceWatermark: 0,
          maxPages: 1,
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      );

      expect(records).toHaveLength(1);
      expect(completions).toBe(1);
    },
  );

  it("shopping-taobao honors authoritative hasMore on an empty page", async () => {
    let requests = 0;
    let completions = 0;
    const adapter = new TaobaoAdapter({
      account: { userId: "u-1", cookies: "sid=test" },
      fetchFn: async () => {
        requests += 1;
        return { orders: [], hasMore: requests === 1 };
      },
    });

    await collect(
      adapter.sync({
        sinceWatermark: 0,
        maxPages: 2,
        markWatermarkComplete: () => {
          completions += 1;
        },
      }),
    );

    expect(requests).toBe(2);
    expect(completions).toBe(1);
  });

  it.each(CASES)(
    "%s rejects an unrecognized response without advancing the watermark",
    async (_name, Adapter, account) => {
      let requests = 0;
      let completions = 0;
      const adapter = new Adapter({
        account: { ...account, cookies: "sid=test" },
        fetchFn: async () => {
          requests += 1;
          return { unexpected: [] };
        },
      });

      await expect(
        collect(
          adapter.sync({
            sinceWatermark: 0,
            maxPages: 2,
            markWatermarkComplete: () => {
              completions += 1;
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_PAGE_UNRECOGNIZED" });

      expect(requests).toBe(1);
      expect(completions).toBe(0);
    },
  );

  it.each(CASES)(
    "%s rejects an explicit business error without advancing the watermark",
    async (_name, Adapter, account) => {
      let requests = 0;
      let completions = 0;
      const adapter = new Adapter({
        account: { ...account, cookies: "sid=test" },
        fetchFn: async () => {
          requests += 1;
          return { code: 401, message: "expired", orders: [] };
        },
      });

      await expect(
        collect(
          adapter.sync({
            sinceWatermark: 0,
            maxPages: 2,
            markWatermarkComplete: () => {
              completions += 1;
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_PAGE_ERROR" });

      expect(requests).toBe(1);
      expect(completions).toBe(0);
    },
  );
});
