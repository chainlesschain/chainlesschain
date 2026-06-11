/**
 * 网易云音乐 LIVE cookie web-API (weapi) fetcher tests.
 * weapi crypto determinism (fixed secKey) + account/play/playlist parsing +
 * adapter cookie-mode sync + error mapping. All network via injected fetch.
 */
"use strict";

import { describe, it, expect } from "vitest";

const { NeteaseMusicAdapter } = require("../../lib/adapters/netease-music");
const {
  NeteaseMusicApiClient,
  weapiEncrypt,
  aesEncrypt,
  rsaEncrypt,
  modpow,
} = require("../../lib/adapters/netease-music/api-client");
const { partitionBatch } = require("../../lib/batch");

const FIXED_SECKEY = "0123456789abcdef"; // 16 chars → deterministic weapi
const COOKIE = "MUSIC_U=abcdef0123456789; __csrf=zzz";

/** Map endpoint path substrings → JSON bodies; record posted form bodies. */
function makeFetch(routes, calls) {
  return async (url, init) => {
    calls.push({ url, body: init && init.body, headers: (init && init.headers) || {} });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) return { ok: false, status: 404, text: async () => "not mapped" };
    return {
      ok: route.status ? route.status >= 200 && route.status < 300 : true,
      status: route.status || 200,
      text: async () =>
        typeof route.body === "string" ? route.body : JSON.stringify(route.body),
    };
  };
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("weapi crypto primitives", () => {
  it("modpow matches BigInt ** % for small values", () => {
    expect(modpow(4n, 13n, 497n)).toBe(445n); // textbook RSA example
    expect(modpow(7n, 0n, 13n)).toBe(1n);
  });

  it("aesEncrypt is deterministic (fixed key + IV) and base64", () => {
    const a = aesEncrypt("hello", "0CoJUm6Qyw8W8jud");
    const b = aesEncrypt("hello", "0CoJUm6Qyw8W8jud");
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("rsaEncrypt yields zero-padded 256-hex", () => {
    const enc = rsaEncrypt("test", "010001", "e0b5");
    expect(enc).toHaveLength(256);
    expect(enc).toMatch(/^[0-9a-f]{256}$/);
  });

  it("weapiEncrypt produces stable { params, encSecKey } for a fixed secKey", () => {
    const a = weapiEncrypt({ uid: 1 }, FIXED_SECKEY);
    const b = weapiEncrypt({ uid: 1 }, FIXED_SECKEY);
    expect(a).toEqual(b);
    expect(a.encSecKey).toHaveLength(256);
    expect(a.params).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("NeteaseMusicApiClient.fetchSnapshot — live (mocked fetch)", () => {
  it("resolves account, play record, playlists into snapshot-shaped events", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        {
          match: "/weapi/w/nuser/account/get",
          body: { code: 200, profile: { userId: 42, nickname: "听歌的人" }, account: { id: 42 } },
        },
        {
          match: "/weapi/v1/play/record",
          body: {
            code: 200,
            weekData: [
              { playCount: 50, song: { id: 186016, name: "晴天", ar: [{ name: "周杰伦" }], al: { name: "叶惠美" } } },
            ],
          },
        },
        {
          match: "/weapi/user/playlist",
          body: {
            code: 200,
            playlist: [{ id: 999, name: "我喜欢的音乐", trackCount: 200, creator: { nickname: "听歌的人" } }],
          },
        },
      ],
      calls,
    );
    const client = new NeteaseMusicApiClient({ fetch, secKey: FIXED_SECKEY });
    const result = await client.fetchSnapshot(COOKIE);
    expect(result.account).toEqual({ uid: "42", nickname: "听歌的人" });
    expect(result.events).toHaveLength(2);
    const play = result.events.find((e) => e.kind === "play");
    expect(play).toMatchObject({ songId: "186016", song: "晴天", artist: "周杰伦", album: "叶惠美", playCount: 50 });
    const pl = result.events.find((e) => e.kind === "playlist");
    expect(pl).toMatchObject({ playlistId: "999", name: "我喜欢的音乐", trackCount: 200, creator: "听歌的人" });
    // every POST is form-encoded weapi (params + encSecKey) with the cookie.
    for (const c of calls) {
      expect(c.body).toMatch(/^params=.+&encSecKey=.+$/);
      expect(c.headers.Cookie).toBe(COOKIE);
      expect(c.headers["Content-Type"]).toContain("x-www-form-urlencoded");
    }
  });

  it("multi-artist joined with ' / '; falls back to allData when weekData empty", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        { match: "account/get", body: { code: 200, profile: { userId: 7 } } },
        {
          match: "play/record",
          body: {
            code: 200,
            weekData: [],
            allData: [{ playCount: 3, song: { id: 1, name: "S", ar: [{ name: "A" }, { name: "B" }], al: { name: "Al" } } }],
          },
        },
        { match: "user/playlist", body: { code: 200, playlist: [] } },
      ],
      calls,
    );
    const client = new NeteaseMusicApiClient({ fetch, secKey: FIXED_SECKEY });
    const result = await client.fetchSnapshot(COOKIE);
    const play = result.events.find((e) => e.kind === "play");
    expect(play.artist).toBe("A / B");
  });

  it("include flags skip endpoints", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        { match: "account/get", body: { code: 200, profile: { userId: 7 } } },
        { match: "user/playlist", body: { code: 200, playlist: [] } },
      ],
      calls,
    );
    const client = new NeteaseMusicApiClient({ fetch, secKey: FIXED_SECKEY });
    const result = await client.fetchSnapshot(COOKIE, { include: { play: false } });
    expect(calls.some((c) => c.url.includes("play/record"))).toBe(false);
    expect(result.events.every((e) => e.kind !== "play")).toBe(true);
  });

  it("maps API code != 200 to null + lastError (e.g. -460 risk-control)", async () => {
    const calls = [];
    const fetch = makeFetch(
      [{ match: "account/get", body: { code: -460, message: "Cheating" } }],
      calls,
    );
    const client = new NeteaseMusicApiClient({ fetch, secKey: FIXED_SECKEY });
    expect(await client.fetchSnapshot(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(-460);
    expect(client.lastError.message).toContain("Cheating");
  });

  it("account with no userId → null + lastError -7", async () => {
    const calls = [];
    const fetch = makeFetch([{ match: "account/get", body: { code: 200, profile: null, account: null } }], calls);
    const client = new NeteaseMusicApiClient({ fetch, secKey: FIXED_SECKEY });
    expect(await client.fetchSnapshot(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(-7);
  });

  it("empty cookie → null + lastError -1 (no network)", async () => {
    const calls = [];
    const client = new NeteaseMusicApiClient({ fetch: makeFetch([], calls), secKey: FIXED_SECKEY });
    expect(await client.fetchSnapshot("")).toBeNull();
    expect(client.lastError.code).toBe(-1);
    expect(calls).toHaveLength(0);
  });

  it("HTTP non-2xx → null + lastError with status", async () => {
    const calls = [];
    const fetch = makeFetch([{ match: "account/get", status: 502, body: "bad gw" }], calls);
    const client = new NeteaseMusicApiClient({ fetch, secKey: FIXED_SECKEY });
    expect(await client.fetchSnapshot(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(502);
  });
});

describe("NeteaseMusicAdapter — cookie (live) sync mode", () => {
  it("authenticate accepts a cookie with MUSIC_U; rejects without it", async () => {
    const a = new NeteaseMusicAdapter();
    expect((await a.authenticate({ cookie: COOKIE })).mode).toBe("cookie");
    const bad = await a.authenticate({ cookie: "foo=bar" });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("INVALID_COOKIE");
  });

  it("capabilities/version reflect v0.2 live mode", () => {
    const a = new NeteaseMusicAdapter();
    expect(a.version).toBe("0.2.0");
    expect(a.capabilities).toContain("sync:cookie");
  });

  it("sync via cookie yields play+playlist raws → valid normalized batch", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        { match: "account/get", body: { code: 200, profile: { userId: 42, nickname: "me" } } },
        {
          match: "play/record",
          body: { code: 200, weekData: [{ playCount: 9, song: { id: 5, name: "夜曲", ar: [{ name: "周杰伦" }], al: { name: "11月的萧邦" } } }] },
        },
        { match: "user/playlist", body: { code: 200, playlist: [{ id: 8, name: "练歌", trackCount: 12, creator: { nickname: "me" } }] } },
      ],
      calls,
    );
    const a = new NeteaseMusicAdapter();
    const raws = await collect(a.sync({ cookie: COOKIE, fetch, secKey: FIXED_SECKEY }));
    expect(raws.map((r) => r.kind).sort()).toEqual(["play", "playlist"]);
    const playRaw = raws.find((r) => r.kind === "play");
    expect(playRaw.originalId).toBe("netease-music:play:play-5");

    // normalize → vault-valid batch for both kinds.
    for (const raw of raws) {
      const batch = a.normalize(raw);
      const { invalidReasons } = partitionBatch(batch);
      expect(invalidReasons).toHaveLength(0);
    }
    const playBatch = a.normalize(playRaw);
    expect(playBatch.items[0].extra.songId).toBe("5");
    expect(playBatch.events[0].content.title).toContain("夜曲");
  });

  it("sync via cookie throws (mapped lastError) on risk-control", async () => {
    const calls = [];
    const fetch = makeFetch([{ match: "account/get", body: { code: -460, message: "Cheating" } }], calls);
    const a = new NeteaseMusicAdapter();
    await expect(collect(a.sync({ cookie: COOKIE, fetch, secKey: FIXED_SECKEY }))).rejects.toThrow(
      /Cheating|code -460/,
    );
  });
});
