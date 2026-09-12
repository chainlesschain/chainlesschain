/**
 * Normal-bin strict-gate contract tests over explicitly synthetic JSONL.
 * No Agent/model runs here: PASS demonstrates local evidence validation only,
 * never task quality or production attestation.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEvalComparison,
  createEvalHistoryRecord,
  EVAL_CONTEXT_SCHEMA,
  EVAL_EXECUTION_PROTOCOL,
  evalDigest,
} from "../../src/lib/eval/evidence.js";

const bin = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
let fixture;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-eval-strict-cli-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const env = {
    ...process.env,
    FORCE_COLOR: "0",
    CHAINLESSCHAIN_HOME: path.join(root, "cli-state"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "security-anchor"),
    CC_EVENT_RUNTIME_DURABLE: "0",
  };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("VITEST") ||
      key === "NODE_OPTIONS" ||
      key === "CLAUDE_CONFIG_DIR" ||
      key.startsWith("CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_") ||
      key.startsWith("OTEL_EXPORTER_") ||
      key.endsWith("API_KEY")
    )
      delete env[key];
  }
  fixture = {
    root,
    workspace,
    env,
    history: path.join(root, "history.jsonl"),
    now: Date.now(),
  };
});

afterEach(() => {
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

function syntheticRecord(index, { dryRun = false } = {}) {
  const provider = "synthetic-provider";
  const model = "synthetic-contract-model";
  const comparison = createEvalComparison({
    suite: "synthetic-cli-contract",
    corpusDigest: evalDigest(
      "synthetic corpus for CLI parsing, not an evaluation",
    ),
    provider,
    model,
    context: {
      schema: EVAL_CONTEXT_SCHEMA,
      provider,
      model,
      modelRevision: "synthetic-v1",
      environmentDigest: evalDigest("synthetic environment"),
      permissionDigest: evalDigest("synthetic permissions"),
      inferenceDigest: evalDigest("synthetic inference configuration"),
    },
  });
  return createEvalHistoryRecord(
    {
      passed: 1,
      failed: 0,
      total: 1,
      passRate: 1,
      unrelatedChangeRate: 0,
      results: [
        {
          id: "synthetic-task",
          pass: true,
          artifactCheckPassed: true,
          executionSucceeded: true,
          agentOk: true,
          // Explicitly manufactured fields test the contract, not an actual run.
          executionEvidence: {
            protocol: EVAL_EXECUTION_PROTOCOL,
            exitCode: 0,
            signal: null,
            terminalVerified: true,
            observedFallback: false,
          },
          error: null,
          detail: "synthetic record; no model or task execution",
          ms: 0,
          changedFiles: [],
          unrelatedChanges: [],
        },
      ],
    },
    {
      comparison,
      dryRun,
      label: "synthetic-cli-contract-only",
      runId: `synthetic-${index}`,
      ranAt: new Date(fixture.now - (10 - index) * 1000).toISOString(),
    },
  );
}

function writeHistory(records, suffix = "") {
  fs.writeFileSync(
    fixture.history,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n" + suffix,
  );
}

function strictCli(expectedExit) {
  const result = spawnSync(
    process.execPath,
    [
      bin,
      "eval",
      "--trend",
      "--strict",
      "--history",
      fixture.history,
      "--json",
    ],
    {
      cwd: fixture.workspace,
      env: fixture.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(
    expectedExit,
  );
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({
    scope: "local-eval-comparison",
    productionAttested: false,
  });
  return report;
}

describe("cc eval --trend --strict --history --json", () => {
  it("exits 1 with insufficient evidence when the history file does not exist", () => {
    expect(strictCli(1)).toMatchObject({
      status: "INSUFFICIENT_EVIDENCE",
      passed: false,
      reasons: expect.arrayContaining(["missing_baseline"]),
    });
  });

  it("does not accept two all-passing legacy rows as a strict comparison", () => {
    writeHistory(
      [1, 2].map((index) => ({
        ranAt: new Date(fixture.now - (3 - index) * 1000).toISOString(),
        passed: 1,
        total: 1,
        passRate: 1,
        results: [{ id: "a", pass: true }],
      })),
    );
    expect(strictCli(1)).toMatchObject({
      status: "INSUFFICIENT_EVIDENCE",
      passed: false,
      reasons: expect.arrayContaining(["legacy_or_missing_run_identity"]),
    });
  });

  it("accepts complete comparable synthetic rows without claiming production attestation", () => {
    writeHistory([syntheticRecord(1), syntheticRecord(2)]);
    expect(strictCli(0)).toMatchObject({
      status: "PASS",
      passed: true,
      reasons: [],
      baselineRunId: "synthetic-1",
      candidateRunId: "synthetic-2",
      productionAttested: false,
    });
  });

  it("does not skip a corrupt final JSONL row to reuse an earlier passing pair", () => {
    writeHistory(
      [syntheticRecord(1), syntheticRecord(2)],
      "{not-valid-json}\n",
    );
    expect(strictCli(1)).toMatchObject({
      status: "INSUFFICIENT_EVIDENCE",
      passed: false,
      reasons: expect.arrayContaining(["invalid_history_record"]),
    });
  });

  it("does not skip a latest dry-run record to reuse an earlier passing pair", () => {
    writeHistory([
      syntheticRecord(1),
      syntheticRecord(2),
      syntheticRecord(3, { dryRun: true }),
    ]);
    expect(strictCli(1)).toMatchObject({
      status: "INSUFFICIENT_EVIDENCE",
      passed: false,
      candidateRunId: "synthetic-3",
      reasons: expect.arrayContaining(["dry_run_or_missing_execution_mode"]),
    });
  });
});
