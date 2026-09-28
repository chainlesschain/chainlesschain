#!/usr/bin/env node

// A real-process capability probe for the newest hosted macOS image. A missing
// Seatbelt launcher is an expected fail-closed outcome, never enforcement.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executionBroker } from "../src/lib/process-execution-broker/index.js";

const reportPath = process.argv[2];
assert.ok(reportPath, "Pass an output JSON path");
assert.equal(process.platform, "darwin", "This probe requires macOS");

const launcherAvailable = fs.existsSync("/usr/bin/sandbox-exec");
const markerPath = path.join(
  os.homedir(),
  `.cc-seatbelt-capability-${process.pid}-${Date.now()}`,
);
const quotedMarker = `'${markerPath.replaceAll("'", "'\\''")}'`;
const command = "/bin/sh";
const args = [
  "-c",
  `if printf reached > ${quotedMarker} 2>/dev/null; then exit 77; fi; printf strict-ok`,
];
const report = {
  schemaVersion: 1,
  commit: process.env.SOURCE_SHA || null,
  runnerImage: process.env.ImageOS || null,
  osVersion: os.release(),
  architecture: process.arch,
  backend: "macos-seatbelt",
  launcherAvailable,
  stdio: "pipe",
  outcome: "probe-failed",
};

try {
  const control = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(control.error, undefined);
  assert.equal(control.status, 77, "Native control must write the marker");
  assert.equal(fs.readFileSync(markerPath, "utf8"), "reached");
  report.controlPassed = true;
  fs.unlinkSync(markerPath);

  process.env.CC_SANDBOX_STRICT = "1";
  delete process.env.CC_SANDBOX_DISABLE;
  executionBroker._sandboxEnabled = true;
  executionBroker._platformSandboxEnabled = true;
  executionBroker.flushAuditLog();

  let result;
  let failure;
  try {
    result = executionBroker.spawnSync(command, args, {
      origin: "ci:macos-latest-capability",
      policy: "allow",
      sandboxPolicy: { profile: "strict" },
      encoding: "utf8",
      timeout: 30_000,
      env: process.env,
    });
  } catch (error) {
    failure = error;
  }
  const audit = executionBroker.getAuditLog(1)[0];
  assert.equal(fs.existsSync(markerPath), false, "Broker wrote host home");

  if (launcherAvailable) {
    assert.equal(failure, undefined, "Available backend rejected launch");
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, "Seatbelt child must complete");
    assert.equal(result.stdout, "strict-ok");
    assert.equal(audit.sandboxed, true);
    assert.equal(audit.sandboxState, "ready");
    assert.equal(audit.sandboxEnforcement, "macos-seatbelt");
    report.outcome = "enforced";
  } else {
    assert.equal(result, undefined, "Missing backend launched a child");
    assert.equal(failure?.code, "ERR_PROCESS_SANDBOX");
    assert.equal(failure?.sandboxReason, "macos_sandbox_exec_unavailable");
    assert.equal(audit.sandboxed, false);
    assert.equal(audit.sandboxState, "denied");
    assert.equal(audit.sandboxReason, "macos_sandbox_exec_unavailable");
    report.outcome = "unavailable-fail-closed";
  }
  report.auditState = audit.sandboxState;
  report.sandboxReason = audit.sandboxReason || null;
} catch (error) {
  report.failure = {
    code: error.code || null,
    name: error.name || "Error",
  };
  throw error;
} finally {
  if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${report.outcome}\n`);
