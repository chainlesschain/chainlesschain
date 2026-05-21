/**
 * WeChat Phase 12.6.7-10 end-to-end integration test.
 *
 * Exercises the full chain WITHOUT any real adb / Frida / device:
 *
 *   env-probe (injected facts)
 *      ↓
 *   bootstrap.js (KeyProvider choice + adapter ctor)
 *      ↓
 *   AdapterRegistry (real, in-memory)
 *      ↓
 *   wechat-accounts.json persistence (real fs, temp dir)
 *      ↓
 *   list / unregister flow
 *
 * Three scenarios:
 *   A. md5 happy path — pre-WeChat-8 device:
 *        probe="md5" → wechatDataPath provided → register OK →
 *        registry has "wechat" adapter → persisted row chosenKeyProvider="md5"
 *        → unregister → row removed + registry empty
 *   B. frida happy path — rooted 8.0+ device:
 *        probe="frida" + root + frida-server up → register OK →
 *        chosenKeyProvider="frida" → persisted row reflects choice
 *   C. unsupported path — 8.0+ without root:
 *        probe="unsupported" → bootstrap rejects → no registry change,
 *        no row written, ok:false with reasons surfaced
 *   D. idempotent re-register — same uin twice:
 *        first registration with wechatDataPath A, second with B →
 *        single row remains, wechatDataPath=B (replaces, doesn't dupe)
 */

"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  bootstrapWechatAdapter,
} = require("../../lib/adapters/wechat/bootstrap");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");
const { InMemoryKeyProvider } = require("../../lib/key-providers");
const { generateKeyHex } = require("../../lib/key-providers");

// Mirror of the hub-side store helpers so the integration test exercises
// the same persistence shape both desktop + cli wirings use.
const { readFileSync, writeFileSync, existsSync } = require("node:fs");
function loadWechatAccounts(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}
function saveWechatAccounts(filePath, accounts) {
  writeFileSync(filePath, JSON.stringify(accounts, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

function mkProbe(overrides = {}) {
  return {
    ok: true,
    suggestedKeyProvider: "md5",
    reasons: ["WeChat 7.0.22 (< 8.0) — legacy MD5(IMEI+UIN) path supported"],
    device: { reachable: true, serial: "INTEG_TEST", abi: "arm64-v8a" },
    root: { detected: false, magiskInstalled: false },
    frida: { serverRunning: false, port: null },
    wechat: { installed: true, versionName: "7.0.22", majorVersion: 7 },
    warnings: [],
    ...overrides,
  };
}

// Replay the wiring's registerWechatAdapter() inline — mirroring the
// closure on the real hub object — so the integration test exercises
// the exact code path the IPC/WS layer drives in production.
async function registerWechatViaHub({ registry, hubDir, opts }) {
  const r = await bootstrapWechatAdapter(opts);
  if (!r.ok) return r;

  if (registry.has(r.adapter.name)) registry.unregister(r.adapter.name);
  registry.register(r.adapter);

  const accountsPath = join(hubDir, "wechat-accounts.json");
  const accounts = loadWechatAccounts(accountsPath);
  const next = accounts.filter(
    (c) => !(c.account && c.account.uin === opts.account.uin),
  );
  next.push({
    account: { uin: opts.account.uin },
    dbPath: opts.dbPath || null,
    wechatDataPath: opts.wechatDataPath || null,
    chosenKeyProvider: r.keyProvider && r.keyProvider.name,
    registeredAt: Date.now(),
    lastSyncAt: null,
  });
  saveWechatAccounts(accountsPath, next);

  return {
    ok: true,
    name: r.adapter.name,
    chosenKeyProvider: r.keyProvider.name,
    probe: r.probe,
  };
}

async function unregisterWechatViaHub({ registry, hubDir, uin }) {
  const accountsPath = join(hubDir, "wechat-accounts.json");
  const accounts = loadWechatAccounts(accountsPath);
  const target = accounts.find((c) => c.account && c.account.uin === uin);
  const next = accounts.filter(
    (c) => !(c.account && c.account.uin === uin),
  );
  saveWechatAccounts(accountsPath, next);
  if (target && registry.has("wechat")) registry.unregister("wechat");
  return { ok: true, removed: !!target, uin };
}

function listWechatViaHub({ hubDir }) {
  return loadWechatAccounts(join(hubDir, "wechat-accounts.json")).map((row) => ({
    uin: row.account ? row.account.uin : null,
    dbPath: row.dbPath || null,
    hasWechatDataPath: !!row.wechatDataPath,
    chosenKeyProvider: row.chosenKeyProvider || null,
    registeredAt: row.registeredAt || null,
  }));
}

describe("WeChat Phase 12.6.7-10 — end-to-end integration", () => {
  let hubDir;
  let dataDir;
  let registry;

  beforeEach(() => {
    hubDir = mkdtempSync(join(tmpdir(), "pdh-wechat-integ-"));
    dataDir = mkdtempSync(join(tmpdir(), "pdh-wechat-data-"));

    // A real registry without vault/sinks — we don't sync, just
    // register/unregister. Phase 12.6.7 boundary: bootstrap doesn't
    // touch the registry, the wiring does (replicated above).
    const vault = new LocalVault({
      path: join(hubDir, "vault.db"),
      key: generateKeyHex(),
    });
    vault.open();
    registry = new AdapterRegistry({ vault });
  });

  afterEach(() => {
    try { rmSync(hubDir, { recursive: true, force: true }); } catch (_e) {}
    try { rmSync(dataDir, { recursive: true, force: true }); } catch (_e) {}
  });

  describe("A. md5 happy path — pre-WeChat-8 device", () => {
    it("probe → register → adapter in registry + row persisted with md5 provider", async () => {
      const r = await registerWechatViaHub({
        registry,
        hubDir,
        opts: {
          account: { uin: "1234567890" },
          wechatDataPath: dataDir,
          _probe: mkProbe(),
        },
      });

      // Bootstrap chain succeeded
      expect(r.ok).toBe(true);
      expect(r.chosenKeyProvider).toBe("md5");
      expect(r.name).toBe("wechat");
      expect(r.probe.suggestedKeyProvider).toBe("md5");

      // Registry picked up the adapter
      expect(registry.has("wechat")).toBe(true);
      const adapter = registry.get("wechat");
      expect(adapter.account.uin).toBe("1234567890");

      // Persistence reflects choice
      const list = listWechatViaHub({ hubDir });
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        uin: "1234567890",
        chosenKeyProvider: "md5",
        hasWechatDataPath: true,
      });
    });

    it("unregister removes row + drops registry entry", async () => {
      await registerWechatViaHub({
        registry,
        hubDir,
        opts: {
          account: { uin: "1234567890" },
          wechatDataPath: dataDir,
          _probe: mkProbe(),
        },
      });
      expect(registry.has("wechat")).toBe(true);

      const ur = await unregisterWechatViaHub({
        registry,
        hubDir,
        uin: "1234567890",
      });
      expect(ur).toMatchObject({ ok: true, removed: true });
      expect(registry.has("wechat")).toBe(false);
      expect(listWechatViaHub({ hubDir })).toEqual([]);
    });
  });

  describe("B. frida happy path — rooted 8.0+ device", () => {
    it("probe='frida' + root yields FridaKeyProvider in persisted row", async () => {
      const r = await registerWechatViaHub({
        registry,
        hubDir,
        opts: {
          account: { uin: "wxid_alice" },
          _probe: mkProbe({
            suggestedKeyProvider: "frida",
            wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
            root: { detected: true, magiskInstalled: true },
            frida: { serverRunning: true, port: 27042 },
            reasons: ["WeChat 8.0.50 — Frida hook on libwcdb.so"],
          }),
        },
      });
      expect(r.ok).toBe(true);
      expect(r.chosenKeyProvider).toBe("frida");
      expect(registry.has("wechat")).toBe(true);

      const list = listWechatViaHub({ hubDir });
      expect(list[0].chosenKeyProvider).toBe("frida");
      // Frida path doesn't require wechatDataPath
      expect(list[0].hasWechatDataPath).toBe(false);
    });
  });

  describe("C. unsupported path", () => {
    it("8.0+ without root → no registry change, no row, ok:false with reasons", async () => {
      const r = await registerWechatViaHub({
        registry,
        hubDir,
        opts: {
          account: { uin: "wxid_bob" },
          _probe: mkProbe({
            ok: false,
            suggestedKeyProvider: "unsupported",
            reasons: [
              "WeChat 8.0.50 requires root for SQLCipher key extraction",
            ],
            wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
            root: { detected: false, magiskInstalled: false },
          }),
        },
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("ENV_UNSUPPORTED");
      expect(r.probe.reasons.join(" ")).toMatch(/requires root/);

      expect(registry.has("wechat")).toBe(false);
      expect(listWechatViaHub({ hubDir })).toEqual([]);
    });

    it("md5 path missing wechatDataPath → ok:false MD5_NEEDS_WECHAT_DATA_PATH", async () => {
      const r = await registerWechatViaHub({
        registry,
        hubDir,
        opts: {
          account: { uin: "1234567890" },
          _probe: mkProbe(),
          // wechatDataPath intentionally omitted
        },
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("MD5_NEEDS_WECHAT_DATA_PATH");
      expect(registry.has("wechat")).toBe(false);
    });
  });

  describe("D. idempotent re-register", () => {
    it("same uin twice → single row, latest wechatDataPath wins", async () => {
      const dataA = mkdtempSync(join(tmpdir(), "pdh-wechat-dataA-"));
      const dataB = mkdtempSync(join(tmpdir(), "pdh-wechat-dataB-"));
      try {
        await registerWechatViaHub({
          registry,
          hubDir,
          opts: {
            account: { uin: "1234567890" },
            wechatDataPath: dataA,
            _probe: mkProbe(),
          },
        });
        await registerWechatViaHub({
          registry,
          hubDir,
          opts: {
            account: { uin: "1234567890" },
            wechatDataPath: dataB,
            _probe: mkProbe(),
          },
        });

        const list = listWechatViaHub({ hubDir });
        expect(list).toHaveLength(1);
        expect(list[0].uin).toBe("1234567890");
        expect(registry.has("wechat")).toBe(true);

        // Adapter's _dbPath is null in both calls (we didn't pass dbPath),
        // but the persisted row uses the latest wechatDataPath.
        const raw = readFileSync(
          join(hubDir, "wechat-accounts.json"),
          "utf-8",
        );
        const persisted = JSON.parse(raw);
        expect(persisted[0].wechatDataPath).toBe(dataB);
      } finally {
        try { rmSync(dataA, { recursive: true, force: true }); } catch (_e) {}
        try { rmSync(dataB, { recursive: true, force: true }); } catch (_e) {}
      }
    });

    it("two distinct uins coexist as separate rows", async () => {
      await registerWechatViaHub({
        registry,
        hubDir,
        opts: { account: { uin: "alice" }, wechatDataPath: dataDir, _probe: mkProbe() },
      });
      await registerWechatViaHub({
        registry,
        hubDir,
        opts: { account: { uin: "bob" }, wechatDataPath: dataDir, _probe: mkProbe() },
      });

      const list = listWechatViaHub({ hubDir });
      expect(list.map((r) => r.uin).sort()).toEqual(["alice", "bob"]);
      // Single registry slot named "wechat" — second register replaces first
      // adapter instance, but registry still has exactly one entry. This is
      // the v0.5 limit: the registry namespaces by adapter.name not by uin.
      // The persisted accounts file is the source of truth for "which uins
      // can sync"; bootstrap re-runs at sync time per account.
      expect(registry.has("wechat")).toBe(true);
    });
  });

  describe("override semantics (Phase 12.6.7 §18.10)", () => {
    it("keyProviderOverride='frida' wins over probe='md5'", async () => {
      const r = await registerWechatViaHub({
        registry,
        hubDir,
        opts: {
          account: { uin: "wxid_force" },
          keyProviderOverride: "frida",
          _probe: mkProbe(), // suggests md5
        },
      });
      expect(r.ok).toBe(true);
      expect(r.chosenKeyProvider).toBe("frida");
      // Probe transparency: original suggestion still surfaces unchanged
      expect(r.probe.suggestedKeyProvider).toBe("md5");
    });

    it("keyProviderOverride='md5' wins over probe='frida'", async () => {
      const r = await registerWechatViaHub({
        registry,
        hubDir,
        opts: {
          account: { uin: "1234567890" },
          wechatDataPath: dataDir,
          keyProviderOverride: "md5",
          _probe: mkProbe({
            suggestedKeyProvider: "frida",
            wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
            root: { detected: true, magiskInstalled: true },
            frida: { serverRunning: true, port: 27042 },
          }),
        },
      });
      expect(r.ok).toBe(true);
      expect(r.chosenKeyProvider).toBe("md5");
      expect(r.probe.suggestedKeyProvider).toBe("frida");
    });
  });
});
