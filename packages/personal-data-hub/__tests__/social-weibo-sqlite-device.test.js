"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { WeiboAdapter } = require("../lib/adapters/social-weibo");
const {
  validateEvent,
  validatePerson,
  validateTopic,
} = require("../lib/schemas");

// §A8 sqlite mode — device-verified schema regression tests.
//
// The legacy sqlite path queried `post`/`status`/`search_history`, but a real
// Weibo install (Redmi M2104K10AC, 微博 16.5.3, verified 2026-06-16) has NO
// such tables — its data lives in `home_table` (timeline), `like_table`
// (likes), `follower_table` (following). So the legacy path silently
// collected ZERO on a real device. These tests pin the device-verified
// table/column mapping + the legacy fallback.
//
// A fake driver returns synthetic rows keyed off the table name in the SQL,
// and throws "no such table" for absent tables (mirroring better-sqlite3) so
// `trySelect` falls through exactly as on a real DB.

function makeFakeDriver(tables) {
  return function dbDriverFactory() {
    return class FakeDb {
      constructor() {}
      prepare(sql) {
        return {
          all: () => {
            for (const [name, rows] of Object.entries(tables)) {
              if (new RegExp(`FROM ${name}\\b`).test(sql)) return rows;
            }
            throw new Error("no such table");
          },
        };
      }
      close() {}
    };
  };
}

const SELF_UID = "2075014533";

// Device-verified column shapes.
const HOME_ROW = {
  mblogid: "MID_001",
  uid: SELF_UID,
  own_uid: SELF_UID,
  nick: "me",
  content: "今天去爬山了 ⛰️",
  time: "1718500000",
  src: "微博 weibo.com",
  rtnum: 3,
  commentnum: 7,
  attitudenum: 42,
};
const LIKE_ROW = {
  mblogid: "MID_LIKED",
  uid: "999",
  nick: "好友A",
  content: "一条被点赞的微博",
  time: "1718400000",
  attitudenum: 100,
};
const FOLLOW_ROW = {
  user_id: "555",
  id: "555",
  screen_name: "关注的人",
  remark: "",
  gender: "f",
  following: 1,
};

function newAdapter(tables) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weibo-sqlite-"));
  const dbPath = path.join(tmp, "sina_weibo");
  fs.writeFileSync(dbPath, "x"); // existsSync gate
  const a = new WeiboAdapter({
    account: { uid: SELF_UID },
    dbPath,
    dbDriverFactory: makeFakeDriver(tables),
  });
  return { a, dbPath, tmp };
}

async function collect(a, dbPath) {
  const out = [];
  for await (const raw of a.sync({ dbPath })) out.push(raw);
  return out;
}

describe("WeiboAdapter sqlite mode — device-verified schema", () => {
  let dirs = [];
  afterEach(() => {
    for (const d of dirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
    }
    dirs = [];
  });

  it("modern device (home/like/follower only) collects posts+favs+follows", async () => {
    const { a, dbPath, tmp } = newAdapter({
      home_table: [HOME_ROW],
      like_table: [LIKE_ROW],
      follower_table: [FOLLOW_ROW],
    });
    dirs.push(tmp);
    const raws = await collect(a, dbPath);
    const kinds = raws.map((r) => r.payload.kind).sort();
    expect(kinds).toEqual(["favourite", "follow", "post"]);
  });

  it("home_table post normalizes content/time/counts correctly", async () => {
    const { a, dbPath, tmp } = newAdapter({ home_table: [HOME_ROW] });
    dirs.push(tmp);
    const raws = await collect(a, dbPath);
    expect(raws).toHaveLength(1);
    const norm = a.normalize(raws[0]);
    const ev = norm.events[0];
    expect(ev.subtype).toBe("post");
    expect(ev.content.text).toBe("今天去爬山了 ⛰️");
    expect(ev.extra.weiboMid).toBe("MID_001");
    expect(ev.extra.likesCount).toBe(42);
    expect(ev.extra.repostsCount).toBe(3);
    expect(ev.extra.commentsCount).toBe(7);
    // time '1718500000' (epoch seconds) → ms
    expect(ev.occurredAt).toBe(1718500000 * 1000);
  });

  it("like_table normalizes to a LIKE event with author nick", async () => {
    const { a, dbPath, tmp } = newAdapter({ like_table: [LIKE_ROW] });
    dirs.push(tmp);
    const raws = await collect(a, dbPath);
    const norm = a.normalize(raws[0]);
    const ev = norm.events[0];
    expect(ev.subtype).toBe("like");
    expect(ev.content.text).toBe("一条被点赞的微博");
    expect(ev.extra.weiboMid).toBe("MID_LIKED");
    expect(ev.extra.authorScreenName).toBe("好友A");
  });

  it("follower_table normalizes to a CONTACT person with weibo-uid", async () => {
    const { a, dbPath, tmp } = newAdapter({ follower_table: [FOLLOW_ROW] });
    dirs.push(tmp);
    const raws = await collect(a, dbPath);
    const norm = a.normalize(raws[0]);
    expect(norm.events).toHaveLength(0);
    expect(norm.persons).toHaveLength(1);
    const person = norm.persons[0];
    expect(person.names).toEqual(["关注的人"]);
    expect(person.identifiers["weibo-uid"]).toEqual(["555"]);
  });

  it("legacy device (post table, no home_table) still works via fallback", async () => {
    const { a, dbPath, tmp } = newAdapter({
      post: [{ id: "L1", text: "legacy post", created_at: "1700000000", attitudes_count: 5 }],
    });
    dirs.push(tmp);
    const raws = await collect(a, dbPath);
    expect(raws).toHaveLength(1);
    const ev = a.normalize(raws[0]).events[0];
    expect(ev.subtype).toBe("post");
    expect(ev.content.text).toBe("legacy post");
    expect(ev.extra.likesCount).toBe(5);
  });

  it("empty DB (none of the tables exist) collects nothing, no throw", async () => {
    const { a, dbPath, tmp } = newAdapter({});
    dirs.push(tmp);
    const raws = await collect(a, dbPath);
    expect(raws).toEqual([]);
  });
});

// Private-message (私信) mode — device-verified message_<uid>.db schema
// (t_buddy/t_session/t_message), opt-in via opts.includeDm. Columns confirmed
// against a real populated device 2026-06-28.
const BUDDY_ROW = {
  uid: "888",
  nick: "昵称B",
  remark: "备注B",
  screen_name: "屏幕名B",
  gender: 1,
  verified: 1,
  follower: 100,
  following: 50,
};
const SESSION_ROW = {
  type: 1,
  session_id: "1001",
  last_message_id: "m1",
  update_time: "1718600000",
  im_unread_count: 3,
};
const MESSAGE_ROW = {
  id: 1,
  global_id: "g1",
  time: "1718600001",
  outgoing: 1,
  content_type: 1,
  content: "你好，在吗？",
  sender_id: SELF_UID,
  session_id: "1001",
};

function newAdapterDm(tables) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weibo-dm-"));
  const dbPath = path.join(tmp, "sina_weibo");
  fs.writeFileSync(dbPath, "x");
  // The DM reader gates on existsSync of the sibling message_<uid>.db.
  fs.writeFileSync(path.join(tmp, `message_${SELF_UID}.db`), "x");
  const a = new WeiboAdapter({
    account: { uid: SELF_UID },
    dbPath,
    dbDriverFactory: makeFakeDriver(tables),
  });
  return { a, dbPath, tmp };
}

async function collectDm(a, dbPath, opts = {}) {
  const out = [];
  for await (const raw of a.sync({ dbPath, ...opts })) out.push(raw);
  return out;
}

describe("WeiboAdapter sqlite mode — private messages (opt-in)", () => {
  let dirs = [];
  afterEach(() => {
    for (const d of dirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
    }
    dirs = [];
  });

  it("does NOT collect DM by default (high-sensitivity opt-in gate)", async () => {
    const { a, dbPath, tmp } = newAdapterDm({
      t_buddy: [BUDDY_ROW], t_session: [SESSION_ROW], t_message: [MESSAGE_ROW],
      home_table: [HOME_ROW],
    });
    dirs.push(tmp);
    const raws = await collectDm(a, dbPath); // no includeDm
    expect(raws.every((r) => !String(r.payload.kind).startsWith("dm-"))).toBe(true);
    expect(raws.map((r) => r.payload.kind)).toContain("post"); // non-DM still flows
  });

  it("collects buddies→PERSON, sessions→TOPIC, messages→EVENT when includeDm:true", async () => {
    const { a, dbPath, tmp } = newAdapterDm({
      t_buddy: [BUDDY_ROW], t_session: [SESSION_ROW], t_message: [MESSAGE_ROW],
    });
    dirs.push(tmp);
    const raws = await collectDm(a, dbPath, { includeDm: true });
    expect(raws.map((r) => r.payload.kind).sort()).toEqual([
      "dm-buddy", "dm-message", "dm-session",
    ]);
  });

  it("dm-buddy → CONTACT person (remark preferred), schema-valid", async () => {
    const { a, dbPath, tmp } = newAdapterDm({ t_buddy: [BUDDY_ROW] });
    dirs.push(tmp);
    const raws = await collectDm(a, dbPath, { includeDm: true });
    const norm = a.normalize(raws[0]);
    expect(norm.persons).toHaveLength(1);
    expect(norm.persons[0].names).toEqual(["备注B"]);
    expect(norm.persons[0].identifiers["weibo-uid"]).toEqual(["888"]);
    expect(norm.persons[0].extra.via).toBe("dm");
    expect(validatePerson(norm.persons[0]).valid).toBe(true);
  });

  it("dm-session → TOPIC with unread, schema-valid", async () => {
    const { a, dbPath, tmp } = newAdapterDm({ t_session: [SESSION_ROW] });
    dirs.push(tmp);
    const raws = await collectDm(a, dbPath, { includeDm: true });
    const norm = a.normalize(raws[0]);
    expect(norm.topics).toHaveLength(1);
    expect(norm.topics[0].type).toBe("topic");
    expect(norm.topics[0].extra.sessionId).toBe("1001");
    expect(norm.topics[0].extra.unread).toBe(3);
    expect(validateTopic(norm.topics[0]).valid).toBe(true);
  });

  it("dm-message → MESSAGE event (actor=self for outgoing), schema-valid", async () => {
    const { a, dbPath, tmp } = newAdapterDm({ t_message: [MESSAGE_ROW] });
    dirs.push(tmp);
    const raws = await collectDm(a, dbPath, { includeDm: true });
    const ev = a.normalize(raws[0]).events[0];
    expect(ev.subtype).toBe("message");
    expect(ev.actor).toBe("self");
    expect(ev.content.text).toBe("你好，在吗？");
    expect(ev.extra.sessionId).toBe("1001");
    expect(ev.occurredAt).toBe(1718600001 * 1000);
    expect(validateEvent(ev).valid).toBe(true);
  });

  it("non-text content_type → typed placeholder (no raw blob leak)", async () => {
    const { a, dbPath, tmp } = newAdapterDm({
      t_message: [{ ...MESSAGE_ROW, content_type: 7, content: "{...blob...}" }],
    });
    dirs.push(tmp);
    const raws = await collectDm(a, dbPath, { includeDm: true });
    expect(a.normalize(raws[0]).events[0].content.text).toBe("[type:7]");
  });

  it("incoming message → actor=contact", async () => {
    const { a, dbPath, tmp } = newAdapterDm({
      t_message: [{ ...MESSAGE_ROW, outgoing: 0, sender_id: "888" }],
    });
    dirs.push(tmp);
    const raws = await collectDm(a, dbPath, { includeDm: true });
    expect(a.normalize(raws[0]).events[0].actor).toBe("contact");
  });

  it("no message_<uid>.db file → DM silently skipped even with includeDm", async () => {
    // newAdapter (not newAdapterDm) writes only sina_weibo, no message db.
    const { a, dbPath, tmp } = newAdapter({ t_buddy: [BUDDY_ROW] });
    dirs.push(tmp);
    const raws = await collectDm(a, dbPath, { includeDm: true });
    expect(raws).toEqual([]);
  });
});
