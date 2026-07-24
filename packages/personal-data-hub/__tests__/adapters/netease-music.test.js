"use strict";

import { describe, it, expect } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { NeteaseMusicAdapter } = require("../../lib/adapters/netease-music");
const { partitionBatch } = require("../../lib/batch");

const SNAPSHOT = {
  schemaVersion: 1,
  snapshottedAt: 1700000000000,
  account: { uid: "42", nickname: "me" },
  events: [
    {
      kind: "play",
      id: "p1",
      capturedAt: 1700000001000,
      song: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      songId: "186016",
      playCount: 50,
    },
    {
      kind: "favorite",
      id: "f1",
      capturedAt: 1700000002000,
      song: "稻香",
      artist: "周杰伦",
      songId: "186001",
    },
    {
      kind: "playlist",
      id: "pl1",
      capturedAt: 1700000003000,
      name: "我喜欢的音乐",
      playlistId: "999",
      trackCount: 200,
      creator: "me",
    },
  ],
};

function writeSnapshot(snapshot) {
  const p = path.join(os.tmpdir(), `cc-netease-${crypto.randomUUID()}.json`);
  fs.writeFileSync(
    p,
    typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot),
    "utf8",
  );
  return p;
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("NeteaseMusicAdapter", () => {
  it("readinessOnly → NO_INPUT (snapshot)", async () => {
    const r = await new NeteaseMusicAdapter().authenticate({
      readinessOnly: true,
    });
    expect(r.reason).toBe("NO_INPUT");
  });

  it("ingests play/favorite/playlist", async () => {
    const p = writeSnapshot(SNAPSHOT);
    try {
      const raws = await collect(
        new NeteaseMusicAdapter().sync({ inputPath: p }),
      );
      expect(raws.map((r) => r.kind)).toEqual(["play", "favorite", "playlist"]);
      expect(raws.map((r) => r.originalId)).toEqual([
        "netease-music:play:p1",
        "netease-music:favorite:f1",
        "netease-music:playlist:pl1",
      ]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("normalizes to valid batch (events + items + topic)", async () => {
    const p = writeSnapshot(SNAPSHOT);
    const a = new NeteaseMusicAdapter();
    const raws = await collect(a.sync({ inputPath: p }));
    const merged = {
      events: [],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
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
    fs.unlinkSync(p);
  });

  it("schemaVersion mismatch throws", async () => {
    const p = writeSnapshot({ schemaVersion: 99, events: [] });
    try {
      await expect(
        collect(new NeteaseMusicAdapter().sync({ inputPath: p })),
      ).rejects.toThrow(/schemaVersion/);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("missing file fails closed", async () => {
    const p = path.join(os.tmpdir(), `missing-${crypto.randomUUID()}.json`);
    await expect(
      collect(new NeteaseMusicAdapter().sync({ inputPath: p })),
    ).rejects.toMatchObject({ code: "INPUT_PATH_UNREADABLE" });
  });

  it("fails closed for malformed, invalid-shape, unknown-kind, oversized, and id-less snapshots", async () => {
    const paths = [
      writeSnapshot("{"),
      writeSnapshot({ schemaVersion: 1, events: {} }),
      writeSnapshot({
        schemaVersion: 1,
        events: [{ kind: "unknown", id: "x" }],
      }),
      writeSnapshot({ schemaVersion: 1, events: [] }),
      writeSnapshot({
        schemaVersion: 1,
        events: [{ kind: "play", song: "no stable source id" }],
      }),
    ];
    try {
      const a = new NeteaseMusicAdapter();
      expect(await a.authenticate({ inputPath: paths[0] })).toMatchObject({
        ok: false,
        reason: "SNAPSHOT_JSON_INVALID",
      });
      await expect(
        collect(a.sync({ inputPath: paths[0] })),
      ).rejects.toMatchObject({ code: "SNAPSHOT_JSON_INVALID" });

      expect(await a.authenticate({ inputPath: paths[1] })).toMatchObject({
        ok: false,
        reason: "SNAPSHOT_SHAPE_INVALID",
      });
      await expect(
        collect(a.sync({ inputPath: paths[2] })),
      ).rejects.toMatchObject({ code: "SNAPSHOT_SHAPE_INVALID" });

      expect(
        await a.authenticate({
          inputPath: paths[3],
          maxSnapshotBytes: 8,
        }),
      ).toMatchObject({ ok: false, reason: "SNAPSHOT_TOO_LARGE" });
      await expect(
        collect(
          a.sync({
            inputPath: paths[3],
            maxSnapshotBytes: 8,
          }),
        ),
      ).rejects.toMatchObject({ code: "SNAPSHOT_TOO_LARGE" });

      await expect(collect(a.sync({ inputPath: paths[4] }))).rejects.toThrow(
        /requires a stable id/,
      );
    } finally {
      for (const p of paths) fs.unlinkSync(p);
    }
  });
});
