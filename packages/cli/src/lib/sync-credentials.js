/**
 * CLI sync provider credentials store — Phase 3c follow-up.
 *
 * Electron 的 `safeStorage` 在 CLI 没法用，所以这里搭一个 file-based equivalent:
 *
 *   - Master key 自动生成 (32 字节 random) 落 `~/.chainlesschain/sync-credentials.key`
 *     文件 mode 0600 (Unix) / NTFS ACL (Win — fs.chmodSync 容错)
 *   - 凭据 JSON 编 AES-256-GCM (iv 12B + auth tag 16B)
 *     落 `~/.chainlesschain/sync-credentials.enc`
 *   - SENSITIVE_FIELDS 镜像 desktop secure-config-storage.js 用于 sanitize
 *
 * 与 desktop sync-credentials.js 同 surface：
 *   getCredentials / setCredentials / clearCredentials / hasCredentials /
 *   getCredentialsSanitized / ALLOWED_PROVIDER_IDS
 *
 * 威胁模型：root/admin 能读 master key 文件即破，是 CLI 工具合理 baseline
 * （同 git ~/.netrc / ~/.aws/credentials）。OS keyring 强加密留 v0.2。
 */

"use strict";

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const SENSITIVE_FIELDS = ["sync.webdav.password", "sync.oss.secretAccessKey"];
const ALLOWED_PROVIDER_IDS = ["webdav", "oss"];
const MASK = "********";
const AES_ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let _ccDirOverride = null;

function _ccDir() {
  if (_ccDirOverride) return _ccDirOverride;
  return (
    process.env.CHAINLESSCHAIN_HOME ||
    path.join(os.homedir(), ".chainlesschain")
  );
}

function _keyPath() {
  return path.join(_ccDir(), "sync-credentials.key");
}

function _vaultPath() {
  return path.join(_ccDir(), "sync-credentials.enc");
}

function _ensureDir() {
  const dir = _ccDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _loadOrCreateMasterKey() {
  _ensureDir();
  const kp = _keyPath();
  if (fs.existsSync(kp)) {
    const buf = fs.readFileSync(kp);
    if (buf.length !== KEY_LEN) {
      throw new Error(
        `sync-credentials: master key file ${kp} has wrong length ` +
          `(${buf.length} bytes, expected ${KEY_LEN}). Delete + regenerate manually if intentional.`,
      );
    }
    return buf;
  }
  const key = crypto.randomBytes(KEY_LEN);
  fs.writeFileSync(kp, key);
  try {
    fs.chmodSync(kp, 0o600);
  } catch (_e) {
    /* non-fatal: NTFS / older fs */
  }
  return key;
}

function _encryptBlob(plainJson) {
  const key = _loadOrCreateMasterKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(AES_ALG, key, iv);
  const enc = Buffer.concat([
    cipher.update(plainJson, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // file layout: [iv (12)] [tag (16)] [ciphertext]
  return Buffer.concat([iv, tag, enc]);
}

function _decryptBlob(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("sync-credentials: enc file too small or invalid");
  }
  const key = _loadOrCreateMasterKey();
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(AES_ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf-8",
  );
}

function loadAll() {
  const vp = _vaultPath();
  if (!fs.existsSync(vp)) return {};
  const buf = fs.readFileSync(vp);
  try {
    return JSON.parse(_decryptBlob(buf));
  } catch (err) {
    throw new Error(
      `sync-credentials: decrypt failed (${err?.message}). ` +
        `Vault may be corrupted or master key changed. ` +
        `Remove ${vp} + reconfigure to recover.`,
    );
  }
}

function saveAll(all) {
  _ensureDir();
  fs.writeFileSync(_vaultPath(), _encryptBlob(JSON.stringify(all)));
  return true;
}

function assertProviderId(providerId) {
  if (!ALLOWED_PROVIDER_IDS.includes(providerId)) {
    throw new Error(
      `sync-credentials: unknown provider id '${providerId}' ` +
        `(allowed: ${ALLOWED_PROVIDER_IDS.join(", ")})`,
    );
  }
}

function sanitize(all) {
  if (!all || typeof all !== "object") return all;
  const clone = JSON.parse(JSON.stringify(all));
  for (const dotPath of SENSITIVE_FIELDS) {
    const parts = dotPath.split(".");
    let cur = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur && typeof cur === "object" && parts[i] in cur) {
        cur = cur[parts[i]];
      } else {
        cur = null;
        break;
      }
    }
    const last = parts[parts.length - 1];
    if (
      cur &&
      typeof cur === "object" &&
      cur[last] != null &&
      cur[last] !== ""
    ) {
      cur[last] = MASK;
    }
  }
  return clone;
}

function getCredentials(providerId) {
  assertProviderId(providerId);
  return loadAll()?.sync?.[providerId] ?? {};
}

function getCredentialsSanitized(providerId) {
  assertProviderId(providerId);
  return sanitize(loadAll())?.sync?.[providerId] ?? {};
}

function hasCredentials(providerId) {
  return Object.values(getCredentials(providerId)).some(
    (v) => v !== null && v !== undefined && v !== "",
  );
}

function setCredentials(providerId, creds) {
  assertProviderId(providerId);
  if (!creds || typeof creds !== "object") {
    throw new Error("sync-credentials: creds must be an object");
  }
  const all = loadAll();
  if (!all.sync || typeof all.sync !== "object") all.sync = {};
  all.sync[providerId] = { ...creds };
  return saveAll(all);
}

function clearCredentials(providerId) {
  assertProviderId(providerId);
  const all = loadAll();
  if (all?.sync?.[providerId]) {
    delete all.sync[providerId];
    return saveAll(all);
  }
  return true;
}

/** Test seam: override the resolved chainlesschain dir without env leak. */
function _setCcDirForTest(dir) {
  _ccDirOverride = dir;
}

function _resetCcDirForTest() {
  _ccDirOverride = null;
}

export {
  ALLOWED_PROVIDER_IDS,
  SENSITIVE_FIELDS,
  MASK,
  getCredentials,
  getCredentialsSanitized,
  hasCredentials,
  setCredentials,
  clearCredentials,
  _setCcDirForTest,
  _resetCcDirForTest,
  _keyPath,
  _vaultPath,
};
