"use strict";

/**
 * Phase 3a (Weibo C 路径) — cover for the weibo.cookies ADB extension
 * factory, focused on the WebView-profile-dir discovery fix.
 *
 * Real-device verification (2026-06-08, Xiaomi chopin / MIUI 13, Weibo
 * logged in) found current Weibo stores its Chromium cookies under a
 * SUFFIXED profile dir `app_webview_com.sina.weibo/Default/Cookies`, not
 * the legacy `app_webview/Default/Cookies` the collector hardcoded — so the
 * old code threw WEIBO_NOT_INSTALLED on a perfectly logged-in phone. The
 * fix globs `app_webview*` and uses the first match.
 *
 * Strategy mirrors social-bilibili-adb-cookies-extension.test.js: build a
 * real chromium-shape Cookies sqlite, base64 it, and feed it back through a
 * scripted fake `ctx.adb` — no real ADB / device.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  createWeiboCookiesExtension,
  WEIBO_COOKIES_REMOTE_GLOB,
  WEIBO_COOKIES_REMOTE_PATH,
} = require("../../lib/adapters/social-weibo-adb/cookies-extension");

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cc-weibo-ext-test-"));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) {
    // ignore
  }
});

/** Build a chromium-shape Cookies sqlite + return its base64. */
function buildCookiesAsBase64(cookies) {
  const dbPath = join(tmpDir, "fixture-cookies");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE cookies(
      creation_utc INTEGER,
      host_key TEXT,
      name TEXT,
      value TEXT,
      encrypted_value BLOB,
      path TEXT,
      expires_utc INTEGER,
      is_secure INTEGER,
      is_httponly INTEGER,
      is_persistent INTEGER
    );
  `);
  const insert = db.prepare(
    "INSERT INTO cookies(host_key, name, value, path, expires_utc, is_secure, is_httponly, is_persistent) VALUES(?, ?, ?, '/', 0, 0, 1, 1)",
  );
  for (const c of cookies) {
    insert.run(c.hostKey || ".m.weibo.cn", c.name, c.value);
  }
  db.close();
  const buf = readFileSync(dbPath);
  rmSync(dbPath);
  return buf.toString("base64");
}

/**
 * Scripted fake ctx. `responses` is an array of [substringPattern, body];
 * the first pattern that the joined args contain wins.
 */
function fakeCtx(responses) {
  const adb = vi.fn(async (args) => {
    const key = args.join(" ");
    for (const [pattern, body] of responses) {
      if (key.includes(pattern)) {
        return typeof body === "function" ? body(args) : body;
      }
    }
    throw new Error(`fake adb: no scripted response for: ${key}`);
  });
  return {
    ctx: { adb, pickDevice: vi.fn(async () => "FAKE_SERIAL"), parseContentQueryRows: () => [] },
    adb,
  };
}

const SUFFIXED_PATH =
  "/data/data/com.sina.weibo/app_webview_com.sina.weibo/Default/Cookies";

describe("constants", () => {
  it("glob covers both legacy and suffixed app_webview layouts", () => {
    expect(WEIBO_COOKIES_REMOTE_GLOB).toBe(
      "/data/data/com.sina.weibo/app_webview*/Default/Cookies",
    );
    // The legacy constant is kept for reference / back-compat callers.
    expect(WEIBO_COOKIES_REMOTE_PATH).toBe(
      "/data/data/com.sina.weibo/app_webview/Default/Cookies",
    );
  });
});

describe("createWeiboCookiesExtension — WebView profile dir discovery", () => {
  it("resolves the SUFFIXED app_webview_com.sina.weibo dir + pulls from it", async () => {
    const b64 = buildCookiesAsBase64([{ name: "SUB", value: "sessionTokenXYZ" }]);
    const { ctx, adb } = fakeCtx([
      ["ls -d", SUFFIXED_PATH], // glob resolves to suffixed dir
      ["id -u", "0"],
      ["base64", b64],
    ]);
    const ext = createWeiboCookiesExtension();
    const result = await ext({}, ctx);

    expect(result.cookie).toContain("SUB=sessionTokenXYZ");
    expect(result.diagnostic.hasSub).toBe(true);

    // The base64 pull MUST target the resolved suffixed path, not the
    // legacy hardcoded one — this is the regression guard for the fix.
    const base64Call = adb.mock.calls.find((c) => c[0].join(" ").includes("base64"));
    expect(base64Call[0].join(" ")).toContain(SUFFIXED_PATH);
    expect(base64Call[0].join(" ")).not.toContain("app_webview/Default");
  });

  it("still works with the legacy app_webview path (back-compat)", async () => {
    const b64 = buildCookiesAsBase64([{ name: "SUB", value: "legacyTok" }]);
    const { ctx } = fakeCtx([
      ["ls -d", WEIBO_COOKIES_REMOTE_PATH],
      ["id -u", "0"],
      ["base64", b64],
    ]);
    const ext = createWeiboCookiesExtension();
    const result = await ext({}, ctx);
    expect(result.cookie).toContain("SUB=legacyTok");
  });

  it("throws WEIBO_NOT_INSTALLED when glob matches nothing", async () => {
    const { ctx } = fakeCtx([
      ["ls -d", "NOT_FOUND"],
      ["id -u", "0"],
    ]);
    const ext = createWeiboCookiesExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/WEIBO_NOT_INSTALLED/);
  });

  it("throws WEIBO_NOT_INSTALLED when shell echoes the unexpanded glob", async () => {
    // Some shells, when the glob matches nothing AND nullglob is off, echo
    // the literal pattern. The `*`-guard must treat that as not-found.
    const { ctx } = fakeCtx([
      ["ls -d", WEIBO_COOKIES_REMOTE_GLOB],
      ["id -u", "0"],
    ]);
    const ext = createWeiboCookiesExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/WEIBO_NOT_INSTALLED/);
  });

  it("rejects when ctx missing required functions", async () => {
    const ext = createWeiboCookiesExtension();
    await expect(ext({}, {})).rejects.toThrow(/ctx must provide/);
  });
});
