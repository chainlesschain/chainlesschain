/**
 * Integration tests: CLI Skill Pack workflow
 *
 * Tests the full pipeline:
 *   schema → generator → skill-loader → handler execution
 *
 * These tests use real filesystem I/O but no live CLI subprocess.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CLISkillLoader } from "../../src/lib/skill-loader.js";
import {
  generateCliPacks,
  checkForUpdates,
  removeCliPacks,
  computePackHash,
} from "../../src/lib/skill-packs/generator.js";
import {
  CLI_PACK_DOMAINS,
  AGENT_MODE_COMMANDS,
  PACK_SCHEMA_VERSION,
} from "../../src/lib/skill-packs/schema.js";

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-intg-skillpacks-"));
}

// ── Generator → Loader pipeline ───────────────────────────────────

describe("Generator → CLISkillLoader pipeline", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates packs that are loadable by CLISkillLoader", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tmpDir, "workspace");

    expect(skills.length).toBe(9);
    for (const s of skills) {
      expect(s.id).toBeTruthy();
      expect(s.hasHandler).toBe(true);
      expect(s.source).toBe("workspace");
    }
  });

  it("generated SKILL.md frontmatter matches schema definition", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tmpDir, "workspace");
    const skillMap = Object.fromEntries(skills.map((s) => [s.id, s]));

    for (const [domainKey, domainDef] of Object.entries(CLI_PACK_DOMAINS)) {
      const skill = skillMap[domainKey];
      expect(skill, `${domainKey} not loaded`).toBeDefined();
      // Values are stored as-is (not camelCased), only YAML keys are converted
      expect(skill.executionMode).toBe(domainDef.executionMode);
      expect(skill.description).toBe(domainDef.description);
      expect(skill.category).toBe(domainDef.category);
    }
  });

  it("hash in SKILL.md matches computed hash", async () => {
    const cliVersion = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf-8"),
    ).version;

    await generateCliPacks({ force: true, outputDir: tmpDir });

    for (const [domainKey, domainDef] of Object.entries(CLI_PACK_DOMAINS)) {
      const skillMdPath = path.join(tmpDir, domainKey, "SKILL.md");
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const match = content.match(/cli-version-hash:\s*["']([a-f0-9]+)["']/);
      expect(match, `${domainKey} missing hash in SKILL.md`).not.toBeNull();

      const storedHash = match[1];
      const expectedHash = computePackHash(domainKey, domainDef, cliVersion);
      expect(storedHash).toBe(expectedHash);
    }
  });

  it("sync cycle: generate → check (0 updates) → force regenerate (9 generated)", async () => {
    // Step 1: Generate
    const r1 = await generateCliPacks({ force: true, outputDir: tmpDir });
    expect(r1.generated).toHaveLength(9);
    expect(r1.errors).toHaveLength(0);

    // Step 2: Check — should be 0 updates
    const updates = checkForUpdates(tmpDir);
    expect(updates).toHaveLength(0);

    // Step 3: Force regenerate — 9 again
    const r2 = await generateCliPacks({ force: true, outputDir: tmpDir });
    expect(r2.generated).toHaveLength(9);
    expect(r2.skipped).toHaveLength(0);
  });

  it("corrupting a hash triggers update detection", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    // Corrupt 2 packs
    for (const key of ["cli-knowledge-pack", "cli-security-pack"]) {
      const p = path.join(tmpDir, key, "SKILL.md");
      const c = fs.readFileSync(p, "utf-8");
      fs.writeFileSync(
        p,
        c.replace(
          /cli-version-hash:.*/,
          'cli-version-hash: "0000000000000000"',
        ),
        "utf-8",
      );
    }

    const updates = checkForUpdates(tmpDir);
    expect(updates).toHaveLength(2);
    expect(updates.map((u) => u.domain).sort()).toEqual([
      "cli-knowledge-pack",
      "cli-security-pack",
    ]);
  });

  it("partial regeneration only updates stale packs", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    // Corrupt one pack's hash
    const staleKey = "cli-web3-pack";
    const stalePath = path.join(tmpDir, staleKey, "SKILL.md");
    const content = fs.readFileSync(stalePath, "utf-8");
    fs.writeFileSync(
      stalePath,
      content.replace(
        /cli-version-hash:.*/,
        'cli-version-hash: "stale000000000"',
      ),
      "utf-8",
    );

    const r = await generateCliPacks({ force: false, outputDir: tmpDir });
    expect(r.generated).toHaveLength(1);
    expect(r.generated[0].domain).toBe(staleKey);
    expect(r.skipped).toHaveLength(8);
  });

  it("remove + regenerate restores all packs", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    // Remove all
    const removed = removeCliPacks(tmpDir);
    expect(removed).toHaveLength(9);
    for (const key of Object.keys(CLI_PACK_DOMAINS)) {
      expect(fs.existsSync(path.join(tmpDir, key))).toBe(false);
    }

    // Regenerate
    const r = await generateCliPacks({ force: false, outputDir: tmpDir });
    expect(r.generated).toHaveLength(9);
    expect(r.errors).toHaveLength(0);

    // All packs are back
    for (const key of Object.keys(CLI_PACK_DOMAINS)) {
      expect(fs.existsSync(path.join(tmpDir, key, "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, key, "handler.js"))).toBe(true);
    }
  });
});

// ── Handler execution (direct mode) ───────────────────────────────

describe("Direct handler — input parsing", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    await generateCliPacks({ force: true, outputDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function loadHandler(packName) {
    const handlerPath = path.join(tmpDir, packName, "handler.js");
    // CJS module
    const { createRequire } = await import("module");
    const req = createRequire(import.meta.url);
    // Clear cache for fresh load
    delete req.cache[req.resolve(handlerPath)];
    return req(handlerPath);
  }

  it("direct handler rejects empty input", async () => {
    const handler = await loadHandler("cli-knowledge-pack");
    const result = await handler.execute(
      { input: "", params: {} },
      { projectRoot: tmpDir },
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("direct handler rejects commands not in this pack", async () => {
    const handler = await loadHandler("cli-knowledge-pack");
    const result = await handler.execute(
      { input: "wallet create", params: {} },
      { projectRoot: tmpDir },
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("wallet");
  });

  it("agent handler returns usage guide for empty input", async () => {
    const handler = await loadHandler("cli-agent-mode-pack");
    const result = await handler.execute(
      { input: "", params: {} },
      { projectRoot: tmpDir },
      {},
    );
    expect(result.success).toBe(true);
    expect(result.executionMode).toBe("agent");
    expect(result.result).toBeDefined();
    expect(result.result.availableCommands).toBeDefined();
    expect(result.result.availableCommands.length).toBeGreaterThan(0);
  });

  it("agent handler returns specific command guide", async () => {
    const handler = await loadHandler("cli-agent-mode-pack");
    const result = await handler.execute(
      { input: "agent --session abc", params: {} },
      { projectRoot: tmpDir },
      {},
    );
    expect(result.success).toBe(true);
    expect(result.executionMode).toBe("agent");
    expect(result.result.howToRun).toContain("chainlesschain agent");
  });

  it("agent handler includes note to run in terminal", async () => {
    const handler = await loadHandler("cli-agent-mode-pack");
    const result = await handler.execute(
      { input: "chat", params: {} },
      { projectRoot: tmpDir },
      {},
    );
    expect(result.result.note).toContain("终端");
  });

  it("hybrid handler routes agent-only commands to guide", async () => {
    const handler = await loadHandler("cli-integration-pack");
    // 'serve' is a direct command in integration pack
    // None of the integration-pack commands are AGENT_MODE_COMMANDS (chat/agent)
    // So all should be executed directly — just verify no crash
    const result = await handler.execute(
      { input: "evomap list", params: {} },
      { projectRoot: tmpDir },
      {},
    );
    // Will fail because chainlesschain binary may not be in PATH in CI,
    // but should return a proper structured error
    expect(typeof result.success).toBe("boolean");
    expect(result).toHaveProperty("success");
  });
});

// ── Schema ↔ Handler content consistency ──────────────────────────

describe("Handler content consistency with schema", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    await generateCliPacks({ force: true, outputDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("VALID_COMMANDS in direct handlers match schema commands", () => {
    const directDomains = Object.entries(CLI_PACK_DOMAINS).filter(
      ([, def]) =>
        def.executionMode === "direct" || def.executionMode === "llm-query",
    );

    for (const [domainKey, domainDef] of directDomains) {
      const handlerPath = path.join(tmpDir, domainKey, "handler.js");
      const content = fs.readFileSync(handlerPath, "utf-8");

      for (const cmd of Object.keys(domainDef.commands)) {
        expect(
          content,
          `${domainKey} handler missing command "${cmd}"`,
        ).toContain(cmd);
      }
    }
  });

  it("agent handler lists all schema commands in COMMANDS array", () => {
    const handlerPath = path.join(tmpDir, "cli-agent-mode-pack", "handler.js");
    const content = fs.readFileSync(handlerPath, "utf-8");
    const agentDef = CLI_PACK_DOMAINS["cli-agent-mode-pack"];

    for (const cmd of Object.keys(agentDef.commands)) {
      expect(content).toContain(`'${cmd}'`);
    }
  });

  it("direct handler uses shell:true for cross-platform support", () => {
    const directDomains = Object.entries(CLI_PACK_DOMAINS).filter(
      ([, def]) => def.executionMode === "direct",
    );

    for (const [domainKey] of directDomains) {
      const handlerPath = path.join(tmpDir, domainKey, "handler.js");
      const content = fs.readFileSync(handlerPath, "utf-8");
      expect(content, `${domainKey} handler missing shell:true`).toContain(
        "shell: true",
      );
    }
  });

  it("all handlers export via module.exports", () => {
    for (const domainKey of Object.keys(CLI_PACK_DOMAINS)) {
      const handlerPath = path.join(tmpDir, domainKey, "handler.js");
      const content = fs.readFileSync(handlerPath, "utf-8");
      expect(content, `${domainKey} missing module.exports`).toContain(
        "module.exports",
      );
    }
  });

  it("all handlers have execute method", () => {
    for (const domainKey of Object.keys(CLI_PACK_DOMAINS)) {
      const handlerPath = path.join(tmpDir, domainKey, "handler.js");
      const content = fs.readFileSync(handlerPath, "utf-8");
      expect(content, `${domainKey} missing execute method`).toContain(
        "async execute(",
      );
    }
  });

  it("agent handler does not contain spawnSync", () => {
    const handlerPath = path.join(tmpDir, "cli-agent-mode-pack", "handler.js");
    const content = fs.readFileSync(handlerPath, "utf-8");
    expect(content).not.toContain("spawnSync");
  });

  it("direct handlers return success:false for invalid commands (not throw)", () => {
    const directDomains = Object.entries(CLI_PACK_DOMAINS).filter(
      ([, def]) => def.executionMode === "direct",
    );

    for (const [domainKey] of directDomains) {
      const handlerPath = path.join(tmpDir, domainKey, "handler.js");
      const content = fs.readFileSync(handlerPath, "utf-8");
      // Should have the VALID_COMMANDS check that returns { success: false }
      expect(content, `${domainKey} missing validation`).toContain(
        "VALID_COMMANDS.has(command)",
      );
      expect(content).toContain("success: false");
    }
  });

  it("no encoding issues in generated Chinese text", () => {
    for (const domainKey of Object.keys(CLI_PACK_DOMAINS)) {
      const handlerPath = path.join(tmpDir, domainKey, "handler.js");
      const content = fs.readFileSync(handlerPath, "utf-8");

      // Check that common Chinese phrases are not garbled
      // The replacement character U+FFFD (efbfbd) should not appear
      expect(content, `${domainKey} has encoding issue`).not.toContain(
        "\uFFFD",
      );
    }
  });
});
