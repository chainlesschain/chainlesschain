"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const cs = require("../../lib/adapters/doc-camscanner");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-cs-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "INTSIG_TOKEN=abc; PHPSESSID=xyz";

describe("doc-camscanner mappers", () => {
  it("name/version", () => {
    expect(cs.NAME).toBe("doc-camscanner");
    expect(cs.VERSION).toBe("0.1.0");
  });
  it("mapDoc maps CamScanner fields; doc_type + extension → docType", () => {
    const rec = cs.mapDoc({
      sync_doc_id: "DOC123",
      title: "营业执照",
      doc_type: 2,
      page_num: 3,
      create_time: 1716383000,
      modify_time: 1716390000,
      pdf_url: "https://cs/DOC123.pdf",
      tags: ["证件"],
    });
    expect(rec).toMatchObject({ docId: "DOC123", title: "营业执照", docType: "certificate" });
    expect(rec.createdMs).toBe(1716383000000);
    expect(rec.updatedMs).toBe(1716390000000);
    expect(rec.url).toBe("https://cs/DOC123.pdf");
    expect(rec.extra.pageNum).toBe(3);
    expect(rec.extra.tags).toEqual(["证件"]);
    // extension fallback when no doc_type
    expect(cs.mapDoc({ doc_id: 1, title: "报表.xlsx" }).docType).toBe("excel");
    expect(cs.mapDoc({ doc_id: 2, title: "合同.pdf" }).docType).toBe("pdf");
    // default → scan
    expect(cs.mapDoc({ doc_id: 3, title: "随手拍" }).docType).toBe("scan");
    // no id → null
    expect(cs.mapDoc({ title: "noid" })).toBe(null);
  });
  it("extractDocs tolerant across shapes", () => {
    expect(cs.extractDocs({ docs: [{ doc_id: 1 }] })).toHaveLength(1);
    expect(cs.extractDocs({ list: [{ doc_id: 1 }] })).toHaveLength(1);
    expect(cs.extractDocs({ data: { docs: [{ doc_id: 1 }] } })).toHaveLength(1);
    expect(cs.extractDocs({})).toEqual([]);
  });
});

describe("CamScannerDocAdapter (via _document-base)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      {
        kind: "document",
        id: "doc-S1",
        docId: "S1",
        title: "身份证扫描",
        docType: "certificate",
        updatedTime: 1716383000,
        url: "https://cs/S1.pdf",
      },
    ],
  });

  it("snapshot sync + normalize → event(post)+item(document)", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new cs.CamScannerDocAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      const batch = a.normalize(items[0]);
      expect(batch.events[0].subtype).toBe("post");
      expect(batch.items[0].subtype).toBe("document");
      expect(batch.items[0].name).toBe("身份证扫描");
      expect(batch.items[0].extra.platform).toBe("camscanner");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: fetch + paginate + normalize", async () => {
    const pages = [
      { docs: [{ sync_doc_id: 7, title: "发票.pdf", doc_type: "pdf", modify_time: 1716383000 }] },
      { docs: [] },
    ];
    const calls = [];
    const a = new cs.CamScannerDocAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async ({ url, cookies, query, sign }) => {
        calls.push({ url, cookies, offset: query.offset, sign });
        return query.offset === 0 ? pages[0] : pages[1];
      },
    });
    expect(await a.authenticate()).toEqual({ ok: true, account: "u1", mode: "cookie" });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("camscanner:document:7");
    expect(calls[0].cookies).toBe(COOKIES);
    expect(calls[0].sign).toBe(null);
    const batch = a.normalize(items[0]);
    expect(batch.items[0].name).toBe("发票.pdf");
    expect(batch.items[0].extra.docType).toBe("pdf");
  });

  it("cookie-api: signProvider seam invoked when present", async () => {
    let seen = null;
    const a = new cs.CamScannerDocAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      signProvider: async ({ url, query }) => {
        seen = { url, offset: query.offset };
        return "sig-abc";
      },
      fetchFn: async ({ sign, query }) => {
        return query.offset === 0
          ? { docs: [{ sync_doc_id: "X", title: "t", _sign: sign }] }
          : { docs: [] };
      },
    });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(seen.offset).toBe(0);
    expect(seen.url).toContain("intsig");
  });

  it("default fetch throws; no input throws", async () => {
    const a = new cs.CamScannerDocAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a.sync({}))).rejects.toThrow(/no fetchFn configured/);
    const b = new cs.CamScannerDocAdapter();
    await expect(collect(b.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
