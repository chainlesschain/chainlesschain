"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const ix = require("../../lib/adapters/gov-ixiamen");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-ix-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "XMGOV_SSO=abc; tgc=xyz";

describe("gov-ixiamen mappers", () => {
  it("name/version/capabilities", () => {
    expect(ix.NAME).toBe("gov-ixiamen");
    expect(ix.VERSION).toBe("0.3.0");
  });
  it("inferCategory: explicit wins, else keyword, else fallback", () => {
    expect(ix.inferCategory("随便", "医保")).toBe("医保");
    expect(ix.inferCategory("城乡居民医保缴费")).toBe("医保");
    expect(ix.inferCategory("住房公积金提取")).toBe("公积金");
    expect(ix.inferCategory("机动车违章处理")).toBe("车驾管");
    expect(ix.inferCategory("某个没见过的事项")).toBe("其他政务");
  });
  it("mapService maps gov-service fields; no id → null", () => {
    const rec = ix.mapService({
      service_id: "S1",
      service_name: "养老保险待遇资格认证",
      handle_time: 1716383000,
      status: "已办结",
      deptName: "厦门市社保中心",
    });
    expect(rec).toMatchObject({ serviceId: "S1", category: "社保", status: "已办结", dept: "厦门市社保中心" });
    expect(rec.handledMs).toBe(1716383000000);
    expect(ix.mapService({ service_name: "noid" })).toBe(null);
  });
  it("extractList tolerant", () => {
    expect(ix.extractList({ list: [{ id: 1 }] })).toHaveLength(1);
    expect(ix.extractList({ data: { records: [{ id: 1 }] } })).toHaveLength(1);
    expect(ix.extractList({})).toEqual([]);
  });
});

describe("IXiamenAdapter (snapshot + cookie-api)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1", name: "张三" },
    events: [
      {
        kind: "service",
        id: "svc-S1",
        serviceId: "S1",
        serviceName: "住房公积金缴存明细查询",
        handledTime: 1716383000,
        status: "已办结",
        dept: "厦门住房公积金中心",
      },
    ],
  });

  it("snapshot sync + normalize → INTERACTION event + category topic", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new ix.IXiamenAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      expect(items[0].originalId).toBe("ixiamen:service:S1");
      const batch = a.normalize(items[0]);
      expect(batch.events[0].subtype).toBe("interaction");
      expect(batch.events[0].content.title).toBe("办理: 住房公积金缴存明细查询");
      expect(batch.events[0].extra.category).toBe("公积金");
      expect(batch.topics[0].name).toBe("公积金");
      expect(batch.topics[0].id).toBe("topic-ixiamen-cat-公积金");
      expect(batch.events[0].extra.topicRef).toBe("topic-ixiamen-cat-公积金");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("dataDisclosure: high sensitivity + legalGate (gov real-name)", () => {
    const a = new ix.IXiamenAdapter();
    expect(a.dataDisclosure.sensitivity).toBe("high");
    expect(a.dataDisclosure.legalGate).toBe(true);
  });

  it("cookie-api: best-effort fetch + paginate + unverified flag", async () => {
    const pages = [
      { list: [{ id: 7, name: "门诊报销", category: "医保", handledTime: 1716383000 }] },
      { list: [] },
    ];
    const calls = [];
    const a = new ix.IXiamenAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      listUrl: "https://buss.ixiamen.org.cn/pbc/captured/handle/list",
      fetchFn: async ({ url, cookies, query, sign }) => {
        calls.push({ url, cookies, page: query.page, sign });
        return query.page === 1 ? pages[0] : pages[1];
      },
    });
    const auth = await a.authenticate();
    expect(auth).toMatchObject({ ok: true, mode: "cookie", unverified: true });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("ixiamen:service:7");
    expect(calls[0].cookies).toBe(COOKIES);
    expect(calls[0].sign).toBe(null);
    const batch = a.normalize(items[0]);
    expect(batch.events[0].extra.category).toBe("医保");
  });

  it("cookie-api: signProvider seam invoked + sinceWatermark stops early", async () => {
    let seen = null;
    const a = new ix.IXiamenAdapter({
      account: { cookies: COOKIES },
      listUrl: "https://buss.ixiamen.org.cn/pbc/captured/handle/list",
      signProvider: async ({ url, query }) => {
        seen = { url, page: query.page };
        return "gov-sig";
      },
      fetchFn: async () => ({
        list: [
          { id: "new", name: "新事项", handledTime: 1716390000 },
          { id: "old", name: "旧事项", handledTime: 1700000000 },
        ],
      }),
    });
    const items = await collect(a.sync({ sinceWatermark: 1716000000000 }));
    expect(items).toHaveLength(1); // old one below watermark stops iteration
    expect(items[0].originalId).toBe("ixiamen:service:new");
    expect(seen.url).toContain("buss.ixiamen.org.cn");
  });

  it("unverified live endpoint is rejected; no input throws", async () => {
    const a = new ix.IXiamenAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toMatchObject({ ok: false, reason: "EXPLICIT_ENDPOINT_REQUIRED" });
    await expect(collect(a.sync({}))).rejects.toThrow(/explicit listUrl/);
    const b = new ix.IXiamenAdapter();
    await expect(collect(b.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
