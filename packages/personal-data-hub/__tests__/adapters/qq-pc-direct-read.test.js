"use strict";

import { describe, it, expect } from "vitest";

const { QQPcAdapter } = require("../../lib/adapters/qq-pc");
const { COL_CANDIDATES } = require("../../lib/adapters/qq-pc/nt-db-reader");
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
      if (Array.isArray(spec.queries)) spec.queries.push(s);
      const m = s.match(/PRAGMA table_info\((\w+)\)/);
      if (m) return spec.cols[m[1]] || [];
      const f = s.match(/FROM (\w+)/);
      if (f) {
        const rows = spec.rows[f[1]] || [];
        const cast = s.match(/CAST\("([^"]+)" AS TEXT\) AS "([^"]+)"/);
        if (!cast) return rows;
        const [, source, alias] = cast;
        return rows.map((row) => ({
          ...row,
          [alias]: row[source] == null ? null : String(row[source]),
        }));
      }
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
      {
        msgId: "c1",
        msgTime: 1700000000,
        msgType: 1,
        senderUin: "111",
        peerUin: "222",
        content: "hi there",
      },
    ],
    group_msg_table: [
      {
        msgId: "g1",
        msgTime: 1700000100,
        senderUin: "333",
        peerUin: "9001",
        content: "群里大家好",
      },
    ],
  },
};

// obfuscated numeric schema + BLOB content — text is null but raw preserved
const NUMERIC_SPEC = {
  cols: {
    c2c_msg_table: [
      { name: "40001" }, // msgId
      { name: "40003" }, // conversation sequence
      { name: "40020" }, // sender uid
      { name: "40021" }, // peer QQ/group
      { name: "40027" }, // numeric peer uid
      { name: "40030" }, // sender type
      { name: "40033" }, // sender uin
      { name: "40011" }, // type
      { name: "40012" }, // subtype
      { name: "40040" }, // read state
      { name: "40050" }, // time
      { name: "40800" }, // content (blob)
    ],
  },
  rows: {
    c2c_msg_table: [
      {
        40001: 9007199254740993n,
        40003: 73,
        40020: "u_sender",
        40021: 222,
        40027: 7654,
        40030: 42,
        40033: 111,
        40011: 2,
        40012: 99,
        40040: 1,
        40050: 1700000000,
        40800: Buffer.from([1, 2, 3]),
      },
    ],
  },
};

function freshAdapter(spec, { fsOverride } = {}) {
  const a = new QQPcAdapter({ dbPath: "/fake/nt_msg.db" });
  a._deps.fs = fsOverride || {
    existsSync: () => true,
    accessSync: () => {},
    constants: { R_OK: 4 },
  };
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
      fs: {
        existsSync: () => false,
        readdirSync: () => [],
        statSync: () => ({ size: 0 }),
        constants: { R_OK: 4 },
      },
      home: "/no-home",
      env: {},
    };
    expect(a.name).toBe("qq-pc");
    expect(a.watermarkStrategy).toBe("explicit");
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
    const merged = {
      events: [],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
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
      events: [ev],
      persons: [],
      places: [],
      items: [],
      topics: [],
    });
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(1);
    expect(ev.extra.textResolved).toBe(false);
    expect(ev.extra.rawRow).toBeTruthy(); // nothing lost
    expect(raws[0].originalId).toBe("qq-pc:message:9007199254740993");
    expect(raws[0].canonicalOriginalId).toBe("c2c_msg_table:9007199254740993");
    expect(raws[0].producer).toBe("qq-pc/direct");
    expect(raws[0].payload.tableName).toBe("c2c_msg_table");
    expect(raws[0].payload.msgId).toBe("9007199254740993");
    expect(raws[0].payload.messageId).toBe("9007199254740993");
    expect(raws[0].payload.sequence).toBe("73");
    expect(raws[0].payload.senderUid).toBe("u_sender");
    expect(raws[0].payload.senderUin).toBe("111");
    expect(raws[0].payload.peerUin).toBe("222");
    expect(raws[0].payload.peerUid).toBe("7654");
    expect(raws[0].payload.senderType).toBe(42);
    expect(raws[0].payload.type).toBe(2);
    expect(raws[0].payload.subtype).toBe(99);
    expect(raws[0].payload.readState).toBe(1);
    expect(raws[0].payload.rawRow["40001"]).toBe("9007199254740993");
    expect(() => JSON.stringify(raws[0].payload.rawRow)).not.toThrow();
    expect(COL_CANDIDATES.msgId).not.toContain("40020");
    expect(ev.extra.messageId).toBe("9007199254740993");
    expect(ev.extra.sequence).toBe("73");
    expect(ev.extra.senderUid).toBe("u_sender");
    expect(ev.extra.peerUid).toBe("7654");
    expect(ev.extra.senderType).toBe(42);
    expect(ev.extra.subtype).toBe(99);
    expect(ev.extra.readState).toBe(1);
    expect(ev.extra.observationProducer).toBe("qq-pc/direct");
    expect(ev.source.originalId).toBe("c2c_msg_table:9007199254740993");
    // diagnostic tells the user what resolved
    const diag = events.find((e) => e.phase === "qq-nt-read");
    expect(diag.hadC2cTable).toBe(true);
    expect(diag.messageCount).toBe(1);
    expect(diag.resolvedColumns.c2c_msg_table.msgId).toBe("40001");
    expect(diag.resolvedColumns.c2c_msg_table.sequence).toBe("40003");
    expect(diag.resolvedColumns.c2c_msg_table.senderUid).toBe("40020");
    expect(diag.resolvedColumns.c2c_msg_table.peerUin).toBe("40021");
    expect(diag.resolvedColumns.c2c_msg_table.peerUid).toBe("40027");
    expect(diag.resolvedColumns.c2c_msg_table.senderType).toBe("40030");
    expect(diag.resolvedColumns.c2c_msg_table.senderUin).toBe("40033");
    expect(diag.resolvedColumns.c2c_msg_table.type).toBe("40011");
    expect(diag.resolvedColumns.c2c_msg_table.subtype).toBe("40012");
    expect(diag.resolvedColumns.c2c_msg_table.readState).toBe("40040");
    expect(diag.resolvedColumns.c2c_msg_table.time).toBe("40050");
  });
});

describe("QQPcAdapter — edge cases", () => {
  it("respects limit", async () => {
    const a = freshAdapter(READABLE_SPEC);
    const capped = await collect(
      a.sync({ dbPath: "/fake/nt_msg.db", limit: 1 }),
    );
    expect(capped).toHaveLength(1);
  });

  it("removes default SQL row caps and pushes down an explicit limit", async () => {
    const uncappedSpec = { ...READABLE_SPEC, queries: [] };
    await collect(
      freshAdapter(uncappedSpec).sync({ dbPath: "/fake/nt_msg.db" }),
    );
    expect(
      uncappedSpec.queries.find((sql) => /FROM c2c_msg_table/.test(sql)),
    ).not.toMatch(/\bLIMIT\b/);

    const cappedSpec = { ...READABLE_SPEC, queries: [] };
    await collect(
      freshAdapter(cappedSpec).sync({
        dbPath: "/fake/nt_msg.db",
        limit: 1,
      }),
    );
    expect(
      cappedSpec.queries.find((sql) => /FROM c2c_msg_table/.test(sql)),
    ).toMatch(/\bLIMIT 1\b/);
  });

  it("missing db yields nothing", async () => {
    const a = freshAdapter(READABLE_SPEC, {
      fsOverride: { existsSync: () => false },
    });
    expect(await collect(a.sync({ dbPath: "/nope.db" }))).toHaveLength(0);
  });

  it("unknown normalize kind throws", () => {
    const a = new QQPcAdapter();
    expect(() => a.normalize({ kind: "x", payload: { kind: "x" } })).toThrow(
      /unknown kind/,
    );
  });
});

describe("QQPcAdapter — QQ NT sidecar path (passphrase)", () => {
  const fakeCollector = (result, onCall) => async (opts) => {
    if (onCall) onCall(opts);
    return result;
  };

  it("opts.passphrase routes through the sidecar collector and yields messages", async () => {
    let collectOpts;
    const a = new QQPcAdapter({
      qqCollector: fakeCollector(
        {
          account: "896075341",
          messageCount: 2,
          c2c: 1,
          group: 1,
          messages: [
            {
              kind: "group",
              messageId: "9007199254740993",
              sequence: "7",
              peer: 88966001,
              peerUid: "7654",
              senderUid: "u_sender",
              senderType: 42,
              senderUin: 38181604,
              senderName: "疯子",
              type: 2,
              subtype: 99,
              readState: 1,
              createTime: 1780941580,
              text: "保持高贵的沉默。",
              originalId: "qq-pc:group:38181604:7",
            },
            {
              kind: "c2c",
              peer: 2747277822,
              peerUid: "u_y",
              senderUin: 12345,
              senderName: "张三",
              type: 0,
              createTime: 1780900000,
              text: "在吗",
              originalId: "qq-pc:c2c:2747277822:2",
            },
          ],
        },
        (opts) => {
          collectOpts = opts;
        },
      ),
    });
    const controller = new AbortController();
    const raws = await collect(
      a.sync({
        passphrase: "5{sww#,6aq=)8=A@",
        inputPath: "/fake/from-input-path.db",
        signal: controller.signal,
      }),
    );
    expect(raws).toHaveLength(2);
    expect(collectOpts.dbPath).toBe("/fake/from-input-path.db");
    expect(collectOpts.signal).toBe(controller.signal);
    expect(raws[0].payload.text).toBe("保持高贵的沉默。");
    expect(raws[0].payload.isGroup).toBe(true);
    expect(raws[0].payload.messageId).toBe("9007199254740993");
    expect(raws[0].payload.sequence).toBe("7");
    expect(raws[0].payload.peerUid).toBe("7654");
    expect(raws[0].payload.senderUid).toBe("u_sender");
    expect(raws[0].payload.senderType).toBe(42);
    expect(raws[0].payload.subtype).toBe(99);
    expect(raws[0].payload.readState).toBe(1);
    expect(raws[0].originalId).toBe("qq-pc:group:38181604:7");
    expect(raws[0].canonicalOriginalId).toBe(
      "group_msg_table:9007199254740993",
    );
    expect(raws[0].producer).toBe("qq-pc/sidecar");
    expect(raws[0].payload.tableName).toBe("group_msg_table");
    expect(raws[0].payload.senderName).toBe("疯子");
    expect(raws[1].payload.isGroup).toBe(false);

    const merged = {
      events: [],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged))
        if (Array.isArray(n[k])) merged[k].push(...n[k]);
    }
    const { valid } = partitionBatch(merged);
    expect(valid.events.length).toBe(2);
    const texts = valid.events.map((e) => e.content && e.content.text);
    expect(texts).toContain("保持高贵的沉默。");
    expect(
      valid.events.find((e) => e.content.text === "保持高贵的沉默。").extra
        .senderName,
    ).toBe("疯子");
  });
});
