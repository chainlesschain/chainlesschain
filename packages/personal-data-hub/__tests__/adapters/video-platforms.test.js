"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const iqiyi = require("../../lib/adapters/video-iqiyi");
const tv = require("../../lib/adapters/video-tencent");

function writeTmp(content) {
  const p = path.join(os.tmpdir(), `cc-vid-${crypto.randomUUID()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}
async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

const COOKIES = "P00001=abc; QC005=xyz";
const TENCENT_CUSTOM_ENDPOINTS = Object.freeze({
  watchUrl: "https://video.example.test/GetHistory",
  favouriteUrl: "https://video.example.test/GetFavorite",
});

function createTencentLive(opts = {}) {
  return new tv.TencentVideoAdapter({
    ...TENCENT_CUSTOM_ENDPOINTS,
    ...opts,
  });
}

describe("video-iqiyi mappers", () => {
  it("name/version + mapItem (channel code → category)", () => {
    expect(iqiyi.NAME).toBe("video-iqiyi");
    const rec = iqiyi.mapItem({
      tvId: "100",
      albumName: "庆余年",
      channelId: 2,
      videoName: "庆余年",
      addtime: 1716300000,
      videoDuration: 2700,
    });
    expect(rec).toMatchObject({
      videoId: "100",
      title: "庆余年",
      category: "tv",
      durationSec: 2700,
    });
    expect(rec.occurredAt).toBe(1716300000000);
    expect(rec.url).toContain("iqiyi.com");
    expect(iqiyi.mapItem({ albumName: "noid" })).toBe(null);
  });
  it("extractItems tolerant", () => {
    expect(iqiyi.extractItems({ data: [{ tvId: 1 }] })).toHaveLength(1);
    expect(iqiyi.extractItems({ data: { rc: [{ tvId: 1 }] } })).toHaveLength(1);
    expect(() => iqiyi.extractItems({})).toThrow(/recognized list/u);
  });
});

describe("video-tencent mappers", () => {
  it("name/version + mapItem (typeId → category)", () => {
    expect(tv.NAME).toBe("video-tencent");
    const rec = tv.mapItem({
      cid: "C9",
      cTitle: "三体",
      cTypeId: 4,
      viewTime: 1716310000,
      duration: 3000,
    });
    expect(rec).toMatchObject({
      videoId: "C9",
      title: "三体",
      category: "anime",
      durationSec: 3000,
    });
    expect(rec.url).toContain("v.qq.com");
    expect(tv.mapItem({ cTitle: "noid" })).toBe(null);
  });

  it("ships snapshot-only metadata without placeholder endpoints", async () => {
    let fetchCalls = 0;
    const adapter = new tv.TencentVideoAdapter({
      fetchFn: async () => {
        fetchCalls += 1;
        return { data: { list: [] } };
      },
    });

    expect(adapter.capabilities).toContain("sync:snapshot");
    expect(adapter.capabilities).not.toContain("sync:cookie-api");
    expect(adapter.capabilities).not.toContain("sync:custom-cookie-api");
    expect(adapter.extractMode).toBe("file-import");
    await expect(
      adapter.authenticate({ cookie: COOKIES, accountId: "u1" }),
    ).resolves.toMatchObject({ ok: false, reason: "NO_INPUT" });
    await expect(
      collect(adapter.sync({ cookie: COOKIES, accountId: "u1" })),
    ).rejects.toThrow(/needs opts\.inputPath/u);
    expect(fetchCalls).toBe(0);

    const source = fs.readFileSync(
      require.resolve("../../lib/adapters/video-tencent"),
      "utf8",
    );
    expect(source).not.toMatch(/https?:\/\/[^\s"'`]*\.\.\./u);
  });

  it("keeps snapshot collection available in the default instance", async () => {
    const snapshotPath = writeTmp(
      JSON.stringify({
        schemaVersion: 1,
        events: [
          {
            kind: "watch",
            id: "tw1",
            videoId: "TV1",
            title: "Snapshot video",
          },
        ],
      }),
    );
    try {
      const items = await collect(
        new tv.TencentVideoAdapter().sync({ inputPath: snapshotPath }),
      );
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: "watch",
        originalId: "tencent-video:watch:tw1",
      });
    } finally {
      fs.unlinkSync(snapshotPath);
    }
  });
});

describe("IqiyiVideoAdapter (via _video-base)", () => {
  const SNAP = JSON.stringify({
    schemaVersion: 1,
    snapshottedAt: 1716383000000,
    account: { userId: "u1" },
    events: [
      {
        kind: "watch",
        id: "w1",
        videoId: "V1",
        title: "狂飙",
        category: "tv",
        episode: "第5集",
        durationSec: 2600,
        capturedAt: 1716300000000,
      },
      {
        kind: "favourite",
        id: "fa1",
        videoId: "V2",
        title: "流浪地球2",
        category: "movie",
      },
    ],
  });

  it("snapshot sync 2 kinds + normalize watch→media / favourite→like + media item", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new iqiyi.IqiyiVideoAdapter();
      expect(a.watermarkStrategy).toBe("max-captured-at");
      expect(a.watermarkRequiresCompleteScan).toBe(true);
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((x) => x.kind)).toEqual(["watch", "favourite"]);

      const watch = a.normalize(items[0]);
      expect(watch.events[0].subtype).toBe("media");
      expect(watch.events[0].content.title).toBe("观看: 狂飙 第5集");
      expect(watch.items[0].subtype).toBe("media");
      expect(watch.items[0].extra.platform).toBe("iqiyi");
      expect(watch.events[0].extra.itemRef).toBe(watch.items[0].id);

      const fav = a.normalize(items[1]);
      expect(fav.events[0].subtype).toBe("like");
      expect(fav.events[0].content.title).toBe("收藏: 流浪地球2");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("schema mismatch + unknown kind + include + limit", async () => {
    const p = writeTmp(SNAP);
    try {
      const a = new iqiyi.IqiyiVideoAdapter();
      expect(
        (
          await collect(a.sync({ inputPath: p, include: { watch: false } }))
        ).map((x) => x.kind),
      ).toEqual(["favourite"]);
      expect(await collect(a.sync({ inputPath: p, limit: 1 }))).toHaveLength(1);
      expect(() => a.normalize({ payload: {} })).toThrow(
        /payload.record missing/,
      );
    } finally {
      fs.unlinkSync(p);
    }
    const bad = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    try {
      const a = new iqiyi.IqiyiVideoAdapter();
      await expect(collect(a.sync({ inputPath: bad }))).rejects.toThrow(
        /schemaVersion mismatch/,
      );
    } finally {
      fs.unlinkSync(bad);
    }
  });
  it("rejects a non-object snapshot event during auth and sync", async () => {
    const p = writeTmp(
      JSON.stringify({
        schemaVersion: 1,
        events: [null],
      }),
    );
    try {
      const a = new iqiyi.IqiyiVideoAdapter();
      await expect(a.authenticate({ inputPath: p })).resolves.toMatchObject({
        ok: false,
        reason: "SNAPSHOT_SHAPE_INVALID",
      });
      await expect(collect(a.sync({ inputPath: p }))).rejects.toMatchObject({
        code: "SNAPSHOT_SHAPE_INVALID",
      });
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("TencentVideoAdapter custom cookie-api mode", () => {
  it("authenticate cookie (userId optional)", async () => {
    const a = createTencentLive({
      account: { cookies: COOKIES },
      fetchFn: async () => ({ list: [] }),
    });
    expect(a.capabilities).not.toContain("sync:cookie-api");
    expect(a.capabilities).toContain("sync:custom-cookie-api");
    expect(await a.authenticate()).toEqual({
      ok: true,
      account: null,
      mode: "cookie",
    });
  });

  it("sync fetches watch+favourite, paginates, normalizes", async () => {
    const byUrl = (u) => (u.includes("History") ? "watch" : "favourite");
    const data = {
      watch: [
        { cid: "C1", cTitle: "漫长的季节", cTypeId: 1, viewTime: 1716300000 },
      ],
      favourite: [{ cid: "C2", cTitle: "繁花", cTypeId: 1 }],
    };
    const calls = [];
    let watermarkComplete = false;
    const a = createTencentLive({
      account: { cookies: COOKIES, userId: "u1" },
      fetchFn: async ({ url, cookies, query, sign }) => {
        const k = byUrl(url);
        calls.push({ k, cookies, page: query.page, sign });
        return { data: { list: query.page === 1 ? data[k] : [] } };
      },
    });
    const items = await collect(
      a.sync({
        markWatermarkComplete: () => {
          watermarkComplete = true;
        },
      }),
    );
    expect(items.map((x) => x.kind).sort()).toEqual(["favourite", "watch"]);
    expect(items.find((item) => item.kind === "watch").watermarkAt).toBe(
      1_716_300_000_000,
    );
    expect(
      items.find((item) => item.kind === "favourite").watermarkAt,
    ).toBeNull();
    expect(calls.every((c) => c.cookies === COOKIES && c.sign === null)).toBe(
      true,
    );
    const watch = a.normalize(items.find((x) => x.kind === "watch"));
    expect(watch.events[0].content.title).toBe("观看: 漫长的季节");
    expect(watch.items[0].extra.platform).toBe("tencent-video");
    expect(watermarkComplete).toBe(true);
  });

  it("continues past an old row while excluded/capped scans stay incomplete", async () => {
    let watermarkComplete = false;
    const mixedPages = [];
    const mixed = createTencentLive({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => {
        mixedPages.push(query.page);
        return {
          data: {
            list:
              query.page === 1
                ? [
                    {
                      cid: "OLD",
                      cTitle: "old video",
                      viewTime: 1716382999,
                    },
                    {
                      cid: "NEW",
                      cTitle: "new video",
                      viewTime: 1716383001,
                    },
                  ]
                : [],
          },
        };
      },
    });
    expect(
      await collect(
        mixed.sync({
          sinceWatermark: 1716383000000,
          include: { favourite: false },
          markWatermarkComplete: () => {
            watermarkComplete = true;
          },
        }),
      ),
    ).toMatchObject([{ originalId: "tencent-video:watch:NEW" }]);
    expect(mixedPages).toEqual([1, 2]);
    expect(watermarkComplete).toBe(false);

    watermarkComplete = false;
    const fullPage = createTencentLive({
      account: { cookies: COOKIES },
      fetchFn: async () => ({
        data: {
          list: Array.from({ length: 30 }, (_, index) => ({
            cid: `NEW-${index}`,
            cTitle: `video ${index}`,
            viewTime: 1716400000 + index,
          })),
        },
      }),
    });
    expect(
      await collect(
        fullPage.sync({
          maxPages: 1,
          include: { favourite: false },
          markWatermarkComplete: () => {
            watermarkComplete = true;
          },
        }),
      ),
    ).toHaveLength(30);
    expect(watermarkComplete).toBe(false);
  });

  it.each([
    ["HTML login page", "<html>login</html>", "SOURCE_PAGE_UNRECOGNIZED"],
    ["business error", { code: 401, list: [] }, "SOURCE_PAGE_ERROR"],
  ])(
    "rejects a %s without completing the watermark",
    async (_label, response, expectedCode) => {
      let watermarkCompletions = 0;
      const a = createTencentLive({
        account: { cookies: COOKIES },
        fetchFn: async () => response,
      });

      await expect(
        collect(
          a.sync({
            include: { favourite: false },
            markWatermarkComplete: () => {
              watermarkCompletions += 1;
            },
          }),
        ),
      ).rejects.toMatchObject({ code: expectedCode });
      expect(watermarkCompletions).toBe(0);
    },
  );

  it("invokes signProvider + limit and requires the complete custom seam", async () => {
    const signCalls = [];
    const a = createTencentLive({
      account: { cookies: COOKIES },
      fetchFn: async ({ query }) => ({
        list:
          query.page === 1
            ? [
                { cid: "C1", cTitle: "x" },
                { cid: "C2", cTitle: "y" },
              ]
            : [],
      }),
      signProvider: async (ctx) => {
        signCalls.push(ctx);
        return "sig";
      },
    });
    expect(
      await collect(a.sync({ limit: 1, include: { favourite: false } })),
    ).toHaveLength(1);
    expect(signCalls.length).toBeGreaterThan(0);

    const endpointsWithoutTransport = new tv.TencentVideoAdapter({
      ...TENCENT_CUSTOM_ENDPOINTS,
      account: { cookies: COOKIES },
    });
    expect(endpointsWithoutTransport.capabilities).not.toContain(
      "sync:custom-cookie-api",
    );
    await expect(collect(endpointsWithoutTransport.sync({}))).rejects.toThrow(
      /needs opts\.inputPath/u,
    );

    expect(
      () =>
        new tv.TencentVideoAdapter({
          watchUrl: "https://video.example.test/.../history",
          favouriteUrl: TENCENT_CUSTOM_ENDPOINTS.favouriteUrl,
          fetchFn: async () => ({ list: [] }),
        }),
    ).toThrow(/complete HTTPS URL/u);
  });
});
