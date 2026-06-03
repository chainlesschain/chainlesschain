/**
 * Smoke test for scripts/lint-sidebar-coverage.mjs.
 *
 * The lint walks real filesystem state, so this test asserts the script
 * runs without throwing and produces an exit code of 0 (advisory mode) and
 * non-zero only when --strict is passed with missing entries.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const script = resolve("scripts/lint-sidebar-coverage.mjs");

function runLint(args = "") {
  try {
    const out = execSync(`node "${script}" ${args}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, output: out };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      output: (err.stdout ?? "") + (err.stderr ?? ""),
    };
  }
}

test("advisory mode returns 0 even when missing entries exist", () => {
  const { exitCode, output } = runLint();
  assert.equal(exitCode, 0);
  assert.match(output, /Scanned \d+ source design docs/);
});

test("--strict returns non-zero when entries are missing", () => {
  const { exitCode } = runLint("--strict");
  // Either non-zero (real backlog exists) or 0 if backlog has been cleared.
  // We check: if output reports missing > 0, exit must be non-zero.
  const { output } = runLint("");
  const missingMatch = output.match(/⚠ (\d+) source doc/);
  const missingCount = missingMatch ? parseInt(missingMatch[1], 10) : 0;
  if (missingCount > 0) {
    assert.notEqual(
      exitCode,
      0,
      `Expected --strict to fail when ${missingCount} entries missing`,
    );
  } else {
    assert.equal(exitCode, 0);
  }
});

test("output mentions both sites", () => {
  const { output } = runLint();
  assert.match(output, /docs-site/);
  assert.match(output, /docs-site-design/);
});
