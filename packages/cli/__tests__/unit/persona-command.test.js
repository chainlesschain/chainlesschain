/**
 * Unit tests for persona command (show/set/reset)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock project-detector to control project root
let _mockProjectRoot = null;

vi.mock("../../src/lib/project-detector.js", () => ({
  findProjectRoot: vi.fn(() => _mockProjectRoot),
  loadProjectConfig: vi.fn(() => {
    if (!_mockProjectRoot) return null;
    try {
      const content = readFileSync(
        join(_mockProjectRoot, ".chainlesschain", "config.json"),
        "utf-8",
      );
      return JSON.parse(content);
    } catch {
      return null;
    }
  }),
  isInsideProject: vi.fn(() => _mockProjectRoot !== null),
}));

// Mock logger to capture output
const logMessages = [];
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    log: vi.fn((...args) => logMessages.push(args.join(" "))),
    error: vi.fn((...args) => logMessages.push(`ERROR: ${args.join(" ")}`)),
    success: vi.fn((...args) => logMessages.push(`SUCCESS: ${args.join(" ")}`)),
    warn: vi.fn(),
  },
}));

// Mock chalk to pass through strings
vi.mock("chalk", () => ({
  default: {
    bold: (s) => s,
    cyan: (s) => s,
    gray: (s) => s,
    red: (s) => s,
  },
}));

// Mock process.exit to throw instead
const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

const { Command } = await import("commander");
const { registerPersonaCommand } =
  await import("../../src/commands/persona.js");

function createProgram() {
  const program = new Command();
  program.exitOverride();
  registerPersonaCommand(program);
  return program;
}

describe("persona command", () => {
  let tempDir;
  let ccDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-persona-cmd-test-"));
    ccDir = join(tempDir, ".chainlesschain");
    mkdirSync(ccDir, { recursive: true });
    logMessages.length = 0;
    mockExit.mockClear();
  });

  afterEach(() => {
    _mockProjectRoot = null;
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── persona show ───────────────────────────────

  describe("persona show", () => {
    it("shows error when not inside a project", () => {
      _mockProjectRoot = null;
      const program = createProgram();
      expect(() =>
        program.parse(["node", "test", "persona", "show"]),
      ).toThrow();
      expect(logMessages.some((m) => m.includes("ERROR"))).toBe(true);
    });

    it("shows default message when no persona configured", () => {
      _mockProjectRoot = tempDir;
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({ name: "test" }),
        "utf-8",
      );

      const program = createProgram();
      program.parse(["node", "test", "persona", "show"]);
      expect(logMessages.some((m) => m.includes("No persona configured"))).toBe(
        true,
      );
    });

    it("shows persona details when configured", () => {
      _mockProjectRoot = tempDir;
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "clinic",
          persona: {
            name: "分诊助手",
            role: "你是医疗AI",
            behaviors: ["询问症状", "使用ESI"],
            toolsPriority: ["read_file"],
            toolsDisabled: ["run_shell"],
          },
        }),
        "utf-8",
      );

      const program = createProgram();
      program.parse(["node", "test", "persona", "show"]);
      expect(logMessages.some((m) => m.includes("分诊助手"))).toBe(true);
      expect(logMessages.some((m) => m.includes("你是医疗AI"))).toBe(true);
      expect(logMessages.some((m) => m.includes("询问症状"))).toBe(true);
      expect(logMessages.some((m) => m.includes("read_file"))).toBe(true);
      expect(logMessages.some((m) => m.includes("run_shell"))).toBe(true);
    });
  });

  // ─── persona set ────────────────────────────────

  describe("persona set", () => {
    it("shows error when not inside a project", () => {
      _mockProjectRoot = null;
      const program = createProgram();
      expect(() =>
        program.parse(["node", "test", "persona", "set", "--name", "Test"]),
      ).toThrow();
    });

    it("creates persona from scratch", () => {
      _mockProjectRoot = tempDir;
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({ name: "test" }),
        "utf-8",
      );

      const program = createProgram();
      program.parse([
        "node",
        "test",
        "persona",
        "set",
        "--name",
        "My Bot",
        "--role",
        "You are a helpful assistant",
      ]);

      const config = JSON.parse(
        readFileSync(join(ccDir, "config.json"), "utf-8"),
      );
      expect(config.persona.name).toBe("My Bot");
      expect(config.persona.role).toBe("You are a helpful assistant");
      expect(logMessages.some((m) => m.includes("SUCCESS"))).toBe(true);
    });

    it("updates existing persona fields", () => {
      _mockProjectRoot = tempDir;
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "test",
          persona: { name: "Old Name", role: "Old role" },
        }),
        "utf-8",
      );

      const program = createProgram();
      program.parse(["node", "test", "persona", "set", "--name", "New Name"]);

      const config = JSON.parse(
        readFileSync(join(ccDir, "config.json"), "utf-8"),
      );
      expect(config.persona.name).toBe("New Name");
      expect(config.persona.role).toBe("Old role"); // preserved
    });

    it("appends behaviors to existing ones", () => {
      _mockProjectRoot = tempDir;
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "test",
          persona: { behaviors: ["existing behavior"] },
        }),
        "utf-8",
      );

      const program = createProgram();
      program.parse(["node", "test", "persona", "set", "-b", "new behavior"]);

      const config = JSON.parse(
        readFileSync(join(ccDir, "config.json"), "utf-8"),
      );
      expect(config.persona.behaviors).toEqual([
        "existing behavior",
        "new behavior",
      ]);
    });

    it("sets toolsDisabled from comma-separated string", () => {
      _mockProjectRoot = tempDir;
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({ name: "test" }),
        "utf-8",
      );

      const program = createProgram();
      program.parse([
        "node",
        "test",
        "persona",
        "set",
        "--tools-disabled",
        "run_shell,run_code",
      ]);

      const config = JSON.parse(
        readFileSync(join(ccDir, "config.json"), "utf-8"),
      );
      expect(config.persona.toolsDisabled).toEqual(["run_shell", "run_code"]);
    });

    it("sets toolsPriority from comma-separated string", () => {
      _mockProjectRoot = tempDir;
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({ name: "test" }),
        "utf-8",
      );

      const program = createProgram();
      program.parse([
        "node",
        "test",
        "persona",
        "set",
        "--tools-priority",
        "read_file, search_files",
      ]);

      const config = JSON.parse(
        readFileSync(join(ccDir, "config.json"), "utf-8"),
      );
      expect(config.persona.toolsPriority).toEqual([
        "read_file",
        "search_files",
      ]);
    });
  });

  // ─── persona reset ──────────────────────────────

  describe("persona reset", () => {
    it("shows error when not inside a project", () => {
      _mockProjectRoot = null;
      const program = createProgram();
      expect(() =>
        program.parse(["node", "test", "persona", "reset"]),
      ).toThrow();
    });

    it("removes persona from config", () => {
      _mockProjectRoot = tempDir;
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({
          name: "test",
          persona: { name: "Doomed", role: "To be deleted" },
        }),
        "utf-8",
      );

      const program = createProgram();
      program.parse(["node", "test", "persona", "reset"]);

      const config = JSON.parse(
        readFileSync(join(ccDir, "config.json"), "utf-8"),
      );
      expect(config.persona).toBeUndefined();
      expect(logMessages.some((m) => m.includes("SUCCESS"))).toBe(true);
    });

    it("reports nothing to reset when no persona", () => {
      _mockProjectRoot = tempDir;
      writeFileSync(
        join(ccDir, "config.json"),
        JSON.stringify({ name: "test" }),
        "utf-8",
      );

      const program = createProgram();
      program.parse(["node", "test", "persona", "reset"]);

      expect(logMessages.some((m) => m.includes("Nothing to reset"))).toBe(
        true,
      );
    });
  });
});
