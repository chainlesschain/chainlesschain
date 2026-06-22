"use strict";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");
const {
  ingestPlaintextDb,
  readable,
  normTime,
} = require("../lib/forensics/plaintext-db-collect");

// Build a real PLAINTEXT SQLite db (an app's browse/content store) and verify the
// generic ingester turns its readable rows into events that PASS real LocalVault
// schema validation and survive ingestion WITHOUT collapsing rows of one table
// into a single vault row. Regression for two shipped bugs:
//   1. subtype:"record" — not a schema enum → every putEvent threw → 0 ingested.
//   2. source.originalId = "<db>:<table>" (per-table, not per-row) → the vault's
//      UNIQUE(source_adapter, source_original_id) collapsed every row into one.
describe("plaintext-db-collect — generic plaintext db → vault", () => {
  let dir, dbPath, vault, vdir;

  beforeAll(() => {
    const Database = require("better-sqlite3-multiple-ciphers");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ptdb-"));
    dbPath = path.join(dir, "news_article.db");
    const db = new Database(dbPath);
    // A content table with readable CJK text + a time column, plus noise columns.
    db.exec(
      "CREATE TABLE article(id INTEGER PRIMARY KEY, title TEXT, url TEXT, created_time INTEGER)",
    );
    const ins = db.prepare("INSERT INTO article VALUES(?,?,?,?)");
    ins.run(1, "今天的头条新闻标题一", "https://example.com/a1", 1700000000000);
    ins.run(2, "今天的头条新闻标题二", "https://example.com/a2", 1700000001000);
    ins.run(3, "今天的头条新闻标题三", "https://example.com/a3", 1700000002000);
    // A row whose only text is noise (url) → must be filtered out.
    ins.run(4, "https://only-a-url.example.com/x", "https://x", 1700000003000);
    // A Room-internal table that must be skipped.
    db.exec("CREATE TABLE room_master_table(id INTEGER, identity_hash TEXT)");
    db.prepare("INSERT INTO room_master_table VALUES(?,?)").run(1, "deadbeef");
    db.close();

    vdir = fs.mkdtempSync(path.join(os.tmpdir(), "ptdb-vault-"));
    vault = new LocalVault({ path: path.join(vdir, "v.db"), key: generateKeyHex() });
    vault.open();
  });

  afterAll(() => {
    try { vault.close(); } catch (_e) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
    try { fs.rmSync(vdir, { recursive: true, force: true }); } catch (_e) {}
  });

  it("readable() keeps CJK / enough letters, rejects urls/hashes/short", () => {
    expect(readable("今天天气")).toBe(true);
    expect(readable("hello world")).toBe(true);
    expect(readable("https://x.com/abc")).toBe(false);
    expect(readable("deadbeefdeadbeef")).toBe(false);
    expect(readable("hi")).toBe(false);
    expect(readable(123)).toBe(false);
  });

  it("normTime normalizes s/µs/ns to ms, rejects junk", () => {
    expect(normTime(1700000000)).toBe(1700000000000); // s → ms
    expect(normTime(1700000000000)).toBe(1700000000000); // ms
    expect(normTime(0)).toBe(0);
    expect(normTime("x")).toBe(0);
  });

  it("ingests readable rows as schema-valid events (subtype enum, not 'record')", () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    const events = ingestPlaintextDb(Database, dbPath, "toutiao");
    // 3 readable rows; the url-only row + the room_master_table are filtered.
    expect(events.length).toBe(3);
    for (const ev of events) {
      expect(ev.subtype).toBe("other"); // valid enum, NOT "record"
      expect(ev.source.adapter).toBe("local-toutiao");
      expect(ev.content.text).toMatch(/头条新闻标题/);
    }
  });

  it("every event passes real LocalVault.putEvent (schema validation)", () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    const events = ingestPlaintextDb(Database, dbPath, "toutiao");
    let ok = 0;
    for (const ev of events) {
      vault.putEvent(ev); // throws on invalid → test fails
      ok++;
    }
    expect(ok).toBe(3);
  });

  it("per-row unique source.originalId — rows of one table are NOT collapsed", () => {
    const Database = require("better-sqlite3-multiple-ciphers");
    const events = ingestPlaintextDb(Database, dbPath, "toutiao");
    const oids = new Set(events.map((e) => e.source.originalId));
    const ids = new Set(events.map((e) => e.id));
    expect(oids.size).toBe(events.length); // all distinct
    expect(ids.size).toBe(events.length);
    // After putEvent into a fresh vault, all 3 survive (no UNIQUE collapse).
    const v2dir = fs.mkdtempSync(path.join(os.tmpdir(), "ptdb-v2-"));
    const v2 = new LocalVault({ path: path.join(v2dir, "v.db"), key: generateKeyHex() });
    v2.open();
    for (const ev of events) v2.putEvent(ev);
    const count = v2.db
      .prepare("SELECT COUNT(*) c FROM events WHERE source_adapter='local-toutiao'")
      .get().c;
    v2.close();
    fs.rmSync(v2dir, { recursive: true, force: true });
    expect(count).toBe(3);
  });
});
