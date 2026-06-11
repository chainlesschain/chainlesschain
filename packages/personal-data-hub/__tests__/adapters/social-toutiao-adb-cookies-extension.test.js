"use strict";

import { describe, it, expect, vi } from "vitest";

const {
  createToutiaoCookiesExtension,
  TOUTIAO_COOKIES_REMOTE_PATH,
  TOUTIAO_COOKIE_HOST_DOMAIN,
  TOUTIAO_SESSION_COOKIES,
  TOUTIAO_UID_COOKIES,
  assembleToutiaoCookieHeader,
  _internals,
} = require("../../lib/adapters/social-toutiao-adb/cookies-extension");

describe("constants", () => {
  it("path points to com.ss.android.article.news WebView cookies", () => {
    expect(TOUTIAO_COOKIES_REMOTE_PATH).toBe(
      "/data/data/com.ss.android.article.news/app_webview/Default/Cookies",
    );
  });

  it("host domain is toutiao.com", () => {
    expect(TOUTIAO_COOKIE_HOST_DOMAIN).toBe("toutiao.com");
  });

  it("session cookies enumerated (lenient — sessionid OR sessionid_ss)", () => {
    expect([...TOUTIAO_SESSION_COOKIES]).toEqual(["sessionid", "sessionid_ss"]);
  });

  it("uid cookie candidates in priority order", () => {
    expect([...TOUTIAO_UID_COOKIES]).toEqual([
      "passport_uid",
      "multi_sids",
      "__ac_uid",
      "tt_uid",
    ]);
  });
});

describe("pickUidFromCookieMap", () => {
  const make = (entries) => new Map(entries.map(([k, v]) => [k, { value: v }]));

  it("prefers passport_uid", () => {
    const map = make([
      ["passport_uid", "12345"],
      ["__ac_uid", "99999"],
    ]);
    expect(_internals.pickUidFromCookieMap(map)).toBe("12345");
  });

  it("falls back to multi_sids first segment", () => {
    const map = make([["multi_sids", "67890:abcd;11111:efgh"]]);
    expect(_internals.pickUidFromCookieMap(map)).toBe("67890");
  });

  it("falls back to __ac_uid when passport + multi missing", () => {
    const map = make([["__ac_uid", "555"]]);
    expect(_internals.pickUidFromCookieMap(map)).toBe("555");
  });

  it("falls back to tt_uid (legacy) when above missing", () => {
    const map = make([["tt_uid", "777"]]);
    expect(_internals.pickUidFromCookieMap(map)).toBe("777");
  });

  it("returns null for '0' values (guest sentinel)", () => {
    const map = make([
      ["passport_uid", "0"],
      ["__ac_uid", "0"],
    ]);
    expect(_internals.pickUidFromCookieMap(map)).toBe(null);
  });

  it("returns null for non-numeric values", () => {
    const map = make([["passport_uid", "notnumeric"]]);
    expect(_internals.pickUidFromCookieMap(map)).toBe(null);
  });

  it("returns null when none of the uid candidates present", () => {
    const map = make([["sessionid", "abc"]]);
    expect(_internals.pickUidFromCookieMap(map)).toBe(null);
  });
});

describe("assembleToutiaoCookieHeader", () => {
  const mkCookie = (name, value, hostKey = ".toutiao.com") => ({
    name,
    value,
    hostKey,
  });

  it("builds header from a session + uid cookie", () => {
    const cookies = [
      mkCookie("sessionid", "sessabc"),
      mkCookie("passport_uid", "12345"),
    ];
    const r = assembleToutiaoCookieHeader(cookies);
    expect(r.header).toContain("sessionid=sessabc");
    expect(r.header).toContain("passport_uid=12345");
    expect(r.uid).toBe("12345");
    expect(r.missing).toEqual([]);
  });

  it("succeeds with only sessionid_ss (no sessionid)", () => {
    const cookies = [
      mkCookie("sessionid_ss", "altsess"),
      mkCookie("passport_uid", "999"),
    ];
    const r = assembleToutiaoCookieHeader(cookies);
    expect(r.header).toContain("sessionid_ss=altsess");
    expect(r.uid).toBe("999");
    expect(r.missing).toEqual([]);
  });

  it("returns null header when no session cookie present", () => {
    const cookies = [mkCookie("passport_uid", "12345")];
    const r = assembleToutiaoCookieHeader(cookies);
    expect(r.header).toBe(null);
    expect(r.uid).toBe(null);
    expect(r.missing).toEqual(["sessionid", "sessionid_ss"]);
  });

  it("succeeds without any uid cookie (uid=null, fetchProfile fills later)", () => {
    const cookies = [
      mkCookie("sessionid", "sess"),
      mkCookie("ttwid", "anonid"),
    ];
    const r = assembleToutiaoCookieHeader(cookies);
    expect(r.header).toContain("sessionid=sess");
    expect(r.uid).toBe(null);
    expect(r.missing).toEqual([]);
  });

  it("dedupes by longest hostKey when same name appears twice", () => {
    const cookies = [
      mkCookie("sessionid", "subdomain-val", "www.toutiao.com"),
      mkCookie("sessionid", "wildcard-val", ".toutiao.com"),
      mkCookie("passport_uid", "1"),
    ];
    const r = assembleToutiaoCookieHeader(cookies);
    // www.toutiao.com (16 chars) > .toutiao.com (12 chars) — longest wins
    expect(r.header).toContain("sessionid=subdomain-val");
  });

  it("throws TypeError on non-array input", () => {
    expect(() => assembleToutiaoCookieHeader(null)).toThrow(TypeError);
    expect(() => assembleToutiaoCookieHeader("string")).toThrow(TypeError);
  });
});

describe("createToutiaoCookiesExtension", () => {
  it("rejects when ctx missing required functions", async () => {
    const ext = createToutiaoCookiesExtension();
    await expect(ext({}, {})).rejects.toThrow(/ctx must provide/);
  });

  it("rejects when ctx.adb is not a function", async () => {
    const ext = createToutiaoCookiesExtension();
    await expect(
      ext({}, { adb: null, pickDevice: () => "serial" }),
    ).rejects.toThrow(/ctx must provide/);
  });
});

describe("pullCookiesViaSu — installed-vs-not-installed diagnosis", () => {
  function makeAdb({ ls, pm }) {
    return async (args) => {
      const cmd = args.join(" ");
      if (cmd.includes("pm list packages")) return pm || "";
      if (cmd.includes("ls ")) return ls;
      throw new Error("fake adb: unexpected command " + cmd);
    };
  }

  it("throws TOUTIAO_NOT_INSTALLED when cookies absent AND package not installed", async () => {
    const adb = makeAdb({ ls: "NOT_FOUND\r\n", pm: "" });
    await expect(
      _internals.pullCookiesViaSu(adb, "serial", {}),
    ).rejects.toThrow(/TOUTIAO_NOT_INSTALLED/);
  });

  it("throws TOUTIAO_NO_WEBVIEW_COOKIES when cookies absent but package installed (real-device 2026-06-11)", async () => {
    // Verified on device 5lhyaqu8lbwstc6x: com.ss.android.article.news
    // installed but no webview cookie store → must NOT say NOT_INSTALLED.
    const adb = makeAdb({
      ls: "NOT_FOUND\r\n",
      pm: "package:com.ss.android.article.news\r\n",
    });
    await expect(
      _internals.pullCookiesViaSu(adb, "serial", {}),
    ).rejects.toThrow(/TOUTIAO_NO_WEBVIEW_COOKIES/);
  });
});
