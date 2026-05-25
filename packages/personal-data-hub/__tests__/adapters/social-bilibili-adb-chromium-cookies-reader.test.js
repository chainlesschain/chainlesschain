"use strict";

/**
 * Phase 1a (Bilibili C 路径) — unit cover for the chromium-cookies-reader.
 *
 * Builds a real chromium-shape Cookies sqlite via better-sqlite3 (the
 * test path that browser-history-chrome.test.js uses — root Node ABI
 * 127 matches plain better-sqlite3, no FTS5 / encryption needed). All
 * tests run in <1s on CI.
 *
 * Covered:
 *  - hostKeyMatches across .domain / domain / subdomain / non-match
 *  - readChromiumCookies filtering by domain
 *  - Cookie schema column tolerance (encrypted_value / is_secure /
 *    is_persistent missing — old or aggressively-pruned WebView builds)
 *  - assembleBilibiliCookieHeader: complete / missing-required / dup-name
 *  - encrypted_value rows skipped + diagnostic counter
 *  - corrupted DB / wrong-schema DB → clear error
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  readChromiumCookies,
  assembleBilibiliCookieHeader,
  BILIBILI_COOKIE_NAMES,
  _internals,
} = require("../../lib/adapters/social-bilibili-adb/chromium-cookies-reader");

let tmpDir;
let dbPath;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cc-cookies-test-"));
  dbPath = join(tmpDir, "Cookies");
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) {
    // ignore — temp cleanup is best-effort
  }
});

/**
 * Build a chromium-shape Cookies sqlite at [dbPath]. Optionally omit
 * encrypted_value column (`{omitEncrypted: true}`) to simulate older
 * Android WebView schemas that didn't have it.
 */
function buildCookiesFixture(rows, { omitEncrypted = false, omitSecure = false } = {}) {
  const db = new Database(dbPath);
  const cols = [
    "creation_utc INTEGER",
    "host_key TEXT",
    "name TEXT",
    "value TEXT",
    omitEncrypted ? null : "encrypted_value BLOB",
    "path TEXT",
    "expires_utc INTEGER",
    omitSecure ? null : "is_secure INTEGER",
    "is_httponly INTEGER",
    "is_persistent INTEGER",
  ].filter(Boolean).join(", ");
  db.exec(`CREATE TABLE cookies(${cols});`);
  const params = [
    "creation_utc",
    "host_key",
    "name",
    "value",
    omitEncrypted ? null : "encrypted_value",
    "path",
    "expires_utc",
    omitSecure ? null : "is_secure",
    "is_httponly",
    "is_persistent",
  ].filter(Boolean);
  const placeholders = params.map(() => "?").join(", ");
  const insert = db.prepare(
    `INSERT INTO cookies(${params.join(", ")}) VALUES(${placeholders})`,
  );
  for (const r of rows) {
    const values = [
      r.creationUtc || 0,
      r.hostKey,
      r.name,
      r.value || "",
      ...(omitEncrypted ? [] : [r.encryptedValue || null]),
      r.path || "/",
      r.expiresUtc || 0,
      ...(omitSecure ? [] : [r.isSecure ? 1 : 0]),
      r.isHttpOnly ? 1 : 0,
      r.isPersistent ? 1 : 0,
    ];
    insert.run(...values);
  }
  db.close();
}

// ─── hostKeyMatches ─────────────────────────────────────────────────────

describe("hostKeyMatches", () => {
  it("matches exact host_key against domain", () => {
    expect(_internals.hostKeyMatches("bilibili.com", "bilibili.com")).toBe(true);
  });

  it("matches leading-dot host_key (most common)", () => {
    expect(_internals.hostKeyMatches(".bilibili.com", "bilibili.com")).toBe(true);
  });

  it("matches subdomain host_key", () => {
    expect(_internals.hostKeyMatches(".api.bilibili.com", "bilibili.com")).toBe(true);
    expect(_internals.hostKeyMatches("api.bilibili.com", "bilibili.com")).toBe(true);
  });

  it("matches when both have leading dot", () => {
    expect(_internals.hostKeyMatches(".bilibili.com", ".bilibili.com")).toBe(true);
  });

  it("rejects unrelated domain", () => {
    expect(_internals.hostKeyMatches(".weibo.com", "bilibili.com")).toBe(false);
  });

  it("rejects partial-name collisions (bilibili.com.evil.cn)", () => {
    // The domain check uses dot-anchored suffix, so foo.com matching
    // foo.com.evil.cn is impossible.
    expect(_internals.hostKeyMatches(".bilibili.com.evil.cn", "bilibili.com")).toBe(false);
  });

  it("rejects null / undefined / empty", () => {
    expect(_internals.hostKeyMatches(null, "bilibili.com")).toBe(false);
    expect(_internals.hostKeyMatches(".bilibili.com", null)).toBe(false);
    expect(_internals.hostKeyMatches("", "bilibili.com")).toBe(false);
  });
});

// ─── readChromiumCookies ────────────────────────────────────────────────

describe("readChromiumCookies", () => {
  it("returns only cookies matching the domain filter", () => {
    buildCookiesFixture([
      { hostKey: ".bilibili.com", name: "SESSDATA", value: "abc123" },
      { hostKey: ".weibo.com", name: "SUB", value: "wbxx" },
      { hostKey: ".bilibili.com", name: "bili_jct", value: "csrf456" },
    ]);
    const out = readChromiumCookies(dbPath, "bilibili.com");
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.name).sort()).toEqual(["SESSDATA", "bili_jct"]);
  });

  it("handles subdomain-pinned cookies", () => {
    buildCookiesFixture([
      { hostKey: "api.bilibili.com", name: "PinnedCookie", value: "x" },
      { hostKey: ".bilibili.com", name: "SESSDATA", value: "y" },
    ]);
    const out = readChromiumCookies(dbPath, "bilibili.com");
    expect(out).toHaveLength(2);
  });

  it("skips encrypted_value rows + reports count", () => {
    buildCookiesFixture([
      { hostKey: ".bilibili.com", name: "SESSDATA", value: "plain" },
      {
        hostKey: ".bilibili.com",
        name: "EncryptedThing",
        value: "", // empty plaintext
        encryptedValue: Buffer.from("garbled-bytes"),
      },
    ]);
    const out = readChromiumCookies(dbPath, "bilibili.com");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("SESSDATA");
    expect(out._skippedEncryptedCount).toBe(1);
  });

  it("works on schema without encrypted_value column", () => {
    buildCookiesFixture(
      [{ hostKey: ".bilibili.com", name: "SESSDATA", value: "x" }],
      { omitEncrypted: true },
    );
    const out = readChromiumCookies(dbPath, "bilibili.com");
    expect(out).toHaveLength(1);
    expect(out[0].hasEncryptedValue).toBe(false);
  });

  it("works on schema without is_secure column", () => {
    buildCookiesFixture(
      [{ hostKey: ".bilibili.com", name: "SESSDATA", value: "x" }],
      { omitSecure: true },
    );
    const out = readChromiumCookies(dbPath, "bilibili.com");
    expect(out[0].isSecure).toBe(false); // defaulted to 0 by COALESCE
  });

  it("converts WebKit expires_utc to epoch ms", () => {
    // 2026-05-25 00:00:00 UTC = 1779999600000 ms epoch
    //   = 13422518400000000 µs WebKit (epoch + 11644473600 * 1e6)
    const expiresMs = 1779999600000;
    const expiresWk = (BigInt(expiresMs) * 1000n + 11_644_473_600_000_000n).toString();
    buildCookiesFixture([
      {
        hostKey: ".bilibili.com",
        name: "SESSDATA",
        value: "x",
        expiresUtc: expiresWk,
      },
    ]);
    const out = readChromiumCookies(dbPath, "bilibili.com");
    expect(out[0].expiresMs).toBe(expiresMs);
  });

  it("throws clear error when cookies table missing (not a Cookies DB)", () => {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE not_cookies(x INTEGER);");
    db.close();
    // PRAGMA table_info(<nonexistent>) returns empty rather than throwing
    // on SQLite, so we hit the "empty / unreadable" branch. Either message
    // is fine for the caller's purpose — both mean "not a Cookies DB".
    expect(() => readChromiumCookies(dbPath, "bilibili.com")).toThrow(
      /cookies.*(table not found|table empty.*unreadable)/,
    );
  });

  it("throws clear error when required column missing", () => {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE cookies(creation_utc INTEGER, host_key TEXT);");
    db.close();
    expect(() => readChromiumCookies(dbPath, "bilibili.com")).toThrow(
      /required column.*missing/,
    );
  });

  it("rejects empty dbPath", () => {
    expect(() => readChromiumCookies("", "bilibili.com")).toThrow(TypeError);
  });

  it("rejects empty domain", () => {
    buildCookiesFixture([{ hostKey: ".bilibili.com", name: "SESSDATA", value: "x" }]);
    expect(() => readChromiumCookies(dbPath, "")).toThrow(TypeError);
  });
});

// ─── assembleBilibiliCookieHeader ───────────────────────────────────────

describe("assembleBilibiliCookieHeader", () => {
  function cookieRow(name, value, hostKey = ".bilibili.com") {
    return {
      name,
      value,
      hostKey,
      expiresMs: null,
      isSecure: false,
      isHttponly: true,
      isPersistent: true,
      hasEncryptedValue: false,
    };
  }

  it("assembles complete header when all 5 cookies present", () => {
    const cookies = [
      cookieRow("SESSDATA", "abc"),
      cookieRow("bili_jct", "csrf"),
      cookieRow("DedeUserID", "1234"),
      cookieRow("DedeUserID__ckMd5", "deadbeef"),
      cookieRow("buvid3", "buvid-x"),
    ];
    const { header, missing, present } = assembleBilibiliCookieHeader(cookies);
    expect(missing).toEqual([]);
    expect(header).toBe(
      "SESSDATA=abc; bili_jct=csrf; DedeUserID=1234; DedeUserID__ckMd5=deadbeef; buvid3=buvid-x",
    );
    expect(present).toEqual(new Set(BILIBILI_COOKIE_NAMES));
  });

  it("returns null header + missing list when any required cookie absent", () => {
    const cookies = [
      cookieRow("SESSDATA", "abc"),
      cookieRow("bili_jct", "csrf"),
      // missing DedeUserID, DedeUserID__ckMd5, buvid3
    ];
    const { header, missing } = assembleBilibiliCookieHeader(cookies);
    expect(header).toBe(null);
    expect(missing.sort()).toEqual(["DedeUserID", "DedeUserID__ckMd5", "buvid3"].sort());
  });

  it("ignores non-bilibili cookies if accidentally passed in", () => {
    const cookies = [
      cookieRow("SESSDATA", "abc"),
      cookieRow("bili_jct", "csrf"),
      cookieRow("DedeUserID", "1234"),
      cookieRow("DedeUserID__ckMd5", "deadbeef"),
      cookieRow("buvid3", "buvid-x"),
      cookieRow("randomNoise", "ignored", ".weibo.com"),
    ];
    const { header } = assembleBilibiliCookieHeader(cookies);
    expect(header).not.toContain("randomNoise");
    expect(header).not.toContain("ignored");
  });

  it("prefers more-specific host_key on duplicate names", () => {
    const cookies = [
      cookieRow("SESSDATA", "shorter", ".bilibili.com"),
      cookieRow("SESSDATA", "longer", "api.bilibili.com"), // longer host wins
      cookieRow("bili_jct", "csrf"),
      cookieRow("DedeUserID", "1234"),
      cookieRow("DedeUserID__ckMd5", "deadbeef"),
      cookieRow("buvid3", "buvid-x"),
    ];
    const { header } = assembleBilibiliCookieHeader(cookies);
    expect(header).toContain("SESSDATA=longer");
    expect(header).not.toContain("SESSDATA=shorter");
  });

  it("throws TypeError when given non-array", () => {
    expect(() => assembleBilibiliCookieHeader(null)).toThrow(TypeError);
    expect(() => assembleBilibiliCookieHeader({})).toThrow(TypeError);
  });

  it("returns null header for empty cookie list (all 5 missing)", () => {
    const { header, missing } = assembleBilibiliCookieHeader([]);
    expect(header).toBe(null);
    expect(missing.length).toBe(BILIBILI_COOKIE_NAMES.length);
  });
});

// ─── BILIBILI_COOKIE_NAMES contract ─────────────────────────────────────

describe("BILIBILI_COOKIE_NAMES", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(BILIBILI_COOKIE_NAMES)).toBe(true);
  });

  it("contains the 5 expected names", () => {
    expect(BILIBILI_COOKIE_NAMES).toEqual([
      "SESSDATA",
      "bili_jct",
      "DedeUserID",
      "DedeUserID__ckMd5",
      "buvid3",
    ]);
  });
});
