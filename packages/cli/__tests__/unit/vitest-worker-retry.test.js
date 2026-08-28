import fs from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isRetryableVitestWorkerFailure,
  jsonHasTestsAndNoFailures,
  jsonOutputPath,
  junitHasTestsAndNoFailures,
  junitOutputPath,
  runVitestOnce,
  runVitestWithWorkerRetry,
  singleWorkerRetryArgs,
} from "../../scripts/run-vitest-with-worker-retry.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const cleanJunit =
  '<?xml version="1.0"?><testsuites tests="174" failures="0" errors="0"></testsuites>';
const cleanJson = JSON.stringify({
  numTotalTestSuites: 3,
  numPassedTestSuites: 2,
  numFailedTestSuites: 0,
  numPendingTestSuites: 1,
  numTotalTests: 10,
  numPassedTests: 8,
  numFailedTests: 0,
  numPendingTests: 1,
  numTodoTests: 1,
  success: true,
});
const workerFailure = [
  "[vitest-pool]: Worker forks emitted error.",
  "Caused by: Error: Worker exited unexpectedly",
].join("\n");
const workerEpipeFailure = [
  "[vitest-pool]: Worker forks emitted error.",
  "Caused by: Error: write EPIPE",
].join("\n");

describe("Vitest worker infrastructure retry", () => {
  it("recognizes only a completed zero-failure JUnit run with the exact worker error", () => {
    expect(junitHasTestsAndNoFailures(cleanJunit)).toBe(true);
    for (const output of [workerFailure, workerEpipeFailure]) {
      expect(
        isRetryableVitestWorkerFailure({
          exitCode: 1,
          output,
          junitXml: cleanJunit,
        }),
      ).toBe(true);
    }

    for (const candidate of [
      cleanJunit.replace('failures="0"', 'failures="1"'),
      cleanJunit.replace('errors="0"', 'errors="1"'),
      cleanJunit.replace('tests="174"', 'tests="0"'),
      null,
    ]) {
      expect(
        isRetryableVitestWorkerFailure({
          exitCode: 1,
          output: workerFailure,
          junitXml: candidate,
        }),
      ).toBe(false);
    }
    expect(
      isRetryableVitestWorkerFailure({
        exitCode: 1,
        output: "AssertionError: expected true to be false",
        junitXml: cleanJunit,
      }),
    ).toBe(false);
    expect(
      isRetryableVitestWorkerFailure({
        exitCode: 1,
        output: "Caused by: Error: write EPIPE",
        junitXml: cleanJunit,
      }),
    ).toBe(false);
  });

  it("extracts both supported JUnit reporter argument forms", () => {
    expect(
      junitOutputPath(["run", "--outputFile.junit=test-results/shard.xml"]),
    ).toBe("test-results/shard.xml");
    expect(
      junitOutputPath(["run", "--outputFile.junit", "test-results/shard.xml"]),
    ).toBe("test-results/shard.xml");
    expect(junitOutputPath(["run"])).toBeNull();
  });

  it("recognizes a complete zero-failure JSON report without hiding incomplete results", () => {
    expect(jsonHasTestsAndNoFailures(cleanJson)).toBe(true);
    expect(
      isRetryableVitestWorkerFailure({
        exitCode: 1,
        output: "JSON report written",
        jsonReport: cleanJson,
      }),
    ).toBe(true);
    for (const candidate of [
      cleanJson.replace('"numFailedTests":0', '"numFailedTests":1'),
      cleanJson.replace('"success":true', '"success":false'),
      cleanJson.replace('"numTotalTests":10', '"numTotalTests":11'),
      "not-json",
      null,
    ]) {
      expect(jsonHasTestsAndNoFailures(candidate)).toBe(false);
    }
  });

  it("extracts generic and reporter-specific JSON output paths", () => {
    expect(
      jsonOutputPath([
        "run",
        "--reporter=json",
        "--outputFile=strict-result.json",
      ]),
    ).toBe("strict-result.json");
    expect(
      jsonOutputPath([
        "run",
        "--reporter",
        "json",
        "--outputFile.json",
        "strict-result.json",
      ]),
    ).toBe("strict-result.json");
    expect(jsonOutputPath(["run", "--outputFile=result.json"])).toBeNull();
  });

  it("launches the installed Vitest CLI through Node without a platform shell", async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const spawnProcess = vi.fn(() => child);
    const run = runVitestOnce(["run", "sample.test.js"], {
      spawnProcess,
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
    });
    queueMicrotask(() => child.emit("close", 0));

    await expect(run).resolves.toEqual({ exitCode: 0, output: "" });
    expect(spawnProcess).toHaveBeenCalledOnce();
    const [command, args, options] = spawnProcess.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args[0].replaceAll("\\", "/")).toMatch(/\/vitest\/vitest\.mjs$/u);
    expect(args.slice(1)).toEqual(["run", "sample.test.js"]);
    expect(options.shell).not.toBe(true);
    expect(options.windowsHide).toBe(true);
  });

  it("retries once without file parallelism after a clean worker transport failure", async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, output: workerEpipeFailure })
      .mockResolvedValueOnce({ exitCode: 0, output: "passed" });
    const warn = vi.fn();

    await expect(
      runVitestWithWorkerRetry(
        ["run", "--outputFile.junit=test-results/shard.xml"],
        { runOnce, readFile: () => cleanJunit, warn },
      ),
    ).resolves.toBe(0);
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(runOnce.mock.calls[0][0]).not.toContain("--no-file-parallelism");
    expect(runOnce.mock.calls[1][0]).toContain("--no-file-parallelism");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not duplicate an existing serialized retry option", () => {
    expect(singleWorkerRetryArgs(["run", "--no-file-parallelism"])).toEqual([
      "run",
      "--no-file-parallelism",
    ]);
    expect(singleWorkerRetryArgs(["run", "--fileParallelism=false"])).toEqual([
      "run",
      "--fileParallelism=false",
    ]);
  });

  it("retries once when a complete JSON report is clean but Vitest exits non-zero", async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, output: "JSON report written" })
      .mockResolvedValueOnce({ exitCode: 0, output: "passed" });

    await expect(
      runVitestWithWorkerRetry(
        ["run", "--reporter=json", "--outputFile=strict-result.json"],
        { runOnce, readFile: () => cleanJson, warn: vi.fn() },
      ),
    ).resolves.toBe(0);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it("does not retry assertion failures, missing reports, or a second failure", async () => {
    const assertionFailure = vi.fn().mockResolvedValue({
      exitCode: 1,
      output: "AssertionError",
    });
    await expect(
      runVitestWithWorkerRetry(
        ["run", "--outputFile.junit=test-results/shard.xml"],
        {
          runOnce: assertionFailure,
          readFile: () => cleanJunit,
        },
      ),
    ).resolves.toBe(1);
    expect(assertionFailure).toHaveBeenCalledOnce();

    const missingReport = vi.fn().mockResolvedValue({
      exitCode: 1,
      output: workerFailure,
    });
    await expect(
      runVitestWithWorkerRetry(
        ["run", "--outputFile.junit=test-results/shard.xml"],
        {
          runOnce: missingReport,
          readFile: () => {
            throw new Error("missing");
          },
        },
      ),
    ).resolves.toBe(1);
    expect(missingReport).toHaveBeenCalledOnce();

    const repeatedFailure = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, output: workerFailure })
      .mockResolvedValueOnce({ exitCode: 2, output: workerFailure });
    await expect(
      runVitestWithWorkerRetry(
        ["run", "--outputFile.junit=test-results/shard.xml"],
        { runOnce: repeatedFailure, readFile: () => cleanJunit, warn: vi.fn() },
      ),
    ).resolves.toBe(2);
    expect(repeatedFailure).toHaveBeenCalledTimes(2);
  });

  it("keeps unit and integration shards behind the strict worker retry", () => {
    const workflow = fs.readFileSync(
      path.join(repositoryRoot, ".github/workflows/_cli-test.yml"),
      "utf8",
    );
    const cliWorkflow = fs.readFileSync(
      path.join(repositoryRoot, ".github/workflows/cli-ci.yml"),
      "utf8",
    );
    const unitStep = workflow.slice(
      workflow.indexOf("- name: vitest unit shard"),
      workflow.indexOf("- name: Upload failed unit report"),
    );
    const integrationStep = workflow.slice(
      workflow.indexOf("- name: vitest integration shard"),
      workflow.indexOf("- name: Upload failed integration report"),
    );
    expect(unitStep).toContain(
      "node scripts/run-vitest-with-worker-retry.mjs -- run",
    );
    expect(unitStep).toContain(
      "--shard=${{ matrix.shard }}/${{ inputs.unit-shards }}",
    );
    expect(workflow).toContain("inputs.unit-shards == 8");
    const windowsCaller = cliWorkflow.slice(
      cliWorkflow.indexOf("test-windows:"),
      cliWorkflow.indexOf("test-macos:"),
    );
    expect(windowsCaller).toContain("unit-shards: 8");
    expect(unitStep).toContain("--reporter=default --reporter=junit");
    expect(unitStep).toContain(
      "--outputFile.junit=test-results/unit-${{ matrix.shard }}.xml",
    );
    expect(unitStep).toContain("--silent=passed-only");
    expect(unitStep).toContain("__tests__/unit/");
    expect(unitStep).not.toContain("continue-on-error");
    expect(integrationStep).toContain(
      "node scripts/run-vitest-with-worker-retry.mjs -- run",
    );
    expect(integrationStep).toContain("--shard=${{ matrix.shard }}/8");
    expect(integrationStep).toContain("--reporter=default --reporter=junit");
    expect(integrationStep).toContain(
      "--outputFile.junit=test-results/integration-${{ matrix.shard }}.xml",
    );
    expect(integrationStep).toContain("--silent=passed-only");
    expect(integrationStep).toContain("__tests__/integration/");
    expect(integrationStep).not.toContain("continue-on-error");
  });

  it("keeps the strict sandbox contract behind a bounded clean-report retry", () => {
    const workflow = fs.readFileSync(
      path.join(repositoryRoot, ".github/workflows/cli-strict-sandbox.yml"),
      "utf8",
    );
    const step = workflow.slice(
      workflow.indexOf("- name: Run platform sandbox contract tests"),
      workflow.indexOf(
        "- name: Run native ProcessExecutionBroker strict boundary",
      ),
    );
    expect(step).toContain(
      "node scripts/run-vitest-with-worker-retry.mjs -- run --reporter=json",
    );
    expect(step).toContain("--outputFile=strict-sandbox-contract-result.json");
    expect(step).not.toContain("continue-on-error");
  });

  it("keeps the npm release preflight behind a bounded clean-report retry", () => {
    const workflow = fs.readFileSync(
      path.join(repositoryRoot, ".github/workflows/npm-publish.yml"),
      "utf8",
    );
    const step = workflow.slice(
      workflow.indexOf("- name: Run CLI tests"),
      workflow.indexOf("\n  exact-sha-gate:"),
    );
    expect(step).toContain(
      "node scripts/run-vitest-with-worker-retry.mjs -- run",
    );
    expect(step).toContain("--reporter=default --reporter=junit");
    expect(step).toContain("--outputFile.junit=test-results/npm-publish.xml");
    expect(step).toContain("--silent=passed-only");
    expect(step).not.toContain("continue-on-error");
  });
});
