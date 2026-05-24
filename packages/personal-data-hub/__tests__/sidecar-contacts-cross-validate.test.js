"use strict";

/**
 * Cross-validate that Persons produced by the Python sidecar's
 * `system.parse_contacts` method pass the hub-side UnifiedSchema validator.
 *
 * Without this test, sidecar and hub can drift silently: sidecar emits
 * fields the schema rejects, or skips required ones. Run against a real
 * sidecar subprocess + synthesized contacts2.db.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";

const { SidecarSupervisor } = require("../lib/sidecar");
const { validatePerson } = require("../lib/schemas");
const Database = require("better-sqlite3-multiple-ciphers");

const SIDECAR_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "personal-data-hub-bridge",
);

let pythonAvailable = true;
try {
  const probe = spawnSync(
    process.env.FORENSICS_BRIDGE_PYTHON || "python",
    ["--version"],
    { stdio: "ignore" },
  );
  if (probe.status !== 0) pythonAvailable = false;
} catch (_err) {
  pythonAvailable = false;
}

// Probe bs3mc — fixture seeding opens an unencrypted SQLite file via
// better-sqlite3-multiple-ciphers, which fails on dev boxes where the root
// node_modules binding was compiled for Electron's NODE_MODULE_VERSION
// instead of the host Node ABI. Skip cleanly when the native binding
// can't load; CI Linux builds get a Node-ABI binary and runs the full path.
let bs3mcAvailable = true;
try {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bs3mc-contacts-probe-"));
  const probeDb = new Database(path.join(probeDir, "p.db"));
  probeDb.close();
  fs.rmSync(probeDir, { recursive: true, force: true });
} catch (_err) {
  bs3mcAvailable = false;
}

// FTS5 sandbox runner: the relative path to personal-data-hub-bridge
// resolves outside the temp tree. Without this gate the spawn fails with
// ENOENT during beforeAll instead of skipping cleanly.
const sidecarRootAvailable = fs.existsSync(SIDECAR_ROOT);

const describePy =
  pythonAvailable && bs3mcAvailable && sidecarRootAvailable
    ? describe
    : describe.skip;

function seedFixtureContactsDb(dbPath) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE raw_contacts (
        _id INTEGER PRIMARY KEY,
        display_name TEXT,
        starred INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0
      );
      CREATE TABLE mimetypes (
        _id INTEGER PRIMARY KEY,
        mimetype TEXT NOT NULL UNIQUE
      );
      CREATE TABLE data (
        _id INTEGER PRIMARY KEY,
        raw_contact_id INTEGER NOT NULL,
        mimetype_id INTEGER NOT NULL,
        data1 TEXT
      );
    `);
    const mimetypes = {
      "vnd.android.cursor.item/phone_v2": 5,
      "vnd.android.cursor.item/email_v2": 1,
      "vnd.android.cursor.item/organization": 4,
      "vnd.android.cursor.item/note": 10,
    };
    const insertMime = db.prepare(
      "INSERT INTO mimetypes (_id, mimetype) VALUES (?, ?)",
    );
    for (const [mt, mid] of Object.entries(mimetypes)) insertMime.run(mid, mt);

    const insertContact = db.prepare(
      "INSERT INTO raw_contacts (_id, display_name, starred, deleted) VALUES (?, ?, ?, 0)",
    );
    insertContact.run(1, "妈妈", 1);
    insertContact.run(2, "张三", 0);

    const insertData = db.prepare(
      "INSERT INTO data (raw_contact_id, mimetype_id, data1) VALUES (?, ?, ?)",
    );
    insertData.run(1, mimetypes["vnd.android.cursor.item/phone_v2"], "13800001111");
    insertData.run(1, mimetypes["vnd.android.cursor.item/phone_v2"], "13900002222");
    insertData.run(1, mimetypes["vnd.android.cursor.item/email_v2"], "mom@example.com");
    insertData.run(2, mimetypes["vnd.android.cursor.item/phone_v2"], "13711112222");
  } finally {
    db.close();
  }
}

describePy("sidecar.system.parse_contacts × hub.validatePerson", () => {
  let supervisor;
  let tmpDir;
  let dbPath;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phdb-sidecar-contacts-"));
    dbPath = path.join(tmpDir, "contacts2.db");
    seedFixtureContactsDb(dbPath);

    supervisor = new SidecarSupervisor({
      command: process.env.FORENSICS_BRIDGE_PYTHON || "python",
      args: ["-u", "-m", "forensics_bridge.ipc_server"],
      cwd: SIDECAR_ROOT,
      healthCheckIntervalMs: 0,
      env: { PYTHONPATH: SIDECAR_ROOT },
    });
    await supervisor.start({ readyTimeoutMs: 8_000 });
  }, 15_000);

  afterAll(async () => {
    if (supervisor) await supervisor.stop({ graceMs: 1500 });
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_err) {
        /* best effort */
      }
    }
  });

  it("emits Persons that pass hub UnifiedSchema validation", async () => {
    const persons = [];
    const result = await supervisor.invoke(
      "system.parse_contacts",
      { data_path: dbPath, device_serial: "24115RA8EC-test" },
      {
        timeoutMs: 10_000,
        onChunk: (batch) => {
          for (const p of batch.persons || []) persons.push(p);
        },
      },
    );

    expect(result.status).toBe("ok");
    expect(result.totalPersons).toBe(2);
    expect(persons).toHaveLength(2);

    for (const person of persons) {
      const validation = validatePerson(person);
      if (!validation.valid) {
        // Dump the offender so CI failures are debuggable without re-running.
        console.error(
          "validatePerson failed for",
          JSON.stringify(person, null, 2),
          "errors:",
          validation.errors,
        );
      }
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    }

    // Spot-check shape — mom has phones+email+starred+notes? (notes none in this fixture)
    const mom = persons.find((p) => p.names[0] === "妈妈");
    expect(mom.identifiers.phone).toEqual(["13800001111", "13900002222"]);
    expect(mom.identifiers.email).toEqual(["mom@example.com"]);
    expect(mom.extra.starred).toBe(true);
    expect(mom.extra.deviceSerial).toBe("24115RA8EC-test");
  });
});
