/**
 * Integration tests: CLI-Anything bridge + DB workflow
 *
 * Tests the full flow from table creation → tool registration → skill generation
 * → listing → removal using the MockDatabase helper.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  _deps,
  ensureCliAnythingTables,
  registerTool,
  removeTool,
  listTools,
  _generateSkillMd,
  _generateHandlerJs,
} from "../../src/lib/cli-anything-bridge.js";

describe("CLI-Anything Workflow (integration)", () => {
  let db;
  let originalDeps;

  beforeEach(() => {
    db = new MockDatabase();
    ensureCliAnythingTables(db);
    originalDeps = { ..._deps };

    // Mock filesystem so registerTool doesn't write to real disk
    _deps.fs = {
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      rmSync: vi.fn(),
    };
    _deps.path = {
      join: (...args) => args.join("/"),
      delimiter: ":",
    };
  });

  afterEach(() => {
    Object.assign(_deps, originalDeps);
    vi.clearAllMocks();
  });

  // ─── Full Register → List → Remove Workflow ────────────────

  describe("Register → List → Remove lifecycle", () => {
    it("should register a tool, list it, then remove it", () => {
      // Register
      const result = registerTool(db, "gimp", {
        command: "cli-anything-gimp",
        helpData: {
          description: "GIMP image editor CLI",
          subcommands: [
            { name: "project", description: "Manage GIMP projects" },
            { name: "filter", description: "Apply image filters" },
          ],
        },
      });

      expect(result.skillName).toBe("cli-anything-gimp");
      expect(result.subcommands).toHaveLength(2);

      // Verify SKILL.md was written
      const skillMdCall = _deps.fs.writeFileSync.mock.calls.find((c) =>
        c[0].includes("SKILL.md"),
      );
      expect(skillMdCall).toBeDefined();
      expect(skillMdCall[1]).toContain("name: cli-anything-gimp");
      expect(skillMdCall[1]).toContain("handler: handler.js");

      // Verify handler.js was written
      const handlerCall = _deps.fs.writeFileSync.mock.calls.find((c) =>
        c[0].includes("handler.js"),
      );
      expect(handlerCall).toBeDefined();
      expect(handlerCall[1]).toContain("cli-anything-gimp");

      // List should show the tool
      const tools = listTools(db);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("gimp");
      expect(tools[0].skill_name).toBe("cli-anything-gimp");
      expect(tools[0].status).toBe("registered");
      expect(tools[0].description).toBe("GIMP image editor CLI");

      // Remove
      const removeResult = removeTool(db, "gimp");
      expect(removeResult.removed).toBe(true);
      expect(_deps.fs.rmSync).toHaveBeenCalledTimes(1);

      // List should be empty
      const afterRemove = listTools(db);
      expect(afterRemove).toHaveLength(0);
    });

    it("should register multiple tools independently", () => {
      registerTool(db, "gimp", {
        command: "cli-anything-gimp",
        helpData: { description: "GIMP CLI", subcommands: [] },
      });
      registerTool(db, "blender", {
        command: "cli-anything-blender",
        helpData: { description: "Blender CLI", subcommands: [] },
      });
      registerTool(db, "inkscape", {
        command: "cli-anything-inkscape",
        helpData: { description: "Inkscape CLI", subcommands: [] },
      });

      const tools = listTools(db);
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual(["blender", "gimp", "inkscape"]); // sorted by name
    });
  });

  // ─── Force overwrite ──────────────────────────────────────

  describe("Force overwrite", () => {
    it("should reject duplicate without --force", () => {
      registerTool(db, "gimp", {
        command: "cli-anything-gimp",
        helpData: { description: "v1", subcommands: [] },
      });

      expect(() =>
        registerTool(db, "gimp", {
          command: "cli-anything-gimp",
          helpData: { description: "v2", subcommands: [] },
        }),
      ).toThrow("already registered");
    });

    it("should overwrite with --force and update description", () => {
      registerTool(db, "gimp", {
        command: "cli-anything-gimp",
        helpData: { description: "Old desc", subcommands: [] },
      });

      registerTool(db, "gimp", {
        command: "cli-anything-gimp",
        helpData: {
          description: "New desc",
          subcommands: [{ name: "export", description: "Export images" }],
        },
        force: true,
      });

      const tools = listTools(db);
      expect(tools).toHaveLength(1);
      expect(tools[0].description).toBe("New desc");
    });
  });

  // ─── Generated skill content validation ───────────────────

  describe("Generated skill content", () => {
    it("SKILL.md should be parseable as valid frontmatter + markdown", () => {
      const md = _generateSkillMd("ffmpeg", {
        description: "FFmpeg media processor",
        subcommands: [
          { name: "convert", description: "Convert media files" },
          { name: "stream", description: "Stream media" },
        ],
      });

      // Valid frontmatter delimiters
      expect(md.startsWith("---\n")).toBe(true);
      expect(md.split("---").length).toBeGreaterThanOrEqual(3);

      // Required fields
      expect(md).toContain("name: cli-anything-ffmpeg");
      expect(md).toContain("category: integration");
      expect(md).toContain("handler: handler.js");
      expect(md).toContain("user-invocable: true");

      // Content
      expect(md).toContain("## Subcommands");
      expect(md).toContain("**convert**");
      expect(md).toContain("**stream**");
    });

    it("handler.js should be valid CommonJS module", () => {
      const js = _generateHandlerJs("ffmpeg", "cli-anything-ffmpeg");

      expect(js).toContain('"use strict"');
      expect(js).toContain('require("child_process")');
      expect(js).toContain("module.exports");
      expect(js).toContain("async execute(task, context)");
      expect(js).toContain("cli-anything-ffmpeg");
      expect(js).toContain('encoding: "utf-8"');
    });
  });

  // ─── Edge cases ───────────────────────────────────────────

  describe("Edge cases", () => {
    it("should handle tools with special characters in description", () => {
      registerTool(db, "imagemagick", {
        command: "cli-anything-imagemagick",
        helpData: {
          description: 'ImageMagick: create, edit & compose "bitmap" images',
          subcommands: [],
        },
      });

      const tools = listTools(db);
      expect(tools[0].description).toContain("ImageMagick");
    });

    it("should handle empty subcommands gracefully", () => {
      registerTool(db, "simple", {
        command: "cli-anything-simple",
        helpData: { description: "Simple tool", subcommands: [] },
      });

      const tools = listTools(db);
      expect(tools[0].name).toBe("simple");
    });

    it("should remove tool even if skill dir deletion throws", () => {
      _deps.fs.rmSync = vi.fn(() => {
        throw new Error("ENOENT");
      });

      registerTool(db, "gone", {
        command: "cli-anything-gone",
        helpData: { description: "Gone tool", subcommands: [] },
      });

      // Should not throw
      const result = removeTool(db, "gone");
      expect(result.removed).toBe(true);
      expect(listTools(db)).toHaveLength(0);
    });

    it("should throw when removing non-existent tool", () => {
      expect(() => removeTool(db, "nonexistent")).toThrow("not registered");
    });
  });

  // ─── Table idempotency ────────────────────────────────────

  describe("Table idempotency", () => {
    it("should not fail when ensureCliAnythingTables called multiple times", () => {
      ensureCliAnythingTables(db);
      ensureCliAnythingTables(db);
      ensureCliAnythingTables(db);

      // Should still work
      registerTool(db, "test", {
        command: "cli-anything-test",
        helpData: { description: "Test", subcommands: [] },
      });
      expect(listTools(db)).toHaveLength(1);
    });
  });
});
