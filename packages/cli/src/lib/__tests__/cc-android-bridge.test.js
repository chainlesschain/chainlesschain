"use strict";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import bridgeDefault, {
  invoke,
  caps,
  AndroidBridgeUnavailableError,
  detectAndroid,
  loadBridgeConfig,
  _deps,
} from "../cc-android-bridge.js";

// ─── env restore helpers ──────────────────────────────────────────────

const ENV_KEYS = [
  "CC_ANDROID_BRIDGE_OVERRIDE",
  "CC_ANDROID_BRIDGE_CONFIG_DIR",
  "PREFIX",
];
let envSnapshot;
let depsSnapshot;

beforeEach(() => {
  envSnapshot = {};
  for (const k of ENV_KEYS) envSnapshot[k] = process.env[k];
  depsSnapshot = {
    detectAndroid: _deps.detectAndroid,
    loadBridgeConfig: _deps.loadBridgeConfig,
    fetch: _deps.fetch,
    testInvoke: _deps.testInvoke,
  };
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
  _deps.detectAndroid = depsSnapshot.detectAndroid;
  _deps.loadBridgeConfig = depsSnapshot.loadBridgeConfig;
  _deps.fetch = depsSnapshot.fetch;
  _deps.testInvoke = depsSnapshot.testInvoke;
});

// ─── detectAndroid ────────────────────────────────────────────────────

describe("detectAndroid", () => {
  it("returns false on non-Android host", () => {
    delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    delete process.env.PREFIX;
    // platform = "win32" / "linux" / "darwin" — none is "android"
    expect(detectAndroid()).toBe(false);
  });

  it("returns true under CC_ANDROID_BRIDGE_OVERRIDE=1", () => {
    process.env.CC_ANDROID_BRIDGE_OVERRIDE = "1";
    expect(detectAndroid()).toBe(true);
  });

  it("returns true when PREFIX matches Termux Android prefix", () => {
    delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    process.env.PREFIX = "/data/data/com.chainlesschain.android/files/usr";
    expect(detectAndroid()).toBe(true);
  });
});

// ─── loadBridgeConfig ─────────────────────────────────────────────────

describe("loadBridgeConfig", () => {
  it("returns null off-device with no PREFIX + no override dir", () => {
    delete process.env.CC_ANDROID_BRIDGE_CONFIG_DIR;
    delete process.env.PREFIX;
    expect(loadBridgeConfig()).toBeNull();
  });

  it("returns parsed config from CC_ANDROID_BRIDGE_CONFIG_DIR", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = mkdtempSync(join(tmpdir(), "cc-bridge-cfg-"));
    writeFileSync(join(dir, "port"), "12345\n", "utf-8");
    writeFileSync(join(dir, "token"), "deadbeef\n", "utf-8");
    process.env.CC_ANDROID_BRIDGE_CONFIG_DIR = dir;

    const cfg = loadBridgeConfig();
    expect(cfg).toEqual({
      port: 12345,
      token: "deadbeef",
      baseUrl: "http://127.0.0.1:12345",
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when port file missing", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "cc-bridge-cfg-"));
    writeFileSync(join(dir, "token"), "x", "utf-8");
    process.env.CC_ANDROID_BRIDGE_CONFIG_DIR = dir;
    expect(loadBridgeConfig()).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── invoke ───────────────────────────────────────────────────────────

describe("invoke — error paths", () => {
  it("throws TypeError on empty method", async () => {
    await expect(invoke("")).rejects.toThrow(TypeError);
  });

  it("rejects ANDROID_BRIDGE_NOT_AVAILABLE off-device", async () => {
    delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    _deps.detectAndroid = () => false;
    await expect(invoke("contacts.query")).rejects.toBeInstanceOf(
      AndroidBridgeUnavailableError,
    );
  });

  it("rejects when bridge config missing on-device", async () => {
    delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => null;
    await expect(invoke("contacts.query")).rejects.toMatchObject({
      code: "ANDROID_BRIDGE_NOT_AVAILABLE",
      reason: expect.stringContaining("bridge config missing"),
    });
  });

  it("rejects on fetch network error", async () => {
    delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => ({
      port: 8237,
      token: "x",
      baseUrl: "http://127.0.0.1:8237",
    });
    _deps.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(invoke("contacts.query")).rejects.toMatchObject({
      code: "ANDROID_BRIDGE_NOT_AVAILABLE",
      reason: expect.stringContaining("ECONNREFUSED"),
    });
  });

  it("rejects on non-2xx response", async () => {
    delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => ({
      port: 8237,
      token: "x",
      baseUrl: "http://127.0.0.1:8237",
    });
    _deps.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "",
    }));
    await expect(invoke("contacts.query")).rejects.toMatchObject({
      reason: expect.stringContaining("HTTP 401"),
    });
  });
});

describe("invoke — happy path", () => {
  it("POSTs /invoke with Bearer token + JSON body, returns parsed JSON", async () => {
    delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => ({
      port: 8237,
      token: "secret-token",
      baseUrl: "http://127.0.0.1:8237",
    });
    const fetchSpy = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ contacts: [{ name: "Alice" }] }),
    }));
    _deps.fetch = fetchSpy;

    const result = await invoke("contacts.query", { since: 0 });
    expect(result).toEqual({ contacts: [{ name: "Alice" }] });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8237/invoke?method=contacts.query");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer secret-token");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ since: 0 });
  });

  it("uses testInvoke when CC_ANDROID_BRIDGE_OVERRIDE=1", async () => {
    process.env.CC_ANDROID_BRIDGE_OVERRIDE = "1";
    _deps.testInvoke = vi.fn(async (m, p) => ({ echo: m, ...p }));
    const result = await invoke("foo.bar", { x: 1 });
    expect(result).toEqual({ echo: "foo.bar", x: 1 });
  });
});

// ─── caps ─────────────────────────────────────────────────────────────

describe("caps", () => {
  it("returns available=false off-device", () => {
    delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    _deps.detectAndroid = () => false;
    const r = caps();
    expect(r.available).toBe(false);
    expect(r.reason).toContain("not-on-android");
  });

  it("returns available=false when bridge server not started", () => {
    delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => null;
    const r = caps();
    expect(r.available).toBe(false);
    expect(r.reason).toContain("bridge-server-not-started");
  });

  it("returns available=true with port when bridge is up", () => {
    delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => ({ port: 8237, token: "x" });
    const r = caps();
    expect(r.available).toBe(true);
    expect(r.port).toBe(8237);
  });
});

// ─── default export ───────────────────────────────────────────────────

describe("default export", () => {
  it("exposes invoke / caps / Error class / _deps", () => {
    expect(bridgeDefault.invoke).toBe(invoke);
    expect(bridgeDefault.caps).toBe(caps);
    expect(bridgeDefault.AndroidBridgeUnavailableError).toBe(
      AndroidBridgeUnavailableError,
    );
    expect(bridgeDefault._deps).toBe(_deps);
  });
});
