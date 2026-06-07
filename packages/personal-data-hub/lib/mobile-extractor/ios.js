/**
 * Phase 7.5 — iOS iTunes backup reader.
 *
 * Reads an iTunes-format backup directory and:
 *   - parses `Manifest.db` (a SQLite catalog of all files)
 *   - resolves Domain → file mappings (HomeDomain, AppDomainGroup-...)
 *   - extracts named files / app data to a flat dir structure
 *
 * Phase 7.5b adds ENCRYPTED backup support (iOS 10.2+): supply
 * `opts.password` and the reader parses the BackupKeyBag, derives the
 * backup key (PBKDF2), unwraps the class keys (RFC 3394), decrypts
 * Manifest.db, and transparently decrypts each file on copyOut. Without a
 * password an encrypted backup still throws a clear error. Crypto lives
 * in ./ios-backup-crypto.js; the per-file key blob is read from each
 * row's NSKeyedArchiver `file` column via ./bplist.js.
 *
 * Inject `dbDriverFn` for tests to bypass better-sqlite3-multiple-ciphers
 * (the same package the LocalVault already uses, no new dep).
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  parseKeybag,
  deriveBackupKey,
  aesUnwrap,
  unwrapClassKeys,
  unwrapEncryptionKey,
  decryptCBC,
} = require("./ios-backup-crypto");
const { parseBplist, unwrapNSKeyedArchiver } = require("./bplist");

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
    this._password = opts.password != null ? opts.password : null;
    this._encrypted = false;
    this._classKeys = null; // populated for encrypted backups
    this._manifest = null;
    this._info = null;
    this._tmpManifestPath = null;
  }

  /**
   * Lazy-init: parses Info.plist / Manifest.plist + opens Manifest.db.
   * For encrypted backups, decrypts Manifest.db first (needs opts.password).
   */
  async open() {
    const manifestPlistPath = path.join(this._backupDir, "Manifest.plist");
    if (!fs.existsSync(manifestPlistPath)) {
      throw new Error(`iOSBackupReader: Manifest.plist missing — not an iTunes backup directory`);
    }
    const manifestPlist = fs.readFileSync(manifestPlistPath, "utf-8");
    // Plist is XML — look for <key>IsEncrypted</key><true/>
    this._encrypted = /<key>IsEncrypted<\/key>\s*<true\/>/.test(manifestPlist);

    const infoPlistPath = path.join(this._backupDir, "Info.plist");
    if (fs.existsSync(infoPlistPath)) {
      this._info = this._parseInfoPlist(fs.readFileSync(infoPlistPath, "utf-8"));
    }

    const encryptedDbPath = path.join(this._backupDir, "Manifest.db");
    if (!fs.existsSync(encryptedDbPath)) {
      throw new Error(`iOSBackupReader: Manifest.db missing at ${encryptedDbPath}`);
    }

    // For encrypted backups, decrypt Manifest.db to a temp file and open
    // that. Class keys are retained for transparent per-file decryption.
    let manifestDbPath = encryptedDbPath;
    if (this._encrypted) {
      manifestDbPath = this._prepareEncryptedManifest(manifestPlist, encryptedDbPath);
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
    return { encrypted: this._encrypted, info: this._info };
  }

  /**
   * Decrypt Manifest.db for an encrypted backup, returning the path to a
   * temp file holding the plaintext SQLite. Parses the BackupKeyBag,
   * derives the backup key from opts.password, unwraps the class keys, and
   * unwraps the ManifestKey. Retains class keys for per-file decryption.
   */
  _prepareEncryptedManifest(manifestPlist, encryptedDbPath) {
    if (this._password == null) {
      throw new Error(
        "iOSBackupReader: encrypted backup requires opts.password (the iTunes/Finder backup password)",
      );
    }
    const keybagB64 = extractPlistData(manifestPlist, "BackupKeyBag");
    const manifestKeyB64 = extractPlistData(manifestPlist, "ManifestKey");
    if (!keybagB64) throw new Error("iOSBackupReader: Manifest.plist missing BackupKeyBag");
    if (!manifestKeyB64) throw new Error("iOSBackupReader: Manifest.plist missing ManifestKey");

    const { attrs, classKeys } = parseKeybag(Buffer.from(keybagB64, "base64"));
    const backupKey = deriveBackupKey(this._password, attrs);
    this._classKeys = unwrapClassKeys(classKeys, backupKey);

    const manifestKey = unwrapEncryptionKey(this._classKeys, Buffer.from(manifestKeyB64, "base64"));
    const cipher = fs.readFileSync(encryptedDbPath);
    const plain = decryptCBC(manifestKey, cipher);

    const tmp = path.join(
      os.tmpdir(),
      `pdh-ios-manifest-${process.pid}-${crypto.randomBytes(6).toString("hex")}.db`,
    );
    fs.writeFileSync(tmp, plain);
    this._tmpManifestPath = tmp;
    return tmp;
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
   * Copy a file from the backup to a local path. For encrypted backups the
   * file is decrypted in flight (per-file key unwrapped from its
   * NSKeyedArchiver `file` blob). Returns the local path.
   */
  copyOut(fileID, localPath) {
    const src = this.resolveFileOnDisk(fileID);
    if (!src || !fs.existsSync(src)) {
      throw new Error(`iOSBackupReader: file ${fileID} not found on disk at ${src}`);
    }
    fs.mkdirSync(path.dirname(localPath), { recursive: true });

    if (this._encrypted) {
      const meta = this._fileMeta(fileID);
      if (meta && meta.encryptionKey) {
        // EncryptionKey NSData = 4-byte length marker + wrapped key; the
        // protection class is a separate field (unlike ManifestKey).
        const ck = this._classKeys[meta.protectionClass];
        if (!ck || !ck.KEY) {
          throw new Error(
            `iOSBackupReader: no class key for protection class ${meta.protectionClass} (file ${fileID})`,
          );
        }
        const fileKey = aesUnwrap(ck.KEY, meta.encryptionKey.subarray(4));
        const plain = decryptCBC(fileKey, fs.readFileSync(src), meta.size);
        fs.writeFileSync(localPath, plain);
        return localPath;
      }
      // No per-file key → file stored unencrypted (rare); fall through.
    }

    fs.copyFileSync(src, localPath);
    return localPath;
  }

  /**
   * Read + decode a file's NSKeyedArchiver `file` blob from Manifest.db,
   * returning { protectionClass, encryptionKey:Buffer|null, size }.
   * Returns null when the row or blob is unavailable.
   */
  _fileMeta(fileID) {
    if (!this._db) throw new Error("iOSBackupReader: call open() first");
    const row = this._db.prepare("SELECT file FROM Files WHERE fileID = ?").get(fileID);
    if (!row || !row.file) return null;
    const blob = Buffer.isBuffer(row.file) ? row.file : Buffer.from(row.file);
    const obj = unwrapNSKeyedArchiver(parseBplist(blob));
    let encryptionKey = obj.EncryptionKey;
    // NSData unwraps to { "NS.data": Buffer }; raw Buffer is also accepted.
    if (encryptionKey && !Buffer.isBuffer(encryptionKey) && Buffer.isBuffer(encryptionKey["NS.data"])) {
      encryptionKey = encryptionKey["NS.data"];
    }
    if (!Buffer.isBuffer(encryptionKey)) encryptionKey = null;
    return {
      protectionClass: obj.ProtectionClass,
      encryptionKey,
      size: typeof obj.Size === "number" ? obj.Size : undefined,
    };
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
    if (this._tmpManifestPath) {
      try { fs.rmSync(this._tmpManifestPath, { force: true }); } catch (_e) {}
      this._tmpManifestPath = null;
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

/**
 * Pull a base64 `<data>` value out of an XML plist by key. Returns the
 * whitespace-stripped base64 string, or null when absent.
 */
function extractPlistData(plistText, key) {
  const re = new RegExp(`<key>${key}</key>\\s*<data>([\\s\\S]*?)</data>`, "i");
  const m = plistText.match(re);
  if (!m) return null;
  return m[1].replace(/\s+/g, "");
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
