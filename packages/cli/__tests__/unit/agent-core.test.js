import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock plan-mode, skill-loader, hook-manager before importing agent-core
vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn().mockImplementation(() => ({
    getResolvedSkills: vi.fn(() => [
      {
        id: "code-review",
        dirName: "code-review",
        category: "development",
        source: "bundled",
        hasHandler: true,
        description: "Review code for quality",
        skillDir: "/fake/skills/code-review",
      },
      {
        id: "summarize",
        dirName: "summarize",
        category: "productivity",
        source: "bundled",
        hasHandler: false,
        description: "Summarize text",
        skillDir: "/fake/skills/summarize",
      },
    ]),
  })),
}));

vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

const {
  AGENT_TOOLS,
  getBaseSystemPrompt,
  formatToolArgs,
  executeTool,
  chatWithTools,
  agentLoop,
} = await import("../../src/lib/agent-core.js");

const { getPlanModeManager } = await import("../../src/lib/plan-mode.js");

describe("AGENT_TOOLS", () => {
  it("has 9 tool definitions", () => {
    expect(AGENT_TOOLS).toHaveLength(9);
  });

  it("each tool has type 'function' and function.name", () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.type).toBe("function");
      expect(typeof tool.function.name).toBe("string");
      expect(tool.function.name.length).toBeGreaterThan(0);
    }
  });

  it("includes expected tool names", () => {
    const names = AGENT_TOOLS.map((t) => t.function.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("run_shell");
    expect(names).toContain("search_files");
    expect(names).toContain("list_dir");
    expect(names).toContain("run_skill");
    expect(names).toContain("list_skills");
    expect(names).toContain("run_code");
  });
});

describe("getBaseSystemPrompt", () => {
  it("includes provided cwd", () => {
    const prompt = getBaseSystemPrompt("/my/project");
    expect(prompt).toContain("/my/project");
    expect(prompt).toContain("Current working directory:");
  });

  it("includes default cwd when none specified", () => {
    const prompt = getBaseSystemPrompt();
    expect(prompt).toContain("Current working directory:");
    expect(prompt).toContain(process.cwd());
  });
});

describe("formatToolArgs", () => {
  it("formats read_file as path", () => {
    expect(formatToolArgs("read_file", { path: "src/index.js" })).toBe(
      "src/index.js",
    );
  });

  it("formats write_file as path with size", () => {
    const result = formatToolArgs("write_file", {
      path: "out.txt",
      content: "hello",
    });
    expect(result).toBe("out.txt (5 chars)");
  });

  it("formats edit_file as path", () => {
    expect(formatToolArgs("edit_file", { path: "foo.js" })).toBe("foo.js");
  });

  it("formats run_shell as command", () => {
    expect(formatToolArgs("run_shell", { command: "ls -la" })).toBe("ls -la");
  });

  it("formats search_files as pattern", () => {
    expect(formatToolArgs("search_files", { pattern: "*.js" })).toBe("*.js");
  });

  it("formats list_dir as path or default", () => {
    expect(formatToolArgs("list_dir", { path: "src" })).toBe("src");
    expect(formatToolArgs("list_dir", {})).toBe(".");
  });

  it("formats run_skill with name and input", () => {
    const result = formatToolArgs("run_skill", {
      skill_name: "code-review",
      input: "Review this function",
    });
    expect(result).toContain("code-review");
    expect(result).toContain("Review this function");
  });

  it("formats list_skills with category or query or all", () => {
    expect(formatToolArgs("list_skills", { category: "dev" })).toBe("dev");
    expect(formatToolArgs("list_skills", { query: "review" })).toBe("review");
    expect(formatToolArgs("list_skills", {})).toBe("all");
  });

  it("formats run_code with language and code length", () => {
    const result = formatToolArgs("run_code", {
      language: "python",
      code: "print(1)",
    });
    expect(result).toBe("python (8 chars)");
  });

  it("formats unknown tool as truncated JSON", () => {
    const result = formatToolArgs("unknown_tool", { foo: "bar" });
    expect(result).toContain("foo");
  });
});

describe("executeTool", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-agent-core-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("read_file returns content", async () => {
    const filePath = join(tempDir, "test.txt");
    writeFileSync(filePath, "hello world", "utf8");

    const result = await executeTool(
      "read_file",
      { path: "test.txt" },
      { cwd: tempDir },
    );
    expect(result.content).toBe("hello world");
  });

  it("read_file returns error for missing file", async () => {
    const result = await executeTool(
      "read_file",
      { path: "nonexistent.txt" },
      { cwd: tempDir },
    );
    expect(result.error).toContain("File not found");
  });

  it("write_file creates file", async () => {
    const result = await executeTool(
      "write_file",
      { path: "new.txt", content: "created" },
      { cwd: tempDir },
    );
    expect(result.success).toBe(true);
    expect(readFileSync(join(tempDir, "new.txt"), "utf8")).toBe("created");
  });

  it("edit_file replaces content", async () => {
    const filePath = join(tempDir, "edit-me.txt");
    writeFileSync(filePath, "foo bar baz", "utf8");

    const result = await executeTool(
      "edit_file",
      { path: "edit-me.txt", old_string: "bar", new_string: "qux" },
      { cwd: tempDir },
    );
    expect(result.success).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe("foo qux baz");
  });

  it("edit_file returns error when old_string not found", async () => {
    const filePath = join(tempDir, "edit-me.txt");
    writeFileSync(filePath, "foo bar", "utf8");

    const result = await executeTool(
      "edit_file",
      { path: "edit-me.txt", old_string: "missing", new_string: "x" },
      { cwd: tempDir },
    );
    expect(result.error).toContain("old_string not found");
  });

  it("list_dir returns entries", async () => {
    writeFileSync(join(tempDir, "a.txt"), "a", "utf8");
    fs.mkdirSync(join(tempDir, "subdir"));

    const result = await executeTool(
      "list_dir",
      { path: "." },
      { cwd: tempDir },
    );
    expect(result.entries).toBeDefined();
    const names = result.entries.map((e) => e.name);
    expect(names).toContain("a.txt");
    expect(names).toContain("subdir");

    const dirEntry = result.entries.find((e) => e.name === "subdir");
    expect(dirEntry.type).toBe("dir");
  });

  it("list_dir returns error for missing dir", async () => {
    const result = await executeTool(
      "list_dir",
      { path: "no-such-dir" },
      { cwd: tempDir },
    );
    expect(result.error).toContain("Directory not found");
  });

  it("run_shell returns stdout", async () => {
    const result = await executeTool(
      "run_shell",
      { command: "echo hello-agent-core" },
      { cwd: tempDir },
    );
    expect(result.stdout).toContain("hello-agent-core");
  });

  it("run_shell returns error on failure", async () => {
    const result = await executeTool(
      "run_shell",
      { command: "exit 1" },
      { cwd: tempDir },
    );
    expect(result.error).toBeDefined();
    expect(result.exitCode).toBe(1);
  });

  it("run_code with node language", async () => {
    const result = await executeTool(
      "run_code",
      { language: "node", code: 'console.log("from-node")' },
      { cwd: tempDir },
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("from-node");
    expect(result.language).toBe("node");
  });

  it("run_code cleans up temp file", async () => {
    const osTmpDir = tmpdir();
    const beforeFiles = fs
      .readdirSync(osTmpDir)
      .filter((f) => f.startsWith("cc-agent-"));

    await executeTool(
      "run_code",
      { language: "node", code: 'console.log("cleanup-test")' },
      { cwd: tempDir },
    );

    const afterFiles = fs
      .readdirSync(osTmpDir)
      .filter((f) => f.startsWith("cc-agent-"));
    // Should not have accumulated temp files
    expect(afterFiles.length).toBeLessThanOrEqual(beforeFiles.length);
  });

  it("search_files returns matches", async () => {
    writeFileSync(join(tempDir, "findme.js"), "content", "utf8");
    const result = await executeTool(
      "search_files",
      { pattern: "findme" },
      { cwd: tempDir },
    );
    // Should have files or matches array (platform-dependent)
    expect(result.files || result.matches).toBeDefined();
  });

  it("list_skills returns skill list", async () => {
    const result = await executeTool("list_skills", {}, { cwd: tempDir });
    expect(result.count).toBeGreaterThan(0);
    expect(result.skills).toBeInstanceOf(Array);
    expect(result.skills[0]).toHaveProperty("id");
    expect(result.skills[0]).toHaveProperty("category");
  });

  it("unknown tool returns error", async () => {
    const result = await executeTool("nonexistent_tool", {}, { cwd: tempDir });
    expect(result.error).toContain("Unknown tool");
  });

  it("respects plan mode blocking", async () => {
    getPlanModeManager.mockReturnValueOnce({
      isActive: () => true,
      isToolAllowed: () => false,
      addPlanItem: vi.fn(),
    });

    const result = await executeTool(
      "write_file",
      { path: "blocked.txt", content: "x" },
      { cwd: tempDir },
    );
    expect(result.error).toContain("Plan Mode");
    expect(result.error).toContain("blocked");
  });
});

describe("chatWithTools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws on unsupported provider", async () => {
    await expect(
      chatWithTools([{ role: "user", content: "hi" }], {
        provider: "nonexistent-provider",
        model: "test",
        baseUrl: null,
        apiKey: null,
      }),
    ).rejects.toThrow("Unsupported provider");
  });
});

describe("agentLoop", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("yields response-complete when no tool calls", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: "assistant",
          content: "Hello! How can I help?",
        },
      }),
    });

    const messages = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("response-complete");
    expect(events[0].content).toBe("Hello! How can I help?");
  });

  it("yields tool-executing and tool-result events", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call: LLM wants to call list_dir
        return {
          ok: true,
          json: async () => ({
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "list_dir",
                    arguments: JSON.stringify({ path: "." }),
                  },
                },
              ],
            },
          }),
        };
      }
      // Second call: LLM gives final answer
      return {
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "Done listing.",
          },
        }),
      };
    });

    const messages = [{ role: "user", content: "List current directory" }];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
    })) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("tool-executing");
    expect(types).toContain("tool-result");
    expect(types).toContain("response-complete");

    const execEvent = events.find((e) => e.type === "tool-executing");
    expect(execEvent.tool).toBe("list_dir");
  });

  it("respects MAX_ITERATIONS", async () => {
    // Always return tool calls so it hits the limit
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-loop",
              type: "function",
              function: {
                name: "list_dir",
                arguments: JSON.stringify({ path: "." }),
              },
            },
          ],
        },
      }),
    });

    const messages = [{ role: "user", content: "Loop forever" }];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
    })) {
      events.push(event);
    }

    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe("response-complete");
    expect(lastEvent.content).toContain("max tool call iterations");

    // Should have 15 iterations * 2 events (executing + result) + 1 final
    const executingCount = events.filter(
      (e) => e.type === "tool-executing",
    ).length;
    expect(executingCount).toBe(15);
  });
});
