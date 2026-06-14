"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const wps = require("../../lib/adapters/doc-wps");
const tdocs = require("../../lib/adapters/doc-tencent-docs");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-doc-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "wps_sid=abc; uid=1";

describe("doc-wps constants + mappers", () => {
  it("exposes name/version", () => {
    expect(wps.NAME).toBe("doc-wps");
    expect(wps.VERSION).toBe("0.1.0");
  });
  it("mapDoc maps WPS fields + infers docType from extension", () => {
    const rec = wps.mapDoc({ id: "F1", fname: "预算.xlsx", ctime: 1716300000, mtime: 1716383000 });
    expect(rec).toMatchObject({ docId: "F1", title: "预算.xlsx", docType: "sheet" });
    expect(rec.createdMs).toBe(1716300000000);
    expect(rec.updatedMs).toBe(1716383000000);
    expect(rec.url).toContain("kdocs.cn");
    expect(wps.mapDoc({ id: "F2", fname: "方案.pptx" }).docType).toBe("slide");
    expect(wps.mapDoc({ id: "F3", fname: "说明.docx" }).docType).toBe("doc");
    expect(wps.mapDoc({ fname: "noid" })).toBe(null);
  });
  it("extractDocs tolerant of shapes", () => {
    expect(wps.extractDocs({ files: [{ id: 1 }] })).toHaveLength(1);
    expect(wps.extractDocs({ data: { files: [{ id: 1 }] } })).toHaveLength(1);
    expect(wps.extractDocs({})).toEqual([]);
  });
});

describe("doc-tencent-docs constants + mappers", () => {
  it("exposes name/version", () => {
    expect(tdocs.NAME).toBe("doc-tencent-docs");
    expect(tdocs.VERSION).toBe("0.1.0");
  });
  it("mapDoc maps Tencent fields + type codes", () => {
    const rec = tdocs.mapDoc({ id: "T1", title: "周报", type: "sheet", createTime: 1716300000, lastModifyTime: 1716383000 });
    expect(rec).toMatchObject({ docId: "T1", title: "周报", docType: "sheet" });
    expect(rec.url).toContain("docs.qq.com");
    expect(tdocs.mapDoc({ id: "T2", type: 2 }).docType).toBe("sheet");
    expect(tdocs.mapDoc({ id: "T3", type: "presentation" }).docType).toBe("slide");
    expect(tdocs.mapDoc({ title: "noid" })).toBe(null);
  });
});

describe("WpsDocAdapter snapshot mode", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      { kind: "document", id: "doc-D1", docId: "D1", title: "我的文档", docType: "doc", createdTime: 1716300000, updatedTime: 1716383000, url: "https://kdocs.cn/p/D1" },
    ],
  });

  it("authenticate validates inputPath", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new wps.WpsDocAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      expect((await a.authenticate({ inputPath: path.join(os.tmpdir(), "nope.json") })).reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sync yields doc + normalize → event(post)+item(document)", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new wps.WpsDocAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      expect(items[0].originalId).toBe("wps:document:doc-D1");
      const batch = a.normalize(items[0]);
      expect(batch.events[0].subtype).toBe("post");
      expect(batch.events[0].content.title).toBe("文档: 我的文档");
      expect(batch.items[0].subtype).toBe("document");
      expect(batch.items[0].name).toBe("我的文档");
      expect(batch.items[0].extra.platform).toBe("wps");
      // event references the item
      expect(batch.events[0].extra.itemRef).toBe(batch.items[0].id);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("schemaVersion mismatch throws; normalize missing record throws", async () => {
    const p = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    try {
      const a = new wps.WpsDocAdapter();
      await expect(collect(a.sync({ inputPath: p }))).rejects.toThrow(/schemaVersion mismatch/);
      expect(() => a.normalize({ payload: {} })).toThrow(/payload.record missing/);
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("TencentDocsAdapter cookie-api mode", () => {
  it("authenticate cookie mode (userId optional)", async () => {
    const a = new tdocs.TencentDocsAdapter({ account: { cookies: COOKIES } });
    expect(await a.authenticate()).toEqual({ ok: true, account: null, mode: "cookie" });
  });

  it("sync fetches, paginates, normalizes", async () => {
    const pages = [
      { data: { files: [{ id: "T1", title: "项目计划", type: "doc", lastModifyTime: 1716383000 }] } },
      { data: { files: [] } },
    ];
    const calls = [];
    const fetchFn = async ({ url, cookies, query, sign }) => {
      calls.push({ url, cookies, offset: query.offset, sign });
      return query.offset === 0 ? pages[0] : pages[1];
    };
    const a = new tdocs.TencentDocsAdapter({ account: { cookies: COOKIES, userId: "u1" }, fetchFn });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("tencent-docs:document:T1");
    expect(calls[0].cookies).toBe(COOKIES);
    expect(calls[0].sign).toBe(null);
    const batch = a.normalize(items[0]);
    expect(batch.items[0].name).toBe("项目计划");
    expect(batch.items[0].extra.platform).toBe("tencent-docs");
  });

  it("invokes signProvider when configured", async () => {
    const signCalls = [];
    const a = new tdocs.TencentDocsAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => (query.offset === 0 ? { files: [{ id: "S1", title: "x" }] } : { files: [] }),
      signProvider: async (ctx) => { signCalls.push(ctx); return "SIG"; },
    });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(signCalls.length).toBeGreaterThan(0);
    expect(signCalls[0].cookies).toBe(COOKIES);
  });

  it("sinceWatermark + limit + empty response", async () => {
    const a1 = new tdocs.TencentDocsAdapter({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => query.offset === 0 ? { files: [
        { id: "NEW", title: "n", lastModifyTime: 2_000_000_000 },
        { id: "OLD", title: "o", lastModifyTime: 1_000_000_000 },
      ] } : { files: [] },
    });
    const got = await collect(a1.sync({ sinceWatermark: 1_500_000_000_000 }));
    expect(got.map((x) => x.originalId)).toEqual(["tencent-docs:document:NEW"]);

    const a2 = new tdocs.TencentDocsAdapter({ account: { cookies: COOKIES }, fetchFn: async () => "<html>login</html>" });
    expect(await collect(a2.sync({}))).toEqual([]);
  });

  it("default fetch throws; no input throws", async () => {
    const a = new tdocs.TencentDocsAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a.sync({}))).rejects.toThrow(/no fetchFn configured/);
    const b = new tdocs.TencentDocsAdapter();
    await expect(collect(b.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
