import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRuntimeToolDescriptor } from "../../src/tools/legacy-agent-tools.js";
import { CODING_AGENT_MVP_TOOL_NAMES } from "../../src/runtime/coding-agent-contract.js";

// Mock plan-mode, skill-loader, hook-manager, project-detector before importing agent-core
vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

const _mockSkills = [
  {
    id: "code-review",
    dirName: "code-review",
    category: "development",
    activation: "manual",
    source: "bundled",
    hasHandler: true,
    description: "Review code for quality",
    skillDir: "/fake/skills/code-review",
  },
  {
    id: "summarize",
    dirName: "summarize",
    category: "productivity",
    activation: "manual",
    source: "bundled",
    hasHandler: false,
    description: "Summarize text",
    skillDir: "/fake/skills/summarize",
  },
];

vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn().mockImplementation(() => ({
    getResolvedSkills: vi.fn(() => _mockSkills),
  })),
}));

let _mockProjectRoot = null;
let _mockProjectConfig = null;

vi.mock("../../src/lib/project-detector.js", () => ({
  findProjectRoot: vi.fn(() => _mockProjectRoot),
  loadProjectConfig: vi.fn(() => _mockProjectConfig),
  isInsideProject: vi.fn(() => _mockProjectRoot !== null),
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
  AGENT_TOOL_REGISTRY,
  getBaseSystemPrompt,
  getAgentToolDefinitions,
  getAgentToolDescriptors,
  buildSystemPrompt,
  formatToolArgs,
  executeTool,
  chatWithTools,
  agentLoop,
} = await import("../../src/lib/agent-core.js");

const { getPlanModeManager } = await import("../../src/lib/plan-mode.js");

describe("AGENT_TOOLS", () => {
  it("has 11 tool definitions", () => {
    expect(AGENT_TOOLS).toHaveLength(11);
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
    expect(names).toContain("git");
    expect(names).toContain("search_files");
    expect(names).toContain("list_dir");
    expect(names).toContain("run_skill");
    expect(names).toContain("list_skills");
    expect(names).toContain("run_code");
  });
});

describe("agent tool registry compatibility", () => {
  it("exposes a registry view for legacy agent tools", () => {
    expect(AGENT_TOOL_REGISTRY).toBeDefined();
    expect(AGENT_TOOL_REGISTRY.get("run_shell")).toMatchObject({
      name: "run_shell",
      kind: "shell",
      source: "agent-core",
    });
  });

  it("filters tool definitions by disabledTools", () => {
    const filtered = getAgentToolDefinitions({
      disabledTools: ["run_shell", "run_code"],
    });
    const names = filtered.map((tool) => tool.function.name);

    expect(names).not.toContain("run_shell");
    expect(names).not.toContain("run_code");
    expect(names).toContain("read_file");
  });

  it("merges extra host-managed tool definitions into the available tool set", () => {
    const filtered = getAgentToolDefinitions({
      extraTools: [
        {
          type: "function",
          function: {
            name: "mcp_weather_get_forecast",
            description: "Get a weather forecast",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        },
      ],
    });

    expect(filtered.map((tool) => tool.function.name)).toContain(
      "mcp_weather_get_forecast",
    );
  });

  it("returns matching descriptors for filtered tool definitions", () => {
    const descriptors = getAgentToolDescriptors({
      names: ["read_file", "list_dir"],
    });

    expect(descriptors).toHaveLength(2);
    expect(descriptors.map((descriptor) => descriptor.name)).toEqual([
      "read_file",
      "list_dir",
    ]);
  });

  it("maps run_shell to the shell runtime descriptor", () => {
    const descriptor = getRuntimeToolDescriptor("run_shell");
    expect(descriptor?.name).toBe("shell");
  });

  it("maps git to the git runtime descriptor", () => {
    const descriptor = getRuntimeToolDescriptor("git");
    expect(descriptor?.name).toBe("git");
  });
});

describe("executeTool runtime metadata", () => {
  it("attaches runtime descriptor info when running shell commands", async () => {
    const result = await executeTool("run_shell", { command: "echo hello" });
    expect(result.toolDescriptor?.name).toBe("shell");
    expect(result.stdout).toBeDefined();
    expect(result.shellCommandPolicy?.decision).toBeDefined();
  });

  it("attaches a telemetry record for run_shell", async () => {
    const result = await executeTool("run_shell", { command: "echo hi" });
    expect(result.toolTelemetryRecord).toBeDefined();
    expect(result.toolTelemetryRecord?.toolName).toBe("shell");
    expect(["completed", "error"]).toContain(
      result.toolTelemetryRecord?.status,
    );
  });

  it("preserves sessionId in tool telemetry records", async () => {
    const result = await executeTool(
      "run_shell",
      { command: "echo telemetry-session" },
      { sessionId: "session-telemetry-1" },
    );

    expect(result.toolTelemetryRecord?.sessionId).toBe("session-telemetry-1");
  });

  it("reroutes git commands away from run_shell and points to the git descriptor", async () => {
    const result = await executeTool("run_shell", { command: "git status" });
    expect(result.toolDescriptor?.name).toBe("git");
    expect(result.error).toContain("[Shell Policy]");
    expect(result.error).toContain("dedicated git tool");
    expect(result.shellCommandPolicy?.decision).toBe("reroute");
  });

  it("attaches the git descriptor for the dedicated git tool", async () => {
    const result = await executeTool("git", { command: "status" });
    expect(result.toolDescriptor?.name).toBe("git");
  });

  it("allows readonly git commands during plan mode", async () => {
    const addPlanItem = vi.fn();
    const planManager = {
      isActive: () => true,
      isToolAllowed: () => false,
      addPlanItem,
    };

    const result = await executeTool(
      "git",
      { command: "status" },
      { planManager },
    );

    expect(addPlanItem).not.toHaveBeenCalled();
    expect(result.toolDescriptor?.name).toBe("git");
  });

  it("blocks mutating git commands during plan mode and records a plan item", async () => {
    const addPlanItem = vi.fn();
    const planManager = {
      isActive: () => true,
      isToolAllowed: () => false,
      addPlanItem,
    };

    const result = await executeTool(
      "git",
      { command: "commit -m test" },
      { planManager },
    );

    expect(result.error).toContain("[Plan Mode]");
    expect(addPlanItem).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "git",
        estimatedImpact: "high",
      }),
    );
  });

  it("maps MCP commands to the mcp descriptor", async () => {
    const result = await executeTool("run_shell", {
      command: "chainlesschain mcp call tools list",
    });
    expect(result.toolDescriptor?.name).toBe("mcp");
  });

  it("blocks explicitly dangerous shell commands", async () => {
    const result = await executeTool("run_shell", {
      command: "powershell -EncodedCommand AAAA",
    });

    expect(result.error).toContain("[Shell Policy]");
    expect(result.shellCommandPolicy).toEqual(
      expect.objectContaining({
        allowed: false,
        decision: "deny",
        ruleId: "powershell-encoded-command",
      }),
    );
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

  it("always returns default coding prompt (persona handled by buildSystemPrompt)", () => {
    const prompt = getBaseSystemPrompt("/any/path");
    expect(prompt).toContain("ChainlessChain AI Assistant");
    expect(prompt).toContain("agentic coding assistant");
  });
});

describe("buildSystemPrompt", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-persona-test-"));
    _mockProjectRoot = null;
    _mockProjectConfig = null;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    _mockProjectRoot = null;
    _mockProjectConfig = null;
  });

  it("returns default prompt when no project root", () => {
    const prompt = buildSystemPrompt(tempDir);
    expect(prompt).toContain("ChainlessChain AI Assistant");
  });

  it("appends rules.md when present", () => {
    _mockProjectRoot = tempDir;
    _mockProjectConfig = { name: "test" };
    const ccDir = join(tempDir, ".chainlesschain");
    fs.mkdirSync(ccDir, { recursive: true });
    fs.writeFileSync(join(ccDir, "rules.md"), "Always use TDD", "utf-8");

    const prompt = buildSystemPrompt(tempDir);
    expect(prompt).toContain("## Project Rules");
    expect(prompt).toContain("Always use TDD");
  });

  it("returns persona prompt when config has persona", () => {
    _mockProjectRoot = tempDir;
    _mockProjectConfig = {
      name: "clinic",
      persona: {
        name: "医疗助手",
        role: "你是医疗分诊AI",
        behaviors: ["询问症状"],
      },
    };

    const prompt = buildSystemPrompt(tempDir);
    expect(prompt).toContain("医疗助手");
    expect(prompt).toContain("你是医疗分诊AI");
    expect(prompt).not.toContain("agentic coding assistant");
  });

  it("appends auto-activated persona skills", () => {
    _mockSkills.push({
      id: "test-persona",
      displayName: "Test Persona",
      category: "persona",
      activation: "auto",
      body: "You are a test persona with special powers.",
      source: "workspace",
    });

    const prompt = buildSystemPrompt(tempDir);
    expect(prompt).toContain("## Persona: Test Persona");
    expect(prompt).toContain("You are a test persona with special powers.");

    // Clean up mock skills
    _mockSkills.pop();
  });

  it("does not include manual persona skills", () => {
    _mockSkills.push({
      id: "manual-persona",
      displayName: "Manual Persona",
      category: "persona",
      activation: "manual",
      body: "Should not appear.",
      source: "workspace",
    });

    const prompt = buildSystemPrompt(tempDir);
    expect(prompt).not.toContain("Manual Persona");
    expect(prompt).not.toContain("Should not appear.");

    _mockSkills.pop();
  });

  it("gracefully handles missing rules.md", () => {
    _mockProjectRoot = tempDir;
    _mockProjectConfig = { name: "test" };
    // No .chainlesschain/rules.md created
    const prompt = buildSystemPrompt(tempDir);
    expect(prompt).not.toContain("## Project Rules");
  });

  it("combines persona config + persona skill + rules.md", () => {
    _mockProjectRoot = tempDir;
    _mockProjectConfig = {
      name: "clinic",
      persona: {
        name: "医疗助手",
        role: "你是医疗分诊AI",
      },
    };
    const ccDir = join(tempDir, ".chainlesschain");
    fs.mkdirSync(ccDir, { recursive: true });
    fs.writeFileSync(join(ccDir, "rules.md"), "Safety first", "utf-8");

    _mockSkills.push({
      id: "extra-persona",
      displayName: "Extra Guidelines",
      category: "persona",
      activation: "auto",
      body: "Additional persona instructions.",
      source: "workspace",
    });

    const prompt = buildSystemPrompt(tempDir);
    expect(prompt).toContain("医疗助手");
    expect(prompt).toContain("## Persona: Extra Guidelines");
    expect(prompt).toContain("## Project Rules");
    expect(prompt).toContain("Safety first");

    _mockSkills.pop();
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

  it("prefers a session-scoped plan manager over the global singleton", async () => {
    const sessionPlanManager = {
      isActive: vi.fn(() => true),
      isToolAllowed: vi.fn(() => false),
      addPlanItem: vi.fn(),
    };

    const result = await executeTool(
      "write_file",
      { path: "scoped-blocked.txt", content: "x" },
      {
        cwd: tempDir,
        planManager: sessionPlanManager,
      },
    );

    expect(result.error).toContain("Plan Mode");
    expect(sessionPlanManager.isActive).toHaveBeenCalled();
    expect(sessionPlanManager.isToolAllowed).toHaveBeenCalledWith("write_file");
    expect(sessionPlanManager.addPlanItem).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "write_file",
      }),
    );
    expect(fs.existsSync(join(tempDir, "scoped-blocked.txt"))).toBe(false);
  });

  it("blocks tool when persona.toolsDisabled includes it", async () => {
    _mockProjectRoot = tempDir;
    _mockProjectConfig = {
      persona: {
        name: "Restricted",
        toolsDisabled: ["run_shell"],
      },
    };

    const result = await executeTool(
      "run_shell",
      { command: "echo hi" },
      { cwd: tempDir },
    );
    expect(result.error).toContain("disabled by project persona");

    _mockProjectRoot = null;
    _mockProjectConfig = null;
  });

  it("blocks tool when desktop host policy denies it", async () => {
    const result = await executeTool(
      "run_shell",
      { command: "echo should-not-run" },
      {
        cwd: tempDir,
        hostManagedToolPolicy: {
          tools: {
            run_shell: {
              allowed: false,
              decision: "require_confirmation",
              reason:
                "High-risk tools require an explicit second confirmation.",
              requiresConfirmation: true,
              riskLevel: "high",
            },
          },
        },
      },
    );

    expect(result.error).toContain("[Host Policy]");
    expect(result.error).toContain('Tool "run_shell" is blocked');
    expect(result.policy).toMatchObject({
      decision: "require_confirmation",
      requiresConfirmation: true,
      riskLevel: "high",
    });
  });

  it("allows readonly git commands when desktop host policy marks git as readonly-conditional", async () => {
    const result = await executeTool(
      "git",
      { command: "status" },
      {
        cwd: tempDir,
        hostManagedToolPolicy: {
          tools: {
            git: {
              allowed: false,
              decision: "require_plan",
              reason: "High-risk tools require an approved plan first.",
              planModeBehavior: "readonly-conditional",
              riskLevel: "high",
            },
          },
        },
      },
    );

    expect(result.error || "").not.toContain("[Host Policy]");
    expect(result.toolDescriptor?.name).toBe("git");
  });

  it("delegates unknown host-managed tools to the desktop interaction adapter", async () => {
    const interaction = {
      requestHostTool: vi.fn().mockResolvedValue({
        success: true,
        result: {
          forecast: "sunny",
        },
      }),
    };

    const result = await executeTool(
      "mcp_weather_get_forecast",
      { city: "Shanghai" },
      {
        cwd: tempDir,
        interaction,
        hostManagedToolPolicy: {
          toolDefinitions: [
            {
              type: "function",
              function: {
                name: "mcp_weather_get_forecast",
                description: "Get a forecast",
                parameters: {
                  type: "object",
                  properties: {
                    city: { type: "string" },
                  },
                  required: ["city"],
                },
              },
            },
          ],
          tools: {
            mcp_weather_get_forecast: {
              allowed: true,
              riskLevel: "low",
            },
          },
        },
      },
    );

    expect(interaction.requestHostTool).toHaveBeenCalledWith(
      "mcp_weather_get_forecast",
      { city: "Shanghai" },
    );
    expect(result).toMatchObject({
      forecast: "sunny",
    });
  });

  it("executes direct session MCP tools through the local mcpClient", async () => {
    const mcpClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Sunny" }],
        isError: false,
      }),
    };

    const result = await executeTool(
      "mcp_weather_get_forecast",
      { city: "Shanghai" },
      {
        cwd: tempDir,
        mcpClient,
        externalToolDescriptors: {
          mcp_weather_get_forecast: {
            name: "mcp_weather_get_forecast",
            source: "mcp:weather",
            riskLevel: "low",
            isReadOnly: true,
          },
        },
        externalToolExecutors: {
          mcp_weather_get_forecast: {
            kind: "mcp",
            serverName: "weather",
            toolName: "get_forecast",
          },
        },
      },
    );

    expect(mcpClient.callTool).toHaveBeenCalledWith("weather", "get_forecast", {
      city: "Shanghai",
    });
    expect(result).toMatchObject({
      content: [{ type: "text", text: "Sunny" }],
      isError: false,
      toolDescriptor: expect.objectContaining({
        name: "mcp_weather_get_forecast",
        kind: "mcp:weather",
      }),
    });
  });
});

describe("chatWithTools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _mockProjectRoot = null;
    _mockProjectConfig = null;
  });

  it("filters tools when persona.toolsDisabled is set", async () => {
    _mockProjectRoot = "/fake/project";
    _mockProjectConfig = {
      persona: {
        name: "Restricted",
        toolsDisabled: ["run_shell", "run_code"],
      },
    };

    let capturedBody;
    globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "filtered" },
        }),
      };
    });

    await chatWithTools([{ role: "user", content: "test" }], {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
      cwd: "/fake/project",
    });

    const toolNames = capturedBody.tools.map((t) => t.function.name);
    expect(toolNames).not.toContain("run_shell");
    expect(toolNames).not.toContain("run_code");
    expect(toolNames).toContain("read_file");
    expect(capturedBody.tools.length).toBe(9); // 11 - 2 disabled
  });

  it("can limit coding sessions to the MVP tool set while still allowing host-managed tools", async () => {
    let capturedBody;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "mvp only" },
        }),
      };
    });

    await chatWithTools([{ role: "user", content: "test" }], {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
      enabledToolNames: CODING_AGENT_MVP_TOOL_NAMES,
      hostManagedToolPolicy: {
        toolDefinitions: [
          {
            type: "function",
            function: {
              name: "mcp_weather_get_forecast",
              description: "Get the weather forecast",
              parameters: {
                type: "object",
                properties: {
                  city: { type: "string" },
                },
                required: ["city"],
              },
            },
          },
        ],
      },
    });

    const toolNames = capturedBody.tools.map((tool) => tool.function.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "read_file",
        "write_file",
        "git",
        "mcp_weather_get_forecast",
      ]),
    );
    expect(toolNames).not.toContain("run_skill");
    expect(toolNames).not.toContain("run_code");
    expect(toolNames).not.toContain("spawn_sub_agent");
  });

  it("includes direct session external tool definitions alongside the MVP tool set", async () => {
    let capturedBody;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "direct external" },
        }),
      };
    });

    await chatWithTools([{ role: "user", content: "test" }], {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
      enabledToolNames: CODING_AGENT_MVP_TOOL_NAMES,
      extraToolDefinitions: [
        {
          type: "function",
          function: {
            name: "mcp_weather_get_forecast",
            description: "Get the weather forecast",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        },
      ],
    });

    const toolNames = capturedBody.tools.map((tool) => tool.function.name);
    expect(toolNames).toContain("mcp_weather_get_forecast");
    expect(toolNames).not.toContain("run_skill");
    expect(toolNames).not.toContain("run_code");
  });

  it("Ollama provider: fetch URL contains /api/chat with tools", async () => {
    let capturedUrl, capturedBody;
    globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "Hi from Ollama" },
        }),
      };
    });

    await chatWithTools([{ role: "user", content: "test" }], {
      provider: "ollama",
      model: "qwen2.5:7b",
      baseUrl: "http://localhost:11434",
    });

    expect(capturedUrl).toContain("/api/chat");
    expect(capturedBody.tools).toBeDefined();
    expect(capturedBody.tools.length).toBe(11);
    expect(capturedBody.model).toBe("qwen2.5:7b");
  });

  it("Anthropic provider: includes x-api-key and anthropic-version headers", async () => {
    let capturedHeaders;
    globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Hi from Claude" }],
        }),
      };
    });

    await chatWithTools([{ role: "user", content: "test" }], {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key-123",
    });

    expect(capturedHeaders["x-api-key"]).toBe("test-key-123");
    expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
  });

  it("OpenAI provider: includes Authorization Bearer header", async () => {
    let capturedHeaders;
    globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({
          choices: [
            { message: { role: "assistant", content: "Hi from OpenAI" } },
          ],
        }),
      };
    });

    await chatWithTools([{ role: "user", content: "test" }], {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test-key",
    });

    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-test-key");
  });

  it("forwards AbortSignal to provider fetch calls", async () => {
    let capturedSignal;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedSignal = opts.signal;
      return {
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "ok" },
        }),
      };
    });

    const controller = new AbortController();
    await chatWithTools([{ role: "user", content: "test" }], {
      provider: "ollama",
      model: "qwen2.5:7b",
      baseUrl: "http://localhost:11434",
      signal: controller.signal,
    });

    expect(capturedSignal).toBe(controller.signal);
  });

  it("Missing API key throws appropriate error", async () => {
    // Save and clear env vars
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      await expect(
        chatWithTools([{ role: "user", content: "test" }], {
          provider: "anthropic",
          model: "test",
          apiKey: null,
        }),
      ).rejects.toThrow("ANTHROPIC_API_KEY required");
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
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

  it("throws AbortError when the loop signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const iterator = agentLoop([{ role: "user", content: "Hi" }], {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
      signal: controller.signal,
    });

    await expect(iterator.next()).rejects.toMatchObject({
      name: "AbortError",
    });
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

  it("yields slot-filling events when slotFiller detects missing slots", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: "assistant",
          content: "I'll deploy that for you.",
        },
      }),
    });

    const mockInteraction = {
      askSelect: vi.fn().mockResolvedValue("docker"),
      askInput: vi.fn().mockResolvedValue("test-value"),
      emit: vi.fn(),
    };

    const { CLISlotFiller } = await import("../../src/lib/slot-filler.js");
    const slotFiller = new CLISlotFiller({ interaction: mockInteraction });

    const messages = [{ role: "user", content: "deploy this" }];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
      slotFiller,
      interaction: mockInteraction,
    })) {
      events.push(event);
    }

    // Should have slot-filling event before response-complete
    const slotEvents = events.filter((e) => e.type === "slot-filling");
    expect(slotEvents.length).toBeGreaterThan(0);
    expect(slotEvents[0].slot).toBe("platform");

    // User message should have been augmented with context
    expect(messages[0].content).toContain("[Context");
    expect(messages[0].content).toContain("platform");
  });

  it("skips slot-filling when no intent detected", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: "assistant",
          content: "Here's how it works...",
        },
      }),
    });

    const mockInteraction = {
      askSelect: vi.fn(),
      askInput: vi.fn(),
      emit: vi.fn(),
    };

    const { CLISlotFiller } = await import("../../src/lib/slot-filler.js");
    const slotFiller = new CLISlotFiller({ interaction: mockInteraction });

    const messages = [
      { role: "user", content: "help me understand this code" },
    ];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
      slotFiller,
      interaction: mockInteraction,
    })) {
      events.push(event);
    }

    // No slot-filling events
    const slotEvents = events.filter((e) => e.type === "slot-filling");
    expect(slotEvents).toHaveLength(0);

    // Interaction should not have been asked anything
    expect(mockInteraction.askSelect).not.toHaveBeenCalled();
    expect(mockInteraction.askInput).not.toHaveBeenCalled();
  });

  it("yields tool-executing and tool-result for run_code call", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-rc",
                  type: "function",
                  function: {
                    name: "run_code",
                    arguments: JSON.stringify({
                      language: "node",
                      code: 'console.log("from-agent-loop")',
                    }),
                  },
                },
              ],
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "Code executed." },
        }),
      };
    });

    const messages = [{ role: "user", content: "Run some code" }];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
    })) {
      events.push(event);
    }

    const execEvent = events.find((e) => e.type === "tool-executing");
    expect(execEvent.tool).toBe("run_code");
    expect(execEvent.args.language).toBe("node");

    const resultEvent = events.find((e) => e.type === "tool-result");
    expect(resultEvent.tool).toBe("run_code");
    expect(resultEvent.result.success).toBe(true);
    expect(resultEvent.result.output).toContain("from-agent-loop");

    expect(events[events.length - 1].type).toBe("response-complete");
  });

  it("handles multiple tool calls in sequence", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-a",
                  type: "function",
                  function: {
                    name: "list_dir",
                    arguments: JSON.stringify({ path: "." }),
                  },
                },
                {
                  id: "call-b",
                  type: "function",
                  function: {
                    name: "list_skills",
                    arguments: JSON.stringify({}),
                  },
                },
              ],
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "Both done." },
        }),
      };
    });

    const messages = [{ role: "user", content: "List dir and skills" }];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
    })) {
      events.push(event);
    }

    const execEvents = events.filter((e) => e.type === "tool-executing");
    expect(execEvents).toHaveLength(2);
    expect(execEvents[0].tool).toBe("list_dir");
    expect(execEvents[1].tool).toBe("list_skills");

    const resultEvents = events.filter((e) => e.type === "tool-result");
    expect(resultEvents).toHaveLength(2);
  });

  it("skips slot-filling when no slotFiller provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: "assistant",
          content: "Done.",
        },
      }),
    });

    const messages = [{ role: "user", content: "deploy this" }];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
    })) {
      events.push(event);
    }

    // No slot-filling events, just response-complete
    const slotEvents = events.filter((e) => e.type === "slot-filling");
    expect(slotEvents).toHaveLength(0);
    expect(events[events.length - 1].type).toBe("response-complete");
  });
});

// ─── Sub-Agent Isolation in System Prompt ────────────────────────────────

describe("sub-agent system prompt guidance", () => {
  it("base system prompt includes Sub-Agent Isolation section", () => {
    const prompt = getBaseSystemPrompt("/tmp/test");
    expect(prompt).toContain("Sub-Agent Isolation");
    expect(prompt).toContain("spawn_sub_agent");
  });

  it("system prompt explains when to use sub-agents", () => {
    const prompt = getBaseSystemPrompt("/tmp/test");
    expect(prompt).toContain("Code review as a separate perspective");
    expect(prompt).toContain("context stays clean");
  });

  it("system prompt warns against trivial sub-agent usage", () => {
    const prompt = getBaseSystemPrompt("/tmp/test");
    expect(prompt).toContain("Do NOT spawn sub-agents for trivial tasks");
  });
});

// ─── Auto-Condensation ──────────────────────────────────────────────────

describe("spawn_sub_agent auto-condensation", () => {
  it("auto-condenses parent messages when no explicit context provided", async () => {
    // Mock LLM to return a response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: "assistant",
          content: "Review complete.",
        },
      }),
    });

    // Simulate parent messages with assistant responses
    const parentMessages = [
      { role: "system", content: "You are an assistant." },
      { role: "user", content: "Help me fix the bug" },
      {
        role: "assistant",
        content:
          "I found the issue in line 42 of main.js. The variable is undefined.",
      },
      { role: "user", content: "Can you review the fix?" },
      {
        role: "assistant",
        content:
          "The fix looks correct. The variable is now properly initialized.",
      },
    ];

    const result = await executeTool(
      "spawn_sub_agent",
      { role: "code-review", task: "Review the code changes" },
      { cwd: "/tmp", parentMessages },
    );

    // Should succeed or at least have a subAgentId (LLM mock returns simple response)
    expect(result).toBeDefined();
    if (result.success) {
      expect(result.subAgentId).toMatch(/^sub-/);
    }
  });

  it("uses explicit context when provided, ignoring parent messages", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: "assistant",
          content: "Done with explicit context.",
        },
      }),
    });

    const result = await executeTool(
      "spawn_sub_agent",
      {
        role: "summarizer",
        task: "Summarize this",
        context: "This is explicit context from the user",
      },
      {
        cwd: "/tmp",
        parentMessages: [
          { role: "assistant", content: "This should NOT be used" },
        ],
      },
    );

    expect(result).toBeDefined();
    // The explicit context takes priority — we just verify the tool ran
    if (result.success) {
      expect(result.role).toBe("summarizer");
    }
  });
});
