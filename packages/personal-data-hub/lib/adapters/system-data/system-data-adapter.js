/**
 * SystemDataAdapter — Android system data (contacts / call log / SMS / WiFi).
 *
 * Phase 4.5.5. Sits on top of the forensics-bridge sidecar.
 *
 * Per-source pipeline (each one independent — disabling SMS doesn't break the
 * others):
 *
 *   contacts:  android.pull_file → system.parse_contacts → Person stream
 *   calllog:   android.pull_file → system.parse_calllog → Event(call) + Person stream
 *   sms:       android.pull_file → system.parse_sms     → Event(message) + Person stream
 *   wifi:      android.pull_file → system.parse_wifi    → Place stream
 *
 * Or, when `opts.dataPaths` is provided (e.g. user already adb-pulled files
 * manually, or testing with a local fixture), skip the pull step.
 *
 * Privacy gating: `opts.include` decides which sub-sources run. Default per
 * Adapter_System_Data.md §5.1 + OQ-SD1: contacts ON / calllog ON / sms OFF /
 * wifi ON. The UI dialog re-confirms this on each sync.
 */

"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const { PythonSidecarAdapter } = require("../_python-sidecar-base");

const NAME = "system-data";
const VERSION = "0.1.0";

const DEFAULT_INCLUDE = Object.freeze({
  contacts: true,
  calllog: true,
  sms: false, // opt-out by default — see Adapter_System_Data.md §5.1
  wifi: true,
});

/**
 * Default Android system provider paths. Override via opts.remotePaths when
 * a device uses a non-stock layout.
 */
const DEFAULT_REMOTE_PATHS = Object.freeze({
  contacts:
    "/data/data/com.android.providers.contacts/databases/contacts2.db",
  calllog: "/data/data/com.android.providers.contacts/databases/calllog.db",
  sms: "/data/data/com.android.providers.telephony/databases/mmssms.db",
  wifi: "/data/misc/wifi/", // directory — pull_file works for one file, so wifi mode-A is dataPaths
});

/**
 * Per-source workaround paths under /sdcard/Download/ for stock Android
 * (no `adb root`) — user copies files via Termux + tsu or MT Manager.
 */
const SDCARD_WORKAROUND_PATHS = Object.freeze({
  contacts: "/sdcard/Download/contacts2.db",
  calllog: "/sdcard/Download/calllog.db",
  sms: "/sdcard/Download/mmssms.db",
  wifi_xml: "/sdcard/Download/WifiConfigStore.xml",
  wifi_conf: "/sdcard/Download/wpa_supplicant.conf",
});

class SystemDataAdapter extends PythonSidecarAdapter {
  constructor(opts) {
    super(opts);
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:android-adb",
      "sync:android-sdcard-workaround",
      "sync:host-dataPaths",
    ];
    this.rateLimits = { perDay: 12 }; // system data day-to-day churn is small
    this.dataDisclosure = {
      fields: [
        "contacts:name,phone,email,organization,notes,starred,photoUri",
        "calllog:number,duration,timestamp,type,name",
        "sms:address,body,timestamp,type,threadId,isRead",
        "wifi:ssid,securityType,hidden",
        // Explicitly NOT collected:
        //   - wifi:password (never written to vault, even when present in source)
      ],
      sensitivity: "high", // SMS may include third-party content
      legalGate: true, // requires explicit user agreement on third-party content
      retentionDays: undefined, // user-controlled (no default cap)
      notice:
        "短信和通话记录可能包含他人电话号码或对话内容；所有数据在本机加密存储，不向任何服务器上传（含 AI 分析）。",
      defaultInclude: { ...DEFAULT_INCLUDE },
    };
  }

  // -----------------------------------------------------------------------
  // PersonalDataAdapter — authenticate / healthCheck override
  // -----------------------------------------------------------------------

  /**
   * Verify the sidecar is reachable AND there is at least one usable ADB
   * device (unless caller signals offline-import mode by passing dataPaths).
   *
   * @param {object} ctx
   * @param {object} [ctx.dataPaths] If set, ADB presence is not required.
   * @param {string} [ctx.serial]    Optional serial; auth checks just that device.
   */
  async authenticate(ctx = {}) {
    const pong = await this.supervisor.invoke("sidecar.ping", {}, { timeoutMs: 3000 });
    if (ctx.dataPaths && Object.keys(ctx.dataPaths).length > 0) {
      return { ok: true, mode: "offline", sidecarVersion: pong.version };
    }
    let devices;
    try {
      const out = await this.supervisor.invoke("android.list_devices", {}, { timeoutMs: 5000 });
      devices = out.devices || [];
    } catch (err) {
      return {
        ok: false,
        reason: `android.list_devices failed: ${err.code || err.message}`,
      };
    }
    const wanted = ctx.serial
      ? devices.filter((d) => d.serial === ctx.serial)
      : devices.filter((d) => d.state === "device");
    if (wanted.length === 0) {
      return {
        ok: false,
        reason: ctx.serial
          ? `device "${ctx.serial}" not found or not authorized`
          : "no authorized ADB devices attached",
      };
    }
    return { ok: true, mode: "device", devices: wanted };
  }

  // -----------------------------------------------------------------------
  // Orchestration (subclass hook)
  // -----------------------------------------------------------------------

  /**
   * Orchestrate the 4 sub-sources sequentially.
   *
   * @param {object} opts
   * @param {object} [opts.include]      Per-source enable flags (defaults: DEFAULT_INCLUDE).
   * @param {string} [opts.serial]       Required when pulling from a live device.
   * @param {object} [opts.dataPaths]    Pre-extracted host paths, keys:
   *                                       {contacts, calllog, sms, wifi}.
   * @param {object} [opts.remotePaths]  Override default device paths.
   * @param {"normal"|"sdcard"} [opts.extractMode]
   *                                     "normal" = pull from /data/data (root only),
   *                                     "sdcard" = pull from /sdcard/Download (workaround).
   * @param {string} [opts.scratchDir]   Directory for pulled DBs. Default: hub tmp.
   * @param {(msg: object) => void} [opts.onProgress]  Forwarded as adapter-progress.
   */
  async _runSidecar(opts, emit) {
    const include = { ...DEFAULT_INCLUDE, ...(opts.include || {}) };
    const dataPaths = opts.dataPaths || {};
    const extractMode = opts.extractMode || "normal";
    const remotePaths =
      extractMode === "sdcard"
        ? {
            contacts: SDCARD_WORKAROUND_PATHS.contacts,
            calllog: SDCARD_WORKAROUND_PATHS.calllog,
            sms: SDCARD_WORKAROUND_PATHS.sms,
            wifi: SDCARD_WORKAROUND_PATHS.wifi_xml,
          }
        : { ...DEFAULT_REMOTE_PATHS, ...(opts.remotePaths || {}) };

    const scratchDir =
      opts.scratchDir ||
      fs.mkdtempSync(path.join(os.tmpdir(), "system-data-sync-"));
    fs.mkdirSync(scratchDir, { recursive: true });

    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const tellProgress = (source, phase, extra = {}) => {
      if (onProgress) onProgress({ source, phase, ...extra });
    };

    const sourcesRun = [];

    // ─── Contacts ────────────────────────────────────────────────────────
    let contactsLocal = dataPaths.contacts || null;
    if (include.contacts) {
      if (!contactsLocal) {
        if (!opts.serial) {
          throw new Error(
            "system-data: contacts enabled but no serial/dataPaths.contacts provided",
          );
        }
        tellProgress("contacts", "pulling");
        const pulled = await this.supervisor.invoke(
          "android.pull_file",
          {
            serial: opts.serial,
            remote_path: remotePaths.contacts,
            local_dir: scratchDir,
          },
          { timeoutMs: 60_000 },
        );
        contactsLocal = pulled.local;
      }
      tellProgress("contacts", "parsing", { dbPath: contactsLocal });
      const r = await this.supervisor.invoke(
        "system.parse_contacts",
        { data_path: contactsLocal, device_serial: opts.serial || null },
        {
          timeoutMs: 120_000,
          onChunk: (batch) => this._emitChunkAsRaws(batch, emit),
          onProgress: (p) => tellProgress("contacts", "progress", p),
        },
      );
      sourcesRun.push({ source: "contacts", ...r });
    }

    // ─── Call log ────────────────────────────────────────────────────────
    if (include.calllog) {
      let calllogLocal = dataPaths.calllog || null;
      if (!calllogLocal) {
        if (!opts.serial) {
          throw new Error("system-data: calllog enabled but no serial/dataPaths.calllog");
        }
        tellProgress("calllog", "pulling");
        try {
          const pulled = await this.supervisor.invoke(
            "android.pull_file",
            {
              serial: opts.serial,
              remote_path: remotePaths.calllog,
              local_dir: scratchDir,
            },
            { timeoutMs: 60_000 },
          );
          calllogLocal = pulled.local;
        } catch (err) {
          // Calls table may live in contacts2.db on pre-Android-11 builds.
          if (err.code === "EXTRACT_PERMISSION_DENIED" && contactsLocal) {
            calllogLocal = contactsLocal;
          } else {
            throw err;
          }
        }
      }
      tellProgress("calllog", "parsing", { dbPath: calllogLocal });
      const r = await this.supervisor.invoke(
        "system.parse_calllog",
        {
          data_path: calllogLocal,
          contacts_db_path: contactsLocal,
          device_serial: opts.serial || null,
        },
        {
          timeoutMs: 180_000,
          onChunk: (batch) => this._emitChunkAsRaws(batch, emit),
          onProgress: (p) => tellProgress("calllog", "progress", p),
        },
      );
      sourcesRun.push({ source: "calllog", ...r });
    }

    // ─── SMS ────────────────────────────────────────────────────────────
    if (include.sms) {
      let smsLocal = dataPaths.sms || null;
      if (!smsLocal) {
        if (!opts.serial) {
          throw new Error("system-data: sms enabled but no serial/dataPaths.sms");
        }
        tellProgress("sms", "pulling");
        const pulled = await this.supervisor.invoke(
          "android.pull_file",
          {
            serial: opts.serial,
            remote_path: remotePaths.sms,
            local_dir: scratchDir,
          },
          { timeoutMs: 60_000 },
        );
        smsLocal = pulled.local;
      }
      tellProgress("sms", "parsing", { dbPath: smsLocal });
      const r = await this.supervisor.invoke(
        "system.parse_sms",
        {
          data_path: smsLocal,
          contacts_db_path: contactsLocal,
          device_serial: opts.serial || null,
        },
        {
          timeoutMs: 300_000, // SMS can be 10K+ rows on long-term devices
          onChunk: (batch) => this._emitChunkAsRaws(batch, emit),
          onProgress: (p) => tellProgress("sms", "progress", p),
        },
      );
      sourcesRun.push({ source: "sms", ...r });
    }

    // ─── WiFi ───────────────────────────────────────────────────────────
    if (include.wifi) {
      let wifiLocal = dataPaths.wifi || null;
      if (!wifiLocal) {
        // WiFi config is a single file, but two possible names. Prefer XML.
        if (!opts.serial) {
          throw new Error("system-data: wifi enabled but no serial/dataPaths.wifi");
        }
        tellProgress("wifi", "pulling");
        try {
          const pulled = await this.supervisor.invoke(
            "android.pull_file",
            {
              serial: opts.serial,
              remote_path: remotePaths.wifi,
              local_dir: scratchDir,
            },
            { timeoutMs: 30_000 },
          );
          wifiLocal = path.dirname(pulled.local);
        } catch (err) {
          // Non-fatal — wifi often inaccessible without root. Skip this source.
          tellProgress("wifi", "skipped", { reason: err.code || err.message });
          return { sources: sourcesRun, scratchDir };
        }
      }
      tellProgress("wifi", "parsing", { dbPath: wifiLocal });
      const r = await this.supervisor.invoke(
        "system.parse_wifi",
        { data_path: wifiLocal, device_serial: opts.serial || null },
        {
          timeoutMs: 30_000,
          onChunk: (batch) => this._emitChunkAsRaws(batch, emit),
          onProgress: (p) => tellProgress("wifi", "progress", p),
        },
      );
      sourcesRun.push({ source: "wifi", ...r });
    }

    return { sources: sourcesRun, scratchDir };
  }
}

module.exports = {
  SystemDataAdapter,
  SYSTEM_DATA_ADAPTER_NAME: NAME,
  SYSTEM_DATA_ADAPTER_VERSION: VERSION,
  DEFAULT_INCLUDE,
  DEFAULT_REMOTE_PATHS,
  SDCARD_WORKAROUND_PATHS,
};
