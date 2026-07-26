"use strict";

import { describe, expect, it } from "vitest";

const { XimalayaAdapter } = require("../lib/adapters/audio-ximalaya");
const { KugouMusicAdapter } = require("../lib/adapters/music-kugou");
const { QQMusicAdapter } = require("../lib/adapters/music-qq");

const CASES = [
  ["audio-ximalaya", XimalayaAdapter, { favorite: false, subscribe: false }],
  ["music-kugou", KugouMusicAdapter, { favorite: false, playlist: false }],
  ["music-qq", QQMusicAdapter, { favorite: false, playlist: false }],
];

function makeRecord(id, timestamp = 1_000_000_000_000) {
  return {
    id,
    trackId: id,
    hash: id,
    songmid: id,
    title: `audio-${id}`,
    songname: `song-${id}`,
    startedAt: timestamp,
    addtime: timestamp,
    time: timestamp,
  };
}

function createAdapter(Adapter, fetchFn) {
  return new Adapter({
    account: { cookies: "sid=test", userId: "u-1" },
    fetchFn,
  });
}

async function collect(iterable) {
  const records = [];
  for await (const record of iterable) records.push(record);
  return records;
}

describe("media cookie pagination budget", () => {
  it.each(CASES)(
    "%s drains more than ten pages by default",
    async (_name, Adapter, include) => {
      let requests = 0;
      const completedWatermarkKeys = [];
      const adapter = createAdapter(Adapter, async ({ query }) => {
        requests += 1;
        return {
          list:
            query.page <= 11 ? [makeRecord(`historical-${query.page}`)] : [],
        };
      });

      const records = await collect(
        adapter.sync({
          include,
          markWatermarkComplete: (key) => {
            completedWatermarkKeys.push(key);
          },
        }),
      );

      expect(records).toHaveLength(11);
      expect(requests).toBe(12);
      expect(records.at(-1).payload.id).toBe("historical-11");
      expect(completedWatermarkKeys).toEqual(["play"]);
    },
  );

  it.each(CASES)(
    "%s rejects a repeated source page during an uncapped scan",
    async (_name, Adapter, include) => {
      let requests = 0;
      const completedWatermarkKeys = [];
      const adapter = createAdapter(Adapter, async () => {
        requests += 1;
        return { list: [makeRecord("repeated")] };
      });

      await expect(
        collect(
          adapter.sync({
            include,
            markWatermarkComplete: (key) => {
              completedWatermarkKeys.push(key);
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_PAGE_STALLED" });

      expect(requests).toBe(2);
      expect(completedWatermarkKeys).toEqual([]);
    },
  );

  it.each(CASES)(
    "%s preserves an explicit per-stream page cap",
    async (_name, Adapter, include) => {
      let requests = 0;
      const completedWatermarkKeys = [];
      const adapter = createAdapter(Adapter, async () => {
        requests += 1;
        return { list: [makeRecord("repeated")] };
      });

      const records = await collect(
        adapter.sync({
          include,
          maxPagesByWatermarkKey: { play: 2 },
          markWatermarkComplete: (key) => {
            completedWatermarkKeys.push(key);
          },
        }),
      );

      expect(records).toHaveLength(2);
      expect(requests).toBe(2);
      expect(completedWatermarkKeys).toEqual([]);
    },
  );
});
