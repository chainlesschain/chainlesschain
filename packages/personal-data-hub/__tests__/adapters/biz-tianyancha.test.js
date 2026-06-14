"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  TianyanchaAdapter,
  extractData,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/biz-tianyancha");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-tyc-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "auth_token=abc; TYCID=xyz";

const SNAP = JSON.stringify({
  schemaVersion: 1,
  snapshottedAt: 1716383000000,
  account: { userId: "u1" },
  events: [
    { kind: "monitor", id: "mon-G1", companyId: "G1", companyName: "字节跳动有限公司", legalPerson: "张利东", regStatus: "存续", capturedAt: 1716300000000 },
    { kind: "search", id: "s-1", query: "小米科技", companyName: "小米科技有限责任公司", capturedAt: 1716320000000 },
  ],
});

describe("constants + extractData", () => {
  it("name/version/schema", () => {
    expect(NAME).toBe("biz-tianyancha");
    expect(VERSION).toBe("0.1.0");
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
  it("extractData tolerant", () => {
    expect(extractData({ data: [{ id: 1 }] })).toHaveLength(1);
    expect(extractData({ data: { resultList: [{ id: 1 }] } })).toHaveLength(1);
    expect(extractData({ list: [{ id: 1 }] })).toHaveLength(1);
    expect(extractData({})).toEqual([]);
  });
});

describe("TianyanchaAdapter snapshot mode", () => {
  it("authenticate validates inputPath", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new TianyanchaAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      expect((await a.authenticate({ inputPath: path.join(os.tmpdir(), "no-tyc.json") })).reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync 2 kinds + normalize monitor→like / search→interaction", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new TianyanchaAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((x) => x.kind)).toEqual(["monitor", "search"]);

      const mon = a.normalize(items[0]);
      expect(mon.events[0].subtype).toBe("like");
      expect(mon.events[0].content.title).toBe("关注公司: 字节跳动有限公司");
      expect(mon.events[0].extra.legalPerson).toBe("张利东");
      expect(mon.events[0].extra.regStatus).toBe("存续");

      const search = a.normalize(items[1]);
      expect(search.events[0].subtype).toBe("interaction");
      expect(search.events[0].content.title).toBe("搜索企业: 小米科技");
      expect(search.events[0].extra.companyName).toBe("小米科技有限责任公司");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("include + limit + schema mismatch + unknown kind", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new TianyanchaAdapter();
      expect((await collect(a.sync({ inputPath: p, include: { monitor: false } }))).map((x) => x.kind)).toEqual(["search"]);
      expect(await collect(a.sync({ inputPath: p, limit: 1 }))).toHaveLength(1);
      expect(() => a.normalize({ kind: "bogus", payload: {} })).toThrow(/unknown kind/);
    } finally {
      fs.unlinkSync(p);
    }
    const bad = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    try {
      const a = new TianyanchaAdapter();
      await expect(collect(a.sync({ inputPath: bad }))).rejects.toThrow(/schemaVersion mismatch/);
    } finally {
      fs.unlinkSync(bad);
    }
  });
});

describe("TianyanchaAdapter cookie-api mode", () => {
  it("authenticate cookie (userId optional)", async () => {
    const a = new TianyanchaAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toEqual({ ok: true, account: null, mode: "cookie" });
  });

  it("sync fetches monitor + search, normalizes", async () => {
    const byUrl = (u) => (u.includes("monitor") ? "monitor" : "search");
    const data = {
      monitor: [{ graphId: "G9", companyName: "腾讯科技", legalPersonName: "马化腾", createTime: 1716300000 }],
      search: [{ id: "h1", keyword: "阿里巴巴", searchTime: 1716320000 }],
    };
    const calls = [];
    const a = new TianyanchaAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async ({ url, cookies, query, sign }) => {
        const k = byUrl(url);
        calls.push({ k, cookies, pageNum: query.pageNum, sign });
        return { data: { list: query.pageNum === 1 ? data[k] : [] } };
      },
    });
    const items = await collect(a.sync({}));
    expect(items.map((x) => x.kind).sort()).toEqual(["monitor", "search"]);
    expect(calls.every((c) => c.cookies === COOKIES && c.sign === null)).toBe(true);
    const mon = a.normalize(items.find((x) => x.kind === "monitor"));
    expect(mon.events[0].content.title).toBe("关注公司: 腾讯科技");
    expect(mon.events[0].extra.legalPerson).toBe("马化腾");
    const search = a.normalize(items.find((x) => x.kind === "search"));
    expect(search.events[0].content.title).toBe("搜索企业: 阿里巴巴");
  });

  it("invokes signProvider + limit + empty + default fetch + no input", async () => {
    const signCalls = [];
    const a = new TianyanchaAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => ({ data: { list: query.pageNum === 1 ? [{ graphId: "G1", companyName: "a" }, { graphId: "G2", companyName: "b" }] : [] } }),
      signProvider: async (ctx) => { signCalls.push(ctx); return "sig"; },
    });
    expect(await collect(a.sync({ limit: 1, include: { search: false } }))).toHaveLength(1);
    expect(signCalls.length).toBeGreaterThan(0);
    expect(signCalls[0].cookies).toBe(COOKIES);

    const a2 = new TianyanchaAdapter({ account: { cookies: COOKIES }, fetchFn: async () => "<html>login</html>" });
    expect(await collect(a2.sync({}))).toEqual([]);

    const a3 = new TianyanchaAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a3.sync({}))).rejects.toThrow(/no fetchFn configured/);

    const a4 = new TianyanchaAdapter();
    await expect(collect(a4.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
