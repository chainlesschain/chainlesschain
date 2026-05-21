/**
 * Phase 12.6.4 — WeChat env-probe.
 *
 * Inspects the connected Android device (via `adb`) and decides which
 * KeyProvider strategy is viable:
 *
 *   - suggestedKeyProvider: "md5" | "frida" | "unsupported"
 *
 * Decision tree:
 *   - WeChat < 8.0  → "md5"   (legacy MD5(IMEI+UIN)[:7] path works)
 *   - WeChat 8.0+   → "frida" (need live hook; requires root + frida-server)
 *   - WeChat absent / device unreachable → "unsupported"
 *
 * Each capability is probed independently so UI can show a checklist.
 * All shell commands are routed through an injected `exec()` so unit
 * tests don't spawn real processes.
 *
 * Wire shape:
 *   {
 *     ok: boolean,                  // overall — true iff suggestedKeyProvider !== "unsupported"
 *     suggestedKeyProvider: "md5" | "frida" | "unsupported",
 *     reasons: string[],            // human strings for why suggestion chosen
 *     device: {
 *       reachable: boolean,
 *       serial: string | null,
 *       abi: string | null,         // arm64-v8a / armeabi-v7a / x86_64
 *     },
 *     root: {
 *       detected: boolean,
 *       magiskInstalled: boolean,
 *     },
 *     frida: {
 *       serverRunning: boolean,
 *       port: number | null,
 *     },
 *     wechat: {
 *       installed: boolean,
 *       versionName: string | null,
 *       majorVersion: number | null,
 *     },
 *     warnings: string[],
 *   }
 */
"use strict";

// Lazy require of child_process so test injection beats the import
function defaultExec() {
  // eslint-disable-next-line global-require
  const cp = require("node:child_process");
  return (cmd, opts = {}) => new Promise((resolve) => {
    cp.exec(cmd, { encoding: "utf-8", timeout: 5000, ...opts }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code || 1) : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
      });
    });
  });
}

async function probeDevice(exec) {
  const out = { reachable: false, serial: null, abi: null };
  const r = await exec("adb devices");
  if (r.code !== 0) return out;
  const lines = r.stdout.split(/\r?\n/);
  // Header: "List of devices attached" then "<serial>\tdevice"
  for (const line of lines) {
    const m = /^(\S+)\s+device\s*$/.exec(line);
    if (m) {
      out.reachable = true;
      out.serial = m[1];
      break;
    }
  }
  if (!out.reachable) return out;
  const abiR = await exec("adb shell getprop ro.product.cpu.abi");
  out.abi = abiR.code === 0 ? abiR.stdout.trim() || null : null;
  return out;
}

async function probeRoot(exec) {
  const out = { detected: false, magiskInstalled: false };
  // `su -c id` succeeds (uid=0) only on rooted devices
  const su = await exec('adb shell "su -c id" 2>&1');
  if (su.code === 0 && /uid=0/.test(su.stdout)) out.detected = true;
  // which magisk (Magisk command-line)
  const ma = await exec('adb shell "command -v magisk"');
  if (ma.code === 0 && ma.stdout.trim()) out.magiskInstalled = true;
  return out;
}

async function probeFridaServer(exec) {
  const out = { serverRunning: false, port: null };
  // Look for frida-server in process list (matches frida-server-* prebuilds)
  const ps = await exec('adb shell "pgrep -f frida-server" 2>&1');
  if (ps.code === 0 && /^\d+/m.test(ps.stdout.trim())) out.serverRunning = true;
  // Default port 27042; check if it's listening
  const ns = await exec('adb shell "netstat -tln 2>/dev/null | grep -E \':27042\\b\'"');
  if (ns.code === 0 && ns.stdout.includes("27042")) {
    out.serverRunning = true;
    out.port = 27042;
  } else if (out.serverRunning) {
    out.port = 27042;
  }
  return out;
}

async function probeWeChat(exec) {
  const out = { installed: false, versionName: null, majorVersion: null };
  const r = await exec('adb shell "dumpsys package com.tencent.mm | grep versionName"');
  if (r.code !== 0) return out;
  const m = /versionName=([\d.]+)/i.exec(r.stdout);
  if (!m) return out;
  out.installed = true;
  out.versionName = m[1];
  const major = parseInt(m[1].split(".")[0], 10);
  out.majorVersion = Number.isFinite(major) ? major : null;
  return out;
}

/**
 * Decide suggested KeyProvider given probed capabilities.
 * Exported separately so callers can also pass synthetic facts.
 */
function decide({ device, root, frida, wechat }) {
  const reasons = [];
  if (!device.reachable) {
    return { suggestedKeyProvider: "unsupported", reasons: ["No adb device reachable"] };
  }
  if (!wechat.installed) {
    return { suggestedKeyProvider: "unsupported", reasons: ["WeChat (com.tencent.mm) not installed"] };
  }
  const major = wechat.majorVersion;
  if (major != null && major < 8) {
    reasons.push(`WeChat ${wechat.versionName} (< 8.0) — legacy MD5(IMEI+UIN) path supported`);
    return { suggestedKeyProvider: "md5", reasons };
  }
  // 8.0+ requires frida
  if (!root.detected) {
    return {
      suggestedKeyProvider: "unsupported",
      reasons: [`WeChat ${wechat.versionName || "8.x"} requires root for SQLCipher key extraction, root not detected`],
    };
  }
  if (!frida.serverRunning) {
    return {
      suggestedKeyProvider: "unsupported",
      reasons: [
        `WeChat ${wechat.versionName || "8.x"} requires Frida hook`,
        "frida-server not running on device — see Frida Setup runbook",
      ],
    };
  }
  reasons.push(`WeChat ${wechat.versionName} (≥ 8.0) — Frida hook on libwcdb.so sqlite3_key`);
  if (!root.magiskInstalled) {
    reasons.push("Magisk not detected — DenyList configuration unavailable; reverse-detection may be weaker");
  }
  return { suggestedKeyProvider: "frida", reasons };
}

/**
 * Top-level probe.
 *
 * @param {object} [opts]
 * @param {Function} [opts.exec]  injected exec(cmd, opts) → {code, stdout, stderr}
 * @returns {Promise<object>}     full probe shape (see file header)
 */
async function probe(opts = {}) {
  const exec = typeof opts.exec === "function" ? opts.exec : defaultExec();
  const warnings = [];

  const device = await probeDevice(exec);
  if (!device.reachable) {
    return {
      ok: false,
      suggestedKeyProvider: "unsupported",
      reasons: ["No adb device reachable — enable USB debugging and reconnect"],
      device,
      root: { detected: false, magiskInstalled: false },
      frida: { serverRunning: false, port: null },
      wechat: { installed: false, versionName: null, majorVersion: null },
      warnings,
    };
  }

  const [root, frida, wechat] = await Promise.all([
    probeRoot(exec),
    probeFridaServer(exec),
    probeWeChat(exec),
  ]);

  if (device.abi && !/^arm/.test(device.abi)) {
    warnings.push(`ABI ${device.abi} — Frida prebuilt may need manual build for non-ARM target`);
  }

  const { suggestedKeyProvider, reasons } = decide({ device, root, frida, wechat });

  return {
    ok: suggestedKeyProvider !== "unsupported",
    suggestedKeyProvider,
    reasons,
    device,
    root,
    frida,
    wechat,
    warnings,
  };
}

module.exports = {
  probe,
  decide,
  // exposed for fine-grained testing
  probeDevice,
  probeRoot,
  probeFridaServer,
  probeWeChat,
};
