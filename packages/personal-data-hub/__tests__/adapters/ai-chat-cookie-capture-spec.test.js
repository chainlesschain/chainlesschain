"use strict";

import { describe, it, expect } from "vitest";

const {
  COOKIE_SPEC_VERSION,
  KNOWN_VENDORS,
  COOKIE_CAPTURE_SPECS,
  getSpec,
  listVendors,
  classifyProbedCookies,
  validateCookieCaptureSpec,
  _internal,
} = require("../../lib/adapters/ai-chat-history/cookie-capture-spec");

describe("cookie-capture-spec — Phase 10.3.1 matrix", () => {
  it("exposes a positive integer COOKIE_SPEC_VERSION", () => {
    expect(Number.isInteger(COOKIE_SPEC_VERSION)).toBe(true);
    expect(COOKIE_SPEC_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("KNOWN_VENDORS contains exactly the 9 wired vendors", () => {
    expect(KNOWN_VENDORS).toEqual([
      "deepseek",
      "kimi",
      "tongyi",
      "zhipu",
      "hunyuan",
      "qianfan",
      "coze",
      "dreamina",
      "doubao",
    ]);
    // Defensive — frozen so contributors don't accidentally mutate at runtime.
    expect(Object.isFrozen(KNOWN_VENDORS)).toBe(true);
  });

  it("ships 9 specs, one per KNOWN_VENDORS entry, no duplicates", () => {
    expect(COOKIE_CAPTURE_SPECS.length).toBe(KNOWN_VENDORS.length);
    const seen = new Set();
    for (const s of COOKIE_CAPTURE_SPECS) {
      expect(KNOWN_VENDORS).toContain(s.vendor);
      expect(seen.has(s.vendor)).toBe(false);
      seen.add(s.vendor);
    }
  });

  it("validates the shipped spec set without errors", () => {
    const r = validateCookieCaptureSpec(undefined, { throwOnError: false });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("each loginUrl host matches at least one cookieDomains entry", () => {
    for (const s of COOKIE_CAPTURE_SPECS) {
      const host = new URL(s.loginUrl).host;
      const matched = s.cookieDomains.some((d) =>
        d.startsWith(".") ? host.endsWith(d.slice(1)) : host === d,
      );
      expect({ vendor: s.vendor, host, matched }).toEqual({ vendor: s.vendor, host, matched: true });
    }
  });

  it("each spec has non-empty requiredCookies + postLoginPathHints + positive maxAge", () => {
    for (const s of COOKIE_CAPTURE_SPECS) {
      expect(Array.isArray(s.requiredCookies)).toBe(true);
      expect(s.requiredCookies.length).toBeGreaterThan(0);
      expect(Array.isArray(s.postLoginPathHints)).toBe(true);
      expect(s.postLoginPathHints.length).toBeGreaterThan(0);
      expect(Number.isInteger(s.cookieMaxAgeHintDays)).toBe(true);
      expect(s.cookieMaxAgeHintDays).toBeGreaterThan(0);
      expect(typeof s.notes).toBe("string");
      expect(s.notes.length).toBeGreaterThan(0);
    }
  });

  it("getSpec returns the right spec for a known vendor and null for unknown", () => {
    const ds = getSpec("deepseek");
    expect(ds).toBeTruthy();
    expect(ds.vendor).toBe("deepseek");
    expect(getSpec("notarealvendor")).toBeNull();
    expect(getSpec("")).toBeNull();
    expect(getSpec(undefined)).toBeNull();
    expect(getSpec(null)).toBeNull();
  });

  it("listVendors returns a copy (mutation does not affect KNOWN_VENDORS)", () => {
    const arr = listVendors();
    expect(arr).toEqual([...KNOWN_VENDORS]);
    arr.push("hacked");
    expect(KNOWN_VENDORS.includes("hacked")).toBe(false);
  });
});

describe("classifyProbedCookies — required vs optional vs missing", () => {
  it("returns ok=true when all required cookies present (object input)", () => {
    const r = classifyProbedCookies("deepseek", {
      userToken: "abc",
      "intercom-session-deepseek": "xyz",
    });
    expect(r.ok).toBe(true);
    expect(r.foundRequired).toEqual(["userToken"]);
    expect(r.missingRequired).toEqual([]);
    expect(r.foundOptional).toEqual(["intercom-session-deepseek"]);
  });

  it("returns ok=false when a required cookie is missing", () => {
    const r = classifyProbedCookies("kimi", { refresh_token: "rt", session_id: "sid" });
    expect(r.ok).toBe(false);
    expect(r.missingRequired).toEqual(["access_token"]);
    expect(r.foundOptional.sort()).toEqual(["refresh_token", "session_id"]);
  });

  it("accepts Electron Cookie[] shape (array of { name, value })", () => {
    const r = classifyProbedCookies("zhipu", [
      { name: "chatglm_token", value: "tok" },
      { name: "cgsessionid", value: "sid" },
      { name: "unrelated", value: "x" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.foundRequired).toEqual(["chatglm_token"]);
    expect(r.foundOptional).toContain("cgsessionid");
  });

  it("accepts raw 'k=v; k=v' string (web-shell paste fallback)", () => {
    const raw = "sessionid=abc; sid_guard=xyz; passport_csrf_token=csrf;  ;junk";
    const r = classifyProbedCookies("doubao", raw);
    expect(r.ok).toBe(true);
    expect(r.foundRequired).toEqual(["sessionid"]);
    expect(r.foundOptional.sort()).toEqual(["passport_csrf_token", "sid_guard"]);
  });

  it("string parser tolerates values containing '=' (e.g. base64)", () => {
    // sessionid is base64 with '=' padding; only the FIRST '=' is the delimiter.
    const raw = "sessionid=YWJjZGVmZ2g=; sid_guard=v1=";
    const r = classifyProbedCookies("coze", raw);
    expect(r.ok).toBe(true);
    expect(r.foundRequired).toEqual(["sessionid"]);
    // raw cookie value must be preserved verbatim including the trailing '='
    const jar = _internal._normalizeCookieJar(raw);
    expect(jar.sessionid).toBe("YWJjZGVmZ2g=");
  });

  it("empty string / null / undefined / wrong type all produce ok=false", () => {
    for (const input of ["", null, undefined, 42, true]) {
      const r = classifyProbedCookies("doubao", input);
      expect(r.ok).toBe(false);
      expect(r.missingRequired).toEqual(["sessionid"]);
    }
  });

  it("returns UNKNOWN_VENDOR reason for an unregistered vendor name", () => {
    const r = classifyProbedCookies("notarealvendor", { anything: "x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_VENDOR");
  });

  it("treats empty-string cookie value as missing (not present)", () => {
    const r = classifyProbedCookies("deepseek", { userToken: "" });
    expect(r.ok).toBe(false);
    expect(r.foundRequired).toEqual([]);
    expect(r.missingRequired).toEqual(["userToken"]);
  });
});

describe("validateCookieCaptureSpec — defensive guard catches malformed specs", () => {
  it("flags unknown vendor", () => {
    const { ok, errors } = validateCookieCaptureSpec(
      [{ ...COOKIE_CAPTURE_SPECS[0], vendor: "ghostvendor" }],
      { throwOnError: false },
    );
    expect(ok).toBe(false);
    expect(errors.join(" ")).toMatch(/unknown vendor/);
  });

  it("flags loginUrl host not matching any cookieDomain", () => {
    const broken = {
      ...COOKIE_CAPTURE_SPECS[0],
      loginUrl: "https://malicious.example.com/",
    };
    const { ok, errors } = validateCookieCaptureSpec([broken], { throwOnError: false });
    expect(ok).toBe(false);
    expect(errors.join(" ")).toMatch(/does not match any cookieDomain/);
  });

  it("flags empty requiredCookies / postLoginPathHints / invalid maxAge", () => {
    const broken = {
      ...COOKIE_CAPTURE_SPECS[0],
      requiredCookies: [],
      postLoginPathHints: [],
      cookieMaxAgeHintDays: 0,
    };
    const { ok, errors } = validateCookieCaptureSpec([broken], { throwOnError: false });
    expect(ok).toBe(false);
    const joined = errors.join(" ");
    expect(joined).toMatch(/requiredCookies/);
    expect(joined).toMatch(/postLoginPathHints/);
    expect(joined).toMatch(/cookieMaxAgeHintDays/);
  });

  it("flags duplicate vendor entries", () => {
    const dup = [COOKIE_CAPTURE_SPECS[0], { ...COOKIE_CAPTURE_SPECS[0] }];
    const { ok, errors } = validateCookieCaptureSpec(dup, { throwOnError: false });
    expect(ok).toBe(false);
    expect(errors.join(" ")).toMatch(/duplicate vendor/);
  });

  it("throws by default when malformed (no opts)", () => {
    expect(() => validateCookieCaptureSpec([{ vendor: "ghost" }])).toThrow(/Invalid cookie capture spec/);
  });
});
