/**
 * cli-side AIChat WebView 鉴权向导 (Phase 10.3.4) unit tests.
 *
 * `personal-data-hub-aichat-wizard.js` is ESM. We test the bridge + paste
 * mode + factory wiring without touching disk by using temp dirs and
 * dependency injection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAccountsStore,
  createVendorAdapterBridge,
  getAIChatWizard,
  _jarToArray,
  _resetForTests,
  ACCOUNTS_FILE,
} from "../personal-data-hub-aichat-wizard.js";

// ─── createAccountsStore (real fs, temp dir) ──────────────────────────────

describe("createAccountsStore (ESM, real fs)", () => {
  let hubDir;
  beforeEach(() => {
    hubDir = mkdtempSync(join(tmpdir(), "aichat-store-"));
  });

  it("returns null for missing file", async () => {
    const store = createAccountsStore({ hubDir });
    expect(await store.get("deepseek")).toBeNull();
    expect(await store.list()).toEqual([]);
    rmSync(hubDir, { recursive: true, force: true });
  });

  it("put / get round-trips and creates the 0600 file", async () => {
    const store = createAccountsStore({ hubDir });
    await store.put("deepseek", {
      vendor: "deepseek",
      cookies: { userToken: "x" },
    });
    expect(existsSync(join(hubDir, ACCOUNTS_FILE))).toBe(true);
    const stored = await store.get("deepseek");
    expect(stored).toMatchObject({
      vendor: "deepseek",
      cookies: { userToken: "x" },
    });
    rmSync(hubDir, { recursive: true, force: true });
  });

  it("delete drops the file when no entries remain", async () => {
    const store = createAccountsStore({ hubDir });
    await store.put("kimi", { vendor: "kimi", cookies: { access_token: "x" } });
    await store.delete("kimi");
    expect(existsSync(join(hubDir, ACCOUNTS_FILE))).toBe(false);
    rmSync(hubDir, { recursive: true, force: true });
  });

  it("throws when hubDir missing", () => {
    expect(() => createAccountsStore({})).toThrow(/hubDir/);
  });
});

// ─── createVendorAdapterBridge ─────────────────────────────────────────────

function fakeSpec(name, validateImpl) {
  return {
    name,
    displayName: name,
    rateLimits: { perMinute: 10, minIntervalMs: 1000 },
    cookieDomains: [name + ".example"],
    validateCookie: validateImpl,
  };
}

describe("createVendorAdapterBridge (cli)", () => {
  it("dispatches to validateCookie and returns its result", async () => {
    const bridge = createVendorAdapterBridge({
      specs: [
        fakeSpec("deepseek", async ({ session }) => ({
          ok: true,
          userId: session.cookies[0].name,
        })),
      ],
      _httpClientFactory: () => ({}),
    });
    const r = await bridge.registerVendor("deepseek", { userToken: "abc" });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("userToken");
  });

  it("UNKNOWN_VENDOR for unrecognized", async () => {
    const bridge = createVendorAdapterBridge({
      specs: [fakeSpec("deepseek", async () => ({ ok: true }))],
      _httpClientFactory: () => ({}),
    });
    const r = await bridge.registerVendor("ghost", { x: "y" });
    expect(r.reason).toBe("UNKNOWN_VENDOR");
  });

  it("VALIDATE_THREW when validateCookie rejects", async () => {
    const bridge = createVendorAdapterBridge({
      specs: [
        fakeSpec("deepseek", async () => {
          throw new Error("boom");
        }),
      ],
      _httpClientFactory: () => ({}),
    });
    const r = await bridge.registerVendor("deepseek", { x: "y" });
    expect(r.reason).toBe("VALIDATE_THREW");
    expect(r.error).toMatch(/boom/);
  });

  it("rejects empty specs", () => {
    expect(() => createVendorAdapterBridge({ specs: [] })).toThrow(/specs/);
  });
});

// ─── _jarToArray ──────────────────────────────────────────────────────────

describe("_jarToArray (cli)", () => {
  it("array passthrough", () => {
    expect(_jarToArray([{ name: "a", value: "1" }])).toEqual([
      { name: "a", value: "1" },
    ]);
  });
  it("object → array", () => {
    expect(_jarToArray({ a: "1", b: "2" })).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ]);
  });
  it("string → array, splits on ;", () => {
    expect(_jarToArray("a=1; b=2")).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ]);
  });
  it("nullish → empty", () => {
    expect(_jarToArray(null)).toEqual([]);
    expect(_jarToArray(undefined)).toEqual([]);
  });
});

// ─── getAIChatWizard — paste-mode is the default ──────────────────────────

describe("getAIChatWizard — paste-mode wiring", () => {
  let hubDir;
  beforeEach(() => {
    _resetForTests();
    hubDir = mkdtempSync(join(tmpdir(), "aichat-wiz-"));
  });

  it("openVendorLogin returns paste fallback by default", async () => {
    const wiz = getAIChatWizard({ hubDir });
    const r = await wiz.openVendorLogin({ vendor: "deepseek" });
    expect(r.ok).toBe(true);
    expect(r.fallbackMode).toBe("paste");
    expect(r.loginUrl).toMatch(/chat\.deepseek\.com/);
    expect(r.helpText).toMatch(/外部浏览器/);
    rmSync(hubDir, { recursive: true, force: true });
  });

  it("probeCookies with raw cookieHeader succeeds without disk write", async () => {
    const wiz = getAIChatWizard({ hubDir });
    const r = await wiz.probeCookies({
      vendor: "doubao",
      cookieHeader: "sessionid=abc; sid_guard=xyz",
    });
    expect(r.ok).toBe(true);
    expect(r.source).toBe("paste");
    expect(r.cookies.sessionid).toBe("abc");
    rmSync(hubDir, { recursive: true, force: true });
  });

  it("probeCookies without cookieHeader returns PASTE_REQUIRED", async () => {
    const wiz = getAIChatWizard({ hubDir });
    const r = await wiz.probeCookies({ vendor: "doubao" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("PASTE_REQUIRED");
    rmSync(hubDir, { recursive: true, force: true });
  });

  it("registerVendor persists to file when vendorAdapter validates ok", async () => {
    const _vendorAdapter = {
      registerVendor: async () => ({ ok: true, userId: "u_42" }),
    };
    const wiz = getAIChatWizard({ hubDir, _vendorAdapter });
    const r = await wiz.registerVendor({
      vendor: "doubao",
      cookies: { sessionid: "abc" },
    });
    expect(r.ok).toBe(true);
    expect(r.accountId).toBe("doubao:u_42");
    const onDisk = JSON.parse(
      readFileSync(join(hubDir, ACCOUNTS_FILE), "utf-8"),
    );
    expect(onDisk.doubao).toBeTruthy();
    expect(onDisk.doubao.userId).toBe("u_42");
    rmSync(hubDir, { recursive: true, force: true });
  });

  it("throws when hubDir is missing", () => {
    expect(() => getAIChatWizard({})).toThrow(/hubDir/);
  });
});
