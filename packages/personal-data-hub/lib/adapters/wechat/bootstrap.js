/**
 * Phase 12.6.7 — WeChat adapter bootstrap helper.
 *
 * Glues env-probe (12.6.4) → KeyProvider choice (12.6.1) → WechatAdapter
 * instantiation (12.6.5) into one entry point so the IPC / WS / CLI
 * layers don't each have to recreate the wiring.
 *
 * Decision matrix (mirrors `env-probe.decide`):
 *   - probe.suggestedKeyProvider === "md5"   → MD5KeyProvider
 *   - probe.suggestedKeyProvider === "frida" → FridaKeyProvider
 *   - probe.suggestedKeyProvider === "unsupported" → no adapter created;
 *     caller gets `{ ok: false, probe, reason }` and is expected to surface
 *     `probe.reasons[]` to the user.
 *
 * Caller may force a specific provider via `opts.keyProviderOverride`
 * (e.g. `"md5"` on a real device that env-probe misclassified, useful for
 * the rare 8.0+ install where the user has the MD5 path working). The
 * override skips the suggestion but the probe still runs and is returned
 * for transparency.
 *
 * Returns shape (also see __tests__/adapters/wechat-bootstrap.test.js):
 *
 *   { ok: true,  adapter, keyProvider, probe }
 *   { ok: false, reason: "ENV_UNSUPPORTED" | "MD5_NEEDS_WECHAT_DATA_PATH"
 *                       | "FRIDA_NEEDS_WXID" | "ADAPTER_CTOR_FAILED",
 *     probe, message? }
 *
 * Test seams:
 *   - opts._probe          inject pre-computed probe (skip exec)
 *   - opts._md5Provider    inject pre-built MD5KeyProvider instance
 *   - opts._fridaProvider  inject pre-built FridaKeyProvider instance
 *   - opts._WechatAdapter  swap the adapter constructor (default: real)
 */
"use strict";

const { WechatAdapter } = require("./wechat-adapter");
const { MD5KeyProvider } = require("./key-providers/md5-key-provider");
const { FridaKeyProvider } = require("./key-providers/frida-key-provider");
const { probe: realProbe } = require("./env-probe");

/**
 * @param {object} opts
 * @param {object} opts.account              `{ uin, wxid? }` — adapter sees uin
 * @param {string} [opts.dbPath]             local path to pulled EnMicroMsg.db
 * @param {string} [opts.wechatDataPath]     local pulled /data/data/com.tencent.mm
 *                                            (required when MD5KeyProvider is chosen)
 * @param {object} [opts.fridaOpts]          forwarded to FridaKeyProvider ctor
 *                                            (deviceId / packageName / timeoutMs)
 * @param {string} [opts.keyProviderOverride] "md5" | "frida" — force selection
 * @param {Function} [opts.exec]             exec seam forwarded to env-probe
 * @param {object} [opts._probe]             pre-computed probe (test seam)
 * @param {object} [opts._md5Provider]       (test seam)
 * @param {object} [opts._fridaProvider]     (test seam)
 * @param {Function} [opts._WechatAdapter]   (test seam)
 * @returns {Promise<object>}
 */
async function bootstrapWechatAdapter(opts = {}) {
  if (!opts || typeof opts !== "object") {
    throw new Error("bootstrapWechatAdapter: opts required");
  }
  if (!opts.account || !opts.account.uin) {
    throw new Error("bootstrapWechatAdapter: opts.account.uin required");
  }

  const probe = opts._probe || (await realProbe({ exec: opts.exec }));
  const chosen = opts.keyProviderOverride || probe.suggestedKeyProvider;

  if (chosen === "unsupported") {
    return {
      ok: false,
      reason: "ENV_UNSUPPORTED",
      message: (probe.reasons || []).join("; ") || "env-probe could not pick a viable KeyProvider",
      probe,
    };
  }

  // Pick / build KeyProvider
  let keyProvider;
  if (chosen === "md5") {
    if (opts._md5Provider) {
      keyProvider = opts._md5Provider;
    } else {
      if (!opts.wechatDataPath) {
        return {
          ok: false,
          reason: "MD5_NEEDS_WECHAT_DATA_PATH",
          message: "MD5KeyProvider requires opts.wechatDataPath (pulled /data/data/com.tencent.mm/)",
          probe,
        };
      }
      keyProvider = new MD5KeyProvider({
        wechatDataPath: opts.wechatDataPath,
        uin: opts.account.uin,
      });
    }
  } else if (chosen === "frida") {
    if (opts._fridaProvider) {
      keyProvider = opts._fridaProvider;
    } else {
      // FridaKeyProvider doesn't strictly need wxid, but we surface a
      // clear error here when the wire-level account looks incomplete.
      if (!opts.account.uin) {
        return {
          ok: false,
          reason: "FRIDA_NEEDS_WXID",
          message: "FridaKeyProvider expects opts.account.uin for downstream adapter wiring",
          probe,
        };
      }
      keyProvider = new FridaKeyProvider({
        deviceId: (opts.fridaOpts && opts.fridaOpts.deviceId) || probe.device.serial || null,
        packageName: (opts.fridaOpts && opts.fridaOpts.packageName) || "com.tencent.mm",
        timeoutMs: (opts.fridaOpts && opts.fridaOpts.timeoutMs) || 30_000,
      });
    }
  } else {
    return {
      ok: false,
      reason: "UNKNOWN_KEY_PROVIDER",
      message: `Unknown keyProvider "${chosen}"`,
      probe,
    };
  }

  // Instantiate adapter
  const AdapterCtor = opts._WechatAdapter || WechatAdapter;
  let adapter;
  try {
    adapter = new AdapterCtor({
      account: opts.account,
      dbPath: opts.dbPath || null,
      keyProvider,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "ADAPTER_CTOR_FAILED",
      message: err && err.message ? err.message : String(err),
      probe,
    };
  }

  return { ok: true, adapter, keyProvider, probe };
}

module.exports = { bootstrapWechatAdapter };
