"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  BaiduMapAdapter,
  VERSION,
} = require("../../lib/adapters/travel-baidu-map");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/travel-baidu-map/scan-cursor");
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-baidu-map-cursor-"));
  }
  return tmpDir;
}

function snapshotEvents() {
  return [
    {
      kind: "favourite",
      id: "favourite-1",
      capturedAt: 1_700_000_000_000,
      name: "home",
    },
    {
      kind: "search",
      id: "search-1",
      capturedAt: 1_700_000_100_000,
      query: "coffee",
    },
    {
      kind: "route",
      id: "route-1",
      capturedAt: 1_700_000_200_000,
      from: { name: "home" },
      to: { name: "office" },
      mode: "drive",
    },
  ];
}

function writeSnapshot(events = snapshotEvents()) {
  const inputPath = path.join(ensureTmpDir(), "travel-baidu-map.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_300_000,
      account: { uid: "account-1", displayName: "traveller" },
      events,
    }),
    "utf8",
  );
  return inputPath;
}

function writeDb() {
  const dbPath = path.join(ensureTmpDir(), "baidu-map.db");
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
            if (sql.includes("FROM sqlite_master")) {
              return [
                { name: "route_history" },
                { name: "search_history" },
                { name: "my_favourite" },
              ];
            }
            if (sql.includes("route_history")) return routes;
            if (sql.includes("search_history")) return searches;
            if (sql.includes("my_favourite")) return favourites;
            throw new Error("no such table");
          },
        };
      }

      close() {}
    };
}

function createSqliteAdapter(dbPath, collections = {}) {
  return new BaiduMapAdapter({
    account: { deviceId: "device-1" },
    dbPath,
    dbDriverFactory: sqliteDriver(collections),
  });
}

describe("Baidu Map explicit collection cursor", () => {
  it("declares the resumable v0.8 contract", () => {
    const adapter = new BaiduMapAdapter();
    expect(VERSION).toBe("0.8.0");
    expect(adapter.version).toBe("0.8.0");
    expect(adapter.watermarkStrategy).toBe("explicit");
    expect(adapter.fileCheckpointMode()).toBe("shared");
  });

  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    const adapter = new BaiduMapAdapter();
    const registry = new AdapterRegistry({ vault: createVault() });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { inputPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(
      /^account:travel-baidu-map:[0-9a-f]{32}$/u,
    );
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("resumes a frozen SQLite collection instead of replaying its first row", async () => {
    const dbPath = writeDb();
    const adapter = createSqliteAdapter(dbPath, {
      routes: [{ id: 1, from_name: "home", to_name: "office", time: 3 }],
      searches: [{ id: 2, query: "coffee", time: 2 }],
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

    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(
      /^account:travel-baidu-map:[0-9a-f]{32}$/u,
    );
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[1].watermark).cursor.mode).toBe("sqlite");
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
    const adapter = createSqliteAdapter(dbPath, { routes, queries });

    const raws = await collect(adapter.sync());

    expect(raws).toHaveLength(5001);
    expect(raws[0].originalId).toBe("route-5001");
    expect(queries.some((sql) => /LIMIT\s+5000/iu.test(sql))).toBe(false);
  });

  it("rejects snapshot changes while a frozen collection is active", async () => {
    const inputPath = writeSnapshot();
    const adapter = new BaiduMapAdapter();
    let watermark;
    await collect(
      adapter.sync({
        inputPath,
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    writeSnapshot([
      snapshotEvents()[0],
      snapshotEvents()[1],
      { ...snapshotEvents()[2], id: "route-9", to: { name: "station" } },
    ]);
    await expect(
      collect(adapter.sync({ inputPath, sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "BAIDU_MAP_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("rejects SQLite row changes while a frozen collection is active", async () => {
    const dbPath = writeDb();
    const routes = [
      { id: 1, from_name: "home", to_name: "office", time: 2 },
      { id: 2, from_name: "home", to_name: "station", time: 1 },
    ];
    const adapter = createSqliteAdapter(dbPath, { routes });
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
      code: "BAIDU_MAP_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("fails closed if the selected collection configuration changes", async () => {
    const inputPath = writeSnapshot();
    const adapter = new BaiduMapAdapter();
    let watermark;
    await collect(
      adapter.sync({
        inputPath,
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    await expect(
      collect(
        adapter.sync({
          include: { favourite: false },
          inputPath,
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAIDU_MAP_CURSOR_CONFIG_CHANGED",
      retryable: false,
    });
  });
});

describe("Baidu Map cursor validation", () => {
  it("migrates legacy counts and accepts both local modes", () => {
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
    for (const mode of ["snapshot", "sqlite"]) {
      expect(
        serializeCursor({
          v: 1,
          mode,
          source: "a".repeat(64),
          config: "b".repeat(64),
          after: 1,
          upper: 2,
        }),
      ).toMatch(/^travel-baidu-map:v1:/u);
    }
    expect(() => parseCursor("travel-baidu-map:v2:{}")).toThrowError(
      expect.objectContaining({ code: "BAIDU_MAP_CURSOR_UNSUPPORTED" }),
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
    ).toThrowError(
      expect.objectContaining({ code: "BAIDU_MAP_CURSOR_INVALID" }),
    );
  });
});
