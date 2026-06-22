import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { CLI_BIN, testHome } from "./_helpers/cli-e2e.js";

/**
 * E2E: numeric CLI options no longer thread NaN downstream.
 *
 * Several commands used to do `parseInt(options.X)` with no guard, so a typo'd
 * value (`--kind xyz`, `--limit abc`) became NaN and silently corrupted the
 * operation — e.g. `session show --limit abc` did `slice(-NaN)` and printed
 * ALL messages instead of the requested tail. Every numeric option now routes
 * through `numericOption()` (src/lib/cli-numeric.js):
 *   - options WITHOUT a sane default (or state-changing writes) FAIL LOUDLY
 *   - options WITH a commander default fall back to that default on bad input
 * In neither case is NaN passed to a query / slice / computation.
 */
describe("E2E: numeric option validation (no NaN threading)", () => {
  const t = testHome("numeric-opt");
  afterAll(() => t.cleanup());

  const run = (args) =>
    spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...t.env(), NODE_NO_WARNINGS: "1" },
    });

  it("fails loudly on a non-numeric write option (nostr publish --kind)", () => {
    const r = run(["nostr", "publish", "hi", "--kind", "xyz"]);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/--kind must be a whole number/);
  });

  it("accepts a valid numeric option (nostr publish --kind 1)", () => {
    const r = run(["nostr", "publish", "hi", "--kind", "1"]);
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/must be a whole number/);
  });

  it("falls back to the default (never NaN) on a bad pagination option", () => {
    // --periods has a commander default ("3"); bad input falls back rather than
    // threading NaN into predictTrend. Command succeeds with a real prediction.
    const r = run([
      "bi",
      "predict",
      "--data",
      "[1,2,3,4]",
      "--periods",
      "abc",
      "--json",
    ]);
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/NaN/);
    expect(r.stdout).toMatch(/prediction/i);
  });

  it("fails loudly on a non-numeric float option (evolution train-v2 --data-size)", () => {
    const r = run([
      "evolution",
      "train-v2",
      "--strategy",
      "replay",
      "--data-size",
      "abc",
      "--loss-before",
      "1",
      "--loss-after",
      "0.5",
    ]);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/--data-size must be a number/);
  });

  it("rejects a bad commander coercer arg (stress run --concurrency)", () => {
    // `--concurrency` uses a validating coercer (intArg) instead of bare
    // parseInt, so commander rejects the value at parse time rather than
    // threading NaN into the load generator.
    const r = run(["stress", "run", "--concurrency", "abc"]);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(
      /option '-c, --concurrency <n>' argument 'abc' is invalid/,
    );
  });
});
