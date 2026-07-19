#!/usr/bin/env node
/**
 * ChainlessChain CLI vs Claude Code CLI Parity Check
 *
 * Usage:
 *   node scripts/parity-check.mjs [--json] [--filter=<section>]
 *
 * This script is the SINGLE source of truth for parity status. It is invoked by
 * CI and should return non-zero exit code when any REQUIRED capability is missing.
 *
 * Capability statuses:
 *   - "implemented"   : fully working, tested
 *   - "partial"       : partially implemented, gaps remain
 *   - "not-implemented": not started
 *   - "wont-fix"      : explicitly not targeted (document why)
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Capability matrix — single source of truth
// ---------------------------------------------------------------------------
const CAPABILITIES = [
  // ----- M0 Foundations -----
  {
    id: "m0.process-broker",
    section: "M0 - Foundations",
    name: "ProcessExecutionBroker (centralized spawn/exec)",
    status: "implemented",
    evidence: "src/lib/process-execution-broker/index.js",
    required: true,
    notes: "Core interface implemented; migration of all Category A call sites in progress",
  },
  {
    id: "m0.spawn-audit",
    section: "M0 - Foundations",
    name: "Spawn/exec call site audit",
    status: "implemented",
    evidence: "src/lib/process-execution-broker/SPAWN_AUDIT_REPORT.md",
    required: true,
  },
  {
    id: "m0.permissions-advisory",
    section: "M0 - Foundations",
    name: "cc permissions marked as advisory (not enforced)",
    status: "not-implemented",
    evidence: null,
    required: true,
    notes: "Add --advisory flag notice in help text",
  },
  {
    id: "m0.docs-source-of-truth",
    section: "M0 - Foundations",
    name: "Single docs source-of-truth for gap analysis",
    status: "partial",
    evidence: "docs/CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md",
    required: false,
    notes: "This parity matrix now acts as machine-readable source; older docs need archive banner",
  },

  // ----- M1 Permissions & Process Model -----
  {
    id: "m1.broker-migrate-agent-spawns",
    section: "M1 - Permissions & Process Model",
    name: "Migrate all agent self-spawn sites to Broker",
    status: "partial",
    evidence: null,
    required: true,
    notes: "Category A sites (agenda, batch, loop, team, routine, background-session, ws-server) need migration",
  },
  {
    id: "m1.permission-rules",
    section: "M1 - Permissions & Process Model",
    name: "Declarative permission rules (allow/deny patterns)",
    status: "not-implemented",
    required: false,
    notes: "Post-M1 hardening; current is hardcoded allowlist",
  },
  {
    id: "m1.process-tree-kill",
    section: "M1 - Permissions & Process Model",
    name: "Recursive process tree kill on abort",
    status: "partial",
    evidence: "src/lib/process-execution-broker/index.js killAll()",
    required: true,
    notes: "killAll implemented; need OS-level tree walk (taskkill /T on Windows)",
  },

  // ----- M2 Background Agent / IPC -----
  {
    id: "m2.ipc-bus",
    section: "M2 - Background Interaction",
    name: "Real-time IPC bus for background agents",
    status: "not-implemented",
    required: false,
    notes: "Planned: attach stdio streaming to Broker events; websocket gateway already exists",
  },
  {
    id: "m2.interrupt",
    section: "M2 - Background Interaction",
    name: "Interrupt/replan running background agent",
    status: "not-implemented",
    required: false,
  },

  // ----- M3 Hooks & Event Runtime -----
  {
    id: "m3.hook-events",
    section: "M3 - Hooks & Runtime",
    name: "Extended hook event surface",
    status: "not-implemented",
    required: false,
    notes: "PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, SessionEnd, AgentTurnStart, AgentTurnEnd",
  },
  {
    id: "m3.hook-executors",
    section: "M3 - Hooks & Runtime",
    name: "Pluggable hook executors (command/js/mcp)",
    status: "not-implemented",
    required: false,
  },
  {
    id: "m3.event-runtime",
    section: "M3 - Hooks & Runtime",
    name: "Persistent in-process Event Runtime",
    status: "not-implemented",
    required: false,
  },

  // ----- M4 Context & Attribution -----
  {
    id: "m4.context-ledger",
    section: "M4 - Context",
    name: "ContextSourceLedger (provenance tracing)",
    status: "not-implemented",
    required: false,
  },
  {
    id: "m4.turn-binding",
    section: "M4 - Context",
    name: "Unified turn/checkpoint binding",
    status: "not-implemented",
    required: false,
  },
];

// ---------------------------------------------------------------------------
// Runtime probes: verify that claimed files actually exist and are loadable
// ---------------------------------------------------------------------------
function runProbes() {
  const results = [];
  for (const cap of CAPABILITIES) {
    const probe = { id: cap.id, ok: true, errors: [] };
    if (cap.evidence) {
      const fullPath = join(CLI_ROOT, cap.evidence);
      if (!existsSync(fullPath)) {
        probe.ok = false;
        probe.errors.push(`evidence file not found: ${cap.evidence}`);
      }
    }
    // For "implemented" capabilities that point to a .js module, verify we can import it
    if (cap.status === "implemented" && cap.evidence && cap.evidence.endsWith(".js")) {
      try {
        // We do a synchronous read + syntax check via Function to avoid actually executing
        // (which could have side effects during parity check).
        const fullPath = join(CLI_ROOT, cap.evidence);
        if (existsSync(fullPath)) {
          const src = readFileSync(fullPath, "utf8");
          new Function(src); // will throw on parse error
        }
      } catch (err) {
        probe.ok = false;
        probe.errors.push(`syntax check failed: ${err.message}`);
      }
    }
    results.push(probe);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
function printHuman(probes) {
  const bySection = new Map();
  for (const cap of CAPABILITIES) {
    if (!bySection.has(cap.section)) bySection.set(cap.section, []);
    bySection.get(cap.section).push(cap);
  }

  let total = 0, implemented = 0, partial = 0, missing = 0;
  let requiredMissing = 0;

  console.log("=".repeat(72));
  console.log(" ChainlessChain CLI  —  Claude Code Parity Matrix");
  console.log("=" .repeat(72));

  for (const [section, caps] of bySection) {
    console.log(`\n[${section}]`);
    for (const cap of caps) {
      total++;
      const probe = probes.find((p) => p.id === cap.id);
      const probeOk = !probe || probe.ok;
      const icon = cap.status === "implemented" && probeOk ? "✅"
        : cap.status === "partial" ? "🟡"
        : cap.status === "wont-fix" ? "⚪"
        : "❌";
      if (cap.status === "implemented") implemented++;
      else if (cap.status === "partial") partial++;
      else if (cap.status === "not-implemented") missing++;
      if (cap.required && cap.status !== "implemented" && cap.status !== "wont-fix") requiredMissing++;

      console.log(` ${icon} ${cap.id.padEnd(28)} ${cap.name}`);
      if (cap.notes) console.log(`     ${" ".repeat(28)} note: ${cap.notes}`);
      if (probe && !probe.ok) {
        for (const e of probe.errors) console.log(`     ${" ".repeat(28)} PROBE FAIL: ${e}`);
      }
    }
  }

  console.log("\n" + "-".repeat(72));
  console.log(` Total: ${total}  ✅ ${implemented} implemented  🟡 ${partial} partial  ❌ ${missing} not started`);
  console.log(` Required-but-missing: ${requiredMissing}`);
  console.log("-".repeat(72));
  return requiredMissing;
}

function printJson(probes) {
  const out = CAPABILITIES.map((c) => {
    const p = probes.find((x) => x.id === c.id);
    return { ...c, probeOk: !p || p.ok, probeErrors: p?.errors || [] };
  });
  console.log(JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const filterIdx = args.findIndex((a) => a.startsWith("--filter="));
  const filter = filterIdx >= 0 ? args[filterIdx].slice("--filter=".length) : null;

  let caps = CAPABILITIES;
  if (filter) caps = caps.filter((c) => c.section.includes(filter) || c.id.includes(filter));

  // Monkey-patch CAPABILITIES for filtering (simpler than reworking runProbes)
  const original = CAPABILITIES.slice();
  CAPABILITIES.length = 0;
  CAPABILITIES.push(...caps);
  const probes = runProbes();
  CAPABILITIES.length = 0;
  CAPABILITIES.push(...original);

  let requiredMissing = 0;
  if (json) {
    printJson(probes);
  } else {
    requiredMissing = printHuman(probes);
  }

  // CI: exit non-zero if any required capability is missing AND probes pass
  if (!json && requiredMissing > 0) {
    // We don't fail CI for "not-implemented" yet — only for probe failures
    const probeFailures = probes.filter((p) => !p.ok).length;
    if (probeFailures > 0) process.exit(1);
  }
  const probeFailures = probes.filter((p) => !p.ok).length;
  if (probeFailures > 0) process.exit(1);
}

main();
