/**
 * Unit tests: CLISkillLoader reads CLI pack extended fields
 * Tests that skill-loader correctly parses execution-mode, cli-domain,
 * cli-version-hash fields from SKILL.md frontmatter.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSkillMd, CLISkillLoader } from "../../../src/lib/skill-loader.js";

// ── parseSkillMd: CLI pack extended fields ─────────────────────────

describe("parseSkillMd — CLI pack extended fields", () => {
  it("parses execution-mode field as camelCase executionMode", () => {
    const content = `---
name: cli-knowledge-pack
execution-mode: direct
---`;
    const { data } = parseSkillMd(content);
    expect(data.executionMode).toBe("direct");
  });

  it("parses cli-domain field as cliDomain", () => {
    const content = `---
name: cli-knowledge-pack
cli-domain: knowledge
---`;
    const { data } = parseSkillMd(content);
    expect(data.cliDomain).toBe("knowledge");
  });

  it("parses cli-version-hash field as cliVersionHash (strips quotes)", () => {
    const content = `---
name: cli-knowledge-pack
cli-version-hash: "abc123def456"
---`;
    const { data } = parseSkillMd(content);
    expect(data.cliVersionHash).toBe("abc123def456");
  });

  it("parses all three CLI pack fields together", () => {
    const content = `---
name: cli-infra-pack
display-name: 基础设施技能包
description: 系统管理
version: 1.0.0
category: cli-direct
execution-mode: direct
cli-domain: infra
cli-version-hash: "deadbeef12345678"
tags: [db, config, infra]
user-invocable: true
handler: handler.js
---
# Infra Pack`;
    const { data } = parseSkillMd(content);
    expect(data.executionMode).toBe("direct");
    expect(data.cliDomain).toBe("infra");
    expect(data.cliVersionHash).toBe("deadbeef12345678");
    // Existing fields still parse correctly
    expect(data.name).toBe("cli-infra-pack");
    expect(data.category).toBe("cli-direct");
  });

  it("parses agent execution-mode", () => {
    const content = `---
name: cli-agent-mode-pack
execution-mode: agent
cli-domain: agent-mode
---`;
    const { data } = parseSkillMd(content);
    expect(data.executionMode).toBe("agent");
  });

  it("parses hybrid execution-mode", () => {
    const content = `---
name: cli-integration-pack
execution-mode: hybrid
---`;
    const { data } = parseSkillMd(content);
    expect(data.executionMode).toBe("hybrid");
  });

  it("parses llm-query execution-mode (value not converted, only keys are camelCased)", () => {
    const content = `---
name: cli-ai-query-pack
execution-mode: llm-query
---`;
    const { data } = parseSkillMd(content);
    // Only YAML keys are kebab→camelCase converted, not values
    expect(data.executionMode).toBe("llm-query");
  });

  it("returns null for missing executionMode", () => {
    const content = `---
name: regular-skill
category: development
---`;
    const { data } = parseSkillMd(content);
    expect(data.executionMode).toBeUndefined();
  });
});

// ── CLISkillLoader._loadFromDir: CLI pack fields ───────────────────

describe("CLISkillLoader._loadFromDir — CLI pack extended fields", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-skillloader-clipack-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createSkillPack(name, extraFrontmatter = "") {
    const skillDir = join(tempDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: ${name}
display-name: Test Pack
description: Test CLI pack
version: 1.0.0
category: cli-direct
execution-mode: direct
cli-domain: test
cli-version-hash: "abcdef1234567890"
tags: [test]
user-invocable: true
handler: handler.js
${extraFrontmatter}---
# Test Pack`,
      "utf-8",
    );
    writeFileSync(
      join(skillDir, "handler.js"),
      "module.exports = {};",
      "utf-8",
    );
  }

  it("loads executionMode field from SKILL.md", () => {
    createSkillPack("cli-test-pack");
    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");

    expect(skills).toHaveLength(1);
    expect(skills[0].executionMode).toBe("direct");
  });

  it("loads cliDomain field from SKILL.md", () => {
    createSkillPack("cli-test-pack");
    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");

    expect(skills[0].cliDomain).toBe("test");
  });

  it("loads cliVersionHash field from SKILL.md", () => {
    createSkillPack("cli-test-pack");
    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");

    expect(skills[0].cliVersionHash).toBe("abcdef1234567890");
  });

  it("sets executionMode=null for regular skills without the field", () => {
    const skillDir = join(tempDir, "regular-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: regular-skill
description: A normal skill
category: development
---
# Regular`,
      "utf-8",
    );

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");

    expect(skills[0].executionMode).toBeNull();
    expect(skills[0].cliDomain).toBeNull();
    expect(skills[0].cliVersionHash).toBeNull();
  });

  it("loads multiple CLI packs with correct field values", () => {
    createSkillPack("cli-pack-a");

    const bDir = join(tempDir, "cli-pack-b");
    mkdirSync(bDir, { recursive: true });
    writeFileSync(
      join(bDir, "SKILL.md"),
      `---
name: cli-pack-b
execution-mode: agent
cli-domain: agent
cli-version-hash: "1111111122222222"
category: cli-agent
---`,
      "utf-8",
    );

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");
    skills.sort((a, b) => a.id.localeCompare(b.id));

    expect(skills).toHaveLength(2);
    expect(skills[0].executionMode).toBe("direct");
    expect(skills[0].cliDomain).toBe("test");
    expect(skills[1].executionMode).toBe("agent");
    expect(skills[1].cliDomain).toBe("agent");
    expect(skills[1].cliVersionHash).toBe("1111111122222222");
  });

  it("CLI pack skills coexist with regular skills", () => {
    createSkillPack("cli-knowledge-pack");

    const regularDir = join(tempDir, "code-review");
    mkdirSync(regularDir, { recursive: true });
    writeFileSync(
      join(regularDir, "SKILL.md"),
      `---
name: code-review
category: development
description: Review code
---`,
      "utf-8",
    );

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");

    expect(skills).toHaveLength(2);
    const cliPack = skills.find((s) => s.id === "cli-knowledge-pack");
    const regular = skills.find((s) => s.id === "code-review");

    expect(cliPack.executionMode).toBe("direct");
    expect(cliPack.cliDomain).toBe("test");
    expect(regular.executionMode).toBeNull();
    expect(regular.cliDomain).toBeNull();
  });

  it("getAutoActivatedPersonas does not include CLI packs", () => {
    createSkillPack("cli-knowledge-pack");

    const loader = new CLISkillLoader();
    loader._cache = loader._loadFromDir(tempDir, "workspace");
    const personas = loader.getAutoActivatedPersonas();
    expect(personas).toHaveLength(0);
  });
});

// ── End-to-end loader test with generated pack directory ───────────

describe("CLISkillLoader with generated workspace CLI packs", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-skillloader-gen-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads all 9 CLI packs from workspace directory", async () => {
    // Generate packs into temp dir
    const { generateCliPacks } =
      await import("../../../src/lib/skill-packs/generator.js");
    await generateCliPacks({ force: true, outputDir: tempDir });

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");

    expect(skills).toHaveLength(9);

    const ids = skills.map((s) => s.id).sort();
    expect(ids).toContain("cli-knowledge-pack");
    expect(ids).toContain("cli-identity-pack");
    expect(ids).toContain("cli-infra-pack");
    expect(ids).toContain("cli-ai-query-pack");
    expect(ids).toContain("cli-agent-mode-pack");
    expect(ids).toContain("cli-web3-pack");
    expect(ids).toContain("cli-security-pack");
    expect(ids).toContain("cli-enterprise-pack");
    expect(ids).toContain("cli-integration-pack");
  });

  it("all CLI packs have executionMode set", async () => {
    const { generateCliPacks } =
      await import("../../../src/lib/skill-packs/generator.js");
    await generateCliPacks({ force: true, outputDir: tempDir });

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");
    // Values are stored as-is; only YAML keys are camelCased by parseSkillMd
    const validModes = new Set(["direct", "agent", "hybrid", "llm-query"]);

    for (const skill of skills) {
      expect(
        validModes,
        `${skill.id} has invalid mode: ${skill.executionMode}`,
      ).toContain(skill.executionMode);
    }
  });

  it("all CLI packs have cliDomain set", async () => {
    const { generateCliPacks } =
      await import("../../../src/lib/skill-packs/generator.js");
    await generateCliPacks({ force: true, outputDir: tempDir });

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");

    for (const skill of skills) {
      expect(skill.cliDomain, `${skill.id} missing cliDomain`).toBeTruthy();
    }
  });

  it("all CLI packs have cliVersionHash set", async () => {
    const { generateCliPacks } =
      await import("../../../src/lib/skill-packs/generator.js");
    await generateCliPacks({ force: true, outputDir: tempDir });

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");

    for (const skill of skills) {
      expect(
        skill.cliVersionHash,
        `${skill.id} missing cliVersionHash`,
      ).toBeTruthy();
      expect(skill.cliVersionHash).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  it("agent-mode-pack has category cli-agent", async () => {
    const { generateCliPacks } =
      await import("../../../src/lib/skill-packs/generator.js");
    await generateCliPacks({ force: true, outputDir: tempDir });

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");
    const agentPack = skills.find((s) => s.id === "cli-agent-mode-pack");

    expect(agentPack).toBeDefined();
    expect(agentPack.category).toBe("cli-agent");
    expect(agentPack.executionMode).toBe("agent");
  });

  it("direct packs have category cli-direct", async () => {
    const { generateCliPacks } =
      await import("../../../src/lib/skill-packs/generator.js");
    await generateCliPacks({ force: true, outputDir: tempDir });

    const loader = new CLISkillLoader();
    const skills = loader._loadFromDir(tempDir, "workspace");
    const directPacks = skills.filter((s) => s.executionMode === "direct");

    expect(directPacks.length).toBeGreaterThan(0);
    for (const p of directPacks) {
      expect(p.category).toBe("cli-direct");
    }
  });
});
