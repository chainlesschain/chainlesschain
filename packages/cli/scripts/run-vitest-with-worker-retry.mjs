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

export function jsonHasTestsAndNoFailures(jsonText) {
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
    report.success === true &&
    report.numTotalTests > 0 &&
    report.numFailedTests === 0 &&
    report.numFailedTestSuites === 0 &&
    report.numPassedTests + report.numPendingTests + report.numTodoTests ===
      report.numTotalTests &&
    report.numPassedTestSuites +
      report.numFailedTestSuites +
      report.numPendingTestSuites ===
      report.numTotalTestSuites
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
    ((exactWorkerFailure && junitHasTestsAndNoFailures(junitXml)) ||
      jsonHasTestsAndNoFailures(jsonReport))
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

  warn(
    "::warning title=Vitest infrastructure failure::All recorded assertions passed, but Vitest exited non-zero; retrying this suite once without file parallelism.",
  );
  const second = await runOnce(singleWorkerRetryArgs(args));
  return second.exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  const separator = process.argv.indexOf("--");
  const args = process.argv.slice(separator >= 0 ? separator + 1 : 2);
  process.exitCode = await runVitestWithWorkerRetry(args);
}
