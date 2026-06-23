/**
 * Unit tests for scripts/android/pdh-qzone-collect.mjs pure functions.
 *
 * gtk(): the Qzone bkn/g_tk hash (verified live against emotion_cgi_msglist_v6 —
 * gtk("a1yMkIHucG") === 1523373176 was the token the live API accepted).
 * parseQzoneFeed(): strips the _Callback(...) JSONP wrapper, maps msglist 说说
 * → EVENT(post), skips empty shells, surfaces API error codes (请先登录空间).
 *
 * Runs with `node --test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gtk, parseQzoneFeed, parseGuestbook, parseAlbums, stripHtml, SELF_ID } from "../android/pdh-qzone-collect.mjs";

test("gtk: deterministic bkn hash (live-verified vector)", () => {
  assert.equal(gtk("a1yMkIHucG"), 1523373176);
  assert.equal(gtk(""), 5381); // hash seed
  assert.equal(typeof gtk("x"), "number");
});

test("parseQzoneFeed: _Callback wrapper → EVENT(post), skips empty, counts media", () => {
  const resp =
    '_Callback({"code":0,"total":2,"msglist":[' +
    '{"tid":"abc","created_time":1700000000,"content":"测试说说","pic":[{},{}],"cmtnum":3},' +
    '{"tid":"def","created_time":1700000100,"content":"","pic":[]}' + // no text + no pic → skipped
    "]});";
  const r = parseQzoneFeed(resp, "123");
  assert.equal(r.code, 0);
  assert.equal(r.total, 2);
  assert.equal(r.events.length, 1); // empty one dropped
  const e = r.events[0];
  assert.equal(e.id, "qzone:abc");
  assert.equal(e.subtype, "post");
  assert.equal(e.actor, SELF_ID);
  assert.equal(e.content.title, "测试说说");
  assert.equal(e.occurredAt, 1700000000 * 1000); // seconds → ms
  assert.equal(e.extra.kind, "qzone-shuoshuo");
  assert.equal(e.extra.mediaCount, 2);
  assert.equal(e.extra.cmtnum, 3);
});

test("parseQzoneFeed: pic-only post keeps a placeholder title", () => {
  const r = parseQzoneFeed('_Callback({"code":0,"msglist":[{"tid":"p1","created_time":1700000200,"content":"","pic":[{}]}]});', "123");
  assert.equal(r.events.length, 1);
  assert.match(r.events[0].content.title, /图片/);
  assert.equal(r.events[0].extra.mediaCount, 1);
});

test("parseQzoneFeed: surfaces API auth error (请先登录空间), no events", () => {
  const r = parseQzoneFeed('_Callback({"code":-3000,"message":"请先登录空间"});', "123");
  assert.equal(r.code, -3000);
  assert.equal(r.events.length, 0);
});

test("parseQzoneFeed: tolerates plain JSON (no _Callback) and garbage", () => {
  const ok = parseQzoneFeed('{"code":0,"msglist":[{"tid":"t","created_time":1700000000,"content":"hi"}]}', "1");
  assert.equal(ok.events.length, 1);
  const bad = parseQzoneFeed("not json at all", "1");
  assert.equal(bad.code, -1);
  assert.equal(bad.events.length, 0);
});

test("stripHtml: drops img/tags + decodes entities + collapses space", () => {
  assert.equal(stripHtml("<b>hi</b>&nbsp;there"), "hi there");
  assert.equal(stripHtml('你好<img src="x.png">世界'), "你好世界");
  assert.equal(stripHtml("a &amp; b &lt;c&gt;"), "a & b <c>");
});

test("parseGuestbook: get_msgb → EVENT(message) by commenter, html stripped, persons", () => {
  const gb = JSON.stringify({ code: 0, data: { total: 2, commentList: [
    { id: "100", pubtime: "2019-01-17 01:42:43", uin: 659413197, nickname: "兰德", htmlContent: '你好<img src="x">世界' },
    { id: "101", pubtime: "2014-09-08 10:00:00", uin: 0, nickname: "", htmlContent: "" }, // empty → skipped
  ] } });
  const r = parseGuestbook(gb, "896075341");
  assert.equal(r.code, 0);
  assert.equal(r.total, 2);
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.id, "qzone-msgb:100");
  assert.equal(e.subtype, "message");
  assert.equal(e.actor, "person-qq-659413197");
  assert.deepEqual(e.participants, ["person-qq-659413197", SELF_ID]);
  assert.equal(e.content.text, "你好世界"); // img stripped
  assert.equal(e.extra.kind, "qzone-guestbook");
  assert.equal(e.extra.fromNick, "兰德");
  assert.equal(e.occurredAt, Date.parse("2019-01-17T01:42:43+08:00")); // Beijing tz
  assert.equal(r.persons.length, 1);
  assert.equal(r.persons[0].id, "person-qq-659413197");
  assert.deepEqual(r.persons[0].names, ["兰德", "659413197"]);
});

test("parseAlbums: fcg_list_album_v3 → EVENT(media) per album", () => {
  const al = JSON.stringify({ code: 0, data: { albumsInUser: 2, albumList: [
    { id: "abc", name: "玩", total: 8, createtime: 1211023986, desc: "", comment: 7 },
  ] } });
  const r = parseAlbums(al, "1");
  assert.equal(r.events.length, 1);
  assert.equal(r.total, 2);
  const e = r.events[0];
  assert.equal(e.id, "qzone-album:abc");
  assert.equal(e.subtype, "media");
  assert.equal(e.actor, SELF_ID);
  assert.match(e.content.title, /玩.*8/);
  assert.equal(e.extra.kind, "qzone-album");
  assert.equal(e.extra.photoCount, 8);
  assert.equal(e.occurredAt, 1211023986 * 1000);
});

test("parseGuestbook / parseAlbums: surface API error codes", () => {
  assert.equal(parseGuestbook('{"code":-3000,"message":"请先登录空间"}', "1").code, -3000);
  assert.equal(parseAlbums('{"code":-10000,"message":"no permission"}', "1").events.length, 0);
});
