"use strict";

import { describe, it, expect } from "vitest";

const { QQPcAdapter } = require("../../lib/adapters/qq-pc");
const { partitionBatch } = require("../../lib/batch");

/**
 * QQ NT (PC desktop) local-direct-read — 本地直读样板 (ported from wechat-pc).
 *
 * No native SQLite: fake driver via `_deps.dbDriverFactory`. The point of
 * these tests is the PLUMBING + honest defensiveness (resolve columns,
 * preserve raw row, loud diagnostic, best-effort text) — not protobuf
 * decoding, which is real-device tuning.
 */

function makeFakeDb(spec) {
  class FakeStmt {
    constructor(sql) {
      this.sql = sql;
    }
    all() {
      const s = this.sql;
      const m = s.match(/PRAGMA table_info\((\w+)\)/);
      if (m) return spec.cols[m[1]] || [];
      const f = s.match(/FROM (\w+)/);
      if (f) return spec.rows[f[1]] || [];
      return [];
    }
    get() {
      return { n: 1 };
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

// readable-name schema (decrypted/re-exported db) — text resolves cleanly
const READABLE_SPEC = {
  cols: {
    c2c_msg_table: [
      { name: "msgId" },
      { name: "msgTime" },
      { name: "msgType" },
      { name: "senderUin" },
      { name: "peerUin" },
      { name: "content" },
    ],
    group_msg_table: [
      { name: "msgId" },
      { name: "msgTime" },
      { name: "senderUin" },
      { name: "peerUin" },
      { name: "content" },
    ],
  },
  rows: {
    c2c_msg_table: [
      { msgId: "c1", msgTime: 1700000000, msgType: 1, senderUin: "111", peerUin: "222", content: "hi there" },
    ],
    group_msg_table: [
      { msgId: "g1", msgTime: 1700000100, senderUin: "333", peerUin: "9001", content: "群里大家好" },
    ],
  },
};

// obfuscated numeric schema + BLOB content — text is null but raw preserved
const NUMERIC_SPEC = {
  cols: {
    c2c_msg_table: [
      { name: "40001" }, // msgId
      { name: "40050" }, // time
      { name: "40011" }, // type
      { name: "40033" }, // sender
      { name: "40021" }, // peer
      { name: "40800" }, // content (blob)
    ],
  },
  rows: {
    c2c_msg_table: [
      { "40001": 9001, "40050": 1700000000, "40011": 1, "40033": 111, "40021": 222, "40800": Buffer.from([1, 2, 3]) },
    ],
  },
};

function freshAdapter(spec, { fsOverride } = {}) {
  const a = new QQPcAdapter({ dbPath: "/fake/nt_msg.db" });
  a._deps.fs = fsOverride || { existsSync: () => true, accessSync: () => {}, constants: { R_OK: 4 } };
  a._deps.dbDriverFactory = () => makeFakeDb(spec);
  return a;
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("QQPcAdapter — readiness + construction", () => {
  it("no-arg construct + APP_NOT_INSTALLED when nothing discoverable", async () => {
    const a = new QQPcAdapter();
    a._deps.discoveryDeps = {
      fs: { existsSync: () => false, readdirSync: () => [], statSync: () => ({ size: 0 }), constants: { R_OK: 4 } },
      home: "/no-home",
      env: {},
    };
    expect(a.name).toBe("qq-pc");
    expect(a.dataDisclosure.legalGate).toBe(true);
    const r = await a.authenticate({ readinessOnly: true });
    expect(r.reason).toBe("APP_NOT_INSTALLED");
  });
});

describe("QQPcAdapter — nt_msg.db (readable schema)", () => {
  it("reads c2c + group messages → valid events, 0 invalid", async () => {
    const a = freshAdapter(READABLE_SPEC);
    const raws = await collect(a.sync({ dbPath: "/fake/nt_msg.db" }));
    expect(raws).toHaveLength(2);
    expect(raws.every((r) => r.kind === "message")).toBe(true);
    const merged = { events: [], persons: [], places: [], items: [], topics: [] };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged)) merged[k].push(...n[k]);
    }
    const { valid, invalidReasons } = partitionBatch(merged);
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(2);
  });

  it("resolves text + flags group + preserves timestamp", async () => {
    const a = freshAdapter(READABLE_SPEC);
    const raws = await collect(a.sync({ dbPath: "/fake/nt_msg.db" }));
    const group = raws.find((r) => r.payload.isGroup);
    expect(group.payload.text).toBe("群里大家好");
    expect(group.payload.createdTimeMs).toBe(1700000100000);
    const ev = a.normalize(group).events[0];
    expect(ev.extra.isGroup).toBe(true);
    expect(ev.extra.textResolved).toBe(true);
  });
});

describe("QQPcAdapter — nt_msg.db (numeric/obfuscated + BLOB body)", () => {
  it("still ingests, text null, raw row preserved, loud diagnostic", async () => {
    const a = freshAdapter(NUMERIC_SPEC);
    const events = [];
    const raws = await collect(
      a.sync({ dbPath: "/fake/nt_msg.db", onProgress: (e) => events.push(e) }),
    );
    expect(raws).toHaveLength(1);
    const ev = a.normalize(raws[0]).events[0];
    // No silent drop: it's a valid event even with unresolved protobuf text.
    const { valid, invalidReasons } = partitionBatch({
      events: [ev], persons: [], places: [], items: [], topics: [],
    });
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(1);
    expect(ev.extra.textResolved).toBe(false);
    expect(ev.extra.rawRow).toBeTruthy(); // nothing lost
    // diagnostic tells the user what resolved
    const diag = events.find((e) => e.phase === "qq-nt-read");
    expect(diag.hadC2cTable).toBe(true);
    expect(diag.messageCount).toBe(1);
    expect(diag.resolvedColumns.c2c_msg_table.time).toBe("40050");
  });
});

describe("QQPcAdapter — edge cases", () => {
  it("respects limit", async () => {
    const a = freshAdapter(READABLE_SPEC);
    const capped = await collect(a.sync({ dbPath: "/fake/nt_msg.db", limit: 1 }));
    expect(capped).toHaveLength(1);
  });

  it("missing db yields nothing", async () => {
    const a = freshAdapter(READABLE_SPEC, { fsOverride: { existsSync: () => false } });
    expect(await collect(a.sync({ dbPath: "/nope.db" }))).toHaveLength(0);
  });

  it("unknown normalize kind throws", () => {
    const a = new QQPcAdapter();
    expect(() => a.normalize({ kind: "x", payload: { kind: "x" } })).toThrow(/unknown kind/);
  });
});
