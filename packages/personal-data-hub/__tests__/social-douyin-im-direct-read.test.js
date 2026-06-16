"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { DouyinAdapter } = require("../lib/adapters/social-douyin");
const { partitionBatch } = require("../lib/batch");

/**
 * 本地直读样板 (Douyin <uid>_im.db local direct-read) + the normalize
 * message/contact gap fix.
 *
 * Two things this covers that nothing else did:
 *
 *  1. REGRESSION: DouyinAdapter.normalize() used to throw "unknown kind
 *     message/contact" for IM events — so every 私信 + 联系人 silently
 *     dropped (registry catches the throw → invalidCount++ → 0 rows in the
 *     vault) even though the snapshot/ADB path "succeeded". The old snapshot
 *     test only round-tripped `profile`, so it never caught this.
 *
 *  2. NEW direct-read mode: `sync({ imDbPath })` / `--input <uid>_im.db`
 *     opens the plaintext SQLite directly (no ADB, no snapshot JSON) and
 *     emits message/contact raws whose originalIds match the snapshot path
 *     (idempotent across both routes).
 *
 * No native SQLite needed — a fake Database driver is injected via
 * `_deps.dbDriverFactory` (the parser accepts it as `_databaseClass`).
 */

// Fake better-sqlite3-style driver answering the parser's PRAGMA + SELECTs.
function makeFakeDb({ msgRows, userRows, msgCols, userCols, partCols, partRows, convCols, convRows }) {
  class FakeStmt {
    constructor(sql) {
      this.sql = sql;
    }
    all() {
      const s = this.sql;
      if (/PRAGMA table_info\(msg\)/.test(s)) return msgCols;
      if (/FROM msg/.test(s)) return msgRows;
      if (/PRAGMA table_info\(SIMPLE_USER\)/.test(s)) return userCols || [];
      if (/FROM SIMPLE_USER/.test(s)) return userRows || [];
      if (/PRAGMA table_info\(participant\)/.test(s)) return partCols || [];
      if (/FROM participant/.test(s)) return partRows || [];
      if (/PRAGMA table_info\(conversation_list\)/.test(s)) return convCols || [];
      if (/FROM conversation_list/.test(s)) return convRows || [];
      return [];
    }
  }
  return class FakeDb {
    // eslint-disable-next-line no-unused-vars
    constructor(_path, _opts) {}
    prepare(sql) {
      return new FakeStmt(sql);
    }
    close() {}
  };
}

const DEFAULT_FAKE = {
  msgCols: [
    { name: "sender" },
    { name: "created_time" },
    { name: "content" },
    { name: "conversation_id" },
    { name: "read_status" },
  ],
  msgRows: [
    {
      sender: 111,
      createdTime: 1700000000000,
      content: JSON.stringify({ text: "你好呀" }),
      conversationId: "conv-1",
      readStatus: 1,
    },
    {
      sender: 222,
      createdTime: 1700000001000,
      content: JSON.stringify({ text: "在吗" }),
      conversationId: "conv-1",
      readStatus: 0,
    },
  ],
  userCols: [
    { name: "UID" },
    { name: "short_id" },
    { name: "name" },
    { name: "avatar_url" },
    { name: "follow_status" },
  ],
  userRows: [
    {
      uid: 222,
      shortId: 888,
      name: "小明",
      avatarUrl: "http://x/a.jpg",
      followStatus: 2,
    },
  ],
};

function freshAdapter(fakeSpec = DEFAULT_FAKE, fsOverride) {
  const a = new DouyinAdapter();
  a._deps.fs = fsOverride || { existsSync: () => true };
  a._deps.dbDriverFactory = () => makeFakeDb(fakeSpec);
  return a;
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("DouyinAdapter — normalize message/contact (regression)", () => {
  it("normalizes a message raw into one MESSAGE event (no throw)", () => {
    const a = new DouyinAdapter();
    const raw = {
      adapter: "social-douyin",
      kind: "message",
      originalId: "douyin:message:msg-conv-1-1700000000000",
      capturedAt: 1700000000000,
      payload: {
        kind: "message",
        text: "你好",
        senderUid: "111",
        conversationId: "conv-1",
        readStatus: 1,
        contentBlob: '{"text":"你好"}',
      },
    };
    const n = a.normalize(raw);
    expect(n.events).toHaveLength(1);
    expect(n.persons).toHaveLength(0);
    const ev = n.events[0];
    expect(ev.subtype).toBe("message");
    expect(ev.content.text).toBe("你好");
    expect(ev.extra.senderUid).toBe("111");
    expect(ev.extra.conversationId).toBe("conv-1");
    expect(ev.extra.platform).toBe("douyin");
  });

  it("normalizes a contact raw into one CONTACT person", () => {
    const a = new DouyinAdapter();
    const raw = {
      adapter: "social-douyin",
      kind: "contact",
      originalId: "douyin:contact:contact-222",
      capturedAt: 1700000000000,
      payload: {
        kind: "contact",
        uid: "222",
        shortId: "888",
        name: "小明",
        avatarUrl: "http://x/a.jpg",
        followStatus: 2,
      },
    };
    const n = a.normalize(raw);
    expect(n.persons).toHaveLength(1);
    expect(n.events).toHaveLength(0);
    const per = n.persons[0];
    expect(per.subtype).toBe("contact");
    expect(per.id).toBe("person-douyin-222");
    expect(per.names).toEqual(["小明"]);
    expect(per.identifiers["douyin-uid"]).toEqual(["222"]);
    expect(per.extra.followStatus).toBe(2);
  });

  it("an empty-text (non-text) message still produces a valid event", () => {
    const a = new DouyinAdapter();
    const raw = {
      adapter: "social-douyin",
      kind: "message",
      originalId: "douyin:message:x",
      capturedAt: 1700000000000,
      payload: { kind: "message", text: null, senderUid: "111" },
    };
    const n = a.normalize(raw);
    const { valid, invalidReasons } = partitionBatch({
      events: n.events,
      persons: [],
      places: [],
      items: [],
      topics: [],
    });
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(1);
  });
});

describe("DouyinAdapter — 本地直读 <uid>_im.db", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-imdb-"));
  });
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("sync({ imDbPath }) yields message + contact raws", async () => {
    const a = freshAdapter();
    const raws = await collect(a.sync({ imDbPath: "/fake/123_im.db" }));
    expect(raws.map((r) => r.kind)).toEqual(["message", "message", "contact"]);
  });

  it("direct-read events normalize to a fully valid batch (no silent drop)", async () => {
    const a = freshAdapter();
    const raws = await collect(a.sync({ imDbPath: "/fake/123_im.db" }));
    const merged = { events: [], persons: [], places: [], items: [], topics: [] };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged)) merged[k].push(...n[k]);
    }
    const { valid, invalidReasons } = partitionBatch(merged);
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(2); // two messages
    expect(valid.persons).toHaveLength(1); // one contact
  });

  it("originalIds match the snapshot composite strategy (idempotent across routes)", async () => {
    const a = freshAdapter();
    const raws = await collect(a.sync({ imDbPath: "/fake/123_im.db" }));
    expect(raws.map((r) => r.originalId)).toEqual([
      "douyin:message:msg-conv-1-1700000000000",
      "douyin:message:msg-conv-1-1700000001000",
      "douyin:contact:contact-222",
    ]);
  });

  it("respects include={message:false} / limit", async () => {
    const a = freshAdapter();
    const onlyContacts = await collect(
      a.sync({ imDbPath: "/fake/123_im.db", include: { message: false } }),
    );
    expect(onlyContacts.every((r) => r.kind === "contact")).toBe(true);

    const capped = await collect(a.sync({ imDbPath: "/fake/123_im.db", limit: 1 }));
    expect(capped).toHaveLength(1);
  });

  it("emits an im-db-parsed progress event with the diagnostic", async () => {
    const a = freshAdapter();
    const events = [];
    await collect(
      a.sync({
        imDbPath: "/fake/123_im.db",
        onProgress: (e) => events.push(e),
      }),
    );
    const parsed = events.find((e) => e.phase === "im-db-parsed");
    expect(parsed).toBeTruthy();
    expect(parsed.hadMsgTable).toBe(true);
    expect(parsed.hadSimpleUserTable).toBe(true);
    expect(parsed.messageCount).toBe(2);
    expect(parsed.contactCount).toBe(1);
  });

  it("missing db file yields nothing (no throw)", async () => {
    const a = freshAdapter(DEFAULT_FAKE, { existsSync: () => false });
    const raws = await collect(a.sync({ imDbPath: "/does/not/exist_im.db" }));
    expect(raws).toHaveLength(0);
  });

  // device-verified 2026-06-16: real Douyin IM schema uses `participant`
  // (conversation_id, user_id), not SIMPLE_USER → contacts must come from it.
  it("extracts contacts from `participant` when SIMPLE_USER absent (real schema)", async () => {
    const spec = {
      msgCols: DEFAULT_FAKE.msgCols,
      msgRows: DEFAULT_FAKE.msgRows,
      userCols: [], // no SIMPLE_USER table on a real device
      userRows: [],
      partCols: [{ name: "conversation_id" }, { name: "user_id" }, { name: "sort_order" }],
      partRows: [{ uid: 111 }, { uid: 222 }, { uid: 222 }], // dup 222 → deduped
    };
    const a = freshAdapter(spec);
    const raws = await collect(a.sync({ imDbPath: "/fake/123_im.db" }));
    const contacts = raws.filter((r) => r.kind === "contact");
    expect(contacts.map((r) => r.payload.uid).sort()).toEqual(["111", "222"]);
    // each participant uid → a CONTACT person keyed by douyin-uid
    const n = a.normalize(contacts[0]);
    expect(n.persons[0].identifiers["douyin-uid"]).toEqual([contacts[0].payload.uid]);
  });

  // device-verified: conversation_list row → PDH TOPIC (one chat thread).
  it("maps conversation_list rows to TOPIC entities", async () => {
    const spec = {
      msgCols: DEFAULT_FAKE.msgCols,
      msgRows: DEFAULT_FAKE.msgRows,
      userCols: [], userRows: [],
      convCols: [
        { name: "conversation_id" }, { name: "type" },
        { name: "last_msg_create_time" }, { name: "stranger" },
      ],
      convRows: [
        { convId: "conv-1", convType: 0, lastMsgTime: 1700000002000, stranger: 0 },
        { convId: "conv-2", convType: 1, lastMsgTime: 1700000003000, stranger: 1 },
      ],
    };
    const a = freshAdapter(spec);
    const raws = await collect(a.sync({ imDbPath: "/fake/123_im.db" }));
    const convs = raws.filter((r) => r.kind === "conversation");
    expect(convs.map((r) => r.payload.conversationId)).toEqual(["conv-1", "conv-2"]);
    const n = a.normalize(convs[1]);
    expect(n.topics).toHaveLength(1);
    expect(n.topics[0].type).toBe("topic");
    expect(n.topics[0].extra.conversationId).toBe("conv-2");
    expect(n.topics[0].extra.stranger).toBe(true);
    expect(n.topics[0].extra.lastMsgTimeMs).toBe(1700000003000);
  });

  it("participant dedups against SIMPLE_USER contacts (no double-count)", async () => {
    const spec = {
      msgCols: DEFAULT_FAKE.msgCols,
      msgRows: DEFAULT_FAKE.msgRows,
      userCols: DEFAULT_FAKE.userCols,
      userRows: DEFAULT_FAKE.userRows, // uid 222 from SIMPLE_USER
      partCols: [{ name: "conversation_id" }, { name: "user_id" }],
      partRows: [{ uid: 222 }, { uid: 333 }], // 222 already seen, only 333 is new
    };
    const a = freshAdapter(spec);
    const raws = await collect(a.sync({ imDbPath: "/fake/123_im.db" }));
    const uids = raws.filter((r) => r.kind === "contact").map((r) => r.payload.uid).sort();
    expect(uids).toEqual(["222", "333"]); // 222 not duplicated
  });
});

describe("DouyinAdapter — sync() input routing (sniff)", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-route-"));
  });
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("--input <file with SQLite magic header> routes to direct IM read", async () => {
    // Real file with the 16-byte SQLite magic header so _looksLikeSqlite
    // (which uses real fs) returns true; the fake driver supplies the rows.
    const dbFile = path.join(tmpDir, "123_im.db");
    const header = Buffer.alloc(100);
    header.write("SQLite format 3 ", 0, "latin1");
    fs.writeFileSync(dbFile, header);

    const a = new DouyinAdapter();
    a._deps.dbDriverFactory = () => makeFakeDb(DEFAULT_FAKE);
    const raws = [];
    for await (const r of a.sync({ inputPath: dbFile })) raws.push(r);
    expect(raws.map((r) => r.kind)).toEqual(["message", "message", "contact"]);
  });

  it("--input <JSON snapshot> routes to snapshot mode (not IM)", async () => {
    const snapFile = path.join(tmpDir, "social-douyin.json");
    fs.writeFileSync(
      snapFile,
      JSON.stringify({
        schemaVersion: 1,
        snapshottedAt: 1700000000000,
        account: { secUid: "MS4abc", shortId: "9", displayName: "me" },
        events: [
          { kind: "profile", id: "profile-MS4abc", capturedAt: 1700000000000, secUid: "MS4abc", nickname: "me" },
        ],
      }),
    );
    const a = new DouyinAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: snapFile })) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(raws[0].kind).toBe("profile");
  });
});
