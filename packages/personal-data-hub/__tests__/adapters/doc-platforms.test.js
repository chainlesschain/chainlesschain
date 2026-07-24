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

describe("doc-wps constants + mappers", () => {
  it("exposes name/version", () => {
    expect(wps.NAME).toBe("doc-wps");
    expect(wps.VERSION).toBe("0.2.0");
  });
  it("mapDoc maps WPS fields + infers docType from extension", () => {
    const rec = wps.mapDoc({
      id: "F1",
      fname: "预算.xlsx",
      ctime: 1716300000,
      mtime: 1716383000,
    });
    expect(rec).toMatchObject({
      docId: "F1",
      title: "预算.xlsx",
      docType: "sheet",
    });
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
    expect(wps.extractDocs({ data: { items: [{ id: 1 }] } })).toHaveLength(1);
    expect(() => wps.extractDocs({})).toThrow(/recognized list/u);
  });
});

describe("doc-tencent-docs constants + mappers", () => {
  it("exposes name/version", () => {
    expect(tdocs.NAME).toBe("doc-tencent-docs");
    expect(tdocs.VERSION).toBe("0.2.0");
  });
  it("mapDoc maps Tencent fields + type codes", () => {
    const rec = tdocs.mapDoc({
      id: "T1",
      title: "周报",
      type: "sheet",
      createTime: 1716300000,
      lastModifyTime: 1716383000,
    });
    expect(rec).toMatchObject({ docId: "T1", title: "周报", docType: "sheet" });
    expect(rec.url).toContain("docs.qq.com");
    expect(tdocs.mapDoc({ id: "T2", type: 2 }).docType).toBe("sheet");
    expect(tdocs.mapDoc({ id: "T3", type: "presentation" }).docType).toBe(
      "slide",
    );
    expect(tdocs.mapDoc({ title: "noid" })).toBe(null);
  });
});

describe("WpsDocAdapter snapshot mode", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      {
        kind: "document",
        id: "doc-D1",
        docId: "D1",
        title: "我的文档",
        docType: "doc",
        createdTime: 1716300000,
        updatedTime: 1716383000,
        url: "https://kdocs.cn/p/D1",
      },
    ],
  });

  it("authenticate validates inputPath", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new wps.WpsDocAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe(
        "snapshot-file",
      );
      expect(
        (
          await a.authenticate({
            inputPath: path.join(os.tmpdir(), "nope.json"),
          })
        ).reason,
      ).toBe("INPUT_PATH_UNREADABLE");
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
      await expect(collect(a.sync({ inputPath: p }))).rejects.toThrow(
        /schemaVersion mismatch/,
      );
      expect(() => a.normalize({ payload: {} })).toThrow(
        /payload.record missing/,
      );
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("TencentDocsAdapter input contract", () => {
  it("does not treat website cookies as a supported personal API", async () => {
    const adapter = new tdocs.TencentDocsAdapter({
      account: { cookies: "uid=1; secret=private" },
    });

    expect(await adapter.authenticate()).toMatchObject({
      ok: false,
      reason: "NO_EXPORT_DIR",
    });
    expect(adapter.capabilities).toEqual([
      "sync:snapshot",
      "sync:export-directory",
      "parse:tencent-documents",
    ]);
    expect(adapter.extractMode).toBe("file-import");
    expect(adapter.account).toBe(null);
    expect(JSON.stringify(adapter)).not.toContain("secret=private");
  });

  it("requires both a readable export directory and a local account id", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tencent-docs-"));
    try {
      const adapter = new tdocs.TencentDocsAdapter();
      expect(await adapter.authenticate({ exportDir: root })).toMatchObject({
        ok: false,
        reason: "NO_ACCOUNT_ID",
      });
      expect(
        await adapter.authenticate({
          exportDir: root,
          accountId: "local-account",
        }),
      ).toMatchObject({ ok: true, mode: "export-directory" });
      await expect(collect(adapter.sync({}))).rejects.toThrow(/exportDir/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
