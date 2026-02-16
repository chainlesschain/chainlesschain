/**
 * UnifiedToolRegistry Unit Tests
 * Tests: unified-tool-registry.js, tool-skill-mapper.js, mcp-skill-generator.js
 *
 * Covers:
 * - Tool import from FunctionCaller
 * - MCP tool import and skill generation
 * - Skill import from SkillRegistry
 * - ToolSkillMapper auto-grouping
 * - Name normalization
 * - Search and filtering
 * - MCP server connect/disconnect events
 * - Context Engineering skill serialization
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock crypto for context-engineering
vi.mock("crypto", () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => "mocked-hash"),
    })),
  },
}));

describe("ToolSkillMapper", () => {
  let ToolSkillMapper;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod =
      await import("../../../src/main/ai-engine/tool-skill-mapper.js");
    ToolSkillMapper = mod.ToolSkillMapper;
  });

  it("should create an instance", () => {
    const mapper = new ToolSkillMapper();
    expect(mapper).toBeDefined();
    expect(mapper.groups.length).toBeGreaterThan(0);
  });

  it("should group tools by regex patterns", () => {
    const mapper = new ToolSkillMapper();
    const tools = [
      { name: "file_reader" },
      { name: "file_writer" },
      { name: "git_status" },
      { name: "git_diff" },
      { name: "image_resize" },
      { name: "tts_generate" },
    ];
    const result = mapper.mapTools(tools);

    expect(result.length).toBeGreaterThanOrEqual(4);

    const fileGroup = result.find((r) => r.skill.name === "file-operations");
    expect(fileGroup).toBeDefined();
    expect(fileGroup.skill.toolNames).toContain("file_reader");
    expect(fileGroup.skill.toolNames).toContain("file_writer");

    const gitGroup = result.find((r) => r.skill.name === "git-operations");
    expect(gitGroup).toBeDefined();
    expect(gitGroup.skill.toolNames).toContain("git_status");
  });

  it("should skip tools that do not match any group", () => {
    const mapper = new ToolSkillMapper();
    const tools = [{ name: "unknown_tool_xyz" }];
    const result = mapper.mapTools(tools);

    expect(result.length).toBe(0);
  });

  it("should include instructions and examples in generated skills", () => {
    const mapper = new ToolSkillMapper();
    const tools = [{ name: "git_status" }];
    const result = mapper.mapTools(tools);

    const gitGroup = result.find((r) => r.skill.name === "git-operations");
    expect(gitGroup.skill.instructions).toBeTruthy();
    expect(gitGroup.skill.examples.length).toBeGreaterThan(0);
    expect(gitGroup.skill.source).toBe("tool-group");
  });
});

describe("MCPSkillGenerator", () => {
  let MCPSkillGenerator;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../../src/main/mcp/mcp-skill-generator.js");
    MCPSkillGenerator = mod.MCPSkillGenerator;
  });

  it("should create an instance", () => {
    const gen = new MCPSkillGenerator();
    expect(gen).toBeDefined();
  });

  it("should generate skill from MCP server with catalog entry", () => {
    const gen = new MCPSkillGenerator();
    const catalogEntry = {
      displayName: "File System",
      category: "filesystem",
      description: "File system access",
      version: "1.0.0",
      skillCategory: "filesystem",
      skillInstructions: "Use for file operations.",
      skillExamples: [
        { input: "Read file", tool: "read_file", params: { path: "test.txt" } },
      ],
      tags: ["file"],
    };
    const tools = [
      {
        toolId: "mcp_filesystem_read_file",
        originalToolName: "read_file",
        description: "Read",
      },
      {
        toolId: "mcp_filesystem_write_file",
        originalToolName: "write_file",
        description: "Write",
      },
    ];

    const skill = gen.generateSkillFromMCPServer(
      "filesystem",
      catalogEntry,
      tools,
    );

    expect(skill.name).toBe("mcp-filesystem");
    expect(skill.displayName).toBe("File System");
    expect(skill.category).toBe("filesystem");
    expect(skill.instructions).toBe("Use for file operations.");
    expect(skill.examples).toHaveLength(1);
    expect(skill.toolNames).toHaveLength(2);
    expect(skill.source).toBe("mcp-auto");
  });

  it("should auto-generate instructions when catalog has none", () => {
    const gen = new MCPSkillGenerator();
    const tools = [
      {
        toolId: "mcp_custom_do_thing",
        originalToolName: "do_thing",
        description: "Does a thing",
      },
    ];

    const skill = gen.generateSkillFromMCPServer("custom", null, tools);

    expect(skill.name).toBe("mcp-custom");
    expect(skill.displayName).toBe("custom (MCP)");
    expect(skill.instructions).toContain("do_thing");
    expect(skill.instructions).toContain("Does a thing");
  });

  it("should auto-generate examples from inputSchema", () => {
    const gen = new MCPSkillGenerator();
    const tools = [
      {
        toolId: "mcp_test_action",
        originalToolName: "action",
        description: "Test action",
        inputSchema: {
          properties: {
            name: { type: "string" },
            count: { type: "number" },
            enabled: { type: "boolean" },
          },
        },
      },
    ];

    const skill = gen.generateSkillFromMCPServer("test", null, tools);

    expect(skill.examples.length).toBeGreaterThan(0);
    const ex = skill.examples[0];
    expect(ex.params).toBeDefined();
  });
});

describe("UnifiedToolRegistry", () => {
  let UnifiedToolRegistry;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod =
      await import("../../../src/main/ai-engine/unified-tool-registry.js");
    UnifiedToolRegistry = mod.UnifiedToolRegistry;
  });

  describe("Name normalization", () => {
    it("should replace hyphens with underscores", () => {
      const registry = new UnifiedToolRegistry();
      expect(registry._normalizeToolName("browser-click")).toBe(
        "browser_click",
      );
      expect(registry._normalizeToolName("mcp_fs_read")).toBe("mcp_fs_read");
      expect(registry._normalizeToolName("a-b-c")).toBe("a_b_c");
    });

    it("should return empty string for falsy input", () => {
      const registry = new UnifiedToolRegistry();
      expect(registry._normalizeToolName(null)).toBe("");
      expect(registry._normalizeToolName(undefined)).toBe("");
      expect(registry._normalizeToolName("")).toBe("");
    });
  });

  describe("FunctionCaller binding", () => {
    it("should import tools from FunctionCaller", async () => {
      const registry = new UnifiedToolRegistry();

      const mockFC = {
        getAllToolDefinitions: () => [
          {
            name: "file_reader",
            description: "Read files",
            parameters: { path: { type: "string" } },
          },
          {
            name: "browser-click",
            description: "Click element",
            parameters: {},
          },
        ],
        isToolAvailable: () => true,
      };

      registry.bindFunctionCaller(mockFC);
      await registry.initialize();

      expect(registry.tools.size).toBeGreaterThanOrEqual(2);
      expect(registry.tools.has("file_reader")).toBe(true);
      expect(registry.tools.has("browser_click")).toBe(true); // normalized

      const tool = registry.tools.get("file_reader");
      expect(tool.source).toBe("builtin");
      expect(tool.description).toBe("Read files");
    });
  });

  describe("SkillRegistry binding", () => {
    it("should import skills and link tools", async () => {
      const registry = new UnifiedToolRegistry();

      const mockFC = {
        getAllToolDefinitions: () => [
          { name: "browser_click", description: "Click", parameters: {} },
          { name: "browser_navigate", description: "Navigate", parameters: {} },
        ],
        isToolAvailable: () => true,
      };

      const mockSR = {
        getAllSkills: () => [
          {
            skillId: "browser-automation",
            name: "Browser Automation",
            description: "Automate browser",
            category: "automation",
            version: "1.0.0",
            tools: ["browser-click", "browser-navigate"], // hyphenated refs
            instructions: "Use browser-navigate first.",
            examples: [{ input: "Open Google", tool: "browser_navigate" }],
            tags: ["browser"],
          },
        ],
      };

      registry.bindFunctionCaller(mockFC);
      registry.bindSkillRegistry(mockSR);
      await registry.initialize();

      // Check skill was imported
      expect(registry.skills.has("browser-automation")).toBe(true);
      const skill = registry.skills.get("browser-automation");
      expect(skill.displayName).toBe("Browser Automation");
      expect(skill.toolNames).toContain("browser_click"); // normalized

      // Check tools were linked to skill
      const tool = registry.tools.get("browser_click");
      expect(tool.skillName).toBe("browser-automation");
      expect(tool.skillCategory).toBe("automation");
      expect(tool.instructions).toBe("Use browser-navigate first.");
    });
  });

  describe("Search", () => {
    it("should search tools by name", async () => {
      const registry = new UnifiedToolRegistry();

      const mockFC = {
        getAllToolDefinitions: () => [
          { name: "file_reader", description: "Read files", parameters: {} },
          { name: "git_status", description: "Git status", parameters: {} },
        ],
        isToolAvailable: () => true,
      };

      registry.bindFunctionCaller(mockFC);
      await registry.initialize();

      const results = registry.searchTools("file");
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("file_reader");
    });

    it("should return all tools when keyword is empty", async () => {
      const registry = new UnifiedToolRegistry();

      const mockFC = {
        getAllToolDefinitions: () => [
          { name: "tool_a", description: "A", parameters: {} },
          { name: "tool_b", description: "B", parameters: {} },
        ],
        isToolAvailable: () => true,
      };

      registry.bindFunctionCaller(mockFC);
      await registry.initialize();

      const results = registry.searchTools("");
      expect(results.length).toBe(2);
    });
  });

  describe("getToolContext", () => {
    it("should return tool and skill context", async () => {
      const registry = new UnifiedToolRegistry();

      const mockFC = {
        getAllToolDefinitions: () => [
          { name: "browser_click", description: "Click", parameters: {} },
        ],
        isToolAvailable: () => true,
      };

      const mockSR = {
        getAllSkills: () => [
          {
            skillId: "browser-automation",
            name: "Browser Automation",
            description: "Automate",
            category: "automation",
            tools: ["browser-click"],
            instructions: "Use wisely.",
            examples: [],
            tags: [],
          },
        ],
      };

      registry.bindFunctionCaller(mockFC);
      registry.bindSkillRegistry(mockSR);
      await registry.initialize();

      const ctx = registry.getToolContext("browser_click");
      expect(ctx).toBeDefined();
      expect(ctx.tool.name).toBe("browser_click");
      expect(ctx.skill.name).toBe("browser-automation");
    });

    it("should return null for unknown tool", async () => {
      const registry = new UnifiedToolRegistry();
      await registry.initialize();

      const ctx = registry.getToolContext("nonexistent");
      expect(ctx).toBeNull();
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", async () => {
      const registry = new UnifiedToolRegistry();

      const mockFC = {
        getAllToolDefinitions: () => [
          { name: "tool_a", description: "A", parameters: {} },
          { name: "tool_b", description: "B", parameters: {} },
        ],
        isToolAvailable: () => true,
      };

      registry.bindFunctionCaller(mockFC);
      await registry.initialize();

      const stats = registry.getStats();
      expect(stats.totalTools).toBe(2);
      expect(stats.bySource.builtin).toBe(2);
    });
  });

  describe("getToolsBySkill", () => {
    it("should return tools for a given skill", async () => {
      const registry = new UnifiedToolRegistry();

      const mockFC = {
        getAllToolDefinitions: () => [
          { name: "git_status", description: "Status", parameters: {} },
          { name: "git_diff", description: "Diff", parameters: {} },
          { name: "file_reader", description: "Read", parameters: {} },
        ],
        isToolAvailable: () => true,
      };

      registry.bindFunctionCaller(mockFC);
      await registry.initialize();

      // After auto-grouping, git tools should be in git-operations
      const gitTools = registry.getToolsBySkill("git-operations");
      expect(gitTools.length).toBe(2);
      expect(gitTools.every((t) => t.name.startsWith("git_"))).toBe(true);
    });

    it("should return empty array for unknown skill", async () => {
      const registry = new UnifiedToolRegistry();
      await registry.initialize();

      const tools = registry.getToolsBySkill("nonexistent");
      expect(tools).toEqual([]);
    });
  });

  describe("MCP server events", () => {
    it("should handle server unregistration with normalized names", async () => {
      const registry = new UnifiedToolRegistry();

      // Manually add some MCP tools
      registry.tools.set("mcp_brave_search_web_search", {
        name: "mcp_brave_search_web_search",
        source: "mcp",
        skillName: null,
        available: true,
      });
      registry.skills.set("mcp-brave-search", { name: "mcp-brave-search" });
      registry._initialized = true;

      registry._onMCPServerUnregistered("brave-search");

      // Tool should be removed (prefix normalized to mcp_brave_search_)
      expect(registry.tools.has("mcp_brave_search_web_search")).toBe(false);
      expect(registry.skills.has("mcp-brave-search")).toBe(false);
    });
  });

  describe("getSkillManifest", () => {
    it("should return all skills", async () => {
      const registry = new UnifiedToolRegistry();

      const mockFC = {
        getAllToolDefinitions: () => [
          { name: "git_status", description: "Status", parameters: {} },
        ],
        isToolAvailable: () => true,
      };

      registry.bindFunctionCaller(mockFC);
      await registry.initialize();

      const manifest = registry.getSkillManifest();
      expect(Array.isArray(manifest)).toBe(true);
      // Should have at least git-operations from auto-grouping
      const gitSkill = manifest.find((s) => s.name === "git-operations");
      expect(gitSkill).toBeDefined();
    });
  });
});

describe("ContextEngineering Skill Integration", () => {
  let ContextEngineering;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../../src/main/llm/context-engineering.js");
    ContextEngineering = mod.ContextEngineering;
  });

  it("should serialize tools with skill context when unifiedRegistry provided", () => {
    const ce = new ContextEngineering();

    const mockRegistry = {
      getSkillManifest: () => [
        {
          name: "file-ops",
          displayName: "File Operations",
          description: "File tools",
          instructions: "Read before write.",
          examples: [
            {
              input: "Read file",
              tool: "file_reader",
              params: { path: "a.txt" },
            },
          ],
          toolNames: ["file_reader"],
        },
      ],
      getAllTools: () => [
        {
          name: "file_reader",
          description: "Read a file",
          parameters: { path: { type: "string" } },
          available: true,
          skillName: "file-ops",
        },
      ],
      skills: new Map([["file-ops", {}]]),
    };

    const result = ce.buildOptimizedPrompt({
      systemPrompt: "System",
      messages: [],
      tools: [],
      unifiedRegistry: mockRegistry,
    });

    const toolMsg = result.messages.find((m) =>
      m.content.includes("Available Tools"),
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain("File Operations");
    expect(toolMsg.content).toContain("Read before write.");
    expect(toolMsg.content).toContain("file_reader");
  });

  it("should fall back to regular serialization without unifiedRegistry", () => {
    const ce = new ContextEngineering();

    const result = ce.buildOptimizedPrompt({
      systemPrompt: "System",
      messages: [],
      tools: [{ name: "test_tool", description: "A tool", parameters: {} }],
    });

    const toolMsg = result.messages.find((m) =>
      m.content.includes("Available Tools"),
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain("test_tool");
    expect(toolMsg.content).not.toContain("by Skill");
  });

  it("should include ungrouped tools in Other Tools section", () => {
    const ce = new ContextEngineering();

    const mockRegistry = {
      getSkillManifest: () => [],
      getAllTools: () => [
        {
          name: "orphan_tool",
          description: "No skill",
          parameters: {},
          available: true,
          skillName: null,
        },
      ],
      skills: new Map([["dummy", {}]]), // non-empty to trigger the branch
    };

    const result = ce.buildOptimizedPrompt({
      systemPrompt: "System",
      messages: [],
      tools: [],
      unifiedRegistry: mockRegistry,
    });

    const toolMsg = result.messages.find((m) =>
      m.content.includes("Available Tools"),
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain("Other Tools");
    expect(toolMsg.content).toContain("orphan_tool");
  });

  it("should truncate long instructions", () => {
    const ce = new ContextEngineering();

    const longInstructions = "A".repeat(300);
    const mockRegistry = {
      getSkillManifest: () => [
        {
          name: "long-skill",
          displayName: "Long Skill",
          description: "Has long instructions",
          instructions: longInstructions,
          examples: [],
          toolNames: ["tool_x"],
        },
      ],
      getAllTools: () => [
        {
          name: "tool_x",
          description: "X",
          parameters: {},
          available: true,
          skillName: "long-skill",
        },
      ],
      skills: new Map([["long-skill", {}]]),
    };

    const result = ce.buildOptimizedPrompt({
      systemPrompt: "System",
      messages: [],
      tools: [],
      unifiedRegistry: mockRegistry,
    });

    const toolMsg = result.messages.find((m) =>
      m.content.includes("Available Tools"),
    );
    // Should be truncated to 200 chars + '...'
    expect(toolMsg.content).toContain("...");
    expect(toolMsg.content).not.toContain("A".repeat(300));
  });

  it("should limit examples to 3 per skill", () => {
    const ce = new ContextEngineering();

    const examples = Array.from({ length: 10 }, (_, i) => ({
      input: `Example ${i}`,
      tool: `tool_${i}`,
    }));

    const mockRegistry = {
      getSkillManifest: () => [
        {
          name: "many-examples",
          displayName: "Many Examples",
          description: "Test",
          instructions: "Test",
          examples,
          toolNames: ["tool_0"],
        },
      ],
      getAllTools: () => [
        {
          name: "tool_0",
          description: "T",
          parameters: {},
          available: true,
          skillName: "many-examples",
        },
      ],
      skills: new Map([["many-examples", {}]]),
    };

    const result = ce.buildOptimizedPrompt({
      systemPrompt: "System",
      messages: [],
      tools: [],
      unifiedRegistry: mockRegistry,
    });

    const toolMsg = result.messages.find((m) =>
      m.content.includes("Available Tools"),
    );
    // Should contain examples 0, 1, 2 but not 3+
    expect(toolMsg.content).toContain("Example 0");
    expect(toolMsg.content).toContain("Example 2");
    expect(toolMsg.content).not.toContain("Example 3");
  });
});

describe("Community Registry Enrichment", () => {
  it("should have skillInstructions/skillExamples/skillCategory for all 8 servers", async () => {
    const { BUILTIN_CATALOG } =
      await import("../../../src/main/mcp/community-registry.js");

    expect(BUILTIN_CATALOG.length).toBe(8);

    for (const entry of BUILTIN_CATALOG) {
      expect(entry.skillInstructions).toBeTruthy();
      expect(entry.skillExamples).toBeDefined();
      expect(Array.isArray(entry.skillExamples)).toBe(true);
      expect(entry.skillExamples.length).toBeGreaterThan(0);
      expect(entry.skillCategory).toBeTruthy();
    }
  });
});

// ==========================================
// E2E Integration: Full AI Conversation Flow
// ==========================================

describe("E2E: UnifiedToolRegistry → ManusOptimizations → ContextEngineering", () => {
  let UnifiedToolRegistry, ManusOptimizations;

  beforeEach(async () => {
    vi.clearAllMocks();
    const regMod =
      await import("../../../src/main/ai-engine/unified-tool-registry.js");
    UnifiedToolRegistry = regMod.UnifiedToolRegistry;
    const manusMod =
      await import("../../../src/main/llm/manus-optimizations.js");
    ManusOptimizations = manusMod.ManusOptimizations;
  });

  it("should inject skill context into LLM prompt when registry is bound", async () => {
    // 1. Create UnifiedToolRegistry with FunctionCaller + SkillRegistry
    const registry = new UnifiedToolRegistry();

    const mockFC = {
      getAllToolDefinitions: () => [
        {
          name: "browser_click",
          description: "Click an element",
          parameters: { selector: { type: "string" } },
        },
        {
          name: "browser_navigate",
          description: "Navigate to URL",
          parameters: { url: { type: "string" } },
        },
        {
          name: "file_reader",
          description: "Read a file",
          parameters: { path: { type: "string" } },
        },
      ],
      isToolAvailable: () => true,
    };

    const mockSR = {
      getAllSkills: () => [
        {
          skillId: "browser-automation",
          name: "Browser Automation",
          description: "Automate browser actions",
          category: "automation",
          instructions: "Use browser_navigate first, then browser_click.",
          examples: [
            {
              input: "Open Baidu",
              tool: "browser_navigate",
              params: { url: "https://baidu.com" },
            },
          ],
          tools: ["browser-click", "browser-navigate"],
          tags: ["browser"],
          version: "1.0.0",
        },
      ],
    };

    registry.bindFunctionCaller(mockFC);
    registry.bindSkillRegistry(mockSR);
    await registry.initialize();

    // Verify tools are linked to skills
    const ctx = registry.getToolContext("browser_click");
    expect(ctx).toBeDefined();
    expect(ctx.tool.skillName).toBe("browser-automation");
    expect(ctx.skill).toBeDefined();
    expect(ctx.skill.instructions).toContain("browser_navigate first");

    // 2. Create ManusOptimizations and bind the registry
    const manus = new ManusOptimizations({
      enableKVCacheOptimization: true,
      enableToolMasking: false,
      enableTaskTracking: false,
    });

    manus.bindUnifiedRegistry(registry);
    expect(manus.unifiedRegistry).toBe(registry);

    // 3. Build optimized prompt — simulates what happens during AI conversation
    const result = manus.buildOptimizedPrompt({
      systemPrompt: "You are an AI assistant.",
      messages: [{ role: "user", content: "帮我打开百度搜索" }],
      tools: [],
    });

    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);

    // 4. Verify skill context is in the LLM prompt
    const toolMsg = result.messages.find((m) =>
      m.content?.includes("Available Tools"),
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain("by Skill");
    expect(toolMsg.content).toContain("Browser Automation");
    expect(toolMsg.content).toContain("browser_navigate first");
    expect(toolMsg.content).toContain("browser_click");
    expect(toolMsg.content).toContain("Open Baidu");

    // 5. Verify ungrouped tools also appear
    expect(toolMsg.content).toContain("file_reader");
  });

  it("should fall back to tool list when registry has no skills", async () => {
    const manus = new ManusOptimizations({
      enableKVCacheOptimization: true,
      enableToolMasking: false,
      enableTaskTracking: false,
    });

    // No registry bound — should use plain tool definitions
    const result = manus.buildOptimizedPrompt({
      systemPrompt: "System",
      messages: [],
      tools: [{ name: "my_tool", description: "A tool", parameters: {} }],
    });

    const toolMsg = result.messages.find((m) =>
      m.content?.includes("Available Tools"),
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain("my_tool");
    expect(toolMsg.content).not.toContain("by Skill");
  });

  it("should handle concurrent initialize() calls safely", async () => {
    const registry = new UnifiedToolRegistry();
    const mockFC = {
      getAllToolDefinitions: () => [
        { name: "tool_a", description: "A", parameters: {} },
      ],
      isToolAvailable: () => true,
    };
    registry.bindFunctionCaller(mockFC);

    // Call initialize() concurrently — should not corrupt state
    const [r1, r2, r3] = await Promise.all([
      registry.initialize(),
      registry.initialize(),
      registry.initialize(),
    ]);

    // All should resolve without error
    expect(registry._initialized).toBe(true);
    expect(registry.tools.size).toBe(1);
  });

  it("should handle MCPSkillGenerator empty tool names gracefully", async () => {
    const { MCPSkillGenerator } =
      await import("../../../src/main/mcp/mcp-skill-generator.js");
    const gen = new MCPSkillGenerator();

    // Tool with no toolId, name, or originalToolName
    const skill = gen.generateSkillFromMCPServer("test", null, [
      { toolId: "", name: "", originalToolName: "" },
      { toolId: "mcp_test_valid", name: "valid", originalToolName: "valid" },
    ]);

    // Empty tool name should be filtered out
    expect(skill.toolNames).not.toContain("");
    expect(skill.toolNames).toContain("mcp_test_valid");
  });
});
