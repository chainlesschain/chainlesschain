#!/usr/bin/env node
/**
 * Offline governance coverage report (P1-9 "覆盖率指标" of
 * docs/CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md; §11.3 acceptance
 * targets). Reads a run summary JSON and prints the two coverage metrics —
 * high-risk tool-call ledger/trace coverage and Plugin/MCP/Skill/Hook provenance
 * traceability — WITHOUT any live run; exits 1 on any coverage gap so a CI job
 * can enforce the §11.3 "100%" targets against a recorded run artifact.
 *
 * Usage:
 *   node scripts/coverage-report.mjs <run-summary.json> [--json]
 *
 * run-summary.json shape (all fields optional):
 *   {
 *     "toolCalls":   [ { "tool": "write_file", "args": {...}, "opId": "op1" }, ... ],
 *     "ledgerOpIds": ["op1", ...],   // op-ids that got a side-effect-ledger entry
 *     "tracedOpIds": ["op1", ...],   // op-ids that got a trace span
 *     "attributions":[ { "tool":"run_skill","source":"acme","version":"1.2.0",
 *                        "scope":"project","tier":"extension","admitted":true }, ... ]
 *   }
 *
 * Pure offline tool: reads a file, prints, sets an exit code. No network.
 */
import { readFileSync } from "node:fs";
import {
  computeGovernanceCoverage,
  summarizeGovernanceCoverage,
} from "../src/lib/governance-coverage.js";

function main(argv) {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    process.stderr.write("usage: coverage-report.mjs <run-summary.json> [--json]\n");
    process.exit(2);
  }

  let summary;
  try {
    summary = JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    process.stderr.write(`Cannot read ${file}: ${err.message}\n`);
    process.exit(2);
  }

  const report = computeGovernanceCoverage({
    toolCalls: summary.toolCalls || [],
    ledgerOpIds: summary.ledgerOpIds || [],
    tracedOpIds: summary.tracedOpIds || [],
    attributions: summary.attributions || [],
  });

  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(summarizeGovernanceCoverage(report) + "\n");
    for (const u of report.sideEffect.uncoveredLedger) {
      process.stderr.write(
        `  no ledger entry: #${u.index} ${u.tool} (${u.kind})\n`,
      );
    }
    for (const u of report.sideEffect.uncoveredTrace) {
      process.stderr.write(`  no trace span: #${u.index} ${u.tool} (${u.kind})\n`);
    }
    for (const u of report.provenance.untraceable) {
      process.stderr.write(
        `  incomplete provenance: #${u.index} ${u.tool ?? "?"} missing ${u.missing.join(", ")}\n`,
      );
    }
  }

  process.exit(report.ok ? 0 : 1);
}

main(process.argv);
