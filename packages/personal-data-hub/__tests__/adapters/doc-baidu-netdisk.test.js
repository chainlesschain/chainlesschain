"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const nd = require("../../lib/adapters/doc-baidu-netdisk");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-nd-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "BDUSS=abc; STOKEN=xyz";

describe("doc-baidu-netdisk mappers", () => {
  it("name/version", () => {
    expect(nd.NAME).toBe("doc-baidu-netdisk");
    expect(nd.VERSION).toBe("0.1.0");
  });
  it("mapDoc maps netdisk fields; category + isdir → docType", () => {
    const rec = nd.mapDoc({ fs_id: 123, server_filename: "电影.mp4", category: 1, size: 999, server_mtime: 1716383000, path: "/影视/电影.mp4" });
    expect(rec).toMatchObject({ docId: "123", title: "电影.mp4", docType: "video" });
    expect(rec.updatedMs).toBe(1716383000000);
    expect(rec.extra.path).toBe("/影视/电影.mp4");
    expect(nd.mapDoc({ fs_id: 1, isdir: 1, server_filename: "我的资料" }).docType).toBe("folder");
    expect(nd.mapDoc({ fs_id: 2, server_filename: "报告.pdf" }).docType).toBe("doc"); // extension fallback
    expect(nd.mapDoc({ server_filename: "noid" })).toBe(null);
  });
  it("extractDocs tolerant", () => {
    expect(nd.extractDocs({ list: [{ fs_id: 1 }] })).toHaveLength(1);
    expect(nd.extractDocs({ data: { list: [{ fs_id: 1 }] } })).toHaveLength(1);
    expect(nd.extractDocs({})).toEqual([]);
  });
});

describe("BaiduNetdiskAdapter (via _document-base)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      { kind: "document", id: "doc-F1", docId: "F1", title: "合同.pdf", docType: "doc", updatedTime: 1716383000, url: "/工作/合同.pdf" },
    ],
  });

  it("snapshot sync + normalize → event(post)+item(document)", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new nd.BaiduNetdiskAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe("snapshot-file");
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(1);
      const batch = a.normalize(items[0]);
      expect(batch.events[0].subtype).toBe("post");
      expect(batch.items[0].subtype).toBe("document");
      expect(batch.items[0].name).toBe("合同.pdf");
      expect(batch.items[0].extra.platform).toBe("baidu-netdisk");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("cookie-api: fetch + paginate + normalize", async () => {
    const pages = [
      { list: [{ fs_id: 7, server_filename: "照片.jpg", category: 3, server_mtime: 1716383000 }] },
      { list: [] },
    ];
    const calls = [];
    const a = new nd.BaiduNetdiskAdapter({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async ({ url, cookies, query, sign }) => {
        calls.push({ url, cookies, offset: query.offset, sign });
        return query.offset === 0 ? pages[0] : pages[1];
      },
    });
    expect(await a.authenticate()).toEqual({ ok: true, account: "u1", mode: "cookie" });
    const items = await collect(a.sync({}));
    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("baidu-netdisk:document:7");
    expect(calls[0].cookies).toBe(COOKIES);
    expect(calls[0].sign).toBe(null);
    const batch = a.normalize(items[0]);
    expect(batch.items[0].name).toBe("照片.jpg");
    expect(batch.items[0].extra.docType).toBe("image");
  });

  it("default fetch throws; no input throws", async () => {
    const a = new nd.BaiduNetdiskAdapter({ account: { cookies: COOKIES } });
    await expect(collect(a.sync({}))).rejects.toThrow(/no fetchFn configured/);
    const b = new nd.BaiduNetdiskAdapter();
    await expect(collect(b.sync({}))).rejects.toThrow(/needs opts.inputPath/);
  });
});
