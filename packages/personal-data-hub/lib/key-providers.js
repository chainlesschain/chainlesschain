/**
 * Master-key storage providers.
 *
 * The vault doesn't care WHERE the master key lives — just that something
 * implements get(name) / set(name, key) / del(name) for hex-encoded 32-byte
 * keys. This package ships two providers for dev / testing:
 *
 *   - InMemoryKeyProvider — RAM only, lost on process exit (tests)
 *   - FileKeyProvider     — stores hex blobs under <dir>/<name>.key with
 *                            0600 perms (single-user dev box, or fallback
 *                            when no platform keystore is available)
 *
 * Production integrations live OUTSIDE this package and conform to the
 * KeyProvider interface:
 *   - Windows DPAPI                (electron main process, win)
 *   - macOS Keychain               (electron main process, mac)
 *   - Linux libsecret              (electron main process, linux)
 *   - Android Keystore (TEE/StrongBox) (Android app, native bridge)
 *   - iOS Keychain                 (iOS app, native bridge)
 *
 * Plus an optional U-Key / SIMKey second-layer wrap (out of scope here).
 *
 * KeyProvider contract:
 *   get(name: string): Promise<string|null>   // hex or null if missing
 *   set(name: string, hexKey: string): Promise<void>
 *   del(name: string): Promise<void>
 *   has(name: string): Promise<boolean>
 *
 * Key naming convention recommended:
 *   "vault:<vault-id>"      master key for a vault
 *   "vault:<vault-id>:prev" pre-rotation key, kept for emergency recovery
 *   "adapter:<name>:cookie" per-adapter cookie blobs (later phases)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const KEY_HEX_LEN = 64; // 32 bytes = 64 hex chars

function isValidKeyHex(hex) {
  return typeof hex === "string" && hex.length === KEY_HEX_LEN && /^[0-9a-fA-F]+$/.test(hex);
}

/** Generate a fresh random 32-byte master key, returned hex-encoded. */
function generateKeyHex() {
  return crypto.randomBytes(32).toString("hex");
}

// ─── InMemoryKeyProvider ─────────────────────────────────────────────────

class InMemoryKeyProvider {
  constructor() {
    this._keys = new Map();
  }
  async get(name) {
    return this._keys.has(name) ? this._keys.get(name) : null;
  }
  async set(name, hex) {
    if (!isValidKeyHex(hex)) {
      throw new Error("InMemoryKeyProvider.set: hex must be 64 lowercase/uppercase hex chars");
    }
    this._keys.set(name, hex);
  }
  async del(name) {
    this._keys.delete(name);
  }
  async has(name) {
    return this._keys.has(name);
  }
}

// ─── FileKeyProvider ─────────────────────────────────────────────────────

/**
 * Stores each key as a separate file at <dir>/<safe-name>.key with 0600
 * permissions. POSIX-only protection; on Windows the perms request becomes
 * a no-op (Windows file ACLs aren't expressible via POSIX mode bits without
 * additional libraries). This is FINE for dev / tests — production setups
 * should plug in DPAPI/Keychain via a custom KeyProvider.
 *
 * Name sanitization: any char outside [A-Za-z0-9_.-] is replaced with "_"
 * to keep the filesystem happy. Colons in canonical names ("vault:abc")
 * become underscores ("vault_abc.key"). Originally-distinct names that
 * collide after sanitization will overwrite each other — callers should
 * avoid collisions or use a different provider.
 */
class FileKeyProvider {
  constructor(dir) {
    if (typeof dir !== "string" || dir.length === 0) {
      throw new Error("FileKeyProvider: dir must be a non-empty path");
    }
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _pathFor(name) {
    const safe = String(name).replace(/[^A-Za-z0-9_.-]/g, "_");
    return path.join(this.dir, safe + ".key");
  }

  async get(name) {
    const p = this._pathFor(name);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p, "utf8").trim();
    if (!isValidKeyHex(buf)) {
      // Stored file corrupt — fail loudly instead of silently returning null
      // so the user knows their vault key is gone and can act.
      throw new Error(`FileKeyProvider: stored key at ${p} is not valid hex`);
    }
    return buf;
  }

  async set(name, hex) {
    if (!isValidKeyHex(hex)) {
      throw new Error("FileKeyProvider.set: hex must be 64 hex chars (32 bytes)");
    }
    const p = this._pathFor(name);
    // mode 0600: rw for owner only. On Windows this is ignored by Node.
    fs.writeFileSync(p, hex, { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(p, 0o600);
    } catch (_err) {
      // Windows — fs.chmod silently ignores most mode bits. Not fatal.
    }
  }

  async del(name) {
    const p = this._pathFor(name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  async has(name) {
    return fs.existsSync(this._pathFor(name));
  }
}

module.exports = {
  KEY_HEX_LEN,
  isValidKeyHex,
  generateKeyHex,
  InMemoryKeyProvider,
  FileKeyProvider,
};
