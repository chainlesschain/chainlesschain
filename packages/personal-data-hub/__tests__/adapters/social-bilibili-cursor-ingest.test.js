"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  BilibiliAdapter,
  VERSION,
} = require("../../lib/adapters/social-bilibili");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/social-bilibili/scan-cursor");
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-bilibili-cursor-"));
  }
  return tmpDir;
}

function snapshotEvents() {
  return [
    {
      kind: "history",
      id: "BV-history-1",
      capturedAt: 1_700_000_000_000,
      title: "history",
      bvid: "BV-history-1",
    },
    {
      kind: "favourite",
      id: "fav-1",
      capturedAt: 1_700_000_100_000,
      title: "favourite",
      bvid: "BV-favourite-1",
    },
    {
      kind: "follow",
      id: "follow-1",
      capturedAt: 1_700_000_200_000,
      mid: "1",
      uname: "uploader",
    },
  ];
}

function writeSnapshot(events = snapshotEvents()) {
  const inputPath = path.join(ensureTmpDir(), "social-bilibili.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_300_000,
      account: { uid: "12345", displayName: "student" },
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

function sqliteDriver({ history = [], favourites = [], queries = [] }) {
  return class FakeDb {
    prepare(sql) {
      queries.push(sql);
      return {
        all() {
          if (sql.includes("FROM sqlite_master")) {
            return [{ name: "history" }, { name: "bili_favourite" }];
          }
          if (sql.includes("FROM history")) return history;
          if (sql.includes("FROM bili_favourite")) return favourites;
          throw new Error("no such table");
        },
      };
    }

    close() {}
  };
}

describe("Bilibili explicit collection cursor", () => {
  it("declares the resumable v0.7 contract", () => {
    const adapter = new BilibiliAdapter();
    expect(VERSION).toBe("0.7.0");
    expect(adapter.version).toBe("0.7.0");
    expect(adapter.watermarkStrategy).toBe("explicit");
    expect(adapter.fileCheckpointMode()).toBe("shared");
  });

  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    const registry = new AdapterRegistry({ vault: createVault() });
    const adapter = new BilibiliAdapter();
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { inputPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:social-bilibili:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("removes the legacy SQLite 5000-row truncation", async () => {
    const dbPath = path.join(ensureTmpDir(), "bilibili.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const queries = [];
    const history = Array.from({ length: 5001 }, (_, index) => ({
      id: index + 1,
      bvid: `BV-${index + 1}`,
      title: `video-${index + 1}`,
      view_at: 1_700_000_000 + index,
    }));
    const adapter = new BilibiliAdapter({
      account: { uid: "12345" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ history, queries }),
    });

    const raws = await collect(adapter.sync());

    expect(raws).toHaveLength(5001);
    expect(raws[0].originalId).toBe("bilibili:history:5001");
    expect(queries.some((sql) => /LIMIT\s+5000/iu.test(sql))).toBe(false);
  });

  it("resumes a frozen SQLite collection instead of replaying its first row", async () => {
    const dbPath = path.join(ensureTmpDir(), "bilibili.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const history = [
      { id: 1, bvid: "BV-1", title: "one", view_at: 3 },
      { id: 2, bvid: "BV-2", title: "two", view_at: 2 },
    ];
    const favourites = [
      {
        id: 3,
        bvid: "BV-3",
        title: "three",
        save_time: 1,
      },
    ];
    const adapter = new BilibiliAdapter({
      account: { uid: "12345" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ history, favourites }),
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
    expect(reports[0].scope).toMatch(/^account:social-bilibili:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[1].watermark).cursor.mode).toBe("sqlite");
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("rejects SQLite row changes while a frozen collection is active", async () => {
    const dbPath = path.join(ensureTmpDir(), "bilibili.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const history = [
      { id: 1, bvid: "BV-1", title: "one", view_at: 2 },
      { id: 2, bvid: "BV-2", title: "two", view_at: 1 },
    ];
    const adapter = new BilibiliAdapter({
      account: { uid: "12345" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ history }),
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

    history[1].title = "changed while resuming";
    await expect(
      collect(adapter.sync({ sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "BILIBILI_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("fails closed if the selected snapshot or include configuration changes", async () => {
    const inputPath = writeSnapshot();
    const adapter = new BilibiliAdapter();
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
          include: { history: false },
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "BILIBILI_CURSOR_CONFIG_CHANGED",
      retryable: false,
    });

    writeSnapshot([
      snapshotEvents()[0],
      snapshotEvents()[1],
      { ...snapshotEvents()[2], id: "follow-9", mid: "9" },
    ]);
    await expect(
      collect(adapter.sync({ inputPath, sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "BILIBILI_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });
});

describe("Bilibili cursor validation", () => {
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
    ).toMatch(/^social-bilibili:v1:/u);
    expect(() => parseCursor("social-bilibili:v2:{}")).toThrowError(
      expect.objectContaining({ code: "BILIBILI_CURSOR_UNSUPPORTED" }),
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
    ).toThrowError(
      expect.objectContaining({ code: "BILIBILI_CURSOR_INVALID" }),
    );
  });
});
