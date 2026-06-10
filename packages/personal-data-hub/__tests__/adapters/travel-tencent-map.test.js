"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  TencentMapAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/travel-tencent-map");

function writeTmp(content, ext = "json") {
  const p = path.join(
    os.tmpdir(),
    `cc-tencentmap-test-${crypto.randomUUID()}.${ext}`,
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
  vendor: "tencent-map",
  account: { uid: "U1" },
  events: [
    {
      kind: "favourite",
      id: "fav-1",
      capturedAt: 1716383021000,
      name: "公司",
      lat: 31.2,
      lng: 121.44,
      category: "company",
    },
    {
      kind: "route",
      id: "route-2",
      capturedAt: 1716383021000,
      from: { name: "公司" },
      to: { name: "体育馆" },
      mode: "bike",
    },
  ],
};

describe("constants", () => {
  it("exposes name/version/schema", () => {
    expect(NAME).toBe("travel-tencent-map");
    expect(VERSION).toBe("0.2.0");
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
});

describe("authenticate", () => {
  it("mirrors baidu: snapshot / sqlite-needs-deviceId / NO_INPUT", async () => {
    const p = writeTmp("{}");
    try {
      const a = new TencentMapAdapter();
      expect((await a.authenticate({ inputPath: p })).mode).toBe(
        "snapshot-file",
      );
      expect(
        (
          await new TencentMapAdapter({ dbPath: "x.db" }).authenticate({})
        ).reason,
      ).toBe("NO_ACCOUNT_DEVICE_ID");
      expect((await a.authenticate({})).reason).toBe("NO_INPUT");
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("sync — snapshot mode", () => {
  it("yields events with tencent-map: prefixed originalId", async () => {
    const p = writeTmp(JSON.stringify(SNAPSHOT));
    try {
      const a = new TencentMapAdapter();
      const items = await collect(a.sync({ inputPath: p }));
      expect(items.map((i) => i.originalId)).toEqual([
        "tencent-map:favourite:fav-1",
        "tencent-map:route:route-2",
      ]);
      expect(items[0].payload.account).toEqual({ uid: "U1" });
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("throws on schemaVersion mismatch", async () => {
    const p = writeTmp(JSON.stringify({ schemaVersion: 2, events: [] }));
    try {
      await expect(
        collect(new TencentMapAdapter().sync({ inputPath: p })),
      ).rejects.toThrow(/schemaVersion mismatch/);
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("sync — sqlite mode (fake driver)", () => {
  it("yields rows + falls back to tencent_* legacy tables (keyword alias)", async () => {
    const p = writeTmp("fake", "db");
    const log = {};
    try {
      const a = new TencentMapAdapter({
        dbPath: p,
        account: { deviceId: "DEV1" },
        dbDriverFactory: makeFakeDriverFactory(
          {
            tencent_route_history: [
              {
                _id: 5,
                mode: "walk",
                start_name: "家",
                end_name: "菜场",
                time: 1716383021,
              },
            ],
            tencent_search_history: [
              { _id: 6, keyword: "奶茶", city: "深圳", time: 1716383021000 },
            ],
          },
          log,
        ),
      });
      const items = await collect(a.sync({}));
      expect(items).toHaveLength(2);
      expect(items[0].payload.record).toMatchObject({
        vendorId: "tencentmap",
        recordId: "route-5",
        vehicleType: "walk",
        carrier: "腾讯地图",
        departureMs: 1716383021 * 1000,
      });
      // searchRowToRecord accepts the tencent `keyword` alias
      expect(items[1].payload.record.to).toMatchObject({
        name: "奶茶",
        city: "深圳",
      });
      expect(log.closed).toBe(true);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("requires account.deviceId at sync time", async () => {
    const a = new TencentMapAdapter({ dbPath: "x.db" });
    await expect(collect(a.sync({}))).rejects.toThrow(
      /account\.deviceId required/,
    );
  });
});

describe("normalize", () => {
  it("snapshot route → bike trip titled by place names", async () => {
    const p = writeTmp(JSON.stringify(SNAPSHOT));
    try {
      const a = new TencentMapAdapter();
      const [fav, route] = await collect(a.sync({ inputPath: p }));
      expect(a.normalize(fav).events[0].content.title).toBe("visit: → 公司");
      const batch = a.normalize(route);
      expect(batch.events[0].content.title).toBe("bike: 公司 → 体育馆");
      expect(
        batch.persons.find((x) => x.subtype === "merchant").names,
      ).toEqual(["腾讯地图"]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("throws on missing payload", () => {
    expect(() => new TencentMapAdapter().normalize(null)).toThrow(
      /payload missing/,
    );
  });
});
