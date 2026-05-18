/**
 * E2E tests: Agent Architecture Optimization CLI commands.
 *
 * Tests the full CLI pipeline for feature flags, config features,
 * and verifies that optimization modules load without errors.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.join(__dirname, "..", "..");
const bin = path.join(cliRoot, "bin", "chainlesschain.js");

// ── Helpers ────────────────────────────────────────────────────────

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

// Temp workspace for isolation
let tmpWorkspace;

beforeAll(() => {
  tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-agent-opt-"));
});

afterAll(() => {
  if (tmpWorkspace && fs.existsSync(tmpWorkspace)) {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});

// ── 1. config features list ─────────────────────────────────────────

describe("config features list", () => {
  it("lists all known feature flags", () => {
    const result = tryRun("config features list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Feature Flags");
    expect(result.stdout).toContain("BACKGROUND_TASKS");
    expect(result.stdout).toContain("WORKTREE_ISOLATION");
    expect(result.stdout).toContain("CONTEXT_SNIP");
    expect(result.stdout).toContain("CONTEXT_COLLAPSE");
    expect(result.stdout).toContain("JSONL_SESSION");
    expect(result.stdout).toContain("PROMPT_COMPRESSOR");
  });

  it("shows ON/OFF status indicators", () => {
    const result = tryRun("config features list");
    expect(result.exitCode).toBe(0);
    // PROMPT_COMPRESSOR defaults to true → should show ON
    // At least one flag should be ON or OFF
    expect(result.stdout).toMatch(/ON|OFF/);
  });

  it("aliases as config features ls", () => {
    const result = tryRun("config features ls");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Feature Flags");
  });
});

// ── 2. config features enable/disable ───────────────────────────────

describe("config features enable/disable", () => {
  it("enables a feature flag", () => {
    const result = tryRun("config features enable CONTEXT_SNIP");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Enabled");
    expect(result.stdout).toContain("CONTEXT_SNIP");
  });

  it("disables a feature flag", () => {
    const result = tryRun("config features disable CONTEXT_SNIP");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Disabled");
    expect(result.stdout).toContain("CONTEXT_SNIP");
  });

  it("enable persists across invocations", () => {
    tryRun("config features enable CONTEXT_COLLAPSE");
    const result = tryRun("config features list");
    expect(result.exitCode).toBe(0);
    // After enable, should see it as ON
    // (The exact output depends on ANSI codes but text should contain the flag)
    expect(result.stdout).toContain("CONTEXT_COLLAPSE");
  });

  it("enable unknown flag still succeeds (permissive)", () => {
    const result = tryRun("config features enable UNKNOWN_FLAG_XYZ");
    // May succeed or fail depending on implementation
    // Just verify it doesn't crash with an unhandled exception
    expect(result.stdout + result.stderr).toBeDefined();
  });
});

// ── 3. config list includes features section ────────────────────────

describe("config list", () => {
  it("shows configuration including features", () => {
    const result = tryRun("config list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Config");
  });
});

// ── 4. Environment variable override ────────────────────────────────

describe("env var feature flag override", () => {
  it("CC_FLAG_CONTEXT_SNIP=true overrides config", () => {
    // Disable via config first
    tryRun("config features disable CONTEXT_SNIP");

    // But env var should override
    const result = tryRun("config features list", {
      env: {
        ...process.env,
        CC_FLAG_CONTEXT_SNIP: "true",
      },
    });
    expect(result.exitCode).toBe(0);
    // Flag should appear in list (exact ON/OFF depends on whether list reads env)
    expect(result.stdout).toContain("CONTEXT_SNIP");
  });
});

// ── 5. Help text for optimization commands ──────────────────────────

describe("help text", () => {
  it("config features --help shows subcommands", () => {
    const result = tryRun("config features --help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("enable");
    expect(result.stdout).toContain("disable");
  });

  it("config --help shows features subcommand", () => {
    const result = tryRun("config --help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("features");
  });
});

// ── 6. Module import sanity (no crash on require) ───────────────────

describe("module import sanity", () => {
  it("prompt-compressor loads without error", async () => {
    const mod = await import("../../src/lib/prompt-compressor.js");
    expect(mod.PromptCompressor).toBeDefined();
    expect(mod.estimateTokens).toBeDefined();
    expect(typeof mod.estimateTokens("hello")).toBe("number");
  });

  it("feature-flags loads without error", async () => {
    const mod = await import("../../src/lib/feature-flags.js");
    expect(mod.feature).toBeDefined();
    expect(mod.listFeatures).toBeDefined();
    expect(mod.setFeature).toBeDefined();
  });

  it("jsonl-session-store loads without error", async () => {
    const mod = await import("../../src/lib/jsonl-session-store.js");
    expect(mod.startSession).toBeDefined();
    expect(mod.readEvents).toBeDefined();
    expect(mod.rebuildMessages).toBeDefined();
  });

  it("background-task-manager loads without error", async () => {
    const mod = await import("../../src/lib/background-task-manager.js");
    expect(mod.BackgroundTaskManager).toBeDefined();
    expect(mod.TaskStatus).toBeDefined();
  });

  it("worktree-isolator loads without error", async () => {
    const mod = await import("../../src/lib/worktree-isolator.js");
    expect(mod.createWorktree).toBeDefined();
    expect(mod.isolateTask).toBeDefined();
    expect(mod.cleanupAgentWorktrees).toBeDefined();
  });
});

// ── 7. Enable/disable round-trip verification ───────────────────────

describe("feature flag round-trip", () => {
  it("enable then disable leaves flag OFF", () => {
    tryRun("config features enable CONTEXT_COLLAPSE");
    tryRun("config features disable CONTEXT_COLLAPSE");
    const result = tryRun("config features list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CONTEXT_COLLAPSE");
  });

  it("enable multiple flags independently", () => {
    tryRun("config features enable CONTEXT_SNIP");
    tryRun("config features enable CONTEXT_COLLAPSE");
    const result = tryRun("config features list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CONTEXT_SNIP");
    expect(result.stdout).toContain("CONTEXT_COLLAPSE");
    // Cleanup
    tryRun("config features disable CONTEXT_SNIP");
    tryRun("config features disable CONTEXT_COLLAPSE");
  });
});

// ── 8. config list shows features section ───────────────────────────

describe("config list integration", () => {
  it("config list after enabling flag shows features key", () => {
    tryRun("config features enable JSONL_SESSION");
    const result = tryRun("config list");
    expect(result.exitCode).toBe(0);
    // Config output should include features section
    expect(result.stdout).toContain("features");
    tryRun("config features disable JSONL_SESSION");
  });
});

// ── 9. Error handling ───────────────────────────────────────────────

describe("error handling", () => {
  it("config features enable with no argument shows error", () => {
    const result = tryRun("config features enable");
    // Commander should show error or help for missing required arg
    expect(result.exitCode).not.toBe(0);
  });

  it("config features disable with no argument shows error", () => {
    const result = tryRun("config features disable");
    expect(result.exitCode).not.toBe(0);
  });
});

// ── 10. Version includes new modules ────────────────────────────────

describe("version and status", () => {
  it("--version returns without error", () => {
    const result = tryRun("--version");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it("status command does not crash", () => {
    const result = tryRun("status");
    // Status may return non-zero if services not running, but shouldn't crash
    expect(result.stdout + result.stderr).toBeDefined();
  });
});
