/**
 * Hermes Parity E2E Tests — CLI command-level verification for 6 Hermes-inspired modules:
 *   1. Module import verification (iteration-budget, session-search, user-profile,
 *      plugin-autodiscovery, execution-backend, gateway-base)
 *   2. User Profile round-trip (getUserProfilePath, update, read, cleanup)
 *   3. Iteration Budget defaults and env override
 *   4. Execution Backend factory and LocalBackend live execution
 *   5. Plugin Discovery (scanPluginDir, getPluginDir)
 *   6. Gateway + Discord Formatter
 *
 * 22 tests total (20 core + 2 behavioral)
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

// file:// URL for ESM dynamic imports (forward slashes, Windows-safe)
const srcRootUrl = "file:///" + cliRoot.replace(/\\/g, "/");

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

/**
 * Run an inline ESM script via a temp .mjs file.
 * The script has access to __srcRoot for dynamic imports.
 */
function runScript(code, opts = {}) {
  const scriptPath = path.join(
    tmpWorkspace,
    `check-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mjs`,
  );
  const fullCode = `const __srcRoot = "${srcRootUrl}";\n${code}`;
  fs.writeFileSync(scriptPath, fullCode, "utf-8");
  try {
    const stdout = execSync(`node "${scriptPath}"`, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: "pipe",
      cwd: cliRoot,
      ...opts,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status ?? 1,
    };
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }
  }
}

let tmpWorkspace;

beforeAll(() => {
  tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-hermes-"));
});

afterAll(() => {
  if (tmpWorkspace && fs.existsSync(tmpWorkspace)) {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 1. Module Import Verification (6 tests)
// ═══════════════════════════════════════════════════════════════════════

describe("hermes parity — module import verification", () => {
  it("iteration-budget exports IterationBudget and WarningLevel", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/iteration-budget.js');
      const keys = Object.keys(m).sort().join(',');
      console.log(keys);
      if (typeof m.IterationBudget !== 'function') throw new Error('IterationBudget not a function');
      if (typeof m.WarningLevel !== 'object') throw new Error('WarningLevel not an object');
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("IterationBudget");
    expect(result.stdout).toContain("WarningLevel");
  });

  it("session-search exports SessionSearchIndex", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/session-search.js');
      const keys = Object.keys(m).sort().join(',');
      console.log(keys);
      if (typeof m.SessionSearchIndex !== 'function') throw new Error('SessionSearchIndex not a function');
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("SessionSearchIndex");
  });

  it("user-profile exports readUserProfile, updateUserProfile, getUserProfilePath", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/user-profile.js');
      const keys = Object.keys(m).sort().join(',');
      console.log(keys);
      if (typeof m.readUserProfile !== 'function') throw new Error('readUserProfile not a function');
      if (typeof m.updateUserProfile !== 'function') throw new Error('updateUserProfile not a function');
      if (typeof m.getUserProfilePath !== 'function') throw new Error('getUserProfilePath not a function');
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("readUserProfile");
    expect(result.stdout).toContain("updateUserProfile");
    expect(result.stdout).toContain("getUserProfilePath");
  });

  it("plugin-autodiscovery exports scanPluginDir and getAutoDiscoveredPlugins", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/plugin-autodiscovery.js');
      const keys = Object.keys(m).sort().join(',');
      console.log(keys);
      if (typeof m.scanPluginDir !== 'function') throw new Error('scanPluginDir not a function');
      if (typeof m.getAutoDiscoveredPlugins !== 'function') throw new Error('getAutoDiscoveredPlugins not a function');
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("scanPluginDir");
    expect(result.stdout).toContain("getAutoDiscoveredPlugins");
  });

  it("execution-backend exports LocalBackend, DockerBackend, SSHBackend, createBackend", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/execution-backend.js');
      const keys = Object.keys(m).sort().join(',');
      console.log(keys);
      if (typeof m.LocalBackend !== 'function') throw new Error('LocalBackend not a function');
      if (typeof m.DockerBackend !== 'function') throw new Error('DockerBackend not a function');
      if (typeof m.SSHBackend !== 'function') throw new Error('SSHBackend not a function');
      if (typeof m.createBackend !== 'function') throw new Error('createBackend not a function');
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("LocalBackend");
    expect(result.stdout).toContain("DockerBackend");
    expect(result.stdout).toContain("SSHBackend");
    expect(result.stdout).toContain("createBackend");
  });

  it("gateway-base exports GatewayBase", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/gateways/gateway-base.js');
      const keys = Object.keys(m).sort().join(',');
      console.log(keys);
      if (typeof m.GatewayBase !== 'function') throw new Error('GatewayBase not a function');
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("GatewayBase");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. User Profile CLI (4 tests)
// ═══════════════════════════════════════════════════════════════════════

describe("hermes parity — user profile round-trip", () => {
  it("getUserProfilePath returns a path containing USER.md", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/user-profile.js');
      const p = m.getUserProfilePath();
      console.log(p);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toContain("USER.md");
  });

  it("updateUserProfile writes content and returns written:true", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/user-profile.js');
      const r = m.updateUserProfile("hermes-e2e-test-content-12345");
      console.log(JSON.stringify(r));
    `);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout.trim());
    expect(data.written).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("readUserProfile returns what was written", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/user-profile.js');
      const content = m.readUserProfile();
      console.log(content);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toContain("hermes-e2e-test-content-12345");
  });

  it("cleanup: updateUserProfile with empty string resets profile", () => {
    // updateUserProfile("") returns written:false (empty string guard),
    // so write a minimal placeholder instead to overwrite test data
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/user-profile.js');
      const r = m.updateUserProfile(".");
      console.log(JSON.stringify(r));
    `);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout.trim());
    expect(data.written).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Iteration Budget CLI (3 tests)
// ═══════════════════════════════════════════════════════════════════════

describe("hermes parity — iteration budget", () => {
  it("default budget has limit 50", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/iteration-budget.js');
      const b = new m.IterationBudget();
      console.log(b.limit);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("50");
  });

  it("custom budget via constructor options.limit", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/iteration-budget.js');
      const b = new m.IterationBudget({ limit: 100 });
      console.log(b.limit);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("100");
  });

  it("consume() tracks usage and returns warning levels", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/iteration-budget.js');
      const b = new m.IterationBudget({ limit: 10 });
      // consume 7 iterations (70% = WARNING threshold)
      for (let i = 0; i < 7; i++) b.consume();
      const level = b.warningLevel();
      const remaining = b.remaining();
      console.log(JSON.stringify({ level, remaining, consumed: b.consumed }));
    `);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout.trim());
    expect(data.level).toBe("warning");
    expect(data.remaining).toBe(3);
    expect(data.consumed).toBe(7);
  });

  it("CC_ITERATION_BUDGET env var overrides default limit", () => {
    const result = runScript(
      `
      const m = await import(__srcRoot + '/src/lib/iteration-budget.js');
      const limit = m.IterationBudget.resolveLimit();
      console.log(limit);
    `,
      {
        env: { ...process.env, CC_ITERATION_BUDGET: "25" },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("25");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Execution Backend CLI (3 tests)
// ═══════════════════════════════════════════════════════════════════════

describe("hermes parity — execution backend", () => {
  it("createBackend() returns local backend by default", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/execution-backend.js');
      const b = m.createBackend();
      console.log(b.type);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("local");
  });

  it("createBackend with docker type returns docker backend", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/execution-backend.js');
      const b = m.createBackend({ type: 'docker', options: { image: 'alpine' } });
      console.log(b.type);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("docker");
  });

  it("LocalBackend.execute runs echo and returns stdout", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/execution-backend.js');
      const b = new m.LocalBackend();
      const r = b.execute('echo hello-hermes');
      console.log(JSON.stringify({ stdout: r.stdout.trim(), exitCode: r.exitCode }));
    `);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout.trim());
    expect(data.stdout).toContain("hello-hermes");
    expect(data.exitCode).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Plugin Discovery CLI (2 tests)
// ═══════════════════════════════════════════════════════════════════════

describe("hermes parity — plugin discovery", () => {
  it("scanPluginDir returns an array (may be empty)", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/plugin-autodiscovery.js');
      const files = m.scanPluginDir();
      console.log(JSON.stringify({ isArray: Array.isArray(files), length: files.length }));
    `);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout.trim());
    expect(data.isArray).toBe(true);
  });

  it("getPluginDir returns path containing plugins", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/lib/plugin-autodiscovery.js');
      const dir = m.getPluginDir();
      console.log(dir);
    `);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toContain("plugins");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Gateway + Discord Formatter CLI (2 tests)
// ═══════════════════════════════════════════════════════════════════════

describe("hermes parity — gateway and formatter", () => {
  it("GatewayBase can be instantiated with platform name", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/gateways/gateway-base.js');
      const gw = new m.GatewayBase({ platform: 'test-e2e' });
      const stats = gw.getStats();
      console.log(JSON.stringify(stats));
    `);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout.trim());
    expect(data.platform).toBe("test-e2e");
    expect(data.running).toBe(false);
    expect(data.sessions).toBe(0);
  });

  it("GatewayBase session management round-trip works", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/gateways/gateway-base.js');
      const gw = new m.GatewayBase({ platform: 'test' });
      const s1 = gw.getOrCreateSession('chat-1');
      gw.addMessage('chat-1', 'user', 'hello');
      const count = gw.getSessionCount();
      gw.clearSession('chat-1');
      const countAfter = gw.getSessionCount();
      console.log(JSON.stringify({ isNew: s1.isNew, count, countAfter }));
    `);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout.trim());
    expect(data.isNew).toBe(true);
    expect(data.count).toBe(1);
    expect(data.countAfter).toBe(0);
  });

  it("formatForDiscord truncates text longer than 2000 chars", () => {
    const result = runScript(`
      const m = await import(__srcRoot + '/src/gateways/discord/discord-formatter.js');
      const longText = 'A'.repeat(3000);
      const formatted = m.formatForDiscord(longText);
      console.log(JSON.stringify({ length: formatted.length, endsWith: formatted.endsWith('...') }));
    `);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout.trim());
    expect(data.length).toBe(2000);
    expect(data.endsWith).toBe(true);
  });
});
