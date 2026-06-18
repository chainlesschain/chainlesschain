import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { CLI_BIN, testHome } from "./_helpers/cli-e2e.js";

/**
 * E2E: the centralized friendly-error boundary in bin/chainlesschain.js.
 *
 * An uncaught error thrown from a command action (here: malformed JSON passed
 * to `--metadata`, which `governance register-proposer-v2` parses before it
 * touches the DB) used to surface as a raw Node stack trace. The boundary turns
 * it into a clean `error: <message>` with exit code 1, and restores the full
 * stack only under --verbose.
 */
describe("E2E: CLI friendly-error boundary", () => {
  const t = testHome("error-boundary");
  afterAll(() => t.cleanup());

  const run = (args) =>
    spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...t.env(), NODE_NO_WARNINGS: "1" },
    });

  const crashArgs = [
    "governance",
    "register-proposer-v2",
    "PROP1",
    "--realm",
    "test",
    "--metadata",
    "{bad",
  ];

  it("prints a clean one-line error (no stack trace) and exits 1", () => {
    const r = run(crashArgs);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^error: /m);
    // No raw stack trace lines leaked to the user.
    expect(r.stderr).not.toMatch(/\n\s+at /);
    expect(r.stderr).not.toContain("SyntaxError");
  });

  it("restores the full stack trace under --verbose", () => {
    const r = run([...crashArgs, "--verbose"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("SyntaxError");
    expect(r.stderr).toMatch(/\n\s+at /);
  });

  it("does not disturb a normal successful command", () => {
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.stderr).not.toMatch(/^error: /m);
  });
});
