/**
 * FAMILY-23 v0.1 — game-genshin adapter scaffold tests.
 * 契约 + extractUid cookie scrape + snapshot sync + normalize → 合法 batch。
 */
import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { GenshinAdapter } = require("../../lib");
const { GenshinApiClient } = require("../../lib/adapters/game-genshin/api-client");
const { assertAdapter } = require("../../lib/adapter-spec");
const { validateBatch } = require("../../lib/batch");

function writeSnapshot(obj) {
  const p = path.join(
    os.tmpdir(),
    `genshin-snap-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(p, JSON.stringify(obj), "utf-8");
  return p;
}

describe("GenshinAdapter — FAMILY-23 v0.1 cookie-scrape placeholder", () => {
  it("contract conformance + sensitivity medium", () => {
    const a = new GenshinAdapter();
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.name).toBe("game-genshin");
    expect(a.version).toBe("0.1.0");
    expect(a.extractMode).toBe("web-api");
    expect(a.dataDisclosure.sensitivity).toBe("medium");
    expect(a.capabilities).toContain("sync:snapshot");
  });

  it("extractUid parses HoYoLAB cookie keys (priority + null)", () => {
    const c = new GenshinApiClient();
    expect(c.extractUid("account_id_v2=12345; ltoken_v2=abc")).toBe("12345");
    expect(c.extractUid("ltuid_v2=67890; foo=bar")).toBe("67890");
    expect(c.extractUid("account_id=111; x=y")).toBe("111");
    expect(c.extractUid("ltuid=222")).toBe("222");
    // 优先级: account_id_v2 先于 ltuid
    expect(c.extractUid("ltuid=999; account_id_v2=12345")).toBe("12345");
    expect(c.extractUid("foo=bar")).toBeNull();
    expect(c.lastError.code).toBe(-7);
    expect(c.extractUid("")).toBeNull();
    expect(c.lastError.code).toBe(-1);
  });

  it("sync throws NO_INPUT without inputPath (v0.1 no live HTTP)", async () => {
    const a = new GenshinAdapter();
    await expect(async () => {
      for await (const _ of a.sync({})) void _;
    }).rejects.toThrow(/inputPath/);
  });

  it("sync via snapshot yields profile + play raws", async () => {
    const snapPath = writeSnapshot({
      schemaVersion: 1,
      snapshottedAt: 1700000000000,
      account: { uid: "12345", displayName: "旅行者" },
      events: [
        { kind: "profile", id: "profile-12345", uid: "12345", nickname: "旅行者", level: 58 },
        { kind: "play", id: "play-s1", durationMs: 3600000, mode: "single", startAt: 1700000000000 },
      ],
    });
    try {
      const a = new GenshinAdapter();
      const raws = [];
      for await (const r of a.sync({ inputPath: snapPath })) raws.push(r);
      expect(raws).toHaveLength(2);
      expect(raws[0].kind).toBe("profile");
      expect(raws[0].originalId).toBe("genshin:profile:profile-12345");
      expect(raws[1].kind).toBe("play");
    } finally {
      fs.unlinkSync(snapPath);
    }
  });

  it("normalize profile → person-self with genshin-uid; play → MEDIA event (valid batch)", () => {
    const a = new GenshinAdapter();
    const profileBatch = a.normalize({
      adapter: "game-genshin",
      kind: "profile",
      originalId: "genshin:profile:profile-12345",
      capturedAt: 1700000000000,
      payload: { kind: "profile", uid: "12345", nickname: "旅行者", level: 58 },
    });
    expect(validateBatch(profileBatch).valid).toBe(true);
    expect(profileBatch.persons[0].subtype).toBe("self");
    expect(profileBatch.persons[0].identifiers["genshin-uid"]).toEqual(["12345"]);

    const playBatch = a.normalize({
      adapter: "game-genshin",
      kind: "play",
      originalId: "genshin:play:play-s1",
      capturedAt: 1700000000000,
      payload: { kind: "play", durationMs: 3600000, mode: "single", startAt: 1700000000000 },
    });
    expect(validateBatch(playBatch).valid).toBe(true);
    expect(playBatch.events[0].subtype).toBe("media");
    expect(playBatch.events[0].extra.durationMs).toBe(3600000);
  });

  it("normalize throws on missing payload", () => {
    const a = new GenshinAdapter();
    expect(() => a.normalize({})).toThrow(/payload missing/);
  });
});
