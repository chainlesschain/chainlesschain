import fs from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isRetryableVitestWorkerFailure,
  junitHasTestsAndNoFailures,
  junitOutputPath,
  runVitestOnce,
  runVitestWithWorkerRetry,
} from "../../scripts/run-vitest-with-worker-retry.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const cleanJunit =
  '<?xml version="1.0"?><testsuites tests="174" failures="0" errors="0"></testsuites>';
const workerFailure = [
  "[vitest-pool]: Worker forks emitted error.",
  "Caused by: Error: Worker exited unexpectedly",
].join("\n");

describe("Vitest worker infrastructure retry", () => {
  it("recognizes only a completed zero-failure JUnit run with the exact worker error", () => {
    expect(junitHasTestsAndNoFailures(cleanJunit)).toBe(true);
    expect(
      isRetryableVitestWorkerFailure({
        exitCode: 1,
        output: workerFailure,
        junitXml: cleanJunit,
      }),
    ).toBe(true);

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

  it("retries once after the exact infrastructure failure and returns the retry result", async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, output: workerFailure })
      .mockResolvedValueOnce({ exitCode: 0, output: "passed" });
    const warn = vi.fn();

    await expect(
      runVitestWithWorkerRetry(
        ["run", "--outputFile.junit=test-results/shard.xml"],
        { runOnce, readFile: () => cleanJunit, warn },
      ),
    ).resolves.toBe(0);
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
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
    expect(unitStep).toContain("--shard=${{ matrix.shard }}/${{ inputs.shards }}");
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
});
