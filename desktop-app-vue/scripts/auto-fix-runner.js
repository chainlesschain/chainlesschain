#!/usr/bin/env node
"use strict";

/**
 * CI failure diagnostic runner.
 *
 * This command intentionally does not mutate the checkout or host. Historical
 * versions reinstalled dependencies, deleted database sidecars/node_modules,
 * killed processes, wrote .env, and started Docker. Those actions are unsafe
 * as an implicit response to a failed test and can turn the retry into a false
 * signal. A diagnostic result therefore exits non-zero when failures exist.
 */

const fs = require("fs").promises;
const path = require("path");

class AutoFixRunner {
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.reportDirectory = path.join(this.cwd, "test-results");
  }

  identifyErrorType(failure) {
    const errorText = [failure.error, failure.stderr, failure.message]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (
      errorText.includes("cannot find module") ||
      errorText.includes("module not found")
    ) {
      return "DEPENDENCY_ERROR";
    }
    if (errorText.includes("type error") || errorText.includes("typescript")) {
      return "TYPE_ERROR";
    }
    if (
      errorText.includes("sqlite_busy") ||
      errorText.includes("database is locked")
    ) {
      return "DATABASE_LOCKED";
    }
    if (
      errorText.includes("eaddrinuse") ||
      errorText.includes("address already in use")
    ) {
      return "PORT_IN_USE";
    }
    if (
      errorText.includes("missing env") ||
      errorText.includes("undefined env")
    ) {
      return "MISSING_ENV_VAR";
    }
    if (errorText.includes("docker") || errorText.includes("econnrefused")) {
      return "SERVICE_UNAVAILABLE";
    }
    if (errorText.includes("eslint") || errorText.includes("lint")) {
      return "LINT_ERROR";
    }
    if (errorText.includes("cache") || errorText.includes("eintegrity")) {
      return "CACHE_ERROR";
    }
    return "UNKNOWN";
  }

  async analyzeFailures() {
    const reportFile = path.join(this.reportDirectory, "test-report.json");
    let report;

    try {
      report = JSON.parse(await fs.readFile(reportFile, "utf8"));
    } catch (error) {
      const diagnosticError = new Error(
        `Unable to read a valid test report at ${reportFile}: ${error.message}`,
      );
      diagnosticError.code = "INVALID_TEST_REPORT";
      throw diagnosticError;
    }

    if (!report.results || typeof report.results !== "object") {
      const error = new Error("Test report does not contain a results object.");
      error.code = "INVALID_TEST_REPORT";
      throw error;
    }

    return Object.values(report.results).filter(
      (result) => result && result.passed === false,
    );
  }

  async saveReport(report) {
    await fs.mkdir(this.reportDirectory, { recursive: true });
    const reportFile = path.join(this.reportDirectory, "auto-fix-report.json");
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2), "utf8");
    console.log(`[Diagnostics] Report saved to: ${reportFile}`);
  }

  async run() {
    console.log("\n" + "=".repeat(60));
    console.log("Test failure diagnostics (non-mutating)");
    console.log("=".repeat(60));

    let failures;
    try {
      failures = await this.analyzeFailures();
    } catch (error) {
      const report = {
        schemaVersion: 1,
        mode: "diagnostic-only",
        timestamp: new Date().toISOString(),
        status: "error",
        error: {
          code: error.code || "DIAGNOSTIC_FAILED",
          message: error.message,
        },
        diagnostics: [],
      };
      await this.saveReport(report);
      console.error(`[Diagnostics] ${error.message}`);
      return 2;
    }

    const diagnostics = failures.map((failure) => ({
      suite: failure.name || "unknown",
      exitCode: failure.exitCode ?? null,
      errorType: this.identifyErrorType(failure),
      error: failure.error || null,
      safeAutomaticFixAvailable: false,
    }));
    const report = {
      schemaVersion: 1,
      mode: "diagnostic-only",
      timestamp: new Date().toISOString(),
      status: failures.length === 0 ? "no-failures" : "manual-action-required",
      mutationsApplied: [],
      diagnostics,
      summary: {
        failures: failures.length,
        safeAutomaticFixesAvailable: 0,
      },
    };
    await this.saveReport(report);

    if (failures.length === 0) {
      console.log("[Diagnostics] No failed suites were present in the report.");
      return 0;
    }

    for (const diagnostic of diagnostics) {
      console.error(
        `[Diagnostics] ${diagnostic.suite}: ${diagnostic.errorType}; no safe automatic fix is registered.`,
      );
    }
    console.error(
      "[Diagnostics] No checkout or host mutations were attempted. A retry may detect transient failures, but this diagnostic step is not a successful fix.",
    );
    return 2;
  }
}

async function main() {
  const runner = new AutoFixRunner();
  return runner.run();
}

if (require.main === module) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error("Diagnostic runner failed:", error);
      process.exitCode = 2;
    });
}

module.exports = AutoFixRunner;
