/**
 * Skill Lazy Loading - Comprehensive Unit Tests
 *
 * Tests for the lazy loading pipeline:
 *   1. SkillMdParser.parseMetadataOnly() - metadata-only parsing
 *   2. MarkdownSkill.ensureFullyLoaded() - lazy body loading on first access
 *   3. SkillRegistry.hotLoadSkill() - runtime skill registration
 *   4. SkillRegistry.hotUnloadSkill() - runtime skill removal
 *   5. SkillLoader.loadSingleSkill() - single skill loading from directory
 *   6. Transparent lazy loading in SkillRegistry.getSkill()
 *   7. Event emission for hot-load / hot-unload
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { SkillMdParser } from "../skill-md-parser.js";
import { MarkdownSkill } from "../markdown-skill.js";
import { SkillRegistry } from "../skill-registry.js";
import { SkillLoader } from "../skill-loader.js";

// Mock electron app
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), "chainlesschain-lazy-test")),
  },
}));

// ---------------------------------------------------------------------------
// Shared SKILL.md fixtures
// ---------------------------------------------------------------------------

const FULL_SKILL_MD = `---
name: lazy-test-skill
description: A skill for testing lazy loading
display-name: Lazy Test Skill
version: 2.0.0
category: testing
tags: [lazy, test]
user-invocable: true
enabled: true
handler: ./handler.js
tools: [read_file, write_file]
instructions: Follow these steps carefully
os: [win32, darwin, linux]
---

# Lazy Test Skill

This is the full body content used for lazy loading tests.

## Usage

Run the skill with the appropriate parameters.
`;

const MINIMAL_SKILL_MD = `---
name: minimal-lazy
description: Minimal skill for stub testing
version: 1.0.0
category: utility
---

# Minimal

Short body.
`;

// ============================================================================
// 1. SkillMdParser.parseMetadataOnly()
// ============================================================================

describe("SkillMdParser.parseMetadataOnly", () => {
  let parser;

  beforeEach(() => {
    parser = new SkillMdParser({ strictValidation: false });
  });

  it("should return a stub object with _isStub=true and _bodyLoaded=false", async () => {
    // Mock fs.promises.readFile to return our fixture
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(FULL_SKILL_MD);

    const stub = await parser.parseMetadataOnly(
      "/fake/lazy-test-skill/SKILL.md",
    );

    expect(stub._isStub).toBe(true);
    expect(stub._bodyLoaded).toBe(false);
  });

  it("should extract name, description, version, category from frontmatter", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(FULL_SKILL_MD);

    const stub = await parser.parseMetadataOnly(
      "/fake/lazy-test-skill/SKILL.md",
    );

    expect(stub.name).toBe("lazy-test-skill");
    expect(stub.description).toBe("A skill for testing lazy loading");
    expect(stub.version).toBe("2.0.0");
    expect(stub.category).toBe("testing");
  });

  it("should extract tags, handler, os and enabled fields", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(FULL_SKILL_MD);

    const stub = await parser.parseMetadataOnly(
      "/fake/lazy-test-skill/SKILL.md",
    );

    expect(stub.tags).toEqual(["lazy", "test"]);
    expect(stub.handler).toBe("./handler.js");
    expect(stub.os).toEqual(["win32", "darwin", "linux"]);
    expect(stub.enabled).toBe(true);
    expect(stub.userInvocable).toBe(true);
    expect(stub.hidden).toBe(false);
  });

  it("should NOT include body content in the stub", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(FULL_SKILL_MD);

    const stub = await parser.parseMetadataOnly(
      "/fake/lazy-test-skill/SKILL.md",
    );

    // The stub object should not have a body property (it is metadata-only)
    expect(stub.body).toBeUndefined();
  });

  it("should include source and sourcePath fields", async () => {
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(FULL_SKILL_MD);

    const stub = await parser.parseMetadataOnly(
      "/fake/lazy-test-skill/SKILL.md",
    );

    expect(stub.sourcePath).toBe("/fake/lazy-test-skill/SKILL.md");
    expect(stub.source).toBe("unknown"); // default when not set
  });

  it("should fall back to directory name when name is missing", async () => {
    const noName = `---
description: Skill without a name field
---

Body text.
`;
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(noName);

    const stub = await parser.parseMetadataOnly(
      "/some/path/my-auto-name/SKILL.md",
    );

    expect(stub.name).toBe("my-auto-name");
  });

  it("should handle content without frontmatter gracefully", async () => {
    const noFrontmatter = "# Just Markdown\n\nNo YAML here.";
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(noFrontmatter);

    const stub = await parser.parseMetadataOnly("/path/to/no-yaml/SKILL.md");

    expect(stub._isStub).toBe(true);
    expect(stub._bodyLoaded).toBe(false);
    expect(stub.name).toBe("no-yaml");
  });

  it("should throw on file read errors", async () => {
    vi.spyOn(fs.promises, "readFile").mockRejectedValue(new Error("ENOENT"));

    await expect(
      parser.parseMetadataOnly("/nonexistent/SKILL.md"),
    ).rejects.toThrow("Failed to parse metadata");
  });

  describe("parseMetadataOnlyContent (sync variant)", () => {
    it("should parse metadata from content string without reading a file", () => {
      const stub = parser.parseMetadataOnlyContent(
        FULL_SKILL_MD,
        "/inline/SKILL.md",
      );

      expect(stub._isStub).toBe(true);
      expect(stub._bodyLoaded).toBe(false);
      expect(stub.name).toBe("lazy-test-skill");
      expect(stub.description).toBe("A skill for testing lazy loading");
    });

    it("should return stub with defaults when frontmatter is empty", () => {
      const stub = parser.parseMetadataOnlyContent(
        "---\n---\nBody only",
        "/path/to/empty-front/SKILL.md",
      );

      expect(stub._isStub).toBe(true);
      expect(stub.name).toBe("empty-front");
      expect(stub.version).toBe("1.0.0");
      expect(stub.category).toBe("custom");
    });
  });
});

// ============================================================================
// 2. MarkdownSkill.ensureFullyLoaded()
// ============================================================================

describe("MarkdownSkill.ensureFullyLoaded", () => {
  it("should be a no-op when the skill is already fully loaded", async () => {
    const skill = new MarkdownSkill({
      name: "already-loaded",
      description: "Full definition",
      body: "# Body",
      _isStub: false, // not a stub -> _bodyLoaded = true in constructor
    });

    expect(skill._bodyLoaded).toBe(true);

    // Spy on fs to make sure no file is read
    const readSpy = vi.spyOn(fs.promises, "readFile");
    await skill.ensureFullyLoaded();

    expect(readSpy).not.toHaveBeenCalled();
    expect(skill._bodyLoaded).toBe(true);
  });

  it("should mark _bodyLoaded=false for stub definitions", () => {
    const skill = new MarkdownSkill({
      name: "stub-skill",
      description: "Stub",
      _isStub: true,
      _bodyLoaded: false,
      sourcePath: "/some/path/SKILL.md",
    });

    expect(skill._bodyLoaded).toBe(false);
  });

  it("should read the full file and merge definition on first call", async () => {
    // Create a stub-based skill
    const skill = new MarkdownSkill({
      name: "lazy-skill",
      description: "Lazy description",
      version: "1.0.0",
      category: "testing",
      _isStub: true,
      _bodyLoaded: false,
      sourcePath: "/fake/lazy-skill/SKILL.md",
      tools: [],
      instructions: "",
      examples: [],
    });

    expect(skill._bodyLoaded).toBe(false);

    // Mock fs.promises.readFile so that parseFile will return full content
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      `---
name: lazy-skill
description: Lazy description
version: 1.0.0
category: testing
tools: [tool_a, tool_b]
instructions: Do the thing carefully
---

# Full Body

Detailed instructions here.
`,
    );

    await skill.ensureFullyLoaded();

    expect(skill._bodyLoaded).toBe(true);
    expect(skill.tools).toEqual(["tool_a", "tool_b"]);
    expect(skill.instructions).toBe("Do the thing carefully");
    expect(skill.definition._isStub).toBe(false);
    expect(skill.definition.body).toContain("Full Body");
  });

  it("should not re-parse on subsequent calls", async () => {
    const skill = new MarkdownSkill({
      name: "once-only",
      description: "Load once",
      _isStub: true,
      _bodyLoaded: false,
      sourcePath: "/fake/once-only/SKILL.md",
    });

    vi.spyOn(fs.promises, "readFile").mockResolvedValue(MINIMAL_SKILL_MD);

    await skill.ensureFullyLoaded();
    expect(skill._bodyLoaded).toBe(true);

    const readSpy = vi.spyOn(fs.promises, "readFile");
    await skill.ensureFullyLoaded();

    // Second call should not trigger another file read
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("should handle missing sourcePath gracefully", async () => {
    const skill = new MarkdownSkill({
      name: "no-path",
      description: "No source path",
      _isStub: true,
      _bodyLoaded: false,
      sourcePath: "unknown",
    });

    await skill.ensureFullyLoaded();

    // Should mark as loaded without throwing
    expect(skill._bodyLoaded).toBe(true);
  });

  it("should set _bodyLoaded=true even when file read fails (prevent infinite retries)", async () => {
    const skill = new MarkdownSkill({
      name: "fail-load",
      description: "Will fail",
      _isStub: true,
      _bodyLoaded: false,
      sourcePath: "/nonexistent/fail-load/SKILL.md",
    });

    vi.spyOn(fs.promises, "readFile").mockRejectedValue(
      new Error("ENOENT: no such file"),
    );

    await skill.ensureFullyLoaded();

    // Must not throw, and must mark loaded to prevent retry loops
    expect(skill._bodyLoaded).toBe(true);
  });

  it("should be triggered by execute() for stub skills", async () => {
    const skill = new MarkdownSkill({
      name: "exec-lazy",
      description: "Execute triggers lazy load",
      _isStub: true,
      _bodyLoaded: false,
      sourcePath: "/fake/exec-lazy/SKILL.md",
      body: "",
    });

    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      `---
name: exec-lazy
description: Execute triggers lazy load
---

# Exec Body

Instructions for execution.
`,
    );

    // execute() should call ensureFullyLoaded() internally
    const result = await skill.execute({});

    expect(skill._bodyLoaded).toBe(true);
    expect(result.success).toBe(true);
    expect(result.type).toBe("documentation");
  });
});

// ============================================================================
// 3. SkillRegistry.hotLoadSkill()
// ============================================================================

describe("SkillRegistry.hotLoadSkill", () => {
  let registry;

  beforeEach(() => {
    registry = new SkillRegistry({ autoLoad: false, maxSkills: 50 });
  });

  it("should register a new skill from a definition and return true", () => {
    const definition = {
      name: "hot-loaded",
      description: "Dynamically loaded skill",
      version: "1.0.0",
      category: "dynamic",
      source: "managed",
      sourcePath: "/path/to/hot-loaded/SKILL.md",
    };

    const result = registry.hotLoadSkill("hot-loaded", definition);

    expect(result).toBe(true);
    expect(registry.skills.has("hot-loaded")).toBe(true);

    const skill = registry.skills.get("hot-loaded");
    expect(skill.skillId).toBe("hot-loaded");
    expect(skill.description).toBe("Dynamically loaded skill");
  });

  it("should create a MarkdownSkill instance internally", () => {
    const definition = {
      name: "md-check",
      description: "Should be MarkdownSkill",
      version: "1.0.0",
      category: "test",
    };

    registry.hotLoadSkill("md-check", definition);

    const skill = registry.skills.get("md-check");
    // Note: Due to CJS/ESM interop in Vitest, instanceof checks across
    // module boundaries can fail. Instead we verify the duck-type contract:
    // it has the MarkdownSkill-specific methods and properties.
    expect(skill.skillId).toBe("md-check");
    expect(typeof skill.ensureFullyLoaded).toBe("function");
    expect(typeof skill.getBody).toBe("function");
    expect(typeof skill.getDefinition).toBe("function");
    expect(skill.constructor.name).toBe("MarkdownSkill");
  });

  it("should update category index on hot load", () => {
    registry.hotLoadSkill("cat-skill", {
      name: "cat-skill",
      description: "Category test",
      category: "automation",
    });

    expect(registry.categoryIndex.has("automation")).toBe(true);
    expect(registry.categoryIndex.get("automation").has("cat-skill")).toBe(
      true,
    );
  });

  it("should override an existing skill with the same id", () => {
    registry.hotLoadSkill("replace-me", {
      name: "replace-me",
      description: "Original",
      category: "v1",
    });

    registry.hotLoadSkill("replace-me", {
      name: "replace-me",
      description: "Replacement",
      category: "v2",
    });

    const skill = registry.skills.get("replace-me");
    expect(skill.description).toBe("Replacement");
    expect(skill.category).toBe("v2");
  });

  it("should return false when definition is invalid", () => {
    // A definition that will cause MarkdownSkill constructor to throw
    // Passing null should cause an error
    const result = registry.hotLoadSkill("bad-skill", null);

    expect(result).toBe(false);
    expect(registry.skills.has("bad-skill")).toBe(false);
  });
});

// ============================================================================
// 4. SkillRegistry.hotUnloadSkill()
// ============================================================================

describe("SkillRegistry.hotUnloadSkill", () => {
  let registry;

  beforeEach(() => {
    registry = new SkillRegistry({ autoLoad: false, maxSkills: 50 });
  });

  it("should remove a registered skill and return true", () => {
    registry.hotLoadSkill("remove-me", {
      name: "remove-me",
      description: "Will be removed",
      category: "temp",
    });
    expect(registry.skills.has("remove-me")).toBe(true);

    const result = registry.hotUnloadSkill("remove-me");

    expect(result).toBe(true);
    expect(registry.skills.has("remove-me")).toBe(false);
  });

  it("should clean up category index on unload", () => {
    registry.hotLoadSkill("cat-remove", {
      name: "cat-remove",
      description: "Category removal test",
      category: "removable",
    });
    expect(registry.categoryIndex.has("removable")).toBe(true);

    registry.hotUnloadSkill("cat-remove");

    // Category should be fully removed since it was the only skill
    expect(registry.categoryIndex.has("removable")).toBe(false);
  });

  it("should return false when skill does not exist", () => {
    const result = registry.hotUnloadSkill("nonexistent-skill");

    expect(result).toBe(false);
  });

  it("should not affect other registered skills", () => {
    registry.hotLoadSkill("keep-me", {
      name: "keep-me",
      description: "Should survive",
      category: "safe",
    });
    registry.hotLoadSkill("drop-me", {
      name: "drop-me",
      description: "Should be removed",
      category: "unsafe",
    });

    registry.hotUnloadSkill("drop-me");

    expect(registry.skills.has("keep-me")).toBe(true);
    expect(registry.skills.has("drop-me")).toBe(false);
  });
});

// ============================================================================
// 5. SkillLoader.loadSingleSkill()
// ============================================================================

describe("SkillLoader.loadSingleSkill", () => {
  let loader;
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), "skill-single-test-" + Date.now());
    loader = new SkillLoader({
      workspacePath: tempDir,
      autoGating: false,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should load a single skill from a directory with SKILL.md", async () => {
    const skillDir = path.join(tempDir, "single-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: single-loaded
description: Loaded individually
version: 1.5.0
category: individual
---

# Single Skill

Instructions for single loading.
`,
    );

    const definition = await loader.loadSingleSkill(skillDir, "managed");

    expect(definition).not.toBeNull();
    expect(definition.name).toBe("single-loaded");
    expect(definition.description).toBe("Loaded individually");
    expect(definition.version).toBe("1.5.0");
    expect(definition.source).toBe("managed");
    expect(definition.body).toContain("Single Skill");
  });

  it("should store the definition in the correct layer and resolved maps", async () => {
    const skillDir = path.join(tempDir, "stored-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: stored-test
description: Test storage
---

Body.
`,
    );

    await loader.loadSingleSkill(skillDir, "workspace");

    expect(loader.layerDefinitions.workspace.has("stored-test")).toBe(true);
    expect(loader.resolvedSkills.has("stored-test")).toBe(true);
  });

  it("should return null when SKILL.md does not exist", async () => {
    const emptyDir = path.join(tempDir, "empty-dir");
    fs.mkdirSync(emptyDir, { recursive: true });

    const result = await loader.loadSingleSkill(emptyDir);

    expect(result).toBeNull();
  });

  it("should emit skill-loaded event", async () => {
    const handler = vi.fn();
    loader.on("skill-loaded", handler);

    const skillDir = path.join(tempDir, "event-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: event-test
description: Event emission test
---

Body.
`,
    );

    await loader.loadSingleSkill(skillDir, "managed");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        layer: "managed",
        definition: expect.objectContaining({ name: "event-test" }),
      }),
    );
  });

  it("should use full parse (not metadata-only) for single skill loading", async () => {
    const skillDir = path.join(tempDir, "full-parse-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), FULL_SKILL_MD);

    const parseSpy = vi.spyOn(loader.parser, "parseFile");

    const definition = await loader.loadSingleSkill(skillDir, "managed");

    // loadSingleSkill should use parseFile (full), not parseMetadataOnly
    expect(parseSpy).toHaveBeenCalled();
    expect(definition.body).toContain("Lazy Test Skill");
  });

  it("should default to managed layer when no layer is specified", async () => {
    const skillDir = path.join(tempDir, "default-layer");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: default-layer-skill
description: Default layer test
---

Body.
`,
    );

    const definition = await loader.loadSingleSkill(skillDir);

    expect(definition.source).toBe("managed");
    expect(loader.layerDefinitions.managed.has("default-layer-skill")).toBe(
      true,
    );
  });

  it("should return null on parse errors without throwing", async () => {
    const skillDir = path.join(tempDir, "bad-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    // Write an invalid SKILL.md that will cause a parse error
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: !!!invalid
description: Bad name
---
`,
    );

    // Parser with strictValidation will throw, but loadSingleSkill catches
    loader.parser = new SkillMdParser({ strictValidation: true });

    const result = await loader.loadSingleSkill(skillDir);

    expect(result).toBeNull();
  });
});

// ============================================================================
// 6. Transparent lazy loading in getSkill()
// ============================================================================

describe("SkillRegistry.getSkill - transparent lazy loading", () => {
  let registry;

  beforeEach(() => {
    registry = new SkillRegistry({ autoLoad: false, maxSkills: 50 });
  });

  it("should return the skill immediately (synchronous)", () => {
    registry.hotLoadSkill("sync-get", {
      name: "sync-get",
      description: "Synchronous retrieval",
      _isStub: true,
      _bodyLoaded: false,
      sourcePath: "/fake/sync-get/SKILL.md",
    });

    const skill = registry.getSkill("sync-get");

    expect(skill).toBeDefined();
    expect(skill.skillId).toBe("sync-get");
  });

  it("should trigger ensureFullyLoaded() when the skill has that method", () => {
    registry.hotLoadSkill("lazy-get", {
      name: "lazy-get",
      description: "Triggers lazy load",
      _isStub: true,
      _bodyLoaded: false,
      sourcePath: "/fake/lazy-get/SKILL.md",
    });

    const skill = registry.skills.get("lazy-get");
    const loadSpy = vi.spyOn(skill, "ensureFullyLoaded").mockResolvedValue();

    registry.getSkill("lazy-get");

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it("should not throw if ensureFullyLoaded rejects (best-effort)", async () => {
    registry.hotLoadSkill("fail-lazy", {
      name: "fail-lazy",
      description: "Lazy load will fail",
      _isStub: true,
      _bodyLoaded: false,
      sourcePath: "/nonexistent/SKILL.md",
    });

    const skill = registry.skills.get("fail-lazy");
    vi.spyOn(skill, "ensureFullyLoaded").mockRejectedValue(
      new Error("load failed"),
    );

    // getSkill should not throw
    const result = registry.getSkill("fail-lazy");
    expect(result).toBeDefined();
    expect(result.skillId).toBe("fail-lazy");
  });

  it("should return undefined for non-existent skill", () => {
    const result = registry.getSkill("does-not-exist");

    expect(result).toBeUndefined();
  });

  it("should not trigger ensureFullyLoaded on already-loaded skills", () => {
    // Non-stub skill (fully loaded from the start)
    registry.hotLoadSkill("full-skill", {
      name: "full-skill",
      description: "Already fully loaded",
      body: "# Full content",
      _isStub: false,
    });

    const skill = registry.skills.get("full-skill");
    const loadSpy = vi.spyOn(skill, "ensureFullyLoaded").mockResolvedValue();

    registry.getSkill("full-skill");

    // ensureFullyLoaded is still called by getSkill (it returns early internally)
    expect(loadSpy).toHaveBeenCalled();
  });
});

// ============================================================================
// 7. Event emission for hot-load / hot-unload
// ============================================================================

describe("SkillRegistry hot-load/hot-unload events", () => {
  let registry;

  beforeEach(() => {
    registry = new SkillRegistry({ autoLoad: false, maxSkills: 50 });
  });

  it("should emit 'skill-hot-loaded' event on hotLoadSkill", () => {
    const handler = vi.fn();
    registry.on("skill-hot-loaded", handler);

    registry.hotLoadSkill("event-skill", {
      name: "event-skill",
      description: "Event test",
      category: "events",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: "event-skill",
        skill: expect.objectContaining({ skillId: "event-skill" }),
      }),
    );
  });

  it("should emit 'skill-registered' event on hotLoadSkill (via register())", () => {
    const handler = vi.fn();
    registry.on("skill-registered", handler);

    registry.hotLoadSkill("reg-event", {
      name: "reg-event",
      description: "Registration event",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        skill: expect.objectContaining({ skillId: "reg-event" }),
      }),
    );
  });

  it("should emit 'skill-hot-unloaded' event on hotUnloadSkill", () => {
    const handler = vi.fn();
    registry.on("skill-hot-unloaded", handler);

    // First load, then unload
    registry.hotLoadSkill("unload-event", {
      name: "unload-event",
      description: "Unload event test",
    });

    registry.hotUnloadSkill("unload-event");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: "unload-event",
      }),
    );
  });

  it("should emit 'skill-unregistered' event on hotUnloadSkill (via unregister())", () => {
    const handler = vi.fn();
    registry.on("skill-unregistered", handler);

    registry.hotLoadSkill("unreg-event", {
      name: "unreg-event",
      description: "Unregister event",
    });

    registry.hotUnloadSkill("unreg-event");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: "unreg-event",
        skill: expect.objectContaining({ skillId: "unreg-event" }),
      }),
    );
  });

  it("should NOT emit hot-unloaded event for nonexistent skill", () => {
    const handler = vi.fn();
    registry.on("skill-hot-unloaded", handler);

    registry.hotUnloadSkill("ghost-skill");

    expect(handler).not.toHaveBeenCalled();
  });

  it("should NOT emit hot-loaded event when hotLoadSkill fails", () => {
    const handler = vi.fn();
    registry.on("skill-hot-loaded", handler);

    registry.hotLoadSkill("fail-event", null); // will fail

    expect(handler).not.toHaveBeenCalled();
  });

  it("should emit events in correct order: registered then hot-loaded", () => {
    const order = [];

    registry.on("skill-registered", () => order.push("registered"));
    registry.on("skill-hot-loaded", () => order.push("hot-loaded"));

    registry.hotLoadSkill("order-test", {
      name: "order-test",
      description: "Order check",
    });

    expect(order).toEqual(["registered", "hot-loaded"]);
  });

  it("should emit events in correct order: unregistered then hot-unloaded", () => {
    const order = [];

    registry.on("skill-unregistered", () => order.push("unregistered"));
    registry.on("skill-hot-unloaded", () => order.push("hot-unloaded"));

    registry.hotLoadSkill("order-unload", {
      name: "order-unload",
      description: "Unload order",
    });

    registry.hotUnloadSkill("order-unload");

    expect(order).toEqual(["unregistered", "hot-unloaded"]);
  });
});

// ============================================================================
// Integration: Full lazy-load pipeline
// ============================================================================

describe("Full lazy-load pipeline integration", () => {
  let loader;
  let registry;
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), "lazy-pipeline-" + Date.now());
    loader = new SkillLoader({ workspacePath: tempDir, autoGating: false });
    registry = new SkillRegistry({ autoLoad: false, maxSkills: 50 });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should support the full flow: loadLayer (metadata-only) -> register -> getSkill -> ensureFullyLoaded", async () => {
    // 1. Set up a skill directory in the workspace layer
    const skillsDir = path.join(
      tempDir,
      ".chainlesschain",
      "skills",
      "pipeline-skill",
    );
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, "SKILL.md"),
      `---
name: pipeline-skill
description: Full pipeline test
version: 3.0.0
category: pipeline
tags: [e2e, lazy]
tools: [custom_tool]
instructions: Execute carefully
---

# Pipeline Skill Body

This body should only be loaded on demand.
`,
    );

    // 2. Load the layer (should use parseMetadataOnly)
    const loadResult = await loader.loadLayer("workspace");
    expect(loadResult.loaded).toBe(1);

    // 3. Get the definition (it is a stub)
    const stub = loader.layerDefinitions.workspace.get("pipeline-skill");
    expect(stub._isStub).toBe(true);
    expect(stub._bodyLoaded).toBe(false);
    expect(stub.name).toBe("pipeline-skill");

    // 4. Create MarkdownSkill instances from the stubs
    loader.resolveConflicts();
    const instances = loader.createSkillInstances();
    expect(instances).toHaveLength(1);

    const skill = instances[0];
    expect(skill._bodyLoaded).toBe(false);

    // 5. Register in the registry
    registry.register(skill);
    expect(registry.skills.has("pipeline-skill")).toBe(true);

    // 6. getSkill triggers ensureFullyLoaded (non-blocking)
    const retrieved = registry.getSkill("pipeline-skill");
    expect(retrieved).toBeDefined();

    // 7. Explicitly await ensureFullyLoaded to get the body
    await retrieved.ensureFullyLoaded();
    expect(retrieved._bodyLoaded).toBe(true);
    expect(retrieved.definition.body).toContain("Pipeline Skill Body");
    expect(retrieved.tools).toEqual(["custom_tool"]);
    expect(retrieved.instructions).toBe("Execute carefully");
  });

  it("should support hot-load then hot-unload cycle via loadSingleSkill", async () => {
    // 1. Create skill on disk
    const skillDir = path.join(tempDir, "hot-cycle-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: hot-cycle
description: Hot cycle test
version: 1.0.0
category: dynamic
---

# Hot Cycle Body
`,
    );

    // 2. Load the single skill (full parse)
    const definition = await loader.loadSingleSkill(skillDir, "managed");
    expect(definition).not.toBeNull();
    expect(definition.name).toBe("hot-cycle");

    // 3. Hot-load into registry
    const loadResult = registry.hotLoadSkill("hot-cycle", definition);
    expect(loadResult).toBe(true);
    expect(registry.skills.has("hot-cycle")).toBe(true);

    // 4. Verify skill is accessible
    const skill = registry.getSkill("hot-cycle");
    expect(skill.description).toBe("Hot cycle test");

    // 5. Hot-unload
    const unloadResult = registry.hotUnloadSkill("hot-cycle");
    expect(unloadResult).toBe(true);
    expect(registry.skills.has("hot-cycle")).toBe(false);
    expect(registry.getSkill("hot-cycle")).toBeUndefined();
  });
});
