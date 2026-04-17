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
} from "../lib/trust-security.js";

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

  program.addCommand(tr);
}
