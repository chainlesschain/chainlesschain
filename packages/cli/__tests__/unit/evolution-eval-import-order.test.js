import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("evolution evaluation module initialization", () => {
  it.each([
    "evolution-eval-gate",
    "evolution-eval-child-evidence-ledger-adapter",
    "evolution-eval-process-supervisor",
    "evolution-eval-launch-admission",
    "skill-target-matrix-eval",
    "skill-evaluated-promotion",
  ])("loads %s first in a fresh Node process", (entry) => {
    const url = new URL(`../../src/lib/evolution/${entry}.js`, import.meta.url);
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(url.href)}); process.stdout.write("loaded");`,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(output).toBe("loaded");
  });
});
