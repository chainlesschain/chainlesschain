"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspectWhatsAppBackupFile } = require("./backup-decryptor");

const PERSONAL_DIRS = Object.freeze([
  "/sdcard/Android/media/com.whatsapp/WhatsApp/Databases",
  "/sdcard/WhatsApp/Databases",
]);
const BUSINESS_DIRS = Object.freeze([
  "/sdcard/Android/media/com.whatsapp.w4b/WhatsApp Business/Databases",
  "/sdcard/WhatsApp Business/Databases",
]);
const BACKUP_NAMES = Object.freeze([
  "msgstore.db.crypt15",
  "msgstore.db.crypt14",
]);
const SAFE_BACKUP_NAME = /^msgstore(?:-\d{4}-\d{2}-\d{2}(?:\.\d+)?)?\.db\.crypt(?:14|15)$/;

class WhatsAppAdbError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "WhatsAppAdbError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new WhatsAppAdbError(code, message, cause);
}

function allowedDirs(business) {
  return business ? BUSINESS_DIRS : PERSONAL_DIRS;
}

function validateRequestedRemotePath(remotePath, business) {
  if (typeof remotePath !== "string" || remotePath.length === 0) return null;
  const normalized = path.posix.normalize(remotePath);
  const dirname = path.posix.dirname(normalized);
  const basename = path.posix.basename(normalized);
  if (!allowedDirs(business).includes(dirname) || !SAFE_BACKUP_NAME.test(basename)) {
    fail(
      "WHATSAPP_ADB_UNSAFE_REMOTE_PATH",
      "remotePath must be a WhatsApp msgstore backup inside an allowed public Databases directory",
    );
  }
  return normalized;
}

async function remoteFileExists(adb, serial, remotePath) {
  try {
    // Use one validated shell command so WhatsApp Business paths containing a
    // space survive adb's remote-shell argument joining.
    await adb(["shell", `test -f '${remotePath}'`], { serial });
    return true;
  } catch (_error) {
    return false;
  }
}

async function findBackup(adb, serial, params) {
  const requested = validateRequestedRemotePath(params.remotePath, params.business === true);
  if (requested) {
    if (await remoteFileExists(adb, serial, requested)) return requested;
    fail("WHATSAPP_ADB_BACKUP_NOT_FOUND", `WhatsApp backup not found: ${requested}`);
  }

  for (const dir of allowedDirs(params.business === true)) {
    for (const name of BACKUP_NAMES) {
      const candidate = `${dir}/${name}`;
      if (await remoteFileExists(adb, serial, candidate)) return candidate;
    }
  }
  fail(
    "WHATSAPP_ADB_BACKUP_NOT_FOUND",
    "no msgstore.db.crypt15 or msgstore.db.crypt14 found in WhatsApp public backup directories",
  );
}

/**
 * Desktop/CLI host-adb-bridge extension. It only copies the user's encrypted
 * backup from Android shared storage; decryption remains inside the adapter.
 * The caller owns `tempDir` and must remove it after sync.
 */
function createWhatsAppBackupExtension(opts = {}) {
  const fsImpl = opts.fsImpl || fs;
  const tmpRoot = opts.tmpRoot || os.tmpdir();
  return async function whatsappBackup(params = {}, ctx = {}) {
    if (typeof ctx.adb !== "function" || typeof ctx.pickDevice !== "function") {
      fail("WHATSAPP_ADB_BRIDGE_INVALID", "adb extension requires ctx.adb and ctx.pickDevice");
    }
    const serial = await ctx.pickDevice({ serial: params.serial });
    const remotePath = await findBackup(ctx.adb, serial, params);
    const tempDir = fsImpl.mkdtempSync(path.join(tmpRoot, "cc-pdh-whatsapp-adb-"));
    let localPath = null;
    try {
      fsImpl.chmodSync(tempDir, 0o700);
      localPath = path.join(tempDir, path.posix.basename(remotePath));
      await ctx.adb(["pull", remotePath, localPath], {
        serial,
        timeoutMs: Number.isFinite(params.timeoutMs) ? params.timeoutMs : 300_000,
      });
      const stat = fsImpl.statSync(localPath);
      if (!stat.isFile() || stat.size < 32) {
        fail("WHATSAPP_ADB_BACKUP_EMPTY", "pulled WhatsApp backup is empty or truncated");
      }
      fsImpl.chmodSync(localPath, 0o600);
      const header = inspectWhatsAppBackupFile(localPath);
      return {
        serial,
        remotePath,
        localPath,
        tempDir,
        bytes: stat.size,
        format: header.format,
        cleanup: () => fsImpl.rmSync(tempDir, { recursive: true, force: true }),
      };
    } catch (error) {
      fsImpl.rmSync(tempDir, { recursive: true, force: true });
      if (error instanceof WhatsAppAdbError) throw error;
      fail(
        "WHATSAPP_ADB_PULL_FAILED",
        `failed to pull WhatsApp backup from ${remotePath}: ${error.message}`,
        error,
      );
    }
  };
}

module.exports = {
  createWhatsAppBackupExtension,
  WhatsAppAdbError,
  PERSONAL_DIRS,
  BUSINESS_DIRS,
  BACKUP_NAMES,
  _internal: {
    validateRequestedRemotePath,
    remoteFileExists,
    findBackup,
  },
};
