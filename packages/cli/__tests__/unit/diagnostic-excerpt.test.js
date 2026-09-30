import { describe, it, expect } from "vitest";
import {
  diagnosticExcerpt,
  hasTestFailureVerdict,
} from "../../src/lib/diagnostic-excerpt.js";
import {
  shellOutputPage,
  shellOutputPreview,
} from "../../src/lib/shell-output.js";

describe("diagnostic source preservation", () => {
  it.each([1200, 1600])(
    "handles colored gh logs without losing the assertion or suite verdicts at %i chars",
    (limit) => {
      const log = [
        ...Array(200).fill("runner setup"),
        "# Failed to run Unit tests: Error: spawn denied",
        "# at ci-gate-integrity.test.mjs:1816:48",
        "ok 47 - deliberately rejects spawn",
        "✓ Unit tests PASSED (601.00s)",
        ...Array(200).fill("successful test"),
        "\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m tests/integration/browser-download-boundary.integration.test.js\u001b[2m > \u001b[22mBrowserEngine real Chromium download boundary\u001b[2m > \u001b[22mcancels native downloads and closes page-initiated popups",
        "\u001b[31m\u001b[1mError\u001b[22m: download.failure: Target page, context or browser has been closed\u001b[39m",
        " ❯ tests/integration/browser-download-boundary.integration.test.js:\u001b[2m101:8\u001b[22m",
        "\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[31m1 failed\u001b[39m | 38 passed",
        "✗ Integration tests FAILED (78.32s)",
        ...Array(200).fill("diagnostic retry"),
        "✓ Unit tests PASSED (635.27s)",
        "✓ Integration tests PASSED (71.44s)",
        "✓ Database tests PASSED",
        "✓ UKey tests PASSED",
        "##[error]The primary comprehensive test run did not pass; a diagnostic retry cannot replace it.",
        "##[error]Process completed with exit code 1.",
        ...Array(200).fill("Post job cleanup"),
      ]
        .map(
          (line) =>
            `Run All Tests (ubuntu-latest)\tUNKNOWN STEP\t2026-09-30T02:37:31.1222018Z ${line}`,
        )
        .join("\n");
      expect(hasTestFailureVerdict(log)).toBe(true);
      const excerpt = diagnosticExcerpt(log, limit);
      expect(excerpt.length).toBeLessThanOrEqual(limit);
      expect(excerpt).toContain(
        "browser-download-boundary.integration.test.js",
      );
      expect(excerpt).toContain(
        "Target page, context or browser has been closed",
      );
      expect(excerpt).toContain("101:8");
      expect(excerpt).toContain("Unit tests PASSED (601.00s)");
      expect(excerpt).toContain("Integration tests FAILED (78.32s)");
      expect(excerpt).toContain("Integration tests PASSED (71.44s)");
      expect(excerpt).toContain("primary comprehensive test run did not pass");
      expect(excerpt).not.toContain("\u001b");
    },
  );
  it.each([1200, 1600])(
    "keeps the middle failed test, passing unit verdict and primary gate at %i chars",
    (limit) => {
      const log = [
        "setup\n".repeat(1000),
        "Error: spawn denied",
        "at ci-gate-integrity.test.mjs:1816:48",
        "PASS deliberate spawn failure test",
        "Unit tests PASSED",
        "successful test\n".repeat(1000),
        "FAIL browser-download-boundary.integration.test.js > blocks downloads",
        "Error: download.failure: Target page, context or browser has been closed",
        "at browser-download-boundary.integration.test.js:101:3",
        "Test Files 1 failed | 17 passed (18)",
        "Integration tests FAILED",
        "diagnostic retry\n".repeat(1000),
        "Integration tests PASSED",
        "##[error]The primary comprehensive test run did not pass; a diagnostic retry cannot replace it.",
      ].join("\n");
      const excerpt = diagnosticExcerpt(log, limit);
      expect(excerpt.length).toBeLessThanOrEqual(limit);
      expect(excerpt).toContain(
        "FAIL browser-download-boundary.integration.test.js",
      );
      expect(excerpt).toContain(
        "Target page, context or browser has been closed",
      );
      expect(excerpt).toContain("Unit tests PASSED");
      expect(excerpt).toContain("Integration tests FAILED");
      expect(excerpt).toContain("Integration tests PASSED");
      expect(excerpt).toContain("primary comprehensive test run did not pass");
    },
  );
  it.each([
    [
      "Python",
      'File "service.py", line 19, in load\nValueError: invalid configuration\n    load_config()',
      "service.py",
    ],
    [
      "Java",
      'Exception in thread "main" java.lang.IllegalStateException: failed\n    at Example.run(Example.java:42)',
      "Example.java:42",
    ],
    [
      "Go",
      "panic: invalid state\nmain.run()\n    /work/main.go:73",
      "main.go:73",
    ],
    [
      "Rust",
      "thread 'main' panicked at src/main.rs:12:5:\ninvalid state\nstack backtrace:",
      "main.rs:12:5",
    ],
  ])(
    "preserves %s error location in long build or runtime output",
    (_language, failure, location) => {
      const output =
        "setup\n".repeat(2000) + failure + "\n" + "cleanup\n".repeat(2000);
      const excerpt = diagnosticExcerpt(output);
      expect(excerpt).toContain(location);
      expect(excerpt.length).toBeLessThanOrEqual(1600);
    },
  );
  it("keeps expected negative-test context and the separate worker failure", () => {
    const log = [
      "setup\n".repeat(1000),
      "Temp/cc-runcode-test-1/bad.js:1",
      "broken {",
      "SyntaxError: Unexpected token '{'",
      "    at compileSourceTextModule (node:internal/modules/esm/utils:346:16)",
      "PASS negative execution test",
      "passing test\n".repeat(1000),
      "[vitest-pool]: Worker forks emitted error",
      "Error: Worker exited unexpectedly",
      "    at worker-exit.js:42:9",
      "more output\n".repeat(1000),
      "Test Files 78 passed (78)",
      "Process completed with exit code 1",
    ].join("\n");
    const excerpt = diagnosticExcerpt(log);
    expect(excerpt.length).toBeLessThanOrEqual(1600);
    expect(excerpt).toContain("bad.js:1");
    expect(excerpt).toContain("SyntaxError");
    expect(excerpt).toContain("Worker forks emitted error");
    expect(excerpt).toContain("worker-exit.js:42:9");
    expect(excerpt).toContain("exit code 1");
  });
  it("retains late foreground errors when the output prefix is truncated", () => {
    const result = shellOutputPreview(
      "noise\n".repeat(10000) + "\nError: late failure\n    at task.js:14:2",
      "stdout",
      4000,
    );
    expect(result.stdout_truncated).toBe(true);
    expect(result.stdout_diagnostics).toContain("task.js:14:2");
    expect(JSON.stringify(result.stdout).length).toBeLessThanOrEqual(4000);
  });
  it("pages escaped Unicode without dropping or splitting content", () => {
    const source = '"\\\n😀'.repeat(1000);
    let remaining = source;
    let combined = "";
    while (remaining.length) {
      const page = shellOutputPage(remaining, 256);
      expect(page.text.length).toBeGreaterThan(0);
      expect(JSON.stringify(page.text).length).toBeLessThanOrEqual(256);
      expect(page.text).not.toMatch(/[\uD800-\uDBFF]$/);
      combined += page.text;
      remaining = remaining.slice(page.text.length);
      expect(page.remaining).toBe(remaining.length);
    }
    expect(combined).toBe(source);
  });
});
