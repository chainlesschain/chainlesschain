#!/usr/bin/env node
// =============================================================================
// pdh-device-collect.mjs — reproducible REAL-DEVICE PDH collection (rooted Android)
// =============================================================================
// Collects the HIGH-YIELD, RELIABLE real-device sources into the desktop PDH
// vault via the `system-data-android` adapter in BRIDGE mode — the path that
// has NO `cc` CLI command (the adapter's bridge is built for in-APK cc only,
// `cc hub sync-adapter system-data-android` only does snapshot=contacts+apps v1).
//
//   • contacts  → root-read /data/data/com.android.providers.contacts/databases/contacts2.db
//                 (content query is DENIED for contacts → must use root)
//   • SMS       → adb `content query --uri content://sms`        (works, no root)
//   • call_log  → adb `content query --uri content://call_log/calls` (works, no root)
//   • apps      → adb `pm list packages -3`
//   • media     → adb `find /sdcard/{DCIM/Camera,Pictures,Movies,Download,Documents}` (metadata only)
//   • browser   → root-pull /data/data/com.android.browser/databases/browser2.db
//                 (MIUI/AOSP stock browser history → browser-history-aosp adapter)
//
// WHY THIS FIRST (lesson 2026-06-17): system data >> app IM for real-device
// collection — plain / content-query accessible, high-volume, no encryption
// fight (WeChat/Douyin/QQ IM are WCDB2/SQLCipher and login/anti-debug-gated;
// see memory `android_app_db_decryption_findings`). Do this BEFORE the
// memory-scan Method B (scripts/android/pdh-mem-sqlite-scan.sh).
//
// AUTHORIZATION: your OWN rooted device / OWN account / OWN apps only.
//
// Usage:
//   node scripts/android/pdh-device-collect.mjs [options]
//     --serial <s>     adb device serial (default: ADB_SERIAL env, or the sole device)
//     --no-contacts    skip contacts (root pull)
//     --no-sms         skip SMS
//     --no-calls       skip call_log
//     --no-apps        skip installed-app list
//     --no-media       skip media-file metadata
//     --no-browser     skip MIUI/AOSP stock browser history (browser2.db)
//     --dry-run        read + count only, do NOT write to the vault
//
// Verify after:  cc hub stats   |   cc hub search --adapter system-data-android
// =============================================================================

import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..", ".."); // <repo>/scripts/android → <repo>
const require = createRequire(path.join(ROOT, "packages/personal-data-hub/lib/index.js"));

// ---- args ----
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = has("--dry-run");
const include = {
  contacts: !has("--no-contacts"),
  sms: !has("--no-sms"),
  calls: !has("--no-calls"),
  apps: !has("--no-apps"),
  media: !has("--no-media"),
  browser: !has("--no-browser"),
};

// ---- adb helpers ----
const ADB = process.env.ADB_PATH || "adb";
function pickSerial() {
  const explicit = val("--serial") || process.env.ADB_SERIAL;
  if (explicit) return explicit;
  const out = execFileSync(ADB, ["devices"], { encoding: "utf-8" });
  const serials = out.split("\n").slice(1).map((l) => l.trim().split(/\s+/))
    .filter((p) => p[1] === "device").map((p) => p[0]);
  if (serials.length === 1) return serials[0];
  throw new Error(`expected exactly one device (or pass --serial); found: ${serials.join(", ") || "none"}`);
}
const SERIAL = pickSerial();
const adb = (args) => execFileSync(ADB, ["-s", SERIAL, ...args], { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });

// ---- contacts: root-pull contacts2.db, read name+phones+emails ----
function readContacts() {
  const tmpDev = "/data/local/tmp/cc_contacts_collect.db";
  const tmpLocal = path.join(os.tmpdir(), `cc_contacts_${Date.now()}.db`);
  adb(["shell", `su -c 'cp /data/data/com.android.providers.contacts/databases/contacts2.db ${tmpDev}; chmod 666 ${tmpDev}'`]);
  try {
    adb(["pull", tmpDev, tmpLocal]);
    const Database = require("better-sqlite3");
    const db = new Database(tmpLocal, { readonly: true });
    const q = (mime) => db.prepare(
      `SELECT rc.display_name AS name, d.data1 AS val
       FROM data d JOIN raw_contacts rc ON d.raw_contact_id=rc._id
       JOIN mimetypes m ON d.mimetype_id=m._id
       WHERE m.mimetype=? AND rc.deleted=0 AND rc.display_name IS NOT NULL AND d.data1 IS NOT NULL`).all(mime);
    const byName = new Map();
    const add = (name, field, v) => {
      if (!name || !v) return;
      if (!byName.has(name)) byName.set(name, { lookupKey: name, displayName: name, phones: [], emails: [] });
      const e = byName.get(name);
      if (!e[field].includes(String(v))) e[field].push(String(v));
    };
    for (const r of q("vnd.android.cursor.item/phone_v2")) add(r.name, "phones", r.val);
    for (const r of q("vnd.android.cursor.item/email_v2")) add(r.name, "emails", r.val);
    db.close();
    return [...byName.values()];
  } finally {
    try { fs.unlinkSync(tmpLocal); } catch (_) {}
    try { adb(["shell", `su -c 'rm -f ${tmpDev}'`]); } catch (_) {}
  }
}

// ---- AOSP/MIUI stock browser: root-pull browser2.db to a local temp file ----
// Returns the local path (caller ingests via browser-history-aosp, then
// deletes it) or null when the stock browser isn't installed / has no DB.
function pullAospBrowserDb() {
  const src = "/data/data/com.android.browser/databases/browser2.db";
  const tmpDev = "/data/local/tmp/cc_browser2_collect.db";
  const tmpLocal = path.join(os.tmpdir(), `cc_browser2_${Date.now()}.db`);
  try {
    adb(["shell", `su -c 'test -f ${src} && cp ${src} ${tmpDev} && chmod 666 ${tmpDev} || echo NO_DB'`]);
    // pull fails loudly if the cp above hit NO_DB (tmpDev absent)
    adb(["pull", tmpDev, tmpLocal]);
    return fs.existsSync(tmpLocal) ? tmpLocal : null;
  } catch (_e) {
    try { fs.unlinkSync(tmpLocal); } catch (_) {}
    return null; // stock browser absent or unreadable — skip, not fatal
  } finally {
    try { adb(["shell", `su -c 'rm -f ${tmpDev}'`]); } catch (_) {}
  }
}

// ---- main ----
console.log(`[pdh-device-collect] device=${SERIAL} dry-run=${DRY} include=${JSON.stringify(include)}`);

const contacts = include.contacts ? readContacts() : [];
if (include.contacts) console.log(`  contacts: ${contacts.length} (phones=${contacts.reduce((n, c) => n + c.phones.length, 0)})`);

const wiring = await import(pathToFileURL(path.join(ROOT, "packages/cli/src/lib/personal-data-hub-wiring.js")).href);
const { createHostAdbBridge } = await import(pathToFileURL(path.join(ROOT, "packages/cli/src/lib/host-adb-bridge.js")).href);
const { SystemDataAndroidAdapter, BrowserHistoryAospAdapter } = require(path.join(ROOT, "packages/personal-data-hub/lib/index.js"));

const adbBridge = createHostAdbBridge({ serial: SERIAL });
const bridge = {
  caps: () => ({ available: true }),
  async invoke(method, params = {}) {
    if (method === "contacts.query") return { contacts }; // root-read override (content query denied)
    return adbBridge.invoke(method, params);              // sms/call/app/media via content query / find
  },
};

if (DRY) {
  console.log("[dry-run] would ingest:", JSON.stringify(include), "— stopping before vault write.");
  process.exit(0);
}

const hub = await wiring.getHub();
const before = hub.registry.vault.stats ? hub.registry.vault.stats() : null;
const adapter = new SystemDataAndroidAdapter();
adapter._deps.bridgeProvider = () => bridge;
hub.registry.unregister("system-data-android"); // MUST unregister first (register throws on dup)
hub.registry.register(adapter);

// system-data-android `include` flags: contacts/apps/sms/calls booleans, media boolean-or-per-category
const adapterInclude = {
  contacts: include.contacts, apps: include.apps, sms: include.sms, calls: include.calls,
  media: include.media ? undefined : false,
};
console.log("[ingest] syncing system-data-android (bridge mode)...");
const report = await hub.registry.syncAdapter("system-data-android", { useBridge: true, include: adapterInclude });
console.log("[report]", JSON.stringify({
  adapter: report.adapter, rawCount: report.rawCount, invalidCount: report.invalidCount, error: report.error,
}, null, 2));

// ---- AOSP/MIUI stock browser history (browser2.db) ----
// A fresh adapter instance carrying the pulled db path — the registry gates on
// healthCheck() (no args), so the bare-registered instance can't see opts.dbPath.
if (include.browser) {
  const browserDb = pullAospBrowserDb();
  if (!browserDb) {
    console.log("  browser: stock browser2.db not found (skip)");
  } else {
    try {
      const aosp = new BrowserHistoryAospAdapter({ dbPath: browserDb });
      try { hub.registry.unregister("browser-history-aosp"); } catch (_) {} // drop the bare instance
      hub.registry.register(aosp);
      console.log("[ingest] syncing browser-history-aosp...");
      const bReport = await hub.registry.syncAdapter("browser-history-aosp");
      console.log("[report]", JSON.stringify({
        adapter: bReport.adapter, rawCount: bReport.rawCount, invalidCount: bReport.invalidCount, error: bReport.error,
      }, null, 2));
    } finally {
      try { fs.unlinkSync(browserDb); } catch (_) {}
    }
  }
}

const after = hub.registry.vault.stats ? hub.registry.vault.stats() : null;
if (before && after) {
  console.log(`[vault] events ${before.events}→${after.events}  persons ${before.persons}→${after.persons}  items ${before.items}→${after.items}`);
}
console.log("[done] verify: cc hub stats | cc hub search --adapter system-data-android");
process.exit(0);
