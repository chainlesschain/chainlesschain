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

  it("keyset-pages beyond the former 1000-message table cap", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-page-"));
    const dbPath = path.join(tmpDir, "12345.db");
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE mr_friend_LARGE_New (
        msgId INTEGER PRIMARY KEY,
        msgtype INTEGER,
        senderuin INTEGER,
        time INTEGER,
        msgData BLOB,
        issend INTEGER,
        frienduin INTEGER,
        troopuin INTEGER
      );
      WITH RECURSIVE seq(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM seq WHERE value < 1505
      )
      INSERT INTO mr_friend_LARGE_New
      SELECT
        value,
        -1000,
        999,
        1750000000 + value,
        X'595B',
        0,
        999,
        NULL
      FROM seq`,
    );
    db.close();
    const adapter = new QQAdapter({
      account: { qq: "12345" },
      dbPath,
      keyProvider: { getKey: async () => "12" },
      dbDriverFactory: () => Database,
    });
    let watermark;

    const first = await collect(
      adapter.sync({
        limit: 1200,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(first).toHaveLength(1200);
    expect(first[0].payload.msgId).toBe("1");
    expect(first[1199].payload.msgId).toBe("1200");
    expect(parseCursor(watermark).cursor).toMatchObject({
      after: {
        kind: "message",
        table: "mr_friend_LARGE_New",
        id: "1200",
      },
      upper: {
        kind: "message",
        table: "mr_friend_LARGE_New",
        id: "1505",
      },
    });

    const second = await collect(
      adapter.sync({
        limit: 1200,
        sinceWatermark: watermark,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(second).toHaveLength(305);
    expect(second[0].payload.msgId).toBe("1201");
    expect(second[304].payload.msgId).toBe("1505");
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });

  it("fails closed when an active message boundary regresses", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-regress-"));
    const dbPath = path.join(tmpDir, "12345.db");
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE mr_friend_REGRESS_New (
        msgId INTEGER PRIMARY KEY,
        msgtype INTEGER,
        senderuin INTEGER,
        time INTEGER,
        msgData BLOB,
        issend INTEGER,
        frienduin INTEGER,
        troopuin INTEGER
      );
      INSERT INTO mr_friend_REGRESS_New VALUES
        (1, -1000, 999, 1750000001, X'595B', 0, 999, NULL),
        (2, -1000, 999, 1750000002, X'595B', 0, 999, NULL),
        (3, -1000, 999, 1750000003, X'595B', 0, 999, NULL)`,
    );
    db.close();
    const adapter = new QQAdapter({
      account: { qq: "12345" },
      dbPath,
      keyProvider: { getKey: async () => "12" },
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
    changed.exec("DELETE FROM mr_friend_REGRESS_New WHERE msgId > 1");
    changed.close();

    await expect(
      collect(
        adapter.sync({
          limit: 1,
          sinceWatermark: watermark,
          updateWatermark(value) {
            watermark = value;
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "QQ_ANDROID_CURSOR_SOURCE_REGRESSED",
      retryable: false,
    });
  });

  it("fails closed when the newest discovered message shard is unreadable", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-upper-"));
    const dbPath = path.join(tmpDir, "12345.db");
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE mr_friend_A_New (
        msgId INTEGER PRIMARY KEY,
        msgtype INTEGER,
        senderuin INTEGER,
        time INTEGER,
        msgData BLOB,
        issend INTEGER,
        frienduin INTEGER,
        troopuin INTEGER
      );
      INSERT INTO mr_friend_A_New VALUES
        (1, -1000, 999, 1750000001, X'595B', 0, 999, NULL);
      CREATE TABLE mr_friend_Z_New (legacy_id INTEGER PRIMARY KEY);
      INSERT INTO mr_friend_Z_New VALUES (2)`,
    );
    db.close();
    const adapter = new QQAdapter({
      account: { qq: "12345" },
      dbPath,
      keyProvider: { getKey: async () => "12" },
      dbDriverFactory: () => Database,
    });

    await expect(collect(adapter.sync({}))).rejects.toMatchObject({
      code: "QQ_ANDROID_CURSOR_SOURCE_REGRESSED",
      retryable: false,
      message: expect.stringContaining("mr_friend_Z_New"),
    });
  });

  it("fails closed instead of skipping an unreadable intermediate message shard", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-shard-"));
    const dbPath = path.join(tmpDir, "12345.db");
    const db = new Database(dbPath);
    for (const table of ["mr_friend_A_New", "mr_friend_C_New"]) {
      db.exec(
        `CREATE TABLE ${table} (
          msgId INTEGER PRIMARY KEY,
          msgtype INTEGER,
          senderuin INTEGER,
          time INTEGER,
          msgData BLOB,
          issend INTEGER,
          frienduin INTEGER,
          troopuin INTEGER
        )`,
      );
    }
    db.exec(
      `INSERT INTO mr_friend_A_New VALUES
        (1, -1000, 999, 1750000001, X'595B', 0, 999, NULL);
      CREATE TABLE mr_friend_B_New (legacy_id INTEGER PRIMARY KEY);
      INSERT INTO mr_friend_B_New VALUES (2);
      INSERT INTO mr_friend_C_New VALUES
        (3, -1000, 999, 1750000003, X'595B', 0, 999, NULL)`,
    );
    db.close();
    const adapter = new QQAdapter({
      account: { qq: "12345" },
      dbPath,
      keyProvider: { getKey: async () => "12" },
      dbDriverFactory: () => Database,
    });

    await expect(collect(adapter.sync({}))).rejects.toMatchObject({
      code: "QQ_ANDROID_CURSOR_SOURCE_REGRESSED",
      retryable: false,
      message: expect.stringContaining("mr_friend_B_New"),
    });
  });

  it("resumes across lexicographically ordered message shards", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-shards-"));
    const dbPath = path.join(tmpDir, "12345.db");
    const db = new Database(dbPath);
    for (const table of ["mr_friend_A_New", "mr_friend_B_New"]) {
      db.exec(
        `CREATE TABLE ${table} (
          msgId INTEGER PRIMARY KEY,
          msgtype INTEGER,
          senderuin INTEGER,
          time INTEGER,
          msgData BLOB,
          issend INTEGER,
          frienduin INTEGER,
          troopuin INTEGER
        )`,
      );
    }
    db.exec(
      `INSERT INTO mr_friend_A_New VALUES
        (1, -1000, 999, 1750000001, X'595B', 0, 999, NULL),
        (2, -1000, 999, 1750000002, X'595B', 0, 999, NULL);
      INSERT INTO mr_friend_B_New VALUES
        (3, -1000, 999, 1750000003, X'595B', 0, 999, NULL),
        (4, -1000, 999, 1750000004, X'595B', 0, 999, NULL)`,
    );
    db.close();
    const adapter = new QQAdapter({
      account: { qq: "12345" },
      dbPath,
      keyProvider: { getKey: async () => "12" },
      dbDriverFactory: () => Database,
    });
    let watermark;

    const first = await collect(
      adapter.sync({
        limit: 3,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(first.map((raw) => [raw.payload._table, raw.payload.msgId])).toEqual(
      [
        ["mr_friend_A_New", "1"],
        ["mr_friend_A_New", "2"],
        ["mr_friend_B_New", "3"],
      ],
    );
    expect(parseCursor(watermark).cursor.after).toEqual({
      kind: "message",
      table: "mr_friend_B_New",
      id: "3",
    });

    const second = await collect(
      adapter.sync({
        limit: 3,
        sinceWatermark: watermark,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(
      second.map((raw) => [raw.payload._table, raw.payload.msgId]),
    ).toEqual([["mr_friend_B_New", "4"]]);
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });

  it("continues from contacts into groups when no message shard exists", async () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-android-meta-"));
    const dbPath = path.join(tmpDir, "12345.db");
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE Friends (
        uin INTEGER PRIMARY KEY,
        name TEXT
      );
      INSERT INTO Friends VALUES (100, 'A'), (200, 'B');
      CREATE TABLE TroopInfoV2 (
        troopuin INTEGER PRIMARY KEY,
        troopname TEXT,
        membernum INTEGER,
        troopowneruin INTEGER
      );
      INSERT INTO TroopInfoV2 VALUES
        (300, 'G1', 10, 100),
        (400, 'G2', 20, 200)`,
    );
    db.close();
    const adapter = new QQAdapter({
      account: { qq: "12345" },
      dbPath,
      keyProvider: { getKey: async () => "12" },
      dbDriverFactory: () => Database,
    });
    let watermark;

    const first = await collect(
      adapter.sync({
        limit: 3,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(
      first.map((raw) => [raw.kind, raw.payload.uin || raw.payload.troopUin]),
    ).toEqual([
      ["contact", "100"],
      ["contact", "200"],
      ["group", "300"],
    ]);
    expect(parseCursor(watermark).cursor.after).toEqual({
      kind: "group",
      id: "300",
    });

    const second = await collect(
      adapter.sync({
        limit: 3,
        sinceWatermark: watermark,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    expect(second.map((raw) => [raw.kind, raw.payload.troopUin])).toEqual([
      ["group", "400"],
    ]);
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      after: null,
      upper: null,
    });
  });
});
