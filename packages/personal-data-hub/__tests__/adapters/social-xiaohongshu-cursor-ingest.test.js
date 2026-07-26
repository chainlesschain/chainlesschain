"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  VERSION,
  XiaohongshuAdapter,
} = require("../../lib/adapters/social-xiaohongshu");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/social-xiaohongshu/scan-cursor");
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-xhs-cursor-"));
  }
  return tmpDir;
}

function snapshotEvents() {
  return [
    {
      kind: "note",
      id: "note-1",
      capturedAt: 1_700_000_000_000,
      noteId: "note-1",
      title: "note",
    },
    {
      kind: "liked",
      id: "liked-1",
      capturedAt: 1_700_000_100_000,
      noteId: "note-2",
      title: "liked",
    },
    {
      kind: "follow",
      id: "follow-1",
      capturedAt: 1_700_000_200_000,
      userId: "user-1",
      nickname: "creator",
    },
  ];
}

function writeSnapshot(events = snapshotEvents()) {
  const inputPath = path.join(ensureTmpDir(), "social-xiaohongshu.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_700_000_300_000,
      account: { uid: "account-1", displayName: "reader" },
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
  histories = [],
  noteFallback = null,
  likes = [],
  favourites = [],
  queries = [],
}) {
  return class FakeDb {
    prepare(sql) {
      queries.push(sql);
      return {
        all() {
          if (sql.includes("FROM sqlite_master")) {
            return [
              { name: "browse_history" },
              ...(noteFallback === null ? [] : [{ name: "note" }]),
              { name: "liked_note" },
              { name: "favourite" },
            ];
          }
          if (sql.includes("FROM browse_history")) return histories;
          if (sql.includes("FROM note")) {
            if (noteFallback === null) throw new Error("no such table");
            return noteFallback;
          }
          if (sql.includes("FROM liked_note")) return likes;
          if (sql.includes("FROM favourite")) return favourites;
          throw new Error("no such table");
        },
      };
    }

    close() {}
  };
}

describe("Xiaohongshu explicit collection cursor", () => {
  it("declares the resumable v0.7 contract", () => {
    const adapter = new XiaohongshuAdapter();
    expect(VERSION).toBe("0.7.0");
    expect(adapter.version).toBe("0.7.0");
    expect(adapter.watermarkStrategy).toBe("explicit");
    expect(adapter.fileCheckpointMode()).toBe("shared");
  });

  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    const registry = new AdapterRegistry({ vault: createVault() });
    const adapter = new XiaohongshuAdapter();
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
      /^account:social-xiaohongshu:[0-9a-f]{32}$/u,
    );
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("removes the legacy SQLite 5000-row truncation", async () => {
    const dbPath = path.join(ensureTmpDir(), "xiaohongshu.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const queries = [];
    const histories = Array.from({ length: 5001 }, (_, index) => ({
      id: index + 1,
      note_id: `note-${index + 1}`,
      title: `note-${index + 1}`,
      view_time: 1_700_000_000 + index,
    }));
    const adapter = new XiaohongshuAdapter({
      account: { uid: "account-1" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ histories, queries }),
    });

    const raws = await collect(adapter.sync());

    expect(raws).toHaveLength(5001);
    expect(raws[0].originalId).toBe("history-5001");
    expect(queries.some((sql) => /LIMIT\s+5000/iu.test(sql))).toBe(false);
  });

  it("resumes a frozen SQLite collection instead of replaying its first row", async () => {
    const dbPath = path.join(ensureTmpDir(), "xiaohongshu.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const histories = [
      { id: 1, note_id: "note-1", title: "one", view_time: 3 },
    ];
    const likes = [{ id: 2, note_id: "note-2", title: "two", like_time: 2 }];
    const favourites = [
      { id: 3, note_id: "note-3", title: "three", save_time: 1 },
    ];
    const adapter = new XiaohongshuAdapter({
      account: { uid: "account-1" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ histories, likes, favourites }),
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
      /^account:social-xiaohongshu:[0-9a-f]{32}$/u,
    );
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[1].watermark).cursor.mode).toBe("sqlite");
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("rejects SQLite row changes while a frozen collection is active", async () => {
    const dbPath = path.join(ensureTmpDir(), "xiaohongshu.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const histories = [
      { id: 1, note_id: "note-1", title: "one", view_time: 2 },
      { id: 2, note_id: "note-2", title: "two", view_time: 1 },
    ];
    const adapter = new XiaohongshuAdapter({
      account: { uid: "account-1" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ histories }),
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

    histories[1].title = "changed while resuming";
    await expect(
      collect(adapter.sync({ sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "XIAOHONGSHU_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("fails closed if the selected snapshot or include configuration changes", async () => {
    const inputPath = writeSnapshot();
    const adapter = new XiaohongshuAdapter();
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
          include: { note: false },
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "XIAOHONGSHU_CURSOR_CONFIG_CHANGED",
      retryable: false,
    });

    writeSnapshot([
      snapshotEvents()[0],
      snapshotEvents()[1],
      { ...snapshotEvents()[2], id: "follow-9", userId: "user-9" },
    ]);
    await expect(
      collect(adapter.sync({ inputPath, sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "XIAOHONGSHU_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });
});

describe("Xiaohongshu cursor validation", () => {
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
    ).toMatch(/^social-xiaohongshu:v1:/u);
    expect(() => parseCursor("social-xiaohongshu:v2:{}")).toThrowError(
      expect.objectContaining({ code: "XIAOHONGSHU_CURSOR_UNSUPPORTED" }),
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
      expect.objectContaining({ code: "XIAOHONGSHU_CURSOR_INVALID" }),
    );
  });
});
