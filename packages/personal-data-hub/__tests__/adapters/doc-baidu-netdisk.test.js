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

describe("doc-baidu-netdisk mappers", () => {
  it("name/version", () => {
    expect(nd.NAME).toBe("doc-baidu-netdisk");
    expect(nd.VERSION).toBe("0.3.0");
    expect(nd.NETDISK_LIST_URL).toBe(
      "https://pan.baidu.com/rest/2.0/xpan/file",
    );
    expect(nd.NETDISK_LIST_ALL_URL).toBe(
      "https://pan.baidu.com/rest/2.0/xpan/multimedia",
    );
  });
  it("mapDoc maps netdisk fields; category + isdir → docType", () => {
    const rec = nd.mapDoc({
      fs_id: 123,
      server_filename: "电影.mp4",
      category: 1,
      size: 999,
      server_mtime: 1716383000,
      path: "/影视/电影.mp4",
    });
    expect(rec).toMatchObject({
      docId: "123",
      title: "电影.mp4",
      docType: "video",
    });
    expect(rec.updatedMs).toBe(1716383000000);
    expect(rec.extra.path).toBe("/影视/电影.mp4");
    expect(
      nd.mapDoc({ fs_id: 1, isdir: 1, server_filename: "我的资料" }).docType,
    ).toBe("folder");
    expect(nd.mapDoc({ fs_id: 2, server_filename: "报告.pdf" }).docType).toBe(
      "doc",
    ); // extension fallback
    expect(nd.mapDoc({ server_filename: "noid" })).toBe(null);
  });
  it("extractDocs tolerant", () => {
    expect(nd.extractDocs({ list: [{ fs_id: 1 }] })).toHaveLength(1);
    expect(nd.extractDocs({ data: { list: [{ fs_id: 1 }] } })).toHaveLength(1);
    expect(() => nd.extractDocs({})).toThrow(/recognized list/u);
  });
  it("validates official list envelopes without exposing credentials", () => {
    expect(nd.parseOfficialListResponse({ errno: 0, list: [] })).toEqual([]);
    expect(
      nd.parseOfficialListAllResponse({
        errno: 0,
        has_more: 1,
        cursor: 42,
        list: [{ fs_id: 1 }],
      }),
    ).toEqual({
      docs: [{ fs_id: 1 }],
      hasMore: true,
      cursor: 42,
    });
    expect(
      nd.parseOfficialListAllResponse({
        errno: 0,
        has_more: 0,
        list: [],
      }),
    ).toEqual({ docs: [], hasMore: false, cursor: null });
    expect(() => nd.parseOfficialListResponse({ errno: -7 })).toThrow(
      /errno -7/u,
    );
    expect(() => nd.parseOfficialListResponse({ list: [] })).toThrow(
      /missing errno/u,
    );
    expect(() => nd.parseOfficialListResponse({ errno: 0 })).toThrow(
      /missing list/u,
    );
    expect(() =>
      nd.parseOfficialListAllResponse({ errno: 0, list: [] }),
    ).toThrow(/missing has_more/u);
    expect(() =>
      nd.parseOfficialListAllResponse({
        errno: 0,
        has_more: 1,
        cursor: "invalid",
        list: [],
      }),
    ).toThrow(/invalid cursor/u);
  });
});

describe("BaiduNetdiskAdapter (via _document-base)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      {
        kind: "document",
        id: "doc-F1",
        docId: "F1",
        title: "合同.pdf",
        docType: "doc",
        updatedTime: 1716383000,
        url: "/工作/合同.pdf",
      },
    ],
  });

  it("snapshot sync + normalize → event(post)+item(document)", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new nd.BaiduNetdiskAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe(
        "snapshot-file",
      );
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

  it("official OAuth API: recursively paginates an application directory", async () => {
    const pages = [
      {
        errno: 0,
        has_more: 1,
        cursor: 77,
        list: [
          {
            fs_id: 7,
            server_filename: "照片.jpg",
            category: 3,
            server_mtime: 1716383000,
          },
        ],
      },
      {
        errno: 0,
        has_more: 0,
        list: [
          {
            fs_id: 8,
            server_filename: "report.pdf",
            category: 4,
            server_mtime: 1716382000,
          },
        ],
      },
    ];
    const calls = [];
    const permits = [];
    let watermarkComplete = false;
    const a = new nd.BaiduNetdiskAdapter({
      listUrl: "https://untrusted.example.test/collect",
      fetchFn: async (request) => {
        calls.push(request);
        return request.query.start === 0 ? pages[0] : pages[1];
      },
    });
    expect(
      await a.authenticate({
        accessToken: "oauth-secret",
        accountId: "u1",
        dir: "/apps/chainlesschain/work",
      }),
    ).toEqual({
      ok: true,
      mode: "oauth-access-token",
    });
    const items = await collect(
      a.sync({
        accessToken: "oauth-secret",
        accountId: "u1",
        dir: "/apps/chainlesschain/work",
        pageSize: 1,
        beforeSourceRequest: async (detail) => permits.push(detail),
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );
    expect(items).toHaveLength(2);
    expect(items[0].originalId).toBe("baidu-netdisk:document:7");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: nd.NETDISK_LIST_ALL_URL,
      query: {
        method: "listall",
        path: "/apps/chainlesschain/work",
        recursion: 1,
        order: "time",
        desc: 1,
        start: 0,
        limit: 1,
        web: 0,
      },
      credentialQuery: { access_token: "oauth-secret" },
    });
    expect(calls[1].query.start).toBe(77);
    expect(permits).toEqual([
      {
        operation: "document",
        page: 0,
        dir: "/apps/chainlesschain/work",
        start: 0,
        recursive: true,
      },
      {
        operation: "document",
        page: 1,
        dir: "/apps/chainlesschain/work",
        start: 77,
        recursive: true,
      },
    ]);
    expect(watermarkComplete).toBe(true);
    expect(a).not.toHaveProperty("accessToken");
    const batch = a.normalize(items[0]);
    expect(batch.items[0].name).toBe("照片.jpg");
    expect(batch.items[0].extra.docType).toBe("image");
  });

  it("supports explicit shallow directory pagination", async () => {
    const calls = [];
    const adapter = new nd.BaiduNetdiskAdapter({
      fetchFn: async (request) => {
        calls.push(request);
        return request.query.start === 0
          ? {
              errno: 0,
              list: [
                {
                  fs_id: 9,
                  server_filename: "direct.txt",
                  server_mtime: 1716383000,
                },
              ],
            }
          : { errno: 0, list: [] };
      },
    });
    const items = await collect(
      adapter.sync({
        accessToken: "oauth-secret",
        accountId: "u1",
        dir: "/apps/chainlesschain",
        recursive: false,
        pageSize: 1,
      }),
    );
    expect(items).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: nd.NETDISK_LIST_URL,
      query: {
        method: "list",
        dir: "/apps/chainlesschain",
        start: 0,
        limit: 1,
      },
    });
    expect(calls[1].query.start).toBe(1);
  });

  it("does not complete a capped shallow scan on a non-empty short page", async () => {
    let watermarkComplete = false;
    const adapter = new nd.BaiduNetdiskAdapter({
      fetchFn: async () => ({
        errno: 0,
        list: [
          {
            fs_id: 10,
            server_filename: "short.txt",
            server_mtime: 1716383000,
          },
        ],
      }),
    });

    expect(
      await collect(
        adapter.sync({
          accessToken: "oauth-secret",
          accountId: "u1",
          dir: "/apps/chainlesschain",
          recursive: false,
          pageSize: 1000,
          maxPages: 1,
          markWatermarkComplete: () => {
            watermarkComplete = true;
          },
        }),
      ),
    ).toHaveLength(1);
    expect(watermarkComplete).toBe(false);
  });

  it("uses an overlapped mtime filter without dropping later recursive pages", async () => {
    const calls = [];
    const adapter = new nd.BaiduNetdiskAdapter({
      fetchFn: async (request) => {
        calls.push(request);
        return request.query.start === 0
          ? {
              errno: 0,
              has_more: 1,
              cursor: 5,
              list: [
                {
                  fs_id: 10,
                  server_filename: "old.txt",
                  server_mtime: 1716382998,
                },
              ],
            }
          : {
              errno: 0,
              has_more: 0,
              list: [
                {
                  fs_id: 11,
                  server_filename: "new.txt",
                  server_mtime: 1716383001,
                },
              ],
            };
      },
    });
    const items = await collect(
      adapter.sync({
        accessToken: "oauth-secret",
        accountId: "u1",
        dir: "/apps/chainlesschain",
        sinceWatermark: 1716383000000,
      }),
    );
    expect(items.map((item) => item.originalId)).toEqual([
      "baidu-netdisk:document:11",
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].query.mtime).toBe(1716382999);
    expect(calls[1].query.start).toBe(5);
  });

  it("does not advance a complete-scan watermark on page-budget, API failure, or cursor loop", async () => {
    let completed = 0;
    const fullPage = new nd.BaiduNetdiskAdapter({
      fetchFn: async () => ({
        errno: 0,
        has_more: 1,
        cursor: 1,
        list: [
          {
            fs_id: 1,
            server_filename: "one.txt",
            server_mtime: 1716383000,
          },
        ],
      }),
    });
    await collect(
      fullPage.sync({
        accessToken: "oauth-secret",
        accountId: "u1",
        dir: "/apps/chainlesschain",
        pageSize: 1,
        maxPages: 1,
        markWatermarkComplete: () => {
          completed += 1;
        },
      }),
    );
    expect(completed).toBe(0);

    const failed = new nd.BaiduNetdiskAdapter({
      fetchFn: async () => ({ errno: -7 }),
    });
    await expect(
      collect(
        failed.sync({
          accessToken: "oauth-secret",
          accountId: "u1",
          dir: "/apps/chainlesschain",
          markWatermarkComplete: () => {
            completed += 1;
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAIDU_NETDISK_API_ERROR",
      errno: -7,
    });
    expect(completed).toBe(0);

    const looping = new nd.BaiduNetdiskAdapter({
      fetchFn: async () => ({
        errno: 0,
        has_more: 1,
        cursor: 0,
        list: [],
      }),
    });
    await expect(
      collect(
        looping.sync({
          accessToken: "oauth-secret",
          accountId: "u1",
          dir: "/apps/chainlesschain",
          markWatermarkComplete: () => {
            completed += 1;
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAIDU_NETDISK_PAGINATION_LOOP",
    });
    expect(completed).toBe(0);
  });

  it("rejects missing runtime inputs and invalid directory pagination", async () => {
    const b = new nd.BaiduNetdiskAdapter();
    await expect(
      collect(
        b.sync({
          accessToken: "oauth-secret",
          accountId: "u1",
          dir: "/apps/chainlesschain",
        }),
      ),
    ).rejects.toThrow(/no fetchFn configured/u);
    await expect(collect(b.sync({}))).rejects.toThrow(
      /needs opts.accessToken/u,
    );
    await expect(
      collect(
        b.sync({
          accessToken: "oauth-secret",
          accountId: "u1",
          dir: "relative",
        }),
      ),
    ).rejects.toThrow(/inside \/apps\/\{appname\}/u);
    await expect(
      collect(
        b.sync({
          accessToken: "oauth-secret\ninjected",
          accountId: "u1",
          dir: "/apps/chainlesschain",
        }),
      ),
    ).rejects.toThrow(/accessToken is invalid/u);
    await expect(
      collect(
        b.sync({
          accessToken: "oauth-secret",
          accountId: "u1",
          dir: "/apps/chainlesschain",
          pageSize: 1001,
        }),
      ),
    ).rejects.toThrow(/between 1 and 1000/u);
    await expect(
      collect(
        b.sync({
          accessToken: "oauth-secret",
          accountId: "u1",
          dir: "/apps/chainlesschain",
          maxPages: "invalid",
        }),
      ),
    ).rejects.toThrow(/positive integer/u);
    expect(
      await b.healthCheck({
        accessToken: "oauth-secret",
      }),
    ).toMatchObject({ ok: false, reason: "NO_ACCOUNT_ID" });
  });
});
