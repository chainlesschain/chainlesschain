"use strict";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// The salvager lives in scripts/ (a standalone forensic tool) but exports its
// pure parsers for testing.
const {
  parseLeafPage,
  readVarint,
  serialTypeSize,
} = require("../../../scripts/android/pdh-sqlite-leaf-salvage.js");

// Build a real (UTF-8) SQLite DB via the SQLCipher-capable driver, then salvage
// records straight from its raw page bytes — proving the leaf-page parser reads
// rowids + columns + UTF-8 text correctly (the Method-B reconstruction step for
// scattered/malformed memory dumps). See docs/internal/pdh-db-decryption-runbook.md.
describe("pdh-sqlite-leaf-salvage — leaf-page record salvager", () => {
  let dir, dbPath, buf;
  beforeAll(() => {
    const Database = require("better-sqlite3-multiple-ciphers");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "salvage-"));
    dbPath = path.join(dir, "u.db");
    const db = new Database(dbPath);
    db.exec(
      "CREATE TABLE msg(msg_uuid TEXT, conversation_id TEXT, sender INTEGER, content TEXT, created_time INTEGER)",
    );
    const ins = db.prepare("INSERT INTO msg VALUES(?,?,?,?,?)");
    ins.run("uuid-1", "conv-1", 111, "你好呀 hello", 1700000000000);
    ins.run("uuid-2", "conv-1", 222, "在吗？晚上一起吃饭", 1700000001000);
    ins.run("uuid-3", "conv-2", 333, "ok 👍", 1700000002000);
    db.close();
    buf = fs.readFileSync(dbPath);
  });
  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  });

  it("varint + serialTypeSize basics", () => {
    expect(readVarint(Buffer.from([0x01]), 0)[0]).toBe(1n);
    expect(readVarint(Buffer.from([0x81, 0x00]), 0)[0]).toBe(128n);
    expect(serialTypeSize(1n)).toBe(1); // 1-byte int
    expect(serialTypeSize(6n)).toBe(8); // 8-byte int
    expect(serialTypeSize(13n)).toBe(0); // text len 0
    expect(serialTypeSize(0x29n)).toBe(14); // text serial 41 → 14 bytes
  });

  it("salvages all 3 msg rows with correct columns + UTF-8 text", () => {
    const PAGE = 4096;
    const records = [];
    for (let base = 0; base + PAGE <= buf.length; base += PAGE) {
      const recs = parseLeafPage(buf, base, PAGE, 3);
      if (recs) records.push(...recs);
    }
    // find the msg rows (5 cols, content is the 4th)
    const msgRows = records.filter((r) => r.cols.length === 5);
    expect(msgRows.length).toBe(3);
    const byUuid = Object.fromEntries(msgRows.map((r) => [r.cols[0], r]));
    expect(byUuid["uuid-1"].cols[2]).toBe(111); // sender int
    expect(byUuid["uuid-1"].cols[3]).toBe("你好呀 hello"); // UTF-8 intact
    expect(byUuid["uuid-2"].cols[3]).toBe("在吗？晚上一起吃饭");
    expect(byUuid["uuid-2"].cols[4]).toBe(1700000001000); // created_time
    expect(byUuid["uuid-3"].cols[3]).toBe("ok 👍"); // emoji (4-byte UTF-8)
  });

  it("finds a leaf page at a NON-4096-aligned offset (unaligned scan)", () => {
    const PAGE = 4096;
    // locate a real data leaf page on the aligned grid
    let leaf = null;
    for (let base = 0; base + PAGE <= buf.length; base += PAGE) {
      const recs = parseLeafPage(buf, base, PAGE, 3);
      if (recs && recs.some((r) => r.cols.length === 5)) { leaf = buf.slice(base, base + PAGE); break; }
    }
    expect(leaf).not.toBeNull();
    // embed it at a 512-aligned-but-not-4096-aligned offset inside a zero buffer
    const big = Buffer.alloc(PAGE * 4, 0);
    const off = 512 * 3; // 1536: hit by stride-512, missed by stride-4096
    leaf.copy(big, off);
    // aligned 4096-grid misses it
    expect(parseLeafPage(big, 0, PAGE, 3)).toBeNull();
    expect(parseLeafPage(big, PAGE, PAGE, 3)).toBeNull();
    // unaligned stride finds it at its true offset
    const recs = parseLeafPage(big, off, PAGE, 3);
    expect(recs).not.toBeNull();
    expect(recs.some((r) => r.cols[0] === "uuid-1")).toBe(true);
  });

  it("returns null for non-leaf / garbage pages", () => {
    const garbage = Buffer.alloc(4096, 0xff);
    expect(parseLeafPage(garbage, 0, 4096, 3)).toBeNull();
    const zeros = Buffer.alloc(4096, 0);
    expect(parseLeafPage(zeros, 0, 4096, 3)).toBeNull();
  });
});
