"use strict";

import { describe, it, expect } from "vitest";

const { probe, decide } = require("../../lib/adapters/wechat/env-probe");

/**
 * Build a scripted exec that returns a canned response per matching
 * substring. Falls back to `{ code: 1, stdout: "", stderr: "" }`.
 */
function makeExec(table) {
  return async (cmd) => {
    for (const [needle, response] of table) {
      if (cmd.includes(needle)) return { code: 0, stdout: response, stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "" };
  };
}

const ADB_DEVICES_OK = "List of devices attached\nABC123XYZ\tdevice\n\n";
const WECHAT_7 = "    versionName=7.0.22\n";
const WECHAT_8 = "    versionName=8.0.50\n";
const NETSTAT_FRIDA = "tcp        0      0 0.0.0.0:27042           0.0.0.0:*               LISTEN\n";

describe("decide() — pure decision logic", () => {
  it("device unreachable → unsupported", () => {
    const r = decide({
      device: { reachable: false }, root: {}, frida: {}, wechat: {},
    });
    expect(r.suggestedKeyProvider).toBe("unsupported");
  });

  it("WeChat 7.x → md5 regardless of root/frida", () => {
    const r = decide({
      device: { reachable: true },
      root: { detected: false },
      frida: { serverRunning: false },
      wechat: { installed: true, versionName: "7.0.22", majorVersion: 7 },
    });
    expect(r.suggestedKeyProvider).toBe("md5");
  });

  it("WeChat 8.x + root + frida → frida", () => {
    const r = decide({
      device: { reachable: true },
      root: { detected: true, magiskInstalled: true },
      frida: { serverRunning: true, port: 27042 },
      wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
    });
    expect(r.suggestedKeyProvider).toBe("frida");
  });

  it("WeChat 8.x + no root → unsupported", () => {
    const r = decide({
      device: { reachable: true },
      root: { detected: false },
      frida: { serverRunning: true },
      wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
    });
    expect(r.suggestedKeyProvider).toBe("unsupported");
    expect(r.reasons.join(" ")).toMatch(/root/);
  });

  it("WeChat 8.x + root + no frida-server → unsupported", () => {
    const r = decide({
      device: { reachable: true },
      root: { detected: true },
      frida: { serverRunning: false },
      wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
    });
    expect(r.suggestedKeyProvider).toBe("unsupported");
    expect(r.reasons.join(" ")).toMatch(/frida-server/i);
  });

  it("WeChat not installed → unsupported", () => {
    const r = decide({
      device: { reachable: true },
      root: { detected: true },
      frida: { serverRunning: true },
      wechat: { installed: false },
    });
    expect(r.suggestedKeyProvider).toBe("unsupported");
    expect(r.reasons.join(" ")).toMatch(/not installed/);
  });

  it("WeChat 8.x + root + frida + no Magisk → frida (warn reason)", () => {
    const r = decide({
      device: { reachable: true },
      root: { detected: true, magiskInstalled: false },
      frida: { serverRunning: true, port: 27042 },
      wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
    });
    expect(r.suggestedKeyProvider).toBe("frida");
    expect(r.reasons.join(" ")).toMatch(/Magisk not detected/);
  });
});

describe("probe() — end-to-end with mock exec", () => {
  it("returns unsupported when no device", async () => {
    const exec = makeExec([["adb devices", "List of devices attached\n\n"]]);
    const r = await probe({ exec });
    expect(r.ok).toBe(false);
    expect(r.suggestedKeyProvider).toBe("unsupported");
    expect(r.device.reachable).toBe(false);
  });

  it("WeChat 7.x device → md5 path", async () => {
    const exec = makeExec([
      ["adb devices", ADB_DEVICES_OK],
      ["getprop ro.product.cpu.abi", "arm64-v8a\n"],
      ["com.tencent.mm", WECHAT_7],
    ]);
    const r = await probe({ exec });
    expect(r.ok).toBe(true);
    expect(r.suggestedKeyProvider).toBe("md5");
    expect(r.device.serial).toBe("ABC123XYZ");
    expect(r.device.abi).toBe("arm64-v8a");
    expect(r.wechat.majorVersion).toBe(7);
  });

  it("WeChat 8.x + rooted + frida → frida path", async () => {
    const exec = makeExec([
      ["adb devices", ADB_DEVICES_OK],
      ["getprop ro.product.cpu.abi", "arm64-v8a\n"],
      ['su -c id', "uid=0(root) gid=0(root) groups=0(root)\n"],
      ["command -v magisk", "/system/bin/magisk\n"],
      ["pgrep -f frida-server", "12345\n"],
      ["netstat -tln", NETSTAT_FRIDA],
      ["com.tencent.mm", WECHAT_8],
    ]);
    const r = await probe({ exec });
    expect(r.ok).toBe(true);
    expect(r.suggestedKeyProvider).toBe("frida");
    expect(r.root.detected).toBe(true);
    expect(r.root.magiskInstalled).toBe(true);
    expect(r.frida.serverRunning).toBe(true);
    expect(r.frida.port).toBe(27042);
    expect(r.wechat.majorVersion).toBe(8);
  });

  it("WeChat 8.x but no root → unsupported with reason", async () => {
    const exec = makeExec([
      ["adb devices", ADB_DEVICES_OK],
      ["getprop ro.product.cpu.abi", "arm64-v8a\n"],
      ["com.tencent.mm", WECHAT_8],
    ]);
    const r = await probe({ exec });
    expect(r.ok).toBe(false);
    expect(r.suggestedKeyProvider).toBe("unsupported");
    expect(r.reasons.join(" ")).toMatch(/root not detected/);
  });

  it("non-ARM ABI gets warning", async () => {
    const exec = makeExec([
      ["adb devices", ADB_DEVICES_OK],
      ["getprop ro.product.cpu.abi", "x86_64\n"],
      ["com.tencent.mm", WECHAT_7],
    ]);
    const r = await probe({ exec });
    expect(r.warnings.join(" ")).toMatch(/x86_64/);
  });
});
