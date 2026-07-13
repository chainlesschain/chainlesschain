/**
 * Tests for the `cc doctor --export-bundle` wiring (IDE gap P1-9 seam):
 * doctor report → de-identified diagnostic bundle → secret-scan gate → file.
 *
 * The bundle assembler + gate itself is covered by diagnostic-bundle.test.js;
 * here we lock the WIRING — the pure git-worktree parser, the report→input
 * mapper, and the end-to-end export that must never leak an env value.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseGitWorktrees,
  buildDoctorDiagnosticInput,
} from "../../src/runtime/diagnostics.js";
import { runExportBundle } from "../../src/commands/doctor.js";

describe("parseGitWorktrees", () => {
  it("parses porcelain entries with branch stripped of refs/heads/", () => {
    const porcelain = [
      "worktree /repo/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/wt-feature",
      "HEAD def456",
      "branch refs/heads/feature/x",
      "",
    ].join("\n");
    expect(parseGitWorktrees(porcelain)).toEqual([
      { path: "/repo/main", branch: "main" },
      { path: "/repo/wt-feature", branch: "feature/x" },
    ]);
  });

  it("yields branch:null for a detached worktree", () => {
    const porcelain = [
      "worktree /repo/detached",
      "HEAD abc123",
      "detached",
      "",
    ].join("\n");
    expect(parseGitWorktrees(porcelain)).toEqual([
      { path: "/repo/detached", branch: null },
    ]);
  });

  it("returns [] for empty / non-string input", () => {
    expect(parseGitWorktrees("")).toEqual([]);
    expect(parseGitWorktrees(null)).toEqual([]);
    expect(parseGitWorktrees(undefined)).toEqual([]);
  });
});

describe("buildDoctorDiagnosticInput", () => {
  const report = {
    version: "0.162.163",
    ports: [
      { name: "ollama", port: 11434, open: true },
      { name: "qdrant", port: 6333, open: false },
    ],
  };

  it("maps version + open-only ports and stamps this platform", () => {
    const input = buildDoctorDiagnosticInput(report, {});
    expect(input.version).toBe("0.162.163");
    // closed ports are dropped
    expect(input.ports).toEqual([{ port: 11434, proto: "ollama" }]);
    expect(input.platform.os).toBe(process.platform);
    expect(input.platform.arch).toBe(process.arch);
  });

  it("passes through worktrees/lockfiles/env signals; defaults when absent", () => {
    const input = buildDoctorDiagnosticInput(report, {
      worktrees: [{ path: "/repo", branch: "main" }],
      lockfiles: ["/home/a.lock"],
      env: { FOO: "bar" },
    });
    expect(input.worktrees).toEqual([{ path: "/repo", branch: "main" }]);
    expect(input.lockfiles).toEqual(["/home/a.lock"]);
    expect(input.env).toEqual({ FOO: "bar" });

    const bare = buildDoctorDiagnosticInput(report, {});
    expect(bare.worktrees).toEqual([]);
    expect(bare.lockfiles).toEqual([]);
    expect(bare.env).toEqual({});
  });

  it("tolerates a null report", () => {
    const input = buildDoctorDiagnosticInput(null, {});
    expect(input.version).toBeNull();
    expect(input.ports).toEqual([]);
  });
});

describe("runExportBundle (end-to-end wiring)", () => {
  let tmp;
  const SECRET_ENV = "CC_TEST_BUNDLE_SECRET_TOKEN";
  const SECRET_VALUE = "sk-livetoken0123456789abcdefABCDEF";

  afterEach(() => {
    delete process.env[SECRET_ENV];
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = null;
    }
    process.exitCode = 0;
  });

  it("writes a v1 bundle whose env carries the NAME but never the VALUE", async () => {
    process.env[SECRET_ENV] = SECRET_VALUE;
    tmp = mkdtempSync(join(tmpdir(), "cc-diag-"));
    const outPath = join(tmp, "bundle.json");

    const report = {
      version: "9.9.9",
      ports: [{ name: "ollama", port: 11434, open: true }],
    };
    const result = await runExportBundle(report, outPath);
    expect(result.ok).toBe(true);

    const raw = readFileSync(outPath, "utf-8");
    const bundle = JSON.parse(raw);

    expect(bundle.schema).toBe("cc-diagnostic-bundle/v1");
    expect(bundle.meta.version).toBe("9.9.9");
    // env name is present and flagged secret-named…
    expect(bundle.env.names).toContain(SECRET_ENV);
    expect(bundle.env.secretNames).toContain(SECRET_ENV);
    // …but the raw secret VALUE never appears anywhere in the exported bytes.
    expect(raw).not.toContain(SECRET_VALUE);
    // terminal output is withheld by default
    expect(bundle.terminalOutput).toBeNull();
  });
});
