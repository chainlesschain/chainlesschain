/**
 * FAMILY-23 v0.2 — game-genshin LIVE HoYoLAB fetcher tests.
 * DS v1 signing determinism + takumi role fetch + game-record stats fold-in
 * + adapter cookie-mode sync + error mapping. All network via injected fetch.
 */
import { describe, it, expect } from "vitest";
const { GenshinAdapter } = require("../../lib");
const {
  GenshinApiClient,
  genDs,
  md5Hex,
  DEFAULT_DS_SALT,
} = require("../../lib/adapters/game-genshin/api-client");
const { validateBatch } = require("../../lib/batch");

// Deterministic clock + RNG seams.
const FIXED_NOW = () => 1700000000000; // → t = 1700000000
const FIXED_RAND = () => 0.5; // → r = 100001 + floor(0.5 * 99999) = 150000

/**
 * Build a fake fetch that maps URL substrings to JSON responses.
 * Each entry: { match, status?, body }. body is auto-JSON.stringify'd.
 * Records every requested URL + headers into `calls`.
 */
function makeFetch(routes, calls) {
  return async (url, init) => {
    calls.push({ url, headers: (init && init.headers) || {} });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) {
      return { ok: false, status: 404, text: async () => "not mapped" };
    }
    return {
      ok: route.status ? route.status >= 200 && route.status < 300 : true,
      status: route.status || 200,
      text: async () =>
        typeof route.body === "string" ? route.body : JSON.stringify(route.body),
    };
  };
}

const COOKIE = "account_id_v2=809199; cookie_token_v2=abc; ltoken_v2=xyz";

describe("genDs — DS v1 dynamic-secret signing", () => {
  it("produces `${t},${r},${c}` with c = md5(salt&t&r), deterministic under seams", () => {
    const ds = genDs(DEFAULT_DS_SALT, FIXED_NOW, FIXED_RAND);
    const [t, r, c] = ds.split(",");
    expect(t).toBe("1700000000");
    expect(r).toBe("150000");
    expect(c).toBe(md5Hex(`salt=${DEFAULT_DS_SALT}&t=1700000000&r=150000`));
    expect(c).toMatch(/^[0-9a-f]{32}$/);
  });

  it("r stays within the 6-digit [100001,200000) window at RNG extremes", () => {
    const low = genDs("s", FIXED_NOW, () => 0).split(",")[1];
    const high = genDs("s", FIXED_NOW, () => 0.9999999).split(",")[1];
    expect(Number(low)).toBe(100001);
    expect(Number(high)).toBeLessThan(200000);
    expect(Number(high)).toBeGreaterThanOrEqual(100001);
  });
});

describe("GenshinApiClient.fetchProfiles — live (mocked fetch)", () => {
  it("resolves bound roles + folds in active_day_number; sends DS-signed mihoyo headers", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        {
          match: "getUserGameRolesByCookie",
          body: {
            retcode: 0,
            message: "OK",
            data: {
              list: [
                {
                  game_uid: "800000001",
                  nickname: "旅行者",
                  level: 58,
                  region: "cn_gf01",
                  region_name: "天空岛",
                },
              ],
            },
          },
        },
        {
          match: "game_record/app/genshin/api/index",
          body: { retcode: 0, message: "OK", data: { stats: { active_day_number: 421 } } },
        },
      ],
      calls,
    );
    const client = new GenshinApiClient({ fetch, now: FIXED_NOW, rand: FIXED_RAND });
    const profiles = await client.fetchProfiles(COOKIE);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      uid: "800000001",
      nickname: "旅行者",
      level: 58,
      region: "cn_gf01",
      regionName: "天空岛",
      activeDayNumber: 421,
    });
    // DS header present + well-formed on every call; client_type=5, version set.
    for (const c of calls) {
      expect(c.headers.DS).toMatch(/^\d+,\d+,[0-9a-f]{32}$/);
      expect(c.headers["x-rpc-client_type"]).toBe("5");
      expect(c.headers["x-rpc-app_version"]).toBeTruthy();
      expect(c.headers.Cookie).toBe(COOKIE);
    }
    // index request carried role_id + server from the role.
    const idx = calls.find((c) => c.url.includes("/index"));
    expect(idx.url).toContain("role_id=800000001");
    expect(idx.url).toContain("server=cn_gf01");
  });

  it("fetchStats:false skips the game-record index call", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        {
          match: "getUserGameRolesByCookie",
          body: {
            retcode: 0,
            data: { list: [{ game_uid: "1", nickname: "a", level: 1, region: "cn_qd01" }] },
          },
        },
      ],
      calls,
    );
    const client = new GenshinApiClient({ fetch, now: FIXED_NOW, rand: FIXED_RAND });
    const profiles = await client.fetchProfiles(COOKIE, { fetchStats: false });
    expect(profiles[0].activeDayNumber).toBeNull();
    expect(calls.some((c) => c.url.includes("/index"))).toBe(false);
  });

  it("maps mihoyo retcode != 0 to null + lastError (e.g. 1034 risk-control)", async () => {
    const calls = [];
    const fetch = makeFetch(
      [{ match: "getUserGameRolesByCookie", body: { retcode: 1034, message: "请进行验证" } }],
      calls,
    );
    const client = new GenshinApiClient({ fetch, now: FIXED_NOW, rand: FIXED_RAND });
    const profiles = await client.fetchProfiles(COOKIE);
    expect(profiles).toBeNull();
    expect(client.lastError.code).toBe(1034);
    expect(client.lastError.message).toContain("验证");
  });

  it("empty cookie → null + lastError -1 (no network)", async () => {
    const calls = [];
    const client = new GenshinApiClient({
      fetch: makeFetch([], calls),
      now: FIXED_NOW,
      rand: FIXED_RAND,
    });
    expect(await client.fetchProfiles("")).toBeNull();
    expect(client.lastError.code).toBe(-1);
    expect(calls).toHaveLength(0);
  });

  it("HTTP non-2xx → null + lastError with status code", async () => {
    const calls = [];
    const fetch = makeFetch(
      [{ match: "getUserGameRolesByCookie", status: 503, body: "down" }],
      calls,
    );
    const client = new GenshinApiClient({ fetch, now: FIXED_NOW, rand: FIXED_RAND });
    expect(await client.fetchProfiles(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(503);
  });
});

describe("GenshinAdapter — cookie (live) sync mode", () => {
  it("authenticate accepts a valid cookie (mode: cookie)", async () => {
    const a = new GenshinAdapter();
    const r = await a.authenticate({ cookie: COOKIE });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("cookie");
  });

  it("authenticate rejects guest cookie (no uid)", async () => {
    const a = new GenshinAdapter();
    const r = await a.authenticate({ cookie: "foo=bar" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("INVALID_COOKIE");
  });

  it("sync via cookie yields profile raws → valid normalized batch with region/activeDays", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        {
          match: "getUserGameRolesByCookie",
          body: {
            retcode: 0,
            data: {
              list: [
                { game_uid: "800000001", nickname: "旅行者", level: 58, region: "cn_gf01", region_name: "天空岛" },
              ],
            },
          },
        },
        {
          match: "/index",
          body: { retcode: 0, data: { stats: { active_day_number: 421 } } },
        },
      ],
      calls,
    );
    const a = new GenshinAdapter();
    const raws = [];
    for await (const r of a.sync({ cookie: COOKIE, fetch, now: FIXED_NOW, rand: FIXED_RAND })) {
      raws.push(r);
    }
    expect(raws).toHaveLength(1);
    expect(raws[0].kind).toBe("profile");
    expect(raws[0].originalId).toBe("genshin:profile:800000001");

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    const person = batch.persons[0];
    expect(person.identifiers["genshin-uid"]).toEqual(["800000001"]);
    expect(person.extra.region).toBe("cn_gf01");
    expect(person.extra.activeDayNumber).toBe(421);
  });

  it("sync via cookie throws (mapped lastError) on API risk-control", async () => {
    const calls = [];
    const fetch = makeFetch(
      [{ match: "getUserGameRolesByCookie", body: { retcode: 10001, message: "登录失效" } }],
      calls,
    );
    const a = new GenshinAdapter();
    await expect(async () => {
      for await (const _ of a.sync({ cookie: COOKIE, fetch, now: FIXED_NOW, rand: FIXED_RAND })) void _;
    }).rejects.toThrow(/登录失效|code 10001/);
  });
});
