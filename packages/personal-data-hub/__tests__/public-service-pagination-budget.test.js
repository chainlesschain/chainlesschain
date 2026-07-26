"use strict";

import { describe, expect, it } from "vitest";

const { Tmri12123Adapter } = require("../lib/adapters/gov-12123");
const { IXiamenAdapter } = require("../lib/adapters/gov-ixiamen");
const { TaxAdapter } = require("../lib/adapters/gov-tax");

const CASES = [
  [
    "gov-12123",
    Tmri12123Adapter,
    {
      violationUrl: "https://captured.example/violation",
      licenseUrl: "https://captured.example/license",
    },
    { license: false },
  ],
  [
    "gov-ixiamen",
    IXiamenAdapter,
    { listUrl: "https://captured.example/service" },
    {},
  ],
  [
    "gov-tax",
    TaxAdapter,
    {
      incomeUrl: "https://captured.example/income",
      declarationUrl: "https://captured.example/declaration",
    },
    { declaration: false },
  ],
];

function makeRecord(id) {
  return {
    id,
    violationId: id,
    serviceId: id,
    recordId: id,
    name: `service-${id}`,
    time: 1_100_000_000_000,
    handledTime: 1_100_000_000_000,
    period: "2000-01",
  };
}

function createAdapter(Adapter, adapterOptions, fetchFn) {
  return new Adapter({
    account: { cookies: "sid=test", userId: "u-1" },
    ...adapterOptions,
    fetchFn,
  });
}

async function collect(iterable) {
  const records = [];
  for await (const record of iterable) records.push(record);
  return records;
}

describe("public-service cookie pagination budget", () => {
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
          return {
            list:
              query.page <= 13 ? [makeRecord(`historical-${query.page}`)] : [],
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
