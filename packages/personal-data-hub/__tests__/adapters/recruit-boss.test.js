"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  BossZhipinAdapter,
  extractData,
  chatItemToRecord,
  applicationItemToRecord,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/recruit-boss");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-boss-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "wt2=abc; __zp_stoken__=xyz";

const SNAP = JSON.stringify({
  schemaVersion: 1,
  snapshottedAt: 1716383000000,
  account: { userId: "u1", name: "我" },
  events: [
    { kind: "chat", id: "chat-J1", jobId: "J1", jobTitle: "前端工程师", company: "字节跳动", hrName: "李 HR", hrId: "HR9", salary: "25-40K", city: "北京", lastChatTime: 1716300000 },
    { kind: "application", id: "apply-J2", jobId: "J2", jobTitle: "后端工程师", company: "腾讯", status: "已查看", deliverTime: 1716310000 },
  ],
});

describe("constants + item mappers", () => {
  it("name/version/schema", () => {
    expect(NAME).toBe("recruit-boss");
    expect(VERSION).toBe("0.1.0");
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
  it("chatItemToRecord maps BOSS chat fields", () => {
    const r = chatItemToRecord({ jobId: "J1", jobName: "前端", brandName: "字节", bossName: "王HR", bossId: "B1", salaryDesc: "30K", cityName: "深圳", lastChatTime: 1716300000 });
    expect(r).toMatchObject({ id: "J1", jobTitle: "前端", company: "字节", hrName: "王HR", hrId: "B1", salary: "30K", city: "深圳" });
    expect(r.occurredAt).toBe(1716300000000);
    expect(chatItemToRecord({ jobName: "noid" })).toBe(null);
  });
  it("applicationItemToRecord maps delivery fields", () => {
    const r = applicationItemToRecord({ jobId: "J2", jobName: "后端", brandName: "腾讯", statusDesc: "已查看", deliverTime: 1716310000 });
    expect(r).toMatchObject({ id: "J2", jobTitle: "后端", company: "腾讯", status: "已查看" });
    expect(r.occurredAt).toBe(1716310000000);
  });
  it("extractData tolerant (data/list/zpData.list)", () => {
    expect(extractData({ data: [{ jobId: 1 }] })).toHaveLength(1);
    expect(extractData({ zpData: { list: [{ jobId: 1 }] } })).toHaveLength(1);
    expect(extractData({})).toEqual([]);
  });
});

describe("BossZhipinAdapter snapshot mode", () => {
  it("authenticate validates inputPath", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new BossZhipinAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      expect((await a.authenticate({ inputPath: path.join(os.tmpdir(), "no-boss.json") })).reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync yields chat+application; normalize → interaction event + HR person", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new BossZhipinAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((x) => x.kind)).toEqual(["chat", "application"]);

      const chat = a.normalize(items[0]);
      expect(chat.events[0].subtype).toBe("interaction");
      expect(chat.events[0].content.title).toBe("沟通职位: 前端工程师 @ 字节跳动");
      expect(chat.persons[0].subtype).toBe("contact");
      expect(chat.persons[0].names).toEqual(["李 HR"]);
      expect(chat.persons[0].identifiers["boss-hr-id"]).toEqual(["HR9"]);
      expect(chat.events[0].participants).toContain(chat.persons[0].id);

      const app = a.normalize(items[1]);
      expect(app.events[0].content.title).toBe("投递简历: 后端工程师 @ 腾讯");
      expect(app.events[0].extra.status).toBe("已查看");
      expect(app.persons).toEqual([]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("include filter + limit + schema mismatch + unknown kind", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new BossZhipinAdapter();
      expect((await collect(a.sync({ inputPath: p, include: { chat: false } }))).map((x) => x.kind)).toEqual(["application"]);
      expect(await collect(a.sync({ inputPath: p, limit: 1 }))).toHaveLength(1);
      expect(() => a.normalize({ kind: "bogus", payload: {} })).toThrow(/unknown kind/);
    } finally {
      fs.unlinkSync(p);
    }
    const bad = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    try {
      const a = new BossZhipinAdapter();
      await expect(collect(a.sync({ inputPath: bad }))).rejects.toThrow(/schemaVersion mismatch/);
    } finally {
      fs.unlinkSync(bad);
    }
  });
});

describe("BossZhipinAdapter cookie-api mode", () => {
  it("authenticate cookie mode (userId optional)", async () => {
    const a = new BossZhipinAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toEqual({ ok: true, account: null, mode: "cookie" });
  });

  it("sync fetches chats + deliveries, normalizes", async () => {
    const byUrl = (url) => (url.includes("contactList") ? "chats" : "deliveries");
    const data = {
      chats: [{ jobId: "C1", jobName: "全栈", brandName: "小米", bossName: "赵HR", bossId: "B2", lastChatTime: 1716300000 }],
      deliveries: [{ jobId: "D1", jobName: "测试", brandName: "美团", statusDesc: "已投递", deliverTime: 1716310000 }],
    };
    const calls = [];
    const fetchFn = async ({ url, cookies, query, sign }) => {
      const k = byUrl(url);
      calls.push({ k, cookies, page: query.page, sign });
      return { zpData: { list: query.page === 1 ? data[k] : [] } };
    };
    const a = new BossZhipinAdapter({ account: { cookies: COOKIES }, fetchFn });
    const items = await collect(a.sync({}));
    expect(items.map((x) => x.kind).sort()).toEqual(["application", "chat"]);
    expect(calls.every((c) => c.cookies === COOKIES && c.sign === null)).toBe(true);
    const chat = a.normalize(items.find((x) => x.kind === "chat"));
    expect(chat.events[0].content.title).toBe("沟通职位: 全栈 @ 小米");
    expect(chat.persons[0].names).toEqual(["赵HR"]);
    const app = a.normalize(items.find((x) => x.kind === "application"));
    expect(app.events[0].content.title).toBe("投递简历: 测试 @ 美团");
  });

  it("invokes signProvider when configured", async () => {
    const signCalls = [];
    const a = new BossZhipinAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => ({ zpData: { list: query.page === 1 ? [{ jobId: "C1", jobName: "x" }] : [] } }),
      signProvider: async (ctx) => { signCalls.push(ctx); return "__zp_stoken__sig"; },
    });
    const items = await collect(a.sync({ include: { application: false } }));
    expect(items.length).toBeGreaterThan(0);
    expect(signCalls.length).toBeGreaterThan(0);
    expect(signCalls[0].cookies).toBe(COOKIES);
  });

  it("limit + empty/login response + default fetch + no input", async () => {
    const a1 = new BossZhipinAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => ({ data: query.page === 1 ? [{ jobId: "C1", jobName: "a" }, { jobId: "C2", jobName: "b" }] : [] }),
    });
    expect(await collect(a1.sync({ limit: 1 }))).toHaveLength(1);

    const a2 = new BossZhipinAdapter({ account: { cookies: COOKIES }, fetchFn: async () => "<html>login</html>" });
    expect(await collect(a2.sync({}))).toEqual([]);

    const a3 = new BossZhipinAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a3.sync({}))).rejects.toThrow(/no fetchFn configured/);

    const a4 = new BossZhipinAdapter();
    await expect(collect(a4.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
