/**
 * Integration: `cc eval --history` appends run records and `cc eval --trend`
 * reports the pass-rate trend + fails (exit 1) on a regression. Uses --dry-run
 * so no model is needed; the trend-gate path is exercised with a hand-seeded
 * two-run history (a real regression) plus a live dry-run append round-trip.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "..", "bin", "chainlesschain.js");

function runCc(args) {
  return spawnSync(process.execPath, [BIN, "eval", ...args], {
    encoding: "utf8",
    env: { ...process.env, CLAUDECODE: "1" },
    windowsHide: true,
  });
}

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-evaltrend-"));
});
afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("cc eval --history / --trend", () => {
  it("tags --dry-run appends and EXCLUDES them from the trend (no gate poisoning)", () => {
    // A dry-run is always 0%: before the dryRun tag, smoke-testing with
    // `--dry-run --history` made the next --trend see every previously-passing
    // task as a regression and fail the CI gate.
    const hist = path.join(tmp, "h.jsonl");
    // Seed one REAL (all-green) run…
    fs.writeFileSync(
      hist,
      JSON.stringify({
        ranAt: "2026-07-01",
        passed: 2,
        total: 2,
        passRate: 1,
        results: [
          { id: "a", pass: true },
          { id: "b", pass: true },
        ],
      }) + "\n",
      "utf8",
    );
    // …then append a live 0% dry-run AFTER it.
    const r = runCc(["--dry-run", "--history", hist, "--label", "smoke"]);
    expect(r.status).toBe(1); // dry-run passes 0 tasks → non-zero (expected)
    const lines = fs.readFileSync(hist, "utf8").split(/\r?\n/).filter(Boolean);
    expect(lines).toHaveLength(2);
    // The appended record is tagged.
    expect(JSON.parse(lines[1]).dryRun).toBe(true);
    // The trend only sees the real run — flat gate, no fake regression.
    const t = runCc(["--trend", "--history", hist]);
    expect(t.status).toBe(0);
    expect(t.stdout).toMatch(/Eval trend over 1 run/);
    expect(t.stdout).not.toMatch(/REGRESSED/);
  });

  it("fails the gate (exit 1) when a task regresses between runs", () => {
    const hist = path.join(tmp, "reg.jsonl");
    fs.writeFileSync(
      hist,
      [
        JSON.stringify({
          ranAt: "2026-07-01",
          passed: 2,
          total: 2,
          passRate: 1,
          results: [
            { id: "a", pass: true },
            { id: "b", pass: true },
          ],
        }),
        JSON.stringify({
          ranAt: "2026-07-02",
          passed: 1,
          total: 2,
          passRate: 0.5,
          results: [
            { id: "a", pass: false },
            { id: "b", pass: true },
          ],
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const t = runCc(["--trend", "--history", hist]);
    expect(t.status).toBe(1);
    expect(t.stdout).toMatch(/REGRESSED/);
    expect(t.stdout).toMatch(/regressions: a/);
  });

  it("errors when --trend is used without --history", () => {
    const t = runCc(["--trend"]);
    expect(t.status).toBe(1);
    expect(t.stderr).toMatch(/--trend requires --history/);
  });
});
