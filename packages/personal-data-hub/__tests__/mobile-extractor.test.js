"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { AndroidExtractor, iOSBackupReader } = require("../lib/mobile-extractor");

// ─── AndroidExtractor — mocked execFn ────────────────────────────────────

function mockExec(scriptMap) {
  // scriptMap: { "args joined by space": { stdout: "...", stderr: "..." }
  // | () => Promise<{stdout, stderr}> }
  return async (cmd, args) => {
    const key = args.join(" ");
    if (key in scriptMap) {
      const v = scriptMap[key];
      return typeof v === "function" ? await v() : v;
    }
    // Allow prefix matches for convenience
    for (const k of Object.keys(scriptMap)) {
      if (key.startsWith(k)) {
        const v = scriptMap[k];
        return typeof v === "function" ? await v() : v;
      }
    }
    throw new Error(`mockExec: no script for: ${cmd} ${key}`);
  };
}

describe("AndroidExtractor", () => {
  it("listDevices parses adb output", async () => {
    const ext = new AndroidExtractor({
      execFn: mockExec({
        "devices -l": {
          stdout:
            "List of devices attached\n" +
            "ABCDEF123  device  product:redmi  model:Redmi_24115RA8EC  device:redmi\n" +
            "OFFLINE99  offline\n",
          stderr: "",
        },
      }),
    });
    const devices = await ext.listDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0].serial).toBe("ABCDEF123");
    expect(devices[0].state).toBe("device");
    expect(devices[0].model).toBe("Redmi_24115RA8EC");
    expect(devices[1].state).toBe("offline");
  });

  it("isDeviceReady checks state", async () => {
    const ext = new AndroidExtractor({
      execFn: mockExec({
        "devices -l": {
          stdout: "List of devices attached\nABCDEF123  device  product:p\n",
          stderr: "",
        },
      }),
    });
    expect(await ext.isDeviceReady("ABCDEF123")).toBe(true);
    expect(await ext.isDeviceReady("BAD-SERIAL")).toBe(false);
  });

  it("probeRoot detects Magisk + selinux", async () => {
    const ext = new AndroidExtractor({
      execFn: mockExec({
        "-s ABC shell which su": { stdout: "/system/bin/magisk\n" },
        "-s ABC shell which magisk": { stdout: "/system/bin/magisk\n" },
        "-s ABC shell getenforce": { stdout: "Enforcing\n" },
      }),
    });
    const probe = await ext.probeRoot("ABC");
    expect(probe.rooted).toBe(true);
    expect(probe.su).toBe("magisk-su");
    expect(probe.magiskInstalled).toBe(true);
    expect(probe.selinux).toBe("enforcing");
  });

  it("probeRoot non-rooted device", async () => {
    const ext = new AndroidExtractor({
      execFn: mockExec({
        "-s ABC shell which su": { stdout: "" },
        "-s ABC shell which magisk": { stdout: "" },
        "-s ABC shell getenforce": { stdout: "Enforcing\n" },
      }),
    });
    const probe = await ext.probeRoot("ABC");
    expect(probe.rooted).toBe(false);
    expect(probe.su).toBeNull();
  });

  it("listPackages filters user-installed by default", async () => {
    const ext = new AndroidExtractor({
      execFn: mockExec({
        "-s ABC shell pm list packages -3": {
          stdout: "package:com.tencent.mm\npackage:com.taobao.taobao\n",
        },
      }),
    });
    const pkgs = await ext.listPackages("ABC");
    expect(pkgs).toEqual(["com.tencent.mm", "com.taobao.taobao"]);
  });

  it("pull creates dest dir + invokes adb pull", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-"));
    let pulled = false;
    const ext = new AndroidExtractor({
      execFn: async (cmd, args) => {
        if (args[2] === "pull") {
          pulled = true;
          // Simulate adb pull writing to dest
          fs.writeFileSync(args[4], "fake-pulled-content");
          return { stdout: "1 file pulled", stderr: "" };
        }
        throw new Error("unexpected adb call");
      },
    });
    const dest = path.join(dir, "sub/file.bin");
    await ext.pull("ABC", "/sdcard/x.bin", dest);
    expect(pulled).toBe(true);
    expect(fs.existsSync(dest)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("pullFromAppPrivate uses su cat + temp + cleanup", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-"));
    const calls = [];
    const ext = new AndroidExtractor({
      execFn: async (cmd, args) => {
        calls.push(args.join(" "));
        if (args[2] === "shell" && args[3].startsWith("su -c 'cat")) {
          return { stdout: "", stderr: "" };
        }
        if (args[2] === "pull") {
          fs.writeFileSync(args[4], "decrypted-db-bytes");
          return { stdout: "", stderr: "" };
        }
        if (args[2] === "shell" && args[3].startsWith("rm -f")) {
          return { stdout: "", stderr: "" };
        }
        throw new Error("unexpected adb call: " + args.join(" "));
      },
    });
    const dest = path.join(dir, "EnMicroMsg.db");
    await ext.pullFromAppPrivate("ABC", "com.tencent.mm", "/data/data/com.tencent.mm/MicroMsg/x/EnMicroMsg.db", dest);
    expect(fs.existsSync(dest)).toBe(true);
    // Verify su cat happened + cleanup rm happened
    expect(calls.some((c) => c.includes("su -c 'cat"))).toBe(true);
    expect(calls.some((c) => c.includes("rm -f"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lsAppPrivate parses ls -1 output", async () => {
    const ext = new AndroidExtractor({
      execFn: mockExec({
        "-s ABC shell su -c 'ls -1 \"/data/data/com.tencent.mm\"'": {
          stdout: "MicroMsg\nshared_prefs\nfiles\ncache\n",
        },
      }),
    });
    const ls = await ext.lsAppPrivate("ABC", "/data/data/com.tencent.mm");
    expect(ls).toContain("MicroMsg");
    expect(ls).toContain("shared_prefs");
  });
});

// ─── iOSBackupReader — fixture-driven ────────────────────────────────────

describe("iOSBackupReader", () => {
  let dir;

  function makeBackup({ encrypted = false } = {}) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-bk-"));
    fs.writeFileSync(
      path.join(dir, "Manifest.plist"),
      `<?xml version="1.0"?><plist version="1.0"><dict>
<key>IsEncrypted</key>${encrypted ? "<true/>" : "<false/>"}
</dict></plist>`,
    );
    fs.writeFileSync(
      path.join(dir, "Info.plist"),
      `<?xml version="1.0"?><plist version="1.0"><dict>
<key>Device Name</key><string>Test iPhone</string>
<key>Product Type</key><string>iPhone15,2</string>
<key>Product Version</key><string>18.0</string>
</dict></plist>`,
    );
    // Empty SQLite Manifest.db — mock driver below skips it
    fs.writeFileSync(path.join(dir, "Manifest.db"), Buffer.from("SQLite format 3\0"));
    return dir;
  }

  afterEach(() => {
    if (dir) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
    }
    dir = null;
  });

  it("constructor rejects missing dir", () => {
    expect(() => new iOSBackupReader({ backupDir: "/nonexistent/path/xx" })).toThrow();
    expect(() => new iOSBackupReader({})).toThrow(/backupDir/);
  });

  it("encrypted backup throws (Phase 7.5b TODO)", async () => {
    const backupDir = makeBackup({ encrypted: true });
    const reader = new iOSBackupReader({
      backupDir,
      dbDriverFn: () => {
        throw new Error("driver should not be called when encrypted");
      },
    });
    await expect(reader.open()).rejects.toThrow(/encrypted/);
  });

  it("open() reads Info.plist + opens Manifest.db", async () => {
    const backupDir = makeBackup({ encrypted: false });
    // Mock SQLite driver
    const mockDb = {
      prepare: () => ({ all: () => [], get: () => undefined }),
      close: () => {},
    };
    const mockDriver = () => mockDb;
    const reader = new iOSBackupReader({ backupDir, dbDriverFn: mockDriver });
    const r = await reader.open();
    expect(r.encrypted).toBe(false);
    expect(r.info["Device Name"]).toBe("Test iPhone");
    expect(r.info["Product Version"]).toBe("18.0");
    reader.close();
  });

  it("listFiles passes WHERE clauses based on opts", async () => {
    const backupDir = makeBackup({ encrypted: false });
    let lastSql, lastParams;
    const mockDriver = () => ({
      prepare: (sql) => ({
        all: (...params) => {
          lastSql = sql;
          lastParams = params;
          return [{ fileID: "abc", domain: "HomeDomain", relativePath: "Library/Notes/notes.sqlite", flags: 1 }];
        },
      }),
      close: () => {},
    });
    const reader = new iOSBackupReader({ backupDir, dbDriverFn: mockDriver });
    await reader.open();
    const files = reader.listFiles({ domain: "HomeDomain", limit: 10 });
    expect(files).toHaveLength(1);
    expect(lastSql).toContain("WHERE domain = ?");
    expect(lastParams).toContain("HomeDomain");
    reader.close();
  });

  it("resolveFileOnDisk shards by first 2 chars", async () => {
    const backupDir = makeBackup({ encrypted: false });
    const mockDriver = () => ({
      prepare: () => ({ all: () => [], get: () => undefined }),
      close: () => {},
    });
    const reader = new iOSBackupReader({ backupDir, dbDriverFn: mockDriver });
    await reader.open();
    const p = reader.resolveFileOnDisk("abcd1234567890");
    expect(p).toBe(path.join(backupDir, "ab", "abcd1234567890"));
    reader.close();
  });

  it("copyOut copies the sharded file to localPath", async () => {
    const backupDir = makeBackup({ encrypted: false });
    // Create a fake sharded file
    const fileID = "abc1234";
    const shardedDir = path.join(backupDir, "ab");
    fs.mkdirSync(shardedDir, { recursive: true });
    fs.writeFileSync(path.join(shardedDir, fileID), "test-content");

    const mockDriver = () => ({
      prepare: () => ({ all: () => [], get: () => undefined }),
      close: () => {},
    });
    const reader = new iOSBackupReader({ backupDir, dbDriverFn: mockDriver });
    await reader.open();
    const local = path.join(backupDir, "out", "extracted.bin");
    reader.copyOut(fileID, local);
    expect(fs.readFileSync(local, "utf-8")).toBe("test-content");
    reader.close();
  });
});
