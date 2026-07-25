"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { WhatsAppAdapter } = require("../../lib/adapters/messaging-whatsapp");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/messaging-whatsapp/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

async function collect(iterable) {
  const raws = [];
  for await (const raw of iterable) raws.push(raw);
  return raws;
}

function createModernMessageTable(db) {
  db.exec(
    `CREATE TABLE message (
      _id INTEGER PRIMARY KEY,
      key_id TEXT,
      chat_row_id INTEGER,
      sender_jid_row_id INTEGER,
      text_data TEXT,
      timestamp INTEGER,
      received_timestamp INTEGER,
      from_me INTEGER
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

describe("WhatsApp SQLite explicit cursor", () => {
  it("lets Registry limits advance contacts through calls in one stable account scope", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-whatsapp-registry-"));
    const dbPath = path.join(tmpDir, "msgstore.db");
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE jid (
        _id INTEGER PRIMARY KEY,
        user TEXT,
        raw_string TEXT,
        display_name TEXT
      );
      INSERT INTO jid VALUES
        (1, '13800000000', '13800000000@s.whatsapp.net', 'Alice');
      CREATE TABLE chat (
        _id INTEGER PRIMARY KEY,
        jid_row_id INTEGER,
        subject TEXT
      );
      INSERT INTO chat VALUES (2, 1, 'Family')`,
    );
    createModernMessageTable(db);
    db.exec(
      `INSERT INTO message VALUES
        (3, 'modern-3', 2, 1, 'hello', 1750000000003, NULL, 0);
      CREATE TABLE messages (
        _id INTEGER PRIMARY KEY,
        key_id TEXT,
        key_remote_jid TEXT,
        data TEXT,
        timestamp INTEGER,
        key_from_me INTEGER
      );
      INSERT INTO messages VALUES
        (4, 'legacy-4', '13800000000@s.whatsapp.net', 'old', 1750000000004, 1);
      CREATE TABLE call_log (
        _id INTEGER PRIMARY KEY,
        jid_row_id INTEGER,
        group_jid_row_id INTEGER,
        timestamp INTEGER,
        from_me INTEGER,
        video_call INTEGER,
        duration INTEGER
      );
      INSERT INTO call_log VALUES
        (5, 1, NULL, 1750000000005, 0, 0, 60)`,
    );
    db.close();

    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const adapter = new WhatsAppAdapter({
      account: { phone: "13800000000" },
      dbPath,
      dbDriverFactory: () => Database,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 5; index += 1) {
      reports.push(await registry.syncAdapter(adapter.name, { limit: 1 }));
    }

    expect(reports.map((report) => report.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:whatsapp:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(
      vault.queryPersons({ adapter: adapter.name, limit: 10 }),
    ).toHaveLength(1);
    expect(
      vault.queryEvents({ adapter: adapter.name, limit: 10 }),
    ).toHaveLength(3);
    expect(parseCursor(reports[4].watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });

  it("keyset-pages every message and relation beyond the former 10000-row cap", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-whatsapp-page-"));
    const dbPath = path.join(tmpDir, "msgstore.db");
    const db = new Database(dbPath);
    createModernMessageTable(db);
    db.exec(
      `CREATE TABLE message_media (
        _id INTEGER PRIMARY KEY,
        message_row_id INTEGER,
        mime_type TEXT,
        file_path TEXT
      );
      WITH RECURSIVE seq(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM seq WHERE value < 10005
      )
      INSERT INTO message
      SELECT
        9007199254740992 + value,
        'key-' || value,
        NULL,
        NULL,
        'message-' || value,
        1750000000000 + value,
        NULL,
        0
      FROM seq;
      INSERT INTO message_media
      VALUES (
        1,
        9007199254750997,
        'image/jpeg',
        '/media/last.jpg'
      )`,
    );
    db.close();
    const adapter = new WhatsAppAdapter({
      account: { phone: "13800000000" },
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
    expect(first[0].payload.row._id).toBe("9007199254740993");
    expect(first[10001].payload.row._id).toBe("9007199254750994");
    expect(parseCursor(watermark).cursor).toMatchObject({
      after: {
        kind: "modern-message",
        id: "9007199254750994",
      },
      upper: {
        "modern-message": "9007199254750997",
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
    expect(second.map((raw) => raw.payload.row._id)).toEqual([
      "9007199254750995",
      "9007199254750996",
      "9007199254750997",
    ]);
    expect(second[2].payload.row._media).toMatchObject({
      mime_type: "image/jpeg",
      file_path: "/media/last.jpg",
    });
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });

  it("fails closed when a frozen source boundary disappears", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-whatsapp-regress-"));
    const dbPath = path.join(tmpDir, "msgstore.db");
    const db = new Database(dbPath);
    createModernMessageTable(db);
    db.exec(
      `INSERT INTO message VALUES
        (1, 'one', NULL, NULL, 'one', 1750000000001, NULL, 0),
        (2, 'two', NULL, NULL, 'two', 1750000000002, NULL, 0),
        (3, 'three', NULL, NULL, 'three', 1750000000003, NULL, 0)`,
    );
    db.close();
    const adapter = new WhatsAppAdapter({
      account: { phone: "13800000000" },
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
    changed.exec("DELETE FROM message WHERE _id = 3");
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
      code: "WHATSAPP_CURSOR_SOURCE_REGRESSED",
      retryable: false,
    });
  });

  it("merges both message tables without losing same-id legacy rows", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-whatsapp-merge-"));
    const dbPath = path.join(tmpDir, "msgstore.db");
    const db = new Database(dbPath);
    createModernMessageTable(db);
    db.exec(
      `INSERT INTO message VALUES
        (7, 'same-key', NULL, NULL, 'modern', 1750000000007, NULL, 0);
      CREATE TABLE messages (
        _id INTEGER PRIMARY KEY,
        key_id TEXT,
        data TEXT,
        timestamp INTEGER,
        key_from_me INTEGER
      );
      INSERT INTO messages VALUES
        (7, 'legacy-only', 'legacy', 1750000000008, 1),
        (8, 'same-key', 'duplicate', 1750000000009, 0);
      CREATE TABLE message_location (
        _id INTEGER PRIMARY KEY,
        message_row_id INTEGER,
        latitude REAL,
        longitude REAL,
        place_name TEXT
      );
      INSERT INTO message_location VALUES
        (1, 7, 31.2, 121.5, 'Shanghai')`,
    );
    db.close();
    const adapter = new WhatsAppAdapter({
      account: { phone: "13800000000" },
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

    expect(raws.map((raw) => raw.originalId)).toEqual([
      "msg-7",
      "msg-legacy-7",
    ]);
    expect(raws.map((raw) => raw.payload.schema)).toEqual(["modern", "legacy"]);
    expect(raws[0].payload.row._location).toMatchObject({
      place_name: "Shanghai",
    });
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });
});

describe("WhatsApp cursor validation", () => {
  it("migrates legacy counts and rejects malformed or unsupported cursors", () => {
    expect(parseCursor("10000")).toMatchObject({
      kind: "legacy-reset",
      cursor: { v: 1, after: null, upper: null },
    });
    expect(() => parseCursor("whatsapp-sqlite:v2:{}")).toThrowError(
      expect.objectContaining({ code: "WHATSAPP_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        after: { kind: "chat", id: "2" },
        upper: {
          contact: null,
          chat: "1",
          "modern-message": null,
          "legacy-message": null,
          call: null,
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "WHATSAPP_CURSOR_INVALID" }),
    );
  });
});
