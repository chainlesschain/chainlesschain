/**
 * FAMILY-23 v0.2 — game-honor-of-kings LIVE 营地 (Camp) fetcher tests.
 * credential (accessToken+openid+role) → profile + battle-list → snapshot-shaped
 * events + adapter live sync + defensive field extraction + error mapping.
 * All network via injected fetch. Endpoint shapes are best-effort (see api-client
 * header) — these tests pin the REQUEST CONSTRUCTION + PARSING contract, not the
 * live server, which can't be verified here.
 */
"use strict";

import { describe, it, expect } from "vitest";

const { HonorOfKingsAdapter } = require("../../lib");
const {
  HonorOfKingsApiClient,
  pick,
  toDurationMs,
  toEpochMs,
} = require("../../lib/adapters/game-honor-of-kings/api-client");
const { validateBatch } = require("../../lib/batch");

const CRED = {
  accessToken: "tok-abc",
  openid: "OPENID12345678",
  acctype: "qc",
  areaId: "1",
  roleId: "900000001",
};

function makeFetch(routes, calls) {
  return async (url, init) => {
    let parsedBody = null;
    try {
      parsedBody = init && init.body ? JSON.parse(init.body) : null;
    } catch (_e) {
      parsedBody = init && init.body;
    }
    calls.push({ url, body: parsedBody, headers: (init && init.headers) || {} });
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

describe("honor-of-kings field-extraction helpers", () => {
  it("pick returns first present non-empty value", () => {
    expect(pick({ a: "", b: "x" }, ["a", "b"])).toBe("x");
    expect(pick({ a: 0 }, ["a"])).toBe(0); // 0 is present
    expect(pick({}, ["a"], "fb")).toBe("fb");
  });

  it("toDurationMs treats <1e7 as seconds, else ms; coerces numeric strings", () => {
    expect(toDurationMs(1800)).toBe(1800000); // 30 min in seconds
    expect(toDurationMs(1800000)).toBe(1800000); // already ms
    expect(toDurationMs("900")).toBe(900000);
    expect(toDurationMs(0)).toBe(0);
    expect(toDurationMs("nope")).toBe(0);
  });

  it("toEpochMs coerces seconds/ms/date-string", () => {
    expect(toEpochMs(1700000000)).toBe(1700000000000);
    expect(toEpochMs(1700000000000)).toBe(1700000000000);
    expect(toEpochMs("2023-11-14T22:13:20Z")).toBe(1700000000000);
    expect(toEpochMs("bogus")).toBeNull();
  });
});

describe("HonorOfKingsApiClient.fetchSnapshot — live (mocked fetch)", () => {
  it("merges auth fields into each request + parses profile/battles defensively", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        {
          match: "/play/profildetail",
          body: {
            returnCode: 0,
            data: { role: { roleId: "900000001", roleName: "小明", level: 30, rankName: "钻石", logo: "u.png" } },
          },
        },
        {
          match: "/game/getbattlelist",
          body: {
            returnCode: 0,
            data: {
              list: [
                { gameSeq: "g1", startTime: 1700000000, gametime: 900, mapName: "排位赛" },
                { gameSeq: "g2", startTime: "1700003600", usedTime: 1200, modeName: "巅峰赛" },
              ],
            },
          },
        },
      ],
      calls,
    );
    const client = new HonorOfKingsApiClient({ fetch });
    const result = await client.fetchSnapshot(CRED);
    expect(result.account).toEqual({ uid: "900000001", displayName: "小明" });
    const profile = result.events.find((e) => e.kind === "profile");
    expect(profile).toMatchObject({ uid: "900000001", nickname: "小明", level: 30, rank: "钻石", avatarUrl: "u.png" });
    const plays = result.events.filter((e) => e.kind === "play");
    expect(plays).toHaveLength(2);
    expect(plays[0]).toMatchObject({ durationMs: 900000, mode: "排位赛", startAt: 1700000000000 });
    expect(plays[1]).toMatchObject({ durationMs: 1200000, mode: "巅峰赛", startAt: 1700003600000 });
    // every request carried the OAuth auth fields.
    for (const c of calls) {
      expect(c.body.accessToken).toBe("tok-abc");
      expect(c.body.openid).toBe("OPENID12345678");
      expect(c.body.acctype).toBe("qc");
      expect(c.headers["Content-Type"]).toContain("application/json");
    }
  });

  it("handles alternate envelope/field names (result + roleInfo + battleList)", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        {
          match: "/play/profildetail",
          body: { result: 0, data: { roleInfo: { uid: "777", nickName: "阿强", roleLevel: 15, gradeName: "黄金" } } },
        },
        {
          match: "/game/getbattlelist",
          body: { result: 0, data: { battleList: [{ gameId: "b9", battleTime: 1700000000, gameDuration: 600, gameName: "5v5" }] } },
        },
      ],
      calls,
    );
    const client = new HonorOfKingsApiClient({ fetch });
    const result = await client.fetchSnapshot(CRED);
    expect(result.account.displayName).toBe("阿强");
    const profile = result.events.find((e) => e.kind === "profile");
    expect(profile).toMatchObject({ uid: "777", level: 15, rank: "黄金" });
    const play = result.events.find((e) => e.kind === "play");
    expect(play).toMatchObject({ durationMs: 600000, mode: "5v5" });
  });

  it("include.play:false skips the battle-list call", async () => {
    const calls = [];
    const fetch = makeFetch(
      [{ match: "/play/profildetail", body: { returnCode: 0, data: { role: { roleId: "1", roleName: "x" } } } }],
      calls,
    );
    const client = new HonorOfKingsApiClient({ fetch });
    const result = await client.fetchSnapshot(CRED, { include: { play: false } });
    expect(calls.some((c) => c.url.includes("getbattlelist"))).toBe(false);
    expect(result.events.every((e) => e.kind !== "play")).toBe(true);
  });

  it("maps non-zero returnCode to null + lastError (e.g. token expired)", async () => {
    const calls = [];
    const fetch = makeFetch([{ match: "/play/profildetail", body: { returnCode: 1001, returnMsg: "登录态失效" } }], calls);
    const client = new HonorOfKingsApiClient({ fetch });
    expect(await client.fetchSnapshot(CRED)).toBeNull();
    expect(client.lastError.code).toBe(1001);
    expect(client.lastError.message).toContain("登录态失效");
  });

  it("missing accessToken/openid → null + lastError -1 (no network)", async () => {
    const calls = [];
    const client = new HonorOfKingsApiClient({ fetch: makeFetch([], calls) });
    expect(await client.fetchSnapshot({ openid: "x" })).toBeNull();
    expect(client.lastError.code).toBe(-1);
    expect(calls).toHaveLength(0);
  });

  it("HTTP non-2xx → null + lastError with status", async () => {
    const calls = [];
    const fetch = makeFetch([{ match: "/play/profildetail", status: 500, body: "err" }], calls);
    const client = new HonorOfKingsApiClient({ fetch });
    expect(await client.fetchSnapshot(CRED)).toBeNull();
    expect(client.lastError.code).toBe(500);
  });
});

describe("HonorOfKingsAdapter — credential (live) sync mode", () => {
  it("authenticate accepts a credential bundle; rejects incomplete", async () => {
    const a = new HonorOfKingsAdapter();
    expect((await a.authenticate({ credential: CRED })).mode).toBe("camp-token");
    expect((await a.authenticate({ credential: { openid: "x" } })).ok).toBe(false);
  });

  it("version/capabilities reflect v0.2 live mode", () => {
    const a = new HonorOfKingsAdapter();
    expect(a.version).toBe("0.2.0");
    expect(a.capabilities).toContain("sync:camp-token");
  });

  it("sync via credential yields profile+play raws → valid normalized batch", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        { match: "/play/profildetail", body: { returnCode: 0, data: { role: { roleId: "900000001", roleName: "小明", level: 30, rankName: "钻石" } } } },
        { match: "/game/getbattlelist", body: { returnCode: 0, data: { list: [{ gameSeq: "g1", startTime: 1700000000, gametime: 1800, mapName: "排位赛" }] } } },
      ],
      calls,
    );
    const a = new HonorOfKingsAdapter();
    const raws = await collect(a.sync({ credential: CRED, fetch }));
    expect(raws.map((r) => r.kind).sort()).toEqual(["play", "profile"]);
    const profileRaw = raws.find((r) => r.kind === "profile");
    expect(profileRaw.originalId).toBe("hok:profile:profile-900000001");

    for (const raw of raws) {
      expect(validateBatch(a.normalize(raw)).valid).toBe(true);
    }
    const profileBatch = a.normalize(profileRaw);
    expect(profileBatch.persons[0].identifiers["hok-uid"]).toEqual(["900000001"]);
    expect(profileBatch.persons[0].extra.rank).toBe("钻石");
    const playBatch = a.normalize(raws.find((r) => r.kind === "play"));
    expect(playBatch.events[0].extra.durationMs).toBe(1800000);
  });

  it("sync via credential throws (mapped lastError) on API error", async () => {
    const calls = [];
    const fetch = makeFetch([{ match: "/play/profildetail", body: { returnCode: 1001, returnMsg: "登录态失效" } }], calls);
    const a = new HonorOfKingsAdapter();
    await expect(collect(a.sync({ credential: CRED, fetch }))).rejects.toThrow(/登录态失效|code 1001/);
  });
});
