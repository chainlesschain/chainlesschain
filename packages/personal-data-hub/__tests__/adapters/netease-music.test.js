"use strict";

import { describe, it, expect } from "vitest";

const { NeteaseMusicAdapter } = require("../../lib/adapters/netease-music");
const { partitionBatch } = require("../../lib/batch");

const SNAPSHOT = {
  schemaVersion: 1,
  snapshottedAt: 1700000000000,
  account: { uid: "42", nickname: "me" },
  events: [
    { kind: "play", id: "p1", capturedAt: 1700000001000, song: "晴天", artist: "周杰伦", album: "叶惠美", songId: "186016", playCount: 50 },
    { kind: "favorite", id: "f1", capturedAt: 1700000002000, song: "稻香", artist: "周杰伦", songId: "186001" },
    { kind: "playlist", id: "pl1", capturedAt: 1700000003000, name: "我喜欢的音乐", playlistId: "999", trackCount: 200, creator: "me" },
    { kind: "bogus", id: "x" },
  ],
};

function adapter(snap = SNAPSHOT, { exists = true } = {}) {
  const a = new NeteaseMusicAdapter();
  a._deps.fs = {
    existsSync: () => exists,
    readFileSync: () => JSON.stringify(snap),
    accessSync: () => {},
    constants: { R_OK: 4 },
  };
  return a;
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("NeteaseMusicAdapter", () => {
  it("readinessOnly → NO_INPUT (snapshot)", async () => {
    const r = await new NeteaseMusicAdapter().authenticate({ readinessOnly: true });
    expect(r.reason).toBe("NO_INPUT");
  });

  it("ingests play/favorite/playlist, skips unknown kinds", async () => {
    const raws = await collect(adapter().sync({ inputPath: "/x" }));
    expect(raws.map((r) => r.kind)).toEqual(["play", "favorite", "playlist"]);
  });

  it("normalizes to valid batch (events + items + topic)", async () => {
    const a = adapter();
    const raws = await collect(a.sync({ inputPath: "/x" }));
    const merged = { events: [], persons: [], places: [], items: [], topics: [] };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged)) merged[k].push(...n[k]);
    }
    const { valid, invalidReasons } = partitionBatch(merged);
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(2); // play + favorite
    expect(valid.items).toHaveLength(2); // two songs
    expect(valid.topics).toHaveLength(1); // playlist
    const play = valid.events.find((e) => e.subtype === "media");
    expect(play.content.title).toContain("晴天");
    expect(valid.topics[0].name).toBe("我喜欢的音乐");
  });

  it("schemaVersion mismatch throws", async () => {
    const a = adapter({ schemaVersion: 99, events: [] });
    await expect(collect(a.sync({ inputPath: "/x" }))).rejects.toThrow(/schemaVersion/);
  });

  it("missing file yields nothing", async () => {
    expect(await collect(adapter(SNAPSHOT, { exists: false }).sync({ inputPath: "/x" }))).toHaveLength(0);
  });
});
