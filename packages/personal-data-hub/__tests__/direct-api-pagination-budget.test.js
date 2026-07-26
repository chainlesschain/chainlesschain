"use strict";

import { describe, expect, it } from "vitest";

const { TianyanchaAdapter } = require("../lib/adapters/biz-tianyancha");
const { MercedesMeAdapter } = require("../lib/adapters/car-mercedesme");
const { DcepAdapter } = require("../lib/adapters/finance-dcep");
const { BossZhipinAdapter } = require("../lib/adapters/recruit-boss");

const CASES = [
  ["biz-tianyancha", TianyanchaAdapter, {}, { search: false }],
  [
    "car-mercedesme",
    MercedesMeAdapter,
    { listUrl: "https://captured.example/trips" },
    {},
  ],
  [
    "finance-dcep",
    DcepAdapter,
    { listUrl: "https://captured.example/transactions" },
    {},
  ],
  ["recruit-boss", BossZhipinAdapter, {}, { application: false }],
];

function makeRecord(id) {
  return {
    id,
    graphId: id,
    jobId: id,
    txId: id,
    tripId: id,
    companyName: `company-${id}`,
    jobName: `job-${id}`,
    createTime: 1_100_000_000_000,
    lastChatTime: 1_100_000_000_000,
    time: 1_100_000_000_000,
    startTime: 1_100_000_000_000,
    endTime: 1_100_000_001_000,
  };
}

function createAdapter(Adapter, adapterOptions, fetchFn) {
  return new Adapter({
    account: { cookies: "sid=test", userId: "u-1" },
    ...adapterOptions,
    fetchFn,
  });
}

function pageOf(query) {
  return query.pageNum ?? query.page;
}

async function collect(iterable) {
  const records = [];
  for await (const record of iterable) records.push(record);
  return records;
}

describe("direct API cookie pagination budget", () => {
  it.each(CASES)(
    "%s drains more than twelve pages by default",
    async (_name, Adapter, adapterOptions, include) => {
      let requests = 0;
      let completions = 0;
      const adapter = createAdapter(
        Adapter,
        adapterOptions,
        async ({ query }) => {
          requests += 1;
          const page = pageOf(query);
          return {
            list: page <= 13 ? [makeRecord(`historical-${page}`)] : [],
          };
        },
      );

      const records = await collect(
        adapter.sync({
          include,
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      );

      expect(records).toHaveLength(13);
      expect(requests).toBe(14);
      expect(completions).toBe(1);
    },
  );

  it.each(CASES)(
    "%s rejects a repeated source page during an uncapped scan",
    async (_name, Adapter, adapterOptions, include) => {
      let requests = 0;
      let completions = 0;
      const adapter = createAdapter(Adapter, adapterOptions, async () => {
        requests += 1;
        return { list: [makeRecord("repeated")] };
      });

      await expect(
        collect(
          adapter.sync({
            include,
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

  it.each(CASES)(
    "%s preserves an explicit page cap",
    async (_name, Adapter, adapterOptions, include) => {
      let requests = 0;
      let completions = 0;
      const adapter = createAdapter(Adapter, adapterOptions, async () => {
        requests += 1;
        return { list: [makeRecord("repeated")] };
      });

      const records = await collect(
        adapter.sync({
          include,
          maxPages: 2,
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      );

      expect(records).toHaveLength(2);
      expect(requests).toBe(2);
      expect(completions).toBe(0);
    },
  );

  it.each(CASES)(
    "%s rejects an unrecognized page without advancing the watermark",
    async (_name, Adapter, adapterOptions, include) => {
      let completions = 0;
      const adapter = createAdapter(Adapter, adapterOptions, async () => ({
        unexpected: [],
      }));

      await expect(
        collect(
          adapter.sync({
            include,
            markWatermarkComplete: () => {
              completions += 1;
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_PAGE_UNRECOGNIZED" });

      expect(completions).toBe(0);
    },
  );

  it.each(CASES)(
    "%s rejects a source error without advancing the watermark",
    async (_name, Adapter, adapterOptions, include) => {
      let completions = 0;
      const adapter = createAdapter(Adapter, adapterOptions, async () => ({
        code: 401,
        list: [],
      }));

      await expect(
        collect(
          adapter.sync({
            include,
            markWatermarkComplete: () => {
              completions += 1;
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_PAGE_ERROR" });

      expect(completions).toBe(0);
    },
  );
});
