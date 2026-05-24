/**
 * host-adb-bridge — host-side `bridgeProvider` for the
 * system-data-android PDH adapter (ESM mirror of the CJS module at
 * desktop-app-vue/src/main/personal-data-hub/desktop-adb-bridge.js).
 *
 * The packaged `cc-android-bridge.js` only works INSIDE the Android cc
 * subprocess (it dials a localhost HTTP server the Android app exposes).
 * That path requires the user to launch the in-APK cc, which most
 * users never do. This shim implements the same `invoke(method,
 * params) → Promise<result>` surface but runs commands via the system
 * `adb` (developer-mode USB debugging) instead.
 *
 * Lives in packages/cli because both `cc serve` / `cc ui` AND the
 * desktop web-shell embed of the CLI WS server use this CLI's wiring
 * (personal-data-hub-wiring.js) — putting the bridge here means both
 * paths get the auto-engage behavior. The desktop-app-vue CJS copy is
 * still used for the V5/V6 IPC code path (separate hub singleton).
 *
 * Methods implemented (only what system-data-android consumes):
 *   - `contacts.query({since?})` →
 *       [{ lookupKey, displayName }, ...]
 *   - `app.list({includeSystem?})` →
 *       [{ packageName }, ...]
 *
 * Caveats (cross-checked against the sjqz reference at C:\code\sjqz):
 *   - No root required for the two methods above.
 *   - User must approve "USB 调试授权" on the phone the first time.
 *   - 0 or >1 devices attached → clear typed error (UI surfaces it via
 *     the new SyncReport.error rendering).
 *   - Windows CRLF trap: JS `$` does NOT match before `\r`, only
 *     `\n` / EOS — every parse routine strips `\r+$` first.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export class HostAdbBridgeUnavailableError extends Error {
  constructor(reason) {
    super(`HOST_ADB_BRIDGE_NOT_AVAILABLE: ${reason}`);
    this.code = "HOST_ADB_BRIDGE_NOT_AVAILABLE";
    this.reason = reason;
  }
}

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
      throw new HostAdbBridgeUnavailableError(stderr.trim().split("\n")[0]);
    }
    return stdout;
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new HostAdbBridgeUnavailableError(
        "adb binary not found on PATH (install Android Platform Tools, or set ADB_PATH)",
      );
    }
    if (e instanceof HostAdbBridgeUnavailableError) {
      throw e;
    }
    throw new HostAdbBridgeUnavailableError(e.message);
  }
}

async function listDevices(opts = {}) {
  const stdout = await adb(["devices"], opts);
  const lines = stdout.split("\n").slice(1);
  const serials = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r+$/, "").trim();
    if (!line) continue;
    const [serial, state] = line.split(/\s+/);
    if (state === "device") serials.push(serial);
  }
  return serials;
}

async function pickDevice(opts = {}) {
  if (opts.serial) return opts.serial;
  if (process.env.ADB_SERIAL) return process.env.ADB_SERIAL;
  const serials = await listDevices(opts);
  if (serials.length === 0) {
    throw new HostAdbBridgeUnavailableError(
      "no Android device attached (enable USB debugging + plug in cable + approve 'USB 调试授权' on phone)",
    );
  }
  if (serials.length > 1) {
    throw new HostAdbBridgeUnavailableError(
      `multiple devices attached (${serials.join(", ")}); set ADB_SERIAL=<serial> to disambiguate`,
    );
  }
  return serials[0];
}

function parseContentQueryRows(stdout) {
  const rows = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r+$/, "");
    const m = line.match(/^Row:\s+\d+\s+(.*)$/);
    if (!m) continue;
    const fields = {};
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

async function queryContacts(_params, opts) {
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
    .filter((c) => c.displayName);
}

async function listApps(params, opts) {
  const serial = await pickDevice(opts);
  const includeSystem = params && params.includeSystem === true;
  const flag = includeSystem ? "" : "-3";
  const argv = ["shell", "pm", "list", "packages"];
  if (flag) argv.push(flag);
  const stdout = await adb(argv, { ...opts, serial });
  const apps = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r+$/, "");
    const m = line.match(/^package:(.+)$/);
    if (m) apps.push({ packageName: m[1].trim() });
  }
  return apps;
}

export function createHostAdbBridge(opts = {}) {
  return {
    /**
     * SystemDataAndroidAdapter._bridgeAvailable() reads this; must be
     * sync. We report available:true optimistically — invoke() will
     * throw a typed error if ADB / device isn't usable, which the
     * registry surfaces via SyncReport.error (rendered by
     * PersonalDataHub.vue syncSummary).
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
          throw new HostAdbBridgeUnavailableError(
            `method "${method}" not implemented by host-adb-bridge`,
          );
      }
    },
  };
}

// Exposed for unit testing without spawning real adb.
export const _internals = {
  parseContentQueryRows,
  listDevices,
  pickDevice,
  queryContacts,
  listApps,
};
