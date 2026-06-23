"use strict";

/**
 * forensics/qq-nt-collect.js parseEvents — root-staged QQNT nt_msg.db parser
 * used by `cc hub collect-qq`. Mirrors wechat-collect: emit named contacts
 * (sender nickname 40090), canonical self (sender uid 40020 === matched account
 * uid → person-qq-self), group topics, clean titles, unique source.originalId.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { parseEvents, bodyText } = require("../lib/forensics/qq-nt-collect.js");

// Minimal protobuf body: field 1 (tag 0x0A), length-delimited UTF-8 string.
function body(text) {
  const b = Buffer.from(text, "utf8");
  return Buffer.concat([Buffer.from([0x0a, b.length]), b]);
}

// Fake better-sqlite3: prepare(sql) routes by table name; .safeIntegers() chains.
function fakeDb({ c2c, group }) {
  return function FakeDatabase() {
    return {
      prepare(sql) {
        const rows = /c2c_msg_table/.test(sql) ? c2c : /group_msg_table/.test(sql) ? group : [];
        return { safeIntegers: () => ({ all: () => rows }), all: () => rows };
      },
      close() {},
    };
  };
}

test("bodyText extracts a CJK string from a minimal protobuf body", () => {
  assert.equal(bodyText(body("你好世界")), "你好世界");
});

test("parseEvents: named QQ contacts + canonical self + group topics + titles", () => {
  const SELF_UID = "u_SelfAccount______";
  const c2c = [
    // inbound from QQ 10001 (nick 阿强)
    { msgId: 1n, uid: "u_friendAAA", type: 1n, sender: 10001n, peer: 10001n, t: 1700000001n, nick: "阿强", body: body("在吗") },
    // outbound (self): sender uid == matched account uid
    { msgId: 2n, uid: SELF_UID, type: 1n, sender: 99999n, peer: 10001n, t: 1700000002n, nick: "我自己", body: body("在的 你说") },
  ];
  const group = [
    { msgId: 3n, uid: "u_friendBBB", type: 1n, sender: 20002n, peer: 88888n, t: 1700000003n, nick: "群友老李", body: body("周末爬山") },
  ];

  const { events, persons, topics } = parseEvents(fakeDb({ c2c, group }), "/x.db", { selfUid: SELF_UID, self: "99999" });

  assert.equal(events.length, 3);
  // self (outbound) → canonical person-qq-self + extra.isSelf
  const out = events.find((e) => e.id === "qq:c2c_msg_table:2");
  assert.equal(out.actor, "person-qq-self");
  assert.equal(out.extra.isSelf, true);
  // inbound → peer actor, clean title
  const inb = events.find((e) => e.id === "qq:c2c_msg_table:1");
  assert.equal(inb.actor, "person-qq-10001");
  assert.equal(inb.content.title, "在吗");

  // persons: named from nick, self present, unique originalIds
  const byId = Object.fromEntries(persons.map((p) => [p.id, p]));
  assert.equal(byId["person-qq-10001"].names[0], "阿强");
  assert.equal(byId["person-qq-20002"].names[0], "群友老李");
  assert.equal(byId["person-qq-self"].names[0], "我(QQ)");
  assert.ok(!byId["person-qq-99999"], "self uin not emitted as a separate contact");
  for (const p of persons) assert.equal(p.subtype, "contact");
  const oids = persons.map((p) => p.source.originalId);
  assert.equal(new Set(oids).size, oids.length, "person originalIds unique");

  // group topic emitted + referenced
  const gt = topics.find((t) => t.id === "group-qq-88888");
  assert.ok(gt);
  assert.deepEqual(events.find((e) => e.id === "qq:group_msg_table:3").topics, ["group-qq-88888"]);
});
