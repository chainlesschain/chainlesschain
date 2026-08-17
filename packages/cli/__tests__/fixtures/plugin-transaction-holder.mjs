import fs from "node:fs";
import {
  _deps,
  finalizePluginUpdate,
  migratePluginProvenance,
  rollbackPluginUpdate,
  setPluginEnabled,
  uninstall,
  updatePlugin,
} from "../../src/lib/plugin-runtime/install.js";

const [
  cwd,
  source,
  pauseSpec = null,
  mode = null,
  scope = "project",
  operation = "update",
] = process.argv.slice(2);
if (!cwd || !source) {
  throw new Error("usage: plugin-transaction-holder.mjs <cwd> <source>");
}

let reported = false;
function reportReady(phase, result = null) {
  if (reported) return;
  reported = true;
  process.stdout.write(
    `${JSON.stringify({
      ready: true,
      pid: process.pid,
      phase,
      name: result?.name || "durable-process",
      version: result?.version || "2.0.0",
    })}\n`,
  );
}

function pauseForever() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

if (pauseSpec) {
  const before = pauseSpec.startsWith("before:");
  const requested = before ? pauseSpec.slice("before:".length) : pauseSpec;
  const hook = (_transaction, phase) => {
    if (phase !== requested) return;
    reportReady(before ? `before:${phase}` : phase);
    pauseForever();
  };
  if (before) _deps.beforeTransactionPhaseHook = hook;
  else _deps.transactionPhaseHook = hook;
}

if (operation === "enable" || operation === "disable") {
  const result = setPluginEnabled("durable-process", operation === "enable", {
    scope,
    cwd,
    allowSourceSwitch: true,
  });
  reportReady("marker-finalized", result);
  setInterval(() => {}, 60_000);
} else if (
  operation === "uninstall-version" ||
  operation === "uninstall-name"
) {
  const result = uninstall("durable-process", {
    scope,
    cwd,
    version: operation === "uninstall-version" ? "2.0.0" : undefined,
    allowSourceSwitch: true,
  });
  reportReady("uninstall-finalized", {
    name: "durable-process",
    version: result.removed?.[0] || null,
  });
  setInterval(() => {}, 60_000);
} else if (operation === "provenance-migrate") {
  const attestation = JSON.parse(fs.readFileSync(source, "utf8"));
  const result = migratePluginProvenance("durable-process", {
    scope,
    cwd,
    version: "1.0.0",
    attestation,
    expectedSignerSha256: attestation.expectedSignerSha256,
  });
  reportReady("provenance-finalized", result);
  setInterval(() => {}, 60_000);
} else {
  const result = updatePlugin(source, {
    scope,
    cwd,
    transactional: true,
    allowSourceSwitch: true,
    allowDowngrade: true,
    force: mode === "force" || mode === "force-rollback",
  });

  if (mode === "rollback" || mode === "force-rollback") {
    rollbackPluginUpdate(result);
    reportReady("rolled-back", result);
  } else if (mode === "finalize") {
    finalizePluginUpdate(result);
    reportReady("finalized", result);
  } else {
    reportReady("candidate-active", result);
  }

  setInterval(() => {}, 60_000);
}
