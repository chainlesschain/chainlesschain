"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { TelegramAdapter } = require("../../lib/adapters/messaging-telegram");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/messaging-telegram/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

async function collect(iterable) {
  const raws = [];
  for await (const raw of iterable) raws.push(raw);
  return raws;
}

function createMessageTable(db, table = "messages_v2", idColumn = "mid") {
  db.exec(
    `CREATE TABLE ${table} (
      ${idColumn} INTEGER PRIMARY KEY,
      uid INTEGER,
      from_id INTEGER,
      message TEXT,
      date INTEGER,
      out INTEGER,
      media_type TEXT
    )`,
  );
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

describe("Telegram SQLite explicit cursor", () => {
  it("lets Registry limits advance users, chats, then messages", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-telegram-registry-"));
    const dbPath = path.join(tmpDir, "cache4.db");
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE users (
        uid INTEGER PRIMARY KEY,
        name TEXT,
        username TEXT,
        phone TEXT
      );
      INSERT INTO users VALUES (100, 'Alice', 'alice', '13800000000');
      CREATE TABLE chats (
        uid INTEGER PRIMARY KEY,
        name TEXT
      );
      INSERT INTO chats VALUES (200, 'Group')`,
    );
    createMessageTable(db);
    db.exec(
      `INSERT INTO messages_v2
       VALUES (300, 200, 100, 'hello', 1750000000, 0, NULL)`,
    );
    db.close();
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const adapter = new TelegramAdapter({
      account: { userId: "self" },
      dbPath,
      dbDriverFactory: () => Database,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(await registry.syncAdapter(adapter.name, { limit: 1 }));
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:telegram:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(
      vault.queryPersons({ adapter: adapter.name, limit: 10 }),
    ).toHaveLength(1);
    expect(
      vault.queryEvents({ adapter: adapter.name, limit: 10 }),
    ).toHaveLength(1);
    expect(reports[1].entityCounts.topics).toBe(1);
    expect(parseCursor(reports[2].watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });

  it("keyset-pages every message beyond the former 10000-row cap", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-telegram-page-"));
    const dbPath = path.join(tmpDir, "cache4.db");
    const db = new Database(dbPath);
    createMessageTable(db);
    db.exec(
      `WITH RECURSIVE seq(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM seq WHERE value < 10005
      )
      INSERT INTO messages_v2
      SELECT
        9007199254740992 + value,
        200,
        100,
        'message-' || value,
        1750000000 + value,
        0,
        NULL
      FROM seq`,
    );
    db.close();
    const adapter = new TelegramAdapter({
      account: { userId: "self" },
      dbPath,
      dbDriverFactory: () => Database,
    });
    let watermark;

    const first = await collect(
      adapter.sync({
        limit: 10002,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(first).toHaveLength(10002);
    expect(first[0].payload.row.mid).toBe("9007199254740993");
    expect(first[10001].payload.row.mid).toBe("9007199254750994");
    expect(parseCursor(watermark).cursor).toMatchObject({
      after: {
        kind: "message",
        table: "messages_v2",
        id: "9007199254750994",
      },
      upper: {
        kind: "message",
        table: "messages_v2",
        id: "9007199254750997",
      },
    });

    const second = await collect(
      adapter.sync({
        limit: 10002,
        sinceWatermark: watermark,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(second).toHaveLength(3);
    expect(second.map((raw) => raw.payload.row.mid)).toEqual([
      "9007199254750995",
      "9007199254750996",
      "9007199254750997",
    ]);
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });

  it("fails closed when an active message boundary regresses", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-telegram-regress-"));
    const dbPath = path.join(tmpDir, "cache4.db");
    const db = new Database(dbPath);
    createMessageTable(db);
    db.exec(
      `INSERT INTO messages_v2 VALUES
        (1, 200, 100, 'one', 1750000001, 0, NULL),
        (2, 200, 100, 'two', 1750000002, 0, NULL),
        (3, 200, 100, 'three', 1750000003, 0, NULL)`,
    );
    db.close();
    const adapter = new TelegramAdapter({
      account: { userId: "self" },
      dbPath,
      dbDriverFactory: () => Database,
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
    const changed = new Database(dbPath);
    changed.exec("DELETE FROM messages_v2 WHERE mid > 1");
    changed.close();

    await expect(
      collect(
        adapter.sync({
          sinceWatermark: watermark,
          updateWatermark(value) {
            watermark = value;
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "TELEGRAM_CURSOR_SOURCE_REGRESSED",
      retryable: false,
    });
  });

  it("falls back to a populated legacy messages table", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-telegram-fallback-"));
    const dbPath = path.join(tmpDir, "cache4.db");
    const db = new Database(dbPath);
    createMessageTable(db);
    createMessageTable(db, "messages", "id");
    db.exec(
      `INSERT INTO messages
       VALUES (9007199254740993, 200, 100, 'legacy', 1750000000, 0, NULL)`,
    );
    db.close();
    const adapter = new TelegramAdapter({
      account: { userId: "self" },
      dbPath,
      dbDriverFactory: () => Database,
    });
    let watermark;

    const raws = await collect(
      adapter.sync({
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    expect(raws).toHaveLength(1);
    expect(raws[0]).toMatchObject({
      originalId: "msg-9007199254740993",
      payload: {
        kind: "message",
        row: {
          id: "9007199254740993",
          message: "legacy",
        },
      },
    });
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });
});

describe("Telegram cursor validation", () => {
  it("migrates legacy count watermarks and rejects unsupported versions", () => {
    expect(parseCursor("10000")).toMatchObject({
      kind: "legacy-reset",
      cursor: { v: 1, after: null, upper: null },
    });
    expect(() => parseCursor("telegram-sqlite:v2:{}")).toThrowError(
      expect.objectContaining({ code: "TELEGRAM_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        after: { kind: "chat", id: "2" },
        upper: { kind: "chat", id: "1" },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TELEGRAM_CURSOR_INVALID" }),
    );
  });
});
