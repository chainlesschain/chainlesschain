"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  KuaishouAdapter,
  VERSION,
} = require("../../lib/adapters/social-kuaishou");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/social-kuaishou/scan-cursor");
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-kuaishou-cursor-"));
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
      nickname: "student",
    },
    {
      kind: "watch",
      id: "watch-1",
      capturedAt: 1_700_000_100_000,
      photoId: "photo-1",
      caption: "watch",
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
  const inputPath = path.join(ensureTmpDir(), "social-kuaishou.json");
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

function sqliteDriver({
  watched = [],
  collected = [],
  searches = [],
  queries = [],
}) {
  return class FakeDb {
    prepare(sql) {
      queries.push(sql);
      return {
        all() {
          if (sql.includes("FROM photo_history")) return watched;
          if (sql.includes("FROM user_collect")) return collected;
          if (sql.includes("FROM search_record")) return searches;
          throw new Error("no such table");
        },
      };
    }

    close() {}
  };
}

describe("Kuaishou explicit collection cursor", () => {
  it("declares the resumable v0.3 contract", () => {
    const adapter = new KuaishouAdapter();
    expect(VERSION).toBe("0.3.0");
    expect(adapter.version).toBe("0.3.0");
    expect(adapter.watermarkStrategy).toBe("explicit");
    expect(adapter.fileCheckpointMode()).toBe("shared");
  });

  it("lets Registry limits resume one snapshot in a stable private scope", async () => {
    const inputPath = writeSnapshot();
    const registry = new AdapterRegistry({ vault: createVault() });
    const adapter = new KuaishouAdapter();
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { inputPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:social-kuaishou:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("removes the legacy SQLite 5000-row truncation", async () => {
    const dbPath = path.join(ensureTmpDir(), "kuaishou.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const queries = [];
    const watched = Array.from({ length: 5001 }, (_, index) => ({
      id: index + 1,
      photo_id: `photo-${index + 1}`,
      caption: `video-${index + 1}`,
      view_time: 1_700_000_000 + index,
    }));
    const adapter = new KuaishouAdapter({
      account: { uid: "12345" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ watched, queries }),
    });

    const raws = await collect(adapter.sync());

    expect(raws).toHaveLength(5001);
    expect(raws[0].originalId).toBe("photo-5001");
    expect(queries.some((sql) => /LIMIT\s+5000/iu.test(sql))).toBe(false);
  });

  it("resumes a frozen SQLite collection instead of replaying its first row", async () => {
    const dbPath = path.join(ensureTmpDir(), "kuaishou.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const watched = [
      {
        id: 1,
        photo_id: "photo-1",
        caption: "one",
        view_time: 3,
      },
    ];
    const collected = [
      {
        id: 2,
        photo_id: "photo-2",
        caption: "two",
        collect_time: 2,
      },
    ];
    const searches = [{ id: 3, keyword: "three", search_time: 1 }];
    const adapter = new KuaishouAdapter({
      account: { uid: "12345" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ watched, collected, searches }),
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
    expect(reports[0].scope).toMatch(/^account:social-kuaishou:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(parseCursor(reports[1].watermark).cursor.mode).toBe("sqlite");
    expect(parseCursor(reports[2].watermark).cursor.upper).toBeNull();
  });

  it("rejects SQLite row changes while a frozen collection is active", async () => {
    const dbPath = path.join(ensureTmpDir(), "kuaishou.db");
    fs.writeFileSync(dbPath, "sqlite-fixture", "utf8");
    const watched = [
      { id: 1, photo_id: "photo-1", caption: "one", view_time: 2 },
      { id: 2, photo_id: "photo-2", caption: "two", view_time: 1 },
    ];
    const adapter = new KuaishouAdapter({
      account: { uid: "12345" },
      dbPath,
      dbDriverFactory: () => sqliteDriver({ watched }),
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

    watched[1].caption = "changed while resuming";
    await expect(
      collect(adapter.sync({ sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "KUAISHOU_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("fails closed if the selected snapshot or include configuration changes", async () => {
    const inputPath = writeSnapshot();
    const adapter = new KuaishouAdapter();
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
      code: "KUAISHOU_CURSOR_CONFIG_CHANGED",
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
      code: "KUAISHOU_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });
});

describe("Kuaishou cursor validation", () => {
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
    ).toMatch(/^social-kuaishou:v1:/u);
    expect(() => parseCursor("social-kuaishou:v2:{}")).toThrowError(
      expect.objectContaining({ code: "KUAISHOU_CURSOR_UNSUPPORTED" }),
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
      expect.objectContaining({ code: "KUAISHOU_CURSOR_INVALID" }),
    );
  });
});
