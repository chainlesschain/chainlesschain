import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  _deps,
  ensureCliAnythingTables,
  detectPython,
  detectCliAnything,
  scanPathForTools,
  parseToolHelp,
  registerTool,
  removeTool,
  listTools,
  _generateSkillMd,
  _generateHandlerJs,
} from "../../src/lib/cli-anything-bridge.js";

describe("cli-anything-bridge", () => {
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
  });

  afterEach(() => {
    Object.assign(_deps, originalDeps);
    vi.clearAllMocks();
  });

  /* ----- ensureCliAnythingTables ----- */
  describe("ensureCliAnythingTables", () => {
    it("should call db.exec with CREATE TABLE IF NOT EXISTS", () => {
      const db = { exec: vi.fn() };
      ensureCliAnythingTables(db);
      expect(db.exec).toHaveBeenCalledTimes(1);
      expect(db.exec.mock.calls[0][0]).toContain(
        "CREATE TABLE IF NOT EXISTS cli_anything_tools",
      );
    });

    it("should be idempotent (can call multiple times)", () => {
      const db = { exec: vi.fn() };
      ensureCliAnythingTables(db);
      ensureCliAnythingTables(db);
      expect(db.exec).toHaveBeenCalledTimes(2);
    });
  });

  /* ----- detectPython ----- */
  describe("detectPython", () => {
    it("should return found=true when python is available", () => {
      _deps.execSync = vi.fn(() => "Python 3.11.5");
      const result = detectPython();
      expect(result.found).toBe(true);
      expect(result.version).toBe("3.11.5");
      expect(result.command).toBeDefined();
    });

    it("should try multiple candidates and return first match", () => {
      let calls = 0;
      _deps.execSync = vi.fn(() => {
        calls++;
        if (calls === 1) throw new Error("not found");
        return "Python 3.10.0";
      });
      const result = detectPython();
      expect(result.found).toBe(true);
      expect(result.version).toBe("3.10.0");
    });

    it("should return found=false when no python is available", () => {
      _deps.execSync = vi.fn(() => {
        throw new Error("command not found");
      });
      const result = detectPython();
      expect(result.found).toBe(false);
      expect(result.command).toBeUndefined();
    });

    it("should return found=false when output doesn't match Python version", () => {
      _deps.execSync = vi.fn(() => "something else 1.2.3");
      const result = detectPython();
      expect(result.found).toBe(false);
    });
  });

  /* ----- detectCliAnything ----- */
  describe("detectCliAnything", () => {
    it("should return installed=true when pip show succeeds", () => {
      _deps.execSync = vi.fn((cmd) => {
        if (cmd.includes("--version")) return "Python 3.11.0";
        if (cmd.includes("pip show"))
          return "Name: cli-anything\nVersion: 0.2.1\nSummary: ...";
        return "";
      });
      const result = detectCliAnything();
      expect(result.installed).toBe(true);
      expect(result.version).toBe("0.2.1");
    });

    it("should return installed=false when pip show fails", () => {
      _deps.execSync = vi.fn((cmd) => {
        if (cmd.includes("--version")) return "Python 3.11.0";
        throw new Error("not installed");
      });
      const result = detectCliAnything();
      expect(result.installed).toBe(false);
    });

    it("should return installed=false when python is not found", () => {
      _deps.execSync = vi.fn(() => {
        throw new Error("not found");
      });
      const result = detectCliAnything();
      expect(result.installed).toBe(false);
    });
  });

  /* ----- scanPathForTools ----- */
  describe("scanPathForTools", () => {
    it("should find cli-anything-* executables on PATH", () => {
      const origPath = process.env.PATH;
      process.env.PATH = "/usr/bin:/opt/tools";

      _deps.fs = {
        readdirSync: vi.fn((dir) => {
          if (dir === "/usr/bin") return ["ls", "cli-anything-gimp", "git"];
          if (dir === "/opt/tools") return ["cli-anything-blender"];
          return [];
        }),
      };
      _deps.path = { join: (...args) => args.join("/"), delimiter: ":" };

      const tools = scanPathForTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("gimp");
      expect(tools[0].command).toBe("cli-anything-gimp");
      expect(tools[1].name).toBe("blender");

      process.env.PATH = origPath;
    });

    it("should deduplicate tools across directories", () => {
      const origPath = process.env.PATH;
      process.env.PATH = "/a:/b";

      _deps.fs = {
        readdirSync: vi.fn(() => ["cli-anything-gimp"]),
      };
      _deps.path = { join: (...args) => args.join("/"), delimiter: ":" };

      const tools = scanPathForTools();
      expect(tools).toHaveLength(1);

      process.env.PATH = origPath;
    });

    it("should handle .exe suffix on Windows", () => {
      const origPath = process.env.PATH;
      process.env.PATH = "C:\\tools";

      _deps.fs = {
        readdirSync: vi.fn(() => ["cli-anything-gimp.exe"]),
      };
      _deps.path = { join: (...args) => args.join("\\"), delimiter: ";" };

      const tools = scanPathForTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("gimp");
      expect(tools[0].command).toBe("cli-anything-gimp");

      process.env.PATH = origPath;
    });

    it("should return empty array when no tools found", () => {
      const origPath = process.env.PATH;
      process.env.PATH = "/usr/bin";

      _deps.fs = {
        readdirSync: vi.fn(() => ["ls", "git", "python3"]),
      };
      _deps.path = { join: (...args) => args.join("/"), delimiter: ":" };

      const tools = scanPathForTools();
      expect(tools).toHaveLength(0);

      process.env.PATH = origPath;
    });

    it("should skip unreadable directories", () => {
      const origPath = process.env.PATH;
      process.env.PATH = "/nope:/usr/bin";

      _deps.fs = {
        readdirSync: vi.fn((dir) => {
          if (dir === "/nope") throw new Error("EACCES");
          return ["cli-anything-vim"];
        }),
      };
      _deps.path = { join: (...args) => args.join("/"), delimiter: ":" };

      const tools = scanPathForTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("vim");

      process.env.PATH = origPath;
    });
  });

  /* ----- parseToolHelp ----- */
  describe("parseToolHelp", () => {
    it("should parse description and subcommands from help text", () => {
      _deps.execSync = vi.fn(() =>
        [
          "Agent-native CLI for GIMP image editor",
          "",
          "Usage: cli-anything-gimp [command] [options]",
          "",
          "Commands:",
          "  project    Manage GIMP projects",
          "  filter     Apply image filters",
          "  export     Export images",
          "",
          "Options:",
          "  --help     Show help",
        ].join("\n"),
      );

      const result = parseToolHelp("cli-anything-gimp");
      expect(result.description).toBe("Agent-native CLI for GIMP image editor");
      expect(result.subcommands).toHaveLength(3);
      expect(result.subcommands[0].name).toBe("project");
      expect(result.subcommands[0].description).toBe("Manage GIMP projects");
      expect(result.subcommands[2].name).toBe("export");
    });

    it("should handle help output starting with Usage:", () => {
      _deps.execSync = vi.fn(() =>
        [
          "Usage: cli-anything-foo [cmd]",
          "",
          "A tool for foo management",
          "",
        ].join("\n"),
      );

      const result = parseToolHelp("cli-anything-foo");
      expect(result.description).toBe("A tool for foo management");
    });

    it("should return default description when help is empty", () => {
      _deps.execSync = vi.fn(() => "");
      const result = parseToolHelp("cli-anything-bar");
      expect(result.description).toContain("cli-anything-bar");
      expect(result.subcommands).toHaveLength(0);
    });

    it("should handle command failure gracefully", () => {
      _deps.execSync = vi.fn(() => {
        const err = new Error("fail");
        err.stdout = "Some help text\n";
        err.stderr = "";
        throw err;
      });
      const result = parseToolHelp("cli-anything-broken");
      expect(result.description).toBe("Some help text");
    });
  });

  /* ----- _generateSkillMd ----- */
  describe("_generateSkillMd", () => {
    it("should generate valid SKILL.md with YAML frontmatter", () => {
      const md = _generateSkillMd("gimp", {
        description: "GIMP image editor CLI",
        subcommands: [
          { name: "project", description: "Manage projects" },
          { name: "filter", description: "Apply filters" },
        ],
      });

      expect(md).toContain("name: cli-anything-gimp");
      expect(md).toContain("display-name: CLI-Anything gimp");
      expect(md).toContain("handler: handler.js");
      expect(md).toContain("category: integration");
      expect(md).toContain("tags: [cli-anything, gimp, external-tool]");
      expect(md).toContain("**project**: Manage projects");
      expect(md).toContain("**filter**: Apply filters");
    });

    it("should handle empty subcommands", () => {
      const md = _generateSkillMd("simple", {
        description: "Simple tool",
        subcommands: [],
      });
      expect(md).toContain("name: cli-anything-simple");
      expect(md).not.toContain("## Subcommands");
    });
  });

  /* ----- _generateHandlerJs ----- */
  describe("_generateHandlerJs", () => {
    it("should generate valid handler.js with the correct command", () => {
      const js = _generateHandlerJs("gimp", "cli-anything-gimp");
      expect(js).toContain('require("child_process")');
      expect(js).toContain("cli-anything-gimp");
      expect(js).toContain("module.exports");
      expect(js).toContain("async execute(task, context)");
      expect(js).toContain('encoding: "utf-8"');
      expect(js).toContain("timeout: 60000");
    });

    it("should return error when no input provided", () => {
      const js = _generateHandlerJs("test", "cli-anything-test");
      expect(js).toContain("No input provided");
    });
  });

  /* ----- registerTool ----- */
  describe("registerTool", () => {
    let mockDb;

    beforeEach(() => {
      mockDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => null),
          run: vi.fn(),
          all: vi.fn(() => []),
        })),
      };
      _deps.fs = {
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
      };
      _deps.path = { join: (...args) => args.join("/") };
      _deps.execSync = vi.fn(
        () => "Simple tool\n\nUsage: cli-anything-test [cmd]\n",
      );
    });

    it("should create skill directory and files", () => {
      registerTool(mockDb, "test", {
        command: "cli-anything-test",
        helpData: { description: "A test tool", subcommands: [] },
      });

      expect(_deps.fs.mkdirSync).toHaveBeenCalledTimes(1);
      expect(_deps.fs.writeFileSync).toHaveBeenCalledTimes(2);

      const skillMdCall = _deps.fs.writeFileSync.mock.calls.find((c) =>
        c[0].includes("SKILL.md"),
      );
      expect(skillMdCall).toBeDefined();
      expect(skillMdCall[1]).toContain("cli-anything-test");

      const handlerCall = _deps.fs.writeFileSync.mock.calls.find((c) =>
        c[0].includes("handler.js"),
      );
      expect(handlerCall).toBeDefined();
    });

    it("should insert DB record for new tool", () => {
      registerTool(mockDb, "test", {
        command: "cli-anything-test",
        helpData: { description: "desc", subcommands: [] },
      });

      const insertCall = mockDb.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO"),
      );
      expect(insertCall).toBeDefined();
    });

    it("should throw if tool already registered without --force", () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ id: "existing-id" })),
        run: vi.fn(),
      }));

      expect(() =>
        registerTool(mockDb, "test", {
          command: "cli-anything-test",
          helpData: { description: "desc", subcommands: [] },
        }),
      ).toThrow("already registered");
    });

    it("should update DB record when --force is used", () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ id: "existing-id" })),
        run: vi.fn(),
      }));

      registerTool(mockDb, "test", {
        command: "cli-anything-test",
        helpData: { description: "desc", subcommands: [] },
        force: true,
      });

      const updateCall = mockDb.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE"),
      );
      expect(updateCall).toBeDefined();
    });

    it("should return skill metadata", () => {
      const result = registerTool(mockDb, "gimp", {
        command: "cli-anything-gimp",
        helpData: {
          description: "GIMP CLI",
          subcommands: [{ name: "project", description: "Projects" }],
        },
      });

      expect(result.skillName).toBe("cli-anything-gimp");
      expect(result.dir).toContain("cli-anything-gimp");
      expect(result.subcommands).toHaveLength(1);
    });
  });

  /* ----- removeTool ----- */
  describe("removeTool", () => {
    it("should delete skill directory and DB record", () => {
      const mockDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({ id: "clia-test-123" })),
          run: vi.fn(),
        })),
      };
      _deps.fs = { rmSync: vi.fn() };
      _deps.path = { join: (...args) => args.join("/") };

      const result = removeTool(mockDb, "test");
      expect(result.removed).toBe(true);
      expect(result.toolName).toBe("test");
      expect(_deps.fs.rmSync).toHaveBeenCalledTimes(1);
    });

    it("should throw if tool not registered", () => {
      const mockDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => null),
          run: vi.fn(),
        })),
      };

      expect(() => removeTool(mockDb, "nope")).toThrow("not registered");
    });

    it("should succeed even if skill directory is already gone", () => {
      const mockDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({ id: "id" })),
          run: vi.fn(),
        })),
      };
      _deps.fs = {
        rmSync: vi.fn(() => {
          throw new Error("ENOENT");
        }),
      };
      _deps.path = { join: (...args) => args.join("/") };

      expect(() => removeTool(mockDb, "gone")).not.toThrow();
    });
  });

  /* ----- listTools ----- */
  describe("listTools", () => {
    it("should return all tools from DB", () => {
      const mockTools = [
        {
          id: "1",
          name: "gimp",
          skill_name: "cli-anything-gimp",
          status: "registered",
        },
        {
          id: "2",
          name: "blender",
          skill_name: "cli-anything-blender",
          status: "registered",
        },
      ];
      const mockDb = {
        prepare: vi.fn(() => ({
          all: vi.fn(() => mockTools),
        })),
      };

      const result = listTools(mockDb);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("gimp");
    });

    it("should return empty array when no tools registered", () => {
      const mockDb = {
        prepare: vi.fn(() => ({
          all: vi.fn(() => []),
        })),
      };

      const result = listTools(mockDb);
      expect(result).toHaveLength(0);
    });
  });
});
