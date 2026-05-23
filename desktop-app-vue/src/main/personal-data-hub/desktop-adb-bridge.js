/**
 * desktop-adb-bridge — desktop-side `bridgeProvider` for the
 * system-data-android PDH adapter.
 *
 * The packaged `cc-android-bridge.js` only works INSIDE the Android cc
 * subprocess (it dials a localhost HTTP server the Android app exposes).
 * That path requires the user to launch the in-APK cc, which most
 * desktop users never do. This shim implements the same `invoke(method,
 * params) → Promise<result>` surface but runs commands via the system
 * `adb` (developer-mode USB debugging) instead.
 *
 * Methods implemented (only what system-data-android consumes):
 *   - `contacts.query({since?})` →
 *       [{ lookupKey, displayName, phone? }, ...]
 *   - `app.list({includeSystem?})` →
 *       [{ packageName, label?, version? }, ...]
 *
 * Any other method throws AndroidBridgeUnavailableError so the adapter
 * falls through to snapshot mode (or surfaces a clear error).
 *
 * Caveats (cross-checked against the sjqz reference at C:\code\sjqz):
 *   - No root required for the two methods above — they hit public
 *     ContentProviders + PackageManager via `adb shell`.
 *   - User must approve "USB 调试授权" on the phone the first time.
 *   - When 0 or >1 devices are attached, the bridge surfaces a clear
 *     "no device" / "multiple devices" error rather than silently
 *     picking one.
 */

"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileP = promisify(execFile);

class DesktopAdbBridgeUnavailableError extends Error {
  constructor(reason) {
    super(`DESKTOP_ADB_BRIDGE_NOT_AVAILABLE: ${reason}`);
    this.code = "DESKTOP_ADB_BRIDGE_NOT_AVAILABLE";
    this.reason = reason;
  }
}

/**
 * Run an adb command and return stdout (utf-8). Surfaces a typed error
 * for the common failures so the UI can render a useful banner.
 *
 * @param {string[]} args  — e.g. ["shell", "pm", "list", "packages"]
 * @param {{adbPath?: string, serial?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<string>}
 */
async function adb(args, opts = {}) {
  const adbPath = opts.adbPath || process.env.ADB_PATH || "adb";
  const fullArgs = opts.serial ? ["-s", opts.serial, ...args] : args;
  try {
    const { stdout, stderr } = await execFileP(adbPath, fullArgs, {
      timeout: opts.timeoutMs || 30_000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "utf8",
    });
    if (stderr && /error:|failed:|protocol fault/i.test(stderr)) {
      // adb writes some info lines to stderr — only escalate on the
      // signal phrases that mean a real failure.
      throw new DesktopAdbBridgeUnavailableError(stderr.trim().split("\n")[0]);
    }
    return stdout;
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new DesktopAdbBridgeUnavailableError(
        "adb binary not found on PATH (install Android Platform Tools, or set ADB_PATH)",
      );
    }
    if (e instanceof DesktopAdbBridgeUnavailableError) {
      throw e;
    }
    throw new DesktopAdbBridgeUnavailableError(e.message);
  }
}

/**
 * List attached, authorized devices. Returns serial strings.
 *
 * `adb devices -l` output format:
 *   List of devices attached
 *   <serial>           device product:... model:... device:...
 *   <serial>           unauthorized
 *   <serial>           offline
 *
 * Only devices in `device` state are returned (skip unauthorized /
 * offline).
 */
async function listDevices(opts = {}) {
  const stdout = await adb(["devices"], opts);
  const lines = stdout.split("\n").slice(1); // drop "List of devices attached"
  const serials = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [serial, state] = trimmed.split(/\s+/);
    if (state === "device") {
      serials.push(serial);
    }
  }
  return serials;
}

/**
 * Choose the single attached authorized device, or throw a clear error.
 * Honors ADB_SERIAL env var as an explicit override.
 */
async function pickDevice(opts = {}) {
  if (opts.serial) {
    return opts.serial;
  }
  if (process.env.ADB_SERIAL) {
    return process.env.ADB_SERIAL;
  }
  const serials = await listDevices(opts);
  if (serials.length === 0) {
    throw new DesktopAdbBridgeUnavailableError(
      "no Android device attached (enable USB debugging + plug in cable + approve 'USB 调试授权' on phone)",
    );
  }
  if (serials.length > 1) {
    throw new DesktopAdbBridgeUnavailableError(
      `multiple devices attached (${serials.join(", ")}); set ADB_SERIAL=<serial> to disambiguate`,
    );
  }
  return serials[0];
}

/**
 * Parse `adb shell content query --uri content://...` row output.
 *
 * Output format (one row per line):
 *   Row: 0 _id=12, lookup=abc.xyz, display_name=张三
 *
 * Returns an array of {key:value} objects.
 */
function parseContentQueryRows(stdout) {
  const rows = [];
  for (const rawLine of stdout.split("\n")) {
    // adb on Windows returns CRLF — JS regex `$` does NOT match before
    // a final `\r`, only before `\n` / EOS. Strip trailing CR so anchored
    // regexes work cross-platform.
    const line = rawLine.replace(/\r+$/, "");
    const m = line.match(/^Row:\s+\d+\s+(.*)$/);
    if (!m) {
      continue;
    }
    const fields = {};
    // Each field is "key=value, key=value, ..." but commas inside values
    // confuse a naive split. Use a regex-iter scan to capture pairs.
    const fieldRe =
      /([A-Za-z_][A-Za-z0-9_]*)=([^,]*?)(?=,\s+[A-Za-z_][A-Za-z0-9_]*=|$)/g;
    let fm;
    while ((fm = fieldRe.exec(m[1])) !== null) {
      const key = fm[1];
      const val = fm[2];
      fields[key] = val === "NULL" ? null : val;
    }
    rows.push(fields);
  }
  return rows;
}

/**
 * Query contacts via ContentResolver. No root needed.
 *
 * Reads ContactsContract.Contacts (lookup, display_name) so we get one
 * row per contact — not one row per phone/email like the .data table.
 *
 * @param {{since?: number}} params
 * @param {object} opts
 * @returns {Promise<Array<{lookupKey, displayName}>>}
 */
async function queryContacts(params, opts) {
  const serial = await pickDevice(opts);
  const stdout = await adb(
    [
      "shell",
      "content",
      "query",
      "--uri",
      "content://com.android.contacts/contacts",
      "--projection",
      "lookup:display_name",
    ],
    { ...opts, serial },
  );
  const rows = parseContentQueryRows(stdout);
  return rows
    .map((r) => ({
      lookupKey: r.lookup || null,
      displayName: r.display_name || null,
    }))
    .filter((c) => c.displayName); // drop empty entries
}

/**
 * List installed user apps via PackageManager. No root needed.
 *
 * `adb shell pm list packages -3` returns one line per third-party
 * package:
 *   package:com.example.app
 *
 * @param {{includeSystem?: boolean}} params
 * @param {object} opts
 * @returns {Promise<Array<{packageName}>>}
 */
async function listApps(params, opts) {
  const serial = await pickDevice(opts);
  const includeSystem = params && params.includeSystem === true;
  const flag = includeSystem ? "" : "-3"; // -3 = third-party only
  const argv = ["shell", "pm", "list", "packages"];
  if (flag) {
    argv.push(flag);
  }
  const stdout = await adb(argv, { ...opts, serial });
  const apps = [];
  for (const rawLine of stdout.split("\n")) {
    // Strip CRLF — see parseContentQueryRows for the same trap.
    const line = rawLine.replace(/\r+$/, "");
    const m = line.match(/^package:(.+)$/);
    if (m) {
      apps.push({ packageName: m[1].trim() });
    }
  }
  return apps;
}

/**
 * Factory: returns an object matching the bridgeProvider contract
 * `(method, params) => Promise<result>`. Wiring code passes this into
 * the SystemDataAndroidAdapter as `_deps.bridgeProvider`.
 */
function createDesktopAdbBridge(opts = {}) {
  return {
    /**
     * SystemDataAndroidAdapter._bridgeAvailable() reads this; it MUST
     * return synchronously, so we can't probe ADB here. We report
     * available=true optimistically — the real ADB probe happens
     * inside invoke() and any real failure (binary missing, no device,
     * unauthorized) surfaces as DESKTOP_ADB_BRIDGE_NOT_AVAILABLE,
     * which the registry catches and writes into SyncReport.error.
     * The UI (PersonalDataHub.vue syncSummary) now renders that
     * `.error` field, so the user sees the actual reason.
     */
    caps() {
      return { available: true };
    },
    async invoke(method, params = {}) {
      switch (method) {
        case "contacts.query":
          return await queryContacts(params, opts);
        case "app.list":
          return await listApps(params, opts);
        default:
          throw new DesktopAdbBridgeUnavailableError(
            `method "${method}" not implemented by desktop-adb-bridge`,
          );
      }
    },
  };
}

module.exports = {
  createDesktopAdbBridge,
  DesktopAdbBridgeUnavailableError,
  // Exposed for unit testing without spawning real adb
  _internals: {
    parseContentQueryRows,
    listDevices,
    pickDevice,
    queryContacts,
    listApps,
  },
};
