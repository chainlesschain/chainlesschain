import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CLIPermanentMemory, _deps } from "../../src/lib/permanent-memory.js";

describe("CLIPermanentMemory", () => {
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
  });

  afterEach(() => {
    Object.assign(_deps, originalDeps);
  });

  // ── Constructor ──

  describe("constructor", () => {
    it("creates instance without db", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.db).toBeNull();
      expect(pm._initialized).toBe(false);
    });

    it("creates instance with db", () => {
      const pm = new CLIPermanentMemory({ db: {}, memoryDir: "/tmp/test" });
      expect(pm.db).toEqual({});
      expect(pm.memoryDir).toBe("/tmp/test");
    });
  });

  // ── Initialize ──

  describe("initialize", () => {
    it("sets initialized flag", () => {
      const pm = new CLIPermanentMemory({});
      pm.initialize();
      expect(pm._initialized).toBe(true);
    });

    it("skips re-initialization", () => {
      const pm = new CLIPermanentMemory({});
      pm.initialize();
      pm.initialize(); // Should not throw
      expect(pm._initialized).toBe(true);
    });

    it("creates DB table when db is available", () => {
      const mockDb = {
        exec: vi.fn(),
        prepare: vi.fn(() => ({ all: () => [] })),
      };
      const pm = new CLIPermanentMemory({ db: mockDb });
      pm.initialize();
      expect(mockDb.exec).toHaveBeenCalled();
      expect(mockDb.exec.mock.calls[0][0]).toContain("permanent_memory");
    });

    it("handles DB table creation failure gracefully", () => {
      const mockDb = {
        exec: vi.fn(() => {
          throw new Error("DB error");
        }),
      };
      const pm = new CLIPermanentMemory({ db: mockDb });
      // Should not throw
      pm.initialize();
      expect(pm._initialized).toBe(true);
    });

    it("creates directories when memoryDir is set", () => {
      const mockFs = {
        existsSync: vi.fn(() => false),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn(() => []),
        readFileSync: vi.fn(() => ""),
      };
      _deps.fs = mockFs;
      _deps.path = originalDeps.path;

      const pm = new CLIPermanentMemory({ memoryDir: "/tmp/test-mem" });
      pm.initialize();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith("/tmp/test-mem", {
        recursive: true,
      });
    });
  });

  // ── appendDailyNote ──

  describe("appendDailyNote", () => {
    it("returns null when no memoryDir", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.appendDailyNote("test")).toBeNull();
    });

    it("creates new daily note file", () => {
      const written = {};
      _deps.fs = {
        existsSync: vi.fn((p) => p.includes("daily") && !p.endsWith(".md")),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn((p, c) => {
          written[p] = c;
        }),
        readFileSync: vi.fn(() => ""),
        readdirSync: vi.fn(() => []),
        appendFileSync: vi.fn(),
      };
      _deps.path = originalDeps.path;

      const pm = new CLIPermanentMemory({ memoryDir: "/tmp/mem" });
      const result = pm.appendDailyNote("Test note content");

      expect(result).not.toBeNull();
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(_deps.fs.writeFileSync).toHaveBeenCalled();
    });

    it("appends to existing daily note", () => {
      _deps.fs = {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        readFileSync: vi.fn(() => "existing content"),
        appendFileSync: vi.fn(),
        readdirSync: vi.fn(() => []),
      };
      _deps.path = originalDeps.path;

      const pm = new CLIPermanentMemory({ memoryDir: "/tmp/mem" });
      const result = pm.appendDailyNote("New entry");

      expect(result).not.toBeNull();
      expect(_deps.fs.appendFileSync).toHaveBeenCalled();
    });
  });

  // ── updateMemoryFile ──

  describe("updateMemoryFile", () => {
    it("returns null when no memoryDir", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.updateMemoryFile("Test", "content")).toBeNull();
    });

    it("creates new MEMORY.md with section", () => {
      let writtenContent = "";
      _deps.fs = {
        existsSync: vi.fn((p) => !p.endsWith("MEMORY.md")),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn((p, c) => {
          writtenContent = c;
        }),
        readFileSync: vi.fn(() => ""),
        readdirSync: vi.fn(() => []),
      };
      _deps.path = originalDeps.path;

      const pm = new CLIPermanentMemory({ memoryDir: "/tmp/mem" });
      const result = pm.updateMemoryFile("Patterns", "Use TypeScript");

      expect(result).not.toBeNull();
      expect(writtenContent).toContain("## Patterns");
      expect(writtenContent).toContain("Use TypeScript");
    });

    it("replaces existing section", () => {
      let writtenContent = "";
      _deps.fs = {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn((p, c) => {
          writtenContent = c;
        }),
        readFileSync: vi.fn(
          () =>
            "# Memory\n\n## Patterns\n\nOld content\n\n## Other\n\nKeep this",
        ),
        readdirSync: vi.fn(() => []),
      };
      _deps.path = originalDeps.path;

      const pm = new CLIPermanentMemory({ memoryDir: "/tmp/mem" });
      pm.updateMemoryFile("Patterns", "New content");

      expect(writtenContent).toContain("New content");
      expect(writtenContent).toContain("Keep this");
      expect(writtenContent).not.toContain("Old content");
    });
  });

  // ── hybridSearch ──

  describe("hybridSearch", () => {
    it("returns empty array when not initialized", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.hybridSearch("test")).toEqual([]);
    });

    it("returns empty for empty query", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.hybridSearch("")).toEqual([]);
    });
  });

  // ── getRelevantContext ──

  describe("getRelevantContext", () => {
    it("returns empty for null query", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.getRelevantContext(null)).toEqual([]);
    });

    it("initializes on first call", () => {
      const pm = new CLIPermanentMemory({});
      const spy = vi.spyOn(pm, "initialize");
      pm.getRelevantContext("test");
      expect(spy).toHaveBeenCalled();
    });
  });

  // ── autoSummarize ──

  describe("autoSummarize", () => {
    it("returns empty for short sessions", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm.autoSummarize([])).toEqual([]);
      expect(pm.autoSummarize([{ role: "user", content: "hi" }])).toEqual([]);
    });

    it("extracts tool usage patterns", () => {
      const pm = new CLIPermanentMemory({});
      const messages = [
        { role: "system", content: "sys" },
        { role: "user", content: "read config" },
        {
          role: "assistant",
          content: "reading",
          tool_calls: [{ function: { name: "read_file" } }],
        },
        { role: "tool", content: "file content", tool_call_id: "t1" },
        { role: "user", content: "now edit it" },
        {
          role: "assistant",
          content: "editing",
          tool_calls: [{ function: { name: "edit_file" } }],
        },
      ];

      const facts = pm.autoSummarize(messages);
      expect(facts.length).toBeGreaterThan(0);

      const toolsFact = facts.find((f) => f.includes("Tools used"));
      expect(toolsFact).toBeDefined();
      expect(toolsFact).toContain("read_file");
      expect(toolsFact).toContain("edit_file");
    });

    it("extracts user topics", () => {
      const pm = new CLIPermanentMemory({});
      const messages = [
        { role: "system", content: "sys" },
        { role: "user", content: "help me with authentication" },
        { role: "assistant", content: "sure" },
        { role: "user", content: "add JWT tokens" },
        { role: "assistant", content: "done" },
      ];

      const facts = pm.autoSummarize(messages);
      const topicFact = facts.find((f) => f.includes("Topics discussed"));
      expect(topicFact).toBeDefined();
      expect(topicFact).toContain("authentication");
    });
  });

  // ── _storeEntry ──

  describe("_storeEntry", () => {
    it("returns null without db", () => {
      const pm = new CLIPermanentMemory({});
      expect(pm._storeEntry("test")).toBeNull();
    });

    it("stores entry in db", () => {
      const mockDb = {
        prepare: vi.fn(() => ({ run: vi.fn() })),
      };
      const pm = new CLIPermanentMemory({ db: mockDb });
      const id = pm._storeEntry("test fact", "auto");
      expect(id).toBeTruthy();
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  // ── _buildIndex ──

  describe("_buildIndex", () => {
    it("builds index from memory file content", () => {
      const pm = new CLIPermanentMemory({});
      pm._memoryFileContent =
        "# Memory\n\n## Patterns\n\nUse TypeScript\n\n## Tools\n\nVim and VSCode";
      pm._dailyNotes = [];
      pm._dbEntries = [];
      pm._buildIndex();

      expect(pm._bm25).not.toBeNull();
    });

    it("builds index from daily notes", () => {
      const pm = new CLIPermanentMemory({});
      pm._memoryFileContent = "";
      pm._dailyNotes = [
        { date: "2026-03-12", content: "Worked on authentication feature" },
      ];
      pm._dbEntries = [];
      pm._buildIndex();

      expect(pm._bm25).not.toBeNull();
    });

    it("sets bm25 to null when no documents", () => {
      const pm = new CLIPermanentMemory({});
      pm._memoryFileContent = "";
      pm._dailyNotes = [];
      pm._dbEntries = [];
      pm._buildIndex();

      expect(pm._bm25).toBeNull();
    });
  });
});
