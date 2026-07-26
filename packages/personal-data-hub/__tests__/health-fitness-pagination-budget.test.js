"use strict";

import { describe, expect, it } from "vitest";

const { KeepAdapter } = require("../lib/adapters/fitness-keep");
const { JoyrunAdapter } = require("../lib/adapters/fitness-joyrun");
const { MeiyouAdapter } = require("../lib/adapters/health-meiyou");

const CASES = [
  [
    "fitness-keep",
    KeepAdapter,
    { listUrl: "https://captured.example/keep" },
    1,
  ],
  [
    "fitness-joyrun",
    JoyrunAdapter,
    { listUrl: "https://captured.example/joyrun" },
    1,
  ],
  [
    "health-meiyou",
    MeiyouAdapter,
    {
      periodUrl: "https://captured.example/period",
      recordUrl: "https://captured.example/record",
    },
    2,
  ],
];

function makeRecord(id, timestamp = 2_000_000_000_000) {
  return {
    id,
    workoutId: id,
    fid: id,
    recordId: id,
    type: "running",
    recordType: "mood",
    time: timestamp,
    starttime: timestamp,
    startDate: timestamp,
    date: timestamp,
    meter: 1_000,
    distanceMeters: 1_000,
  };
}

function sourceName(url) {
  return new URL(url).pathname.split("/").filter(Boolean).pop() || "records";
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

describe("health and fitness cookie pagination budget", () => {
  it.each(CASES)(
    "%s drains more than ten pages by default",
    async (_name, Adapter, adapterOptions, sourceCount) => {
      let requests = 0;
      let completions = 0;
      const adapter = createAdapter(
        Adapter,
        adapterOptions,
        async ({ url, query }) => {
          requests += 1;
          return {
            list:
              query.page <= 11
                ? [makeRecord(`${sourceName(url)}-${query.page}`)]
                : [],
          };
        },
      );

      const records = await collect(
        adapter.sync({
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      );

      expect(records).toHaveLength(sourceCount * 11);
      expect(requests).toBe(sourceCount * 12);
      expect(completions).toBe(1);
    },
  );

  it.each(CASES)(
    "%s includes records older than one year on the initial scan",
    async (_name, Adapter, adapterOptions, sourceCount) => {
      let completions = 0;
      const seenSources = new Set();
      const adapter = createAdapter(
        Adapter,
        adapterOptions,
        async ({ url }) => {
          const source = sourceName(url);
          const firstPage = !seenSources.has(source);
          seenSources.add(source);
          return {
            list: firstPage
              ? [makeRecord(`${source}-historical`, 1_000_000_000_000)]
              : [],
          };
        },
      );

      const records = await collect(
        adapter.sync({
          markWatermarkComplete: () => {
            completions += 1;
          },
        }),
      );

      expect(records).toHaveLength(sourceCount);
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
        return { list: [makeRecord("repeated")] };
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

  it.each(CASES)(
    "%s rejects an unrecognized page without advancing the watermark",
    async (_name, Adapter, adapterOptions) => {
      let completions = 0;
      const adapter = createAdapter(Adapter, adapterOptions, async () => ({
        unexpected: [],
      }));

      await expect(
        collect(
          adapter.sync({
            markWatermarkComplete: () => {
              completions += 1;
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_PAGE_UNRECOGNIZED" });

      expect(completions).toBe(0);
    },
  );
});
