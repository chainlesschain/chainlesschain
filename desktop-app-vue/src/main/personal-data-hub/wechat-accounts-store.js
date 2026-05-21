/**
 * Phase 12.6.8 — WeChat accounts store (desktop side).
 *
 * Mirrors the structure of alipay-accounts.json / aichat-accounts.json
 * (JSON file under hubDir/, mode 0o600). Each row captures only what the
 * user *typed in* the register dialog — never raw key bytes, never
 * `wechatDataPath` (likely outside the userData tree).
 *
 *   [
 *     {
 *       account: { uin: "1234567890" },
 *       dbPath: "C:/users/me/pull/EnMicroMsg.db",
 *       wechatDataPath: "C:/users/me/pull/com.tencent.mm",  // optional
 *       chosenKeyProvider: "md5" | "frida",
 *       registeredAt: 1716280000000,
 *       lastSyncAt: null,
 *     },
 *     ...
 *   ]
 *
 * The actual key never lives here — bootstrap re-runs env-probe at each
 * sync and rebuilds the KeyProvider on demand.
 */
"use strict";

const fs = require("node:fs");

function loadWechatAccounts(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    // Corrupt JSON → start empty rather than crash the whole hub boot.
    return [];
  }
}

function saveWechatAccounts(filePath, accounts) {
  fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

function scrubForList(row) {
  return {
    uin: row.account ? row.account.uin : null,
    dbPath: row.dbPath || null,
    hasWechatDataPath: !!row.wechatDataPath,
    chosenKeyProvider: row.chosenKeyProvider || null,
    registeredAt: row.registeredAt || null,
    lastSyncAt: row.lastSyncAt || null,
  };
}

module.exports = {
  loadWechatAccounts,
  saveWechatAccounts,
  scrubForList,
};
