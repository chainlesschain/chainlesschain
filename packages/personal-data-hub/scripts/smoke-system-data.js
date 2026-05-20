#!/usr/bin/env node
/**
 * Full system-data smoke / real-device runner — Phase 4.5.7.
 *
 * Drives the full SystemDataAdapter end-to-end across all 4 sources
 * (contacts / calllog / sms / wifi), exercising:
 *
 *   - PythonSidecarAdapter base class
 *   - SidecarSupervisor lifecycle
 *   - SystemDataAdapter.authenticate
 *   - 4 sidecar parse_* methods
 *   - per-entity hub-side UnifiedSchema validation
 *   - dataDisclosure metadata sanitization
 *
 * Replaces the contacts-only `smoke-system-data-contacts.js`. The older
 * script remains for users who only want to exercise the Phase 4.5.2 slice.
 *
 * Usage:
 *
 *   # Offline mode — pre-extracted host files (no ADB)
 *   node scripts/smoke-system-data.js \
 *     --contacts-db ./fixtures/contacts2.db \
 *     --calllog-db ./fixtures/contacts2.db \
 *     --wifi-dir   ./fixtures/wifi/
 *
 *   # Live device, /sdcard workaround (non-root)
 *   node scripts/smoke-system-data.js \
 *     --serial 24115RA8ECabc123 --extract-mode sdcard
 *
 *   # Live device with adb root
 *   node scripts/smoke-system-data.js --serial 24115RA8ECabc123
 *
 *   # Include SMS (default off — explicit opt-in for legality)
 *   node scripts/smoke-system-data.js --serial XYZ --extract-mode sdcard --include sms
 *
 *   # Disable contacts but include sms
 *   node scripts/smoke-system-data.js --db ... --include sms --exclude contacts
 *
 * Exit codes:
 *   0  success
 *   1  sidecar / hub error
 *   2  invalid entities (schema validation failed)
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { SidecarSupervisor } = require("../lib/sidecar");
const {
  SystemDataAdapter,
  sanitizeInclude,
  DEFAULT_INCLUDE,
} = require("../lib/adapters/system-data");
const { validate } = require("../lib/schemas");

const SIDECAR_ROOT = path.resolve(__dirname, "..", "..", "personal-data-hub-bridge");
const PYTHON = process.env.FORENSICS_BRIDGE_PYTHON || "python";

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    serial: null,
    extractMode: "normal",
    dataPaths: {},
    include: [],
    exclude: [],
    list: false,
    outDir: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case "--serial": out.serial = argv[++i]; break;
      case "--extract-mode": out.extractMode = argv[++i]; break;
      case "--contacts-db": out.dataPaths.contacts = path.resolve(argv[++i]); break;
      case "--calllog-db": out.dataPaths.calllog = path.resolve(argv[++i]); break;
      case "--sms-db": out.dataPaths.sms = path.resolve(argv[++i]); break;
      case "--wifi-dir": out.dataPaths.wifi = path.resolve(argv[++i]); break;
      case "--include": out.include.push(argv[++i]); break;
      case "--exclude": out.exclude.push(argv[++i]); break;
      case "--list": out.list = true; break;
      case "--out": out.outDir = argv[++i]; break;
      case "-h": case "--help": out.help = true; break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
smoke-system-data — drive SystemDataAdapter end-to-end for all 4 sources.

Modes (mutually exclusive):
  Pre-extracted (offline):
    --contacts-db <path>     contacts2.db on disk
    --calllog-db <path>      calls db on disk (may be same as --contacts-db)
    --sms-db <path>          mmssms.db on disk
    --wifi-dir <path>        directory with WifiConfigStore.xml / wpa_supplicant.conf

  Live device (ADB):
    --serial <serial>        target device
    --extract-mode normal    pull from /data/data (requires adb root)
    --extract-mode sdcard    pull from /sdcard/Download/ (Termux+tsu workaround)

Source gating:
  --include <key>            force-enable a source (key: contacts/calllog/sms/wifi)
  --exclude <key>            force-disable a source
  (defaults per adapter.dataDisclosure: contacts=on / calllog=on / sms=OFF / wifi=on)

Misc:
  --list                     list ADB devices and exit
  --out <dir>                output directory (default: ./out/<timestamp>)
  -h, --help                 show this help

Env:
  FORENSICS_BRIDGE_PYTHON    python interpreter (default: python)
`);
}

function timestampSlug() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

function log(level, msg, extra = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function resolveInclude(args) {
  const include = { ...DEFAULT_INCLUDE };
  for (const k of args.include) {
    if (!Object.prototype.hasOwnProperty.call(include, k)) {
      throw new Error(`unknown source for --include: ${k}`);
    }
    include[k] = true;
  }
  for (const k of args.exclude) {
    if (!Object.prototype.hasOwnProperty.call(include, k)) {
      throw new Error(`unknown source for --exclude: ${k}`);
    }
    include[k] = false;
  }
  return sanitizeInclude(include);
}

// ---------------------------------------------------------------------------

async function main(rawArgs) {
  let args;
  try {
    args = parseArgs(rawArgs);
  } catch (err) {
    console.error(err.message);
    printHelp();
    process.exit(2);
  }
  if (args.help) { printHelp(); return; }

  const outDir = path.resolve(args.outDir || path.join(process.cwd(), "out", timestampSlug()));
  fs.mkdirSync(outDir, { recursive: true });
  log("info", "output directory ready", { outDir });

  const supervisor = new SidecarSupervisor({
    command: PYTHON,
    args: ["-u", "-m", "forensics_bridge.ipc_server"],
    cwd: SIDECAR_ROOT,
    healthCheckIntervalMs: 0,
    env: { PYTHONPATH: SIDECAR_ROOT },
  });
  supervisor.on("log", (line) => process.stderr.write(`[sidecar] ${line}\n`));

  await supervisor.start({ readyTimeoutMs: 10_000 });
  log("info", "sidecar ready");

  const adapter = new SystemDataAdapter({ supervisor });

  try {
    if (args.list) {
      const devices = await supervisor.invoke("android.list_devices");
      console.log(JSON.stringify(devices, null, 2));
      return;
    }

    const include = resolveInclude(args);
    log("info", "include resolved", include);

    // 1. authenticate
    const auth = await adapter.authenticate({
      dataPaths: Object.keys(args.dataPaths).length ? args.dataPaths : undefined,
      serial: args.serial || undefined,
    });
    log("info", "authenticated", auth);
    if (!auth.ok) {
      log("error", "authentication failed", auth);
      process.exit(1);
    }

    // 2. drain sync stream + validate every entity
    const entitiesByType = { person: [], event: [], place: [], item: [], topic: [] };
    const invalid = [];
    let total = 0;
    const t0 = Date.now();

    const scratchDir = path.join(outDir, "scratch");
    fs.mkdirSync(scratchDir, { recursive: true });

    const progressEvents = [];
    for await (const raw of adapter.sync({
      include,
      serial: args.serial || undefined,
      extractMode: args.extractMode,
      dataPaths: Object.keys(args.dataPaths).length ? args.dataPaths : undefined,
      scratchDir,
      onProgress: (msg) => {
        progressEvents.push(msg);
        if (msg.phase === "progress") return; // too chatty
        log("info", `adapter:${msg.source}`, msg);
      },
    })) {
      total += 1;
      const bucket = entitiesByType[raw.entityType];
      if (bucket) bucket.push(raw.payload);

      // Cross-source schema validation
      const v = validate(raw.payload);
      if (!v.valid) {
        invalid.push({
          id: raw.payload && raw.payload.id,
          entityType: raw.entityType,
          errors: v.errors,
        });
      }
    }
    const wallMs = Date.now() - t0;

    log("info", "sync drained", {
      wallMs,
      total,
      persons: entitiesByType.person.length,
      events: entitiesByType.event.length,
      places: entitiesByType.place.length,
      invalidCount: invalid.length,
    });

    if (invalid.length) {
      log("error", "validation failed", { count: invalid.length });
      fs.writeFileSync(
        path.join(outDir, "validation-errors.json"),
        JSON.stringify(invalid, null, 2),
      );
      process.exitCode = 2;
    } else {
      log("info", "all entities passed UnifiedSchema validation");
    }

    // 3. write per-source NormalizedBatch JSON dumps for inspection
    const dump = {
      schemaVersion: "0.1.0",
      generatedAt: new Date().toISOString(),
      adapter: "system-data",
      adapterVersion: adapter.version,
      include,
      input: {
        serial: args.serial || null,
        extractMode: args.extractMode,
        dataPaths: args.dataPaths,
      },
      wallMs,
      totals: {
        persons: entitiesByType.person.length,
        events: entitiesByType.event.length,
        places: entitiesByType.place.length,
        invalid: invalid.length,
      },
      progressEvents,
      persons: entitiesByType.person,
      events: entitiesByType.event,
      places: entitiesByType.place,
    };
    const dumpPath = path.join(outDir, "system-data-batch.json");
    fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
    log("info", "wrote dump", { dumpPath, bytes: fs.statSync(dumpPath).size });

    log("info", "summary", {
      total,
      persons: entitiesByType.person.length,
      events: entitiesByType.event.length,
      places: entitiesByType.place.length,
      invalid: invalid.length,
      wallMs,
      outDir,
    });
  } finally {
    await supervisor.stop({ graceMs: 2000 });
  }
}

main(process.argv.slice(2)).catch((err) => {
  log("error", "fatal", { name: err.name, message: err.message, code: err.code });
  if (err.stack) process.stderr.write(err.stack + "\n");
  process.exit(1);
});
