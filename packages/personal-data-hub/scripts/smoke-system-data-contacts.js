#!/usr/bin/env node
/**
 * Smoke / real-device runner for Phase 4.5.2 — Contacts extraction.
 *
 * Drives the full vertical:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 1. (optional) android.list_devices                           │
 *   │ 2. (optional) android.pull_file  /data/.../contacts2.db      │
 *   │ 3. system.parse_contacts → Persons                           │
 *   │ 4. hub-side UnifiedSchema validatePerson() on every row       │
 *   │ 5. write NormalizedBatch JSON to ./out/<timestamp>/           │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Three modes:
 *
 *   --db <path>          Skip ADB entirely; parse a contacts2.db already
 *                        on disk. Best for first-run sanity on the dev box.
 *
 *   --serial <serial>    Run `adb pull` first. Requires `adb root` (most
 *                        retail builds reject this) OR a userdebug build.
 *                        On a stock Redmi 24115RA8EC use --workaround.
 *
 *   --workaround sdcard  Look for a contacts2.db copy at
 *                        /sdcard/Download/contacts2.db (you copied it
 *                        out via Termux + tsu, or via Mi cloud export,
 *                        per docs/design/Adapter_System_Data.md §2.1).
 *
 * Usage examples:
 *
 *     # Local fixture
 *     node scripts/smoke-system-data-contacts.js --db ./fixtures/contacts2.db
 *
 *     # List devices, then prompt for serial
 *     node scripts/smoke-system-data-contacts.js --list
 *
 *     # Real device with /sdcard workaround
 *     node scripts/smoke-system-data-contacts.js \
 *         --serial 24115RA8ECabc123 --workaround sdcard
 *
 * Exits non-zero on any sidecar error or schema validation failure.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { SidecarSupervisor } = require("../lib/sidecar");
const { validatePerson } = require("../lib/schemas");

const SIDECAR_ROOT = path.resolve(__dirname, "..", "..", "personal-data-hub-bridge");
const PYTHON = process.env.FORENSICS_BRIDGE_PYTHON || "python";

const SDCARD_WORKAROUND_PATH = "/sdcard/Download/contacts2.db";
const SYSTEM_PROVIDER_PATH =
  "/data/data/com.android.providers.contacts/databases/contacts2.db";

// ---------------------------------------------------------------------------
// CLI parsing — kept dependency-free
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    db: null,
    serial: null,
    workaround: null,
    list: false,
    outDir: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case "--db":
        out.db = argv[++i];
        break;
      case "--serial":
        out.serial = argv[++i];
        break;
      case "--workaround":
        out.workaround = argv[++i];
        break;
      case "--list":
        out.list = true;
        break;
      case "--out":
        out.outDir = argv[++i];
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        if (a.startsWith("--")) {
          throw new Error(`unknown flag: ${a}`);
        }
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
smoke-system-data-contacts — drive sidecar end-to-end for contacts.

  --db <path>             Parse a contacts2.db already on disk (skip ADB).
  --serial <serial>       Target this ADB device for the pull step.
  --workaround sdcard     Pull from ${SDCARD_WORKAROUND_PATH} instead of /data/data.
                          Required on stock Android (no adb root).
  --list                  Just list ADB devices and exit.
  --out <dir>             Write NormalizedBatch JSON here. Default: ./out/<ts>.
  -h, --help              Show this help.

Env:
  FORENSICS_BRIDGE_PYTHON   override Python interpreter (default: python).

Exit codes:
  0  success
  1  sidecar / hub error
  2  invalid Persons (schema validation failed)
`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestampSlug() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-` +
    `${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
  );
}

function makeSupervisor() {
  return new SidecarSupervisor({
    command: PYTHON,
    args: ["-u", "-m", "forensics_bridge.ipc_server"],
    cwd: SIDECAR_ROOT,
    healthCheckIntervalMs: 0,
    env: { PYTHONPATH: SIDECAR_ROOT },
  });
}

function log(level, msg, extra = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...extra,
  });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

// ---------------------------------------------------------------------------
// Main
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
  if (args.help) {
    printHelp();
    return;
  }

  const outDir = path.resolve(
    args.outDir || path.join(process.cwd(), "out", timestampSlug()),
  );
  fs.mkdirSync(outDir, { recursive: true });
  log("info", "output directory ready", { outDir });

  const sup = makeSupervisor();
  // Stream sidecar pino-style logs out as ndjson so the user sees timing.
  sup.on("log", (line) => process.stderr.write(`[sidecar] ${line}\n`));

  await sup.start({ readyTimeoutMs: 10_000 });
  log("info", "sidecar ready");

  try {
    // ---------- list-only path ----------
    if (args.list) {
      const devices = await sup.invoke("android.list_devices");
      log("info", "adb devices", devices);
      console.log(JSON.stringify(devices, null, 2));
      return;
    }

    // ---------- choose source for contacts2.db ----------
    let dbPath = args.db ? path.resolve(args.db) : null;

    if (!dbPath) {
      if (!args.serial) {
        throw new Error(
          "neither --db nor --serial provided; nothing to extract",
        );
      }
      const remotePath =
        args.workaround === "sdcard" ? SDCARD_WORKAROUND_PATH : SYSTEM_PROVIDER_PATH;
      log("info", "pulling from device", { serial: args.serial, remotePath });
      const pulled = await sup.invoke(
        "android.pull_file",
        {
          serial: args.serial,
          remote_path: remotePath,
          local_dir: outDir,
        },
        { timeoutMs: 60_000 },
      );
      log("info", "pull completed", pulled);
      dbPath = pulled.local;
    }

    if (!fs.existsSync(dbPath)) {
      throw new Error(`contacts db not found at ${dbPath}`);
    }

    // ---------- parse + validate ----------
    const persons = [];
    let chunks = 0;
    const t0 = Date.now();
    const parseResult = await sup.invoke(
      "system.parse_contacts",
      {
        data_path: dbPath,
        device_serial: args.serial || null,
      },
      {
        timeoutMs: 120_000,
        onProgress: (p) => log("info", "progress", p),
        onChunk: (batch) => {
          chunks += 1;
          for (const person of batch.persons || []) persons.push(person);
        },
      },
    );
    const wallMs = Date.now() - t0;
    log("info", "parse completed", {
      ...parseResult,
      chunks,
      wallMs,
      personsCollected: persons.length,
    });

    // ---------- hub-side schema check ----------
    const invalid = [];
    for (const p of persons) {
      const v = validatePerson(p);
      if (!v.valid) invalid.push({ id: p.id, errors: v.errors });
    }
    if (invalid.length) {
      log("error", "validation failed", { count: invalid.length });
      fs.writeFileSync(
        path.join(outDir, "validation-errors.json"),
        JSON.stringify(invalid, null, 2),
      );
      process.exitCode = 2;
    } else {
      log("info", "all persons passed UnifiedSchema validation");
    }

    // ---------- persist for inspection ----------
    const dump = {
      schemaVersion: "0.1.0",
      generatedAt: new Date().toISOString(),
      sidecar: { pythonRoot: SIDECAR_ROOT },
      input: {
        dbPath,
        serial: args.serial || null,
        workaround: args.workaround || null,
      },
      parseResult,
      wallMs,
      persons,
    };
    const dumpPath = path.join(outDir, "contacts-normalized-batch.json");
    fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
    log("info", "wrote dump", { dumpPath, bytes: fs.statSync(dumpPath).size });

    // ---------- compact summary ----------
    log("info", "summary", {
      totalPersons: parseResult.totalPersons,
      withPhone: parseResult.stats?.with_phone,
      withEmail: parseResult.stats?.with_email,
      starred: parseResult.stats?.starred,
      invalidPersons: invalid.length,
      outDir,
    });
  } finally {
    await sup.stop({ graceMs: 2000 });
  }
}

main(process.argv.slice(2)).catch((err) => {
  log("error", "fatal", { name: err.name, message: err.message, code: err.code });
  if (err.stack) process.stderr.write(err.stack + "\n");
  process.exit(1);
});
