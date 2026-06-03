"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  QQAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
  xorDecrypt,
} = require("../lib/adapters/messaging-qq");
const { validateBatch } = require("../lib/batch");

// §Phase 13.5 v0.2 (2026-05-22) — snapshot-mode tests, mirror of
// social-weibo-snapshot.test.js.
//
// Snapshot mode is in-APK Android cc reading JSON written by QQLocalCollector
// (su cp /data/data/com.tencent.mobileqq/databases/<uin>.db + plain SQLite
// open + per-row XOR-with-IMEI decrypt of msgData). Sqlite/device-pull tests
// stay in longtail-adapters.test.js. Both paths share normalize().

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "messaging-qq.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("QQAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qq-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1 + 3 VALID_SNAPSHOT_KINDS", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_SNAPSHOT_KINDS).toEqual(["contact", "group", "message"]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new QQAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new QQAdapter();
    const res = await a.authenticate({ inputPath: path.join(tmpDir, "missing.json") });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with neither inputPath nor dbPath returns NO_INPUT", async () => {
    const a = new QQAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 99,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new QQAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/schemaVersion mismatch/);
  });

  it("empty events array yields nothing (no crash)", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new QQAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("contact + group + message round-trip normalize cleanly", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      account: { qq: "12345", displayName: "alice" },
      events: [
        {
          kind: "contact",
          id: "contact-99999",
          capturedAt: now - 1000,
          uin: "99999",
          nickname: "好友A",
          remark: "工作组",
        },
        {
          kind: "group",
          id: "group-88888",
          capturedAt: now - 2000,
          troopUin: "88888",
          troopName: "测试群",
          memberCount: 30,
          ownerUin: "77777",
        },
        {
          kind: "message",
          id: "msg-m1",
          capturedAt: now - 3000,
          msgId: "m1",
          msgType: -1000,
          senderUin: "99999",
          peerUin: "12345",
          isGroup: false,
          isSend: false,
          text: "你好",
        },
      ],
    });
    const a = new QQAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(3);

    const kinds = raws.map((r) => r.kind);
    expect(kinds).toEqual(["contact", "group", "message"]);

    // Each originalId namespaced under qq:<kind>:<id>
    expect(raws[0].originalId).toMatch(/^qq:contact:/);
    expect(raws[1].originalId).toMatch(/^qq:group:/);
    expect(raws[2].originalId).toMatch(/^qq:message:/);

    // Normalize each + validate
    for (const raw of raws) {
      const batch = a.normalize(raw);
      expect(validateBatch(batch).valid).toBe(true);
    }

    const contactBatch = a.normalize(raws[0]);
    expect(contactBatch.events.length).toBe(0);
    expect(contactBatch.persons.length).toBe(1);
    // remark + nickname + uin all surface as names (priority order)
    expect(contactBatch.persons[0].names).toEqual(["工作组", "好友A", "99999"]);
    expect(contactBatch.persons[0].identifiers["qq-uin"]).toEqual(["99999"]);

    const groupBatch = a.normalize(raws[1]);
    expect(groupBatch.events.length).toBe(0);
    expect(groupBatch.topics.length).toBe(1);
    expect(groupBatch.topics[0].name).toBe("测试群");
    expect(groupBatch.topics[0].extra.troopUin).toBe("88888");
    expect(groupBatch.topics[0].extra.memberCount).toBe(30);

    const msgBatch = a.normalize(raws[2]);
    expect(msgBatch.events.length).toBe(1);
    expect(msgBatch.events[0].subtype).toBe("message");
    expect(msgBatch.events[0].extra.peerUin).toBe("12345");
    expect(msgBatch.events[0].extra.senderUin).toBe("99999");
    expect(msgBatch.events[0].extra.isGroup).toBe(false);
    expect(msgBatch.events[0].extra.isSend).toBe(false);
    expect(msgBatch.events[0].content.text).toBe("你好");
  });

  it("respects per-kind include opt-out", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "contact", id: "c1", capturedAt: now, uin: "100", nickname: "A" },
        { kind: "group", id: "g1", capturedAt: now, troopUin: "200", troopName: "G" },
        { kind: "message", id: "m1", capturedAt: now, msgId: "m1", text: "hi" },
      ],
    });
    const a = new QQAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { message: false } })) {
      raws.push(r);
    }
    const kinds = raws.map((r) => r.kind);
    expect(kinds).toEqual(["contact", "group"]);
  });

  it("respects opts.limit", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      kind: "message",
      id: `m${i}`,
      capturedAt: now - i * 100,
      msgId: `m${i}`,
      text: `t${i}`,
    }));
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new QQAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, limit: 2 })) raws.push(r);
    expect(raws.length).toBe(2);
  });

  it("filters out unknown kinds (forward compat)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "contact", id: "c1", capturedAt: now, uin: "100", nickname: "A" },
        { kind: "future-kind", id: "x", capturedAt: now },
        { kind: "search", id: "s", capturedAt: now }, // not a QQ snapshot kind
      ],
    });
    const a = new QQAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("contact");
  });

  it("snapshottedAt fallback when event capturedAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [
        { kind: "contact", id: "c1", uin: "100", nickname: "A" },
      ],
    });
    const a = new QQAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });

  it("normalize handles missing identifiers gracefully (forward compat)", () => {
    const a = new QQAdapter();
    // Contact with empty payload — uin/nickname/remark all absent
    const raw = {
      adapter: "messaging-qq",
      kind: "contact",
      originalId: "qq:contact:unknown",
      capturedAt: Date.now(),
      payload: { kind: "contact" },
    };
    const batch = a.normalize(raw);
    expect(batch.persons.length).toBe(1);
    expect(batch.persons[0].names).toEqual(["(unnamed)"]);
    expect(validateBatch(batch).valid).toBe(true);
  });

  it("xorDecrypt: empty input or empty key returns empty string", () => {
    expect(xorDecrypt(null, Buffer.from("123"))).toBe("");
    expect(xorDecrypt(Buffer.from(""), Buffer.from("123"))).toBe("");
    expect(xorDecrypt(Buffer.from("hi"), Buffer.from(""))).toBe("");
  });

  it("xorDecrypt: ASCII round-trip via IMEI XOR (sjqz qq.py parity)", () => {
    // Algorithm: out[i] = data[i] XOR imeiBytes[i % imeiLen]. Encryption is
    // its own inverse: XOR-decrypt the encrypted form ⇒ original plaintext.
    const imei = "123456789012345";
    const plaintext = "hello";
    const imeiBytes = Buffer.from(imei, "utf-8");
    const ptBytes = Buffer.from(plaintext, "utf-8");
    const encrypted = Buffer.alloc(ptBytes.length);
    for (let i = 0; i < ptBytes.length; i++) {
      encrypted[i] = ptBytes[i] ^ imeiBytes[i % imeiBytes.length];
    }
    expect(xorDecrypt(encrypted, imeiBytes)).toBe(plaintext);
  });

  it("xorDecrypt: UTF-8 multibyte (Chinese) round-trip", () => {
    const imei = "999000111222333";
    const plaintext = "你好世界";
    const imeiBytes = Buffer.from(imei, "utf-8");
    const ptBytes = Buffer.from(plaintext, "utf-8");
    const encrypted = Buffer.alloc(ptBytes.length);
    for (let i = 0; i < ptBytes.length; i++) {
      encrypted[i] = ptBytes[i] ^ imeiBytes[i % imeiBytes.length];
    }
    expect(xorDecrypt(encrypted, imeiBytes)).toBe(plaintext);
  });
});
