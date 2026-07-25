"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AmapAdapter, VERSION } = require("../../lib/adapters/travel-amap");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/travel-amap/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

async function collect(iterable) {
  const raws = [];
  for await (const raw of iterable) raws.push(raw);
  return raws;
}

let tmpDir;
let vault;

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch {
      // Best-effort test cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

function ensureTmpDir() {
  if (!tmpDir) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-amap-cursor-"));
  }
  return tmpDir;
}

function writeDb() {
  const dbPath = path.join(ensureTmpDir(), "amap.db");
  fs.writeFileSync(dbPath, Buffer.from("SQLite format 3\0fixture", "utf8"));
  return dbPath;
}

function createVault() {
  vault = new LocalVault({
    path: path.join(ensureTmpDir(), "vault.db"),
    key: generateKeyHex(),
    skipAudit: true,
  });
  vault.open();
  return vault;
}

function sqliteDriver({
  routes = [],
  searches = [],
  favourites = [],
  queries = [],
}) {
  return () =>
    class FakeDb {
      prepare(sql) {
        queries.push(sql);
        return {
          all() {
            if (sql.includes("history_route")) return routes;
            if (sql.includes("history_search")) return searches;
            if (sql.includes("favourites")) return favourites;
            throw new Error("no such table");
          },
        };
      }

      close() {}
    };
}

function createAdapter(dbPath, collections = {}) {
  return new AmapAdapter({
    account: { deviceId: "device-1" },
    dbPath,
    dbDriverFactory: sqliteDriver(collections),
  });
}

describe("Amap explicit collection cursor", () => {
  it("declares the resumable v0.8 contract", () => {
    const adapter = new AmapAdapter();
    expect(VERSION).toBe("0.8.0");
    expect(adapter.version).toBe("0.8.0");
    expect(adapter.watermarkStrategy).toBe("explicit");
    expect(adapter.fileCheckpointMode()).toBe("shared");
  });

  it("lets Registry limits resume one SQLite scan in a stable private scope", async () => {
    const dbPath = writeDb();
    const adapter = createAdapter(dbPath, {
      routes: [{ id: 1, from_name: "home", to_name: "office", time: 3 }],
      searches: [{ id: 2, keyword: "coffee", time: 2 }],
      favourites: [{ id: 3, name: "park", time: 1 }],
    });
    const registry = new AdapterRegistry({ vault: createVault() });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { dbPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:travel-amap:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("removes the legacy SQLite 5000-row truncation", async () => {
    const dbPath = writeDb();
    const queries = [];
    const routes = Array.from({ length: 5001 }, (_, index) => ({
      id: index + 1,
      from_name: "home",
      to_name: `destination-${index + 1}`,
      time: 1_700_000_000 + index,
    }));
    const adapter = createAdapter(dbPath, { routes, queries });

    const raws = await collect(adapter.sync());

    expect(raws).toHaveLength(5001);
    expect(raws[0].originalId).toBe("route-5001");
    expect(queries.some((sql) => /LIMIT\s+5000/iu.test(sql))).toBe(false);
  });

  it("rejects row changes while a frozen SQLite collection is active", async () => {
    const dbPath = writeDb();
    const routes = [
      { id: 1, from_name: "home", to_name: "office", time: 2 },
      { id: 2, from_name: "home", to_name: "station", time: 1 },
    ];
    const adapter = createAdapter(dbPath, { routes });
    let watermark;
    await collect(
      adapter.sync({
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    routes[1].to_name = "changed while resuming";
    await expect(
      collect(adapter.sync({ sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "AMAP_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("fails closed if the selected collection configuration changes", async () => {
    const dbPath = writeDb();
    const adapter = createAdapter(dbPath, {
      routes: [
        { id: 1, from_name: "home", to_name: "office", time: 2 },
        { id: 2, from_name: "home", to_name: "station", time: 1 },
      ],
    });
    let watermark;
    await collect(
      adapter.sync({
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    await expect(
      collect(
        adapter.sync({
          include: { route: false },
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "AMAP_CURSOR_CONFIG_CHANGED",
      retryable: false,
    });
  });
});

describe("Amap cursor validation", () => {
  it("migrates legacy counts and accepts sqlite while rejecting bad cursors", () => {
    expect(parseCursor("3")).toMatchObject({
      kind: "legacy-reset",
      cursor: {
        v: 1,
        mode: null,
        source: null,
        config: null,
        after: null,
        upper: null,
      },
    });
    expect(
      serializeCursor({
        v: 1,
        mode: "sqlite",
        source: "a".repeat(64),
        config: "b".repeat(64),
        after: 1,
        upper: 2,
      }),
    ).toMatch(/^travel-amap:v1:/u);
    expect(() => parseCursor("travel-amap:v2:{}")).toThrowError(
      expect.objectContaining({ code: "AMAP_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        mode: "sqlite",
        source: "a".repeat(64),
        config: "b".repeat(64),
        after: 2,
        upper: 2,
      }),
    ).toThrowError(expect.objectContaining({ code: "AMAP_CURSOR_INVALID" }));
  });
});
