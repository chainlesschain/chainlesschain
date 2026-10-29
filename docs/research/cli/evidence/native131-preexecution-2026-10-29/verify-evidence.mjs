import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifyPreexecutionTerminal } from "./preexecution-terminal.mjs";
import { verifyNativeRetestRound } from "../../../../../packages/cli/scripts/verify01-native-retest-round.mjs";
export function verifyTerminalEvidence() {
  const file =
    "docs/research/cli/evidence/native131-preexecution-2026-10-29/terminal.json";
  const bytes = fs.readFileSync(file),
    certificate = JSON.parse(bytes);
  const terminal = verifyPreexecutionTerminal({
    certificate,
    readBytes: (p) => fs.readFileSync(p),
    gitBytes: (commit, p) =>
      execFileSync("git", ["show", `${commit}:${p}`], { windowsHide: true }),
    need: (v, c) => assert.ok(v, c),
  });
  const ledger = JSON.parse(fs.readFileSync(certificate.evidence.ledger.path));
  const round = verifyNativeRetestRound({
    planFile: certificate.planPath,
    ledger,
  });
  assert.equal(round.status, "IN_PROGRESS");
  assert.equal(round.counts.generationRecordsCollected, 0);
  assert.equal(round.counts.acceptanceRecordsCollected, 0);
  assert.equal(round.counts.cumulativeAcceptedDeliverables, 34);
  return {
    certificate,
    certificateDigest:
      "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    terminal,
    round,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { certificateDigest, terminal, round } = verifyTerminalEvidence();
  console.log(
    JSON.stringify({
      outcome: terminal.outcome,
      runId: terminal.runId,
      generationExecution: terminal.generationExecution,
      acceptanceExecution: terminal.acceptanceExecution,
      billingAssessed: false,
      liabilitiesPreserved: true,
      certificateDigest,
      originalLedgerStatus: round.status,
      counts: round.counts,
    }),
  );
}
