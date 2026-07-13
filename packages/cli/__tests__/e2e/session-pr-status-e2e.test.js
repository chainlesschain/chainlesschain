/**
 * E2E (P1-4): `cc session pr-status --checks-file <json>` renders the PR/CI
 * automation decision offline (no gh / network). Runs the REAL cc bin.
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { testHome, CLI_BIN } from "./_helpers/cli-e2e.js";

const t = testHome("session-pr-status");
afterAll(() => t.cleanup());

function writeChecks(name, obj) {
  const p = path.join(t.home, name);
  fs.writeFileSync(p, JSON.stringify(obj), "utf-8");
  return p;
}

function run(args) {
  return spawnSync(
    process.execPath,
    [CLI_BIN, "session", "pr-status", ...args],
    { env: t.env(), cwd: t.home, encoding: "utf-8" },
  );
}

function parseJson(stdout) {
  const s = stdout.replace(/^﻿/, "");
  return JSON.parse(s.slice(s.indexOf("{")));
}

const READY = {
  branch: "feat/x",
  prNumber: 7,
  hasOpenPr: true,
  branchProtectionSatisfied: true,
  reviewApproved: true,
  pendingApprovals: 0,
  requiredChecks: ["build"],
  checks: [{ name: "build", state: "success" }],
};

describe("cc session pr-status (P1-4)", () => {
  it("blocks auto-merge by default and prints the status bar", () => {
    const f = writeChecks("pr.json", READY);
    const r = run(["--checks-file", f, "--json"]);
    expect(r.status).toBe(0);
    const out = parseJson(r.stdout);
    expect(out.autoMerge.allow).toBe(false);
    expect(out.autoMerge.unmet).toContain("auto-merge-disabled");
    expect(out.statusBar).toMatch(/PR#7/);
  }, 60_000);

  it("allows auto-merge with --enable when all requirements pass", () => {
    const f = writeChecks("pr2.json", READY);
    const r = run(["--checks-file", f, "--enable", "--json"]);
    expect(r.status).toBe(0);
    const out = parseJson(r.stdout);
    expect(out.autoMerge.allow).toBe(true);
  }, 60_000);

  it("blocks with --enable when a required check is pending", () => {
    const f = writeChecks("pr3.json", {
      ...READY,
      checks: [{ name: "build", state: "in_progress" }],
    });
    const r = run(["--checks-file", f, "--enable", "--json"]);
    expect(r.status).toBe(0);
    const out = parseJson(r.stdout);
    expect(out.autoMerge.allow).toBe(false);
    expect(out.autoMerge.unmet).toContain("checks-pending");
  }, 60_000);
});
