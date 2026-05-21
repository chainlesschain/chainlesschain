/**
 * AIChat WebView 鉴权向导 — end-to-end integration test (Phase 10.3.6).
 *
 * Exercises the full chain WITHOUT any real Electron / real network:
 *
 *   cookie-capture-spec
 *      ↓
 *   wizard-controller (paste-fallback mode)
 *      ↓
 *   accountsStore (real fs, temp dir)
 *      ↓
 *   vendor-adapter-bridge (stub validateCookie)
 *      ↓
 *   health-checker (real periodic logic, injected timers)
 *
 * Three scenarios:
 *   - Happy:    probe → register → health=ok
 *   - Expired:  register → mutate stored cookies to "stale" + adapter
 *               returns ok=false → health=failed
 *   - Version:  register at specVersion=1 → bump to specVersion=2 →
 *               health marks SPEC_VERSION_MISMATCH
 *
 * Lives in integration/ rather than adapters/ because it spans modules
 * (controller + factory + health-checker + real fs).
 */

"use strict";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  createAIChatWizardController,
} = require("../../lib/adapters/ai-chat-history/wizard-controller");
const {
  createAIChatHealthChecker,
} = require("../../lib/adapters/ai-chat-history/health-checker");

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRealFsAccountsStore({ hubDir }) {
  // A minimal accountsStore that mirrors the shape used by both desktop
  // factory + cli wizard wirings, but uses fs directly so integration is
  // observable on disk.
  const filePath = join(hubDir, "aichat-accounts.json");
  function readAll() {
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) || {};
    } catch (err) {
      if (err && err.code === "ENOENT") return {};
      return {};
    }
  }
  return {
    get: async (v) => readAll()[v] || null,
    put: async (v, entry) => {
      const all = readAll();
      all[v] = entry;
      writeFileSync(filePath, JSON.stringify(all, null, 2), { mode: 0o600 });
    },
    delete: async (v) => {
      const all = readAll();
      delete all[v];
      writeFileSync(filePath, JSON.stringify(all, null, 2), { mode: 0o600 });
    },
    list: async () => Object.values(readAll()),
    _filePath: filePath,
  };
}

function makeStubVendorAdapter({ behaviorByVendor = {} } = {}) {
  return {
    registerVendor: vi.fn(async (vendor, cookies) => {
      const b = behaviorByVendor[vendor];
      if (typeof b === "function") return b(vendor, cookies);
      return b || { ok: true, userId: "u_" + vendor };
    }),
  };
}

function buildWizard({ accountsStore, vendorAdapter }) {
  // Minimal _deps for paste-fallback mode. classifier/specLookup come
  // from the real spec module.
  const {
    classifyProbedCookies,
    getSpec,
    listVendors,
    COOKIE_SPEC_VERSION,
  } = require("../../lib/adapters/ai-chat-history/cookie-capture-spec");
  return createAIChatWizardController({
    accountsStore,
    vendorAdapter,
    _deps: {
      sessionFactory: () => ({}),
      clock: () => Date.now(),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      classifier: classifyProbedCookies,
      specLookup: getSpec,
      knownVendors: listVendors(),
      cookieSpecVersion: COOKIE_SPEC_VERSION,
      fallbackMode: "paste",
    },
  });
}

let hubDir;
beforeEach(() => {
  hubDir = mkdtempSync(join(tmpdir(), "aichat-wiz-e2e-"));
});
afterEach(() => {
  rmSync(hubDir, { recursive: true, force: true });
});

// ─── Scenario A: happy path ──────────────────────────────────────────────

describe("aichat wizard E2E — happy path", () => {
  it("probe → register → file written → health=ok", async () => {
    const accountsStore = makeRealFsAccountsStore({ hubDir });
    const vendorAdapter = makeStubVendorAdapter({
      behaviorByVendor: { doubao: { ok: true, userId: "u_42" } },
    });
    const wiz = buildWizard({ accountsStore, vendorAdapter });

    // Step 1: open paste-fallback metadata for doubao
    const opened = await wiz.openVendorLogin({ vendor: "doubao" });
    expect(opened.ok).toBe(true);
    expect(opened.fallbackMode).toBe("paste");
    expect(opened.loginUrl).toMatch(/doubao\.com/);

    // Step 2: probe a pasted cookie header
    const probed = await wiz.probeCookies({
      vendor: "doubao",
      cookieHeader: "sessionid=abc; sid_guard=xyz",
    });
    expect(probed.ok).toBe(true);
    expect(probed.foundRequired).toEqual(["sessionid"]);

    // Step 3: register — writes the accounts file on disk
    const registered = await wiz.registerVendor({
      vendor: "doubao",
      cookies: probed.cookies,
    });
    expect(registered.ok).toBe(true);
    expect(registered.accountId).toBe("doubao:u_42");

    const onDisk = JSON.parse(readFileSync(accountsStore._filePath, "utf-8"));
    expect(onDisk.doubao.userId).toBe("u_42");
    expect(onDisk.doubao.cookieSpecVersion).toBe(1);
    expect(onDisk.doubao.lastHealth.ok).toBe(true);

    // Step 4: HealthChecker.runOnce should re-validate and stay ok
    const hc = createAIChatHealthChecker({
      accountsStore, vendorAdapter,
      _deps: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
    });
    const r = await hc.runOnce();
    expect(r).toMatchObject({ checked: 1, ok: 1, failed: 0, mismatch: 0 });
    expect(vendorAdapter.registerVendor).toHaveBeenCalledTimes(2);

    // Stored entry still ok=true; lastHealth.at should have changed.
    const refreshed = JSON.parse(readFileSync(accountsStore._filePath, "utf-8"));
    expect(refreshed.doubao.lastHealth.ok).toBe(true);
  });
});

// ─── Scenario B: cookie expired ──────────────────────────────────────────

describe("aichat wizard E2E — expired path", () => {
  it("after stored cookies stop validating, health marks failed", async () => {
    const accountsStore = makeRealFsAccountsStore({ hubDir });
    let isValid = true;
    const vendorAdapter = makeStubVendorAdapter({
      behaviorByVendor: {
        kimi: async () => (isValid
          ? { ok: true, userId: "u_kimi" }
          : { ok: false, reason: "COOKIE_EXPIRED" }),
      },
    });
    const wiz = buildWizard({ accountsStore, vendorAdapter });

    await wiz.registerVendor({ vendor: "kimi", cookies: { access_token: "ok" } });

    // Simulate the server invalidating the session.
    isValid = false;

    const hc = createAIChatHealthChecker({
      accountsStore, vendorAdapter,
      _deps: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
    });
    const r = await hc.runOnce();
    expect(r).toMatchObject({ checked: 1, ok: 0, failed: 1, mismatch: 0 });

    const refreshed = JSON.parse(readFileSync(accountsStore._filePath, "utf-8"));
    expect(refreshed.kimi.lastHealth).toMatchObject({
      ok: false, reason: "COOKIE_EXPIRED",
    });
  });
});

// ─── Scenario C: spec version mismatch ───────────────────────────────────

describe("aichat wizard E2E — spec version mismatch", () => {
  it("bumping specVersion marks old registrations SPEC_VERSION_MISMATCH", async () => {
    const accountsStore = makeRealFsAccountsStore({ hubDir });
    const vendorAdapter = makeStubVendorAdapter();
    const wiz = buildWizard({ accountsStore, vendorAdapter });

    await wiz.registerVendor({
      vendor: "deepseek",
      cookies: { userToken: "abc" },
    });

    // Bump spec version by passing 2 to HealthChecker (simulates a future
    // cookie-capture-spec version bump).
    const hc = createAIChatHealthChecker({
      accountsStore, vendorAdapter, specVersion: 2,
      _deps: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
    });
    const r = await hc.runOnce();
    expect(r).toMatchObject({ checked: 1, mismatch: 1, ok: 0, failed: 0 });

    const refreshed = JSON.parse(readFileSync(accountsStore._filePath, "utf-8"));
    expect(refreshed.deepseek.lastHealth).toMatchObject({
      ok: false, reason: "SPEC_VERSION_MISMATCH",
    });
    // Adapter should NOT have been called for this entry — version gate
    // short-circuits before validateCookie.
    expect(vendorAdapter.registerVendor).toHaveBeenCalledTimes(1); // only register, no health validate
  });
});

// ─── Scenario D: full lifecycle (register → cleanupOrphanPartitions) ─────

describe("aichat wizard E2E — orphan partition cleanup", () => {
  it("cleanupOrphanPartitions drops partitions whose vendor was never registered", async () => {
    const accountsStore = makeRealFsAccountsStore({ hubDir });
    const vendorAdapter = makeStubVendorAdapter();
    // For this scenario we use the in-test paste fallback — sessions are
    // simulated. cleanupOrphanPartitions runs against the partition list
    // we pass in, returning the vendors it would have cleared.
    const cleared = new Set();
    const wiz = createAIChatWizardController({
      accountsStore,
      vendorAdapter,
      _deps: {
        sessionFactory: (partName) => ({
          clearStorageData: async () => {
            cleared.add(partName);
          },
        }),
        clock: () => Date.now(),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        classifier: require("../../lib/adapters/ai-chat-history/cookie-capture-spec").classifyProbedCookies,
        specLookup: require("../../lib/adapters/ai-chat-history/cookie-capture-spec").getSpec,
        knownVendors: require("../../lib/adapters/ai-chat-history/cookie-capture-spec").listVendors(),
        cookieSpecVersion: 1,
        fallbackMode: "browser-view",
      },
    });

    await wiz.registerVendor({
      vendor: "kimi",
      cookies: { access_token: "x" },
    });

    const result = await wiz.cleanupOrphanPartitions({
      partitions: [
        "persist:aichat-deepseek", // orphan: no entry in store
        "persist:aichat-kimi", // registered: should NOT be cleared
        "persist:aichat-doubao", // orphan
        "persist:unrelated", // not ours: leave alone
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.cleared.sort()).toEqual(["deepseek", "doubao"]);
    expect(cleared.has("persist:aichat-kimi")).toBe(false);
    expect(cleared.has("persist:unrelated")).toBe(false);
  });
});
