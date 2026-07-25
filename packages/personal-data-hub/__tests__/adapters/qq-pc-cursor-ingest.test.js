"use strict";

import { afterEach, describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { QQPcAdapter } = require("../../lib/adapters/qq-pc");
const { readQqNtCursorPage } = require("../../lib/adapters/qq-pc/nt-db-reader");
const { parseCursor } = require("../../lib/qq-nt/scan-cursor");

function sidecarMessage(kind, messageId) {
  return {
    kind,
    tableName: kind === "group" ? "group_msg_table" : "c2c_msg_table",
    messageId,
    sequence: messageId,
    peer: kind === "group" ? "20002" : "10001",
    senderUin: "30003",
    createTime: 1_750_000_000 + Number(messageId),
    text: `${kind}-${messageId}`,
    originalId: `qq-pc:${kind}:raw:${messageId}`,
  };
}

function compareDecimal(left, right) {
  return left.length === right.length
    ? left.localeCompare(right)
    : left.length - right.length;
}

function pagedCollector() {
  let calls = 0;
  const collect = async (options) => {
    calls += 1;
    const currentUpper =
      calls === 1 ? { c2c: "3", group: "4" } : { c2c: "9", group: "8" };
    const frozenUpper = options.page.upper || currentUpper;
    const all = {
      c2c: ["1", "3", "5", "7", "9"],
      group: ["2", "4", "6", "8"],
    };
    const messages = [];
    const hasMore = {};
    for (const stream of ["c2c", "group"]) {
      const candidates = all[stream].filter(
        (id) =>
          (options.page.after[stream] === null ||
            compareDecimal(id, options.page.after[stream]) > 0) &&
          compareDecimal(id, frozenUpper[stream]) <= 0,
      );
      hasMore[stream] = candidates.length > options.limit;
      for (const id of candidates.slice(0, options.limit)) {
        messages.push(sidecarMessage(stream, id));
      }
    }
    return {
      messages,
      upperBounds: currentUpper,
      hasMore,
    };
  };
  collect.calls = () => calls;
  return collect;
}

async function collect(iterable) {
  const rows = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

let tmpDir;

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

describe("QQPcAdapter explicit scan cursor", () => {
  it("freezes uppers and resumes the fair c2c/group scan without gaps", async () => {
    const qqCollector = pagedCollector();
    const adapter = new QQPcAdapter({ qqCollector });
    let watermark;

    const first = await collect(
      adapter.sync({
        passphrase: "test-passphrase",
        limit: 2,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    expect(first.map((raw) => raw.payload.messageId)).toEqual(["1", "2"]);
    expect(parseCursor(watermark).cursor).toMatchObject({
      next: "c2c",
      after: { c2c: "1", group: "2" },
      scan: { upper: { c2c: "3", group: "4" } },
    });

    let secondWatermark;
    const second = await collect(
      adapter.sync({
        passphrase: "test-passphrase",
        limit: 2,
        sinceWatermark: watermark,
        updateWatermark(value) {
          secondWatermark = value;
        },
      }),
    );

    expect(second.map((raw) => raw.payload.messageId)).toEqual(["3", "4"]);
    expect(parseCursor(secondWatermark).cursor).toEqual({
      v: 1,
      next: "c2c",
      after: { c2c: "3", group: "4" },
      scan: null,
    });
    expect(qqCollector.calls()).toBe(2);
  });

  it("fails closed when the source omits completion evidence", async () => {
    const adapter = new QQPcAdapter({
      qqCollector: async () => ({
        messages: [],
        upperBounds: { c2c: null, group: null },
      }),
    });
    const updateWatermark = vi.fn();

    await expect(
      collect(
        adapter.sync({
          passphrase: "test-passphrase",
          updateWatermark,
        }),
      ),
    ).rejects.toMatchObject({ code: "QQNT_CURSOR_PAGE_INVALID" });
    expect(updateWatermark).not.toHaveBeenCalled();
  });

  it("fails closed when an active source boundary regresses", async () => {
    const qqCollector = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [sidecarMessage("c2c", "1"), sidecarMessage("group", "2")],
        upperBounds: { c2c: "3", group: "4" },
        hasMore: { c2c: true, group: true },
      })
      .mockResolvedValueOnce({
        messages: [],
        upperBounds: { c2c: "2", group: "4" },
        hasMore: { c2c: false, group: false },
      });
    const adapter = new QQPcAdapter({ qqCollector });
    let watermark;
    await collect(
      adapter.sync({
        passphrase: "test-passphrase",
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    const updateWatermark = vi.fn();

    await expect(
      collect(
        adapter.sync({
          passphrase: "test-passphrase",
          limit: 1,
          sinceWatermark: watermark,
          updateWatermark,
        }),
      ),
    ).rejects.toMatchObject({ code: "QQNT_CURSOR_PAGE_INVALID" });
    expect(updateWatermark).not.toHaveBeenCalled();
  });
});

describe("QQ NT direct reader keyset page", () => {
  it("returns exact frozen boundaries, ordered rows, and hasMore evidence", () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-qq-cursor-db-"));
    const dbPath = path.join(tmpDir, "nt_msg.db");
    const db = new Database(dbPath);
    for (const table of ["c2c_msg_table", "group_msg_table"]) {
      db.exec(
        `CREATE TABLE ${table} (
          "40001" INTEGER PRIMARY KEY,
          "40003" INTEGER,
          "40050" INTEGER,
          "40800" TEXT
        )`,
      );
    }
    db.exec(
      `INSERT INTO c2c_msg_table VALUES
        (1, 10, 1700000001, 'c2c-1'),
        (3, 30, 1700000003, 'c2c-3');
       INSERT INTO group_msg_table VALUES
        (2, 20, 1700000002, 'group-2')`,
    );
    db.close();

    const first = readQqNtCursorPage(dbPath, {
      _databaseClass: Database,
      limit: 1,
      after: { c2c: null, group: null },
    });

    expect(first.upperBounds).toEqual({ c2c: "3", group: "2" });
    expect(first.messages.c2c.map((message) => message.messageId)).toEqual([
      "1",
    ]);
    expect(first.messages.group.map((message) => message.messageId)).toEqual([
      "2",
    ]);
    expect(first.hasMore).toEqual({ c2c: true, group: false });

    const advancedDb = new Database(dbPath);
    advancedDb.exec(
      `INSERT INTO c2c_msg_table VALUES (5, 50, 1700000005, 'c2c-5');
       INSERT INTO group_msg_table VALUES (4, 40, 1700000004, 'group-4')`,
    );
    advancedDb.close();

    const second = readQqNtCursorPage(dbPath, {
      _databaseClass: Database,
      limit: 1,
      after: { c2c: "1", group: "2" },
      upper: first.upperBounds,
    });
    expect(second.messages.c2c.map((message) => message.messageId)).toEqual([
      "3",
    ]);
    expect(second.messages.group).toEqual([]);
    expect(second.hasMore).toEqual({ c2c: false, group: false });
    expect(second.upperBounds).toEqual({ c2c: "5", group: "4" });
  });
});
