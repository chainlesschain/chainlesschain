"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  BaiduMapAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/travel-baidu-map");

function writeTmp(content, ext = "json") {
  const p = path.join(
    os.tmpdir(),
    `cc-baidumap-test-${crypto.randomUUID()}.${ext}`,
  );
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

function makeFakeDriverFactory(tables, log = {}) {
  return () =>
    class FakeDb {
      constructor(dbPath, opts) {
        log.opened = { dbPath, opts };
      }
      prepare(sql) {
        for (const [needle, rows] of Object.entries(tables)) {
          if (sql.includes(needle)) return { all: () => rows };
        }
        throw new Error(`no such table in: ${sql}`);
      }
      close() {
        log.closed = true;
      }
    };
}

const SNAPSHOT = {
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  snapshottedAt: 1716383021000,
  vendor: "baidu-map",
  account: { uid: "U1", displayName: "Alice" },
  events: [
    {
      kind: "favourite",
      id: "fav-1",
      capturedAt: 1716383021000,
      name: "家",
      address: "幸福路1号",
      lat: 31.23,
      lng: 121.47,
      category: "home",
    },
    {
      kind: "search",
      id: "search-2",
      time: 1716383021, // seconds — parseTime must upgrade to ms
      query: "咖啡店",
      city: "上海",
    },
    {
      kind: "route",
      id: "route-3",
      capturedAt: 1716383021000,
      from: { name: "家", lat: 31.23, lng: 121.47 },
      to: { name: "公司", lat: 31.2, lng: 121.44 },
      mode: "drive",
    },
    { kind: "alien", id: "x" },
  ],
};

describe("constants", () => {
  it("exposes name/version/schema", () => {
    expect(NAME).toBe("travel-baidu-map");
    expect(VERSION).toBe("0.6.0");
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
});

describe("authenticate", () => {
  it("snapshot mode ok / unreadable", async () => {
    const p = writeTmp("{}");
    try {
      const a = new BaiduMapAdapter();
      expect(await a.authenticate({ inputPath: p })).toEqual({
        ok: true,
        mode: "snapshot-file",
      });
      const bad = await a.authenticate({
        inputPath: path.join(os.tmpdir(), "nonexistent-baidu.json"),
      });
      expect(bad.reason).toBe("INPUT_PATH_UNREADABLE");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sqlite mode requires account.deviceId; NO_INPUT otherwise", async () => {
    const noAcc = new BaiduMapAdapter({ dbPath: "x.db" });
    expect((await noAcc.authenticate({})).reason).toBe("NO_ACCOUNT_DEVICE_ID");
    const withAcc = new BaiduMapAdapter({
      dbPath: "x.db",
      account: { deviceId: "DEV1" },
    });
    expect(await withAcc.authenticate({})).toEqual({
      ok: true,
      account: "DEV1",
      mode: "sqlite",
    });
    expect((await new BaiduMapAdapter().authenticate({})).reason).toBe(
      "NO_INPUT",
    );
  });
});

describe("sync — snapshot mode", () => {
  it("yields 3 kinds with prefixed originalId + account attached, skips unknown kind", async () => {
    const p = writeTmp(JSON.stringify(SNAPSHOT));
    try {
      const a = new BaiduMapAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items).toHaveLength(3);
      expect(items.map((i) => i.originalId)).toEqual([
        "baidu-map:favourite:fav-1",
        "baidu-map:search:search-2",
        "baidu-map:route:route-3",
      ]);
      // every payload carries the snapshot account for bookkeeping
      for (const i of items) {
        expect(i.payload.account).toEqual({ uid: "U1", displayName: "Alice" });
      }
      // ev.time in seconds upgraded to ms
      expect(items[1].capturedAt).toBe(1716383021 * 1000);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("throws on schemaVersion mismatch; honors include gate + limit", async () => {
    const bad = writeTmp(JSON.stringify({ schemaVersion: 9, events: [] }));
    const good = writeTmp(JSON.stringify(SNAPSHOT));
    try {
      const a = new BaiduMapAdapter();
      await expect(collect(a.sync({ inputPath: bad }))).rejects.toThrow(
        /schemaVersion mismatch/,
      );
      expect(
        await collect(a.sync({ inputPath: good, include: { search: false } })),
      ).toHaveLength(2);
      expect(
        await collect(a.sync({ inputPath: good, limit: 1 })),
      ).toHaveLength(1);
    } finally {
      fs.unlinkSync(bad);
      fs.unlinkSync(good);
    }
  });
});

describe("sync — sqlite mode (fake driver)", () => {
  const ROUTE_ROW = {
    _id: 5,
    type: "transit",
    start_name: "人民广场",
    end_name: "虹桥火车站",
    start_lat: 31.23,
    start_lng: 121.47,
    time: 1716383021, // seconds
  };
  const SEARCH_ROW = { _id: 6, key: "火锅", city: "成都", time: "1716383021" };

  it("requires account.deviceId", async () => {
    const a = new BaiduMapAdapter({ dbPath: "x.db" });
    await expect(collect(a.sync({}))).rejects.toThrow(
      /account\.deviceId required/,
    );
  });

  it("yields route (transit→bus) + search records, closes db", async () => {
    const p = writeTmp("fake", "db");
    const log = {};
    try {
      const a = new BaiduMapAdapter({
        dbPath: p,
        account: { deviceId: "DEV1" },
        dbDriverFactory: makeFakeDriverFactory(
          { route_history: [ROUTE_ROW], search_history: [SEARCH_ROW] },
          log,
        ),
      });
      const items = await collect(a.sync({}));
      expect(items).toHaveLength(2);
      expect(items[0].payload.record).toMatchObject({
        vendorId: "baidumap",
        recordId: "route-5",
        vehicleType: "bus",
        carrier: "百度地图",
        departureMs: 1716383021 * 1000,
      });
      expect(items[1].payload.record).toMatchObject({
        recordId: "search-6",
        vehicleType: "visit",
        departureMs: 1716383021 * 1000, // string seconds upgraded
      });
      expect(items[1].payload.record.to).toMatchObject({
        name: "火锅",
        city: "成都",
      });
      expect(log.opened.opts).toEqual({ readonly: true });
      expect(log.closed).toBe(true);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("falls back to bd_route_history legacy table; missing db file silent", async () => {
    const p = writeTmp("fake", "db");
    try {
      const a = new BaiduMapAdapter({
        dbPath: p,
        account: { deviceId: "DEV1" },
        dbDriverFactory: makeFakeDriverFactory({
          bd_route_history: [ROUTE_ROW],
          search_history: [],
        }),
      });
      expect(await collect(a.sync({}))).toHaveLength(1);

      const gone = new BaiduMapAdapter({
        dbPath: path.join(os.tmpdir(), "nonexistent-baidu.db"),
        account: { deviceId: "DEV1" },
        dbDriverFactory: makeFakeDriverFactory({}),
      });
      expect(await collect(gone.sync({}))).toEqual([]);
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("normalize", () => {
  it("snapshot favourite → visit trip titled by place name", async () => {
    const p = writeTmp(JSON.stringify(SNAPSHOT));
    try {
      const a = new BaiduMapAdapter();
      const [fav, search, route] = await collect(a.sync({ inputPath: p }));

      const favBatch = a.normalize(fav);
      expect(favBatch.events[0].subtype).toBe("trip");
      expect(favBatch.events[0].content.title).toBe("visit: → 家");
      expect(favBatch.events[0].extra.vendorExtras.category).toBe("home");
      expect(favBatch.places[0].coordinates).toEqual({
        lat: 31.23,
        lng: 121.47,
      });

      // search has city → city wins over name in the title
      expect(a.normalize(search).events[0].content.title).toBe("visit: → 上海");

      const routeBatch = a.normalize(route);
      expect(routeBatch.events[0].content.title).toBe("car: 家 → 公司");
      expect(routeBatch.places).toHaveLength(2);
      const merchant = routeBatch.persons.find((x) => x.subtype === "merchant");
      expect(merchant.names).toEqual(["百度地图"]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("sqlite-mode record payload passes through travel-base", () => {
    const a = new BaiduMapAdapter();
    const batch = a.normalize({
      payload: {
        record: {
          vendorId: "baidumap",
          recordId: "route-9",
          vehicleType: "car",
          from: { name: "A" },
          to: { name: "B" },
          carrier: "百度地图",
        },
        kind: "route",
      },
    });
    expect(batch.events[0].content.title).toBe("car: A → B");
  });

  it("throws on missing payload", () => {
    expect(() => new BaiduMapAdapter().normalize(null)).toThrow(
      /payload missing/,
    );
  });
});
