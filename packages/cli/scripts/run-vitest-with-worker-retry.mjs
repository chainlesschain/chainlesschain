#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";

const OUTPUT_TAIL_LIMIT = 1024 * 1024;
const WORKER_POOL_ERROR = "[vitest-pool]: Worker forks emitted error.";
const UNEXPECTED_EXIT_ERROR = "Worker exited unexpectedly";
const WORKER_EPIPE_ERROR = "Caused by: Error: write EPIPE";
const RAW_WORKER_EPIPE_FRAMES = [
  "ForksPoolWorker\\.send",
  "PoolRunner\\.postMessage",
  "ChildProcess\\.emitWorkerError",
].map(
  (frame) =>
    new RegExp(
      `\\bat ${frame} \\(file:\\/\\/\\/[^\\r\\n]*\\/node_modules\\/vitest\\/dist\\/chunks\\/cli-api\\.[^\\r\\n:]+\\.js:\\d+:\\d+\\)`,
      "u",
    ),
);
const require = createRequire(import.meta.url);
const vitestCliPath = path.join(
  path.dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);

function appendOutputTail(current, chunk) {
  const next = current + chunk;
  return next.length <= OUTPUT_TAIL_LIMIT
    ? next
    : next.slice(next.length - OUTPUT_TAIL_LIMIT);
}

export function junitOutputPath(args) {
  return outputOptionValue(args, "outputFile.junit");
}

function outputOptionValue(args, optionName) {
  const prefix = `--${optionName}=`;
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index]);
    if (argument.startsWith(prefix)) return argument.slice(prefix.length);
    if (argument === `--${optionName}` && index + 1 < args.length) {
      return String(args[index + 1]);
    }
  }
  return null;
}

export function jsonOutputPath(args) {
  const reporterSpecific = outputOptionValue(args, "outputFile.json");
  if (reporterSpecific) return reporterSpecific;
  const hasJsonReporter = args.some((argument, index) => {
    const value = String(argument);
    return (
      value === "--reporter=json" ||
      (value === "--reporter" && String(args[index + 1]) === "json")
    );
  });
  return hasJsonReporter ? outputOptionValue(args, "outputFile") : null;
}

export function singleWorkerRetryArgs(args) {
  const serialized = args.some(
    (argument) =>
      argument === "--no-file-parallelism" ||
      argument === "--fileParallelism=false" ||
      argument === "--file-parallelism=false",
  );
  return serialized ? [...args] : [...args, "--no-file-parallelism"];
}

function numericXmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="(\\d+)"`, "u"));
  return match ? Number(match[1]) : null;
}

export function junitHasTestsAndNoFailures(junitXml) {
  if (typeof junitXml !== "string") return false;
  const root = junitXml.match(/<testsuites\b[^>]*>/u)?.[0];
  if (!root) return false;
  const tests = numericXmlAttribute(root, "tests");
  const failures = numericXmlAttribute(root, "failures");
  const errors = numericXmlAttribute(root, "errors");
  return tests !== null && tests > 0 && failures === 0 && errors === 0;
}

export function jsonHasTestsAndNoFailures(
  jsonText,
  { allowInterrupted = false } = {},
) {
  if (typeof jsonText !== "string") return false;
  let report;
  try {
    report = JSON.parse(jsonText);
  } catch {
    return false;
  }
  const counts = [
    report?.numTotalTests,
    report?.numPassedTests,
    report?.numFailedTests,
    report?.numPendingTests,
    report?.numTodoTests,
    report?.numTotalTestSuites,
    report?.numPassedTestSuites,
    report?.numFailedTestSuites,
    report?.numPendingTestSuites,
  ];
  if (!counts.every((value) => Number.isInteger(value) && value >= 0)) {
    return false;
  }
  return (
    report.numTotalTests > 0 &&
    report.numFailedTests === 0 &&
    report.numFailedTestSuites === 0 &&
    (report.numPassedTests + report.numPendingTests + report.numTodoTests ===
      report.numTotalTests ||
      (allowInterrupted &&
        report.numPassedTests > 0 &&
        report.numPassedTests + report.numPendingTests + report.numTodoTests <
          report.numTotalTests)) &&
    report.numPassedTestSuites +
      report.numFailedTestSuites +
      report.numPendingTestSuites ===
      report.numTotalTestSuites
  );
}

function reportRecordsFailures(junitXml, jsonReport) {
  const root =
    typeof junitXml === "string"
      ? junitXml.match(/<testsuites\b[^>]*>/u)?.[0]
      : null;
  if (
    root &&
    (numericXmlAttribute(root, "failures") > 0 ||
      numericXmlAttribute(root, "errors") > 0)
  ) {
    return true;
  }
  try {
    const report = JSON.parse(jsonReport);
    return report?.numFailedTests > 0 || report?.numFailedTestSuites > 0;
  } catch {
    return false;
  }
}

function isRawVitestWorkerEpipe(output, junitXml, jsonReport) {
  const normalized =
    typeof output === "string" ? stripVTControlCharacters(output) : "";
  return (
    /(?:^|\n)Error: write EPIPE(?:\r?\n|$)/u.test(normalized) &&
    normalized.includes("Emitted 'error' event at:") &&
    /\bcode: ['"]EPIPE['"]/u.test(normalized) &&
    RAW_WORKER_EPIPE_FRAMES.every((frame) => frame.test(normalized)) &&
    !/\bAssertionError\b|\bFailed Tests\b|(?:^|\n)\s*FAIL(?:\s|$)/u.test(
      normalized,
    ) &&
    !reportRecordsFailures(junitXml, jsonReport) &&
    !junitHasTestsAndNoFailures(junitXml) &&
    !jsonHasTestsAndNoFailures(jsonReport)
  );
}

export function isRetryableVitestWorkerFailure({
  exitCode,
  output,
  junitXml,
  jsonReport,
}) {
  const normalizedOutput =
    typeof output === "string" ? stripVTControlCharacters(output) : output;
  const exactWorkerFailure =
    typeof normalizedOutput === "string" &&
    normalizedOutput.includes(WORKER_POOL_ERROR) &&
    (normalizedOutput.includes(UNEXPECTED_EXIT_ERROR) ||
      normalizedOutput.includes(WORKER_EPIPE_ERROR));
  return (
    exitCode !== 0 &&
    ((exactWorkerFailure &&
      (junitHasTestsAndNoFailures(junitXml) ||
        jsonHasTestsAndNoFailures(jsonReport, { allowInterrupted: true }))) ||
      isRawVitestWorkerEpipe(output, junitXml, jsonReport))
  );
}

export function runVitestOnce(
  args,
  {
    spawnProcess = spawn,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  return new Promise((resolve) => {
    const child = spawnProcess(process.execPath, [vitestCliPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout?.on("data", (chunk) => {
      stdout.write(chunk);
      output = appendOutputTail(output, chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk) => {
      stderr.write(chunk);
      output = appendOutputTail(output, chunk.toString("utf8"));
    });
    child.once("error", (error) => {
      finish({
        exitCode: 1,
        output: appendOutputTail(output, error.stack || error.message),
      });
    });
    child.once("close", (code) => {
      finish({ exitCode: Number.isInteger(code) ? code : 1, output });
    });
  });
}

export async function runVitestWithWorkerRetry(
  args,
  {
    runOnce = runVitestOnce,
    readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
    warn = (message) => process.stderr.write(`${message}\n`),
  } = {},
) {
  const first = await runOnce(args);
  if (first.exitCode === 0) return 0;

  const reportPath = junitOutputPath(args);
  let junitXml = null;
  if (reportPath) {
    try {
      junitXml = readFile(path.resolve(process.cwd(), reportPath));
    } catch {
      // A missing or unreadable report is not safe to retry automatically.
    }
  }
  const jsonReportPath = jsonOutputPath(args);
  let jsonReport = null;
  if (jsonReportPath) {
    try {
      jsonReport = readFile(path.resolve(process.cwd(), jsonReportPath));
    } catch {
      // A missing or unreadable report is not safe to retry automatically.
    }
  }
  if (
    !isRetryableVitestWorkerFailure({
      exitCode: first.exitCode,
      output: first.output,
      junitXml,
      jsonReport,
    })
  ) {
    return first.exitCode;
  }

  const rawWorkerEpipe = isRawVitestWorkerEpipe(
    first.output,
    junitXml,
    jsonReport,
  );

  warn(
    "::warning title=Vitest worker failure::No assertion failures were recorded, but the worker exited abnormally and tests may be incomplete; rerunning the entire suite once without file parallelism.",
  );
  const second = await runOnce(singleWorkerRetryArgs(args));
  if (rawWorkerEpipe) {
    if (second.exitCode !== 0) return second.exitCode;
    try {
      if (
        reportPath &&
        junitHasTestsAndNoFailures(
          readFile(path.resolve(process.cwd(), reportPath)),
        )
      ) {
        return 0;
      }
      if (jsonReportPath) {
        const retryReport = readFile(
          path.resolve(process.cwd(), jsonReportPath),
        );
        if (
          jsonHasTestsAndNoFailures(retryReport) &&
          JSON.parse(retryReport).success === true
        ) {
          return 0;
        }
      }
    } catch {
      // This retry is valid only with a newly completed, zero-failure report.
    }
    warn(
      "::error::Vitest worker retry did not produce a complete zero-failure report.",
    );
    return 1;
  }
  if (jsonReportPath) {
    try {
      const retryReport = readFile(path.resolve(process.cwd(), jsonReportPath));
      const completeWithoutFailures = jsonHasTestsAndNoFailures(retryReport);
      if (second.exitCode === 0) {
        if (completeWithoutFailures && JSON.parse(retryReport).success === true)
          return 0;
      } else if (
        completeWithoutFailures &&
        isRetryableVitestWorkerFailure({
          exitCode: second.exitCode,
          output: second.output,
          jsonReport: retryReport,
        })
      ) {
        warn(
          "::warning title=Vitest worker teardown failure::The serialized retry accounted for every selected test with zero failures before the worker exited abnormally; accepting the complete JSON report.",
        );
        return 0;
      }
    } catch {
      // A retry can be accepted only when it produces a complete report.
    }
    if (second.exitCode === 0) {
      warn(
        "::error::Vitest retry did not produce a complete zero-failure JSON report.",
      );
      return 1;
    }
  }
  return second.exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  const separator = process.argv.indexOf("--");
  const args = process.argv.slice(separator >= 0 ? separator + 1 : 2);
  process.exitCode = await runVitestWithWorkerRetry(args);
}
