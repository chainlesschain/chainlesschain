/**
 * Phase 12 v0.5 — WeChat legacy key extractor (frida-INDEPENDENT).
 *
 * Ports sjqz/parsers/wechat_decrypt.py legacy path to Node:
 *
 *   key = MD5(IMEI + UIN)[:7].lower()
 *
 * Works for WeChat versions < 8.0.X where the IMEI-derived key path is
 * still active. WeChat 8.0+ requires Frida hook on `sqlite3_key` —
 * that's Phase 12.6 (frida-dependent) and ships when device + Frida are
 * available.
 *
 * Inputs:
 *   - wechatDataPath: directory mirroring /data/data/com.tencent.mm/
 *     after `adb pull` (or PC WeChat Files directory)
 *   - Optional explicit overrides (imei, uin, manualKey) for testing or
 *     when CompatibleInfo.cfg parsing fails
 *
 * Outputs:
 *   {
 *     uin: "1234567890",
 *     imei: "1234567890abcdef",
 *     key: "5d41402",         // 7-char hex MD5 prefix
 *     source: "auth-xml+compatible-cfg" | "manual" | "...",
 *     warnings: [...]
 *   }
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Extract UIN from shared_prefs/auth_info_key_prefs.xml or
 * system_config_prefs.xml. UIN may be negative; can also be in
 * `default_uin` or `_auth_uin` keys depending on WeChat version.
 */
function extractUinFromPrefs(wechatDataPath) {
  const candidates = [
    path.join(wechatDataPath, "shared_prefs", "auth_info_key_prefs.xml"),
    path.join(wechatDataPath, "shared_prefs", "system_config_prefs.xml"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const content = fs.readFileSync(p, "utf-8");
      const patterns = [
        /<int name="[^"]*_auth_uin[^"]*"\s+value="(-?\d+)"/,
        /<int name="default_uin"\s+value="(-?\d+)"/,
        /<int name="[^"]*uin[^"]*"\s+value="(-?\d+)"/,
      ];
      for (const re of patterns) {
        const m = re.exec(content);
        if (m) return { uin: m[1], from: path.basename(p) };
      }
    } catch (_e) {
      // Try next candidate
    }
  }
  return { uin: null, from: null };
}

/**
 * Extract IMEI / device serial from CompatibleInfo.cfg. The file is a
 * Java HashMap serialization; we use string-search for 15-digit IMEI
 * patterns + GUIDs as fallback (matches sjqz approach).
 */
function extractImeiFromCompatibleInfo(wechatDataPath) {
  const cfgPath = path.join(wechatDataPath, "MicroMsg", "CompatibleInfo.cfg");
  if (!fs.existsSync(cfgPath)) return { imei: null, from: null };
  try {
    const buf = fs.readFileSync(cfgPath);
    const text = buf.toString("binary"); // 8-bit safe — we don't care about decoding
    // 15-digit IMEI
    const imeiMatch = /\D(\d{15})\D/.exec(text);
    if (imeiMatch) return { imei: imeiMatch[1], from: "CompatibleInfo.cfg (15-digit)" };
    // Fallback: 14-digit + check digit pattern
    const imei14 = /\D(\d{14})\D/.exec(text);
    if (imei14) return { imei: imei14[1], from: "CompatibleInfo.cfg (14-digit)" };
    // Fallback: GUID-like
    const guid = /([0-9a-f]{32})/i.exec(text);
    if (guid) return { imei: guid[1], from: "CompatibleInfo.cfg (guid)" };
  } catch (_e) {}
  return { imei: null, from: null };
}

/**
 * Derive the SQLCipher key.
 *
 * @param {string} imei
 * @param {string|number} uin
 * @returns {string} 7-char hex prefix of MD5(IMEI+UIN), lowercase
 */
function deriveLegacyKey(imei, uin) {
  if (typeof imei !== "string" || imei.length === 0) {
    throw new Error("deriveLegacyKey: imei required");
  }
  if (uin == null) throw new Error("deriveLegacyKey: uin required");
  const raw = String(imei) + String(uin);
  return crypto.createHash("md5").update(raw, "utf-8").digest("hex").slice(0, 7).toLowerCase();
}

/**
 * Top-level: extract key from a pulled WeChat data directory.
 *
 * @param {object} opts
 * @param {string} opts.wechatDataPath   directory like the pulled
 *                                       /data/data/com.tencent.mm/ tree
 * @param {string} [opts.uin]            override (skip auth XML parse)
 * @param {string} [opts.imei]           override (skip CompatibleInfo)
 * @returns {object}  { uin, imei, key, source, warnings }
 */
function extractWeChatKey(opts = {}) {
  if (!opts.wechatDataPath || typeof opts.wechatDataPath !== "string") {
    throw new Error("extractWeChatKey: opts.wechatDataPath required");
  }
  const warnings = [];

  let uin = opts.uin || null;
  let uinSource = "manual";
  if (!uin) {
    const r = extractUinFromPrefs(opts.wechatDataPath);
    uin = r.uin;
    uinSource = r.from || "missing";
    if (!uin) warnings.push("UIN not found in shared_prefs — adapter unusable without manual override");
  }

  let imei = opts.imei || null;
  let imeiSource = "manual";
  if (!imei) {
    const r = extractImeiFromCompatibleInfo(opts.wechatDataPath);
    imei = r.imei;
    imeiSource = r.from || "missing";
    if (!imei) warnings.push("IMEI not found in CompatibleInfo.cfg — adapter unusable without manual override");
  }

  if (!uin || !imei) {
    return { uin, imei, key: null, source: `uin:${uinSource} | imei:${imeiSource}`, warnings };
  }

  const key = deriveLegacyKey(imei, uin);
  return {
    uin,
    imei,
    key,
    source: `uin:${uinSource} | imei:${imeiSource}`,
    warnings,
  };
}

module.exports = {
  extractWeChatKey,
  deriveLegacyKey,
  extractUinFromPrefs,
  extractImeiFromCompatibleInfo,
};
