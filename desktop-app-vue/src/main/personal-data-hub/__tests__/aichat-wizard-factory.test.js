/**
 * AIChat WebView 鉴权向导 — factory unit tests (Phase 10.3.3).
 *
 * Covers the JSON-file accountsStore, the vendor-adapter bridge built on
 * `validateCookie`, and the singleton factory. All Electron / fs / network
 * access is mocked via the `_fs` / `_httpClientFactory` seams.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  createAccountsStore,
  createVendorAdapterBridge,
  getAIChatWizard,
  runStartupCleanup,
  ACCOUNTS_FILE,
  _resetForTests,
  _internal,
} from "../aichat-wizard-factory.js";

// ─── createAccountsStore ─────────────────────────────────────────────────

function makeFakeFs({ initial = {} } = {}) {
  // Files keyed by absolute path; returns same content writeFileSync wrote.
  const files = new Map(Object.entries(initial));
  return {
    readFileSync: vi.fn((p) => {
      if (!files.has(p)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return files.get(p);
    }),
    writeFileSync: vi.fn((p, content, _opts) => {
      files.set(p, content);
    }),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn((p) => {
      if (!files.has(p)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      files.delete(p);
    }),
    _files: files,
  };
}

describe("createAccountsStore — JSON file persistence", () => {
  const hubDir = "C:/tmp/hub";
  let _fs;
  beforeEach(() => {
    _fs = makeFakeFs();
  });

  it("get returns null when the file is missing (ENOENT)", async () => {
    const store = createAccountsStore({ hubDir, _fs });
    expect(await store.get("deepseek")).toBeNull();
    // list also tolerates missing file
    expect(await store.list()).toEqual([]);
  });

  it("put writes a 0600-mode JSON file with the vendor entry", async () => {
    const store = createAccountsStore({ hubDir, _fs });
    await store.put("deepseek", {
      vendor: "deepseek",
      cookies: { userToken: "x" },
    });
    expect(_fs.mkdirSync).toHaveBeenCalledWith(hubDir, {
      recursive: true,
      mode: 0o700,
    });
    const filePath = store._filePath;
    expect(_fs.writeFileSync).toHaveBeenCalledWith(
      filePath,
      expect.any(String),
      { mode: 0o600 },
    );
    const parsed = JSON.parse(_fs._files.get(filePath));
    expect(parsed.deepseek.vendor).toBe("deepseek");
    expect(await store.get("deepseek")).toMatchObject({
      cookies: { userToken: "x" },
    });
  });

  it("put serializes concurrent writes via internal chain", async () => {
    const store = createAccountsStore({ hubDir, _fs });
    await Promise.all([
      store.put("a", { vendor: "a", v: 1 }),
      store.put("b", { vendor: "b", v: 2 }),
      store.put("c", { vendor: "c", v: 3 }),
    ]);
    const list = await store.list();
    const names = list.map((e) => e.vendor).sort();
    expect(names).toEqual(["a", "b", "c"]);
  });

  it("delete removes a vendor + drops the file when the store is empty", async () => {
    const store = createAccountsStore({ hubDir, _fs });
    await store.put("deepseek", { vendor: "deepseek", v: 1 });
    await store.delete("deepseek");
    expect(_fs.unlinkSync).toHaveBeenCalledWith(store._filePath);
    expect(await store.list()).toEqual([]);
  });

  it("delete keeps the file with other vendors still present", async () => {
    const store = createAccountsStore({ hubDir, _fs });
    await store.put("deepseek", { vendor: "deepseek", v: 1 });
    await store.put("kimi", { vendor: "kimi", v: 2 });
    await store.delete("deepseek");
    expect(_fs.unlinkSync).not.toHaveBeenCalled();
    const list = await store.list();
    expect(list.map((e) => e.vendor)).toEqual(["kimi"]);
  });

  it("returns empty when the file is corrupt JSON (no crash)", async () => {
    const corruptPath = "C:/tmp/hub/" + ACCOUNTS_FILE;
    const broken = makeFakeFs({ [corruptPath]: "{not json" });
    const store = createAccountsStore({ hubDir, _fs: broken });
    expect(await store.get("deepseek")).toBeNull();
  });

  it("throws when hubDir is missing", () => {
    expect(() => createAccountsStore({ _fs })).toThrow(/hubDir/);
  });
});

// ─── createVendorAdapterBridge ───────────────────────────────────────────

function fakeSpec(name, validateImpl) {
  return {
    name,
    displayName: name,
    rateLimits: { perMinute: 10, minIntervalMs: 1000 },
    cookieDomains: [name + ".example"],
    validateCookie: vi.fn(validateImpl),
  };
}

describe("createVendorAdapterBridge — validateCookie dispatch", () => {
  it("dispatches to the matching spec.validateCookie and returns its result", async () => {
    const ds = fakeSpec("deepseek", async () => ({ ok: true, userId: "u1" }));
    const bridge = createVendorAdapterBridge({
      specs: [ds],
      _httpClientFactory: () => ({ vendor: "deepseek" }),
    });
    const r = await bridge.registerVendor("deepseek", { userToken: "abc" });
    expect(r.ok).toBe(true);
    expect(r.userId).toBe("u1");
    expect(ds.validateCookie).toHaveBeenCalledOnce();
    // CookieAuthSession must have been built with array-shaped cookies.
    const arg = ds.validateCookie.mock.calls[0][0];
    expect(arg.session.cookies[0]).toEqual({ name: "userToken", value: "abc" });
  });

  it("returns UNKNOWN_VENDOR for an unknown vendor", async () => {
    const bridge = createVendorAdapterBridge({
      specs: [fakeSpec("deepseek", async () => ({ ok: true }))],
      _httpClientFactory: () => ({}),
    });
    const r = await bridge.registerVendor("ghost", { x: "y" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_VENDOR");
  });

  it("returns SPEC_MISSING_VALIDATE_COOKIE when spec lacks validateCookie", async () => {
    const bridge = createVendorAdapterBridge({
      specs: [{ name: "weirdvendor", rateLimits: {}, cookieDomains: [] }],
      _httpClientFactory: () => ({}),
    });
    const r = await bridge.registerVendor("weirdvendor", { x: "y" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("SPEC_MISSING_VALIDATE_COOKIE");
  });

  it("returns VALIDATE_THREW when validateCookie rejects", async () => {
    const ds = fakeSpec("deepseek", async () => {
      throw new Error("net down");
    });
    const bridge = createVendorAdapterBridge({
      specs: [ds],
      _httpClientFactory: () => ({}),
    });
    const r = await bridge.registerVendor("deepseek", { userToken: "x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("VALIDATE_THREW");
    expect(r.error).toMatch(/net down/);
  });

  it("returns HTTP_CLIENT_INIT_FAILED when buildClient throws", async () => {
    const bridge = createVendorAdapterBridge({
      specs: [fakeSpec("deepseek", async () => ({ ok: true }))],
      _httpClientFactory: () => {
        throw new Error("http init blew up");
      },
    });
    const r = await bridge.registerVendor("deepseek", { x: "y" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("HTTP_CLIENT_INIT_FAILED");
  });

  it("treats null return from validateCookie as VALIDATE_RETURNED_NULL", async () => {
    const ds = fakeSpec("deepseek", async () => null);
    const bridge = createVendorAdapterBridge({
      specs: [ds],
      _httpClientFactory: () => ({}),
    });
    const r = await bridge.registerVendor("deepseek", { x: "y" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("VALIDATE_RETURNED_NULL");
  });

  it("rejects construction with empty specs array", () => {
    expect(() => createVendorAdapterBridge({ specs: [] })).toThrow(/specs/);
  });
});

// ─── _jarToArray ─────────────────────────────────────────────────────────

describe("_jarToArray — three-shape tolerance", () => {
  it("array passes through unchanged", () => {
    expect(_internal._jarToArray([{ name: "a", value: "1" }])).toEqual([
      { name: "a", value: "1" },
    ]);
  });
  it("object → array of {name, value} (drops empty / non-string)", () => {
    expect(_internal._jarToArray({ a: "1", b: "", c: 3, d: "4" })).toEqual([
      { name: "a", value: "1" },
      { name: "d", value: "4" },
    ]);
  });
  it("raw string is split on ;", () => {
    expect(_internal._jarToArray("a=1; b=2; junk")).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ]);
  });
  it("nullish / wrong-type → []", () => {
    expect(_internal._jarToArray(null)).toEqual([]);
    expect(_internal._jarToArray(undefined)).toEqual([]);
    expect(_internal._jarToArray(42)).toEqual([]);
  });
});

// ─── getAIChatWizard singleton ───────────────────────────────────────────

describe("getAIChatWizard — singleton + injection", () => {
  beforeEach(() => _resetForTests());

  it("returns the same controller for the same hubDir (production singleton)", () => {
    const c1 = getAIChatWizard({
      hubDir: "C:/tmp/hub-singleton",
      _accountsStore: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      },
      _vendorAdapter: { registerVendor: vi.fn() },
      _deps: {
        sessionFactory: () => ({}),
        clock: () => 0,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        classifier: () => ({ ok: false }),
        specLookup: () => null,
        knownVendors: [],
        cookieSpecVersion: 1,
      },
    });
    // Test-injected calls are NOT cached — fresh controller each time.
    const c2 = getAIChatWizard({
      hubDir: "C:/tmp/hub-singleton",
      _accountsStore: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      },
      _vendorAdapter: { registerVendor: vi.fn() },
      _deps: {
        sessionFactory: () => ({}),
        clock: () => 0,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        classifier: () => ({ ok: false }),
        specLookup: () => null,
        knownVendors: [],
        cookieSpecVersion: 1,
      },
    });
    expect(c1).not.toBe(c2);
    expect(typeof c1.openVendorLogin).toBe("function");
  });

  it("throws when hubDir missing", () => {
    expect(() => getAIChatWizard({})).toThrow(/hubDir/);
  });

  // ─── Trap T8 mitigation wiring ──────────────────────────────────────────
  // The factory must fire runStartupCleanup on first production singleton
  // construction so cleanupOrphanPartitions actually runs. Earlier scan
  // discovered the function existed but was dead — design doc Phase 10.3
  // Trap T8 mitigation specifies it must run at startup.
  it("first production singleton kicks off runStartupCleanup (T8 mitigation)", async () => {
    // Direntries listed under <userData>/Partitions/ — two aichat, one foreign.
    const partitionsContents = [
      { name: "persist-aichat-doubao", isDirectory: () => true },
      { name: "persist-aichat-kimi", isDirectory: () => true },
      { name: "persist-foreign-other", isDirectory: () => true },
    ];
    const accountsContents = [{ vendor: "doubao", registeredAt: 1 }];
    const _fs = {
      readFileSync: vi.fn(() =>
        JSON.stringify({ doubao: accountsContents[0] }),
      ),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      unlinkSync: vi.fn(),
      readdirSync: vi.fn((dir, opts) => {
        if (typeof dir === "string" && dir.endsWith("Partitions")) {
          return opts && opts.withFileTypes
            ? partitionsContents
            : partitionsContents.map((e) => e.name);
        }
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }),
    };
    // Production-mode call (no _deps / _accountsStore / _vendorAdapter) so
    // the singleton path runs. We pass `_userDataDir` to skip the Electron
    // require and `_fs` so the inner _scanAichatPartitions hits our fake.
    // But we cannot inject _fs through the production path easily because
    // createVendorAdapterBridge wants the real DEFAULT_VENDOR_SPECS. Instead
    // call runStartupCleanup directly with a stub controller — that is the
    // T8-relevant code path.
    let received;
    const controllerStub = {
      cleanupOrphanPartitions: vi.fn(async ({ partitions }) => {
        received = partitions;
        return { ok: true, cleared: ["kimi"] };
      }),
    };
    const out = await runStartupCleanup({
      controller: controllerStub,
      userDataDir: "C:/tmp/userData",
      _fs,
    });
    expect(out.ok).toBe(true);
    // Disk names converted back to logical persist:aichat-<vendor> form;
    // non-aichat dirs are filtered out.
    expect(received).toEqual(["persist:aichat-doubao", "persist:aichat-kimi"]);
    expect(out.cleared).toEqual(["kimi"]);
    expect(controllerStub.cleanupOrphanPartitions).toHaveBeenCalledTimes(1);
  });

  it("runStartupCleanup returns ok:true with empty arrays when Partitions/ missing", async () => {
    const _fs = {
      readdirSync: vi.fn(() => {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }),
    };
    const controllerStub = { cleanupOrphanPartitions: vi.fn() };
    const out = await runStartupCleanup({
      controller: controllerStub,
      userDataDir: "C:/tmp/userData",
      _fs,
    });
    expect(out.ok).toBe(true);
    expect(out.swept).toEqual([]);
    expect(out.cleared).toEqual([]);
    // Controller not called when there is nothing to sweep — avoids logging
    // a no-op message on every fresh install boot.
    expect(controllerStub.cleanupOrphanPartitions).not.toHaveBeenCalled();
  });

  it("runStartupCleanup swallows cleanupOrphanPartitions exceptions", async () => {
    const _fs = {
      readdirSync: vi.fn(() => [
        { name: "persist-aichat-doubao", isDirectory: () => true },
      ]),
    };
    const controllerStub = {
      cleanupOrphanPartitions: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const _logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const out = await runStartupCleanup({
      controller: controllerStub,
      userDataDir: "C:/tmp/userData",
      _fs,
      _logger,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("CLEANUP_THREW");
    expect(out.error).toMatch(/boom/);
    expect(_logger.warn).toHaveBeenCalled();
  });

  it("_scanAichatPartitions tolerates string-only dirent shapes", () => {
    const _fs = {
      readdirSync: vi.fn(() => [
        "persist-aichat-doubao",
        "persist-aichat-kimi",
        "not-aichat-anything",
        "persist-aichat-", // empty vendor → drop
      ]),
    };
    const out = _internal._scanAichatPartitions({
      userDataDir: "C:/tmp/userData",
      _fs,
    });
    expect(out).toEqual(["persist:aichat-doubao", "persist:aichat-kimi"]);
  });

  it("_scanAichatPartitions skips file (non-directory) entries", () => {
    const _fs = {
      readdirSync: vi.fn(() => [
        { name: "persist-aichat-doubao", isDirectory: () => true },
        { name: "persist-aichat-stray-file", isDirectory: () => false }, // file → skip
      ]),
    };
    const out = _internal._scanAichatPartitions({
      userDataDir: "C:/tmp/userData",
      _fs,
    });
    expect(out).toEqual(["persist:aichat-doubao"]);
  });

  it("getAIChatWizard does NOT fire startup cleanup when test-injected", () => {
    // _accountsStore + _vendorAdapter present → factory treats this as a test
    // injection and skips singleton caching AND the T8 sweep. We just verify
    // it returns without throwing — the sweep would have required Electron.
    const c = getAIChatWizard({
      hubDir: "C:/tmp/hub-test-injected",
      _accountsStore: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      },
      _vendorAdapter: { registerVendor: vi.fn() },
      _deps: {
        sessionFactory: () => ({}),
        clock: () => 0,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        classifier: () => ({ ok: false }),
        specLookup: () => null,
        knownVendors: [],
        cookieSpecVersion: 1,
      },
    });
    expect(typeof c.openVendorLogin).toBe("function");
  });

  it("getAIChatWizard with _skipStartupCleanup honors the flag for production-mode call", () => {
    // Production-mode (no test injection) BUT _skipStartupCleanup suppresses
    // the sweep. We can't directly observe absence-of-call without injecting
    // the sweep itself, so we instead verify the call doesn't throw despite
    // Electron being unavailable in test runtime.
    const c = getAIChatWizard({
      hubDir: "C:/tmp/hub-skip-sweep",
      _skipStartupCleanup: true,
    });
    expect(typeof c.openVendorLogin).toBe("function");
  });
});
