import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectAndroid,
  loadBridgeConfig,
  AndroidBridgeUnavailableError,
  invoke,
  caps,
  _deps,
} from "../../src/lib/cc-android-bridge.js";

const ORIG_DEPS = { ..._deps };
const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const ENV_KEYS = [
  "CC_ANDROID_BRIDGE_OVERRIDE",
  "CC_ANDROID_BRIDGE_CONFIG_DIR",
  "PREFIX",
];
const envSnap = {};

function setPlatform(p) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    envSnap[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  Object.assign(_deps, ORIG_DEPS);
  Object.defineProperty(process, "platform", origPlatform);
  for (const k of ENV_KEYS) {
    if (envSnap[k] === undefined) delete process.env[k];
    else process.env[k] = envSnap[k];
  }
});

describe("cc-android-bridge — detectAndroid", () => {
  it("is true with the test override env", () => {
    process.env.CC_ANDROID_BRIDGE_OVERRIDE = "1";
    expect(detectAndroid()).toBe(true);
  });

  it("is true when process.platform is android", () => {
    setPlatform("android");
    expect(detectAndroid()).toBe(true);
  });

  it("is true when PREFIX is the app's Termux prefix", () => {
    setPlatform("linux");
    process.env.PREFIX = "/data/data/com.chainlesschain.android/files/usr";
    expect(detectAndroid()).toBe(true);
  });

  it("is false otherwise", () => {
    setPlatform("linux");
    expect(detectAndroid()).toBe(false);
  });
});

describe("cc-android-bridge — loadBridgeConfig", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-bridge-"));
    process.env.CC_ANDROID_BRIDGE_CONFIG_DIR = dir;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (port, token) => {
    if (port != null) writeFileSync(join(dir, "port"), port, "utf-8");
    if (token != null) writeFileSync(join(dir, "token"), token, "utf-8");
  };

  it("reads port + token and builds the loopback baseUrl", () => {
    write("8237\n", "  deadbeefcafe  ");
    expect(loadBridgeConfig()).toEqual({
      port: 8237,
      token: "deadbeefcafe",
      baseUrl: "http://127.0.0.1:8237",
    });
  });

  it("returns null when the token file is missing", () => {
    write("8237", null);
    expect(loadBridgeConfig()).toBeNull();
  });

  it("returns null for a non-positive or non-numeric port", () => {
    write("0", "tok");
    expect(loadBridgeConfig()).toBeNull();
    write("not-a-number", "tok");
    expect(loadBridgeConfig()).toBeNull();
  });

  it("returns null for an empty token", () => {
    write("8237", "   ");
    expect(loadBridgeConfig()).toBeNull();
  });

  it("returns null when no config dir can be resolved", () => {
    delete process.env.CC_ANDROID_BRIDGE_CONFIG_DIR;
    setPlatform("linux");
    expect(loadBridgeConfig()).toBeNull();
  });
});

describe("cc-android-bridge — AndroidBridgeUnavailableError", () => {
  it("carries the code + reason", () => {
    const e = new AndroidBridgeUnavailableError("nope");
    expect(e.code).toBe("ANDROID_BRIDGE_NOT_AVAILABLE");
    expect(e.reason).toBe("nope");
    expect(e.message).toMatch(/ANDROID_BRIDGE_NOT_AVAILABLE: nope/);
  });
});

describe("cc-android-bridge — invoke", () => {
  it("rejects a non-string / empty method", async () => {
    await expect(invoke("")).rejects.toThrow(TypeError);
    await expect(invoke(null)).rejects.toThrow(/non-empty string/);
  });

  it("uses the test-invoke path under the override env", async () => {
    process.env.CC_ANDROID_BRIDGE_OVERRIDE = "1";
    _deps.testInvoke = vi.fn(async (m) => ({ echoed: m }));
    expect(await invoke("ping", { a: 1 })).toEqual({ echoed: "ping" });
    expect(_deps.testInvoke).toHaveBeenCalledWith("ping", { a: 1 });
  });

  it("rejects when not on Android", async () => {
    _deps.detectAndroid = () => false;
    await expect(invoke("x")).rejects.toMatchObject({
      code: "ANDROID_BRIDGE_NOT_AVAILABLE",
    });
    await expect(invoke("x")).rejects.toThrow(/not running on Android/);
  });

  it("rejects when the bridge config is missing", async () => {
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => null;
    await expect(invoke("x")).rejects.toThrow(/bridge config missing/);
  });

  it("POSTs to /invoke with the bearer token and returns parsed JSON", async () => {
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => ({
      port: 8237,
      token: "tok",
      baseUrl: "http://127.0.0.1:8237",
    });
    _deps.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"result":42}',
    }));
    const out = await invoke("contacts.query", { q: "x" });
    expect(out).toEqual({ result: 42 });
    expect(_deps.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8237/invoke?method=contacts.query",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
        body: JSON.stringify({ q: "x" }),
      }),
    );
  });

  it("wraps transport errors", async () => {
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => ({
      baseUrl: "http://127.0.0.1:1",
      token: "t",
    });
    _deps.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(invoke("x")).rejects.toThrow(
      /HTTP transport error: ECONNREFUSED/,
    );
  });

  it("rejects on a non-200 response", async () => {
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => ({ baseUrl: "http://h", token: "t" });
    _deps.fetch = async () => ({ ok: false, status: 503 });
    await expect(invoke("x")).rejects.toThrow(/bridge HTTP 503/);
  });

  it("rejects on a non-JSON body", async () => {
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => ({ baseUrl: "http://h", token: "t" });
    _deps.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => "<html>oops",
    });
    await expect(invoke("x")).rejects.toThrow(/bridge returned non-JSON/);
  });
});

describe("cc-android-bridge — caps", () => {
  it("reports available under the test override", () => {
    process.env.CC_ANDROID_BRIDGE_OVERRIDE = "1";
    expect(caps()).toEqual({ available: true, reason: "test-override" });
  });

  it("reports not-on-android", () => {
    _deps.detectAndroid = () => false;
    const c = caps();
    expect(c.available).toBe(false);
    expect(c.reason).toMatch(/not-on-android/);
  });

  it("reports server-not-started when config is missing", () => {
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => null;
    const c = caps();
    expect(c.available).toBe(false);
    expect(c.reason).toMatch(/bridge-server-not-started/);
  });

  it("reports available with the port when reachable", () => {
    _deps.detectAndroid = () => true;
    _deps.loadBridgeConfig = () => ({ port: 8237, token: "t", baseUrl: "x" });
    expect(caps()).toEqual({ available: true, port: 8237 });
  });
});
