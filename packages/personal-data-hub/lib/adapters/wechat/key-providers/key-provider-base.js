/**
 * Phase 12.6 — KeyProvider interface contract.
 *
 * The wechat-adapter is key-source agnostic: it only knows about an
 * object with `getKey()` returning a Promise<string> (32-hex SQLCipher
 * key for v0.5 7-char prefix, or full 64-hex for Frida hot path).
 *
 * Two implementations:
 *   - MD5KeyProvider (v0.5, frida-INDEPENDENT) — derives MD5(IMEI+UIN)[:7]
 *     from on-disk WeChat data dir. Works for WeChat < 8.0.x.
 *   - FridaKeyProvider (v1, frida-DEPENDENT)  — attaches frida to live
 *     WeChat process and hooks sqlite3_key. Works for WeChat 8.0+.
 *
 * Both expose the same getKey() shape so wechat-adapter.js does not
 * branch on version.
 */
"use strict";

class KeyProvider {
  /**
   * Return the SQLCipher key (lowercase hex). Throw on failure.
   *
   * Optional opts (per design §18.2):
   *   - wxid : string  WeChat user identifier (some providers need this)
   *   - dbPath : string path to the SQLCipher DB being opened
   *
   * @param {{wxid?: string, dbPath?: string}} [_opts]
   * @returns {Promise<string>}
   */
  // eslint-disable-next-line no-unused-vars
  async getKey(_opts) {
    throw new Error("KeyProvider.getKey: must be overridden by subclass");
  }

  /**
   * Provider name for telemetry / error attribution. Subclasses
   * override.
   */
  get name() {
    return "key-provider-base";
  }
}

module.exports = { KeyProvider };
