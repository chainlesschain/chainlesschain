"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ToutiaoAdapter,
  VERSION,
} = require("../../lib/adapters/social-toutiao");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/social-toutiao/scan-cursor");
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-toutiao-cursor-"));
  }
  return tmpDir;
}

function snapshotEvents() {
  return [
    {
      kind: "profile",
      id: "profile-12345",
      capturedAt: 1_700_000_000_000,
      uid: "12345",
      nickname: "reader",
    },
    {
      kind: "read",
      id: "read-1",
      capturedAt: 1_700_000_100_000,
      itemId: "article-1",
      title: "article",
    },
    {
      kind: "search",
      id: "search-1",
      capturedAt: 1_700_000_200_000,
      keyword: "query",
    },
  ];
}

function writeSnapshot(events = snapshotEvents()) {
  const inputPath = path.join(ensureTmpDir(), "social-toutiao.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_300_000,
      account: { uid: "12345", displayName: "reader" },
      events,
    }),
    "utf8",
  );
  return inputPath;
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
  reads = [],
  collections = [],
  searches = [],
  queries = [],
}) {
  return class FakeDb {
    prepare(sql) {
      queries.push(sql);
      return {
        all() {
          if (sql.includes("FROM read_history")) return reads;
          if (sql.includes("FROM collection_article")) return collections;
          if (sql.includes("FROM search_history")) return searches;
          throw new Error("no such table");
        },
      };
    }

    close() {}
  };
}

describe("Toutiao explicit collection cursor", () => {
  it("declares the resumable v0.3 contract", () => {
    const adapter = new ToutiaoAdapter();
    expect(VERSION).toBe("0.3.0");
    expect(adapter.version).toBe("0.3.0");
    expect(adapter.watermarkStrategy).toBe("explicit");
    expect(adapter.fileCheckpointMode()).toBe("shared");
  });

  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    const registry = new AdapterRegistry({ vault: createVault() });
    const adapter = new ToutiaoAdapter();
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { inputPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:social-toutiao:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("removes the legacy SQLite 5000-row truncation", async () => {
    const dbPath = path.join(ensureTmpDir(), "toutiao.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const queries = [];
    const reads = Array.from({ length: 5001 }, (_, index) => ({
      id: index + 1,
      item_id: `article-${index + 1}`,
      title: `article-${index + 1}`,
      read_time: 1_700_000_000 + index,
    }));
    const adapter = new ToutiaoAdapter({
      account: { uid: "12345" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ reads, queries }),
    });

    const raws = await collect(adapter.sync());

    expect(raws).toHaveLength(5001);
    expect(raws[0].originalId).toBe("read-5001");
    expect(queries.some((sql) => /LIMIT\s+5000/iu.test(sql))).toBe(false);
  });

  it("resumes a frozen SQLite collection instead of replaying its first row", async () => {
    const dbPath = path.join(ensureTmpDir(), "toutiao.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const reads = [
      {
        id: 1,
        item_id: "article-1",
        title: "one",
        read_time: 3,
      },
    ];
    const collections = [
      {
        id: 2,
        item_id: "article-2",
        title: "two",
        save_time: 2,
      },
    ];
    const searches = [{ id: 3, keyword: "three", search_time: 1 }];
    const adapter = new ToutiaoAdapter({
      account: { uid: "12345" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ reads, collections, searches }),
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
    expect(reports[0].scope).toMatch(/^account:social-toutiao:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[1].watermark).cursor.mode).toBe("sqlite");
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("rejects SQLite row changes while a frozen collection is active", async () => {
    const dbPath = path.join(ensureTmpDir(), "toutiao.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const reads = [
      { id: 1, item_id: "article-1", title: "one", read_time: 2 },
      { id: 2, item_id: "article-2", title: "two", read_time: 1 },
    ];
    const adapter = new ToutiaoAdapter({
      account: { uid: "12345" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ reads }),
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

    reads[1].title = "changed while resuming";
    await expect(
      collect(adapter.sync({ sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "TOUTIAO_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("fails closed if the selected snapshot or include configuration changes", async () => {
    const inputPath = writeSnapshot();
    const adapter = new ToutiaoAdapter();
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
          inputPath,
          include: { profile: false },
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "TOUTIAO_CURSOR_CONFIG_CHANGED",
      retryable: false,
    });

    writeSnapshot([
      snapshotEvents()[0],
      snapshotEvents()[1],
      { ...snapshotEvents()[2], id: "search-9", keyword: "changed" },
    ]);
    await expect(
      collect(adapter.sync({ inputPath, sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "TOUTIAO_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });
});

describe("Toutiao cursor validation", () => {
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
    ).toMatch(/^social-toutiao:v1:/u);
    expect(() => parseCursor("social-toutiao:v2:{}")).toThrowError(
      expect.objectContaining({ code: "TOUTIAO_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        mode: "snapshot",
        source: "a".repeat(64),
        config: "b".repeat(64),
        after: 2,
        upper: 2,
      }),
    ).toThrowError(expect.objectContaining({ code: "TOUTIAO_CURSOR_INVALID" }));
  });
});
