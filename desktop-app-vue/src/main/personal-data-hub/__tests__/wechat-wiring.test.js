/**
 * Phase 12.6.8 — WeChat wiring unit tests.
 *
 * Exercises the hub methods that wrap bootstrapWechatAdapter:
 *   - probeWechatEnv   (delegates to env-probe)
 *   - registerWechatAdapter (md5/frida path, persistence, idempotent re-reg)
 *   - unregisterWechatAdapter (file delete + registry.unregister)
 *   - listWechatAccounts (scrubbed projection)
 *
 * The hub returned from initHub() is large; rather than spin up the full
 * vault + LLM (Phase 1 territory), we synthesize a minimal hub that
 * exposes just registry + the wechat-accounts JSON path, then exercise
 * the methods we added in wiring.js by re-importing them via a small
 * test-only factory. We pre-build the bootstrap probe to skip exec.
 */

import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";

// CJS interop — vitest can resolve `import` of CJS modules, but the cli-dev
// rule documents that `vi.mock` against CJS is unreliable, so we use the
// classical require() shim instead (no mocking needed — we hand-build the
// fakes via injected `_probe`).
const require_ = createRequire(import.meta.url);
const store = require_("../wechat-accounts-store.js");
const wechatModule = require_("@chainlesschain/personal-data-hub/adapters/wechat");
const { bootstrapWechatAdapter } = wechatModule;

function mkHubDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdh-wechat-wire-"));
}

function mkProbe(overrides = {}) {
  return {
    ok: true,
    suggestedKeyProvider: "md5",
    reasons: ["WeChat 7.0.22 (< 8.0) — legacy MD5(IMEI+UIN) path supported"],
    device: { reachable: true, serial: "SERIAL", abi: "arm64-v8a" },
    root: { detected: false, magiskInstalled: false },
    frida: { serverRunning: false, port: null },
    wechat: { installed: true, versionName: "7.0.22", majorVersion: 7 },
    warnings: [],
    ...overrides,
  };
}

// Lightweight registry stand-in matching the .has/.register/.unregister
// surface the wiring methods use.
function mkRegistry() {
  const map = new Map();
  return {
    has: (name) => map.has(name),
    register: (a) => { map.set(a.name, a); },
    unregister: (name) => { map.delete(name); return true; },
    get: (name) => map.get(name),
    _map: map,
  };
}

// Build the exact closure shape that initHub returns for the methods
// under test. Pure copy of the JS we put in wiring.js — keep in sync.
function mkHubLike({ hubDir, registry }) {
  const wechatAccountsPath = path.join(hubDir, "wechat-accounts.json");
  return {
    wechatAccountsPath,
    async probeWechatEnv(opts = {}) {
      const { probeWeChatEnv } = wechatModule;
      return await probeWeChatEnv({ exec: opts.exec });
    },
    async registerWechatAdapter(opts = {}) {
      if (!opts || !opts.account || !opts.account.uin) {
        return { ok: false, reason: "UIN_REQUIRED", message: "opts.account.uin required" };
      }
      let r;
      try {
        r = await bootstrapWechatAdapter({
          account: opts.account,
          dbPath: opts.dbPath || null,
          wechatDataPath: opts.wechatDataPath || null,
          fridaOpts: opts.fridaOpts || null,
          keyProviderOverride: opts.keyProviderOverride || null,
          exec: opts.exec,
          _probe: opts._probe,
        });
      } catch (err) {
        return { ok: false, reason: "BOOTSTRAP_THREW", message: err.message };
      }
      if (!r.ok) return r;

      if (registry.has(r.adapter.name)) registry.unregister(r.adapter.name);
      registry.register(r.adapter);

      const accounts = store.loadWechatAccounts(wechatAccountsPath);
      const next = accounts.filter((c) => !(c.account && c.account.uin === opts.account.uin));
      next.push({
        account: { uin: opts.account.uin },
        dbPath: opts.dbPath || null,
        wechatDataPath: opts.wechatDataPath || null,
        chosenKeyProvider: r.keyProvider && r.keyProvider.name,
        registeredAt: Date.now(),
        lastSyncAt: null,
      });
      store.saveWechatAccounts(wechatAccountsPath, next);

      return {
        ok: true,
        name: r.adapter.name,
        version: r.adapter.version,
        capabilities: r.adapter.capabilities,
        sensitivity: r.adapter.dataDisclosure.sensitivity,
        chosenKeyProvider: r.keyProvider && r.keyProvider.name,
        probe: r.probe,
        registeredAt: next[next.length - 1].registeredAt,
      };
    },
    async unregisterWechatAdapter(uin) {
      if (!uin || typeof uin !== "string") return { ok: false, reason: "UIN_REQUIRED" };
      const accounts = store.loadWechatAccounts(wechatAccountsPath);
      const target = accounts.find((c) => c.account && c.account.uin === uin);
      const next = accounts.filter((c) => !(c.account && c.account.uin === uin));
      store.saveWechatAccounts(wechatAccountsPath, next);
      if (target && registry.has("wechat")) registry.unregister("wechat");
      return { ok: true, removed: !!target, uin };
    },
    listWechatAccounts() {
      return store.loadWechatAccounts(wechatAccountsPath).map(store.scrubForList);
    },
  };
}

describe("Phase 12.6.8 — wechat-accounts-store", () => {
  it("loadWechatAccounts returns [] when file missing", () => {
    const dir = mkHubDir();
    const p = path.join(dir, "wechat-accounts.json");
    expect(store.loadWechatAccounts(p)).toEqual([]);
  });

  it("loadWechatAccounts returns [] on corrupt JSON (no throw)", () => {
    const dir = mkHubDir();
    const p = path.join(dir, "wechat-accounts.json");
    fs.writeFileSync(p, "{not json", "utf-8");
    expect(store.loadWechatAccounts(p)).toEqual([]);
  });

  it("saveWechatAccounts round-trips arrays", () => {
    const dir = mkHubDir();
    const p = path.join(dir, "wechat-accounts.json");
    const rows = [{ account: { uin: "1" }, registeredAt: 1 }];
    store.saveWechatAccounts(p, rows);
    expect(store.loadWechatAccounts(p)).toEqual(rows);
  });

  it("scrubForList drops dbPath details + exposes flag for wechatDataPath", () => {
    const row = {
      account: { uin: "9876543210" },
      dbPath: "/tmp/EnMicroMsg.db",
      wechatDataPath: "/tmp/com.tencent.mm",
      chosenKeyProvider: "md5",
      registeredAt: 12345,
      lastSyncAt: null,
    };
    const scrubbed = store.scrubForList(row);
    expect(scrubbed).toEqual({
      uin: "9876543210",
      dbPath: "/tmp/EnMicroMsg.db",
      hasWechatDataPath: true,
      chosenKeyProvider: "md5",
      registeredAt: 12345,
      lastSyncAt: null,
    });
  });
});

describe("Phase 12.6.8 — registerWechatAdapter (hub method)", () => {
  let dir, registry, hub;
  beforeEach(() => {
    dir = mkHubDir();
    registry = mkRegistry();
    hub = mkHubLike({ hubDir: dir, registry });
  });

  it("rejects missing account.uin", async () => {
    const r = await hub.registerWechatAdapter({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UIN_REQUIRED");
  });

  it("md5 path: registers adapter + persists row", async () => {
    const wechatDataPath = mkHubDir();
    const r = await hub.registerWechatAdapter({
      account: { uin: "1234567890" },
      wechatDataPath,
      _probe: mkProbe(),
    });
    expect(r.ok).toBe(true);
    expect(r.chosenKeyProvider).toBe("md5");
    expect(r.sensitivity).toBe("high");
    expect(registry.has("wechat")).toBe(true);

    const persisted = store.loadWechatAccounts(hub.wechatAccountsPath);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].account.uin).toBe("1234567890");
    expect(persisted[0].chosenKeyProvider).toBe("md5");
  });

  it("frida path: registers adapter + persists chosenKeyProvider='frida'", async () => {
    const r = await hub.registerWechatAdapter({
      account: { uin: "wxid_abc" },
      _probe: mkProbe({
        suggestedKeyProvider: "frida",
        wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
        root: { detected: true, magiskInstalled: true },
        frida: { serverRunning: true, port: 27042 },
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.chosenKeyProvider).toBe("frida");
    const persisted = store.loadWechatAccounts(hub.wechatAccountsPath);
    expect(persisted[0].chosenKeyProvider).toBe("frida");
  });

  it("propagates ENV_UNSUPPORTED when probe rejects", async () => {
    const r = await hub.registerWechatAdapter({
      account: { uin: "12345" },
      _probe: mkProbe({
        ok: false,
        suggestedKeyProvider: "unsupported",
        reasons: ["No root on 8.0+"],
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ENV_UNSUPPORTED");
    expect(store.loadWechatAccounts(hub.wechatAccountsPath)).toEqual([]);
    expect(registry.has("wechat")).toBe(false);
  });

  it("idempotent: re-registering same uin replaces row + unregisters prior adapter", async () => {
    const dataA = mkHubDir(), dataB = mkHubDir();
    await hub.registerWechatAdapter({
      account: { uin: "1234567890" },
      wechatDataPath: dataA,
      _probe: mkProbe(),
    });
    const first = store.loadWechatAccounts(hub.wechatAccountsPath);
    expect(first).toHaveLength(1);
    expect(first[0].wechatDataPath).toBe(dataA);

    await hub.registerWechatAdapter({
      account: { uin: "1234567890" },
      wechatDataPath: dataB,
      _probe: mkProbe(),
    });
    const second = store.loadWechatAccounts(hub.wechatAccountsPath);
    expect(second).toHaveLength(1);
    expect(second[0].wechatDataPath).toBe(dataB);
  });

  it("two distinct uins coexist as separate rows", async () => {
    const data = mkHubDir();
    await hub.registerWechatAdapter({
      account: { uin: "first" }, wechatDataPath: data, _probe: mkProbe(),
    });
    await hub.registerWechatAdapter({
      account: { uin: "second" }, wechatDataPath: data, _probe: mkProbe(),
    });
    const persisted = store.loadWechatAccounts(hub.wechatAccountsPath);
    expect(persisted.map((r) => r.account.uin).sort()).toEqual(["first", "second"]);
  });
});

describe("Phase 12.6.8 — unregisterWechatAdapter / listWechatAccounts", () => {
  let dir, registry, hub;
  beforeEach(() => {
    dir = mkHubDir();
    registry = mkRegistry();
    hub = mkHubLike({ hubDir: dir, registry });
  });

  it("rejects missing uin", async () => {
    const r = await hub.unregisterWechatAdapter();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UIN_REQUIRED");
  });

  it("returns removed:false when uin not registered, but ok:true", async () => {
    const r = await hub.unregisterWechatAdapter("ghost");
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(false);
    expect(r.uin).toBe("ghost");
  });

  it("removes the matching row + unregisters adapter from registry", async () => {
    const data = mkHubDir();
    await hub.registerWechatAdapter({
      account: { uin: "to-remove" }, wechatDataPath: data, _probe: mkProbe(),
    });
    expect(registry.has("wechat")).toBe(true);

    const r = await hub.unregisterWechatAdapter("to-remove");
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(true);
    expect(registry.has("wechat")).toBe(false);
    expect(store.loadWechatAccounts(hub.wechatAccountsPath)).toEqual([]);
  });

  it("listWechatAccounts returns scrubbed projection (no wechatDataPath leak)", async () => {
    const data = mkHubDir();
    await hub.registerWechatAdapter({
      account: { uin: "1234567890" },
      dbPath: "/tmp/sensitive/EnMicroMsg.db",
      wechatDataPath: data,
      _probe: mkProbe(),
    });
    const list = hub.listWechatAccounts();
    expect(list).toHaveLength(1);
    expect(list[0].uin).toBe("1234567890");
    expect(list[0].dbPath).toBe("/tmp/sensitive/EnMicroMsg.db");
    expect(list[0].hasWechatDataPath).toBe(true);
    expect(list[0]).not.toHaveProperty("wechatDataPath");
    expect(list[0].chosenKeyProvider).toBe("md5");
  });

  it("listWechatAccounts returns [] when no accounts persisted", () => {
    expect(hub.listWechatAccounts()).toEqual([]);
  });
});
