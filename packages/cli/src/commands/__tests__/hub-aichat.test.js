/**
 * cc hub aichat <verb> CLI command unit tests (Phase 10.3.6 CLI surface).
 *
 * The command handlers accept `_wizard` / `_getHub` / `_factoryDeps` test
 * seams so this suite never starts a real hub or fs. We invoke the handler
 * functions directly via the `_internal` export.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _internal } from "../hub.js";

let logSpy, errSpy, exitSpy;

function fakeWizard(overrides = {}) {
  return {
    openVendorLogin: vi.fn(async ({ vendor }) => ({
      ok: true,
      vendor,
      fallbackMode: "paste",
      loginUrl: "https://" + vendor + ".example/",
      requiredCookies: ["theToken"],
      helpText: "登录 " + vendor,
      ...overrides.openVendorLogin,
    })),
    probeCookies: vi.fn(async ({ vendor, cookieHeader }) => ({
      ok: cookieHeader && cookieHeader.includes("theToken="),
      source: "paste",
      vendor,
      cookies: { theToken: "v" },
      foundRequired:
        cookieHeader && cookieHeader.includes("theToken=") ? ["theToken"] : [],
      missingRequired:
        cookieHeader && cookieHeader.includes("theToken=") ? [] : ["theToken"],
      foundOptional: [],
      ...overrides.probeCookies,
    })),
    registerVendor: vi.fn(async ({ vendor, cookies }) => {
      if (!cookies || !cookies.includes("theToken=")) {
        return {
          ok: false,
          reason: "REQUIRED_COOKIES_MISSING",
          missingRequired: ["theToken"],
        };
      }
      return { ok: true, vendor, accountId: `${vendor}:u1` };
    }),
    rotateLoginPartition: vi.fn(async () => ({ ok: true })),
  };
}

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
    throw new Error("process.exit called");
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  exitSpy.mockRestore();
});

// ─── cmdAIChatList ────────────────────────────────────────────────────────

describe("cc hub aichat list", () => {
  it("prints all 9 default vendors with login URLs (text mode)", async () => {
    const wiz = fakeWizard();
    await _internal.cmdAIChatList({ _wizard: wiz });
    expect(wiz.openVendorLogin).toHaveBeenCalledTimes(9);
    const calledVendors = wiz.openVendorLogin.mock.calls.map(
      (c) => c[0].vendor,
    );
    expect(calledVendors).toEqual(_internal._defaultKnownVendors());
  });

  it("emits JSON with --json including the vendor array", async () => {
    const wiz = fakeWizard();
    await _internal.cmdAIChatList({ _wizard: wiz, json: true });
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.vendors.length).toBe(9);
    expect(parsed.vendors[0]).toHaveProperty("vendor");
    expect(parsed.vendors[0]).toHaveProperty("loginUrl");
  });

  it("restricts to a custom vendor list via _knownVendors", async () => {
    const wiz = fakeWizard();
    await _internal.cmdAIChatList({
      _wizard: wiz,
      _knownVendors: ["kimi", "doubao"],
    });
    expect(wiz.openVendorLogin).toHaveBeenCalledTimes(2);
  });
});

// ─── cmdAIChatLogin ───────────────────────────────────────────────────────

describe("cc hub aichat login <vendor>", () => {
  it("prints loginUrl + helpText for the given vendor", async () => {
    const wiz = fakeWizard();
    await _internal.cmdAIChatLogin("deepseek", { _wizard: wiz });
    expect(wiz.openVendorLogin).toHaveBeenCalledWith({ vendor: "deepseek" });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/deepseek\.example/);
    expect(out).toMatch(/登录 deepseek/);
  });

  it("--json passes the wizard return shape verbatim", async () => {
    const wiz = fakeWizard();
    await _internal.cmdAIChatLogin("kimi", { _wizard: wiz, json: true });
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.ok).toBe(true);
    expect(parsed.fallbackMode).toBe("paste");
  });

  it("exits with code 1 when wizard returns ok=false", async () => {
    const wiz = fakeWizard({
      openVendorLogin: { ok: false, reason: "UNKNOWN_VENDOR" },
    });
    await expect(
      _internal.cmdAIChatLogin("ghost", { _wizard: wiz }),
    ).rejects.toThrow(/process.exit/);
  });
});

// ─── cmdAIChatProbe ───────────────────────────────────────────────────────

describe("cc hub aichat probe <vendor> --cookies", () => {
  it("ok when --cookies contains required token", async () => {
    const wiz = fakeWizard();
    await _internal.cmdAIChatProbe("deepseek", {
      _wizard: wiz,
      cookies: "theToken=abc; other=1",
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/cookies look valid/);
  });

  it("exits 1 with reason when required missing", async () => {
    const wiz = fakeWizard();
    await expect(
      _internal.cmdAIChatProbe("deepseek", { _wizard: wiz, cookies: "junk=x" }),
    ).rejects.toThrow(/process.exit/);
  });

  it("throws when --cookies omitted", async () => {
    const wiz = fakeWizard();
    await expect(
      _internal.cmdAIChatProbe("deepseek", { _wizard: wiz }),
    ).rejects.toThrow(/process.exit/);
    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── cmdAIChatRegister ────────────────────────────────────────────────────

describe("cc hub aichat register <vendor> --cookies", () => {
  it("happy path: prints confirmation with accountId", async () => {
    const wiz = fakeWizard();
    await _internal.cmdAIChatRegister("doubao", {
      _wizard: wiz,
      cookies: "theToken=abc",
    });
    expect(wiz.registerVendor).toHaveBeenCalledWith({
      vendor: "doubao",
      cookies: "theToken=abc",
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/registered doubao/);
  });

  it("exits 1 when required cookies missing", async () => {
    const wiz = fakeWizard();
    await expect(
      _internal.cmdAIChatRegister("doubao", {
        _wizard: wiz,
        cookies: "junk=1",
      }),
    ).rejects.toThrow(/process.exit/);
    const errs = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errs).toMatch(/REQUIRED_COOKIES_MISSING/);
  });
});

// ─── cmdAIChatHealth ──────────────────────────────────────────────────────

describe("cc hub aichat health", () => {
  let hubDir;
  beforeEach(() => {
    hubDir = mkdtempSync(join(tmpdir(), "aichat-cli-health-"));
  });
  afterEach(() => rmSync(hubDir, { recursive: true, force: true }));

  it("returns zero counts on an empty accounts store", async () => {
    const accountsStore = {
      list: async () => [],
      put: async () => {},
      get: async () => null,
      delete: async () => {},
    };
    const vendorAdapter = { registerVendor: async () => ({ ok: true }) };
    await _internal.cmdAIChatHealth({
      json: true,
      _factoryDeps: { hubDir, accountsStore, vendorAdapter },
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({ checked: 0, ok: 0, failed: 0, mismatch: 0 });
  });

  it("text output summarises checked / ok / failed / mismatch", async () => {
    const accountsStore = {
      list: async () => [
        { vendor: "deepseek", cookies: { x: "y" }, cookieSpecVersion: 1 },
      ],
      put: async () => {},
      get: async () => null,
      delete: async () => {},
    };
    const vendorAdapter = { registerVendor: async () => ({ ok: true }) };
    await _internal.cmdAIChatHealth({
      _factoryDeps: { hubDir, accountsStore, vendorAdapter },
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/checked=1/);
    expect(out).toMatch(/ok=1/);
  });
});

// ─── cmdAIChatUnregister ──────────────────────────────────────────────────

describe("cc hub aichat unregister <vendor>", () => {
  let hubDir;
  beforeEach(() => {
    hubDir = mkdtempSync(join(tmpdir(), "aichat-cli-unreg-"));
  });
  afterEach(() => rmSync(hubDir, { recursive: true, force: true }));

  it("removes a registered vendor", async () => {
    const store = new Map([["deepseek", { vendor: "deepseek" }]]);
    const accountsStore = {
      list: async () => Array.from(store.values()),
      get: async (v) => store.get(v) || null,
      put: async (v, e) => store.set(v, e),
      delete: async (v) => store.delete(v),
    };
    await _internal.cmdAIChatUnregister("deepseek", {
      _factoryDeps: { hubDir, accountsStore },
    });
    expect(store.has("deepseek")).toBe(false);
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/removed deepseek/);
  });

  it("exits 1 when the vendor is not registered", async () => {
    const accountsStore = {
      list: async () => [],
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    };
    await expect(
      _internal.cmdAIChatUnregister("kimi", {
        _factoryDeps: { hubDir, accountsStore },
      }),
    ).rejects.toThrow(/process.exit/);
    const errs = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errs).toMatch(/not registered/);
  });
});
