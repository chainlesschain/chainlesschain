"use strict";

/**
 * Phase 2a — IM db parser unit cover.
 *
 * Builds real Douyin-shaped sqlite fixtures via better-sqlite3 (Node ABI
 * 127 test path, same as social-bilibili-adb-chromium-cookies-reader.test.js).
 * Tests cover:
 *  - msg table happy path + schema-drift column aliases
 *  - SIMPLE_USER table happy path + missing-column tolerance
 *  - Empty db / missing table → diagnostic.hadXxxTable=false
 *  - Time normalization: seconds / ms / microseconds
 *  - Content blob: JSON {text} / nested .content.text / plain string
 *  - limitMessages / limitContacts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  parseImDb,
  _internals,
} = require("../../lib/adapters/social-douyin-adb/im-db-parser");

let tmpDir;
let dbPath;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cc-douyin-im-test-"));
  dbPath = join(tmpDir, "test_im.db");
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) {
    // ignore
  }
});

function buildMsgFixture(rows, columnOverrides = {}) {
  const senderCol = columnOverrides.senderCol || "sender";
  const timeCol = columnOverrides.timeCol || "created_time";
  const contentCol = columnOverrides.contentCol || "content";
  const convCol = columnOverrides.convCol || "conversation_id";
  const readCol = columnOverrides.readCol || "read_status";
  const db = new Database(dbPath);
  db.exec(
    `CREATE TABLE msg(${senderCol} INTEGER, ${timeCol} INTEGER, ${contentCol} TEXT, ${convCol} TEXT, ${readCol} INTEGER);`,
  );
  const insert = db.prepare(
    `INSERT INTO msg(${senderCol}, ${timeCol}, ${contentCol}, ${convCol}, ${readCol}) VALUES(?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    insert.run(
      r.sender || 0,
      r.time || 0,
      r.content || "",
      r.convId || "",
      r.read || 0,
    );
  }
  db.close();
}

function buildSimpleUserFixture(rows) {
  const db = new Database(dbPath, { fileMustExist: false });
  // Open in CREATE mode if not yet
  db.exec(`CREATE TABLE IF NOT EXISTS SIMPLE_USER(
    UID INTEGER, short_id INTEGER, name TEXT, avatar_url TEXT, follow_status INTEGER
  );`);
  const insert = db.prepare(
    "INSERT INTO SIMPLE_USER(UID, short_id, name, avatar_url, follow_status) VALUES(?, ?, ?, ?, ?)",
  );
  for (const r of rows) {
    insert.run(
      r.uid || 0,
      r.shortId || 0,
      r.name || "",
      r.avatar || "",
      r.follow || 0,
    );
  }
  db.close();
}

// ─── internals ──────────────────────────────────────────────────────────

describe("_internals.normalizeEpochMs", () => {
  it("treats seconds as seconds (× 1000)", () => {
    expect(_internals.normalizeEpochMs(1716383021)).toBe(1716383021000);
  });

  it("treats milliseconds verbatim", () => {
    expect(_internals.normalizeEpochMs(1716383021000)).toBe(1716383021000);
  });

  it("treats microseconds (× 1000 epoch) as µs / 1000", () => {
    expect(_internals.normalizeEpochMs(1716383021000000)).toBe(1716383021000);
  });

  it("rejects zero / negative / non-number", () => {
    expect(_internals.normalizeEpochMs(0)).toBe(null);
    expect(_internals.normalizeEpochMs(-1)).toBe(null);
    expect(_internals.normalizeEpochMs(NaN)).toBe(null);
    expect(_internals.normalizeEpochMs(null)).toBe(null);
    expect(_internals.normalizeEpochMs("123")).toBe(null);
  });
});

describe("_internals.extractTextFromContent", () => {
  it("parses {text:'...'} JSON", () => {
    expect(_internals.extractTextFromContent('{"text":"hi"}')).toBe("hi");
  });

  it("parses nested {content:{text:'...'}} JSON", () => {
    expect(
      _internals.extractTextFromContent('{"content":{"text":"nested"}}'),
    ).toBe("nested");
  });

  it("returns raw string when not valid JSON", () => {
    expect(_internals.extractTextFromContent("legacy plaintext")).toBe(
      "legacy plaintext",
    );
  });

  it("returns null for empty / non-string", () => {
    expect(_internals.extractTextFromContent("")).toBe(null);
    expect(_internals.extractTextFromContent(null)).toBe(null);
    expect(_internals.extractTextFromContent(undefined)).toBe(null);
  });

  it("returns null when JSON parses but no text field", () => {
    expect(_internals.extractTextFromContent('{"type":"sticker"}')).toBe(null);
  });
});

describe("_internals.pickCol", () => {
  it("returns first matching column", () => {
    const cols = new Set(["created_time", "sender", "content"]);
    expect(_internals.pickCol(cols, ["create_time", "created_time"])).toBe(
      "created_time",
    );
  });

  it("returns null when no candidate matches", () => {
    const cols = new Set(["a", "b"]);
    expect(_internals.pickCol(cols, ["c", "d"])).toBe(null);
  });
});

// ─── msg table happy path ───────────────────────────────────────────────

describe("parseImDb — msg table", () => {
  it("parses canonical msg rows", () => {
    buildMsgFixture([
      {
        sender: 9007199254740991,
        time: 1716383021000,
        content: '{"text":"hello"}',
        convId: "conv-A",
        read: 1,
      },
      {
        sender: 8007199254740991,
        time: 1716383022000,
        content: '{"text":"hi back"}',
        convId: "conv-A",
        read: 0,
      },
    ]);
    const result = parseImDb(dbPath);
    expect(result.diagnostic.hadMsgTable).toBe(true);
    expect(result.diagnostic.messageCount).toBe(2);
    expect(result.messages).toHaveLength(2);
    // Sorted DESC by time
    expect(result.messages[0].text).toBe("hi back");
    expect(result.messages[1].text).toBe("hello");
    expect(result.messages[0].conversationId).toBe("conv-A");
    expect(result.messages[0].readStatus).toBe(0);
  });

  it("normalizes time to ms regardless of original unit", () => {
    buildMsgFixture([
      { sender: 1, time: 1716383021, content: '{"text":"seconds"}' },
    ]);
    const result = parseImDb(dbPath);
    expect(result.messages[0].createdTimeMs).toBe(1716383021000);
  });

  it("preserves contentBlob even when text extracts to null", () => {
    buildMsgFixture([
      { sender: 1, time: 1716383021000, content: '{"type":"sticker"}' },
    ]);
    const result = parseImDb(dbPath);
    expect(result.messages[0].text).toBe(null);
    expect(result.messages[0].contentBlob).toBe('{"type":"sticker"}');
  });

  it("respects limitMessages", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      sender: i,
      time: 1716383021000 + i,
      content: `{"text":"msg-${i}"}`,
    }));
    buildMsgFixture(rows);
    const result = parseImDb(dbPath, { limitMessages: 10 });
    expect(result.messages).toHaveLength(10);
  });

  it("handles schema-drift column names (create_time / from_user_id)", () => {
    buildMsgFixture(
      [
        {
          sender: 9007199254740991,
          time: 1716383021,
          content: '{"text":"hi"}',
          convId: "c",
        },
      ],
      {
        senderCol: "from_user_id",
        timeCol: "create_time",
        contentCol: "message_content",
        convCol: "conv_id",
      },
    );
    const result = parseImDb(dbPath);
    expect(result.diagnostic.hadMsgTable).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("hi");
    expect(result.messages[0].conversationId).toBe("c");
  });

  it("returns empty messages array when msg table absent", () => {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE unrelated(x INTEGER);");
    db.close();
    const result = parseImDb(dbPath);
    expect(result.messages).toEqual([]);
    expect(result.diagnostic.hadMsgTable).toBe(false);
  });
});

// ─── SIMPLE_USER table ──────────────────────────────────────────────────

describe("parseImDb — SIMPLE_USER table", () => {
  it("parses canonical contact rows", () => {
    buildSimpleUserFixture([
      { uid: 111, shortId: 222, name: "Alice", avatar: "https://a.png", follow: 1 },
      { uid: 333, shortId: 444, name: "Bob", avatar: "https://b.png", follow: 2 },
    ]);
    const result = parseImDb(dbPath);
    expect(result.diagnostic.hadSimpleUserTable).toBe(true);
    expect(result.diagnostic.contactCount).toBe(2);
    expect(result.contacts[0].name).toBe("Alice");
    expect(result.contacts[0].followStatus).toBe(1);
    expect(result.contacts[1].followStatus).toBe(2);
  });

  it("returns empty when SIMPLE_USER table absent", () => {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE msg(x INTEGER);");
    db.close();
    const result = parseImDb(dbPath);
    expect(result.contacts).toEqual([]);
    expect(result.diagnostic.hadSimpleUserTable).toBe(false);
  });

  it("respects limitContacts", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      uid: i + 1,
      shortId: i,
      name: `user-${i}`,
    }));
    buildSimpleUserFixture(rows);
    const result = parseImDb(dbPath, { limitContacts: 7 });
    expect(result.contacts).toHaveLength(7);
  });
});

// ─── Combined / empty ───────────────────────────────────────────────────

describe("parseImDb — combined diagnostics", () => {
  it("handles both tables present", () => {
    buildMsgFixture([
      { sender: 1, time: 1716383021000, content: '{"text":"hi"}' },
    ]);
    buildSimpleUserFixture([{ uid: 999, name: "x" }]);
    const result = parseImDb(dbPath);
    expect(result.diagnostic.hadMsgTable).toBe(true);
    expect(result.diagnostic.hadSimpleUserTable).toBe(true);
    expect(result.messages.length + result.contacts.length).toBe(2);
  });

  it("rejects non-string / empty dbPath", () => {
    expect(() => parseImDb("")).toThrow(TypeError);
    expect(() => parseImDb(null)).toThrow(TypeError);
  });
});
