"use strict";

import { describe, it, expect } from "vitest";

const { WeChatPcAdapter } = require("../../lib/adapters/wechat-pc");
const { partitionBatch } = require("../../lib/batch");

/**
 * WeChat **PC desktop** local-direct-read (本地直读样板, ported from Douyin).
 *
 * No native SQLite: a fake Database driver is injected via
 * `_deps.dbDriverFactory` (pc-db-reader accepts it as `_databaseClass`).
 * Covers the message/contact normalize + the MSG / Contact table read +
 * group-message sender-prefix parsing + key-vs-plaintext routing.
 */

// Fake better-sqlite3-style driver answering pc-db-reader's PRAGMA + SELECTs.
function makeFakeDb(spec) {
  class FakeStmt {
    constructor(sql) {
      this.sql = sql;
    }
    all() {
      const s = this.sql;
      if (/PRAGMA table_info\(MSG\)/.test(s)) return spec.msgCols || [];
      if (/FROM MSG/.test(s)) return spec.msgRows || [];
      if (/PRAGMA table_info\(Contact\)/.test(s)) return spec.contactCols || [];
      if (/FROM Contact/.test(s)) return spec.contactRows || [];
      return [];
    }
    get() {
      return { n: 1 }; // sqlite_master probe
    }
  }
  return class FakeDb {
    // eslint-disable-next-line no-unused-vars
    constructor(_path, _opts) {}
    prepare(sql) {
      return new FakeStmt(sql);
    }
    pragma() {}
    exec() {}
    close() {}
  };
}

const MSG_SPEC = {
  msgCols: [
    { name: "MsgSvrID" },
    { name: "StrTalker" },
    { name: "IsSender" },
    { name: "CreateTime" },
    { name: "Type" },
    { name: "StrContent" },
  ],
  msgRows: [
    { msgSvrId: "700001", talker: "wxid_bob", isSend: 0, createTime: 1700000000, type: 1, content: "你好啊" },
    { msgSvrId: "700002", talker: "wxid_bob", isSend: 1, createTime: 1700000010, type: 1, content: "在的" },
    { msgSvrId: "700003", talker: "room1@chatroom", isSend: 0, createTime: 1700000020, type: 1, content: "wxid_carol:\n大家好" },
  ],
};

const CONTACT_SPEC = {
  contactCols: [
    { name: "UserName" },
    { name: "Alias" },
    { name: "NickName" },
    { name: "Remark" },
    { name: "Type" },
  ],
  contactRows: [
    { wxid: "wxid_bob", alias: "bob123", nickname: "Bob", remark: "老鲍", type: 3 },
    { wxid: "gh_official01", alias: null, nickname: "某公众号", remark: null, type: 3 },
    { wxid: "room1@chatroom", alias: null, nickname: "群", remark: null, type: 2 }, // filtered
  ],
};

function freshAdapter(spec, { fsOverride } = {}) {
  const a = new WeChatPcAdapter({ dbPath: "/fake/MSG0.db" });
  a._deps.fs = fsOverride || { existsSync: () => true, accessSync: () => {}, constants: { R_OK: 4 } };
  a._deps.dbDriverFactory = () => makeFakeDb(spec);
  return a;
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("WeChatPcAdapter — readiness + construction", () => {
  // Synthetic "nothing installed" filesystem so auto-discovery is
  // deterministic regardless of what's on the host running the tests.
  const EMPTY_FS = {
    existsSync: () => false,
    readdirSync: () => [],
    statSync: () => ({ size: 0 }),
    constants: { R_OK: 4 },
  };

  it("constructs no-arg and reports APP_NOT_INSTALLED when nothing is discoverable", async () => {
    const a = new WeChatPcAdapter();
    a._deps.discoveryDeps = { fs: EMPTY_FS, home: "/no-home", env: {} };
    expect(a.name).toBe("wechat-pc");
    expect(a.extractMode).toBe("device-pull");
    expect(a.dataDisclosure.legalGate).toBe(true);
    const r = await a.authenticate({ readinessOnly: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("APP_NOT_INSTALLED");
  });

  it("auto-discovers an installed WeChat 4.x DB → DB_FOUND_NEEDS_KEY", async () => {
    // Minimal synthetic 4.x layout: ~/Documents/xwechat_files/<wxid>_N/db_storage/message/message_0.db
    const dirs = {
      "/h/Documents/xwechat_files": [{ name: "wxid_abc_1", isDirectory: () => true, isFile: () => false }],
      "/h/Documents/xwechat_files/wxid_abc_1/db_storage/message": [
        { name: "message_0.db", isDirectory: () => false, isFile: () => true },
      ],
    };
    const exist = new Set([
      "/h/Documents/xwechat_files",
      "/h/Documents/xwechat_files/wxid_abc_1/db_storage",
      "/h/Documents/xwechat_files/wxid_abc_1/db_storage/contact/contact.db",
    ]);
    const fakeFs = {
      existsSync: (p) => exist.has(p.replace(/\\/g, "/")),
      readdirSync: (p) => dirs[p.replace(/\\/g, "/")] || [],
      statSync: () => ({ size: 1234 }),
      constants: { R_OK: 4 },
    };
    const a = new WeChatPcAdapter();
    a._deps.discoveryDeps = { fs: fakeFs, home: "/h", env: {}, path: require("node:path").posix };
    const r = await a.authenticate({ readinessOnly: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DB_FOUND_NEEDS_KEY");
    expect(r.discovered.installed).toBe(true);
    expect(r.discovered.primaryDb).toContain("message_0.db");
  });

  it("readinessOnly with a configured dbPath reports configured (no DB open)", async () => {
    const a = new WeChatPcAdapter({ dbPath: "/some/MSG0.db" });
    const r = await a.authenticate({ readinessOnly: true });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("configured");
  });
});

describe("WeChatPcAdapter — MSG*.db messages", () => {
  it("reads MSG rows → message raws with stable ids", async () => {
    const a = freshAdapter(MSG_SPEC);
    const raws = await collect(a.sync({ dbPath: "/fake/MSG0.db" }));
    expect(raws.map((r) => r.kind)).toEqual(["message", "message", "message"]);
    expect(raws.map((r) => r.originalId)).toEqual([
      "wechat-pc:message:700001",
      "wechat-pc:message:700002",
      "wechat-pc:message:700003",
    ]);
  });

  it("messages normalize to valid events (+ contact persons + group topic), 0 invalid", async () => {
    const a = freshAdapter(MSG_SPEC);
    const raws = await collect(a.sync({ dbPath: "/fake/MSG0.db" }));
    const merged = { events: [], persons: [], places: [], items: [], topics: [] };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged)) merged[k].push(...n[k]);
    }
    const { valid, invalidReasons } = partitionBatch(merged);
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(3);
    // bob (1-on-1) + carol (group sender)
    const personIds = valid.persons.map((p) => p.id).sort();
    expect(personIds).toContain("person-wechat-wxid_bob");
    expect(personIds).toContain("person-wechat-wxid_carol");
    // the chatroom becomes a topic
    expect(valid.topics.map((t) => t.id)).toContain("topic-wechat-group-room1@chatroom");
  });

  it("strips the group-message sender prefix from the text", async () => {
    const a = freshAdapter(MSG_SPEC);
    const raws = await collect(a.sync({ dbPath: "/fake/MSG0.db" }));
    const groupRaw = raws.find((r) => r.payload.talker === "room1@chatroom");
    expect(groupRaw.payload.senderWxid).toBe("wxid_carol");
    expect(groupRaw.payload.text).toBe("大家好");
    const ev = a.normalize(groupRaw).events[0];
    expect(ev.content.text).toBe("大家好");
    expect(ev.extra.isGroup).toBe(true);
    expect(ev.actor).toBe("person-wechat-wxid_carol");
  });

  it("CreateTime (seconds) normalizes to ms", async () => {
    const a = freshAdapter(MSG_SPEC);
    const raws = await collect(a.sync({ dbPath: "/fake/MSG0.db" }));
    expect(raws[0].payload.createdTimeMs).toBe(1700000000000);
  });
});

describe("WeChatPcAdapter — MicroMsg.db contacts", () => {
  it("reads Contact rows → contact persons; skips @chatroom; gh_ → merchant", async () => {
    const a = freshAdapter(CONTACT_SPEC);
    const raws = await collect(a.sync({ dbPath: "/fake/MicroMsg.db" }));
    expect(raws.map((r) => r.kind)).toEqual(["contact", "contact"]); // chatroom filtered
    const persons = raws.map((r) => a.normalize(r).persons[0]);
    const bob = persons.find((p) => p.id === "person-wechat-wxid_bob");
    expect(bob.subtype).toBe("contact");
    expect(bob.names[0]).toBe("老鲍"); // remark wins
    expect(bob.identifiers.wechatId).toBe("wxid_bob");
    const gh = persons.find((p) => p.id === "person-wechat-gh_official01");
    expect(gh.subtype).toBe("merchant");
  });
});

describe("WeChatPcAdapter — options + edge cases", () => {
  it("respects include={message:false} and limit", async () => {
    const a = freshAdapter(MSG_SPEC);
    const none = await collect(a.sync({ dbPath: "/fake/MSG0.db", include: { message: false } }));
    expect(none).toHaveLength(0);
    const capped = await collect(a.sync({ dbPath: "/fake/MSG0.db", limit: 2 }));
    expect(capped).toHaveLength(2);
  });

  it("emits a pc-db-read progress event with the diagnostic", async () => {
    const a = freshAdapter(MSG_SPEC);
    const events = [];
    await collect(a.sync({ dbPath: "/fake/MSG0.db", onProgress: (e) => events.push(e) }));
    const parsed = events.find((e) => e.phase === "pc-db-read");
    expect(parsed).toBeTruthy();
    expect(parsed.hadMsgTable).toBe(true);
    expect(parsed.messageCount).toBe(3);
    expect(parsed.mode).toBe("plaintext"); // no key supplied
  });

  it("missing db file yields nothing (no throw)", async () => {
    const a = freshAdapter(MSG_SPEC, { fsOverride: { existsSync: () => false } });
    const raws = await collect(a.sync({ dbPath: "/nope/MSG0.db" }));
    expect(raws).toHaveLength(0);
  });

  it("unknown normalize kind throws", () => {
    const a = new WeChatPcAdapter();
    expect(() => a.normalize({ kind: "weird", payload: { kind: "weird" } })).toThrow(
      /unknown kind/,
    );
  });
});

describe("WeChatPcAdapter — WeChat 4.x sidecar path", () => {
  function fakeCollector(result) {
    return async (_opts) => result;
  }

  it("opts.mode='v4' routes through the injected collector and yields messages", async () => {
    const a = new WeChatPcAdapter({
      v4Collector: fakeCollector({
        account: "wxid_me",
        messageCount: 2,
        dbs: [{ db: "message_0.db", messageCount: 2, hmacFailures: 0 }],
        messages: [
          {
            conversation: "wxid_friend",
            sender: "wxid_friend",
            type: 1,
            createTime: 1700000002,
            text: "hello from 4.0",
            originalId: "wechat-pc:wxid_friend:1001",
          },
          {
            conversation: "39354004187@chatroom",
            sender: "wxid_other",
            type: 1,
            createTime: 1700000003,
            text: "group line",
            originalId: "wechat-pc:39354004187@chatroom:1002",
          },
        ],
      }),
    });
    const raws = await collect(a.sync({ mode: "v4" }));
    expect(raws).toHaveLength(2);
    expect(raws[0].originalId).toBe("wechat-pc:wxid_friend:1001");
    expect(raws[0].payload.text).toBe("hello from 4.0");
    expect(raws[0].payload.isGroup).toBe(false);
    // group message: peer is the chatroom, sender preserved
    expect(raws[1].payload.isGroup).toBe(true);
    expect(raws[1].payload.senderWxid).toBe("wxid_other");

    // normalize reuses the 3.x path → produces a valid message event
    const merged = { events: [], persons: [], places: [], items: [], topics: [] };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged)) if (Array.isArray(n[k])) merged[k].push(...n[k]);
    }
    const { valid } = partitionBatch(merged);
    expect(valid.events.length).toBe(2);
    const texts = valid.events.map((e) => e.content && e.content.text);
    expect(texts).toContain("hello from 4.0");
    expect(texts).toContain("group line");
  });

  it("v4 self-sent message marks isSend=1 when sender == account", async () => {
    const a = new WeChatPcAdapter({
      v4Collector: fakeCollector({
        account: "wxid_me",
        messages: [
          { conversation: "wxid_friend", sender: "wxid_me", type: 1, createTime: 1700000004, text: "mine", originalId: "id-3" },
        ],
      }),
    });
    const raws = await collect(a.sync({ mode: "v4" }));
    expect(raws[0].payload.isSend).toBe(1);
  });

  it("v4 respects limit", async () => {
    const msgs = Array.from({ length: 5 }, (_v, i) => ({
      conversation: "wxid_f", sender: "wxid_f", type: 1, createTime: 1700000000 + i, text: "m" + i, originalId: "id-" + i,
    }));
    const a = new WeChatPcAdapter({ v4Collector: fakeCollector({ account: "wxid_me", messages: msgs }) });
    const raws = await collect(a.sync({ mode: "v4", limit: 3 }));
    expect(raws).toHaveLength(3);
  });
});
