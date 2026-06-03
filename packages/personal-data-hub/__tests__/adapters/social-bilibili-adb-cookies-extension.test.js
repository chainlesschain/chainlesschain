"use strict";

/**
 * Phase 1a (Bilibili C 路径) — unit cover for the bilibili.cookies ADB
 * extension factory.
 *
 * Strategy: build a real chromium-shape Cookies sqlite via better-sqlite3,
 * read it back as bytes, base64-encode, and feed the encoded string back
 * to the extension via a fake `ctx.adb` that returns canned ADB stdout
 * per-command. This exercises the full pipeline (probe → su id-u check →
 * base64 stream → decode → sqlite magic check → parse → header assemble →
 * temp-file cleanup) without any real ADB / device.
 *
 * Covered:
 *  - Happy path: pulls + parses + returns {cookie, uid, ...}
 *  - File not found on phone → BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN
 *  - Phone not rooted (id -u returns non-zero/non-root) → BILIBILI_NO_ROOT
 *  - Empty base64 stream → BILIBILI_COOKIES_EMPTY
 *  - Truncated stream (decoded <1KB) → BILIBILI_COOKIES_TRUNCATED
 *  - Wrong magic header (not sqlite) → BILIBILI_NOT_SQLITE
 *  - Cookies DB present but missing required cookies → BILIBILI_COOKIES_INCOMPLETE
 *  - Invalid DedeUserID (non-integer / negative) → BILIBILI_INVALID_UID
 *  - Cleanup: temp file deleted on both success and failure
 *  - Bridge integration via createHostAdbBridge({ extensions: {...} })
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const {
  createBilibiliCookiesExtension,
  BILIBILI_COOKIES_REMOTE_PATH,
} = require("../../lib/adapters/social-bilibili-adb/cookies-extension");

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cc-bilibili-ext-test-"));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) {
    // ignore
  }
});

/**
 * Build a chromium-shape Cookies sqlite + return its raw bytes + base64.
 * cookies = array of {name, value, hostKey?}.
 */
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
    insert.run(c.hostKey || ".bilibili.com", c.name, c.value);
  }
  db.close();
  const buf = readFileSync(dbPath);
  rmSync(dbPath);
  return buf.toString("base64");
}

/**
 * Build a fake ctx with a scripted adb response. `responses` is a Map
 * keyed by the joined args (whitespace-stripped) → string stdout.
 *
 * `pickDevice` returns a fixed serial. `parseContentQueryRows` isn't
 * used by the bilibili extension but is part of the ctx contract.
 */
function fakeCtx(responses) {
  return {
    adb: vi.fn(async (args, _opts) => {
      const key = args.join(" ");
      // Allow exact key OR keyword-contains match (the extension only
      // checks substrings; the test can opt into "first arg matching ..."
      // by registering with a unique substring).
      for (const [pattern, body] of responses) {
        if (key === pattern || key.includes(pattern)) {
          return typeof body === "function" ? body(args) : body;
        }
      }
      throw new Error(`fake adb: no scripted response for: ${key}`);
    }),
    pickDevice: vi.fn(async () => "FAKE_SERIAL"),
    parseContentQueryRows: () => [],
  };
}

const FULL_BILIBILI_COOKIES = [
  { name: "SESSDATA", value: "abcSESSDATA123" },
  { name: "bili_jct", value: "csrfTokenXYZ" },
  { name: "DedeUserID", value: "1234567890" },
  { name: "DedeUserID__ckMd5", value: "deadbeef0000" },
  { name: "buvid3", value: "buvid-uniq-id" },
];

describe("bilibili.cookies extension — happy path", () => {
  it("pulls + parses + returns {cookie, uid, ...}", async () => {
    const b64 = buildCookiesAsBase64(FULL_BILIBILI_COOKIES);
    const ctx = fakeCtx([
      [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH + "\n"],
      ["id -u", "0\n"],
      [`base64 ${BILIBILI_COOKIES_REMOTE_PATH}`, b64],
    ]);
    const ext = createBilibiliCookiesExtension();
    const result = await ext({}, ctx);

    expect(result.cookie).toContain("SESSDATA=abcSESSDATA123");
    expect(result.cookie).toContain("bili_jct=csrfTokenXYZ");
    expect(result.cookie).toContain("DedeUserID=1234567890");
    expect(result.cookie).toContain("buvid3=buvid-uniq-id");
    expect(result.uid).toBe(1234567890);
    expect(result.extractedAt).toBeGreaterThan(0);
    expect(result.diagnostic.cookieCount).toBe(5);
    expect(result.diagnostic.hadEncrypted).toBe(false);
  });

  it("uid is parsed as positive integer", async () => {
    const b64 = buildCookiesAsBase64(FULL_BILIBILI_COOKIES);
    const ctx = fakeCtx([
      [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH],
      ["id -u", "uid=0(root) gid=0(root)\n"], // alternate id -u format
      [`base64 ${BILIBILI_COOKIES_REMOTE_PATH}`, b64],
    ]);
    const ext = createBilibiliCookiesExtension();
    const result = await ext({}, ctx);
    expect(Number.isInteger(result.uid)).toBe(true);
    expect(result.uid).toBeGreaterThan(0);
  });
});

describe("bilibili.cookies extension — failure modes", () => {
  it("BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN when ls returns NOT_FOUND", async () => {
    const ctx = fakeCtx([[`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, "NOT_FOUND\n"]]);
    const ext = createBilibiliCookiesExtension();
    await expect(ext({}, ctx)).rejects.toThrow(
      /BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN/,
    );
  });

  it("BILIBILI_NO_ROOT when id -u not 0", async () => {
    const ctx = fakeCtx([
      [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH],
      ["id -u", "2000\n"], // shell user, not root
    ]);
    const ext = createBilibiliCookiesExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/BILIBILI_NO_ROOT/);
  });

  it("BILIBILI_COOKIES_EMPTY when base64 stream is empty", async () => {
    const ctx = fakeCtx([
      [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH],
      ["id -u", "0\n"],
      [`base64 ${BILIBILI_COOKIES_REMOTE_PATH}`, "   \r\n"],
    ]);
    const ext = createBilibiliCookiesExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/BILIBILI_COOKIES_EMPTY/);
  });

  it("BILIBILI_COOKIES_TRUNCATED when decoded file too small", async () => {
    // 50 bytes of base64 → ~37 bytes decoded, way below 1KB threshold
    const tinyB64 = Buffer.from("a".repeat(100)).toString("base64");
    const ctx = fakeCtx([
      [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH],
      ["id -u", "0\n"],
      [`base64 ${BILIBILI_COOKIES_REMOTE_PATH}`, tinyB64],
    ]);
    const ext = createBilibiliCookiesExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/BILIBILI_COOKIES_TRUNCATED/);
  });

  it("BILIBILI_NOT_SQLITE when magic header missing", async () => {
    // 2KB of non-sqlite garbage
    const garbage = Buffer.alloc(2048, "X").toString("base64");
    const ctx = fakeCtx([
      [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH],
      ["id -u", "0\n"],
      [`base64 ${BILIBILI_COOKIES_REMOTE_PATH}`, garbage],
    ]);
    const ext = createBilibiliCookiesExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/BILIBILI_NOT_SQLITE/);
  });

  it("BILIBILI_COOKIES_INCOMPLETE when required cookies missing", async () => {
    const b64 = buildCookiesAsBase64([
      { name: "SESSDATA", value: "abc" },
      { name: "bili_jct", value: "csrf" },
      // missing DedeUserID + DedeUserID__ckMd5 + buvid3
    ]);
    const ctx = fakeCtx([
      [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH],
      ["id -u", "0\n"],
      [`base64 ${BILIBILI_COOKIES_REMOTE_PATH}`, b64],
    ]);
    const ext = createBilibiliCookiesExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/BILIBILI_COOKIES_INCOMPLETE/);
  });

  it("BILIBILI_INVALID_UID when DedeUserID is non-numeric", async () => {
    const b64 = buildCookiesAsBase64([
      { name: "SESSDATA", value: "abc" },
      { name: "bili_jct", value: "csrf" },
      { name: "DedeUserID", value: "not-a-number" },
      { name: "DedeUserID__ckMd5", value: "deadbeef" },
      { name: "buvid3", value: "x" },
    ]);
    const ctx = fakeCtx([
      [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH],
      ["id -u", "0\n"],
      [`base64 ${BILIBILI_COOKIES_REMOTE_PATH}`, b64],
    ]);
    const ext = createBilibiliCookiesExtension();
    await expect(ext({}, ctx)).rejects.toThrow(/BILIBILI_INVALID_UID/);
  });
});

describe("bilibili.cookies extension — temp file cleanup", () => {
  function countTempFiles() {
    // Count cc-bilibili-cookies-*.db files in os.tmpdir() at the time
    // of inspection. We snapshot before/after to compare delta.
    try {
      return readdirSync(tmpdir()).filter((n) =>
        n.startsWith("cc-bilibili-cookies-"),
      ).length;
    } catch (_e) {
      return 0;
    }
  }

  it("removes temp file on success", async () => {
    const before = countTempFiles();
    const b64 = buildCookiesAsBase64(FULL_BILIBILI_COOKIES);
    const ctx = fakeCtx([
      [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH],
      ["id -u", "0\n"],
      [`base64 ${BILIBILI_COOKIES_REMOTE_PATH}`, b64],
    ]);
    const ext = createBilibiliCookiesExtension();
    await ext({}, ctx);
    const after = countTempFiles();
    expect(after).toBe(before);
  });

  it("removes temp file on parse failure", async () => {
    const before = countTempFiles();
    const b64 = buildCookiesAsBase64([
      { name: "SESSDATA", value: "abc" }, // incomplete → throws
    ]);
    const ctx = fakeCtx([
      [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH],
      ["id -u", "0\n"],
      [`base64 ${BILIBILI_COOKIES_REMOTE_PATH}`, b64],
    ]);
    const ext = createBilibiliCookiesExtension();
    await expect(ext({}, ctx)).rejects.toThrow();
    const after = countTempFiles();
    expect(after).toBe(before); // cleanup still ran via try/finally
  });
});

describe("bilibili.cookies extension — ctx contract", () => {
  it("throws TypeError when ctx missing adb fn", async () => {
    const ext = createBilibiliCookiesExtension();
    await expect(
      ext({}, { pickDevice: async () => "x" }),
    ).rejects.toThrow(TypeError);
  });

  it("throws TypeError when ctx missing pickDevice fn", async () => {
    const ext = createBilibiliCookiesExtension();
    await expect(
      ext({}, { adb: async () => "" }),
    ).rejects.toThrow(TypeError);
  });
});

describe("bilibili.cookies extension — bridge integration", () => {
  it("works through createHostAdbBridge plugin point", async () => {
    // Use createHostAdbBridge to verify the extension actually dispatches
    // via the host-adb-bridge plugin pipeline (Phase B0 contract).
    const { createHostAdbBridge } = await import(
      "../../../cli/src/lib/host-adb-bridge.js"
    );
    const b64 = buildCookiesAsBase64(FULL_BILIBILI_COOKIES);

    // The real createHostAdbBridge uses its own internal adb fn (calls
    // real `execFile`), which would fail on CI without a device. To
    // smoke-test the dispatch wiring we construct an extension that
    // ignores ctx and returns the same shape directly — that proves
    // the bridge invokes our handler.
    const ext = createBilibiliCookiesExtension();

    // Replace the ctx that the real bridge would build by giving the
    // extension a wrapper that swaps in our fake ctx.
    const wrappedExt = (params, _realCtx) => ext(params, fakeCtxClosure());

    function fakeCtxClosure() {
      return fakeCtx([
        [`ls ${BILIBILI_COOKIES_REMOTE_PATH}`, BILIBILI_COOKIES_REMOTE_PATH],
        ["id -u", "0\n"],
        [`base64 ${BILIBILI_COOKIES_REMOTE_PATH}`, b64],
      ]);
    }

    const bridge = createHostAdbBridge({
      extensions: { "bilibili.cookies": wrappedExt },
    });

    expect(bridge.extensionMethods()).toContain("bilibili.cookies");
    const result = await bridge.invoke("bilibili.cookies");
    expect(result.uid).toBe(1234567890);
    expect(result.cookie).toContain("SESSDATA=");
  });
});
