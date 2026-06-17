/**
 * E2E for `cc pair preflight` (#21 A.1 PR1).
 *
 * Spawns the real CLI subprocess to verify:
 *   - the subcommand is wired into the command tree
 *   - --json mode emits a parseable report
 *   - human-readable mode includes the check banner
 *   - exit code matches summary
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

// 30s default: `cc pair preflight` runs 5 checks and its cold start can exceed
// 15s under integration load, getting killed (status null) before the test's own
// timeout. Matches the documented subprocess-timeout family (README 2026-06-14).
function runCli(args, timeoutMs = 30000) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    encoding: "utf-8",
    timeout: timeoutMs,
  });
}

function extractJson(text) {
  const lines = text.split(/\r?\n/);
  for (let s = 0; s < lines.length; s++) {
    const t = lines[s].trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      for (let e = lines.length; e > s; e--) {
        try {
          return JSON.parse(lines.slice(s, e).join("\n"));
        } catch (_err) {
          /* try shorter */
        }
      }
    }
  }
  throw new Error(`No JSON in: ${text.slice(0, 300)}`);
}

describe("cc pair preflight — E2E (#21 A.1 PR1)", () => {
  it("--json: emits parseable report with all 5 checks", () => {
    const r = runCli(["pair", "preflight", "--json"]);
    // Exit code 0/1/2 all acceptable; the test box may have firewall blockers.
    expect([0, 1, 2]).toContain(r.status);
    const report = extractJson(r.stdout);
    expect(report.checks).toBeDefined();
    expect(report.checks.length).toBe(5);
    expect(report.summary).toBeDefined();
    expect(typeof report.summary.ok).toBe("number");
    expect(typeof report.summary.warnings).toBe("number");
    expect(typeof report.summary.blockers).toBe("number");
    expect(report.exitCode).toBe(r.status);
    // Check names locked.
    const names = report.checks.map((c) => c.name).sort();
    expect(names).toEqual([
      "firewall_hint",
      "interfaces",
      "multicast_bind",
      "platform",
      "port_5353_holders",
    ]);
  }, 30000);

  it("human-readable mode includes banner + summary", () => {
    const r = runCli(["pair", "preflight"]);
    expect([0, 1, 2]).toContain(r.status);
    expect(r.stdout).toContain("cc pair preflight");
    expect(r.stdout).toContain("summary:");
    // At least one of these check names must be in output:
    expect(r.stdout).toMatch(/multicast_bind|interfaces|platform/);
  }, 30000);

  it("--help: lists preflight subcommand", () => {
    const r = runCli(["pair", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("preflight");
  }, 15000);
});
