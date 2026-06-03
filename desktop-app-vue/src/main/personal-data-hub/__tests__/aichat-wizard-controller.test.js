/**
 * AIChat WebView 鉴权向导 — wizard-controller unit tests (Phase 10.3.2).
 *
 * All Electron dependencies are injected via `_deps`; no real Electron
 * imports happen here, so this runs under vanilla Node + vitest.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createAIChatWizardController,
  PARTITION_PREFIX,
  _internal,
} from "@chainlesschain/personal-data-hub/adapters/ai-chat-history/wizard-controller";

// ─── fakes ────────────────────────────────────────────────────────────────

function makeFakeSession({ cookieMap = {} } = {}) {
  // cookieMap is { domain: [{ name, value }, ...] }
  const clearCalls = [];
  return {
    cookies: {
      get: vi.fn(async ({ domain }) => {
        const exact = cookieMap[domain] || [];
        const dotted = cookieMap["." + domain] || [];
        return [...exact, ...dotted];
      }),
    },
    clearStorageData: vi.fn(async (opts) => {
      clearCalls.push(opts);
    }),
    _clearCalls: clearCalls,
  };
}

function makeFakeAccountsStore({ initial = {} } = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (vendor) => store.get(vendor) || null),
    put: vi.fn(async (vendor, entry) => {
      store.set(vendor, entry);
    }),
    delete: vi.fn(async (vendor) => store.delete(vendor)),
    list: vi.fn(async () => Array.from(store.values())),
    _store: store,
  };
}

function makeFakeAdapter({
  validate = async () => ({ ok: true, userId: "u_123" }),
} = {}) {
  return {
    registerVendor: vi.fn(async (vendor, cookies, opts) =>
      validate(vendor, cookies, opts),
    ),
  };
}

function makeDeps({
  sessions = new Map(),
  fallbackMode = "browser-view",
  clock = () => 1700000000000,
} = {}) {
  return {
    sessionFactory: vi.fn((partition) => {
      if (!sessions.has(partition)) {
        sessions.set(partition, makeFakeSession());
      }
      return sessions.get(partition);
    }),
    clock,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    classifier:
      require("@chainlesschain/personal-data-hub/lib/adapters/ai-chat-history/cookie-capture-spec")
        .classifyProbedCookies,
    specLookup:
      require("@chainlesschain/personal-data-hub/lib/adapters/ai-chat-history/cookie-capture-spec")
        .getSpec,
    knownVendors:
      require("@chainlesschain/personal-data-hub/lib/adapters/ai-chat-history/cookie-capture-spec").listVendors(),
    cookieSpecVersion: 1,
    fallbackMode,
    _sessions: sessions,
  };
}

// ─── construction guards ─────────────────────────────────────────────────

describe("createAIChatWizardController — argument guards", () => {
  it("throws when accountsStore is missing", () => {
    expect(() =>
      createAIChatWizardController({
        vendorAdapter: makeFakeAdapter(),
        _deps: makeDeps(),
      }),
    ).toThrow(/accountsStore/);
  });
  it("throws when accountsStore.get is not a function", () => {
    expect(() =>
      createAIChatWizardController({
        accountsStore: {},
        vendorAdapter: makeFakeAdapter(),
        _deps: makeDeps(),
      }),
    ).toThrow(/accountsStore/);
  });
  it("throws when vendorAdapter.registerVendor is missing", () => {
    expect(() =>
      createAIChatWizardController({
        accountsStore: makeFakeAccountsStore(),
        vendorAdapter: {},
        _deps: makeDeps(),
      }),
    ).toThrow(/vendorAdapter.registerVendor/);
  });
});

// ─── openVendorLogin ─────────────────────────────────────────────────────

describe("openVendorLogin", () => {
  it("returns browser-view metadata for a known vendor on desktop", async () => {
    const deps = makeDeps();
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: deps,
    });
    const r = await ctrl.openVendorLogin({ vendor: "deepseek" });
    expect(r.ok).toBe(true);
    expect(r.fallbackMode).toBe("browser-view");
    expect(r.partition).toBe(PARTITION_PREFIX + "deepseek");
    expect(r.loginUrl).toMatch(/chat\.deepseek\.com/);
    expect(r.cookieDomains.length).toBeGreaterThan(0);
    expect(deps.sessionFactory).toHaveBeenCalledWith(
      PARTITION_PREFIX + "deepseek",
    );
  });

  it("returns paste fallback when web-shell mode is set", async () => {
    const deps = makeDeps({ fallbackMode: "paste" });
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: deps,
    });
    const r = await ctrl.openVendorLogin({ vendor: "kimi" });
    expect(r.ok).toBe(true);
    expect(r.fallbackMode).toBe("paste");
    expect(r.loginUrl).toMatch(/kimi\.moonshot\.cn/);
    expect(r.requiredCookies).toContain("access_token");
    expect(r.helpText).toMatch(/外部浏览器/);
    // Should NOT have probed Electron when in paste mode.
    expect(deps.sessionFactory).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN_VENDOR for an unrecognized vendor name", async () => {
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps(),
    });
    const r = await ctrl.openVendorLogin({ vendor: "notarealvendor" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_VENDOR");
  });

  it("when opts.reuseSession=false, clearStorageData is invoked", async () => {
    const sessions = new Map();
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps({ sessions }),
    });
    await ctrl.openVendorLogin({
      vendor: "doubao",
      opts: { reuseSession: false },
    });
    const session = sessions.get(PARTITION_PREFIX + "doubao");
    expect(session.clearStorageData).toHaveBeenCalledWith({
      storages: ["cookies"],
    });
  });

  it("surfaces SESSION_INIT_FAILED if sessionFactory throws", async () => {
    const deps = makeDeps();
    deps.sessionFactory = vi.fn(() => {
      throw new Error("partition init blew up");
    });
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: deps,
    });
    const r = await ctrl.openVendorLogin({ vendor: "deepseek" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("SESSION_INIT_FAILED");
    expect(r.error).toMatch(/partition init blew up/);
  });
});

// ─── probeCookies ────────────────────────────────────────────────────────

describe("probeCookies", () => {
  it("reads cookies from the partition session and classifies as ok=true", async () => {
    const sessions = new Map();
    const partition = PARTITION_PREFIX + "deepseek";
    sessions.set(
      partition,
      makeFakeSession({
        cookieMap: {
          "chat.deepseek.com": [{ name: "userToken", value: "tok123" }],
          "deepseek.com": [{ name: "intercom-session-deepseek", value: "i1" }],
        },
      }),
    );
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps({ sessions }),
    });
    const r = await ctrl.probeCookies({ vendor: "deepseek" });
    expect(r.ok).toBe(true);
    expect(r.source).toBe("browser-view");
    expect(r.foundRequired).toEqual(["userToken"]);
    expect(r.cookies.userToken).toBe("tok123");
  });

  it("reports missing required cookies when partition has none", async () => {
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps(),
    });
    const r = await ctrl.probeCookies({ vendor: "kimi" });
    expect(r.ok).toBe(false);
    expect(r.missingRequired).toEqual(["access_token"]);
  });

  it("accepts cookieHeader paste fallback and overrides BrowserView path", async () => {
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps(),
    });
    const r = await ctrl.probeCookies({
      vendor: "doubao",
      cookieHeader: "sessionid=abc; sid_guard=xyz; passport_csrf_token=csrf",
    });
    expect(r.ok).toBe(true);
    expect(r.source).toBe("paste");
    expect(r.cookies.sessionid).toBe("abc");
    expect(r.foundOptional.sort()).toEqual([
      "passport_csrf_token",
      "sid_guard",
    ]);
  });

  it("paste-fallback projection drops cookies not in the spec allow-list", async () => {
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps(),
    });
    const r = await ctrl.probeCookies({
      vendor: "doubao",
      cookieHeader:
        "sessionid=abc; sid_guard=xyz; _trackingHash=should-be-stripped; passport_csrf_token=csrf",
    });
    expect(r.ok).toBe(true);
    expect(r.cookies._trackingHash).toBeUndefined();
    expect(Object.keys(r.cookies).sort()).toEqual([
      "passport_csrf_token",
      "sessionid",
      "sid_guard",
    ]);
  });

  it("returns PASTE_REQUIRED when fallbackMode=paste and no header supplied", async () => {
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps({ fallbackMode: "paste" }),
    });
    const r = await ctrl.probeCookies({ vendor: "kimi" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("PASTE_REQUIRED");
  });

  it("returns UNKNOWN_VENDOR for unknown vendor names", async () => {
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps(),
    });
    const r = await ctrl.probeCookies({ vendor: "ghost" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_VENDOR");
  });

  it("tolerates per-domain cookies.get throwing for one domain", async () => {
    const sessions = new Map();
    const partition = PARTITION_PREFIX + "tongyi";
    const session = {
      cookies: {
        get: vi.fn(async ({ domain }) => {
          if (domain === "aliyun.com") {
            throw new Error("network blip");
          }
          return [{ name: "login_aliyunid", value: "u1" }];
        }),
      },
    };
    sessions.set(partition, session);
    const deps = makeDeps({ sessions });
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: deps,
    });
    const r = await ctrl.probeCookies({ vendor: "tongyi" });
    expect(r.ok).toBe(true);
    expect(deps.logger.warn).toHaveBeenCalled();
  });
});

// ─── registerVendor ──────────────────────────────────────────────────────

describe("registerVendor", () => {
  it("persists an account entry on successful validation", async () => {
    const store = makeFakeAccountsStore();
    const adapter = makeFakeAdapter({
      validate: async () => ({ ok: true, userId: "u_42" }),
    });
    const ctrl = createAIChatWizardController({
      accountsStore: store,
      vendorAdapter: adapter,
      _deps: makeDeps({ clock: () => 1700000000000 }),
    });
    const r = await ctrl.registerVendor({
      vendor: "doubao",
      cookies: { sessionid: "s1", sid_guard: "g1" },
    });
    expect(r.ok).toBe(true);
    expect(r.accountId).toBe("doubao:u_42");
    expect(store.put).toHaveBeenCalledOnce();
    const stored = store._store.get("doubao");
    expect(stored.vendor).toBe("doubao");
    expect(stored.cookies.sessionid).toBe("s1");
    expect(stored.userId).toBe("u_42");
    expect(stored.cookieSpecVersion).toBe(1);
    expect(stored.lastHealth.ok).toBe(true);
  });

  it("does not advance registeredAt when re-registering an existing vendor", async () => {
    const initial = {
      doubao: {
        vendor: "doubao",
        registeredAt: 1600000000000,
        cookies: { sessionid: "old" },
      },
    };
    const store = makeFakeAccountsStore({ initial });
    const ctrl = createAIChatWizardController({
      accountsStore: store,
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps({ clock: () => 1700000000000 }),
    });
    const r = await ctrl.registerVendor({
      vendor: "doubao",
      cookies: { sessionid: "new" },
    });
    expect(r.ok).toBe(true);
    expect(store._store.get("doubao").registeredAt).toBe(1600000000000);
  });

  it("returns REQUIRED_COOKIES_MISSING without calling adapter when cookies incomplete", async () => {
    const store = makeFakeAccountsStore();
    const adapter = makeFakeAdapter();
    const ctrl = createAIChatWizardController({
      accountsStore: store,
      vendorAdapter: adapter,
      _deps: makeDeps(),
    });
    const r = await ctrl.registerVendor({
      vendor: "deepseek",
      cookies: { unrelated: "x" },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("REQUIRED_COOKIES_MISSING");
    expect(r.missingRequired).toEqual(["userToken"]);
    expect(adapter.registerVendor).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("returns VALIDATE_COOKIE_FAILED with adapter reason when validation fails", async () => {
    const adapter = makeFakeAdapter({
      validate: async () => ({
        ok: false,
        reason: "UNEXPECTED_RESPONSE_SHAPE",
      }),
    });
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: adapter,
      _deps: makeDeps(),
    });
    const r = await ctrl.registerVendor({
      vendor: "deepseek",
      cookies: { userToken: "x" },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNEXPECTED_RESPONSE_SHAPE");
  });

  it("returns ADAPTER_THREW when registerVendor rejects", async () => {
    const adapter = makeFakeAdapter({
      validate: async () => {
        throw new Error("network down");
      },
    });
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: adapter,
      _deps: makeDeps(),
    });
    const r = await ctrl.registerVendor({
      vendor: "deepseek",
      cookies: { userToken: "x" },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ADAPTER_THREW");
    expect(r.error).toMatch(/network down/);
  });

  it("returns UNKNOWN_VENDOR for unknown vendor names", async () => {
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps(),
    });
    const r = await ctrl.registerVendor({
      vendor: "ghost",
      cookies: { x: "y" },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_VENDOR");
  });
});

// ─── rotateLoginPartition ────────────────────────────────────────────────

describe("rotateLoginPartition", () => {
  it("clears cookie storage and returns fresh openVendorLogin metadata", async () => {
    const sessions = new Map();
    const partition = PARTITION_PREFIX + "deepseek";
    sessions.set(partition, makeFakeSession());
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps({ sessions }),
    });
    const r = await ctrl.rotateLoginPartition({ vendor: "deepseek" });
    expect(r.ok).toBe(true);
    expect(r.fallbackMode).toBe("browser-view");
    expect(sessions.get(partition).clearStorageData).toHaveBeenCalled();
  });

  it("does not clear storage in paste mode", async () => {
    const sessions = new Map();
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps({ sessions, fallbackMode: "paste" }),
    });
    const r = await ctrl.rotateLoginPartition({ vendor: "kimi" });
    expect(r.ok).toBe(true);
    expect(r.fallbackMode).toBe("paste");
  });

  it("returns UNKNOWN_VENDOR for unknown vendor names", async () => {
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps(),
    });
    const r = await ctrl.rotateLoginPartition({ vendor: "ghost" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_VENDOR");
  });
});

// ─── cleanupOrphanPartitions ─────────────────────────────────────────────

describe("cleanupOrphanPartitions", () => {
  it("clears partitions whose vendor is not in accounts.json", async () => {
    const sessions = new Map();
    const orphan = PARTITION_PREFIX + "deepseek";
    const keep = PARTITION_PREFIX + "kimi";
    sessions.set(orphan, makeFakeSession());
    sessions.set(keep, makeFakeSession());
    const store = makeFakeAccountsStore({
      initial: {
        kimi: {
          vendor: "kimi",
          registeredAt: 1,
          cookies: { access_token: "t" },
        },
      },
    });
    const ctrl = createAIChatWizardController({
      accountsStore: store,
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps({ sessions }),
    });
    const r = await ctrl.cleanupOrphanPartitions({
      partitions: [orphan, keep, "persist:unrelated"],
    });
    expect(r.ok).toBe(true);
    expect(r.cleared).toEqual(["deepseek"]);
    expect(sessions.get(orphan).clearStorageData).toHaveBeenCalled();
    expect(sessions.get(keep).clearStorageData).not.toHaveBeenCalled();
  });

  it("leaves unknown-vendor partitions alone (defensive — not ours)", async () => {
    const sessions = new Map();
    const ours = PARTITION_PREFIX + "doubao";
    const notOurs = PARTITION_PREFIX + "ghostvendor";
    sessions.set(ours, makeFakeSession());
    sessions.set(notOurs, makeFakeSession());
    const ctrl = createAIChatWizardController({
      accountsStore: makeFakeAccountsStore(),
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps({ sessions }),
    });
    const r = await ctrl.cleanupOrphanPartitions({
      partitions: [ours, notOurs],
    });
    expect(r.cleared).toEqual(["doubao"]);
    expect(sessions.get(notOurs).clearStorageData).not.toHaveBeenCalled();
  });

  it("returns ACCOUNTS_LIST_FAILED when accountsStore.list throws", async () => {
    const broken = makeFakeAccountsStore();
    broken.list = vi.fn(async () => {
      throw new Error("io error");
    });
    const ctrl = createAIChatWizardController({
      accountsStore: broken,
      vendorAdapter: makeFakeAdapter(),
      _deps: makeDeps(),
    });
    const r = await ctrl.cleanupOrphanPartitions({
      partitions: [PARTITION_PREFIX + "doubao"],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ACCOUNTS_LIST_FAILED");
  });
});

// ─── _internal helpers ───────────────────────────────────────────────────

describe("_internal helpers", () => {
  it("_partitionNameFor uses PARTITION_PREFIX", () => {
    expect(_internal._partitionNameFor("deepseek")).toBe(
      PARTITION_PREFIX + "deepseek",
    );
  });
  it("_isAichatPartition recognizes prefix", () => {
    expect(_internal._isAichatPartition(PARTITION_PREFIX + "kimi")).toBe(true);
    expect(_internal._isAichatPartition("persist:unrelated")).toBe(false);
    expect(_internal._isAichatPartition(null)).toBe(false);
  });
  it("_vendorFromPartition strips the prefix", () => {
    expect(_internal._vendorFromPartition(PARTITION_PREFIX + "doubao")).toBe(
      "doubao",
    );
    expect(_internal._vendorFromPartition("foo")).toBeNull();
  });
  it("_flattenJar handles object / array / string / falsy", () => {
    expect(_internal._flattenJar({ a: "1", b: "2", c: 3 })).toEqual({
      a: "1",
      b: "2",
    });
    expect(
      _internal._flattenJar([
        { name: "a", value: "1" },
        { name: "b", value: "2" },
      ]),
    ).toEqual({ a: "1", b: "2" });
    expect(_internal._flattenJar("a=1; b=2")).toEqual({ a: "1", b: "2" });
    expect(_internal._flattenJar(null)).toEqual({});
    expect(_internal._flattenJar(undefined)).toEqual({});
  });
});
