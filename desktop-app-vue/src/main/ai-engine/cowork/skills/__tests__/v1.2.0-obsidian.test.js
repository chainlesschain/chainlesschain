/**
 * Unit tests for obsidian skill handler (v1.2.0)
 * Uses _deps injection for fs/path mocking
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/obsidian/handler.js");

describe("obsidian handler", () => {
  const originalVaultPath = process.env.OBSIDIAN_VAULT_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OBSIDIAN_VAULT_PATH = "/mock/vault";

    if (handler._deps) {
      handler._deps.fs = {
        existsSync: vi.fn((p) => {
          if (p === "/mock/vault") {
            return true;
          }
          if (p === "/mock/vault/.obsidian") {
            return true;
          }
          return false;
        }),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        readFileSync: vi
          .fn()
          .mockReturnValue("# Test Note\n\nSome content here\n\n#tag1 #tag2\n"),
        readdirSync: vi.fn((dir, opts) => {
          if (dir === "/mock/vault") {
            if (opts && opts.withFileTypes) {
              return [
                {
                  name: "note1.md",
                  isFile: () => true,
                  isDirectory: () => false,
                },
                {
                  name: "note2.md",
                  isFile: () => true,
                  isDirectory: () => false,
                },
                {
                  name: ".obsidian",
                  isFile: () => false,
                  isDirectory: () => true,
                },
              ];
            }
            return ["note1.md", "note2.md", ".obsidian"];
          }
          return [];
        }),
        statSync: vi.fn(() => ({
          mtime: new Date("2026-01-15"),
          birthtime: new Date("2026-01-01"),
          size: 256,
        })),
      };
      handler._deps.path = {
        join: (...args) => args.join("/"),
        relative: (from, to) => to.replace(from + "/", ""),
        basename: (p, ext) => {
          const base = p.split("/").pop();
          return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
        },
        resolve: (p) => p,
      };
    }
  });

  afterEach(() => {
    if (originalVaultPath) {
      process.env.OBSIDIAN_VAULT_PATH = originalVaultPath;
    } else {
      delete process.env.OBSIDIAN_VAULT_PATH;
    }
  });

  describe("execute() - no vault", () => {
    it("should return error when vault not found", async () => {
      delete process.env.OBSIDIAN_VAULT_PATH;
      if (handler._deps) {
        handler._deps.fs.existsSync = vi.fn().mockReturnValue(false);
      }
      const result = await handler.execute({ input: "list-recent" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("vault not found");
    });
  });

  describe("execute() - create-note", () => {
    it("should create a note", async () => {
      const result = await handler.execute(
        { input: "create-note 'My New Note' --tags test,demo" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("create-note");
      expect(result.result.title).toBeDefined();
    });

    it("should return error when note already exists", async () => {
      if (handler._deps) {
        handler._deps.fs.existsSync = vi.fn().mockReturnValue(true);
      }
      const result = await handler.execute(
        { input: "create-note 'Existing Note'" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should return error without title", async () => {
      const result = await handler.execute({ input: "create-note" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - search", () => {
    it("should search notes by query", async () => {
      if (handler._deps) {
        handler._deps.fs.readFileSync = vi
          .fn()
          .mockReturnValue("Some test content about searching");
        handler._deps.fs.statSync = vi
          .fn()
          .mockReturnValue({ mtime: new Date(), size: 100 });
      }
      const result = await handler.execute({ input: "search test" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("search");
    });

    it("should return error for empty query", async () => {
      const result = await handler.execute({ input: "search" }, {}, {});
      expect(result.success).toBe(false);
    });
  });

  describe("execute() - list-tags", () => {
    it("should list tags from vault", async () => {
      if (handler._deps) {
        handler._deps.fs.readFileSync = vi
          .fn()
          .mockReturnValue(
            "---\ntags: [javascript, testing]\n---\n\n# Note\n\n#coding #javascript\n",
          );
      }
      const result = await handler.execute({ input: "list-tags" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-tags");
      expect(result.result.tags.length).toBeGreaterThan(0);
    });
  });

  describe("execute() - list-recent", () => {
    it("should list recent notes", async () => {
      const result = await handler.execute(
        { input: "list-recent --limit 5" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("list-recent");
      expect(result.result.notes).toBeDefined();
    });
  });

  describe("execute() - link-notes", () => {
    it("should return error for missing source", async () => {
      const result = await handler.execute({ input: "link-notes" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should return error when source note not found", async () => {
      if (handler._deps) {
        handler._deps.fs.existsSync = vi.fn((p) => {
          if (p === "/mock/vault") {
            return true;
          }
          return false;
        });
        handler._deps.fs.readdirSync = vi.fn().mockReturnValue([]);
      }
      const result = await handler.execute(
        { input: "link-notes 'Source' 'Target'" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("execute() - unknown action", () => {
    it("should return error for unknown action", async () => {
      const result = await handler.execute(
        { input: "delete-note test" },
        {},
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });
});
