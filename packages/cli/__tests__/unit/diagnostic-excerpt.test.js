import { describe, it, expect } from "vitest";
import { diagnosticExcerpt } from "../../src/lib/diagnostic-excerpt.js";
import {
  shellOutputPage,
  shellOutputPreview,
} from "../../src/lib/shell-output.js";

describe("diagnostic source preservation", () => {
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
