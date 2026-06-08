"use strict";

import { describe, it, expect } from "vitest";

const { DingTalkPcAdapter } = require("../../lib/adapters/dingtalk-pc");
const { FeishuPcAdapter } = require("../../lib/adapters/feishu-pc");
const { readLocalImDb } = require("../../lib/adapters/_local-im-db-reader");
const { partitionBatch } = require("../../lib/batch");

// fake driver answering sqlite_master + table_info + SELECT * by table
function makeFakeDb(spec) {
  class FakeStmt {
    constructor(sql) {
      this.sql = sql;
    }
    all() {
      const s = this.sql;
      if (/type='table'/.test(s)) return (spec.tables || []).map((n) => ({ name: n }));
      const ti = s.match(/table_info\("(\w+)"\)/);
      if (ti) return spec.cols[ti[1]] || [];
      const fr = s.match(/FROM "(\w+)"/);
      if (fr) return spec.rows[fr[1]] || [];
      return [];
    }
    get() {
      return { n: 1 };
    }
  }
  return class FakeDb {
    // eslint-disable-next-line no-unused-vars
    constructor(_p, _o) {}
    prepare(sql) {
      return new FakeStmt(sql);
    }
    pragma() {}
    exec() {}
    close() {}
  };
}

const SPEC = {
  // msg_table matches + has time/content → ingested
  // msg_meta  matches pattern but no time/content → skipped (loud diagnostic)
  // contact_meta doesn't match pattern → not scanned
  // sqlite_sequence → filtered (sqlite_*)
  tables: ["msg_table", "msg_meta", "contact_meta", "sqlite_sequence"],
  cols: {
    msg_table: [
      { name: "msgId" },
      { name: "createTime" },
      { name: "senderId" },
      { name: "conversationId" },
      { name: "content" },
    ],
    msg_meta: [{ name: "uid" }, { name: "name" }],
    contact_meta: [{ name: "uid" }, { name: "name" }],
  },
  rows: {
    msg_table: [
      { msgId: "m1", createTime: 1700000000, senderId: "u1", conversationId: "c1", content: "开会通知" },
      { msgId: "m2", createTime: 1700000010, senderId: "u2", conversationId: "c1", content: "收到" },
    ],
  },
};

// opaque schema — time resolves, but body is a BLOB → text null, raw kept
const OPAQUE_SPEC = {
  tables: ["chat_msg"],
  cols: { chat_msg: [{ name: "id" }, { name: "timestamp" }, { name: "body" }] },
  rows: { chat_msg: [{ id: 7, timestamp: 1700000000, body: Buffer.from([1, 2]) }] },
};

function adapter(Cls, spec, { exists = true } = {}) {
  const a = new Cls({ dbPath: "/fake.db" });
  a._deps.fs = { existsSync: () => exists, accessSync: () => {}, constants: { R_OK: 4 } };
  a._deps.dbDriverFactory = () => makeFakeDb(spec);
  return a;
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("readLocalImDb (generic honest reader)", () => {
  it("discovers message tables, skips metadata + sqlite_*", () => {
    const { messages, diagnostic } = readLocalImDb("/x", { _databaseClass: makeFakeDb(SPEC) });
    expect(diagnostic.messageTables).toEqual(["msg_table"]);
    expect(diagnostic.skippedTables).toEqual(["msg_meta"]);
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("开会通知");
    expect(messages[0].createdTimeMs).toBe(1700000000000);
  });

  it("opaque body → text null but rawRow preserved + loud diagnostic", () => {
    const { messages, diagnostic } = readLocalImDb("/x", { _databaseClass: makeFakeDb(OPAQUE_SPEC) });
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBeNull();
    expect(messages[0].rawRow).toBeTruthy();
    expect(diagnostic.textCount).toBe(0);
    expect(diagnostic.messageTables).toEqual(["chat_msg"]);
  });
});

describe.each([
  ["DingTalkPcAdapter", DingTalkPcAdapter, "dingtalk"],
  ["FeishuPcAdapter", FeishuPcAdapter, "feishu"],
])("%s (honest best-effort)", (_label, Cls, platform) => {
  it("no-arg construct + DB_NOT_PULLED readiness + legalGate", async () => {
    const a = new Cls();
    expect(a.extractMode).toBe("device-pull");
    expect(a.dataDisclosure.legalGate).toBe(true);
    const r = await a.authenticate({ readinessOnly: true });
    expect(r.reason).toBe("DB_NOT_PULLED");
  });

  it("reads messages → valid events, platform tag, raw preserved", async () => {
    const a = adapter(Cls, SPEC);
    const raws = await collect(a.sync({ dbPath: "/fake.db" }));
    expect(raws).toHaveLength(2);
    const merged = { events: [], persons: [], places: [], items: [], topics: [] };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged)) merged[k].push(...n[k]);
    }
    const { valid, invalidReasons } = partitionBatch(merged);
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(2);
    expect(valid.events[0].extra.platform).toBe(platform);
    expect(valid.events[0].extra.textResolved).toBe(true);
    expect(valid.events[0].extra.rawRow).toBeTruthy();
  });

  it("emits local-im-read progress diagnostic", async () => {
    const a = adapter(Cls, SPEC);
    const ev = [];
    await collect(a.sync({ dbPath: "/fake.db", onProgress: (e) => ev.push(e) }));
    const d = ev.find((e) => e.phase === "local-im-read");
    expect(d.messageTables).toContain("msg_table");
    expect(d.messageCount).toBe(2);
  });

  it("missing db yields nothing; unknown kind throws", async () => {
    const a = adapter(Cls, SPEC, { exists: false });
    expect(await collect(a.sync({ dbPath: "/no.db" }))).toHaveLength(0);
    expect(() => new Cls().normalize({ kind: "x", payload: { kind: "x" } })).toThrow(/unknown kind/);
  });
});
