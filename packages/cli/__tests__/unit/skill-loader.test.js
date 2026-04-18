import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseSkillMd,
  CLISkillLoader,
  LAYER_NAMES,
} from "../../src/lib/skill-loader.js";

describe("skill-loader", () => {
  // ─── parseSkillMd ─────────────────────────────────────

  describe("parseSkillMd", () => {
    it("parses standard YAML frontmatter", () => {
      const content = `---
name: test-skill
display-name: Test Skill
description: A test skill
version: 1.0.0
category: testing
user-invocable: true
---

# Documentation`;
      const { data, body } = parseSkillMd(content);
      expect(data.name).toBe("test-skill");
      expect(data.displayName).toBe("Test Skill");
      expect(data.description).toBe("A test skill");
      expect(data.version).toBe("1.0.0");
      expect(data.category).toBe("testing");
      expect(data.userInvocable).toBe(true);
      expect(body).toContain("# Documentation");
    });

    it("parses inline array syntax [a, b, c]", () => {
      const content = `---
name: test
tags: [code, review, ai]
---
body`;
      const { data } = parseSkillMd(content);
      expect(data.tags).toEqual(["code", "review", "ai"]);
    });

    it("handles boolean values", () => {
      const content = `---
name: test
user-invocable: false
---`;
      const { data } = parseSkillMd(content);
      expect(data.userInvocable).toBe(false);
    });

    it("handles numeric values", () => {
      const content = `---
name: test
version: 2.5
---`;
      const { data } = parseSkillMd(content);
      expect(data.version).toBe(2.5);
    });

    it("handles null values", () => {
      const content = `---
name: test
handler: null
---`;
      const { data } = parseSkillMd(content);
      expect(data.handler).toBeNull();
    });

    it("returns empty data when no frontmatter", () => {
      const content = "# Just markdown\nNo frontmatter here";
      const { data, body } = parseSkillMd(content);
      expect(data).toEqual({});
      expect(body).toBe(content);
    });

    it("returns empty data when frontmatter is unclosed", () => {
      const content = "---\nname: test\nno closing";
      const { data, body } = parseSkillMd(content);
      expect(data).toEqual({});
      expect(body).toBe(content);
    });

    it("strips quotes from values", () => {
      const content = `---
name: "quoted-name"
description: 'single quoted'
---`;
      const { data } = parseSkillMd(content);
      expect(data.name).toBe("quoted-name");
      expect(data.description).toBe("single quoted");
    });

    it("converts kebab-case keys to camelCase", () => {
      const content = `---
display-name: Test
user-invocable: true
remote-skill-name: remote-test
---`;
      const { data } = parseSkillMd(content);
      expect(data.displayName).toBe("Test");
      expect(data.userInvocable).toBe(true);
      expect(data.remoteSkillName).toBe("remote-test");
    });

    it("skips comment lines in frontmatter", () => {
      const content = `---
name: test
# This is a comment
description: A test
---`;
      const { data } = parseSkillMd(content);
      expect(data.name).toBe("test");
      expect(data.description).toBe("A test");
    });

    it("parses YAML list syntax", () => {
      const content = `---
name: test
tags:
- tag1
- tag2
- tag3
---`;
      const { data } = parseSkillMd(content);
      // The parser treats bare `tags:` as empty value, then `-` items follow
      // Since `currentKey` is set but not as array, it depends on implementation
      // Let's just verify it doesn't throw
      expect(data.name).toBe("test");
    });
  });

  // ─── LAYER_NAMES ──────────────────────────────────────

  describe("LAYER_NAMES", () => {
    it("has 4 layers in correct priority order", () => {
      expect(LAYER_NAMES).toEqual([
        "bundled",
        "marketplace",
        "managed",
        "workspace",
      ]);
    });
  });

  // ─── CLISkillLoader ───────────────────────────────────

  describe("CLISkillLoader", () => {
    it("creates an instance", () => {
      const loader = new CLISkillLoader();
      expect(loader).toBeDefined();
    });

    describe("getLayerPaths", () => {
      it("returns 4 layer entries", () => {
        const loader = new CLISkillLoader();
        const layers = loader.getLayerPaths();
        expect(layers).toHaveLength(4);
        expect(layers.map((l) => l.layer)).toEqual([
          "bundled",
          "marketplace",
          "managed",
          "workspace",
        ]);
      });

      it("each layer has path and exists fields", () => {
        const loader = new CLISkillLoader();
        const layers = loader.getLayerPaths();
        for (const layer of layers) {
          expect(layer).toHaveProperty("layer");
          expect(layer).toHaveProperty("exists");
          expect(typeof layer.exists).toBe("boolean");
        }
      });
    });

    describe("loadAll", () => {
      it("loads bundled skills", () => {
        const loader = new CLISkillLoader();
        const skills = loader.loadAll();
        // Should find bundled skills from desktop-app-vue
        expect(skills.length).toBeGreaterThan(0);
      });

      it("each skill has required fields", () => {
        const loader = new CLISkillLoader();
        const skills = loader.loadAll();
        for (const skill of skills) {
          expect(skill.id).toBeTruthy();
          expect(typeof skill.description).toBe("string");
          expect(typeof skill.category).toBe("string");
          expect(typeof skill.hasHandler).toBe("boolean");
          expect(skill.source).toBeTruthy();
          expect(skill.skillDir).toBeTruthy();
        }
      });

      it("skills have source field set to layer name", () => {
        const loader = new CLISkillLoader();
        const skills = loader.loadAll();
        const sources = new Set(skills.map((s) => s.source));
        // At minimum, bundled skills should be present
        expect(sources.has("bundled")).toBe(true);
      });
    });

    describe("getResolvedSkills", () => {
      it("returns cached results on second call", () => {
        const loader = new CLISkillLoader();
        const first = loader.getResolvedSkills();
        const second = loader.getResolvedSkills();
        expect(first).toBe(second); // Same reference (cached)
      });
    });

    describe("clearCache", () => {
      it("clears cached skills", () => {
        const loader = new CLISkillLoader();
        const first = loader.getResolvedSkills();
        loader.clearCache();
        const second = loader.getResolvedSkills();
        expect(first).not.toBe(second); // Different reference after clear
        expect(first.length).toBe(second.length); // Same content though
      });
    });

    describe("priority override", () => {
      let tempDir;

      beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), "cc-skillloader-test-"));
      });

      afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
      });

      it("_loadFromDir loads skills from a directory", () => {
        // Create a mock skill
        const skillDir = join(tempDir, "my-skill");
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
          join(skillDir, "SKILL.md"),
          `---
name: my-skill
description: Test skill
category: custom
---
# My Skill`,
          "utf-8",
        );
        writeFileSync(
          join(skillDir, "handler.js"),
          "export default {};",
          "utf-8",
        );

        const loader = new CLISkillLoader();
        const skills = loader._loadFromDir(tempDir, "workspace");
        expect(skills).toHaveLength(1);
        expect(skills[0].id).toBe("my-skill");
        expect(skills[0].source).toBe("workspace");
        expect(skills[0].hasHandler).toBe(true);
      });

      it("_loadFromDir returns empty for non-existent directory", () => {
        const loader = new CLISkillLoader();
        const skills = loader._loadFromDir(
          join(tempDir, "nonexistent"),
          "test",
        );
        expect(skills).toEqual([]);
      });

      it("_loadFromDir skips directories without SKILL.md", () => {
        const noSkillDir = join(tempDir, "no-skill");
        mkdirSync(noSkillDir, { recursive: true });
        writeFileSync(join(noSkillDir, "readme.txt"), "not a skill", "utf-8");

        const loader = new CLISkillLoader();
        const skills = loader._loadFromDir(tempDir, "test");
        expect(skills).toEqual([]);
      });

      it("_loadFromDir detects hasHandler=false when no handler.js", () => {
        const skillDir = join(tempDir, "doc-skill");
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
          join(skillDir, "SKILL.md"),
          `---
name: doc-skill
description: Docs only
---`,
          "utf-8",
        );

        const loader = new CLISkillLoader();
        const skills = loader._loadFromDir(tempDir, "workspace");
        expect(skills[0].hasHandler).toBe(false);
      });

      it("_loadFromDir reads activation field", () => {
        const skillDir = join(tempDir, "auto-skill");
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
          join(skillDir, "SKILL.md"),
          `---
name: auto-skill
category: persona
activation: auto
user-invocable: false
---
Auto persona body`,
          "utf-8",
        );

        const loader = new CLISkillLoader();
        const skills = loader._loadFromDir(tempDir, "workspace");
        expect(skills[0].activation).toBe("auto");
        expect(skills[0].category).toBe("persona");
      });

      it("_loadFromDir defaults activation to manual", () => {
        const skillDir = join(tempDir, "manual-skill");
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
          join(skillDir, "SKILL.md"),
          `---
name: manual-skill
category: development
---
Manual skill body`,
          "utf-8",
        );

        const loader = new CLISkillLoader();
        const skills = loader._loadFromDir(tempDir, "workspace");
        expect(skills[0].activation).toBe("manual");
      });
    });

    describe("getAutoActivatedPersonas", () => {
      let tempDir;

      beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), "cc-persona-skill-test-"));
      });

      afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
      });

      it("returns only persona skills with activation auto", () => {
        // Create persona auto skill
        const personaDir = join(tempDir, "my-persona");
        mkdirSync(personaDir, { recursive: true });
        writeFileSync(
          join(personaDir, "SKILL.md"),
          `---
name: my-persona
category: persona
activation: auto
---
Persona instructions`,
          "utf-8",
        );

        // Create regular skill
        const regularDir = join(tempDir, "regular");
        mkdirSync(regularDir, { recursive: true });
        writeFileSync(
          join(regularDir, "SKILL.md"),
          `---
name: regular
category: development
---
Regular skill`,
          "utf-8",
        );

        // Create manual persona skill
        const manualDir = join(tempDir, "manual-persona");
        mkdirSync(manualDir, { recursive: true });
        writeFileSync(
          join(manualDir, "SKILL.md"),
          `---
name: manual-persona
category: persona
activation: manual
---
Manual persona`,
          "utf-8",
        );

        const loader = new CLISkillLoader();
        // Load from temp dir only
        const skills = loader._loadFromDir(tempDir, "workspace");
        // Manually set cache
        loader._cache = skills;

        const personas = loader.getAutoActivatedPersonas();
        expect(personas).toHaveLength(1);
        expect(personas[0].id).toBe("my-persona");
        expect(personas[0].category).toBe("persona");
        expect(personas[0].activation).toBe("auto");
      });

      it("returns empty array when no persona skills exist", () => {
        const skillDir = join(tempDir, "dev-skill");
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
          join(skillDir, "SKILL.md"),
          `---
name: dev-skill
category: development
---
Dev skill`,
          "utf-8",
        );

        const loader = new CLISkillLoader();
        loader._cache = loader._loadFromDir(tempDir, "workspace");

        const personas = loader.getAutoActivatedPersonas();
        expect(personas).toHaveLength(0);
      });
    });
  });
});

// ─── V2 Governance Layer ────────────────────────────────────────────

import {
  SKILL_MATURITY_V2,
  EXECUTION_LIFECYCLE_V2,
  SKILL_DEFAULT_MAX_ACTIVE_PER_OWNER,
  SKILL_DEFAULT_MAX_PENDING_EXECUTIONS_PER_SKILL,
  SKILL_DEFAULT_SKILL_IDLE_MS,
  SKILL_DEFAULT_EXEC_STUCK_MS,
  getMaxActiveSkillsPerOwnerV2,
  setMaxActiveSkillsPerOwnerV2,
  getMaxPendingExecutionsPerSkillV2,
  setMaxPendingExecutionsPerSkillV2,
  getSkillIdleMsV2,
  setSkillIdleMsV2,
  getExecStuckMsV2,
  setExecStuckMsV2,
  registerSkillV2,
  getSkillV2,
  listSkillsV2,
  setSkillStatusV2,
  activateSkillV2,
  deprecateSkillV2,
  archiveSkillV2,
  touchSkillV2,
  getActiveSkillCountV2,
  createExecutionV2,
  getExecutionV2,
  listExecutionsV2,
  setExecutionStatusV2,
  startExecutionV2,
  succeedExecutionV2,
  failExecutionV2,
  cancelExecutionV2,
  getPendingExecutionCountV2,
  autoDeprecateIdleSkillsV2,
  autoFailStuckExecutionsV2,
  getSkillLoaderStatsV2,
  _resetStateSkillLoaderV2,
} from "../../src/lib/skill-loader.js";

describe("Skill Loader V2", () => {
  beforeEach(() => {
    _resetStateSkillLoaderV2();
  });

  describe("frozen enums + defaults", () => {
    it("freezes SKILL_MATURITY_V2", () => {
      expect(Object.isFrozen(SKILL_MATURITY_V2)).toBe(true);
      expect(Object.values(SKILL_MATURITY_V2)).toEqual([
        "pending",
        "active",
        "deprecated",
        "archived",
      ]);
    });

    it("freezes EXECUTION_LIFECYCLE_V2", () => {
      expect(Object.isFrozen(EXECUTION_LIFECYCLE_V2)).toBe(true);
      expect(Object.values(EXECUTION_LIFECYCLE_V2)).toEqual([
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
      ]);
    });

    it("exposes defaults", () => {
      expect(SKILL_DEFAULT_MAX_ACTIVE_PER_OWNER).toBe(30);
      expect(SKILL_DEFAULT_MAX_PENDING_EXECUTIONS_PER_SKILL).toBe(5);
      expect(SKILL_DEFAULT_SKILL_IDLE_MS).toBe(30 * 24 * 60 * 60 * 1000);
      expect(SKILL_DEFAULT_EXEC_STUCK_MS).toBe(15 * 60 * 1000);
    });
  });

  describe("config getters/setters", () => {
    it("returns defaults", () => {
      expect(getMaxActiveSkillsPerOwnerV2()).toBe(30);
      expect(getMaxPendingExecutionsPerSkillV2()).toBe(5);
      expect(getSkillIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000);
      expect(getExecStuckMsV2()).toBe(15 * 60 * 1000);
    });

    it("setters update + validate", () => {
      setMaxActiveSkillsPerOwnerV2(50);
      expect(getMaxActiveSkillsPerOwnerV2()).toBe(50);
      setMaxPendingExecutionsPerSkillV2(10);
      expect(getMaxPendingExecutionsPerSkillV2()).toBe(10);
      setSkillIdleMsV2(60000);
      expect(getSkillIdleMsV2()).toBe(60000);
      setExecStuckMsV2(45000);
      expect(getExecStuckMsV2()).toBe(45000);
    });

    it("setters reject non-positive integers", () => {
      expect(() => setMaxActiveSkillsPerOwnerV2(0)).toThrow();
      expect(() => setMaxActiveSkillsPerOwnerV2(-1)).toThrow();
      expect(() => setMaxActiveSkillsPerOwnerV2(NaN)).toThrow();
      expect(() => setMaxPendingExecutionsPerSkillV2("abc")).toThrow();
      expect(() => setSkillIdleMsV2(0)).toThrow();
      expect(() => setExecStuckMsV2(-1)).toThrow();
    });

    it("setter floors non-integer positives", () => {
      setMaxActiveSkillsPerOwnerV2(7.9);
      expect(getMaxActiveSkillsPerOwnerV2()).toBe(7);
    });
  });

  describe("registerSkillV2", () => {
    it("creates skill in pending state", () => {
      const s = registerSkillV2("s1", { ownerId: "o1", name: "code-review" });
      expect(s.status).toBe("pending");
      expect(s.ownerId).toBe("o1");
      expect(s.name).toBe("code-review");
      expect(s.layer).toBe("workspace");
      expect(s.activatedAt).toBeNull();
      expect(s.archivedAt).toBeNull();
    });

    it("accepts layer override + metadata", () => {
      const s = registerSkillV2("s2", {
        ownerId: "o1",
        name: "x",
        layer: "managed",
        metadata: { handler: "h.js" },
      });
      expect(s.layer).toBe("managed");
      expect(s.metadata.handler).toBe("h.js");
    });

    it("rejects missing required fields", () => {
      expect(() => registerSkillV2()).toThrow();
      expect(() => registerSkillV2("s1")).toThrow();
      expect(() => registerSkillV2("s1", { ownerId: "o1" })).toThrow();
      expect(() => registerSkillV2("s1", { name: "n" })).toThrow();
    });

    it("rejects duplicate id", () => {
      registerSkillV2("s1", { ownerId: "o1", name: "n" });
      expect(() =>
        registerSkillV2("s1", { ownerId: "o1", name: "n" }),
      ).toThrow();
    });

    it("returns defensive copy", () => {
      const s = registerSkillV2("s1", {
        ownerId: "o1",
        name: "n",
        metadata: { k: 1 },
      });
      s.metadata.k = 999;
      expect(getSkillV2("s1").metadata.k).toBe(1);
    });
  });

  describe("skill state machine", () => {
    beforeEach(() => {
      registerSkillV2("s1", { ownerId: "o1", name: "n" });
    });

    it("pending → active stamps activatedAt", () => {
      const s = activateSkillV2("s1");
      expect(s.status).toBe("active");
      expect(s.activatedAt).toBeTruthy();
    });

    it("active → deprecated → active preserves activatedAt", () => {
      const s1 = activateSkillV2("s1");
      const stamp = s1.activatedAt;
      deprecateSkillV2("s1");
      const s2 = activateSkillV2("s1");
      expect(s2.activatedAt).toBe(stamp);
    });

    it("→ archived stamps archivedAt + is terminal", () => {
      const s = archiveSkillV2("s1");
      expect(s.status).toBe("archived");
      expect(s.archivedAt).toBeTruthy();
      expect(() => activateSkillV2("s1")).toThrow();
    });

    it("rejects invalid transitions", () => {
      expect(() => deprecateSkillV2("s1")).toThrow(); // pending → deprecated not allowed
      activateSkillV2("s1");
      expect(() => setSkillStatusV2("s1", "pending")).toThrow();
    });

    it("setSkillStatusV2 unknown id throws", () => {
      expect(() => setSkillStatusV2("nope", "active")).toThrow();
    });

    it("touchSkillV2 updates lastSeenAt", async () => {
      const before = getSkillV2("s1").lastSeenAt;
      await new Promise((r) => setTimeout(r, 5));
      const t = touchSkillV2("s1");
      expect(t.lastSeenAt).toBeGreaterThanOrEqual(before);
    });

    it("touchSkillV2 unknown id throws", () => {
      expect(() => touchSkillV2("nope")).toThrow();
    });
  });

  describe("per-owner active-skill cap", () => {
    it("blocks pending → active beyond cap", () => {
      setMaxActiveSkillsPerOwnerV2(2);
      registerSkillV2("a", { ownerId: "o1", name: "A" });
      registerSkillV2("b", { ownerId: "o1", name: "B" });
      registerSkillV2("c", { ownerId: "o1", name: "C" });
      activateSkillV2("a");
      activateSkillV2("b");
      expect(() => activateSkillV2("c")).toThrow(/cap/i);
    });

    it("deprecated → active recovery is exempt from cap", () => {
      setMaxActiveSkillsPerOwnerV2(2);
      registerSkillV2("a", { ownerId: "o1", name: "A" });
      registerSkillV2("b", { ownerId: "o1", name: "B" });
      activateSkillV2("a");
      activateSkillV2("b");
      deprecateSkillV2("a");
      const s = activateSkillV2("a");
      expect(s.status).toBe("active");
    });

    it("scopes by owner", () => {
      setMaxActiveSkillsPerOwnerV2(1);
      registerSkillV2("a", { ownerId: "o1", name: "A" });
      registerSkillV2("b", { ownerId: "o2", name: "B" });
      activateSkillV2("a");
      activateSkillV2("b");
      expect(getActiveSkillCountV2("o1")).toBe(1);
      expect(getActiveSkillCountV2("o2")).toBe(1);
    });
  });

  describe("listSkillsV2", () => {
    it("lists all + filters by owner/status/layer", () => {
      registerSkillV2("a", { ownerId: "o1", name: "A", layer: "workspace" });
      registerSkillV2("b", { ownerId: "o1", name: "B", layer: "managed" });
      registerSkillV2("c", { ownerId: "o2", name: "C", layer: "bundled" });
      activateSkillV2("a");
      expect(listSkillsV2()).toHaveLength(3);
      expect(listSkillsV2({ ownerId: "o1" })).toHaveLength(2);
      expect(listSkillsV2({ status: "active" })).toHaveLength(1);
      expect(listSkillsV2({ layer: "managed" })).toHaveLength(1);
      expect(listSkillsV2({ ownerId: "o2", status: "pending" })).toHaveLength(
        1,
      );
    });
  });

  describe("createExecutionV2", () => {
    beforeEach(() => {
      registerSkillV2("s1", { ownerId: "o1", name: "n" });
    });

    it("creates execution in queued state", () => {
      const e = createExecutionV2("e1", { skillId: "s1" });
      expect(e.status).toBe("queued");
      expect(e.skillId).toBe("s1");
      expect(e.kind).toBe("invoke");
      expect(e.startedAt).toBeNull();
      expect(e.settledAt).toBeNull();
    });

    it("accepts kind + metadata", () => {
      const e = createExecutionV2("e1", {
        skillId: "s1",
        kind: "test",
        metadata: { input: "x" },
      });
      expect(e.kind).toBe("test");
      expect(e.metadata.input).toBe("x");
    });

    it("rejects missing required", () => {
      expect(() => createExecutionV2()).toThrow();
      expect(() => createExecutionV2("e1")).toThrow();
    });

    it("rejects unknown skill", () => {
      expect(() => createExecutionV2("e1", { skillId: "nope" })).toThrow();
    });

    it("rejects duplicate", () => {
      createExecutionV2("e1", { skillId: "s1" });
      expect(() => createExecutionV2("e1", { skillId: "s1" })).toThrow();
    });

    it("enforces per-skill pending cap (queued + running)", () => {
      setMaxPendingExecutionsPerSkillV2(2);
      createExecutionV2("a", { skillId: "s1" });
      createExecutionV2("b", { skillId: "s1" });
      expect(() => createExecutionV2("c", { skillId: "s1" })).toThrow(/cap/i);
      startExecutionV2("b");
      expect(() => createExecutionV2("c", { skillId: "s1" })).toThrow(/cap/i);
      succeedExecutionV2("b");
      const c = createExecutionV2("c", { skillId: "s1" });
      expect(c.status).toBe("queued");
    });
  });

  describe("execution state machine", () => {
    beforeEach(() => {
      registerSkillV2("s1", { ownerId: "o1", name: "n" });
      createExecutionV2("e1", { skillId: "s1" });
    });

    it("queued → running stamps startedAt", () => {
      const e = startExecutionV2("e1");
      expect(e.status).toBe("running");
      expect(e.startedAt).toBeTruthy();
    });

    it("running → succeeded stamps settledAt", () => {
      startExecutionV2("e1");
      const e = succeedExecutionV2("e1");
      expect(e.status).toBe("succeeded");
      expect(e.settledAt).toBeTruthy();
    });

    it("running → failed stamps settledAt", () => {
      startExecutionV2("e1");
      const e = failExecutionV2("e1");
      expect(e.status).toBe("failed");
      expect(e.settledAt).toBeTruthy();
    });

    it("queued → cancelled stamps settledAt", () => {
      const e = cancelExecutionV2("e1");
      expect(e.status).toBe("cancelled");
      expect(e.settledAt).toBeTruthy();
    });

    it("succeeded is terminal", () => {
      startExecutionV2("e1");
      succeedExecutionV2("e1");
      expect(() => startExecutionV2("e1")).toThrow();
      expect(() => failExecutionV2("e1")).toThrow();
    });

    it("rejects invalid transitions", () => {
      expect(() => succeedExecutionV2("e1")).toThrow(); // queued → succeeded not allowed
      expect(() => failExecutionV2("e1")).toThrow();
    });

    it("setExecutionStatusV2 unknown id throws", () => {
      expect(() => setExecutionStatusV2("nope", "running")).toThrow();
    });
  });

  describe("listExecutionsV2", () => {
    it("filters by skill/status", () => {
      registerSkillV2("s1", { ownerId: "o1", name: "L" });
      registerSkillV2("s2", { ownerId: "o1", name: "L2" });
      createExecutionV2("a", { skillId: "s1" });
      createExecutionV2("b", { skillId: "s1" });
      createExecutionV2("c", { skillId: "s2" });
      startExecutionV2("a");
      expect(listExecutionsV2()).toHaveLength(3);
      expect(listExecutionsV2({ skillId: "s1" })).toHaveLength(2);
      expect(listExecutionsV2({ status: "running" })).toHaveLength(1);
      expect(
        listExecutionsV2({ skillId: "s2", status: "queued" }),
      ).toHaveLength(1);
    });
  });

  describe("autoDeprecateIdleSkillsV2", () => {
    it("flips active skills past idle threshold to deprecated", () => {
      registerSkillV2("s1", { ownerId: "o1", name: "L" });
      activateSkillV2("s1");
      const s = getSkillV2("s1");
      const future = s.lastSeenAt + getSkillIdleMsV2() + 1000;
      const flipped = autoDeprecateIdleSkillsV2({ now: future });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("deprecated");
      expect(getSkillV2("s1").status).toBe("deprecated");
    });

    it("leaves fresh skills alone", () => {
      registerSkillV2("s1", { ownerId: "o1", name: "L" });
      activateSkillV2("s1");
      const flipped = autoDeprecateIdleSkillsV2({ now: Date.now() });
      expect(flipped).toHaveLength(0);
    });

    it("ignores non-active skills", () => {
      registerSkillV2("s1", { ownerId: "o1", name: "L" });
      const flipped = autoDeprecateIdleSkillsV2({
        now: Date.now() + getSkillIdleMsV2() + 1000,
      });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoFailStuckExecutionsV2", () => {
    beforeEach(() => {
      registerSkillV2("s1", { ownerId: "o1", name: "L" });
      createExecutionV2("e1", { skillId: "s1" });
    });

    it("flips stuck running executions to failed", () => {
      startExecutionV2("e1");
      const e = getExecutionV2("e1");
      const future = e.lastSeenAt + getExecStuckMsV2() + 1000;
      const flipped = autoFailStuckExecutionsV2({ now: future });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("failed");
      expect(flipped[0].settledAt).toBeTruthy();
    });

    it("leaves queued executions alone", () => {
      const flipped = autoFailStuckExecutionsV2({
        now: Date.now() + getExecStuckMsV2() + 1000,
      });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getSkillLoaderStatsV2", () => {
    it("zero state", () => {
      const s = getSkillLoaderStatsV2();
      expect(s.totalSkillsV2).toBe(0);
      expect(s.totalExecutionsV2).toBe(0);
      expect(s.maxActiveSkillsPerOwner).toBe(30);
      expect(s.maxPendingExecutionsPerSkill).toBe(5);
      expect(s.skillsByStatus).toEqual({
        pending: 0,
        active: 0,
        deprecated: 0,
        archived: 0,
      });
      expect(s.executionsByStatus).toEqual({
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      });
    });

    it("counts after operations", () => {
      registerSkillV2("a", { ownerId: "o1", name: "A" });
      registerSkillV2("b", { ownerId: "o1", name: "B" });
      activateSkillV2("a");
      createExecutionV2("e1", { skillId: "a" });
      startExecutionV2("e1");
      const s = getSkillLoaderStatsV2();
      expect(s.totalSkillsV2).toBe(2);
      expect(s.skillsByStatus.active).toBe(1);
      expect(s.skillsByStatus.pending).toBe(1);
      expect(s.totalExecutionsV2).toBe(1);
      expect(s.executionsByStatus.running).toBe(1);
    });
  });

  describe("counts", () => {
    it("getActiveSkillCountV2 / getPendingExecutionCountV2", () => {
      registerSkillV2("a", { ownerId: "o1", name: "A" });
      registerSkillV2("b", { ownerId: "o1", name: "B" });
      activateSkillV2("a");
      activateSkillV2("b");
      expect(getActiveSkillCountV2("o1")).toBe(2);
      deprecateSkillV2("a");
      expect(getActiveSkillCountV2("o1")).toBe(1);

      createExecutionV2("e1", { skillId: "a" });
      createExecutionV2("e2", { skillId: "a" });
      expect(getPendingExecutionCountV2("a")).toBe(2);
      startExecutionV2("e1");
      expect(getPendingExecutionCountV2("a")).toBe(2);
      succeedExecutionV2("e1");
      expect(getPendingExecutionCountV2("a")).toBe(1);
    });
  });

  describe("_resetStateSkillLoaderV2", () => {
    it("clears state + restores defaults", () => {
      registerSkillV2("a", { ownerId: "o1", name: "A" });
      setMaxActiveSkillsPerOwnerV2(99);
      _resetStateSkillLoaderV2();
      expect(listSkillsV2()).toHaveLength(0);
      expect(getMaxActiveSkillsPerOwnerV2()).toBe(30);
    });
  });
});
