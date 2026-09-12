import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { _deps, registerEvalCommand } from "../../src/commands/eval.js";
import {
  createEvalComparison,
  createEvalHistoryRecord,
  EVAL_CONTEXT_SCHEMA,
} from "../../src/lib/eval/evidence.js";

const originalDeps = { ..._deps };
let dir, output, logger, priorExit;
const digest = `sha256:${"a".repeat(64)}`;
const context = () => ({
  schema: EVAL_CONTEXT_SCHEMA,
  provider: "openai",
  model: "test-model",
  modelRevision: "fixed-revision",
  environmentDigest: digest,
  permissionDigest: digest,
  inferenceDigest: digest,
});
const summary = () => ({
  passed: 1,
  failed: 0,
  total: 1,
  passRate: 1,
  unrelatedChangeRate: 0,
  results: [
    {
      id: "a",
      pass: true,
      artifactCheckPassed: true,
      executionSucceeded: true,
      agentOk: true,
      executionEvidence: {
        protocol: "cc-agent-stream-json/v1",
        exitCode: 0,
        signal: null,
        terminalVerified: true,
        observedFallback: false,
      },
      error: null,
      detail: "checked",
      changedFiles: [],
      unrelatedChanges: [],
    },
  ],
});
function records() {
  const comparison = createEvalComparison({
    suite: "builtin",
    corpusDigest: digest,
    provider: "openai",
    model: "test-model",
    context: context(),
  });
  return [1, 2].map((index) =>
    createEvalHistoryRecord(summary(), {
      comparison,
      runId: `run-${index}`,
      ranAt: new Date(Date.now() - (3 - index) * 1000).toISOString(),
    }),
  );
}
async function run(args) {
  const program = new Command();
  program.exitOverride();
  registerEvalCommand(program, { logger });
  await program.parseAsync(["node", "cc", "eval", ...args]);
}
beforeEach(() => {
  priorExit = process.exitCode;
  process.exitCode = undefined;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-eval-command-"));
  output = vi.spyOn(console, "log").mockImplementation(() => {});
  logger = { error: vi.fn(), log: vi.fn(), info: vi.fn() };
  _deps.runEvalSuite = vi.fn(async () => summary());
  _deps.spawn = vi.fn(() => {
    throw new Error("no model calls allowed");
  });
});
afterEach(() => {
  Object.assign(_deps, originalDeps);
  process.exitCode = priorExit;
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Eval command strict evidence", () => {
  it("retains diagnostic single-run behavior while strict exits nonzero", async () => {
    const history = path.join(dir, "history.jsonl");
    fs.writeFileSync(history, JSON.stringify(records()[0]) + "\n");
    await run(["--trend", "--history", history, "--json"]);
    expect(process.exitCode).toBeUndefined();
    await run(["--trend", "--strict", "--history", history, "--json"]);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(output.mock.calls.at(-1)[0]).status).toBe(
      "INSUFFICIENT_EVIDENCE",
    );
    expect(_deps.runEvalSuite).not.toHaveBeenCalled();
  });
  it("fails strict malformed history, and accepts a complete comparable pair", async () => {
    const history = path.join(dir, "history.jsonl");
    const text = records()
      .map((record) => JSON.stringify(record))
      .join("\n");
    fs.writeFileSync(history, `${text}\n`);
    await run(["--trend", "--strict", "--history", history, "--json"]);
    expect(JSON.parse(output.mock.calls.at(-1)[0])).toMatchObject({
      status: "PASS",
      productionAttested: false,
    });
    fs.appendFileSync(history, "broken\n");
    await run(["--trend", "--strict", "--history", history, "--json"]);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(output.mock.calls.at(-1)[0]).reasons).toContain(
      "invalid_history_record",
    );
  });
  it("refuses strict run mode and missing history before invoking a model", async () => {
    await run(["--strict"]);
    expect(process.exitCode).toBe(1);
    await run(["--strict", "--trend"]);
    expect(logger.error).toHaveBeenCalledWith(
      "--trend requires --history <file>",
    );
    expect(_deps.runEvalSuite).not.toHaveBeenCalled();
  });
  it("does not ignore a dry-run flag during strict verification", async () => {
    const history = path.join(dir, "history.jsonl");
    fs.writeFileSync(
      history,
      records()
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );
    await run(["--trend", "--strict", "--dry-run", "--history", history]);
    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      "--dry-run cannot be combined with --strict",
    );
  });
  it("persists layered failure information and comparison metadata", async () => {
    const contextPath = path.join(dir, "context.json");
    const history = path.join(dir, "history.jsonl");
    fs.writeFileSync(contextPath, JSON.stringify(context()));
    const failed = summary();
    Object.assign(failed, { passed: 0, failed: 1, passRate: 0 });
    Object.assign(failed.results[0], {
      pass: false,
      executionSucceeded: false,
      agentOk: false,
      error: "timed out",
    });
    failed.results[0].executionEvidence.exitCode = 1;
    _deps.runEvalSuite.mockResolvedValue(failed);
    await run([
      "--provider",
      "openai",
      "--model",
      "test-model",
      "--comparison-context",
      contextPath,
      "--history",
      history,
      "--json",
    ]);
    const saved = JSON.parse(fs.readFileSync(history, "utf8"));
    expect(saved.comparison).toMatchObject({
      basis: "local-runtime-and-operator-declarations",
      provider: "openai",
      model: "test-model",
    });
    expect(saved.comparison.corpusDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(saved.results[0]).toMatchObject({
      pass: false,
      artifactCheckPassed: true,
      executionSucceeded: false,
      error: "timed out",
    });
    expect(process.exitCode).toBe(1);
  });
  it("rejects context/model mismatches before running the suite", async () => {
    const contextPath = path.join(dir, "context.json");
    fs.writeFileSync(contextPath, JSON.stringify(context()));
    await run([
      "--provider",
      "openai",
      "--model",
      "different-model",
      "--comparison-context",
      contextPath,
    ]);
    expect(process.exitCode).toBe(1);
    expect(_deps.runEvalSuite).not.toHaveBeenCalled();
  });
  it("marks dry runs explicitly and reports history write failures", async () => {
    await run(["--dry-run", "--json"]);
    expect(JSON.parse(output.mock.calls.at(-1)[0]).dryRun).toBe(true);
    await run([
      "--history",
      path.join(dir, "missing", "history.jsonl"),
      "--json",
    ]);
    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("history write failed"),
    );
  });
});
