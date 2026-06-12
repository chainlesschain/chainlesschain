/**
 * FAMILY-23 v0.2 — edu-huawei-learning LIVE web fetcher tests.
 * cookie (华为账号会话) → user-info + study-records → snapshot-shaped events +
 * adapter live sync + defensive field extraction + error mapping.
 * All network via injected fetch. Endpoint shapes are best-effort (see
 * api-client header) — these tests pin the REQUEST CONSTRUCTION + PARSING
 * contract, not the live server, which can't be verified here.
 */
"use strict";

import { describe, it, expect } from "vitest";

const { HuaweiLearningAdapter } = require("../../lib");
const {
  HuaweiLearningApiClient,
} = require("../../lib/adapters/edu-huawei-learning/api-client");
const { validateBatch } = require("../../lib/batch");

const COOKIE = "accountId=555; CASTGC=tok-xyz";

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

describe("HuaweiLearningApiClient session probe", () => {
  it("hasSession is lenient: any k=v cookie passes, empty/garbage fails", () => {
    const c = new HuaweiLearningApiClient();
    expect(c.hasSession("CASTGC=tok")).toBe(true);
    expect(c.hasSession(COOKIE)).toBe(true);
    expect(c.hasSession("")).toBe(false);
    expect(c.lastError.code).toBe(-7);
    expect(c.hasSession("garbage")).toBe(false);
  });
});

describe("HuaweiLearningApiClient.fetchSnapshot — live (mocked fetch)", () => {
  it("carries cookie on each GET + parses user/records defensively", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        {
          match: "/edu/api/user/v1/info",
          body: { code: 0, data: { user: { accountId: 555, nickName: "小华" } } },
        },
        {
          match: "/edu/api/study/v1/records",
          body: {
            code: 0,
            data: {
              records: [
                { recordId: "c1", courseName: "物理", studyDuration: 1500, startTime: 1700000000 },
                { id: "c2", title: "化学", duration: 600000, createTime: "1700003600" },
              ],
            },
          },
        },
      ],
      calls,
    );
    const client = new HuaweiLearningApiClient({ fetch });
    const result = await client.fetchSnapshot(COOKIE);
    expect(result.account).toEqual({ uid: "555", displayName: "小华" });
    const profile = result.events.find((e) => e.kind === "profile");
    expect(profile).toMatchObject({ uid: "555", nickname: "小华" });
    const studies = result.events.filter((e) => e.kind === "study");
    expect(studies).toHaveLength(2);
    expect(studies[0]).toMatchObject({ id: "study-c1", course: "物理", durationMs: 1500000, startAt: 1700000000000 });
    expect(studies[1]).toMatchObject({ id: "study-c2", course: "化学", durationMs: 600000, startAt: 1700003600000 });
    for (const c of calls) {
      expect(c.headers.Cookie).toBe(COOKIE);
    }
  });

  it("handles alternate envelope (resultCode + result + list)", async () => {
    const fetch = makeFetch(
      [
        { match: "/edu/api/user/v1/info", body: { resultCode: 0, result: { userId: "999", displayName: "阿福" } } },
        { match: "/edu/api/study/v1/records", body: { resultCode: 0, result: { list: [{ logId: "z1", name: "数学", learnTime: 300 }] } } },
      ],
      [],
    );
    const client = new HuaweiLearningApiClient({ fetch });
    const result = await client.fetchSnapshot(COOKIE);
    expect(result.account).toEqual({ uid: "999", displayName: "阿福" });
    const study = result.events.find((e) => e.kind === "study");
    expect(study).toMatchObject({ id: "study-z1", course: "数学", durationMs: 300000 });
  });

  it("include.study:false skips records; limit/offset land in the query", async () => {
    const calls = [];
    const fetch = makeFetch(
      [
        { match: "/edu/api/user/v1/info", body: { code: 0, data: { accountId: 1, nickName: "x" } } },
        { match: "/edu/api/study/v1/records", body: { code: 0, data: { records: [] } } },
      ],
      calls,
    );
    const client = new HuaweiLearningApiClient({ fetch });
    await client.fetchSnapshot(COOKIE, { include: { study: false } });
    expect(calls.some((c) => c.url.includes("/study/v1/records"))).toBe(false);

    await client.fetchSnapshot(COOKIE, { limit: 7, offset: 3 });
    const rec = calls.find((c) => c.url.includes("/study/v1/records"));
    expect(rec.url).toContain("offset=3");
    expect(rec.url).toContain("limit=7");
  });

  it("maps non-zero code to null + lastError", async () => {
    const fetch = makeFetch(
      [{ match: "/edu/api/user/v1/info", body: { code: 401, message: "会话过期" } }],
      [],
    );
    const client = new HuaweiLearningApiClient({ fetch });
    expect(await client.fetchSnapshot(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(401);
    expect(client.lastError.message).toContain("会话过期");
  });

  it("no session cookie → null + lastError -7 (no network)", async () => {
    const calls = [];
    const client = new HuaweiLearningApiClient({ fetch: makeFetch([], calls) });
    expect(await client.fetchSnapshot("")).toBeNull();
    expect(client.lastError.code).toBe(-7);
    expect(calls).toHaveLength(0);
  });

  it("HTTP non-2xx → null + lastError with status", async () => {
    const fetch = makeFetch([{ match: "/edu/api/user/v1/info", status: 500, body: "err" }], []);
    const client = new HuaweiLearningApiClient({ fetch });
    expect(await client.fetchSnapshot(COOKIE)).toBeNull();
    expect(client.lastError.code).toBe(500);
  });
});

describe("HuaweiLearningAdapter — cookie (live) sync mode", () => {
  it("authenticate accepts a session cookie; rejects empty", async () => {
    const a = new HuaweiLearningAdapter();
    expect((await a.authenticate({ cookie: COOKIE })).mode).toBe("cookie");
    const bad = await a.authenticate({ cookie: "garbage" });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("INVALID_COOKIE");
  });

  it("version/capabilities reflect v0.2 live mode", () => {
    const a = new HuaweiLearningAdapter();
    expect(a.version).toBe("0.2.0");
    expect(a.capabilities).toContain("sync:cookie");
  });

  it("sync via cookie yields profile+study raws → valid normalized batch", async () => {
    const fetch = makeFetch(
      [
        { match: "/edu/api/user/v1/info", body: { code: 0, data: { accountId: 555, nickName: "小华" } } },
        { match: "/edu/api/study/v1/records", body: { code: 0, data: { records: [{ recordId: "c1", courseName: "物理", studyDuration: 1500, startTime: 1700000000 }] } } },
      ],
      [],
    );
    const a = new HuaweiLearningAdapter();
    const raws = await collect(a.sync({ cookie: COOKIE, fetch }));
    expect(raws.map((r) => r.kind).sort()).toEqual(["profile", "study"]);
    const profileRaw = raws.find((r) => r.kind === "profile");
    expect(profileRaw.originalId).toBe("huaweilearning:profile:profile-555");

    for (const raw of raws) {
      expect(validateBatch(a.normalize(raw)).valid).toBe(true);
    }
    const profileBatch = a.normalize(profileRaw);
    expect(profileBatch.persons[0].identifiers["huawei-learning-uid"]).toEqual(["555"]);
    const studyBatch = a.normalize(raws.find((r) => r.kind === "study"));
    expect(studyBatch.events[0].extra.course).toBe("物理");
    expect(studyBatch.events[0].extra.durationMs).toBe(1500000);
  });

  it("sync via cookie throws (mapped lastError) on API error", async () => {
    const fetch = makeFetch(
      [{ match: "/edu/api/user/v1/info", body: { code: 401, message: "会话过期" } }],
      [],
    );
    const a = new HuaweiLearningAdapter();
    await expect(collect(a.sync({ cookie: COOKIE, fetch }))).rejects.toThrow(/会话过期|code 401/);
  });
});
