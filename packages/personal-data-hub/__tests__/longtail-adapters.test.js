"use strict";

import { describe, it, expect } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  DouyinAdapter,
  XiaohongshuAdapter,
  QQAdapter,
  TelegramAdapter,
} = require("../lib");
const { assertAdapter } = require("../lib/adapter-spec");
const { validateBatch } = require("../lib/batch");

function makeMockDriver(scriptedRows) {
  return function () {
    return {
      prepare(sql) {
        return {
          all() {
            for (const [matchSubstr, rows] of scriptedRows) {
              if (sql.includes(matchSubstr)) return rows;
            }
            throw new Error("no such table");
          },
        };
      },
      pragma() {},
      close() {},
    };
  };
}

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "longtail-"));
  const dbPath = path.join(dir, "fake.db");
  fs.writeFileSync(dbPath, "fake");
  return { dir, dbPath };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
}

// ─── DouyinAdapter ──────────────────────────────────────────────────────

describe("DouyinAdapter", () => {
  it("contract conformance", () => {
    const a = new DouyinAdapter({ account: { uid: "u-1" } });
    expect(assertAdapter(a).ok).toBe(true);
  });

  it("rejects missing account.uid", () => {
    expect(() => new DouyinAdapter({ account: {} })).toThrow(/uid/);
  });

  it("sync yields history + favourite + search", async () => {
    const { dir, dbPath } = tmpDb();
    try {
      const mockDriver = makeMockDriver([
        ["FROM video_history", [{ id: 1, aweme_id: "v1", title: "Cat", view_time: 1700000000, author: "@cat", duration: 30 }]],
        ["FROM history", []],
        ["FROM user_favorite", [{ id: 1, aweme_id: "v2", title: "Saved", create_time: 1700001000 }]],
        ["FROM favourite", []],
        ["FROM search_history", [{ id: 1, keyword: "music", time: 1700002000 }]],
      ]);
      const a = new DouyinAdapter({ account: { uid: "u-1" }, dbPath, dbDriverFactory: () => mockDriver });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws.length).toBe(3);
      for (const r of raws) {
        expect(validateBatch(a.normalize(r)).valid).toBe(true);
      }
    } finally { cleanup(dir); }
  });
});

// ─── XiaohongshuAdapter ─────────────────────────────────────────────────

describe("XiaohongshuAdapter", () => {
  it("contract conformance", () => {
    const a = new XiaohongshuAdapter({ account: { uid: "u-1" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).toContain("sync:sqlite");
  });

  it("snapshot mode constructs without account.uid (stateless)", () => {
    // §A8 v0.2: constructor loosened — snapshot mode pulls account from the
    // snapshot file. Sqlite mode still requires account.uid, checked at sync
    // time not construction.
    const a = new XiaohongshuAdapter({});
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.account).toBeNull();
  });

  it("sync yields history + likes + favourites", async () => {
    const { dir, dbPath } = tmpDb();
    try {
      const mockDriver = makeMockDriver([
        ["FROM browse_history", [{ id: 1, note_id: "n1", title: "Recipe", view_time: 1700000000, author: "chef" }]],
        ["FROM note", []],
        ["FROM liked_note", [{ id: 1, note_id: "n2", title: "Liked", like_time: 1700001000 }]],
        ["FROM favourite", [{ id: 1, note_id: "n3", title: "Saved", save_time: 1700002000 }]],
      ]);
      const a = new XiaohongshuAdapter({ account: { uid: "u-1" }, dbPath, dbDriverFactory: () => mockDriver });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws.length).toBe(3);
      for (const r of raws) {
        const batch = a.normalize(r);
        expect(validateBatch(batch).valid).toBe(true);
      }
    } finally { cleanup(dir); }
  });
});

// ─── QQAdapter ──────────────────────────────────────────────────────────

describe("QQAdapter", () => {
  it("contract conformance", () => {
    const a = new QQAdapter({ account: { qq: "12345" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.dataDisclosure.legalGate).toBe(true);
    expect(a.capabilities).toContain("sync:snapshot");
    expect(a.capabilities).toContain("sync:sqlite");
  });

  it("snapshot mode constructs without account.qq (stateless)", () => {
    // §Phase 13.5 v0.2: constructor loosened — snapshot mode pulls account
    // from the snapshot file. Sqlite mode still requires account.qq, checked
    // at sync time not construction. Mirror of weibo / bilibili A8 pattern.
    const a = new QQAdapter({});
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.account).toBeNull();
  });

  it("sqlite mode throws at sync time when account.qq missing", async () => {
    const { dir, dbPath } = tmpDb();
    try {
      const a = new QQAdapter({ dbPath, keyProvider: { getKey: async () => "k" } });
      let threw = null;
      try {
        for await (const _r of a.sync()) { /* drain */ }
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeTruthy();
      expect(String(threw.message)).toMatch(/account\.qq/);
    } finally { cleanup(dir); }
  });

  it("authenticate({}) without inputPath nor dbPath returns NO_INPUT", async () => {
    const a = new QQAdapter({ account: { qq: "12345" }, keyProvider: { getKey: async () => "k" } });
    const r = await a.authenticate();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NO_INPUT");
  });

  it("authenticate fails without keyProvider", async () => {
    const { dir, dbPath } = tmpDb();
    try {
      const a = new QQAdapter({ account: { qq: "12345" }, dbPath });
      const r = await a.authenticate();
      expect(r.reason).toBe("NO_KEY_PROVIDER");
    } finally { cleanup(dir); }
  });

  it("sync yields contact + group + message types", async () => {
    const { dir, dbPath } = tmpDb();
    try {
      // §Phase 13.5 v0.2 mock — new SQL targets:
      //   - Friends / friends / tb_recent_contact (probe order)
      //   - TroopInfoV2
      //   - sqlite_master LIKE 'mr_friend_%_New'
      //   - mr_friend_<MD5(peer).upper()>_New
      const mockDriver = makeMockDriver([
        ["FROM Friends", [{ uin: "999", nickname: "好友A", remark: "" }]],
        ["FROM TroopInfoV2", [{ troop_uin: "888", troop_name: "测试群", member_count: 5, owner_uin: "777" }]],
        ["FROM sqlite_master", [{ name: "mr_friend_ABCDEF1234_New" }]],
        [
          "FROM mr_friend_ABCDEF1234_New",
          [{
            msgId: "m1", msgtype: -1000, senderuin: "999", time: 1700000000,
            // msgData is XOR-encrypted bytes; with imei="123456789012345" key,
            // "hi" encrypts to bytes [0x51, 0x5d] (0x68^0x31=0x59 — actually
            // depends on imei[0] = '1' = 0x31). Use Buffer for cross-platform.
            msgData: Buffer.from([0x68 ^ 0x31, 0x69 ^ 0x32]),
            issend: 0, frienduin: "999", troopuin: null,
          }],
        ],
      ]);
      const a = new QQAdapter({
        account: { qq: "12345" },
        dbPath,
        keyProvider: { getKey: async () => "123456789012345" },
        dbDriverFactory: () => mockDriver,
      });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws.length).toBe(3); // contact + group + message
      const contact = raws.find((r) => r.kind === "contact");
      const group = raws.find((r) => r.kind === "group");
      const message = raws.find((r) => r.kind === "message");
      expect(contact).toBeDefined();
      expect(group).toBeDefined();
      expect(message).toBeDefined();
      // XOR-decrypt round-trip: bytes(0x68^0x31, 0x69^0x32) XOR "12" = "hi"
      expect(message.payload.text).toBe("hi");
      for (const r of raws) {
        expect(validateBatch(a.normalize(r)).valid).toBe(true);
      }
    } finally { cleanup(dir); }
  });
});

// ─── TelegramAdapter ────────────────────────────────────────────────────

describe("TelegramAdapter", () => {
  it("contract conformance", () => {
    const a = new TelegramAdapter({ account: { userId: "u-1" } });
    expect(assertAdapter(a).ok).toBe(true);
    expect(a.dataDisclosure.legalGate).toBe(true);
  });

  it("rejects missing account.userId", () => {
    expect(() => new TelegramAdapter({ account: {} })).toThrow(/userId/);
  });

  it("sync yields user + chat + messages (no key needed)", async () => {
    const { dir, dbPath } = tmpDb();
    try {
      const mockDriver = makeMockDriver([
        ["FROM users", [{ uid: "111", name: "Alice", username: "alice", phone: "13800001111" }]],
        ["FROM chats", [{ uid: "222", name: "Group A" }]],
        ["FROM messages_v2", [{ mid: "m1", uid: "111", message: "Hi", date: 1700000000, out: 0 }]],
        ["FROM messages", []],
      ]);
      const a = new TelegramAdapter({ account: { userId: "u-1" }, dbPath, dbDriverFactory: () => mockDriver });
      const raws = [];
      for await (const r of a.sync()) raws.push(r);
      expect(raws.length).toBe(3);
      for (const r of raws) {
        expect(validateBatch(a.normalize(r)).valid).toBe(true);
      }
    } finally { cleanup(dir); }
  });

  it("normalize contact includes phone identifier", async () => {
    const a = new TelegramAdapter({ account: { userId: "u-1" } });
    const batch = a.normalize({
      adapter: "messaging-telegram",
      originalId: "user-111",
      capturedAt: Date.now(),
      payload: { kind: "contact", row: { uid: "111", name: "Bob", phone: "13800001111" } },
    });
    expect(batch.persons[0].identifiers.telegramId).toBe("111");
    expect(batch.persons[0].identifiers.phone).toEqual(["13800001111"]);
  });
});
