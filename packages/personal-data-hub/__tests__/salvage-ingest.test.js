"use strict";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");
const {
  buildSalvageEvents,
  salvageDumpToVault,
  resolveApp,
} = require("../lib/forensics/salvage-ingest");

// Build a real SQLite DB and treat its bytes as a memory dump; verify the
// generic salvage→vault path recovers messages AND tags them with the correct
// per-app source.adapter (multi-app de-silo). Real LocalVault → proves the
// hand-built events pass schema validation + are searchable.
describe("salvage-ingest — generic multi-app salvage → vault", () => {
  let dir, dumpPath, vault, vdir;
  const COLUMNS = ["msg_uuid", "conversation_id", "sender", "content", "created_time"];

  beforeAll(() => {
    const Database = require("better-sqlite3-multiple-ciphers");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "salvage-ing-"));
    dumpPath = path.join(dir, "u.db");
    const db = new Database(dumpPath);
    db.exec("CREATE TABLE msg(msg_uuid TEXT, conversation_id TEXT, sender INTEGER, content TEXT, created_time INTEGER)");
    const ins = db.prepare("INSERT INTO msg VALUES(?,?,?,?,?)");
    ins.run("u1", "conv-1", 111, "今天的会议改到下午三点 hi", 1700000000000);
    ins.run("u2", "conv-1", 222, "收到 👌", 1700000001000);
    db.close();

    vdir = fs.mkdtempSync(path.join(os.tmpdir(), "salvage-vault-"));
    vault = new LocalVault({ path: path.join(vdir, "v.db"), key: generateKeyHex() });
    vault.open();
  });

  afterAll(() => {
    try { vault.close(); } catch (_e) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
    try { fs.rmSync(vdir, { recursive: true, force: true }); } catch (_e) {}
  });

  it("resolveApp maps known apps to canonical source adapters; unknown → salvage:<app>", () => {
    expect(resolveApp("douyin").sourceAdapter).toBe("social-douyin");
    expect(resolveApp("toutiao").sourceAdapter).toBe("social-toutiao");
    expect(resolveApp("wechat").sourceAdapter).toBe("wechat");
    expect(resolveApp("kuaishou").sourceAdapter).toBe("social-kuaishou");
    expect(resolveApp("bogusapp").sourceAdapter).toBe("salvage:bogusapp");
  });

  it("buildSalvageEvents tags per-app source + builds valid message events", () => {
    const recs = [{ rowid: "1", cols: ["u1", "conv-1", 111, "hello 世界", 1700000000000] }];
    const built = buildSalvageEvents(recs, { app: "toutiao", columns: COLUMNS, now: 1700000099000 });
    expect(built.events.length).toBe(1);
    const e = built.events[0];
    expect(e.source.adapter).toBe("social-toutiao");
    expect(e.source.capturedBy).toBe("sqlite"); // schema enum; provenance in extra.salvaged
    expect(e.subtype).toBe("message");
    expect(e.content.text).toBe("hello 世界");
    expect(e.extra.platform).toBe("toutiao");
    expect(e.extra.salvaged).toBe(true);
  });

  it("salvageDumpToVault ingests with douyin source + events are searchable", () => {
    const r = salvageDumpToVault(vault, dumpPath, { app: "douyin", columns: COLUMNS, now: 1700000099000 });
    expect(r.app).toBe("douyin");
    expect(r.sourceAdapter).toBe("social-douyin");
    expect(r.ingested).toBe(2);
    // events landed under the correct source + are searchable
    const events = vault.queryEvents({ limit: 100 }) || [];
    const douyin = events.filter((e) => e.source && e.source.adapter === "social-douyin");
    expect(douyin.length).toBe(2);
    const texts = douyin.map((e) => e.content && e.content.text).sort();
    expect(texts).toContain("收到 👌"); // UTF-8 emoji survives
  });

  it("same dump under a different app tags a different source (no cross-attribution)", () => {
    const r = salvageDumpToVault(vault, dumpPath, { app: "toutiao", columns: COLUMNS, now: 1700000099000 });
    expect(r.sourceAdapter).toBe("social-toutiao");
    expect(r.ingested).toBe(2);
    const events = vault.queryEvents({ limit: 100 }) || [];
    expect(events.filter((e) => e.source && e.source.adapter === "social-toutiao").length).toBe(2);
    // douyin events from prior test remain distinct
    expect(events.filter((e) => e.source && e.source.adapter === "social-douyin").length).toBe(2);
  });

  it("re-ingesting the same dump dedups (stable originalId)", () => {
    const before = (vault.queryEvents({ limit: 200 }) || []).length;
    salvageDumpToVault(vault, dumpPath, { app: "douyin", columns: COLUMNS, now: 1700000099000 });
    const after = (vault.queryEvents({ limit: 200 }) || []).length;
    expect(after).toBe(before); // ON CONFLICT(source_adapter, source_original_id) updates, no dupes
  });
});
