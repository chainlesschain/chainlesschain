"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { QQAdapter } = require("../../lib/adapters/messaging-qq");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");
const {
  advanceCursor,
  beginScan,
  comparePositions,
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/messaging-qq/scan-cursor");

function writeSnapshot(dir, events) {
  const inputPath = path.join(dir, "messaging-qq.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: 1,
      snapshottedAt: 1_750_000_000_000,
      account: { qq: "12345" },
      events,
    }),
    "utf8",
  );
  return inputPath;
}

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

describe("messaging-qq cyclic snapshot cursor", () => {
  it("resumes a bounded scan and publishes reset before its last yield", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-cursor-"));
    const inputPath = writeSnapshot(tmpDir, [
      {
        kind: "message",
        id: "message-9007199254740993",
        msgId: "9007199254740993",
        text: "message",
      },
      { kind: "group", id: "group-200", troopUin: "200", troopName: "G" },
      { kind: "contact", id: "contact-100", uin: "100", nickname: "A" },
    ]);
    const adapter = new QQAdapter();
    let watermark;

    for await (const raw of adapter.sync({
      inputPath,
      limit: 1,
      updateWatermark(value) {
        watermark = value;
      },
    })) {
      expect(raw.kind).toBe("contact");
      break;
    }
    expect(parseCursor(watermark).cursor).toMatchObject({
      after: { kind: "contact", id: "100" },
      upper: {
        kind: "message",
        table: "c2c_msg_table",
        id: "9007199254740993",
      },
    });

    const second = await collect(
      adapter.sync({
        inputPath,
        limit: 1,
        sinceWatermark: watermark,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(second.map((raw) => raw.kind)).toEqual(["group"]);

    for await (const raw of adapter.sync({
      inputPath,
      limit: 1,
      sinceWatermark: watermark,
      updateWatermark(value) {
        watermark = value;
      },
    })) {
      expect(raw.payload.msgId).toBe("9007199254740993");
      break;
    }
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });

    const nextCycle = await collect(
      adapter.sync({
        inputPath,
        limit: 1,
        sinceWatermark: watermark,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(nextCycle.map((raw) => raw.kind)).toEqual(["contact"]);
  });

  it("migrates legacy count watermarks instead of treating them as offsets", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-legacy-"));
    const inputPath = writeSnapshot(tmpDir, [
      { kind: "contact", id: "contact-100", uin: "100", nickname: "A" },
    ]);
    const adapter = new QQAdapter();
    let watermark;

    const raws = await collect(
      adapter.sync({
        inputPath,
        sinceWatermark: "9000",
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    expect(raws).toHaveLength(1);
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });
});

describe("messaging-qq cursor validation", () => {
  it("orders exact decimal identifiers without Number coercion", () => {
    const lower = {
      kind: "message",
      table: "c2c_msg_table",
      id: "9007199254740993",
    };
    const upper = {
      kind: "message",
      table: "c2c_msg_table",
      id: "9007199254740995",
    };
    expect(comparePositions(lower, upper)).toBeLessThan(0);
    const active = beginScan({ v: 1, after: null, upper: null }, upper);
    const advanced = advanceCursor(active, lower);
    expect(parseCursor(serializeCursor(advanced)).cursor.after).toEqual(lower);
  });

  it("rejects unsupported or internally inconsistent cursors", () => {
    expect(() => parseCursor("qqandroid:v2:{}")).toThrowError(
      expect.objectContaining({ code: "QQ_ANDROID_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        after: { kind: "contact", id: "200" },
        upper: { kind: "contact", id: "100" },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "QQ_ANDROID_CURSOR_INVALID" }),
    );
  });
});

describe("messaging-qq SQLite exact identifiers", () => {
  it("reads message IDs beyond Number.MAX_SAFE_INTEGER as text", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-db-"));
    const dbPath = path.join(tmpDir, "12345.db");
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE mr_friend_TEST_New (
        msgId INTEGER PRIMARY KEY,
        msgtype INTEGER,
        senderuin INTEGER,
        time INTEGER,
        msgData BLOB,
        issend INTEGER,
        frienduin INTEGER,
        troopuin INTEGER
      );
      INSERT INTO mr_friend_TEST_New VALUES (
        9007199254740993,
        -1000,
        999,
        1750000000,
        X'595B',
        0,
        999,
        NULL
      )`,
    );
    db.close();
    const adapter = new QQAdapter({
      account: { qq: "12345" },
      dbPath,
      keyProvider: { getKey: async () => "12" },
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
    const message = raws.find((raw) => raw.kind === "message");

    expect(message.originalId).toBe("qq:message:9007199254740993");
    expect(message.payload.msgId).toBe("9007199254740993");
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });

  it("lets Registry event limits advance across the SQLite snapshot", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-registry-"));
    const dbPath = path.join(tmpDir, "12345.db");
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE mr_friend_TEST_New (
        msgId INTEGER PRIMARY KEY,
        msgtype INTEGER,
        senderuin INTEGER,
        time INTEGER,
        msgData BLOB,
        issend INTEGER,
        frienduin INTEGER,
        troopuin INTEGER
      );
      INSERT INTO mr_friend_TEST_New VALUES
        (9007199254740993, -1000, 999, 1750000001, X'595B', 0, 999, NULL),
        (9007199254740995, -1000, 999, 1750000002, X'595B', 0, 999, NULL),
        (9007199254740997, -1000, 999, 1750000003, X'595B', 0, 999, NULL)`,
    );
    db.close();
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const adapter = new QQAdapter({
      account: { qq: "12345" },
      dbPath,
      keyProvider: { getKey: async () => "12" },
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
    expect(vault.queryEvents({ adapter: "qq-pc", limit: 10 })).toHaveLength(3);
    expect(parseCursor(reports[2].watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });
});
