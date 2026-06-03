/**
 * Phase 7.5 — Android mobile extractor.
 *
 * Wraps adb (Android Debug Bridge) commands so adapters that need
 * on-device data (Phase 12 WeChat, Phase 13+ QQ / 微博 / B 站 etc.) can
 * pull files without each adapter re-implementing adb plumbing.
 *
 * Three extraction modes (per sjqz architecture):
 *   1. `adb backup`        — no root needed, but most apps opt out
 *      (allowBackup=false). Limited; we keep it as a fallback only.
 *   2. APK downgrade       — uninstall + install lower-version + extract.
 *      Destructive to user state; v0 skipped, design only.
 *   3. Root direct pull    — `adb shell su -c 'cat /data/data/...'` or
 *      `adb pull` after `chmod` on Magisk. Most reliable; required for
 *      Phase 12 WeChat. v0 ships this path.
 *
 * Inject `execFn(cmd, args) → { stdout, stderr, exitCode }` for tests;
 * default is Node `child_process.execFile`.
 */

"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");

const execFileP = promisify(execFile);

class AndroidExtractor {
  constructor(opts = {}) {
    this._adbPath = opts.adbPath || "adb";
    this._execFn = typeof opts.execFn === "function" ? opts.execFn : null;
    this._connectTimeoutMs = Number.isFinite(opts.connectTimeoutMs) ? opts.connectTimeoutMs : 10_000;
  }

  /**
   * List connected Android devices. Returns
   * [{ serial, state, model?, manufacturer? }, ...].
   * `state` ∈ "device" (ready) | "unauthorized" | "offline"
   */
  async listDevices() {
    const { stdout } = await this._adb(["devices", "-l"]);
    const lines = stdout.split(/\r?\n/).filter((l) => l && !l.startsWith("List of devices"));
    const devices = [];
    for (const line of lines) {
      // Format: "<serial>  <state>  product:...  model:...  device:..."
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const serial = parts[0];
      const state = parts[1];
      const info = { serial, state };
      for (const kv of parts.slice(2)) {
        const idx = kv.indexOf(":");
        if (idx > 0) info[kv.slice(0, idx)] = kv.slice(idx + 1);
      }
      devices.push(info);
    }
    return devices;
  }

  /**
   * Check if a specific device is connected and ready for `adb` ops.
   */
  async isDeviceReady(serial) {
    const devices = await this.listDevices();
    return devices.some((d) => d.serial === serial && d.state === "device");
  }

  /**
   * Probe device root + Magisk status. Returns
   * { rooted, su: "su"|"magisk-su"|null, magiskInstalled, selinux }.
   */
  async probeRoot(serial) {
    const probe = { rooted: false, su: null, magiskInstalled: false, selinux: "unknown" };
    try {
      const { stdout: suWhich } = await this._adb(["-s", serial, "shell", "which su"]);
      if (suWhich && suWhich.trim()) {
        probe.rooted = true;
        probe.su = suWhich.includes("magisk") ? "magisk-su" : "su";
      }
    } catch (_e) {}
    try {
      const { stdout: magisk } = await this._adb(["-s", serial, "shell", "which magisk"]);
      probe.magiskInstalled = !!(magisk && magisk.trim());
    } catch (_e) {}
    try {
      const { stdout: se } = await this._adb(["-s", serial, "shell", "getenforce"]);
      probe.selinux = (se || "unknown").trim().toLowerCase();
    } catch (_e) {}
    return probe;
  }

  /**
   * List installed user-app packages on the device. Filters out system
   * apps to keep the list relevant to data-mining.
   */
  async listPackages(serial, opts = {}) {
    const flag = opts.includeSystem ? "-l" : "-3"; // -3 = user-installed only
    const { stdout } = await this._adb(["-s", serial, "shell", "pm", "list", "packages", flag]);
    return stdout
      .split(/\r?\n/)
      .map((l) => l.replace(/^package:/, "").trim())
      .filter(Boolean);
  }

  /**
   * Pull a file or directory from the device to a local destination.
   * Returns the local path written.
   */
  async pull(serial, remotePath, localPath) {
    if (!remotePath || !localPath) {
      throw new Error("AndroidExtractor.pull: remotePath + localPath required");
    }
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    await this._adb(["-s", serial, "pull", remotePath, localPath]);
    return localPath;
  }

  /**
   * Pull a file from an app's private directory using su. Requires root.
   * Uses temp-then-pull pattern (su cat → /sdcard/temp → pull → cleanup)
   * because direct `adb pull /data/data/...` is blocked by SELinux even
   * with su.
   */
  async pullFromAppPrivate(serial, packageName, remotePath, localPath) {
    const tempName = `pdh-extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempRemote = `/sdcard/${tempName}`;
    try {
      // Copy with su so we can read protected files
      await this._adb([
        "-s", serial, "shell",
        `su -c 'cat "${remotePath}" > "${tempRemote}" && chmod 644 "${tempRemote}"'`,
      ]);
      await this.pull(serial, tempRemote, localPath);
      return localPath;
    } finally {
      try {
        await this._adb(["-s", serial, "shell", `rm -f "${tempRemote}"`]);
      } catch (_e) {}
    }
  }

  /**
   * Run a directory listing in an app's private directory (root-only).
   * Returns paths as a flat string array.
   */
  async lsAppPrivate(serial, remotePath) {
    const { stdout } = await this._adb([
      "-s", serial, "shell",
      `su -c 'ls -1 "${remotePath}"' 2>/dev/null`,
    ]);
    return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }

  /**
   * adb backup (no root). Saves an .ab file to localPath. The .ab
   * format is ADB-specific tar+deflate; consumers parse it with a
   * separate library or 7-zip.
   */
  async backup(serial, packageName, localPath) {
    if (!packageName || !localPath) {
      throw new Error("AndroidExtractor.backup: packageName + localPath required");
    }
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    // Note: prompts on-device "Confirm" dialog; the call returns once the
    // user accepts. Tests inject execFn to skip this.
    await this._adb([
      "-s", serial,
      "backup",
      "-apk", "-shared", "-noapk",
      "-f", localPath,
      packageName,
    ]);
    return localPath;
  }

  // ─── internals ────────────────────────────────────────────────────

  async _adb(args) {
    if (this._execFn) {
      // Test injection — must return { stdout, stderr }
      return await this._execFn(this._adbPath, args);
    }
    const result = await execFileP(this._adbPath, args, {
      timeout: this._connectTimeoutMs * 6,
      maxBuffer: 1024 * 1024 * 50, // 50MB for big stdout (file dumps)
    });
    return { stdout: result.stdout || "", stderr: result.stderr || "" };
  }
}

module.exports = { AndroidExtractor };
