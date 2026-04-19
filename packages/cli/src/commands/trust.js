/**
 * `cc trust` — CLI surface for Phase 68-71 Trust & Security.
 */

import { Command } from "commander";

import {
  TRUST_ANCHOR,
  ATTESTATION_STATUS,
  SATELLITE_PROVIDER,
  SAT_MESSAGE_STATUS,
  HSM_VENDOR,
  COMPLIANCE_LEVEL,
  ensureTrustSecurityTables,
  attest,
  getAttestation,
  listAttestations,
  runInteropTest,
  listInteropTests,
  sendSatelliteMessage,
  updateSatMessageStatus,
  getSatMessage,
  listSatMessages,
  registerHsmDevice,
  removeHsmDevice,
  getHsmDevice,
  listHsmDevices,
  signWithHsm,
  getTrustSecurityStats,
  HSM_MATURITY_V2,
  TRANSMISSION_V2,
  getMaxActiveDevicesPerOperator,
  setMaxActiveDevicesPerOperator,
  getMaxPendingTransmissionsPerDevice,
  setMaxPendingTransmissionsPerDevice,
  getDeviceIdleMs,
  setDeviceIdleMs,
  getTransmissionStuckMs,
  setTransmissionStuckMs,
  getActiveDeviceCount,
  getPendingTransmissionCount,
  registerDeviceV2,
  getDeviceV2,
  listDevicesV2,
  setDeviceMaturityV2,
  activateDevice,
  degradeDevice,
  retireDevice,
  touchDeviceUsage,
  enqueueTransmissionV2,
  getTransmissionV2,
  listTransmissionsV2,
  setTransmissionStatusV2,
  startTransmission,
  confirmTransmission,
  failTransmission,
  cancelTransmission,
  autoRetireIdleDevices,
  autoFailStuckTransmissions,
  getTrustSecurityStatsV2,
} from "../lib/trust-security.js";

function _parseJsonV2(s) {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`invalid JSON: ${s}`);
  }
}

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerTrustCommand(program) {
  const tr = new Command("trust")
    .description("Trust & security (Phase 68-71)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureTrustSecurityTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  tr.command("anchors")
    .description("List trust anchors")
    .option("--json", "JSON output")
    .action((opts) => {
      const anchors = Object.values(TRUST_ANCHOR);
      if (opts.json) return console.log(JSON.stringify(anchors, null, 2));
      for (const a of anchors) console.log(`  ${a}`);
    });

  tr.command("hsm-vendors")
    .description("List HSM vendors")
    .option("--json", "JSON output")
    .action((opts) => {
      const vendors = Object.values(HSM_VENDOR);
      if (opts.json) return console.log(JSON.stringify(vendors, null, 2));
      for (const v of vendors) console.log(`  ${v}`);
    });

  tr.command("compliance-levels")
    .description("List compliance levels")
    .option("--json", "JSON output")
    .action((opts) => {
      const levels = Object.values(COMPLIANCE_LEVEL);
      if (opts.json) return console.log(JSON.stringify(levels, null, 2));
      for (const l of levels) console.log(`  ${l}`);
    });

  tr.command("sat-providers")
    .description("List satellite providers")
    .option("--json", "JSON output")
    .action((opts) => {
      const providers = Object.values(SATELLITE_PROVIDER);
      if (opts.json) return console.log(JSON.stringify(providers, null, 2));
      for (const p of providers) console.log(`  ${p}`);
    });

  /* ── Trust Root (Phase 68) ───────────────────────── */

  tr.command("attest <anchor>")
    .description("Execute trust attestation (tpm/tee/secure_element)")
    .option("-c, --challenge <hex>", "Challenge value")
    .option("-f, --fingerprint <hash>", "Device fingerprint")
    .option("--json", "JSON output")
    .action((anchor, opts) => {
      const db = _dbFromCtx(tr);
      const result = attest(db, {
        anchor,
        challenge: opts.challenge,
        deviceFingerprint: opts.fingerprint,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.attestationId) {
        console.log(`Attestation: ${result.attestationId}`);
        console.log(`Status:      ${result.status}`);
        console.log(`Response:    ${result.response}`);
      } else console.log(`Failed: ${result.reason}`);
    });

  tr.command("attest-show <id>")
    .description("Show attestation details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(tr);
      const a = getAttestation(db, id);
      if (!a) return console.log("Attestation not found.");
      if (opts.json) return console.log(JSON.stringify(a, null, 2));
      console.log(`ID:          ${a.id}`);
      console.log(`Anchor:      ${a.anchor}`);
      console.log(`Status:      ${a.status}`);
      console.log(`Challenge:   ${a.challenge}`);
      console.log(`Response:    ${a.response}`);
      if (a.device_fingerprint)
        console.log(`Fingerprint: ${a.device_fingerprint}`);
    });

  tr.command("attestations")
    .description("List attestations")
    .option("-a, --anchor <type>", "Filter by anchor")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(tr);
      const atts = listAttestations(db, {
        anchor: opts.anchor,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(atts, null, 2));
      if (atts.length === 0) return console.log("No attestations.");
      for (const a of atts) {
        console.log(
          `  ${a.status.padEnd(10)} ${a.anchor.padEnd(16)} ${a.id.slice(0, 8)}`,
        );
      }
    });

  /* ── PQC Interop (Phase 69) ──────────────────────── */

  tr.command("interop-test <algorithm>")
    .description("Run PQC interoperability test")
    .option("-p, --peer <id>", "Peer identifier")
    .option("-l, --latency <ms>", "Latency in ms", parseInt)
    .option("--json", "JSON output")
    .action((algorithm, opts) => {
      const db = _dbFromCtx(tr);
      const result = runInteropTest(db, algorithm, {
        peer: opts.peer,
        latencyMs: opts.latency,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.testId) {
        console.log(`Test: ${result.testId}`);
        console.log(
          `Compatible: ${result.compatible ? "YES" : "NO"}  (${result.result})`,
        );
        console.log(`Latency: ${result.latencyMs}ms`);
      } else console.log(`Failed: ${result.reason}`);
    });

  tr.command("interop-tests")
    .description("List PQC interop tests")
    .option("-a, --algorithm <algo>", "Filter by algorithm")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(tr);
      const tests = listInteropTests(db, {
        algorithm: opts.algorithm,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(tests, null, 2));
      if (tests.length === 0) return console.log("No interop tests.");
      for (const t of tests) {
        console.log(
          `  ${t.compatible ? "PASS" : "FAIL"}  ${t.algorithm.padEnd(16)} ${t.latency_ms}ms  ${t.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Satellite (Phase 70) ────────────────────────── */

  tr.command("sat-send <payload>")
    .description("Send satellite message")
    .option("-p, --provider <name>", "Provider (iridium/starlink/beidou)")
    .option("-r, --priority <n>", "Priority (1-10)", parseInt)
    .option("--json", "JSON output")
    .action((payload, opts) => {
      const db = _dbFromCtx(tr);
      const result = sendSatelliteMessage(db, payload, {
        provider: opts.provider,
        priority: opts.priority,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.messageId) console.log(`Message queued: ${result.messageId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  tr.command("sat-status <id> <status>")
    .description("Update satellite message status")
    .option("--json", "JSON output")
    .action((id, status, opts) => {
      const db = _dbFromCtx(tr);
      const result = updateSatMessageStatus(db, id, status);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated ? "Status updated." : `Failed: ${result.reason}`,
      );
    });

  tr.command("sat-show <id>")
    .description("Show satellite message")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(tr);
      const m = getSatMessage(db, id);
      if (!m) return console.log("Message not found.");
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`ID:       ${m.id}`);
      console.log(`Provider: ${m.provider}`);
      console.log(`Priority: ${m.priority}`);
      console.log(`Status:   ${m.status}`);
      console.log(`Payload:  ${m.payload}`);
      if (m.sent_at)
        console.log(`Sent:     ${new Date(m.sent_at).toISOString()}`);
      if (m.confirmed_at)
        console.log(`Confirmed: ${new Date(m.confirmed_at).toISOString()}`);
    });

  tr.command("sat-messages")
    .description("List satellite messages")
    .option("-p, --provider <name>", "Filter by provider")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(tr);
      const msgs = listSatMessages(db, {
        provider: opts.provider,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(msgs, null, 2));
      if (msgs.length === 0) return console.log("No messages.");
      for (const m of msgs) {
        console.log(
          `  ${m.status.padEnd(12)} ${m.provider.padEnd(10)} prio=${m.priority}  ${m.id.slice(0, 8)}`,
        );
      }
    });

  /* ── HSM (Phase 71) ──────────────────────────────── */

  tr.command("hsm-register <vendor>")
    .description("Register HSM device")
    .option("-m, --model <name>", "Device model")
    .option("-s, --serial <sn>", "Serial number")
    .option("-c, --compliance <level>", "Compliance level")
    .option("-f, --firmware <version>", "Firmware version")
    .option("--json", "JSON output")
    .action((vendor, opts) => {
      const db = _dbFromCtx(tr);
      const result = registerHsmDevice(db, vendor, {
        model: opts.model,
        serialNumber: opts.serial,
        complianceLevel: opts.compliance,
        firmwareVersion: opts.firmware,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.deviceId) console.log(`HSM registered: ${result.deviceId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  tr.command("hsm-remove <id>")
    .description("Remove HSM device")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(tr);
      const result = removeHsmDevice(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(result.removed ? "HSM removed." : `Failed: ${result.reason}`);
    });

  tr.command("hsm-show <id>")
    .description("Show HSM device details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(tr);
      const d = getHsmDevice(db, id);
      if (!d) return console.log("Device not found.");
      if (opts.json) return console.log(JSON.stringify(d, null, 2));
      console.log(`ID:         ${d.id}`);
      console.log(`Vendor:     ${d.vendor}`);
      if (d.model) console.log(`Model:      ${d.model}`);
      if (d.serial_number) console.log(`Serial:     ${d.serial_number}`);
      if (d.compliance_level) console.log(`Compliance: ${d.compliance_level}`);
      if (d.firmware_version) console.log(`Firmware:   ${d.firmware_version}`);
    });

  tr.command("hsm-devices")
    .description("List HSM devices")
    .option("-v, --vendor <name>", "Filter by vendor")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(tr);
      const devs = listHsmDevices(db, {
        vendor: opts.vendor,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(devs, null, 2));
      if (devs.length === 0) return console.log("No HSM devices.");
      for (const d of devs) {
        console.log(
          `  ${d.vendor.padEnd(10)} ${(d.model || "").padEnd(16)} ${(d.compliance_level || "").padEnd(12)} ${d.id.slice(0, 8)}`,
        );
      }
    });

  tr.command("hsm-sign <device-id>")
    .description("Sign data with HSM")
    .option("-d, --data <text>", "Data to sign")
    .option("-a, --algorithm <algo>", "Algorithm")
    .option("--json", "JSON output")
    .action((deviceId, opts) => {
      const db = _dbFromCtx(tr);
      const result = signWithHsm(db, deviceId, {
        data: opts.data,
        algorithm: opts.algorithm,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.signature) {
        console.log(`Signature: ${result.signature}`);
        console.log(`Algorithm: ${result.algorithm}`);
      } else console.log(`Failed: ${result.reason}`);
    });

  /* ── Stats ───────────────────────────────────────── */

  tr.command("stats")
    .description("Trust & security statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(tr);
      const s = getTrustSecurityStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Attestations: ${s.attestations.total}  (${s.attestations.valid} valid)`,
      );
      console.log(
        `PQC Tests:    ${s.interopTests.total}  (${s.interopTests.compatible} compatible, avg ${s.interopTests.avgLatencyMs}ms)`,
      );
      console.log(
        `Satellite:    ${s.satellite.total}  (${s.satellite.queued} queued, ${s.satellite.confirmed} confirmed)`,
      );
      console.log(`HSM Devices:  ${s.hsm.total}`);
    });

  /* ── V2 Surface (Phase 68-71) ─────────────────────────── */

  tr.command("hsm-maturities-v2")
    .description("List HSM_MATURITY_V2 enum")
    .action(() => {
      for (const v of Object.values(HSM_MATURITY_V2)) console.log(`  ${v}`);
    });

  tr.command("transmissions-v2")
    .description("List TRANSMISSION_V2 enum")
    .action(() => {
      for (const v of Object.values(TRANSMISSION_V2)) console.log(`  ${v}`);
    });

  tr.command("max-active-devices-per-operator")
    .description("Get current max-active-devices-per-operator cap")
    .action(() => console.log(getMaxActiveDevicesPerOperator()));
  tr.command("set-max-active-devices-per-operator <n>").action((n) =>
    console.log(setMaxActiveDevicesPerOperator(Number(n))),
  );

  tr.command("max-pending-transmissions-per-device")
    .description("Get current max-pending-transmissions-per-device cap")
    .action(() => console.log(getMaxPendingTransmissionsPerDevice()));
  tr.command("set-max-pending-transmissions-per-device <n>").action((n) =>
    console.log(setMaxPendingTransmissionsPerDevice(Number(n))),
  );

  tr.command("device-idle-ms")
    .description("Get current device-idle-ms threshold")
    .action(() => console.log(getDeviceIdleMs()));
  tr.command("set-device-idle-ms <n>").action((n) =>
    console.log(setDeviceIdleMs(Number(n))),
  );

  tr.command("transmission-stuck-ms")
    .description("Get current transmission-stuck-ms threshold")
    .action(() => console.log(getTransmissionStuckMs()));
  tr.command("set-transmission-stuck-ms <n>").action((n) =>
    console.log(setTransmissionStuckMs(Number(n))),
  );

  tr.command("active-device-count")
    .description("Count active+degraded devices (optionally by operator)")
    .option("-o, --operator <operator>", "scope to operator")
    .action((opts) => console.log(getActiveDeviceCount(opts.operator)));

  tr.command("pending-transmission-count")
    .description("Count non-terminal transmissions (optionally by device)")
    .option("-d, --device <device>", "scope to device")
    .action((opts) => console.log(getPendingTransmissionCount(opts.device)));

  tr.command("register-device-v2 <device-id>")
    .description("Register V2 HSM device")
    .requiredOption("-o, --operator <operator>", "operator id")
    .requiredOption("-v, --vendor <vendor>", "HSM vendor")
    .option(
      "-i, --initial <status>",
      "initial status",
      HSM_MATURITY_V2.PROVISIONAL,
    )
    .option("--metadata <json>", "metadata JSON")
    .action((id, opts) => {
      const d = registerDeviceV2({
        id,
        operator: opts.operator,
        vendor: opts.vendor,
        initialStatus: opts.initial,
        metadata: _parseJsonV2(opts.metadata),
      });
      console.log(JSON.stringify(d, null, 2));
    });

  tr.command("device-v2 <device-id>")
    .description("Show V2 device")
    .action((id) => {
      const d = getDeviceV2(id);
      if (!d) return console.error(`device ${id} not found`);
      console.log(JSON.stringify(d, null, 2));
    });

  tr.command("list-devices-v2")
    .description("List V2 devices")
    .option("-o, --operator <operator>", "filter by operator")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      console.log(JSON.stringify(listDevicesV2(opts), null, 2)),
    );

  tr.command("set-device-maturity-v2 <device-id> <status>")
    .description("Transition V2 device maturity")
    .option("-r, --reason <reason>", "transition reason")
    .option("--metadata <json>", "metadata patch JSON")
    .action((id, status, opts) => {
      const d = setDeviceMaturityV2(id, status, {
        reason: opts.reason,
        metadata: _parseJsonV2(opts.metadata),
      });
      console.log(JSON.stringify(d, null, 2));
    });

  for (const [name, fn] of [
    ["activate-device", activateDevice],
    ["degrade-device", degradeDevice],
    ["retire-device", retireDevice],
  ]) {
    tr.command(`${name} <device-id>`)
      .description(`Shortcut for ${name.replace("-device", "")} transition`)
      .option("-r, --reason <reason>", "transition reason")
      .action((id, opts) => {
        const d = fn(id, { reason: opts.reason });
        console.log(JSON.stringify(d, null, 2));
      });
  }

  tr.command("touch-device-usage <device-id>")
    .description("Mark V2 device as used now")
    .action((id) => {
      const d = touchDeviceUsage(id);
      console.log(JSON.stringify(d, null, 2));
    });

  tr.command("enqueue-transmission-v2 <transmission-id>")
    .description("Enqueue V2 satellite transmission")
    .requiredOption("-d, --device <device>", "device id")
    .requiredOption("-p, --provider <provider>", "satellite provider")
    .requiredOption("-x, --payload <payload>", "message payload")
    .option("--metadata <json>", "metadata JSON")
    .action((id, opts) => {
      const t = enqueueTransmissionV2({
        id,
        deviceId: opts.device,
        provider: opts.provider,
        payload: opts.payload,
        metadata: _parseJsonV2(opts.metadata),
      });
      console.log(JSON.stringify(t, null, 2));
    });

  tr.command("transmission-v2 <transmission-id>")
    .description("Show V2 transmission")
    .action((id) => {
      const t = getTransmissionV2(id);
      if (!t) return console.error(`transmission ${id} not found`);
      console.log(JSON.stringify(t, null, 2));
    });

  tr.command("list-transmissions-v2")
    .description("List V2 transmissions")
    .option("-d, --device <device>", "filter by device")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      console.log(JSON.stringify(listTransmissionsV2(opts), null, 2)),
    );

  tr.command("set-transmission-status-v2 <transmission-id> <status>")
    .option("-r, --reason <reason>", "transition reason")
    .option("--metadata <json>", "metadata patch JSON")
    .action((id, status, opts) => {
      const t = setTransmissionStatusV2(id, status, {
        reason: opts.reason,
        metadata: _parseJsonV2(opts.metadata),
      });
      console.log(JSON.stringify(t, null, 2));
    });

  for (const [name, fn] of [
    ["start-transmission", startTransmission],
    ["confirm-transmission", confirmTransmission],
    ["fail-transmission", failTransmission],
    ["cancel-transmission", cancelTransmission],
  ]) {
    tr.command(`${name} <transmission-id>`)
      .description(
        `Shortcut for ${name.replace("-transmission", "")} transition`,
      )
      .option("-r, --reason <reason>", "transition reason")
      .action((id, opts) => {
        const t = fn(id, { reason: opts.reason });
        console.log(JSON.stringify(t, null, 2));
      });
  }

  tr.command("auto-retire-idle-devices")
    .description(
      "Bulk-retire ACTIVE/DEGRADED devices whose lastUsedAt is older than deviceIdleMs",
    )
    .action(() =>
      console.log(
        JSON.stringify({ flipped: autoRetireIdleDevices() }, null, 2),
      ),
    );

  tr.command("auto-fail-stuck-transmissions")
    .description(
      "Bulk-fail SENDING transmissions whose startedAt is older than transmissionStuckMs",
    )
    .action(() =>
      console.log(
        JSON.stringify({ flipped: autoFailStuckTransmissions() }, null, 2),
      ),
    );

  tr.command("stats-v2")
    .description("Show V2 trust/security stats")
    .action(() =>
      console.log(JSON.stringify(getTrustSecurityStatsV2(), null, 2)),
    );

  program.addCommand(tr);
}

// === Iter18 V2 governance overlay ===
export function registerTrustgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "trust");
  if (!parent) return;
  const L = async () => await import("../lib/trust-security.js");
  parent
    .command("trustgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.TRUSTGOV_PROFILE_MATURITY_V2,
            checkLifecycle: m.TRUSTGOV_CHECK_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("trustgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveTrustgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingTrustgovChecksPerProfileV2(),
            idleMs: m.getTrustgovProfileIdleMsV2(),
            stuckMs: m.getTrustgovCheckStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("trustgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveTrustgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("trustgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingTrustgovChecksPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("trustgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setTrustgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("trustgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setTrustgovCheckStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("trustgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--level <v>", "level")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerTrustgovProfileV2({ id, owner, level: o.level }),
          null,
          2,
        ),
      );
    });
  parent
    .command("trustgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateTrustgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("trustgov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suspendTrustgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("trustgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveTrustgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("trustgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchTrustgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("trustgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getTrustgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("trustgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listTrustgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("trustgov-create-check-v2 <id> <profileId>")
    .description("Create check")
    .option("--subject <v>", "subject")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createTrustgovCheckV2({ id, profileId, subject: o.subject }),
          null,
          2,
        ),
      );
    });
  parent
    .command("trustgov-verifying-check-v2 <id>")
    .description("Mark check as verifying")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).verifyingTrustgovCheckV2(id), null, 2),
      );
    });
  parent
    .command("trustgov-complete-check-v2 <id>")
    .description("Complete check")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeCheckTrustgovV2(id), null, 2),
      );
    });
  parent
    .command("trustgov-fail-check-v2 <id> [reason]")
    .description("Fail check")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failTrustgovCheckV2(id, reason), null, 2),
      );
    });
  parent
    .command("trustgov-cancel-check-v2 <id> [reason]")
    .description("Cancel check")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelTrustgovCheckV2(id, reason), null, 2),
      );
    });
  parent
    .command("trustgov-get-check-v2 <id>")
    .description("Get check")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getTrustgovCheckV2(id), null, 2));
    });
  parent
    .command("trustgov-list-checks-v2")
    .description("List checks")
    .action(async () => {
      console.log(JSON.stringify((await L()).listTrustgovChecksV2(), null, 2));
    });
  parent
    .command("trustgov-auto-suspend-idle-v2")
    .description("Auto-suspend idle")
    .action(async () => {
      console.log(
        JSON.stringify(
          (await L()).autoSuspendIdleTrustgovProfilesV2(),
          null,
          2,
        ),
      );
    });
  parent
    .command("trustgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck checks")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckTrustgovChecksV2(), null, 2),
      );
    });
  parent
    .command("trustgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getTrustSecurityGovStatsV2(), null, 2),
      );
    });
}
