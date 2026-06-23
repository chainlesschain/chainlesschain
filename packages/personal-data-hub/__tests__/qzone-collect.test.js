"use strict";

/**
 * forensics/qzone-collect.js — the QQ空间 (Qzone) collector core behind
 * `cc hub collect-qzone` and the Android in-app WebView capture.
 *
 * gtk(): bkn/g_tk hash, live-verified vector (gtk("a1yMkIHucG") === 1523373176).
 * parsers: _Callback-wrapped JSON → vault events (说说→post, 留言板→message,
 * 相册→media), skip empty shells, surface API error codes, strip留言 html.
 * collectQzone(): orchestrates the 3 sources with an INJECTED fetch (offline).
 */

import { test } from "vitest";
const assert = require("node:assert");
const { gtk, parseQzoneFeed, parseGuestbook, parseAlbums, stripHtml, collectQzone, SELF_ID } = require("../lib/forensics/qzone-collect.js");

test("gtk: deterministic bkn hash (live-verified vector)", () => {
  assert.equal(gtk("a1yMkIHucG"), 1523373176);
  assert.equal(gtk(""), 5381);
});

test("parseQzoneFeed: _Callback → EVENT(post), skips empty, counts media", () => {
  const resp =
    '_Callback({"code":0,"total":2,"msglist":[' +
    '{"tid":"abc","created_time":1700000000,"content":"测试说说","pic":[{},{}]},' +
    '{"tid":"def","created_time":1700000100,"content":"","pic":[]}]});';
  const r = parseQzoneFeed(resp);
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.id, "qzone:abc");
  assert.equal(e.subtype, "post");
  assert.equal(e.actor, SELF_ID);
  assert.equal(e.content.title, "测试说说");
  assert.equal(e.occurredAt, 1700000000 * 1000);
  assert.equal(e.extra.mediaCount, 2);
});

test("stripHtml + parseGuestbook: get_msgb → EVENT(message) by commenter", () => {
  assert.equal(stripHtml('你好<img src="x">世界&nbsp;!'), "你好世界 !");
  const gb = JSON.stringify({ code: 0, data: { total: 2, commentList: [
    { id: "100", pubtime: "2019-01-17 01:42:43", uin: 659413197, nickname: "兰德", htmlContent: '嗨<img src="x">' },
    { id: "101", pubtime: "2014-09-08 10:00:00", uin: 0, nickname: "", htmlContent: "" },
  ] } });
  const r = parseGuestbook(gb);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].id, "qzone-msgb:100");
  assert.equal(r.events[0].subtype, "message");
  assert.equal(r.events[0].actor, "person-qq-659413197");
  assert.deepEqual(r.events[0].participants, ["person-qq-659413197", SELF_ID]);
  assert.equal(r.events[0].content.text, "嗨");
  assert.equal(r.events[0].occurredAt, Date.parse("2019-01-17T01:42:43+08:00"));
  assert.equal(r.persons.length, 1);
});

test("parseAlbums: fcg_list_album_v3 → EVENT(media) per album", () => {
  const al = JSON.stringify({ code: 0, data: { albumsInUser: 2, albumList: [{ id: "abc", name: "玩", total: 8, createtime: 1211023986 }] } });
  const r = parseAlbums(al);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].id, "qzone-album:abc");
  assert.equal(r.events[0].subtype, "media");
  assert.equal(r.events[0].extra.photoCount, 8);
});

test("parsers surface API auth error (请先登录空间)", () => {
  assert.equal(parseQzoneFeed('_Callback({"code":-3000,"message":"请先登录空间"});').code, -3000);
  assert.equal(parseGuestbook('{"code":-3000}').code, -3000);
  assert.equal(parseAlbums('{"code":-10000}').events.length, 0);
});

function fakeFetch(routes) {
  return async (url) => {
    for (const frag of Object.keys(routes)) if (url.includes(frag)) return { text: async () => routes[frag] };
    return { text: async () => '{"code":0,"msglist":[]}' };
  };
}

test("collectQzone: orchestrates 3 sources with injected fetch", async () => {
  const feed = JSON.stringify({ code: 0, total: 1, msglist: [{ tid: "t1", created_time: 1700000000, content: "hi" }] });
  const gb = JSON.stringify({ code: 0, data: { total: 1, commentList: [{ id: "g1", pubtime: "2019-01-17 01:42:43", uin: 123, nickname: "A", htmlContent: "hey" }] } });
  const al = JSON.stringify({ code: 0, data: { albumsInUser: 1, albumList: [{ id: "a1", name: "X", total: 3, createtime: 1211023986 }] } });
  const r = await collectQzone({
    uin: "896075341", cookie: "uin=o0896075341; p_skey=abc",
    what: ["shuoshuo", "msgb", "album"], max: 40,
    fetchImpl: fakeFetch({ emotion_cgi_msglist: feed, get_msgb: gb, fcg_list_album: al }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.uin, "896075341");
  assert.deepEqual(r.counts, { shuoshuo: 1, msgb: 1, album: 1 });
  assert.equal(r.events.length, 3);
  assert.equal(r.persons.length, 1); // guestbook commenter
});

test("collectQzone: missing p_skey → ok:false (no fetch attempted)", async () => {
  const r = await collectQzone({ uin: "1", cookie: "uin=o01", fetchImpl: fakeFetch({}) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /p_skey/);
});
