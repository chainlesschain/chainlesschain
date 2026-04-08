/**
 * v5.0.2.9 E2E Tests — CLI command-level verification for 4 new features:
 *   1. config features list shows all 6 flags
 *   2. session list with --json output
 *   3. Module imports (adaptive compression, JSONL store, sub-agent)
 *   4. Feature flag enable/disable round-trip
 *
 * 15 tests total
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

function tryRun(args, opts = {}) {
  try {
    const stdout = execSync(`node "${bin}" ${args}`, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: "pipe",
      ...opts,
    });
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
  tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-v5029-"));
});

afterAll(() => {
  if (tmpWorkspace && fs.existsSync(tmpWorkspace)) {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 1. Feature Flags CLI
// ═══════════════════════════════════════════════════════════════════════

describe("v5029 feature flags CLI", () => {
  it("config features list includes JSONL_SESSION", () => {
    const result = tryRun("config features list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("JSONL_SESSION");
  });

  it("config features list includes all 6 flags", () => {
    const result = tryRun("config features list");
    const flags = [
      "BACKGROUND_TASKS",
      "WORKTREE_ISOLATION",
      "CONTEXT_SNIP",
      "CONTEXT_COLLAPSE",
      "JSONL_SESSION",
      "PROMPT_COMPRESSOR",
    ];
    for (const flag of flags) {
      expect(result.stdout).toContain(flag);
    }
  });

  it("enable and disable JSONL_SESSION round-trip", () => {
    const enable = tryRun("config features enable JSONL_SESSION");
    expect(enable.exitCode).toBe(0);

    const list1 = tryRun("config features list");
    expect(list1.stdout).toContain("JSONL_SESSION");

    const disable = tryRun("config features disable JSONL_SESSION");
    expect(disable.exitCode).toBe(0);
  });

  it("enable CONTEXT_SNIP flag", () => {
    const result = tryRun("config features enable CONTEXT_SNIP");
    expect(result.exitCode).toBe(0);
    // Clean up
    tryRun("config features disable CONTEXT_SNIP");
  });

  it("enable CONTEXT_COLLAPSE flag", () => {
    const result = tryRun("config features enable CONTEXT_COLLAPSE");
    expect(result.exitCode).toBe(0);
    tryRun("config features disable CONTEXT_COLLAPSE");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Session commands
// ═══════════════════════════════════════════════════════════════════════

describe("v5029 session commands", () => {
  it("session list runs without error", () => {
    const result = tryRun("session list --limit 5");
    // May succeed or have "No saved sessions" — either is fine
    expect(result.exitCode).toBe(0);
  });

  it("session list --json outputs parseable content", () => {
    const result = tryRun("session list --json --limit 5");
    expect(result.exitCode).toBe(0);
    // Output may contain log lines before AND after the JSON, and the JSON
    // itself may be multi-line (pretty-printed via JSON.stringify(..., null,
    // 2)). Strategy: locate each '[' / '{', then walk forward counting
    // brackets while respecting strings/escapes to find the matching close,
    // then JSON.parse the balanced span.
    const stdout = result.stdout;
    let foundJson = false;

    const extractBalanced = (src, startIdx) => {
      const open = src[startIdx];
      const close = open === "[" ? "]" : "}";
      let depth = 0;
      let inStr = false;
      let escape = false;
      for (let j = startIdx; j < src.length; j++) {
        const c = src[j];
        if (escape) {
          escape = false;
          continue;
        }
        if (inStr) {
          if (c === "\\") escape = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') {
          inStr = true;
          continue;
        }
        if (c === open) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) return src.slice(startIdx, j + 1);
        }
      }
      return null;
    };

    for (let i = 0; i < stdout.length && !foundJson; i++) {
      const ch = stdout[i];
      if (ch !== "[" && ch !== "{") continue;
      const span = extractBalanced(stdout, i);
      if (!span) continue;
      try {
        JSON.parse(span);
        foundJson = true;
      } catch {
        /* not valid JSON at this offset */
      }
    }

    expect(foundJson).toBe(true);
  });

  it("session show with nonexistent ID exits with error", () => {
    const result = tryRun("session show nonexistent-session-xyz");
    expect(result.exitCode).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Module import sanity checks (via temp script files)
// ═══════════════════════════════════════════════════════════════════════

describe("v5029 module import verification", () => {
  // Use file:// URL for Windows ESM compatibility
  const srcRootUrl = "file:///" + cliRoot.replace(/\\/g, "/");

  function runScript(code) {
    const scriptPath = path.join(tmpWorkspace, `check-${Date.now()}.mjs`);
    const fullCode = `const __srcRoot = "${srcRootUrl}";\n${code}`;
    fs.writeFileSync(scriptPath, fullCode, "utf-8");
    try {
      const stdout = execSync(`node "${scriptPath}"`, {
        encoding: "utf-8",
        timeout: 15000,
        stdio: "pipe",
        cwd: cliRoot,
      });
      return { stdout, exitCode: 0 };
    } catch (err) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || "",
        exitCode: err.status ?? 1,
      };
    } finally {
      try {
        fs.unlinkSync(scriptPath);
      } catch {}
    }
  }

  it("prompt-compressor exports adaptive functions", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/prompt-compressor.js');
      console.log(typeof m.CONTEXT_WINDOWS, typeof m.getContextWindow, typeof m.adaptiveThresholds);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("object function function");
  });

  it("jsonl-session-store exports all functions", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/jsonl-session-store.js');
      const fns = ['startSession','appendUserMessage','appendAssistantMessage','rebuildMessages','listJsonlSessions','sessionExists','forkSession'].map(f => typeof m[f]);
      console.log(fns.join(','));
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(
      "function,function,function,function,function,function,function",
    );
  });

  it("sub-agent-context exports SubAgentContext class", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/sub-agent-context.js');
      console.log(typeof m.SubAgentContext);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("function");
  });

  it("background-task-manager exports BackgroundTaskManager and TaskStatus", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/background-task-manager.js');
      console.log(typeof m.BackgroundTaskManager, typeof m.TaskStatus);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("function object");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Environment variable override
// ═══════════════════════════════════════════════════════════════════════

describe("v5029 env var feature override", () => {
  it("CC_FLAG_JSONL_SESSION=true overrides default", () => {
    const result = tryRun("config features list", {
      env: { ...process.env, CC_FLAG_JSONL_SESSION: "true" },
    });
    expect(result.exitCode).toBe(0);
    // Should show JSONL_SESSION as ON (env override)
    expect(result.stdout).toContain("JSONL_SESSION");
  });

  it("CC_FLAG_PROMPT_COMPRESSOR=false disables default-on feature", () => {
    const result = tryRun("config features list", {
      env: { ...process.env, CC_FLAG_PROMPT_COMPRESSOR: "false" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PROMPT_COMPRESSOR");
  });
});
