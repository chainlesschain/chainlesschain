import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Regression: `cc marketplace purchase` computed the multisig threshold as
// `options.thresholdFen ?? DEFAULT`. A malformed --threshold-fen becomes NaN
// (parseInt("oops")), and `NaN ?? default` keeps NaN (nullish only catches
// null/undefined), so `amountFen >= NaN` is always false — a large order that
// must route through M-of-N multisig silently took the direct path. The guard
// now rejects a non-finite explicit --threshold-fen (exit 2), like --amount-fen.

const CLI_DIR = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(CLI_DIR, "bin", "chainlesschain.js");

function run(args) {
  try {
    const stdout = execSync(`node "${BIN}" ${args}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });
    return { code: 0, stdout };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: (err.stdout || "") + (err.stderr || ""),
    };
  }
}

describe("cc marketplace purchase --threshold-fen guard", () => {
  it("rejects a non-numeric --threshold-fen instead of bypassing the multisig gate", () => {
    // Large amount that MUST require multisig; garbage threshold used to make
    // `amountFen >= NaN` false → direct path. Must now fail validation.
    const r = run(
      "marketplace purchase item1 --amount-fen 5000000 --buyer did:x --threshold-fen oops",
    );
    expect(r.code).toBe(2);
    expect(r.stdout).not.toContain("direct");
  });
});
