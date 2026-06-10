"use strict";

import { describe, it, expect } from "vitest";

const {
  createKuaishouCookiesExtension,
  KUAISHOU_COOKIES_REMOTE_PATH,
  KUAISHOU_COOKIE_HOST_DOMAIN,
  KUAISHOU_LOGIN_COOKIES,
  assembleKuaishouCookieHeader,
  _internals,
} = require("../../lib/adapters/social-kuaishou-adb/cookies-extension");

describe("constants", () => {
  it("path points to com.smile.gifmaker WebView cookies", () => {
    expect(KUAISHOU_COOKIES_REMOTE_PATH).toBe(
      "/data/data/com.smile.gifmaker/app_webview/Default/Cookies",
    );
  });

  it("host domain is kuaishou.com", () => {
    expect(KUAISHOU_COOKIE_HOST_DOMAIN).toBe("kuaishou.com");
  });

  it("login cookies enumerated (userId OR kuaishou.web.cp.api_ph)", () => {
    expect([...KUAISHOU_LOGIN_COOKIES]).toEqual([
      "userId",
      "kuaishou.web.cp.api_ph",
    ]);
  });
});

describe("pickUidFromCookieMap", () => {
  const make = (entries) =>
    new Map(entries.map(([k, v]) => [k, { value: v }]));

  it("prefers direct userId cookie", () => {
    const map = make([
      ["userId", "12345"],
      ["kuaishou.web.cp.api_ph", encodeURIComponent('{"user_id":99999}')],
    ]);
    expect(_internals.pickUidFromCookieMap(map)).toBe("12345");
  });

  it("falls back to api_ph nested user_id", () => {
    const map = make([
      ["kuaishou.web.cp.api_ph", encodeURIComponent('{"user_id":"55555"}')],
    ]);
    expect(_internals.pickUidFromCookieMap(map)).toBe("55555");
  });

  it("falls back to api_ph nested uid alternate", () => {
    const map = make([
      ["kuaishou.web.cp.api_ph", encodeURIComponent('{"uid":"77777"}')],
    ]);
    expect(_internals.pickUidFromCookieMap(map)).toBe("77777");
  });

  it("handles api_ph not URL-encoded (raw)", () => {
    const map = make([["kuaishou.web.cp.api_ph", '{"user_id":"33333"}']]);
    expect(_internals.pickUidFromCookieMap(map)).toBe("33333");
  });

  it("returns null for userId=0 (guest sentinel)", () => {
    const map = make([["userId", "0"]]);
    expect(_internals.pickUidFromCookieMap(map)).toBe(null);
  });

  it("returns null when only anti-bot cookies present", () => {
    const map = make([["did", "anonid"]]);
    expect(_internals.pickUidFromCookieMap(map)).toBe(null);
  });

  it("falls back to base64-encoded api_ph (v0.3 newer Kuaishou builds)", () => {
    const b64 = Buffer.from(
      JSON.stringify({ user_id: "424242" }),
      "utf-8",
    ).toString("base64");
    const map = make([
      ["kuaishou.web.cp.api_ph", encodeURIComponent(b64)],
    ]);
    expect(_internals.pickUidFromCookieMap(map)).toBe("424242");
  });
});

describe("assembleKuaishouCookieHeader", () => {
  const mkCookie = (name, value, hostKey = ".kuaishou.com") => ({
    name,
    value,
    hostKey,
  });

  it("builds header from direct userId cookie", () => {
    const cookies = [
      mkCookie("userId", "12345"),
      mkCookie("did", "anon"),
    ];
    const r = assembleKuaishouCookieHeader(cookies);
    expect(r.header).toContain("userId=12345");
    expect(r.uid).toBe("12345");
    expect(r.missing).toEqual([]);
  });

  it("builds header from api_ph alone (no direct userId)", () => {
    const cookies = [
      mkCookie(
        "kuaishou.web.cp.api_ph",
        encodeURIComponent('{"user_id":"55555","user_name":"Alice"}'),
      ),
    ];
    const r = assembleKuaishouCookieHeader(cookies);
    expect(r.header).toContain("kuaishou.web.cp.api_ph=");
    expect(r.uid).toBe("55555");
    expect(r.missing).toEqual([]);
  });

  it("returns null header when no login cookie present", () => {
    const cookies = [mkCookie("did", "anon"), mkCookie("ttwid", "x")];
    const r = assembleKuaishouCookieHeader(cookies);
    expect(r.header).toBe(null);
    expect(r.uid).toBe(null);
    expect(r.missing).toEqual(["userId", "kuaishou.web.cp.api_ph"]);
  });

  it("dedupes by longest hostKey when same name appears twice", () => {
    const cookies = [
      mkCookie("userId", "subdomain-val", "www.kuaishou.com"),
      mkCookie("userId", "wildcard-val", ".kuaishou.com"),
    ];
    const r = assembleKuaishouCookieHeader(cookies);
    expect(r.header).toContain("userId=subdomain-val");
  });

  it("throws TypeError on non-array input", () => {
    expect(() => assembleKuaishouCookieHeader(null)).toThrow(TypeError);
    expect(() => assembleKuaishouCookieHeader("x")).toThrow(TypeError);
  });
});

describe("createKuaishouCookiesExtension", () => {
  it("rejects when ctx missing required functions", async () => {
    const ext = createKuaishouCookiesExtension();
    await expect(ext({}, {})).rejects.toThrow(/ctx must provide/);
  });

  it("rejects when adb is not a function", async () => {
    const ext = createKuaishouCookiesExtension();
    await expect(
      ext({}, { adb: null, pickDevice: () => "serial" }),
    ).rejects.toThrow(/ctx must provide/);
  });
});
