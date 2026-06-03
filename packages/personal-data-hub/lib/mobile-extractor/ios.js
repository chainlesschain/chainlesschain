/**
 * Phase 7.5 — iOS iTunes backup reader.
 *
 * Reads an unencrypted iTunes-format backup directory and:
 *   - parses `Manifest.db` (a SQLite catalog of all files)
 *   - resolves Domain → file mappings (HomeDomain, AppDomainGroup-...)
 *   - extracts named files / app data to a flat dir structure
 *
 * Encrypted backup (iOS 10.2+) support is stubbed — actual PBKDF2 +
 * AES decryption needs a few hundred LOC and we ship that as Phase 7.5b
 * once we have a real backup to test against. Current encrypted path
 * throws with a clear "not yet supported" message.
 *
 * Inject `dbDriverFn` for tests to bypass better-sqlite3-multiple-ciphers
 * (the same package the LocalVault already uses, no new dep).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

class iOSBackupReader {
  constructor(opts = {}) {
    if (!opts.backupDir || typeof opts.backupDir !== "string") {
      throw new Error("iOSBackupReader: opts.backupDir required");
    }
    if (!fs.existsSync(opts.backupDir)) {
      throw new Error(`iOSBackupReader: backupDir does not exist: ${opts.backupDir}`);
    }
    this._backupDir = opts.backupDir;
    this._dbDriver = opts.dbDriverFn || null; // test seam
    this._encrypted = false;
    this._manifest = null;
    this._info = null;
  }

  /**
   * Lazy-init: parses Info.plist / Manifest.plist + opens Manifest.db.
   * Throws if backup is encrypted (Phase 7.5b will add decryption).
   */
  async open() {
    const manifestPlistPath = path.join(this._backupDir, "Manifest.plist");
    if (!fs.existsSync(manifestPlistPath)) {
      throw new Error(`iOSBackupReader: Manifest.plist missing — not an iTunes backup directory`);
    }
    const manifestPlist = fs.readFileSync(manifestPlistPath, "utf-8");
    // Plist is XML — look for <key>IsEncrypted</key><true/>
    this._encrypted = /<key>IsEncrypted<\/key>\s*<true\/>/.test(manifestPlist);
    if (this._encrypted) {
      throw new Error(
        "iOSBackupReader: encrypted backups not supported in Phase 7.5 v0 — Phase 7.5b will add PBKDF2 decryption",
      );
    }

    const infoPlistPath = path.join(this._backupDir, "Info.plist");
    if (fs.existsSync(infoPlistPath)) {
      this._info = this._parseInfoPlist(fs.readFileSync(infoPlistPath, "utf-8"));
    }

    const manifestDbPath = path.join(this._backupDir, "Manifest.db");
    if (!fs.existsSync(manifestDbPath)) {
      throw new Error(`iOSBackupReader: Manifest.db missing at ${manifestDbPath}`);
    }
    // dbDriverFn (test seam) can be either a constructor OR a factory
    // function that returns an instance directly. Production case is a
    // constructor (better-sqlite3-multiple-ciphers). Detect by trying
    // factory call first.
    if (this._dbDriver) {
      try {
        const maybe = this._dbDriver(manifestDbPath, { readonly: true });
        if (maybe && typeof maybe.prepare === "function") {
          this._db = maybe;
        } else {
          // Treat as constructor
          this._db = new this._dbDriver(manifestDbPath, { readonly: true });
        }
      } catch (_e) {
        this._db = new this._dbDriver(manifestDbPath, { readonly: true });
      }
    } else {
      const Database = loadSqliteDriver();
      this._db = new Database(manifestDbPath, { readonly: true });
    }
    this._manifest = manifestDbPath;
    return { encrypted: false, info: this._info };
  }

  /**
   * Get device info from the backup (model, iOS version, name, last
   * backup date, etc.). Returns null when not parseable.
   */
  info() {
    return this._info;
  }

  /**
   * List all files in the backup matching the given domain (e.g.
   * "HomeDomain", "AppDomainGroup-com.tencent.xin"). Returns
   * [{ fileID, domain, relativePath, flags, fileLen }, ...].
   */
  listFiles(opts = {}) {
    if (!this._db) throw new Error("iOSBackupReader: call open() first");
    let sql = "SELECT fileID, domain, relativePath, flags FROM Files";
    const params = [];
    const where = [];
    if (opts.domain) {
      where.push("domain = ?");
      params.push(opts.domain);
    }
    if (opts.domainLike) {
      where.push("domain LIKE ?");
      params.push(`%${opts.domainLike}%`);
    }
    if (opts.relativePathLike) {
      where.push("relativePath LIKE ?");
      params.push(`%${opts.relativePathLike}%`);
    }
    if (opts.flags !== undefined) {
      where.push("flags = ?");
      params.push(opts.flags);
    }
    if (where.length > 0) sql += " WHERE " + where.join(" AND ");
    sql += ` LIMIT ${Number.isFinite(opts.limit) ? Math.min(opts.limit, 100000) : 10000}`;
    return this._db.prepare(sql).all(...params);
  }

  /**
   * Resolve a file's physical path on disk. iTunes backups store each
   * file by SHA-1 of `domain-relativePath`, sharded into 2-char prefix
   * subdirectories.
   */
  resolveFileOnDisk(fileID) {
    if (!fileID || fileID.length < 2) return null;
    const prefix = fileID.slice(0, 2);
    return path.join(this._backupDir, prefix, fileID);
  }

  /**
   * Copy a file from the backup to a local path. Returns the local path.
   */
  copyOut(fileID, localPath) {
    const src = this.resolveFileOnDisk(fileID);
    if (!src || !fs.existsSync(src)) {
      throw new Error(`iOSBackupReader: file ${fileID} not found on disk at ${src}`);
    }
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.copyFileSync(src, localPath);
    return localPath;
  }

  /**
   * Pull all files under a given Domain into a local directory tree,
   * preserving relativePath. Returns
   * { copied: N, skipped: M, errors: [{file, err}] }.
   */
  pullDomain(domain, localDir) {
    if (!domain || !localDir) throw new Error("pullDomain: domain + localDir required");
    fs.mkdirSync(localDir, { recursive: true });
    const files = this.listFiles({ domain, limit: 100_000 });
    const summary = { copied: 0, skipped: 0, errors: [] };
    for (const f of files) {
      if (!f.relativePath) {
        summary.skipped += 1;
        continue;
      }
      const dest = path.join(localDir, f.relativePath);
      try {
        this.copyOut(f.fileID, dest);
        summary.copied += 1;
      } catch (err) {
        summary.errors.push({ file: f.relativePath, err: err.message });
      }
    }
    return summary;
  }

  close() {
    if (this._db) {
      try { this._db.close(); } catch (_e) {}
      this._db = null;
    }
  }

  // ─── internals ────────────────────────────────────────────────────

  _parseInfoPlist(text) {
    const out = {};
    // Light XML-plist parser — only pulls <key>...</key> followed by
    // <string>..</string> / <date>..</date> / <integer>..</integer>.
    const re = /<key>([^<]+)<\/key>\s*<(string|date|integer|true|false)\/?>([^<]*)<\/\2>?/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const key = m[1];
      const kind = m[2];
      const val = m[3];
      if (kind === "true") out[key] = true;
      else if (kind === "false") out[key] = false;
      else if (kind === "integer") out[key] = parseInt(val, 10);
      else out[key] = val;
    }
    // Quick boolean: <key>X</key><true/>
    const re2 = /<key>([^<]+)<\/key>\s*<true\/>/g;
    while ((m = re2.exec(text)) !== null) out[m[1]] = true;
    return out;
  }
}

let _sqliteCache = null;
function loadSqliteDriver() {
  if (_sqliteCache) return _sqliteCache;
  try {
    // Reuse the vault's existing SQLite driver — works on plaintext too
    _sqliteCache = require("better-sqlite3-multiple-ciphers");
  } catch (err) {
    throw new Error(
      `iOSBackupReader: better-sqlite3-multiple-ciphers required: ${err && err.message ? err.message : err}`,
    );
  }
  return _sqliteCache;
}

module.exports = { iOSBackupReader };
