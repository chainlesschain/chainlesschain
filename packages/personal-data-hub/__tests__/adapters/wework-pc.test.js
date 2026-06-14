"use strict";

import { describe, it, expect } from "vitest";

const { WeWorkPcAdapter, NAME, VERSION } = require("../../lib/adapters/wework-pc");
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

// WeChat Work-ish message table: matches pattern + has time/sender/peer/content.
const SPEC = {
  tables: ["chat_message", "session_meta", "sqlite_sequence"],
  cols: {
    chat_message: [
      { name: "localId" },
      { name: "createTime" },
      { name: "sender" },
      { name: "conversationId" },
      { name: "content" },
    ],
    session_meta: [{ name: "vid" }, { name: "name" }],
  },
  rows: {
    chat_message: [
      { localId: "m1", createTime: 1700000000, sender: "u1", conversationId: "c1", content: "项目周会 10 点" },
      { localId: "m2", createTime: 1700000010, sender: "u2", conversationId: "c1", content: "收到" },
    ],
  },
};

function adapter(spec, { exists = true } = {}) {
  const a = new WeWorkPcAdapter({ dbPath: "/fake.db" });
  a._deps.fs = { existsSync: () => exists, accessSync: () => {}, constants: { R_OK: 4 } };
  a._deps.dbDriverFactory = () => makeFakeDb(spec);
  return a;
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("WeWorkPcAdapter (企业微信 honest best-effort)", () => {
  it("exposes name/version", () => {
    expect(NAME).toBe("wework-pc");
    expect(VERSION).toBe("0.1.0");
    expect(new WeWorkPcAdapter().name).toBe("wework-pc");
  });

  it("no-arg construct + device-pull + legalGate + APP_NOT_INSTALLED readiness", async () => {
    const a = new WeWorkPcAdapter();
    a._deps.discoveryDeps = {
      fs: { existsSync: () => false, readdirSync: () => [], statSync: () => ({ size: 0 }), constants: { R_OK: 4 } },
      home: "/no-home",
      env: {},
    };
    expect(a.extractMode).toBe("device-pull");
    expect(a.dataDisclosure.legalGate).toBe(true);
    const r = await a.authenticate({ readinessOnly: true });
    expect(r.reason).toBe("APP_NOT_INSTALLED");
  });

  it("reads messages → valid events, platform=wework, raw preserved", async () => {
    const a = adapter(SPEC);
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
    expect(valid.events[0].extra.platform).toBe("wework");
    expect(valid.events[0].extra.textResolved).toBe(true);
    expect(valid.events[0].extra.rawRow).toBeTruthy();
  });

  it("emits local-im-read progress diagnostic", async () => {
    const a = adapter(SPEC);
    const ev = [];
    await collect(a.sync({ dbPath: "/fake.db", onProgress: (e) => ev.push(e) }));
    const d = ev.find((e) => e.phase === "local-im-read");
    expect(d.messageTables).toContain("chat_message");
    expect(d.messageCount).toBe(2);
  });

  it("missing db yields nothing; unknown kind throws", async () => {
    const a = adapter(SPEC, { exists: false });
    expect(await collect(a.sync({ dbPath: "/no.db" }))).toHaveLength(0);
    expect(() => new WeWorkPcAdapter().normalize({ kind: "x", payload: { kind: "x" } })).toThrow(/unknown kind/);
  });
});
