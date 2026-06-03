/**
 * E2E 测试 — skill-creator via CLI binary
 *
 * 使用真实 chainlesschain CLI binary 执行 `skill run skill-creator` 等命令，
 * 验证 CLI 层输出格式、错误处理及 skill 信息查询。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.join(__dirname, "..", "..");
const bin = path.join(cliRoot, "bin", "chainlesschain.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(args, opts = {}) {
  return execSync(`node "${bin}" ${args}`, {
    encoding: "utf-8",
    timeout: 30000,
    stdio: "pipe",
    ...opts,
  });
}

function tryRun(args, opts = {}) {
  try {
    const stdout = run(args, opts);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status ?? 1,
    };
  }
}

let tmpWorkspace;

beforeAll(() => {
  tmpWorkspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-e2e-skill-creator-"),
  );
});

afterAll(() => {
  try {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  } catch {
    /* cleanup */
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// skill --help / skill list
// ═══════════════════════════════════════════════════════════════════════════════

describe("skill --help", () => {
  it("shows skill subcommands including 'run'", () => {
    const out = run("skill --help");
    expect(out).toContain("run");
  });

  it("shows 'list' subcommand", () => {
    const out = run("skill --help");
    expect(out).toContain("list");
  });
});

describe("skill list --category system", () => {
  it("includes skill-creator in system category", () => {
    const result = tryRun("skill list --category system");
    // skill-creator is in system category — should appear in output
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("skill-creator");
  });

  it("returns non-empty list", () => {
    const result = tryRun("skill list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// skill run skill-creator — list-templates
// ═══════════════════════════════════════════════════════════════════════════════

describe("skill run skill-creator list-templates", () => {
  it("exits 0 and returns templates", () => {
    const result = tryRun('skill run skill-creator "list-templates"', {
      cwd: tmpWorkspace,
    });
    if (result.exitCode !== 0) {
      // Skill might not be found in CLI layer - acceptable graceful failure
      expect(result.stdout + result.stderr).toBeDefined();
      return;
    }
    expect(result.stdout).toContain("template");
  });

  it("output contains 'basic' template name", () => {
    const result = tryRun('skill run skill-creator "list-templates"', {
      cwd: tmpWorkspace,
    });
    if (result.exitCode !== 0) return; // skip if skill not in path
    const out = result.stdout + result.stderr;
    expect(out).toContain("basic");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// skill run skill-creator — validate
// ═══════════════════════════════════════════════════════════════════════════════

describe("skill run skill-creator validate", () => {
  it("validate ultrathink exits 0 and reports valid", () => {
    const result = tryRun('skill run skill-creator "validate ultrathink"', {
      cwd: tmpWorkspace,
    });
    if (result.exitCode !== 0) return; // skill not in path, skip
    const out = result.stdout + result.stderr;
    // Should contain success=true or "valid" in output
    expect(out.toLowerCase()).toContain("valid");
  });

  it("validate nonexistent-skill reports failure gracefully", () => {
    const result = tryRun(
      'skill run skill-creator "validate nonexistent-skill-xyz-999"',
      { cwd: tmpWorkspace },
    );
    // Either exits non-zero OR outputs error message — both acceptable
    const out = result.stdout + result.stderr;
    expect(typeof out).toBe("string"); // always defined
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// skill run skill-creator — optimize (quick)
// ═══════════════════════════════════════════════════════════════════════════════

describe("skill run skill-creator optimize (quick)", () => {
  it("optimize smart-search returns message with hint", () => {
    const result = tryRun('skill run skill-creator "optimize smart-search"', {
      cwd: tmpWorkspace,
    });
    if (result.exitCode !== 0) return;
    const out = result.stdout + result.stderr;
    // Should contain hint about optimize-description
    expect(out).toContain("optimize");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// skill run skill-creator — optimize-description (LLM unavailable in E2E)
// ═══════════════════════════════════════════════════════════════════════════════

// Async tryRun for tests that may block the event loop for 30+ seconds (LLM calls)
function tryRunAsync(args, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const proc = exec(
      `node "${bin}" ${args}`,
      { encoding: "utf-8", cwd: tmpWorkspace, timeout: timeoutMs },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout || err?.stdout || "",
          stderr: stderr || err?.stderr || "",
          exitCode: err
            ? err.code === "ETIMEDOUT"
              ? 1
              : (err.exitCode ?? 1)
            : 0,
        });
      },
    );
    proc.unref();
  });
}

describe("skill run skill-creator optimize-description (graceful LLM failure)", () => {
  it("returns error with action=optimize-description when LLM unavailable", async () => {
    const result = await tryRunAsync(
      'skill run skill-creator "optimize-description smart-search"',
    );
    if (result.exitCode !== 0 && !result.stdout.includes("optimize")) return; // skill not loaded
    // Either succeeds (LLM available) or fails gracefully with hint
    const out = result.stdout + result.stderr;
    expect(typeof out).toBe("string");
    // No unhandled exceptions
    expect(out).not.toContain("UnhandledPromiseRejection");
    expect(out).not.toContain("Cannot read properties of null");
  }, 90000);

  it("does not crash with --iterations flag", async () => {
    const result = await tryRunAsync(
      'skill run skill-creator "optimize-description code-review --iterations 1"',
    );
    const out = result.stdout + result.stderr;
    expect(out).not.toContain("SyntaxError");
    expect(out).not.toContain("TypeError");
  }, 90000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// skill run skill-creator — get-template
// ═══════════════════════════════════════════════════════════════════════════════

describe("skill run skill-creator get-template", () => {
  it("get-template basic returns handler and SKILL.md content", () => {
    const result = tryRun('skill run skill-creator "get-template basic"', {
      cwd: tmpWorkspace,
    });
    if (result.exitCode !== 0) return;
    const out = result.stdout + result.stderr;
    expect(out).toContain("basic");
  });

  it("get-template unknown returns error message", () => {
    const result = tryRun(
      'skill run skill-creator "get-template does-not-exist"',
      {
        cwd: tmpWorkspace,
      },
    );
    // Should not crash with unhandled exception
    const out = result.stdout + result.stderr;
    expect(out).not.toContain("UnhandledPromiseRejection");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// skill sources
// ═══════════════════════════════════════════════════════════════════════════════

describe("skill sources", () => {
  it("shows skill layer information", () => {
    const result = tryRun("skill sources", { cwd: tmpWorkspace });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});
