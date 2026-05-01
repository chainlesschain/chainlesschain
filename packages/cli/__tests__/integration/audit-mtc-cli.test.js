/**
 * Integration test: cc audit mtc (Phase 2 audit double-track scaffolding).
 * Drives the CLI via subprocess and asserts the off-by-default gate +
 * end-to-end emit → reconcile → reconcile-check round-trip.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

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

describe("cc audit mtc — CLI integration", () => {
  let tmpHome;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
    });
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-audit-mtc-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("audit mtc --help lists all subcommands", () => {
    const r = runCli(["audit", "mtc", "--help"]);
    expect(r.status, r.stderr).toBe(0);
    for (const sub of [
      "status",
      "config",
      "enable",
      "disable",
      "set-interval",
      "emit",
      "reconcile",
      "reconcile-check",
    ]) {
      expect(r.stdout).toContain(sub);
    }
  });

  it("status reports disabled by default", () => {
    const r = runCli([
      "audit",
      "mtc",
      "status",
      "--config-dir",
      tmpHome,
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);
    const s = extractJson(r.stdout);
    expect(s.config.enabled).toBe(false);
    expect(s.config.batch_interval_seconds).toBe(3600);
    expect(s.staging.count).toBe(0);
    expect(s.batches.count).toBe(0);
  });

  it("emit refuses when disabled, accepts with --force", () => {
    const r1 = runCli([
      "audit",
      "mtc",
      "emit",
      "--type",
      "auth",
      "--operation",
      "login",
      "--config-dir",
      tmpHome,
    ]);
    expect(r1.status).not.toBe(0);
    expect(r1.stderr + r1.stdout).toMatch(/disabled/i);

    const r2 = runCli([
      "audit",
      "mtc",
      "emit",
      "--type",
      "auth",
      "--operation",
      "login",
      "--actor",
      "alice",
      "--force",
      "--config-dir",
      tmpHome,
      "--json",
    ]);
    expect(r2.status, r2.stderr).toBe(0);
    const out = extractJson(r2.stdout);
    expect(out.ok).toBe(true);
    expect(out.event_id).toMatch(/^\d{14}-[a-f0-9]{12}$/);
  });

  it("end-to-end: enable → emit ×3 → reconcile → reconcile-check", () => {
    // 1. enable
    const enable = runCli([
      "audit",
      "mtc",
      "enable",
      "--config-dir",
      tmpHome,
      "--namespace",
      "mtc/v1/audit/test-org",
      "--interval",
      "60",
    ]);
    expect(enable.status, enable.stderr).toBe(0);
    expect(enable.stdout + enable.stderr).toMatch(/enabled/i);

    // 2. emit three events
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const r = runCli([
        "audit",
        "mtc",
        "emit",
        "--type",
        "auth",
        "--operation",
        `op-${i}`,
        "--config-dir",
        tmpHome,
        "--json",
      ]);
      expect(r.status, r.stderr).toBe(0);
      ids.push(extractJson(r.stdout).event_id);
    }

    // 3. reconcile
    const rec = runCli([
      "audit",
      "mtc",
      "reconcile",
      "--config-dir",
      tmpHome,
      "--json",
    ]);
    expect(rec.status, rec.stderr).toBe(0);
    const recJson = extractJson(rec.stdout);
    expect(recJson.skipped).toBe(false);
    expect(recJson.batchId).toBe("000001");
    expect(recJson.treeSize).toBe(3);
    expect(recJson.namespace).toBe("mtc/v1/audit/test-org/000001");

    // 4. reconcile (idempotent — empty staging)
    const rec2 = runCli([
      "audit",
      "mtc",
      "reconcile",
      "--config-dir",
      tmpHome,
      "--json",
    ]);
    expect(rec2.status).toBe(0);
    expect(extractJson(rec2.stdout).skipped).toBe(true);

    // 5. reconcile-check on each emitted id
    for (const id of ids) {
      const r = runCli([
        "audit",
        "mtc",
        "reconcile-check",
        id,
        "--config-dir",
        tmpHome,
        "--json",
      ]);
      expect(r.status, r.stderr).toBe(0);
      const out = extractJson(r.stdout);
      expect(out.found).toBe(true);
      expect(out.batchId).toBe("000001");
      expect(fs.existsSync(out.envelopePath)).toBe(true);
    }

    // 6. reconcile-check on unknown id → exit 2
    const unknown = runCli([
      "audit",
      "mtc",
      "reconcile-check",
      "20260101000000-deadbeefcafe",
      "--config-dir",
      tmpHome,
    ]);
    expect(unknown.status).toBe(2);
  });

  it("set-interval validates and persists", () => {
    const ok = runCli([
      "audit",
      "mtc",
      "set-interval",
      "60",
      "--config-dir",
      tmpHome,
    ]);
    expect(ok.status, ok.stderr).toBe(0);

    const cfg = extractJson(
      runCli(["audit", "mtc", "config", "--config-dir", tmpHome, "--json"])
        .stdout,
    );
    expect(cfg.batch_interval_seconds).toBe(60);

    const bad = runCli([
      "audit",
      "mtc",
      "set-interval",
      "0",
      "--config-dir",
      tmpHome,
    ]);
    expect(bad.status).not.toBe(0);
  });
});
