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
 *   - `contacts.query({since?})` → complete contact metadata
 *   - `app.list({includeSystem?})` → installed package names
 *   - `sms.query`, `call.query`, `media.list` → the remaining
 *       system-data-android bridge sources
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
 * Reads ContactsContract.Contacts for one row per contact, then joins the
 * public phone/email/organization data URIs by contact_id.
 *
 * @param {{since?: number}} params
 * @param {object} opts
 * @returns {Promise<Array<object>>}
 */
function mergeContactRows(contactRows, phoneRows, emailRows, organizationRows) {
  const byId = new Map();
  for (const row of contactRows) {
    const contactId = row._id == null ? null : String(row._id);
    const displayName = row.display_name || null;
    if (!contactId || !displayName) continue;
    byId.set(contactId, {
      lookupKey: row.lookup || null,
      displayName,
      phones: [],
      emails: [],
      starred: row.starred === "1",
      organization: null,
      jobTitle: null,
      photoUri: row.photo_uri || null,
    });
  }

  const appendUnique = (rows, field, valueOf) => {
    for (const row of rows) {
      const contact = byId.get(String(row.contact_id));
      const value = valueOf(row);
      if (!contact || typeof value !== "string" || !value.trim()) continue;
      const normalized = value.trim();
      if (!contact[field].includes(normalized)) contact[field].push(normalized);
    }
  };
  appendUnique(phoneRows, "phones", (row) => row.data1 || row.number);
  appendUnique(emailRows, "emails", (row) => row.data1 || row.address);
  for (const row of organizationRows) {
    const contact = byId.get(String(row.contact_id));
    if (!contact) continue;
    const organization = row.data1 || row.company;
    const jobTitle = row.data4 || row.title;
    if (!contact.organization && organization && organization.trim()) {
      contact.organization = organization.trim();
    }
    if (!contact.jobTitle && jobTitle && jobTitle.trim()) {
      contact.jobTitle = jobTitle.trim();
    }
  }
  return [...byId.values()];
}

async function queryContacts(params, opts) {
  const serial = await pickDevice(opts);
  const contactArgs = [
    "shell",
    "content",
    "query",
    "--uri",
    "content://com.android.contacts/contacts",
    "--projection",
    "_id:lookup:display_name:starred:photo_uri",
  ];
  if (Number.isInteger(params?.since) && params.since > 0) {
    contactArgs.push(
      "--where",
      `contact_last_updated_timestamp >= ${params.since}`,
    );
  }
  const commandOpts = { ...opts, serial, timeoutMs: opts.timeoutMs || 120_000 };
  const [contactsOut, phonesOut, emailsOut, organizationsOut] =
    await Promise.all([
      adb(contactArgs, commandOpts),
      adb(
        [
          "shell",
          "content",
          "query",
          "--uri",
          "content://com.android.contacts/data/phones",
          "--projection",
          "contact_id:data1",
        ],
        commandOpts,
      ),
      adb(
        [
          "shell",
          "content",
          "query",
          "--uri",
          "content://com.android.contacts/data/emails",
          "--projection",
          "contact_id:data1",
        ],
        commandOpts,
      ),
      adb(
        [
          "shell",
          "content",
          "query",
          "--uri",
          "content://com.android.contacts/data",
          "--projection",
          "contact_id:data1:data4",
          "--where",
          "mimetype='vnd.android.cursor.item/organization'",
        ],
        commandOpts,
      ),
    ]);
  return mergeContactRows(
    parseContentQueryRows(contactsOut),
    parseContentQueryRows(phonesOut),
    parseContentQueryRows(emailsOut),
    parseContentQueryRows(organizationsOut),
  );
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

async function querySms(_params, opts) {
  const serial = await pickDevice(opts);
  const stdout = await adb(
    ["shell", "content", "query", "--uri", "content://sms"],
    { ...opts, serial, timeoutMs: opts.timeoutMs || 120_000 },
  );
  return parseContentQueryRows(stdout)
    .map((row) => ({
      id: row._id ? String(row._id) : null,
      address: row.address || null,
      body: row.body || null,
      date: row.date ? parseInt(row.date, 10) : null,
      dateSent: row.date_sent ? parseInt(row.date_sent, 10) : null,
      type: row.type ? parseInt(row.type, 10) : null,
      threadId: row.thread_id ? parseInt(row.thread_id, 10) : null,
      read: row.read === "1" ? true : row.read === "0" ? false : null,
      subject: row.subject || null,
    }))
    .filter((row) => row.id);
}

async function queryCallLog(_params, opts) {
  const serial = await pickDevice(opts);
  const stdout = await adb(
    ["shell", "content", "query", "--uri", "content://call_log/calls"],
    { ...opts, serial, timeoutMs: opts.timeoutMs || 120_000 },
  );
  return parseContentQueryRows(stdout)
    .map((row) => ({
      id: row._id ? String(row._id) : null,
      number: row.number || null,
      name: row.name || null,
      duration: row.duration ? parseInt(row.duration, 10) : null,
      date: row.date ? parseInt(row.date, 10) : null,
      type: row.type ? parseInt(row.type, 10) : null,
      geocoded: row.geocoded_location || null,
    }))
    .filter((row) => row.id);
}

const MEDIA_DIRS = {
  photos: "/sdcard/DCIM/Camera",
  pictures: "/sdcard/Pictures",
  videos: "/sdcard/Movies",
  downloads: "/sdcard/Download",
  documents: "/sdcard/Documents",
};

async function listMedia(params, opts) {
  const category = params && params.category;
  const directory = MEDIA_DIRS[category];
  if (!directory) {
    throw new DesktopAdbBridgeUnavailableError(
      `media.list: unknown category "${category}". Valid: ${Object.keys(MEDIA_DIRS).join(", ")}`,
    );
  }
  const serial = await pickDevice(opts);
  const stdout = await adb(
    [
      "shell",
      `find ${directory} -type f -printf '%s\\t%T@\\t%p\\n' 2>/dev/null`,
    ],
    { ...opts, serial, timeoutMs: opts.timeoutMs || 180_000 },
  );
  const sinceMs = Number.isInteger(params?.since) ? params.since : 0;
  const files = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r+$/, "");
    if (!line) continue;
    const firstTab = line.indexOf("\t");
    const secondTab = line.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const size = parseInt(line.substring(0, firstTab), 10);
    const mtimeSeconds = parseFloat(line.substring(firstTab + 1, secondTab));
    const filePath = line.substring(secondTab + 1);
    if (!Number.isFinite(size) || !Number.isFinite(mtimeSeconds) || !filePath) {
      continue;
    }
    if (filePath.split("/").some((segment) => segment.startsWith(".")))
      continue;
    const mtimeMs = Math.floor(mtimeSeconds * 1000);
    if (sinceMs > 0 && mtimeMs < sinceMs) continue;
    const lastDot = filePath.lastIndexOf(".");
    const ext =
      lastDot >= 0 ? filePath.substring(lastDot + 1).toLowerCase() : "";
    files.push({ path: filePath, size, mtimeMs, ext, category });
  }
  return files;
}

/**
 * Phase B0 — plugin point for platform-specific ADB methods.
 *
 * Mirrors the ESM `host-adb-bridge.js` extension API. `opts.extensions`
 * is an optional `{ [methodName]: handler }` map. Each handler is
 * called as `handler(params, ctx)` where:
 *
 *   ctx = { adb, pickDevice, parseContentQueryRows }
 *
 * Built-in methods always win (cannot be shadowed). See ESM mirror at
 * `packages/cli/src/lib/host-adb-bridge.js` for the full design rationale.
 */
const BUILTIN_METHODS = new Set([
  "contacts.query",
  "app.list",
  "sms.query",
  "call.query",
  "media.list",
]);

/**
 * Factory: returns an object matching the bridgeProvider contract
 * `(method, params) => Promise<result>`. Wiring code passes this into
 * the SystemDataAndroidAdapter as `_deps.bridgeProvider`.
 */
function createDesktopAdbBridge(opts = {}) {
  const extensions = opts.extensions || {};
  for (const k of Object.keys(extensions)) {
    if (BUILTIN_METHODS.has(k)) {
      console.warn(
        `desktop-adb-bridge: extension "${k}" shadows a built-in method and will be ignored at dispatch`,
      );
    }
  }
  const ctx = { adb, pickDevice, parseContentQueryRows };

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
    /** Diagnostic: list extension method names registered. */
    extensionMethods() {
      return Object.keys(extensions).filter((k) => !BUILTIN_METHODS.has(k));
    },
    async invoke(method, params = {}) {
      switch (method) {
        case "contacts.query":
          return await queryContacts(params, opts);
        case "app.list":
          return await listApps(params, opts);
        case "sms.query":
          return await querySms(params, opts);
        case "call.query":
          return await queryCallLog(params, opts);
        case "media.list":
          return await listMedia(params, opts);
        default: {
          const ext = extensions[method];
          if (typeof ext === "function") {
            return await ext(params, ctx);
          }
          throw new DesktopAdbBridgeUnavailableError(
            `method "${method}" not implemented by desktop-adb-bridge`,
          );
        }
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
    mergeContactRows,
    listDevices,
    pickDevice,
    queryContacts,
    listApps,
    querySms,
    queryCallLog,
    listMedia,
  },
};
