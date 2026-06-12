/**
 * FAMILY-23 v0.2 — edu-zuoyebang LIVE web fetcher tests.
 * cookie (ZYBUSS 会话) → user-info + study-records → snapshot-shaped events +
 * adapter live sync + defensive field extraction + error mapping.
 * All network via injected fetch. Endpoint shapes are best-effort (see
 * api-client header) — these tests pin the REQUEST CONSTRUCTION + PARSING
 * contract, not the live server, which can't be verified here.
 */
"use strict";

import { describe, it, expect } from "vitest";

const { ZuoyebangAdapter } = require("../../lib");
const {
  ZuoyebangApiClient,
} = require("../../lib/adapters/edu-zuoyebang/api-client");
const {
  pick,
  toDurationMs,
  toEpochMs,
} = require("../../lib/adapters/_live-json-helpers");
const { validateBatch } = require("../../lib/batch");

const COOKIE = "ZYBUSS=opaquetoken123; other=1";

function makeFetch(routes, calls) {
  return async (url, init) => {
    calls.push({ url, headers: (init && init.headers) || {} });
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

describe("_live-json-helpers (shared field-extraction)", () => {
  it("pick returns first present non-empty value", () => {
    expect(pick({ a: "", b: "x" }, ["a", "b"])).toBe("x");
    expect(pick({ a: 0 }, ["a"])).toBe(0); // 0 is present
    expect(pick({}, ["a"], "fb")).toBe("fb");
    expect(pick(null, ["a"], "fb")).toBe("fb");
  });

  it("toDurationMs disambiguates seconds vs ms; coerces numeric strings", () => {
    expect(toDurationMs(1800)).toBe(1800000);
    expect(toDurationMs(1800000)).toBe(1800000);
    expect(toDurationMs("900")).toBe(900000);
    expect(toDurationMs("nope")).toBe(0);
  });

  it("toEpochMs coerces seconds/ms/date-string", () => {
    expect(toEpochMs(1700000000)).toBe(1700000000000);
    expect(toEpochMs("1700000000000")).toBe(1700000000000);
    expect(toEpochMs("2023-11-14T22:13:20Z")).toBe(1700000000000);
    expect(toEpochMs("bogus")).toBeNull();
  });
});

describe("ZuoyebangApiClient session probe", () => {
  it("hasSession accepts ZYBUSS-only cookie (uid comes from the API)", () => {
    const c = new ZuoyebangApiClient();
    expect(c.hasSession("ZYBUSS=opaque")).toBe(true);
    expect(c.hasSession("uid=111")).toBe(true);
    expect(c.hasSession("foo=bar")).toBe(false);
    expect(c.lastError.code).toBe(-7);
    expect(c.hasSession("")).toBe(false);
  });
});

describe("ZuoyebangApiClient.fetchSnapshot — live (mocked fetch)", () => {
  it("carries cookie on each GET + parses user/records defensively", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        {
          match: "/session/pc/getuserinfo",
          body: { errNo: 0, data: { user: { uid: 12345, uname: "小红", gradeName: "初二" } } },
        },
        {
          match: "/study/pc/record/list",
          body: {
            errNo: 0,
            data: {
              list: [
                { recordId: "r1", subjectName: "数学", studyTime: 1200, startTime: 1700000000 },
                { logId: "r2", subject: "英语", duration: 900000, createTime: "1700003600" },
              ],
            },
          },
        },
      ],
      calls,
    );
    const client = new ZuoyebangApiClient({ fetch });
    const result = await client.fetchSnapshot(COOKIE);
    expect(result.account).toEqual({ uid: "12345", displayName: "小红" });
    const profile = result.events.find((e) => e.kind === "profile");
    expect(profile).toMatchObject({ uid: "12345", nickname: "小红", grade: "初二" });
    const studies = result.events.filter((e) => e.kind === "study");
    expect(studies).toHaveLength(2);
    expect(studies[0]).toMatchObject({ id: "study-r1", subject: "数学", durationMs: 1200000, startAt: 1700000000000 });
    expect(studies[1]).toMatchObject({ id: "study-r2", subject: "英语", durationMs: 900000, startAt: 1700003600000 });
    for (const c of calls) {
      expect(c.headers.Cookie).toBe(COOKIE);
    }
  });

  it("handles flat user body + alternate envelope key (errno)", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        { match: "/session/pc/getuserinfo", body: { errno: 0, data: { userId: "888", nickName: "阿明" } } },
        { match: "/study/pc/record/list", body: { errno: 0, data: { records: [] } } },
      ],
      calls,
    );
    const client = new ZuoyebangApiClient({ fetch });
    const result = await client.fetchSnapshot(COOKIE);
    expect(result.account).toEqual({ uid: "888", displayName: "阿明" });
  });

  it("include.study:false skips the records call; limit/offset map to rn/pn", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        { match: "/session/pc/getuserinfo", body: { errNo: 0, data: { uid: 1, uname: "x" } } },
        { match: "/study/pc/record/list", body: { errNo: 0, data: { list: [] } } },
      ],
      calls,
    );
    const client = new ZuoyebangApiClient({ fetch });
    await client.fetchSnapshot(COOKIE, { include: { study: false } });
    expect(calls.some((c) => c.url.includes("record/list"))).toBe(false);

    await client.fetchSnapshot(COOKIE, { limit: 5, offset: 2 });
    const rec = calls.find((c) => c.url.includes("record/list"));
    expect(rec.url).toContain("pn=2");
    expect(rec.url).toContain("rn=5");
  });

  it("maps non-zero errNo to null + lastError (e.g. session expired)", async () => {
    const fetch = makeFetch(
      [{ match: "/session/pc/getuserinfo", body: { errNo: 3, errstr: "未登录" } }],
      [],
    );
    const client = new ZuoyebangApiClient({ fetch });
    expect(await client.fetchSnapshot(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(3);
    expect(client.lastError.message).toContain("未登录");
  });

  it("no session cookie → null + lastError -7 (no network)", async () => {
    const calls = [];
    const client = new ZuoyebangApiClient({ fetch: makeFetch([], calls) });
    expect(await client.fetchSnapshot("foo=bar")).toBeNull();
    expect(client.lastError.code).toBe(-7);
    expect(calls).toHaveLength(0);
  });

  it("HTTP non-2xx → null + lastError with status", async () => {
    const fetch = makeFetch([{ match: "/session/pc/getuserinfo", status: 503, body: "down" }], []);
    const client = new ZuoyebangApiClient({ fetch });
    expect(await client.fetchSnapshot(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(503);
  });
});

describe("ZuoyebangAdapter — cookie (live) sync mode", () => {
  it("authenticate accepts ZYBUSS cookie; rejects sessionless", async () => {
    const a = new ZuoyebangAdapter();
    expect((await a.authenticate({ cookie: COOKIE })).mode).toBe("cookie");
    const bad = await a.authenticate({ cookie: "foo=bar" });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("INVALID_COOKIE");
  });

  it("version/capabilities reflect v0.2 live mode", () => {
    const a = new ZuoyebangAdapter();
    expect(a.version).toBe("0.2.0");
    expect(a.capabilities).toContain("sync:cookie");
  });

  it("sync via cookie yields profile+study raws → valid normalized batch", async () => {
    const fetch = makeFetch(
      [
        { match: "/session/pc/getuserinfo", body: { errNo: 0, data: { user: { uid: 12345, uname: "小红", gradeName: "初二" } } } },
        { match: "/study/pc/record/list", body: { errNo: 0, data: { list: [{ recordId: "r1", subjectName: "数学", studyTime: 1200, startTime: 1700000000 }] } } },
      ],
      [],
    );
    const a = new ZuoyebangAdapter();
    const raws = await collect(a.sync({ cookie: COOKIE, fetch }));
    expect(raws.map((r) => r.kind).sort()).toEqual(["profile", "study"]);
    const profileRaw = raws.find((r) => r.kind === "profile");
    expect(profileRaw.originalId).toBe("zuoyebang:profile:profile-12345");

    for (const raw of raws) {
      expect(validateBatch(a.normalize(raw)).valid).toBe(true);
    }
    const profileBatch = a.normalize(profileRaw);
    expect(profileBatch.persons[0].identifiers["zuoyebang-uid"]).toEqual(["12345"]);
    expect(profileBatch.persons[0].extra.grade).toBe("初二");
    const studyBatch = a.normalize(raws.find((r) => r.kind === "study"));
    expect(studyBatch.events[0].extra.subject).toBe("数学");
    expect(studyBatch.events[0].extra.durationMs).toBe(1200000);
  });

  it("sync via cookie throws (mapped lastError) on API error", async () => {
    const fetch = makeFetch(
      [{ match: "/session/pc/getuserinfo", body: { errNo: 3, errstr: "未登录" } }],
      [],
    );
    const a = new ZuoyebangAdapter();
    await expect(collect(a.sync({ cookie: COOKIE, fetch }))).rejects.toThrow(/未登录|code 3/);
  });
});
