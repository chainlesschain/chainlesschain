/**
 * Phase 12.6.3 — FridaKeyProvider (v1 hot path).
 *
 * Attaches frida to a live WeChat process (com.tencent.mm) on a rooted
 * Android device, injects the wechat-key-hook agent (see
 * frida-agent/wechat-key-hook.js), waits for the first sqlite3_key
 * onEnter, captures the 32-byte hex key, then detaches.
 *
 * Why detach immediately:
 *   §18.6 anti-detection — minimize injection window so WeChat's
 *   ptrace-tracer / mem-scanner doesn't catch frida-gum sitting in
 *   the process. We hold the script alive only as long as it takes
 *   the user to touch a chat thread (typically 1-3s).
 *
 * Wire to KeyProvider:
 *   getKey() resolves with lowercase 64-char hex on success, or
 *   rejects with one of the typed error codes:
 *     - FRIDA_BINDING_MISSING : opts.frida not provided and require()
 *                               of "frida" failed (binding not installed)
 *     - WECHAT_NOT_RUNNING    : device.attach() threw on package name
 *     - FRIDA_ATTACH_FAILED   : any other attach/createScript error
 *     - HOOK_FAILED           : agent reported error event before key
 *     - WCDB_KEY_TIMEOUT      : no key event within timeoutMs
 *
 * Test seam: opts.frida overrides the lazy require("frida"), so unit
 * tests inject a mock device manager without touching the real binding.
 */
"use strict";

const { KeyProvider } = require("./key-provider-base");
const { loadAgentScript } = require("../frida-agent/loader");

class FridaKeyProvider extends KeyProvider {
  /**
   * @param {object} opts
   * @param {object} [opts.frida]       injected nodejs binding (test seam);
   *                                    if absent, lazy require("frida")
   * @param {string} [opts.deviceId]    Frida device id (USB device default
   *                                    if omitted; "local" for Wear/host)
   * @param {string} [opts.packageName="com.tencent.mm"]
   * @param {number} [opts.timeoutMs=30000]
   * @param {Function} [opts.agentLoader]  test seam: returns agent script
   *                                       text; defaults to loadAgentScript
   * @param {Function} [opts.logger]    optional log({level, ...evt})
   */
  constructor(opts = {}) {
    super();
    if (!opts || typeof opts !== "object") {
      throw new Error("FridaKeyProvider: opts required");
    }
    this._fridaInjected = opts.frida || null;
    this._deviceId = opts.deviceId || null;
    this._packageName = opts.packageName || "com.tencent.mm";
    this._timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : 30_000;
    this._agentLoader = typeof opts.agentLoader === "function"
      ? opts.agentLoader
      : loadAgentScript;
    this._logger = typeof opts.logger === "function" ? opts.logger : null;
    this._lastTelemetry = null;
  }

  get name() {
    return "frida";
  }

  getLastTelemetry() {
    return this._lastTelemetry;
  }

  _log(evt) {
    if (this._logger) {
      try { this._logger(evt); } catch (_e) { /* swallow logger faults */ }
    }
  }

  _loadFrida() {
    if (this._fridaInjected) return this._fridaInjected;
    try {
      // eslint-disable-next-line global-require
      return require("frida");
    } catch (err) {
      const e = new Error(
        "FridaKeyProvider: frida nodejs binding not installed. " +
        "Install with `npm install frida` on the host, or pass opts.frida. " +
        "Underlying error: " + (err && err.message ? err.message : String(err))
      );
      e.code = "FRIDA_BINDING_MISSING";
      throw e;
    }
  }

  async _getDevice(frida) {
    if (this._deviceId) {
      const dev = await frida.getDevice(this._deviceId);
      return dev;
    }
    // No id → first USB device
    if (typeof frida.getUsbDevice === "function") {
      return await frida.getUsbDevice();
    }
    return await frida.getDeviceManager().getUsbDevice();
  }

  /**
   * @returns {Promise<string>} 64-char lowercase hex SQLCipher key
   */
  async getKey(_callOpts) {
    const telemetry = {
      startedAt: Date.now(),
      packageName: this._packageName,
      deviceId: this._deviceId,
      hooked: [],
      errors: [],
      keySource: null,
      durationMs: null,
    };

    const frida = this._loadFrida();
    let device, session, script;

    try {
      device = await this._getDevice(frida);
    } catch (err) {
      const e = new Error(
        "FridaKeyProvider: failed to acquire Frida device" +
        (this._deviceId ? ` (${this._deviceId})` : "") +
        ": " + (err && err.message ? err.message : String(err))
      );
      e.code = "FRIDA_ATTACH_FAILED";
      this._lastTelemetry = telemetry;
      throw e;
    }

    try {
      session = await device.attach(this._packageName);
    } catch (err) {
      const errMsg = err && err.message ? err.message : String(err);
      const e = new Error(
        `FridaKeyProvider: device.attach(${this._packageName}) failed: ${errMsg}`
      );
      // Distinguish "process not found" vs other attach errors
      e.code = /unable to find process|process not found/i.test(errMsg)
        ? "WECHAT_NOT_RUNNING"
        : "FRIDA_ATTACH_FAILED";
      this._lastTelemetry = telemetry;
      throw e;
    }

    try {
      const agentSrc = this._agentLoader();
      script = await session.createScript(agentSrc);
    } catch (err) {
      const e = new Error(
        "FridaKeyProvider: createScript failed: " +
        (err && err.message ? err.message : String(err))
      );
      e.code = "FRIDA_ATTACH_FAILED";
      this._lastTelemetry = telemetry;
      // Clean up the session before throwing
      try { await session.detach(); } catch (_e) {}
      throw e;
    }

    // Promise resolves on the first 'key' message; rejects on the first
    // 'error' (after script load) or after timeoutMs without key.
    const keyHex = await new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;

      const cleanup = async () => {
        if (timer) { clearTimeout(timer); timer = null; }
        try { await script.unload(); } catch (_e) {}
        try { await session.detach(); } catch (_e) {}
      };

      const onMessage = (message, _data) => {
        if (settled) return;
        if (!message || message.type !== "send" || !message.payload) return;
        const evt = message.payload;
        this._log({ level: "info", kind: "frida-message", evt });

        if (evt.kind === "hooked") {
          telemetry.hooked.push({ symbol: evt.symbol, module: evt.module });
          return;
        }
        if (evt.kind === "module-waiting") {
          return; // informational
        }
        if (evt.kind === "key") {
          settled = true;
          telemetry.keySource = evt.source;
          telemetry.durationMs = Date.now() - telemetry.startedAt;
          cleanup().then(() => resolve(String(evt.hex || "").toLowerCase()));
          return;
        }
        if (evt.kind === "error") {
          telemetry.errors.push(evt.message);
          // Don't reject on individual hook errors; we may still get a
          // key from a fallback symbol. Only reject on timeout.
          return;
        }
      };

      script.message.connect(onMessage);

      script.load().catch((err) => {
        if (settled) return;
        settled = true;
        cleanup().then(() => {
          const e = new Error(
            "FridaKeyProvider: script.load failed: " +
            (err && err.message ? err.message : String(err))
          );
          e.code = "FRIDA_ATTACH_FAILED";
          reject(e);
        });
      });

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup().then(() => {
          const last = telemetry.errors.length > 0
            ? ` (last hook error: ${telemetry.errors[telemetry.errors.length - 1]})`
            : "";
          const e = new Error(
            `FridaKeyProvider: no sqlite3_key call within ${this._timeoutMs}ms` +
            (telemetry.hooked.length === 0 ? " — libwcdb.so never loaded; " +
              "did the user touch a chat thread?" : "") + last
          );
          e.code = "WCDB_KEY_TIMEOUT";
          reject(e);
        });
      }, this._timeoutMs);
    });

    this._lastTelemetry = telemetry;
    return keyHex;
  }
}

module.exports = { FridaKeyProvider };
