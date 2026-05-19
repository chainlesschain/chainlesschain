/**
 * Phase 6 — Alipay 加密 ZIP 解压器
 *
 * 支付宝官方导出的 `alipay_record_*.zip` 用 ZipCrypto（传统 PKZIP 密码），
 * 默认密码 = 用户身份证后 6 位。adm-zip 0.5+ 内置 ZipCrypto 解密。
 *
 * 使用：
 *   const { extractCsvFromZip } = require('./zip-decryptor');
 *   const csvBuf = await extractCsvFromZip(zipPath, { password: "123456" });
 *   // csvBuf 是 Buffer，再交给 parseAlipayCsvBuffer
 *
 * 失败模式：
 *   - 文件不存在 → throws { code: "ENOENT" }
 *   - 不是 ZIP → throws "not a valid zip"
 *   - 密码错误 → throws "Wrong Password" (adm-zip 自带错误消息)
 *   - ZIP 内没有 .csv → throws "no CSV file in ZIP"
 *
 * 全部 throws 是因为这个层只做"打开 + 解压"动作，错误分类放到 adapter
 * authenticate / sync 路径处理（统一映射到 PersonalDataAdapter 协议）。
 */

"use strict";

const fs = require("node:fs");

/**
 * Extract the first .csv file from an Alipay ZIP. Returns its raw Buffer.
 *
 * @param {string} zipPath
 * @param {object} [opts]
 * @param {string} [opts.password]
 * @param {Function} [opts.admZipImpl]   DI seam: a constructor function with
 *                                       the adm-zip API (new AdmZip(path)).
 *                                       Defaults to `require("adm-zip")`.
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function extractCsvFromZip(zipPath, opts = {}) {
  if (typeof zipPath !== "string" || zipPath.length === 0) {
    throw new Error("extractCsvFromZip: zipPath required");
  }
  // Surface ENOENT cleanly
  if (!fs.existsSync(zipPath)) {
    const err = new Error(`ZIP file not found: ${zipPath}`);
    err.code = "ENOENT";
    throw err;
  }

  const AdmZip = typeof opts.admZipImpl === "function"
    ? opts.admZipImpl
    : loadAdmZip();

  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (err) {
    throw new Error(
      `Failed to open ZIP: ${err && err.message ? err.message : err}`,
    );
  }

  const entries = zip.getEntries();
  const csvEntry = entries.find((e) => /\.csv$/i.test(e.entryName));
  if (!csvEntry) {
    throw new Error(
      `No CSV file in ZIP; found: ${entries.map((e) => e.entryName).join(", ") || "(empty)"}`,
    );
  }

  // adm-zip's password-aware extract: `readFile(entry, password)`.
  // For unencrypted ZIPs the password is ignored.
  let csvBuffer;
  try {
    csvBuffer = zip.readFile(csvEntry, opts.password || "");
  } catch (err) {
    // adm-zip throws strings sometimes; wrap.
    const msg = err && err.message ? err.message : String(err);
    if (/password/i.test(msg) || /wrong/i.test(msg)) {
      const e = new Error(`ZIP password incorrect or missing`);
      e.code = "ZIP_PASSWORD_FAILED";
      throw e;
    }
    throw new Error(`ZIP extract failed: ${msg}`);
  }

  if (!Buffer.isBuffer(csvBuffer) || csvBuffer.length === 0) {
    // adm-zip returns null on password failure in some versions
    const e = new Error("ZIP password incorrect (empty buffer returned)");
    e.code = "ZIP_PASSWORD_FAILED";
    throw e;
  }

  return { buffer: csvBuffer, filename: csvEntry.entryName };
}

let _admZipCache = null;
function loadAdmZip() {
  if (_admZipCache) return _admZipCache;
  try {
    // eslint-disable-next-line global-require
    _admZipCache = require("adm-zip");
  } catch (err) {
    throw new Error(
      `adm-zip not installed — Phase 6 needs it. ${err && err.message ? err.message : err}`,
    );
  }
  return _admZipCache;
}

module.exports = {
  extractCsvFromZip,
};
