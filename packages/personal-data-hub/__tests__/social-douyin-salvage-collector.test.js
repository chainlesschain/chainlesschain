"use strict";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  salvageDumpToSnapshot,
  salvageAndSync,
} = require("../lib/adapters/social-douyin-adb/collector");

// Build a real (UTF-8) SQLite DB via the SQLCipher-capable driver and treat its
// raw bytes as a "memory dump" — proving the salvage → snapshot → ingest path
// recovers message rows with no key (the Method-B capstone). The msg-table
// column order matches the device-verified Douyin IM schema.
describe("social-douyin-adb salvage collector", () => {
  let dir, dbPath;
  const COLUMNS = ["msg_uuid", "conversation_id", "sender", "content", "created_time"];

  beforeAll(() => {
    const Database = require("better-sqlite3-multiple-ciphers");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "salvage-col-"));
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
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  });

  it("salvageDumpToSnapshot recovers msg rows → snapshot JSON (explicit columns)", () => {
    const res = salvageDumpToSnapshot(dbPath, {
      uid: "1234567890123456789",
      columns: COLUMNS,
      now: () => 1700000099000,
    });
    expect(res.uid).toBe("1234567890123456789");
    expect(res.eventCounts.message).toBe(3);
    expect(res.salvage.recordsSalvaged).toBeGreaterThanOrEqual(3);

    const snap = JSON.parse(fs.readFileSync(res.snapshotPath, "utf-8"));
    const msgs = snap.events.filter((e) => e.kind === "message");
    expect(msgs.length).toBe(3);
    const texts = msgs.map((m) => m.text).sort();
    expect(texts).toContain("你好呀 hello");
    expect(texts).toContain("ok 👍"); // UTF-8 emoji survives
    const m1 = msgs.find((m) => m.text === "你好呀 hello");
    expect(m1.conversationId).toBe("conv-1");
    expect(m1.senderUid).toBe("111");
    fs.rmSync(res.snapshotPath, { force: true });
  });

  it("infers columns heuristically when none given (content + created_time)", () => {
    const res = salvageDumpToSnapshot(dbPath, { now: () => 1700000099000 });
    expect(res.eventCounts.message).toBe(3);
    const snap = JSON.parse(fs.readFileSync(res.snapshotPath, "utf-8"));
    const texts = snap.events.filter((e) => e.kind === "message").map((m) => m.text);
    expect(texts).toContain("在吗？晚上一起吃饭");
    fs.rmSync(res.snapshotPath, { force: true });
  });

  it("salvageAndSync feeds the snapshot to registry.syncAdapter then cleans up", async () => {
    let captured = null;
    const fakeRegistry = {
      syncAdapter: async (name, opts) => {
        captured = { name, opts };
        // verify the snapshot file exists at sync time
        const snap = JSON.parse(fs.readFileSync(opts.inputPath, "utf-8"));
        return { ingested: snap.events.length, adapter: name, kgTriples: 0, ragDocs: 0 };
      },
    };
    const report = await salvageAndSync(fakeRegistry, dbPath, {
      uid: "1234567890123456789",
      columns: COLUMNS,
    });
    expect(captured.name).toBe("social-douyin");
    expect(report.ingested).toBe(3);
    expect(report.douyin.mode).toBe("salvage");
    expect(report.douyin.eventCounts.message).toBe(3);
    expect(report.douyin.cleanupFailed).toBe(false);
    // snapshot file cleaned up in finally
    expect(fs.existsSync(captured.opts.inputPath)).toBe(false);
  });

  it("throws on missing dumpPath", () => {
    expect(() => salvageDumpToSnapshot("")).toThrow();
  });
});
