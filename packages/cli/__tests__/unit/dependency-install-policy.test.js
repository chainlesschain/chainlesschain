/**
 * dependency-install-policy (gap-analysis 2026-07-11 P0 "依赖安装与凭据"):
 * opt-in resolution precedence, PEP 503 allowlist matching, audit append.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  normalizePackageName,
  resolveAutoInstallPolicy,
  isPackageAllowed,
  autoInstallDisabledHint,
  recordInstallAudit,
} from "../../src/lib/dependency-install-policy.js";

afterEach(() => {
  delete process.env.CC_RUN_CODE_AUTO_INSTALL;
});

describe("normalizePackageName (PEP 503)", () => {
  it("lowercases and collapses -_. runs", () => {
    expect(normalizePackageName("Django_REST--framework")).toBe(
      "django-rest-framework",
    );
    expect(normalizePackageName("Pillow")).toBe("pillow");
    expect(normalizePackageName("  zope.interface ")).toBe("zope-interface");
  });
});

describe("resolveAutoInstallPolicy", () => {
  it("defaults to DISABLED", () => {
    const p = resolveAutoInstallPolicy({ cwd: tmpdir() });
    expect(p.enabled).toBe(false);
    expect(p.source).toBe("default");
  });

  it("env CC_RUN_CODE_AUTO_INSTALL wins outright", () => {
    process.env.CC_RUN_CODE_AUTO_INSTALL = "1";
    expect(resolveAutoInstallPolicy({ cwd: tmpdir() })).toMatchObject({
      enabled: true,
      source: "env",
    });
    process.env.CC_RUN_CODE_AUTO_INSTALL = "0";
    expect(resolveAutoInstallPolicy({ cwd: tmpdir() })).toMatchObject({
      enabled: false,
      source: "env",
    });
  });

  it("settings runCode.autoInstall + installAllowlist opt in per project", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cc-dep-policy-"));
    try {
      const claudeDir = path.join(dir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.json"),
        JSON.stringify({
          runCode: {
            autoInstall: true,
            installAllowlist: ["Requests", "zope.interface"],
          },
        }),
        "utf-8",
      );
      const p = resolveAutoInstallPolicy({ cwd: dir });
      expect(p.enabled).toBe(true);
      expect(p.source).toBe("settings");
      expect(p.allowlist).toEqual(["requests", "zope-interface"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isPackageAllowed", () => {
  it("no allowlist → anything valid is allowed", () => {
    expect(isPackageAllowed("pandas", null)).toBe(true);
  });
  it("allowlist matches PEP 503-normalized names", () => {
    const list = ["django-rest-framework", "requests"];
    expect(isPackageAllowed("Django_REST.framework", list)).toBe(true);
    expect(isPackageAllowed("pandas", list)).toBe(false);
  });
});

describe("audit + hint", () => {
  it("hint names the package and the opt-in paths", () => {
    const h = autoInstallDisabledHint("pandas");
    expect(h).toContain("pandas");
    expect(h).toContain("runCode");
    expect(h).toContain("CC_RUN_CODE_AUTO_INSTALL");
  });

  it("recordInstallAudit appends a JSONL line to the injected dir", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cc-dep-audit-"));
    try {
      recordInstallAudit(
        { package: "pandas", outcome: "blocked", cwd: "/x" },
        { baseDir: dir, now: () => 1750000000000 },
      );
      recordInstallAudit(
        { package: "requests", outcome: "installed" },
        { baseDir: dir },
      );
      const lines = fs
        .readFileSync(path.join(dir, "dependency-install.jsonl"), "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        kind: "dependency-install",
        package: "pandas",
        outcome: "blocked",
      });
      expect(lines[0].ts).toBe(new Date(1750000000000).toISOString());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
