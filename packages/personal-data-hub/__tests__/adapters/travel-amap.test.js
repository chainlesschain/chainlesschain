"use strict";

import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  AmapAdapter,
  NAME,
  VERSION,
} = require("../../lib/adapters/travel-amap");

function writeTmpDb() {
  // sync() only checks fs.existsSync before handing the path to the
  // injected driver — content is irrelevant for the fake.
  const p = path.join(os.tmpdir(), `cc-amap-test-${crypto.randomUUID()}.db`);
  fs.writeFileSync(p, Buffer.from("SQLite format 3\0fixture"));
  return p;
}

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

/**
 * Fake better-sqlite3 driver. `tables` maps a SQL substring (table name)
 * to rows; unmatched prepare() throws like sqlite does on missing tables
 * so the compatibility fallback chain is exercised.
 */
function makeFakeDriverFactory(tables, log = {}) {
  return () =>
    class FakeDb {
      constructor(dbPath, opts) {
        log.opened = { dbPath, opts };
      }
      prepare(sql) {
        if (sql.includes("FROM sqlite_master")) {
          return {
            all: () => Object.keys(tables).map((name) => ({ name })),
          };
        }
        for (const [needle, rows] of Object.entries(tables)) {
          if (sql.includes(needle)) {
            return {
              all: () => {
                if (rows instanceof Error) throw rows;
                return rows;
              },
            };
          }
        }
        throw new Error(`no such table in: ${sql}`);
      }
      close() {
        log.closed = true;
      }
    };
}

const ROUTE_ROW = {
  id: 7,
  mode: "drive",
  from_name: "家",
  to_name: "公司",
  from_lat: 31.23,
  from_lng: 121.47,
  to_lat: 31.2,
  to_lng: 121.44,
  time: 1716383021, // seconds — must be upgraded to ms
};

const SEARCH_ROW = {
  id: 9,
  keyword: "咖啡店",
  city: "上海",
  lat: 31.22,
  lng: 121.45,
  time: 1716383021000, // already ms
};

describe("constants", () => {
  it("exposes name/version", () => {
    expect(NAME).toBe("travel-amap");
    expect(VERSION).toBe("0.8.0");
  });
});

describe("authenticate", () => {
  it("reports NO_INPUT when no snapshot path is provided", async () => {
    const a = new AmapAdapter();
    expect(await a.authenticate({})).toMatchObject({
      ok: false,
      reason: "NO_INPUT",
    });
  });

  it.each(["inputPath", "dataPath", "dbPath"])(
    "accepts an existing SQLite snapshot via %s",
    async (pathOption) => {
      const p = writeTmpDb();
      try {
        const a = new AmapAdapter({ account: { deviceId: "DEV1" } });
        expect(await a.authenticate({ [pathOption]: p })).toEqual({
          ok: true,
          account: "DEV1",
          mode: "snapshot-file",
        });
      } finally {
        fs.unlinkSync(p);
      }
    },
  );

  it("rejects a missing snapshot file", async () => {
    const a = new AmapAdapter();
    expect(
      await a.authenticate({
        inputPath: path.join(os.tmpdir(), "nonexistent-amap-auth.db"),
      }),
    ).toMatchObject({
      ok: false,
      reason: "INPUT_PATH_UNREADABLE",
    });
  });

  it("rejects a regular file without the SQLite magic header", async () => {
    const p = path.join(
      os.tmpdir(),
      `cc-amap-invalid-${crypto.randomUUID()}.db`,
    );
    fs.writeFileSync(p, "not a sqlite database");
    try {
      const a = new AmapAdapter();
      expect(await a.authenticate({ inputPath: p })).toMatchObject({
        ok: false,
        reason: "SNAPSHOT_SCHEMA_MISMATCH",
      });
      expect(await a.healthCheck({ inputPath: p })).toMatchObject({
        ok: false,
        reason: "SNAPSHOT_SCHEMA_MISMATCH",
      });
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("healthCheck", () => {
  it("delegates its no-input result to authenticate", async () => {
    const a = new AmapAdapter();
    expect(await a.healthCheck({})).toMatchObject({
      ok: false,
      reason: "NO_INPUT",
      error: expect.stringContaining("inputPath/dataPath"),
      lastChecked: expect.any(Number),
    });
  });

  it("passes a valid runtime snapshot file", async () => {
    const p = writeTmpDb();
    try {
      const a = new AmapAdapter();
      expect(await a.healthCheck({ dataPath: p })).toMatchObject({
        ok: true,
        lastChecked: expect.any(Number),
      });
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe("sync — fake sqlite driver", () => {
  it("yields route + search records, opens readonly, closes db", async () => {
    const p = writeTmpDb();
    const log = {};
    try {
      const a = new AmapAdapter({
        dbPath: p,
        dbDriverFactory: makeFakeDriverFactory(
          { history_route: [ROUTE_ROW], history_search: [SEARCH_ROW] },
          log,
        ),
      });
      const items = await collect(a.sync({}));
      expect(items).toHaveLength(2);

      const route = items.find((i) => i.payload.kind === "route");
      expect(route.originalId).toBe("route-7");
      expect(route.payload.record).toMatchObject({
        vendorId: "amap",
        vehicleType: "car", // mode=drive
        carrier: "高德地图",
        departureMs: 1716383021 * 1000, // seconds upgraded to ms
      });
      expect(route.payload.record.from.name).toBe("家");
      expect(route.payload.record.to.name).toBe("公司");

      const search = items.find((i) => i.payload.kind === "search");
      expect(search.originalId).toBe("search-9");
      expect(search.payload.record).toMatchObject({
        vehicleType: "visit",
        departureMs: 1716383021000, // ms passthrough
      });
      expect(search.payload.record.to).toMatchObject({
        name: "咖啡店",
        city: "上海",
      });

      expect(log.opened.opts).toEqual({ readonly: true });
      expect(log.closed).toBe(true);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("falls back to legacy ROUTE_HISTORY table name", async () => {
    const p = writeTmpDb();
    try {
      const a = new AmapAdapter({
        dbPath: p,
        dbDriverFactory: makeFakeDriverFactory({
          ROUTE_HISTORY: [ROUTE_ROW],
          history_search: [],
        }),
      });
      const items = await collect(a.sync({}));
      expect(items).toHaveLength(1);
      expect(items[0].payload.kind).toBe("route");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("skips rows without any id, tolerates missing tables entirely", async () => {
    const p = writeTmpDb();
    try {
      const a = new AmapAdapter({
        dbPath: p,
        dbDriverFactory: makeFakeDriverFactory({
          history_route: [{ mode: "walk" }], // no id → dropped
        }),
      });
      expect(await collect(a.sync({}))).toEqual([]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("rejects unreadable discovered tables instead of returning a partial collection", async () => {
    const p = writeTmpDb();
    try {
      const a = new AmapAdapter({
        dbPath: p,
        dbDriverFactory: makeFakeDriverFactory({
          history_route: new Error("synthetic SQLite read failure"),
        }),
      });

      await expect(collect(a.sync({}))).rejects.toMatchObject({
        code: "AMAP_SQLITE_SOURCE_UNREADABLE",
        table: "history_route",
        operation: "read",
      });
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("throws instead of reporting a successful empty run without input", async () => {
    const a = new AmapAdapter({
      dbDriverFactory: makeFakeDriverFactory({}),
    });
    await expect(collect(a.sync({}))).rejects.toThrow(/inputPath\/dataPath/);
  });

  it("rejects a missing db file", async () => {
    const a = new AmapAdapter({
      dbPath: path.join(os.tmpdir(), "nonexistent-amap.db"),
      dbDriverFactory: makeFakeDriverFactory({}),
    });
    await expect(collect(a.sync({}))).rejects.toThrow(
      /snapshot file is unavailable or unreadable/,
    );
  });
});

describe("normalize", () => {
  it("route record → trip event with place coordinates", async () => {
    const p = writeTmpDb();
    try {
      const a = new AmapAdapter({
        dbPath: p,
        dbDriverFactory: makeFakeDriverFactory({
          history_route: [ROUTE_ROW],
          history_search: [],
        }),
      });
      const [item] = await collect(a.sync({}));
      const batch = a.normalize(item);
      const ev = batch.events[0];
      expect(ev.subtype).toBe("trip");
      expect(ev.content.title).toBe("car: 家 → 公司");
      expect(ev.source.adapter).toBe(NAME);
      expect(batch.places).toHaveLength(2);
      expect(batch.places[0].coordinates).toEqual({ lat: 31.23, lng: 121.47 });
      const merchant = batch.persons.find((x) => x.subtype === "merchant");
      expect(merchant.names).toEqual(["高德地图"]);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("throws on missing record", () => {
    const a = new AmapAdapter();
    expect(() => a.normalize({ payload: {} })).toThrow(
      /payload\.record missing/,
    );
  });
});
