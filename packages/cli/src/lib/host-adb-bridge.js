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
 *   - `contacts.query({since?})` → contacts with phones, emails,
 *       organization, job title, starred state, and photo URI
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

/**
 * Query SMS via the system content provider. No root, no permissions
 * declared by host — ADB shell user already has READ_SMS-equivalent
 * access. Returns one row per message. The body can contain commas;
 * parseContentQueryRows treats `, <ident>=` as the field boundary so
 * naturally-written text doesn't break the parse (only adversarial
 * SMS containing `, X=` would).
 *
 * @returns {Promise<Array<{id, address, body, date, dateSent, type, threadId, read, subject}>>}
 */
async function querySms(params, opts) {
  const serial = await pickDevice(opts);
  const stdout = await adb(
    ["shell", "content", "query", "--uri", "content://sms"],
    { ...opts, serial, timeoutMs: opts.timeoutMs || 120_000 },
  );
  const rows = parseContentQueryRows(stdout);
  return rows
    .map((r) => ({
      id: r._id ? String(r._id) : null,
      address: r.address || null,
      body: r.body || null,
      date: r.date ? parseInt(r.date, 10) : null,
      dateSent: r.date_sent ? parseInt(r.date_sent, 10) : null,
      // SMS type: 1=inbox, 2=sent, 3=draft, 4=outbox, 5=failed, 6=queued
      type: r.type ? parseInt(r.type, 10) : null,
      threadId: r.thread_id ? parseInt(r.thread_id, 10) : null,
      read: r.read === "1" ? true : r.read === "0" ? false : null,
      subject: r.subject || null,
    }))
    .filter((m) => m.id); // drop rows with no _id (malformed)
}

/**
 * Query call log via the system content provider. Same access model
 * as SMS. Returns one row per call.
 *
 * @returns {Promise<Array<{id, number, name, duration, date, type, geocoded}>>}
 */
async function queryCallLog(params, opts) {
  const serial = await pickDevice(opts);
  const stdout = await adb(
    ["shell", "content", "query", "--uri", "content://call_log/calls"],
    { ...opts, serial, timeoutMs: opts.timeoutMs || 120_000 },
  );
  const rows = parseContentQueryRows(stdout);
  return rows
    .map((r) => ({
      id: r._id ? String(r._id) : null,
      number: r.number || null,
      name: r.name || null,
      // Call duration in seconds
      duration: r.duration ? parseInt(r.duration, 10) : null,
      date: r.date ? parseInt(r.date, 10) : null,
      // Call type: 1=incoming, 2=outgoing, 3=missed, 4=voicemail, 5=rejected, 6=blocked
      type: r.type ? parseInt(r.type, 10) : null,
      geocoded: r.geocoded_location || null,
    }))
    .filter((c) => c.id);
}

/**
 * Lists media files in well-known /sdcard subdirectories. Returns metadata
 * only — file CONTENT is never read off the device through this method.
 * Pure ADB shell, no root, no permissions declared (adb shell user already
 * has READ_EXTERNAL_STORAGE-equivalent access).
 *
 * Category → directory mapping:
 *   photos       /sdcard/DCIM/Camera
 *   pictures     /sdcard/Pictures      (screenshots, downloaded images, etc.)
 *   videos       /sdcard/Movies
 *   downloads    /sdcard/Download
 *   documents    /sdcard/Documents
 *
 * Uses `find -printf "%s\t%T@\t%p\n"` which is supported by Android toybox.
 * One subprocess per category — concurrent isn't worth it; even ~5000-file
 * Pictures listings finish in <2s.
 *
 * @param {{category: string, since?: number}} params
 *   - category: one of the keys above (required)
 *   - since: epoch-ms; files with mtime < since are skipped
 * @returns {Promise<Array<{path, size, mtimeMs, ext, category}>>}
 */
const MEDIA_DIRS = {
  photos: "/sdcard/DCIM/Camera",
  pictures: "/sdcard/Pictures",
  videos: "/sdcard/Movies",
  downloads: "/sdcard/Download",
  documents: "/sdcard/Documents",
};
async function listMedia(params, opts) {
  const cat = params && params.category;
  const dir = MEDIA_DIRS[cat];
  if (!dir) {
    throw new HostAdbBridgeUnavailableError(
      `media.list: unknown category "${cat}". Valid: ${Object.keys(MEDIA_DIRS).join(", ")}`,
    );
  }
  const serial = await pickDevice(opts);
  const stdout = await adb(
    [
      "shell",
      // Suppress "Permission denied" stderr noise on a few system-protected
      // subdirs (e.g. .trashed). 2>/dev/null hides those rows from output.
      `find ${dir} -type f -printf '%s\\t%T@\\t%p\\n' 2>/dev/null`,
    ],
    { ...opts, serial, timeoutMs: opts.timeoutMs || 180_000 },
  );
  const sinceMs = Number.isInteger(params?.since) ? params.since : 0;
  const out = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r+$/, "");
    if (!line) continue;
    // tab-separated: <size>\t<mtime_epoch_fractional>\t<path>
    const tab1 = line.indexOf("\t");
    const tab2 = line.indexOf("\t", tab1 + 1);
    if (tab1 < 0 || tab2 < 0) continue;
    const size = parseInt(line.substring(0, tab1), 10);
    const mtimeSec = parseFloat(line.substring(tab1 + 1, tab2));
    const path = line.substring(tab2 + 1);
    if (!Number.isFinite(size) || !Number.isFinite(mtimeSec) || !path) continue;
    // Filter out hidden / system files — any path segment starts with "."
    // catches .thumbnails/, .trashed-*/, .nomedia, etc.
    if (path.split("/").some((seg) => seg.startsWith("."))) continue;
    const mtimeMs = Math.floor(mtimeSec * 1000);
    if (sinceMs > 0 && mtimeMs < sinceMs) continue;
    const lastDot = path.lastIndexOf(".");
    const ext = lastDot >= 0 ? path.substring(lastDot + 1).toLowerCase() : "";
    out.push({ path, size, mtimeMs, ext, category: cat });
  }
  return out;
}

/**
 * List snapshot JSON files in the Android app's staging directory.
 * Uses `adb shell run-as` so only works on debuggable builds (which is
 * always true for `<pkg>.debug` variants). Production builds will
 * surface `package not debuggable` — UI can fall back to a manual
 * upload path.
 *
 * @param {{packageName?: string}} params
 *   - packageName: defaults to `com.chainlesschain.android.debug`. The
 *     release variant `com.chainlesschain.android` is NOT readable via
 *     run-as.
 * @returns {Promise<Array<{name, sizeBytes}>>}
 */
async function listSnapshots(params, opts) {
  const serial = await pickDevice(opts);
  const pkg =
    (params && params.packageName) || "com.chainlesschain.android.debug";
  const stdout = await adb(
    ["shell", "run-as", pkg, "ls", "-la", "files/.chainlesschain/staging/"],
    { ...opts, serial },
  );
  if (/run-as: package not debuggable/.test(stdout)) {
    throw new HostAdbBridgeUnavailableError(
      `${pkg} is not debuggable — only debug-variant packages expose staging via run-as`,
    );
  }
  const out = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r+$/, "").trim();
    if (!line || line.startsWith("total ") || line.startsWith("d")) continue;
    // ls -la row: `-rw------- 1 u0_a395 u0_a395 204110 2026-05-23 13:47 system-data-android.json`
    const m = line.match(
      /^[-l]\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+\.json)$/,
    );
    if (m) out.push({ name: m[2], sizeBytes: parseInt(m[1], 10) });
  }
  return out;
}

/**
 * Read a snapshot file's content from the Android app's staging directory.
 * Returns the raw UTF-8 text (the JSON the adapter's _syncViaSnapshot
 * expects). Same debuggable-only constraint as listSnapshots.
 *
 * @param {{packageName?: string, fileName: string}} params
 * @returns {Promise<string>}
 */
async function readSnapshot(params, opts) {
  if (
    !params ||
    typeof params.fileName !== "string" ||
    !params.fileName.endsWith(".json")
  ) {
    throw new HostAdbBridgeUnavailableError(
      "readSnapshot: params.fileName must be a .json filename inside the staging dir",
    );
  }
  // Defense-in-depth: reject path traversal — fileName must be a bare
  // basename, no slashes / dots-leading.
  if (params.fileName.includes("/") || params.fileName.startsWith(".")) {
    throw new HostAdbBridgeUnavailableError(
      `readSnapshot: refusing suspicious fileName "${params.fileName}"`,
    );
  }
  const serial = await pickDevice(opts);
  const pkg = params.packageName || "com.chainlesschain.android.debug";
  const stdout = await adb(
    [
      "shell",
      "run-as",
      pkg,
      "cat",
      `files/.chainlesschain/staging/${params.fileName}`,
    ],
    { ...opts, serial, timeoutMs: opts.timeoutMs || 60_000 },
  );
  if (/run-as: package not debuggable/.test(stdout)) {
    throw new HostAdbBridgeUnavailableError(
      `${pkg} is not debuggable — only debug variant exposes staging via run-as`,
    );
  }
  if (/No such file or directory/.test(stdout)) {
    throw new HostAdbBridgeUnavailableError(
      `snapshot ${params.fileName} not found in ${pkg}'s staging dir (collector probably never ran for this adapter)`,
    );
  }
  return stdout;
}

/**
 * Phase B0 — plugin point for platform-specific ADB methods.
 *
 * `opts.extensions` is an optional `{ [methodName]: handler }` map. Each
 * handler is called as `handler(params, ctx)` where `ctx` exposes the
 * shared ADB primitives so platform extensions don't re-implement
 * device-picking or row-parsing:
 *
 *   ctx = {
 *     adb,                    // (args, opts) => Promise<stdout>
 *     pickDevice,             // (opts) => Promise<serial>
 *     parseContentQueryRows,  // (stdout) => Array<{key:value}>
 *   }
 *
 * Resolution order in `invoke(method, params)`:
 *   1. Built-in method (the switch below)
 *   2. Extension method from opts.extensions
 *   3. Throw HostAdbBridgeUnavailableError
 *
 * Built-ins always win — extensions cannot shadow them. This guarantees
 * the multipath plan's Phase 1+ per-platform extensions can't break the
 * already-shipping system-data-android consumer.
 *
 * Example (Phase 1 will land for real):
 *   const bridge = createHostAdbBridge({
 *     extensions: {
 *       "douyin.snapshot": async (params, { adb, pickDevice }) => {
 *         const serial = await pickDevice();
 *         const uid = params.uid;
 *         const out = await adb(
 *           ["shell", "su", "-c", `base64 /data/data/com.ss.android.ugc.aweme/databases/${uid}_im.db`],
 *           { serial, timeoutMs: 60_000 },
 *         );
 *         return { snapshotBase64: out };
 *       },
 *     },
 *   });
 *   await bridge.invoke("douyin.snapshot", { uid: "1234567890" });
 */
const BUILTIN_METHODS = new Set([
  "contacts.query",
  "app.list",
  "sms.query",
  "call.query",
  "media.list",
  "snapshot.list",
  "snapshot.read",
]);

export function createHostAdbBridge(opts = {}) {
  const extensions = opts.extensions || {};
  // Defense: warn (but allow) when an extension tries to shadow a
  // built-in. Built-ins always win in dispatch — Phase B0 keeps this
  // a soft warning so it surfaces in tests; we can upgrade to a hard
  // throw in Phase 1 if any extension author actually attempts it.
  for (const k of Object.keys(extensions)) {
    if (BUILTIN_METHODS.has(k)) {
      // eslint-disable-next-line no-console
      console.warn(
        `host-adb-bridge: extension "${k}" shadows a built-in method and will be ignored at dispatch`,
      );
    }
  }
  const ctx = { adb, pickDevice, parseContentQueryRows };

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
    /**
     * Diagnostic only — reflects extension method names registered for
     * this bridge instance. Useful for `cc doctor`-style introspection.
     */
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
        case "snapshot.list":
          return await listSnapshots(params, opts);
        case "snapshot.read":
          return await readSnapshot(params, opts);
        default: {
          const ext = extensions[method];
          if (typeof ext === "function") {
            return await ext(params, ctx);
          }
          throw new HostAdbBridgeUnavailableError(
            `method "${method}" not implemented by host-adb-bridge`,
          );
        }
      }
    },
  };
}

// Exposed for unit testing without spawning real adb.
export const _internals = {
  parseContentQueryRows,
  mergeContactRows,
  listDevices,
  pickDevice,
  queryContacts,
  listApps,
  listSnapshots,
  readSnapshot,
};
