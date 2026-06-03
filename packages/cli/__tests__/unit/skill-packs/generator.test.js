/**
 * CLI Skill Pack Generator Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  computePackHash,
  generateSkillMd,
  generateCliPacks,
  checkForUpdates,
  removeCliPacks,
} from "../../../src/lib/skill-packs/generator.js";
import {
  CLI_PACK_DOMAINS,
  PACK_SCHEMA_VERSION,
  AGENT_MODE_COMMANDS,
} from "../../../src/lib/skill-packs/schema.js";

// ── Helpers ────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clc-test-packs-"));
}

// ── computePackHash ────────────────────────────────────────────────

describe("computePackHash", () => {
  it("returns a 16-char hex string", () => {
    const domainKey = "cli-knowledge-pack";
    const domainDef = CLI_PACK_DOMAINS[domainKey];
    const hash = computePackHash(domainKey, domainDef, "1.0.0");
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("same inputs produce same hash", () => {
    const key = "cli-infra-pack";
    const def = CLI_PACK_DOMAINS[key];
    expect(computePackHash(key, def, "1.2.3")).toBe(
      computePackHash(key, def, "1.2.3"),
    );
  });

  it("different CLI version produces different hash", () => {
    const key = "cli-knowledge-pack";
    const def = CLI_PACK_DOMAINS[key];
    expect(computePackHash(key, def, "1.0.0")).not.toBe(
      computePackHash(key, def, "2.0.0"),
    );
  });

  it("different domain key produces different hash", () => {
    const def = CLI_PACK_DOMAINS["cli-knowledge-pack"];
    expect(computePackHash("cli-knowledge-pack", def, "1.0.0")).not.toBe(
      computePackHash("cli-infra-pack", def, "1.0.0"),
    );
  });
});

// ── generateSkillMd ────────────────────────────────────────────────

describe("generateSkillMd", () => {
  it("generates valid YAML frontmatter with required fields", () => {
    const key = "cli-knowledge-pack";
    const def = CLI_PACK_DOMAINS[key];
    const hash = computePackHash(key, def, "1.0.0");
    const md = generateSkillMd(key, def, hash);

    expect(md).toContain("---");
    expect(md).toContain(`name: ${key}`);
    expect(md).toContain(`display-name: ${def.displayName}`);
    expect(md).toContain(`execution-mode: ${def.executionMode}`);
    expect(md).toContain(`cli-version-hash: "${hash}"`);
    expect(md).toContain("user-invocable: true");
    expect(md).toContain("handler: handler.js");
  });

  it("includes all commands in documentation", () => {
    const key = "cli-knowledge-pack";
    const def = CLI_PACK_DOMAINS[key];
    const md = generateSkillMd(key, def, "abc123");

    for (const cmd of Object.keys(def.commands)) {
      expect(md).toContain(`\`${cmd}\``);
    }
  });

  it("adds agent warning for agent-mode packs", () => {
    const key = "cli-agent-mode-pack";
    const def = CLI_PACK_DOMAINS[key];
    const md = generateSkillMd(key, def, "abc123");

    expect(md).toContain("交互式终端");
    expect(md).toContain("agent");
  });

  it("does NOT add agent warning for direct packs", () => {
    const key = "cli-infra-pack";
    const def = CLI_PACK_DOMAINS[key];
    const md = generateSkillMd(key, def, "abc123");

    expect(md).not.toContain("handler不会直接执行指令");
  });

  it("includes command examples", () => {
    const key = "cli-knowledge-pack";
    const def = CLI_PACK_DOMAINS[key];
    const md = generateSkillMd(key, def, "abc123");

    // note example should appear
    expect(md).toContain("chainlesschain note");
  });
});

// ── Schema validation ──────────────────────────────────────────────

describe("CLI_PACK_DOMAINS schema", () => {
  it("defines exactly 9 domain packs", () => {
    expect(Object.keys(CLI_PACK_DOMAINS)).toHaveLength(9);
  });

  it("all domain keys start with 'cli-' and end with '-pack'", () => {
    for (const key of Object.keys(CLI_PACK_DOMAINS)) {
      expect(key).toMatch(/^cli-.+-pack$/);
    }
  });

  it("all domains have required fields", () => {
    const required = [
      "displayName",
      "description",
      "executionMode",
      "category",
      "tags",
      "commands",
    ];
    for (const [key, def] of Object.entries(CLI_PACK_DOMAINS)) {
      for (const field of required) {
        expect(def, `${key} missing ${field}`).toHaveProperty(field);
      }
    }
  });

  it("executionMode values are valid", () => {
    const valid = new Set(["direct", "llm-query", "agent", "hybrid"]);
    for (const [key, def] of Object.entries(CLI_PACK_DOMAINS)) {
      expect(
        valid,
        `${key} has invalid executionMode: ${def.executionMode}`,
      ).toContain(def.executionMode);
    }
  });

  it("category is cli-direct or cli-agent", () => {
    const valid = new Set(["cli-direct", "cli-agent"]);
    for (const [key, def] of Object.entries(CLI_PACK_DOMAINS)) {
      expect(valid, `${key} has invalid category: ${def.category}`).toContain(
        def.category,
      );
    }
  });

  it("each domain has at least 2 commands", () => {
    for (const [key, def] of Object.entries(CLI_PACK_DOMAINS)) {
      expect(
        Object.keys(def.commands).length,
        `${key} has too few commands`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("agent-mode-pack has executionMode=agent", () => {
    expect(CLI_PACK_DOMAINS["cli-agent-mode-pack"].executionMode).toBe("agent");
  });

  it("integration-pack has executionMode=hybrid", () => {
    expect(CLI_PACK_DOMAINS["cli-integration-pack"].executionMode).toBe(
      "hybrid",
    );
  });

  it("AGENT_MODE_COMMANDS includes chat and agent", () => {
    expect(AGENT_MODE_COMMANDS.has("chat")).toBe(true);
    expect(AGENT_MODE_COMMANDS.has("agent")).toBe(true);
  });

  it("all command entries have description field", () => {
    for (const [domainKey, def] of Object.entries(CLI_PACK_DOMAINS)) {
      for (const [cmd, info] of Object.entries(def.commands)) {
        expect(
          info.description,
          `${domainKey}.commands.${cmd} missing description`,
        ).toBeTruthy();
      }
    }
  });
});

// ── generateCliPacks (integration) ────────────────────────────────

describe("generateCliPacks", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  it("generates all 9 packs to output directory", async () => {
    const result = await generateCliPacks({ force: true, outputDir: tmpDir });

    expect(result.generated).toHaveLength(9);
    expect(result.errors).toHaveLength(0);
  });

  it("creates SKILL.md and handler.js for each pack", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    for (const domainKey of Object.keys(CLI_PACK_DOMAINS)) {
      const skillMd = path.join(tmpDir, domainKey, "SKILL.md");
      const handlerJs = path.join(tmpDir, domainKey, "handler.js");
      expect(fs.existsSync(skillMd), `${domainKey}/SKILL.md`).toBe(true);
      expect(fs.existsSync(handlerJs), `${domainKey}/handler.js`).toBe(true);
    }
  });

  it("skips unchanged packs on second run", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });
    const result2 = await generateCliPacks({ force: false, outputDir: tmpDir });

    expect(result2.generated).toHaveLength(0);
    expect(result2.skipped).toHaveLength(9);
  });

  it("force=true regenerates all packs", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });
    const result2 = await generateCliPacks({ force: true, outputDir: tmpDir });

    expect(result2.generated).toHaveLength(9);
    expect(result2.skipped).toHaveLength(0);
  });

  it("dry-run does not write files", async () => {
    const result = await generateCliPacks({
      force: true,
      dryRun: true,
      outputDir: tmpDir,
    });

    expect(result.generated).toHaveLength(9);
    expect(result.generated[0].dryRun).toBe(true);

    // No files should have been created
    const entries = fs.readdirSync(tmpDir);
    expect(entries).toHaveLength(0);
  });

  it("result includes executionMode and commandCount", async () => {
    const result = await generateCliPacks({ force: true, outputDir: tmpDir });

    const knowledgePack = result.generated.find(
      (g) => g.domain === "cli-knowledge-pack",
    );
    expect(knowledgePack).toBeDefined();
    expect(knowledgePack.executionMode).toBe("direct");
    expect(knowledgePack.commandCount).toBe(8);
  });

  it("agent-mode-pack generates agent handler", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    const handlerPath = path.join(tmpDir, "cli-agent-mode-pack", "handler.js");
    const content = fs.readFileSync(handlerPath, "utf-8");
    expect(content).toContain("COMMANDS");
    expect(content).toContain("executionMode");
    expect(content).toContain("agent");
    expect(content).not.toContain("spawnSync");
  });

  it("direct packs generate spawnSync handler", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    const handlerPath = path.join(tmpDir, "cli-knowledge-pack", "handler.js");
    const content = fs.readFileSync(handlerPath, "utf-8");
    expect(content).toContain("spawnSync");
    expect(content).toContain("chainlesschain");
    expect(content).toContain("VALID_COMMANDS");
  });

  it("hybrid pack handler includes AGENT_ONLY_COMMANDS", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    const handlerPath = path.join(tmpDir, "cli-integration-pack", "handler.js");
    const content = fs.readFileSync(handlerPath, "utf-8");
    expect(content).toContain("AGENT_ONLY_COMMANDS");
    expect(content).toContain("spawnSync");
  });

  it("SKILL.md has correct category for direct packs", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    const skillMd = path.join(tmpDir, "cli-infra-pack", "SKILL.md");
    const content = fs.readFileSync(skillMd, "utf-8");
    expect(content).toContain("category: cli-direct");
  });

  it("SKILL.md has cli-agent category for agent-mode-pack", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    const skillMd = path.join(tmpDir, "cli-agent-mode-pack", "SKILL.md");
    const content = fs.readFileSync(skillMd, "utf-8");
    expect(content).toContain("category: cli-agent");
  });
});

// ── checkForUpdates ────────────────────────────────────────────────

describe("checkForUpdates", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  it("returns all 9 domains when nothing is generated yet", () => {
    const updates = checkForUpdates(tmpDir);
    expect(updates).toHaveLength(9);
    for (const u of updates) {
      expect(u.changeReason).toBe("new");
      expect(u.exists).toBe(false);
    }
  });

  it("returns 0 updates after fresh generation", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });
    const updates = checkForUpdates(tmpDir);
    expect(updates).toHaveLength(0);
  });

  it("detects stale packs when SKILL.md has wrong hash", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    // Corrupt the hash of one pack
    const skillMdPath = path.join(tmpDir, "cli-knowledge-pack", "SKILL.md");
    const content = fs.readFileSync(skillMdPath, "utf-8");
    const corrupted = content.replace(
      /cli-version-hash: "[a-f0-9]+"/,
      'cli-version-hash: "deadbeef00000000"',
    );
    fs.writeFileSync(skillMdPath, corrupted, "utf-8");

    const updates = checkForUpdates(tmpDir);
    expect(updates).toHaveLength(1);
    expect(updates[0].domain).toBe("cli-knowledge-pack");
    expect(updates[0].changeReason).toBe("hash-changed");
    expect(updates[0].exists).toBe(true);
  });
});

// ── removeCliPacks ─────────────────────────────────────────────────

describe("removeCliPacks", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  it("removes all generated packs", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });
    const removed = removeCliPacks(tmpDir);

    expect(removed).toHaveLength(9);
    for (const key of Object.keys(CLI_PACK_DOMAINS)) {
      expect(
        fs.existsSync(path.join(tmpDir, key)),
        `${key} should be removed`,
      ).toBe(false);
    }
  });

  it("returns empty array when nothing to remove", () => {
    const removed = removeCliPacks(tmpDir);
    expect(removed).toHaveLength(0);
  });

  it("only removes cli-pack directories, not others", async () => {
    await generateCliPacks({ force: true, outputDir: tmpDir });

    // Create a non-cli-pack skill
    const otherSkill = path.join(tmpDir, "my-custom-skill");
    fs.mkdirSync(otherSkill, { recursive: true });
    fs.writeFileSync(
      path.join(otherSkill, "SKILL.md"),
      "---\nname: my-custom-skill\n---\n",
      "utf-8",
    );

    removeCliPacks(tmpDir);

    // Custom skill should still exist
    expect(fs.existsSync(otherSkill)).toBe(true);
  });
});
