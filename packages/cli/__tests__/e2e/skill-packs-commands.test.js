/**
 * E2E tests: skill sync-cli and related skill commands
 *
 * Tests the full CLI pipeline by executing the real chainlesschain binary.
 * Validates command output, JSON structures, and error handling.
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

// Temp workspace directory shared by tests in this file
let tmpWorkspace;
let origDir;

beforeAll(() => {
  tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-skillpacks-"));
  origDir = process.cwd();
});

afterAll(() => {
  try {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  } catch {
    /* cleanup */
  }
});

// ── skill sync-cli --help ──────────────────────────────────────────

describe("skill sync-cli --help", () => {
  it("shows sync-cli subcommand description", () => {
    const out = run("skill sync-cli --help");
    expect(out).toContain("sync-cli");
    expect(out).toContain("CLI command skill packs");
  });

  it("shows --force option", () => {
    const out = run("skill sync-cli --help");
    expect(out).toContain("--force");
  });

  it("shows --dry-run option", () => {
    const out = run("skill sync-cli --help");
    expect(out).toContain("--dry-run");
  });

  it("shows --remove option", () => {
    const out = run("skill sync-cli --help");
    expect(out).toContain("--remove");
  });

  it("shows --json option", () => {
    const out = run("skill sync-cli --help");
    expect(out).toContain("--json");
  });
});

// ── skill sync-cli --dry-run ───────────────────────────────────────

describe("skill sync-cli --dry-run", () => {
  it("runs without error", () => {
    const result = tryRun(
      `skill sync-cli --dry-run --output "${tmpWorkspace}"`,
    );
    expect(result.exitCode).toBe(0);
  });

  it("shows preview output with domain names", () => {
    // Remove any existing packs first to ensure all show as new
    const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-dryrun-"));
    try {
      const out = run(`skill sync-cli --dry-run --output "${cleanDir}"`);
      expect(out).toContain("cli-knowledge-pack");
      expect(out).toContain("cli-agent-mode-pack");
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  it("reports total and pending counts", () => {
    const cleanDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-e2e-dryrun-cnt-"),
    );
    try {
      const out = run(`skill sync-cli --dry-run --output "${cleanDir}"`);
      expect(out).toMatch(/Need update: \d+/);
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  it("does NOT write any files", () => {
    const cleanDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-e2e-dryrun-nowrite-"),
    );
    try {
      run(`skill sync-cli --dry-run --output "${cleanDir}"`);
      const entries = fs.readdirSync(cleanDir);
      expect(entries).toHaveLength(0);
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }
  });
});

// ── skill sync-cli (generate) ─────────────────────────────────────

describe("skill sync-cli generation", () => {
  let genDir;

  beforeAll(() => {
    genDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-gen-"));
  });

  afterAll(() => {
    try {
      fs.rmSync(genDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  it("generates all 9 packs successfully", () => {
    const result = tryRun(`skill sync-cli --force --output "${genDir}"`);
    expect(result.exitCode).toBe(0);
  });

  it("output mentions 'generated'", () => {
    const out = run(`skill sync-cli --force --output "${genDir}"`);
    expect(out.toLowerCase()).toMatch(/generated|生成/);
  });

  it("creates SKILL.md for each domain", () => {
    run(`skill sync-cli --force --output "${genDir}"`);

    const expectedPacks = [
      "cli-knowledge-pack",
      "cli-identity-pack",
      "cli-infra-pack",
      "cli-ai-query-pack",
      "cli-agent-mode-pack",
      "cli-web3-pack",
      "cli-security-pack",
      "cli-enterprise-pack",
      "cli-integration-pack",
    ];

    for (const pack of expectedPacks) {
      expect(
        fs.existsSync(path.join(genDir, pack, "SKILL.md")),
        `${pack}/SKILL.md not created`,
      ).toBe(true);
      expect(
        fs.existsSync(path.join(genDir, pack, "handler.js")),
        `${pack}/handler.js not created`,
      ).toBe(true);
    }
  });

  it("--json output is valid JSON with generated array", () => {
    const out = run(`skill sync-cli --force --json --output "${genDir}"`);
    // Find JSON start (skip spinner output)
    const jsonStart = out.indexOf("{");
    expect(jsonStart).not.toBe(-1);
    const jsonStr = out.slice(jsonStart);
    const data = JSON.parse(jsonStr);

    expect(data).toHaveProperty("generated");
    expect(data).toHaveProperty("skipped");
    expect(data).toHaveProperty("errors");
    expect(data).toHaveProperty("cliVersion");
    expect(Array.isArray(data.generated)).toBe(true);
    expect(data.errors).toHaveLength(0);
  });

  it("second run without --force skips all (up-to-date)", () => {
    // First generate
    run(`skill sync-cli --force --output "${genDir}"`);
    // Second run: should skip all
    const out = run(`skill sync-cli --output "${genDir}"`);
    expect(out.toLowerCase()).toMatch(/up-to-date|skipped/);
  });
});

// ── skill sync-cli --remove ────────────────────────────────────────

describe("skill sync-cli --remove", () => {
  it("removes generated packs", () => {
    const rmDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-remove-"));
    try {
      // Generate first
      run(`skill sync-cli --force --output "${rmDir}"`);
      expect(fs.existsSync(path.join(rmDir, "cli-knowledge-pack"))).toBe(true);

      // Remove
      const out = tryRun(`skill sync-cli --remove --output "${rmDir}"`);
      expect(out.exitCode).toBe(0);
      expect(fs.existsSync(path.join(rmDir, "cli-knowledge-pack"))).toBe(false);
    } finally {
      fs.rmSync(rmDir, { recursive: true, force: true });
    }
  });

  it("gracefully handles removing non-existent packs", () => {
    const emptyDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-e2e-remove-empty-"),
    );
    try {
      const result = tryRun(`skill sync-cli --remove --output "${emptyDir}"`);
      expect(result.exitCode).toBe(0);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

// ── skill list with CLI packs ──────────────────────────────────────

describe("skill list integration with CLI packs", () => {
  let packDir;

  beforeAll(() => {
    packDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-list-"));
    // Generate packs to a known location
    run(`skill sync-cli --force --output "${packDir}"`);
  });

  afterAll(() => {
    try {
      fs.rmSync(packDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  it("skill --help shows sync-cli subcommand", () => {
    const out = run("skill --help");
    expect(out).toContain("sync-cli");
  });

  it("generated SKILL.md content is valid UTF-8 (no replacement chars)", () => {
    const packs = fs
      .readdirSync(packDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("cli-"))
      .map((d) => d.name);

    expect(packs.length).toBe(9);

    for (const pack of packs) {
      const content = fs.readFileSync(
        path.join(packDir, pack, "SKILL.md"),
        "utf-8",
      );
      // No UTF-8 replacement character
      expect(content, `${pack}/SKILL.md has encoding issues`).not.toContain(
        "\uFFFD",
      );
    }
  });

  it("generated handler.js content is valid UTF-8", () => {
    const packs = fs
      .readdirSync(packDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("cli-"))
      .map((d) => d.name);

    for (const pack of packs) {
      const content = fs.readFileSync(
        path.join(packDir, pack, "handler.js"),
        "utf-8",
      );
      expect(content, `${pack}/handler.js has encoding issues`).not.toContain(
        "\uFFFD",
      );
    }
  });

  it("SKILL.md for agent-mode-pack has correct category", () => {
    const content = fs.readFileSync(
      path.join(packDir, "cli-agent-mode-pack", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("category: cli-agent");
    expect(content).toContain("execution-mode: agent");
  });

  it("SKILL.md for knowledge-pack has correct category", () => {
    const content = fs.readFileSync(
      path.join(packDir, "cli-knowledge-pack", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("category: cli-direct");
    expect(content).toContain("execution-mode: direct");
  });
});

// ── skill sync-cli edge cases ──────────────────────────────────────

describe("skill sync-cli edge cases", () => {
  it("accepts unknown output dir and creates it", () => {
    const newDir = path.join(os.tmpdir(), `cc-e2e-newdir-${Date.now()}`);
    try {
      expect(fs.existsSync(newDir)).toBe(false);
      run(`skill sync-cli --force --output "${newDir}"`);
      // Directory should now exist
      expect(fs.existsSync(newDir)).toBe(true);
    } finally {
      if (fs.existsSync(newDir)) {
        fs.rmSync(newDir, { recursive: true, force: true });
      }
    }
  });

  it("--force and --dry-run flags do not conflict (dry-run wins)", () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-e2e-conflict-"));
    try {
      run(`skill sync-cli --force --dry-run --output "${testDir}"`);
      const entries = fs.readdirSync(testDir);
      expect(entries).toHaveLength(0); // dry-run means nothing written
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
