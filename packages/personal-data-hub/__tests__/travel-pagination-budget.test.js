"use strict";

import { describe, expect, it } from "vitest";

const { CtripAdapter } = require("../lib/adapters/travel-ctrip");
const { DidiAdapter } = require("../lib/adapters/travel-didi");
const { DidiConsumerAdapter } = require("../lib/adapters/travel-didi-consumer");
const { TongchengAdapter } = require("../lib/adapters/travel-tongcheng");

const CASES = [
  ["travel-ctrip", CtripAdapter, {}],
  ["travel-didi", DidiAdapter, {}],
  [
    "travel-didi-consumer",
    DidiConsumerAdapter,
    { ordersUrl: "https://api.xiaojukeji.com/orders" },
  ],
  ["travel-tongcheng", TongchengAdapter, {}],
];

function makeOrder(id, timestamp = 2_000_000_000_000) {
  return {
    orderId: id,
    type: "flight",
    projectType: "flight",
    orderDate: timestamp,
    departTime: timestamp,
    fromAddress: "A",
    toAddress: "B",
    departCity: "A",
    arriveCity: "B",
    departureCity: "A",
    arrivalCity: "B",
  };
}

function createAdapter(Adapter, adapterOptions, fetchFn) {
  return new Adapter({
    account: {
      cookies: "sid=test",
      email: "traveler@example.com",
      phone: "13800000000",
    },
    ...adapterOptions,
    fetchFn,
  });
}

async function collect(iterable) {
  const records = [];
  for await (const record of iterable) records.push(record);
  return records;
}

describe("travel cookie pagination budget", () => {
  it.each(CASES)(
    "%s drains more than ten pages by default",
    async (_name, Adapter, adapterOptions) => {
      let requests = 0;
      let completions = 0;
      const adapter = createAdapter(
        Adapter,
        adapterOptions,
        async ({ query }) => {
          requests += 1;
          return {
            orders:
              query.pageIndex <= 11
                ? [makeOrder(`order-${query.pageIndex}`)]
                : [],
          };
        },
      );

      const records = await collect(
        adapter.sync({
          pageSize: 10,
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      );

      expect(records).toHaveLength(11);
      expect(requests).toBe(12);
      expect(completions).toBe(1);
    },
  );

  it.each(CASES)(
    "%s includes records older than one year on the initial scan",
    async (_name, Adapter, adapterOptions) => {
      let completions = 0;
      const adapter = createAdapter(Adapter, adapterOptions, async () => ({
        orders: [makeOrder("historical", 1_000_000_000_000)],
        hasMore: false,
      }));

      const records = await collect(
        adapter.sync({
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      );

      expect(records).toHaveLength(1);
      expect(records[0].originalId).toBe("historical");
      expect(completions).toBe(1);
    },
  );

  it.each(CASES)(
    "%s rejects a repeated source page during an uncapped scan",
    async (_name, Adapter, adapterOptions) => {
      let requests = 0;
      let completions = 0;
      const adapter = createAdapter(Adapter, adapterOptions, async () => {
        requests += 1;
        return { orders: [makeOrder("repeated")] };
      });

      await expect(
        collect(
          adapter.sync({
            markWatermarkComplete: () => {
              completions += 1;
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_PAGE_STALLED" });

      expect(requests).toBe(2);
      expect(completions).toBe(0);
    },
  );
});
