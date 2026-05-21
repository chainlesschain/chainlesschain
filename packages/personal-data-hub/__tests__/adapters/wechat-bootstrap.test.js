/**
 * Phase 12.6.7 — bootstrapWechatAdapter unit tests.
 *
 * Validates the decision matrix that ties env-probe → KeyProvider →
 * WechatAdapter. All exec calls are stubbed via `_probe` injection so
 * tests stay fully hermetic (no adb, no Frida binding, no real device).
 */
"use strict";

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import wechatModule from "../../lib/adapters/wechat/bootstrap.js";
const { bootstrapWechatAdapter } = wechatModule;

function mkProbe(overrides = {}) {
  const base = {
    ok: true,
    suggestedKeyProvider: "md5",
    reasons: ["WeChat 7.0.22 (< 8.0) — legacy MD5(IMEI+UIN) path supported"],
    device: { reachable: true, serial: "SERIAL123", abi: "arm64-v8a" },
    root: { detected: false, magiskInstalled: false },
    frida: { serverRunning: false, port: null },
    wechat: { installed: true, versionName: "7.0.22", majorVersion: 7 },
    warnings: [],
  };
  return { ...base, ...overrides };
}

function mkWechatDataPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-wechat-bootstrap-"));
  return dir;
}

describe("bootstrapWechatAdapter — input validation", () => {
  it("throws when account.uin missing (including bare opts)", async () => {
    await expect(bootstrapWechatAdapter()).rejects.toThrow(/account\.uin/);
    await expect(bootstrapWechatAdapter({})).rejects.toThrow(/account\.uin/);
    await expect(
      bootstrapWechatAdapter({ account: {} }),
    ).rejects.toThrow(/account\.uin/);
  });
});

describe("bootstrapWechatAdapter — md5 path", () => {
  it("returns ok with MD5KeyProvider when probe suggests md5 + wechatDataPath provided", async () => {
    const wechatDataPath = mkWechatDataPath();
    const r = await bootstrapWechatAdapter({
      account: { uin: "1234567890" },
      wechatDataPath,
      _probe: mkProbe(),
    });
    expect(r.ok).toBe(true);
    expect(r.adapter).toBeDefined();
    expect(r.adapter.account.uin).toBe("1234567890");
    expect(r.keyProvider).toBeDefined();
    expect(r.keyProvider.name).toBe("md5");
    expect(r.probe.suggestedKeyProvider).toBe("md5");
  });

  it("returns MD5_NEEDS_WECHAT_DATA_PATH when md5 chosen but wechatDataPath missing", async () => {
    const r = await bootstrapWechatAdapter({
      account: { uin: "1234567890" },
      _probe: mkProbe(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("MD5_NEEDS_WECHAT_DATA_PATH");
    expect(r.probe).toBeDefined();
    expect(r.message).toMatch(/wechatDataPath/);
  });

  it("propagates dbPath to the adapter constructor", async () => {
    const wechatDataPath = mkWechatDataPath();
    const dbPath = path.join(wechatDataPath, "MicroMsg.db");
    fs.writeFileSync(dbPath, "stub", "utf-8");
    const r = await bootstrapWechatAdapter({
      account: { uin: "1234567890" },
      dbPath,
      wechatDataPath,
      _probe: mkProbe(),
    });
    expect(r.ok).toBe(true);
    expect(r.adapter._dbPath).toBe(dbPath);
  });
});

describe("bootstrapWechatAdapter — frida path", () => {
  it("returns ok with FridaKeyProvider when probe suggests frida", async () => {
    const r = await bootstrapWechatAdapter({
      account: { uin: "wxid_abcdef" },
      _probe: mkProbe({
        suggestedKeyProvider: "frida",
        wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
        root: { detected: true, magiskInstalled: true },
        frida: { serverRunning: true, port: 27042 },
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.keyProvider).toBeDefined();
    expect(r.keyProvider.name).toBe("frida");
    expect(r.adapter).toBeDefined();
  });

  it("forwards fridaOpts.deviceId / packageName / timeoutMs", async () => {
    const r = await bootstrapWechatAdapter({
      account: { uin: "wxid_abcdef" },
      fridaOpts: {
        deviceId: "EMULATOR_ID",
        packageName: "com.tencent.mm.beta",
        timeoutMs: 12_345,
      },
      _probe: mkProbe({
        suggestedKeyProvider: "frida",
        wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
        root: { detected: true, magiskInstalled: true },
        frida: { serverRunning: true, port: 27042 },
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.keyProvider._deviceId).toBe("EMULATOR_ID");
    expect(r.keyProvider._packageName).toBe("com.tencent.mm.beta");
    expect(r.keyProvider._timeoutMs).toBe(12_345);
  });

  it("falls back to probe.device.serial when fridaOpts.deviceId not provided", async () => {
    const r = await bootstrapWechatAdapter({
      account: { uin: "wxid_abcdef" },
      _probe: mkProbe({
        suggestedKeyProvider: "frida",
        device: { reachable: true, serial: "FROM_PROBE", abi: "arm64-v8a" },
        wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
        root: { detected: true, magiskInstalled: true },
        frida: { serverRunning: true, port: 27042 },
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.keyProvider._deviceId).toBe("FROM_PROBE");
  });
});

describe("bootstrapWechatAdapter — unsupported / unknown", () => {
  it("returns ENV_UNSUPPORTED with probe reasons when nothing viable", async () => {
    const r = await bootstrapWechatAdapter({
      account: { uin: "1234567890" },
      _probe: mkProbe({
        ok: false,
        suggestedKeyProvider: "unsupported",
        reasons: ["WeChat 8.0.50 requires root for SQLCipher key extraction"],
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ENV_UNSUPPORTED");
    expect(r.message).toMatch(/root/);
    expect(r.probe).toBeDefined();
  });

  it("returns UNKNOWN_KEY_PROVIDER when override is not md5/frida", async () => {
    const r = await bootstrapWechatAdapter({
      account: { uin: "1234567890" },
      keyProviderOverride: "magic-pony",
      _probe: mkProbe(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_KEY_PROVIDER");
  });
});

describe("bootstrapWechatAdapter — override", () => {
  it("keyProviderOverride='frida' picks frida even when probe suggests md5", async () => {
    const r = await bootstrapWechatAdapter({
      account: { uin: "wxid_force" },
      keyProviderOverride: "frida",
      _probe: mkProbe(), // suggests "md5"
    });
    expect(r.ok).toBe(true);
    expect(r.keyProvider.name).toBe("frida");
    expect(r.probe.suggestedKeyProvider).toBe("md5"); // probe transparent
  });

  it("keyProviderOverride='md5' picks md5 even when probe suggests frida", async () => {
    const wechatDataPath = mkWechatDataPath();
    const r = await bootstrapWechatAdapter({
      account: { uin: "1234567890" },
      wechatDataPath,
      keyProviderOverride: "md5",
      _probe: mkProbe({
        suggestedKeyProvider: "frida",
        wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
        root: { detected: true, magiskInstalled: true },
        frida: { serverRunning: true, port: 27042 },
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.keyProvider.name).toBe("md5");
  });
});

describe("bootstrapWechatAdapter — adapter ctor errors", () => {
  it("returns ADAPTER_CTOR_FAILED when WechatAdapter throws", async () => {
    const wechatDataPath = mkWechatDataPath();
    function Boom() {
      throw new Error("ctor boom");
    }
    const r = await bootstrapWechatAdapter({
      account: { uin: "1234567890" },
      wechatDataPath,
      _probe: mkProbe(),
      _WechatAdapter: Boom,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ADAPTER_CTOR_FAILED");
    expect(r.message).toBe("ctor boom");
  });
});

describe("bootstrapWechatAdapter — test seams", () => {
  it("uses injected _md5Provider verbatim", async () => {
    const stubProvider = { name: "md5", getKey: async () => "deadbeef" };
    const r = await bootstrapWechatAdapter({
      account: { uin: "1234567890" },
      _probe: mkProbe(),
      _md5Provider: stubProvider,
    });
    expect(r.ok).toBe(true);
    expect(r.keyProvider).toBe(stubProvider);
  });

  it("uses injected _fridaProvider verbatim", async () => {
    const stubProvider = { name: "frida", getKey: async () => "feedface".repeat(8) };
    const r = await bootstrapWechatAdapter({
      account: { uin: "wxid_abc" },
      keyProviderOverride: "frida",
      _probe: mkProbe(),
      _fridaProvider: stubProvider,
    });
    expect(r.ok).toBe(true);
    expect(r.keyProvider).toBe(stubProvider);
  });
});
