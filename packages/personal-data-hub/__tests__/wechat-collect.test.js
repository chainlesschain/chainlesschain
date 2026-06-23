"use strict";

/**
 * forensics/wechat-collect.js parseEvents — the root-staged EnMicroMsg.db parser
 * used by `cc hub collect-wechat` (and the Android in-APK collector).
 *
 * Regression for the on-device IM analysis gaps found on a real device:
 *   - it must emit NAMED person records (rcontact conRemark/nickname) so
 *     relations/overview show names, not raw wxids;
 *   - self (outbound) must map to the canonical person-wechat-self (+ extra.isSend)
 *     so analysis excludes the account owner from contact rankings;
 *   - group chats must emit NAMED topic records so interests rank by engagement;
 *   - every person/topic needs a UNIQUE source.originalId (a shared one collapsed
 *     all 220 contacts into 1 row via the persons (adapter, originalId) unique index);
 *   - events carry a clean content.title for the timeline.
 */

import { test } from "vitest";
const assert = require("node:assert");
const { parseEvents } = require("../lib/forensics/wechat-collect.js");

// Minimal fake better-sqlite3: prepare() routes by which table the SQL hits.
function fakeDb({ contacts, messages }) {
  return function FakeDatabase() {
    return {
      prepare(sql) {
        const rows = /rcontact/.test(sql) ? contacts : messages;
        return { all: () => rows };
      },
      close() {},
    };
  };
}

test("parseEvents: named persons + canonical self + named topics + titles", () => {
  const contacts = [
    { username: "wxid_friend", nickname: "小明", conRemark: "老同学小明" },
    { username: "wxid_boss", nickname: "李总", conRemark: "" },
    { username: "12345@chatroom", nickname: "兼职群", conRemark: "" },
  ];
  const messages = [
    // inbound 1-on-1 from wxid_friend
    { msgId: 1, type: 1, isSend: 0, createTime: 1700000001000, talker: "wxid_friend", content: "在吗" },
    // outbound (self) to wxid_friend
    { msgId: 2, type: 1, isSend: 1, createTime: 1700000002000, talker: "wxid_friend", content: "在的  你说" },
    // inbound 1-on-1 from wxid_boss
    { msgId: 3, type: 1, isSend: 0, createTime: 1700000003000, talker: "wxid_boss", content: "明天开会" },
    // group message (sender prefix "wxid_x:")
    { msgId: 4, type: 1, isSend: 0, createTime: 1700000004000, talker: "12345@chatroom", content: "wxid_friend:\n招钟点工 100一天" },
  ];

  const { events, persons, topics } = parseEvents(fakeDb({ contacts, messages }), "/x.db", "ignored-self-arg");

  // events: one per message (4)
  assert.equal(events.length, 4);
  // self (outbound) actor = canonical person-wechat-self + extra.isSend
  const out = events.find((e) => e.id === "wechat:2");
  assert.equal(out.actor, "person-wechat-self");
  assert.equal(out.extra.isSend, true);
  // inbound actor = the peer, with a clean title (not empty)
  const inb = events.find((e) => e.id === "wechat:1");
  assert.equal(inb.actor, "person-wechat-wxid_friend");
  assert.equal(inb.content.title, "在吗");

  // persons: named, include self, each with a UNIQUE source.originalId
  const byId = Object.fromEntries(persons.map((p) => [p.id, p]));
  assert.equal(byId["person-wechat-wxid_friend"].names[0], "老同学小明"); // conRemark wins
  assert.equal(byId["person-wechat-wxid_boss"].names[0], "李总"); // nickname fallback
  assert.equal(byId["person-wechat-self"].names[0], "我(微信)");
  for (const p of persons) assert.equal(p.subtype, "contact");
  const origIds = persons.map((p) => p.source.originalId);
  assert.equal(new Set(origIds).size, origIds.length, "person originalIds must be unique");

  // topics: the group, named, referenced by the group event
  const gt = topics.find((t) => t.id === "group-wechat-12345@chatroom");
  assert.ok(gt, "group topic emitted");
  assert.equal(gt.name, "兼职群");
  const ge = events.find((e) => e.id === "wechat:4");
  assert.deepEqual(ge.topics, ["group-wechat-12345@chatroom"]);
  // group sender prefix stripped → the real sender is a named person
  assert.equal(ge.actor, "person-wechat-wxid_friend");
});
