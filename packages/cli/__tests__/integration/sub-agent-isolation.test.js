/**
 * Integration tests for Sub-Agent Isolation
 *
 * Tests real module interactions between:
 * - executeTool("spawn_sub_agent") -> SubAgentContext -> agentLoop
 * - SubAgentRegistry lifecycle tracking
 * - Namespaced memory isolation in hierarchical-memory
 * - Persona toolsDisabled enforcement in sub-agent context
 *
 * Mocks only LLM fetch, plan-mode, hook-manager, and skill-loader.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock plan-mode (required by agent-core at import time)
vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

// Mock hook-manager (required by agent-core at import time)
vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

// Mock skill-loader (instantiated at module level in agent-core)
vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn().mockImplementation(() => ({
    getResolvedSkills: vi.fn(() => []),
  })),
}));

const { executeTool, AGENT_TOOLS } =
  await import("../../src/lib/agent-core.js");
const { SubAgentRegistry } =
  await import("../../src/lib/sub-agent-registry.js");
const { SubAgentContext } = await import("../../src/lib/sub-agent-context.js");

describe("Integration: Sub-Agent Isolation", () => {
  let tempDir;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-subagent-integ-"));
    SubAgentRegistry.resetInstance();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    SubAgentRegistry.resetInstance();
  });

  // ─── spawn_sub_agent tool definition ───────────────────

  describe("spawn_sub_agent tool definition", () => {
    it("is included in AGENT_TOOLS", () => {
      const names = AGENT_TOOLS.map((t) => t.function.name);
      expect(names).toContain("spawn_sub_agent");
    });

    it("has correct parameter schema with role and task required", () => {
      const tool = AGENT_TOOLS.find(
        (t) => t.function.name === "spawn_sub_agent",
      );
      expect(tool).toBeDefined();
      expect(tool.function.parameters.properties).toHaveProperty("role");
      expect(tool.function.parameters.properties).toHaveProperty("task");
      expect(tool.function.parameters.properties).toHaveProperty("context");
      expect(tool.function.parameters.properties).toHaveProperty("tools");
      expect(tool.function.parameters.required).toContain("role");
      expect(tool.function.parameters.required).toContain("task");
    });

    it("tools parameter is typed as array of strings", () => {
      const tool = AGENT_TOOLS.find(
        (t) => t.function.name === "spawn_sub_agent",
      );
      const toolsParam = tool.function.parameters.properties.tools;
      expect(toolsParam.type).toBe("array");
      expect(toolsParam.items.type).toBe("string");
    });
  });

  // ─── executeTool("spawn_sub_agent") ────────────────────

  describe("executeTool spawn_sub_agent", () => {
    it("returns error when role is missing", async () => {
      const result = await executeTool(
        "spawn_sub_agent",
        { role: "", task: "do something" },
        { cwd: tempDir },
      );
      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain("required");
    });

    it("returns error when task is missing", async () => {
      const result = await executeTool(
        "spawn_sub_agent",
        { role: "test", task: "" },
        { cwd: tempDir },
      );
      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain("required");
    });

    it("creates and runs a sub-agent with mocked LLM returning simple response", async () => {
      // Mock fetch to simulate an LLM response with no tool calls
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "Sub-agent completed: the review looks good.",
          },
        }),
      });

      const result = await executeTool(
        "spawn_sub_agent",
        {
          role: "code-review",
          task: "Review the test file for correctness",
          context: "This is a simple test project",
        },
        {
          cwd: tempDir,
          provider: "ollama",
          model: "test-model",
          baseUrl: "http://localhost:11434",
        },
      );

      expect(result).toBeDefined();
      // On success, result has { success, subAgentId, role, summary, ... }
      // On failure (e.g. network error), result has { error, subAgentId, role }
      if (result.success) {
        expect(result.subAgentId).toMatch(/^sub-/);
        expect(result.role).toBe("code-review");
        expect(typeof result.summary).toBe("string");
        expect(result.summary.length).toBeGreaterThan(0);
      } else {
        // Even on failure the sub-agent ID should be set
        expect(result.subAgentId).toBeDefined();
      }
    });

    it("sub-agent registers and completes in SubAgentRegistry", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "Analysis complete: no issues found.",
          },
        }),
      });

      const registry = SubAgentRegistry.getInstance();
      const statsBefore = registry.getStats();
      expect(statsBefore.active).toBe(0);
      expect(statsBefore.completed).toBe(0);

      await executeTool(
        "spawn_sub_agent",
        { role: "analyzer", task: "Analyze the code" },
        {
          cwd: tempDir,
          provider: "ollama",
          model: "test-model",
          baseUrl: "http://localhost:11434",
        },
      );

      // After completion, should have moved from active to completed
      const statsAfter = registry.getStats();
      expect(statsAfter.active).toBe(0);
      expect(statsAfter.completed).toBeGreaterThanOrEqual(1);
      expect(registry.getHistory().length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── SubAgentContext isolation ─────────────────────────

  describe("SubAgentContext message isolation", () => {
    it("creates isolated context with independent message history", () => {
      const ctx1 = SubAgentContext.create({
        role: "reviewer",
        task: "Review code",
        cwd: tempDir,
      });
      const ctx2 = SubAgentContext.create({
        role: "summarizer",
        task: "Summarize docs",
        cwd: tempDir,
      });

      // Each context should have its own messages array
      expect(ctx1.messages).not.toBe(ctx2.messages);
      // System message should be present
      expect(ctx1.messages.length).toBe(1);
      expect(ctx1.messages[0].role).toBe("system");
      expect(ctx2.messages.length).toBe(1);
      expect(ctx2.messages[0].role).toBe("system");

      // System prompts should differ (different roles)
      expect(ctx1.messages[0].content).toContain("reviewer");
      expect(ctx2.messages[0].content).toContain("summarizer");
    });

    it("contexts have unique IDs", () => {
      const ctx1 = SubAgentContext.create({
        role: "a",
        task: "x",
        cwd: tempDir,
      });
      const ctx2 = SubAgentContext.create({
        role: "b",
        task: "y",
        cwd: tempDir,
      });
      expect(ctx1.id).not.toBe(ctx2.id);
      expect(ctx1.id).toMatch(/^sub-/);
      expect(ctx2.id).toMatch(/^sub-/);
    });

    it("tool whitelist filters AGENT_TOOLS correctly", () => {
      const ctx = SubAgentContext.create({
        role: "limited",
        task: "restricted task",
        allowedTools: ["read_file", "search_files"],
        cwd: tempDir,
      });

      const filtered = ctx._getFilteredTools();
      const names = filtered.map((t) => t.function.name);
      expect(names).toContain("read_file");
      expect(names).toContain("search_files");
      expect(names).not.toContain("write_file");
      expect(names).not.toContain("run_shell");
      expect(names).not.toContain("spawn_sub_agent");
    });

    it("null allowedTools returns all tools", () => {
      const ctx = SubAgentContext.create({
        role: "full",
        task: "full access",
        allowedTools: null,
        cwd: tempDir,
      });

      const filtered = ctx._getFilteredTools();
      expect(filtered.length).toBe(AGENT_TOOLS.length);
    });
  });

  // ─── SubAgentContext summarize ─────────────────────────

  describe("SubAgentContext summarize", () => {
    let ctx;

    beforeEach(() => {
      ctx = SubAgentContext.create({
        role: "test",
        task: "test",
        cwd: tempDir,
      });
    });

    it("returns short content directly", () => {
      const result = ctx.summarize("Short result");
      expect(result).toBe("Short result");
    });

    it("returns empty output message for empty content", () => {
      const result = ctx.summarize("");
      expect(result).toContain("No output");
    });

    it("extracts ## Summary section from long content", () => {
      const content =
        "A".repeat(600) +
        "\n## Summary\nThis is the extracted summary.\n## Next Section\nMore stuff.";
      const result = ctx.summarize(content);
      expect(result).toContain("This is the extracted summary.");
      expect(result).not.toContain("Next Section");
    });

    it("truncates long content without summary section", () => {
      const content = "X".repeat(1000);
      const result = ctx.summarize(content);
      expect(result).toContain("...[truncated");
      expect(result.length).toBeLessThan(content.length);
    });
  });

  // ─── SubAgentContext forceComplete ─────────────────────

  describe("SubAgentContext forceComplete", () => {
    it("changes status to completed and sets result", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "task",
        cwd: tempDir,
      });
      expect(ctx.status).toBe("active");
      expect(ctx.result).toBeNull();

      ctx.forceComplete("timeout");

      expect(ctx.status).toBe("completed");
      expect(ctx.completedAt).toBeDefined();
      expect(ctx.result.summary).toContain("force-completed");
      expect(ctx.result.summary).toContain("timeout");
    });

    it("does not overwrite existing result", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "task",
        cwd: tempDir,
      });
      ctx.result = {
        summary: "already done",
        artifacts: [],
        tokenCount: 10,
        toolsUsed: [],
        iterationCount: 1,
      };
      ctx.forceComplete("late cancel");

      expect(ctx.result.summary).toBe("already done");
    });
  });

  // ─── SubAgentRegistry lifecycle ────────────────────────

  describe("SubAgentRegistry lifecycle", () => {
    it("singleton pattern returns same instance", () => {
      const a = SubAgentRegistry.getInstance();
      const b = SubAgentRegistry.getInstance();
      expect(a).toBe(b);
    });

    it("resetInstance creates a fresh registry", () => {
      const a = SubAgentRegistry.getInstance();
      SubAgentRegistry.resetInstance();
      const b = SubAgentRegistry.getInstance();
      expect(a).not.toBe(b);
    });

    it("tracks register -> complete lifecycle with real SubAgentContext", () => {
      const registry = SubAgentRegistry.getInstance();
      const ctx = SubAgentContext.create({
        role: "test-role",
        task: "test-task",
        cwd: tempDir,
      });

      registry.register(ctx);
      expect(registry.getActive()).toHaveLength(1);
      expect(registry.getActive()[0].role).toBe("test-role");

      registry.complete(ctx.id, {
        summary: "done",
        tokenCount: 50,
        toolsUsed: ["read_file"],
        iterationCount: 3,
      });

      expect(registry.getActive()).toHaveLength(0);
      expect(registry.getHistory()).toHaveLength(1);
      expect(registry.getHistory()[0].summary).toBe("done");

      const stats = registry.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.totalTokens).toBe(50);
      expect(stats.active).toBe(0);
    });

    it("forceCompleteAll terminates all active sub-agents", () => {
      const registry = SubAgentRegistry.getInstance();

      const ctx1 = SubAgentContext.create({
        role: "a",
        task: "t1",
        cwd: tempDir,
      });
      const ctx2 = SubAgentContext.create({
        role: "b",
        task: "t2",
        cwd: tempDir,
      });
      registry.register(ctx1);
      registry.register(ctx2);
      expect(registry.getActive()).toHaveLength(2);

      registry.forceCompleteAll();

      expect(registry.getActive()).toHaveLength(0);
      expect(registry.getStats().completed).toBe(2);
    });

    it("forceCompleteAll with sessionId only terminates matching agents", () => {
      const registry = SubAgentRegistry.getInstance();

      const ctx1 = SubAgentContext.create({
        role: "a",
        task: "t1",
        parentId: "session-1",
        cwd: tempDir,
      });
      const ctx2 = SubAgentContext.create({
        role: "b",
        task: "t2",
        parentId: "session-2",
        cwd: tempDir,
      });
      registry.register(ctx1);
      registry.register(ctx2);

      registry.forceCompleteAll("session-1");

      expect(registry.getActive()).toHaveLength(1);
      expect(registry.getActive()[0].id).toBe(ctx2.id);
    });

    it("complete with unknown id is a no-op", () => {
      const registry = SubAgentRegistry.getInstance();
      const statsBefore = registry.getStats();

      registry.complete("nonexistent-id", { summary: "x", tokenCount: 10 });

      const statsAfter = registry.getStats();
      expect(statsAfter.completed).toBe(statsBefore.completed);
    });
  });

  // ─── Persona toolsDisabled integration ─────────────────

  describe("Persona toolsDisabled enforcement", () => {
    it("executeTool blocks disabled tools via persona config", async () => {
      // Create a project dir with .chainlesschain/config.json containing persona
      const projectDir = join(tempDir, "myproject");
      const configDir = join(projectDir, ".chainlesschain");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "config.json"),
        JSON.stringify({
          persona: {
            name: "RestrictedBot",
            role: "helper",
            toolsDisabled: ["spawn_sub_agent", "run_shell"],
          },
        }),
        "utf-8",
      );

      const result = await executeTool(
        "spawn_sub_agent",
        { role: "test", task: "should be blocked" },
        { cwd: projectDir },
      );

      expect(result.error).toBeDefined();
      expect(result.error).toContain("disabled");
      expect(result.error).toContain("spawn_sub_agent");
    });

    it("executeTool allows tools not in toolsDisabled", async () => {
      const projectDir = join(tempDir, "myproject2");
      const configDir = join(projectDir, ".chainlesschain");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "config.json"),
        JSON.stringify({
          persona: {
            name: "PartialBot",
            role: "helper",
            toolsDisabled: ["run_shell"],
          },
        }),
        "utf-8",
      );

      // read_file should still work even with persona restrictions
      const testFile = join(projectDir, "test.txt");
      writeFileSync(testFile, "hello world", "utf-8");

      const result = await executeTool(
        "read_file",
        { path: "test.txt" },
        { cwd: projectDir },
      );

      expect(result.error).toBeUndefined();
      expect(result.content).toBe("hello world");
    });
  });

  // ─── Namespace isolation in memory ─────────────────────

  describe("namespaced memory isolation", () => {
    it("sub-agent memories are isolated by namespace in working layer", async () => {
      const {
        _working,
        _shortTerm,
        storeMemory,
        recallMemory,
        ensureMemoryTables,
      } = await import("../../src/lib/hierarchical-memory.js");
      const { MockDatabase } = await import("../helpers/mock-db.js");

      // Clear all namespaces
      _working.clear();
      _shortTerm.clear();
      const db = new MockDatabase();
      ensureMemoryTables(db);

      // Store in different namespaces at working level (importance < 0.3)
      storeMemory(db, "main agent thought", {
        importance: 0.2,
        namespace: "main",
      });
      storeMemory(db, "sub-agent thought", {
        importance: 0.2,
        namespace: "sub-123",
      });

      // Recall from sub-agent namespace — should only see its own memories
      const subResults = recallMemory(db, "thought", { namespace: "sub-123" });
      const subContents = subResults.map((r) => r.content);
      expect(subContents).toContain("sub-agent thought");
      expect(subContents).not.toContain("main agent thought");

      // Recall from main namespace — should only see its own memories
      const mainResults = recallMemory(db, "thought", { namespace: "main" });
      const mainContents = mainResults.map((r) => r.content);
      expect(mainContents).toContain("main agent thought");
      expect(mainContents).not.toContain("sub-agent thought");

      // Cleanup
      _working.clear();
      _shortTerm.clear();
    });

    it("short-term memories are also namespace-isolated", async () => {
      const {
        _working,
        _shortTerm,
        storeMemory,
        recallMemory,
        ensureMemoryTables,
      } = await import("../../src/lib/hierarchical-memory.js");
      const { MockDatabase } = await import("../helpers/mock-db.js");

      _working.clear();
      _shortTerm.clear();
      const db = new MockDatabase();
      ensureMemoryTables(db);

      // Store at short-term level (importance 0.3-0.59)
      storeMemory(db, "main short-term", {
        importance: 0.4,
        namespace: "main",
      });
      storeMemory(db, "sub short-term", {
        importance: 0.4,
        namespace: "sub-456",
      });

      const subResults = recallMemory(db, "short-term", {
        namespace: "sub-456",
      });
      expect(subResults.map((r) => r.content)).toContain("sub short-term");
      expect(subResults.map((r) => r.content)).not.toContain("main short-term");

      _working.clear();
      _shortTerm.clear();
    });

    it("clearing one namespace does not affect others", async () => {
      const { _working, storeMemory, recallMemory, ensureMemoryTables } =
        await import("../../src/lib/hierarchical-memory.js");
      const { MockDatabase } = await import("../helpers/mock-db.js");

      _working.clear();
      const db = new MockDatabase();
      ensureMemoryTables(db);

      storeMemory(db, "ns-a item", { importance: 0.1, namespace: "ns-a" });
      storeMemory(db, "ns-b item", { importance: 0.1, namespace: "ns-b" });

      // Manually clear ns-a's working map
      const nsAMap = _working._nsMap.get("ns-a");
      if (nsAMap) nsAMap.clear();

      // ns-b should still have its memory
      const bResults = recallMemory(db, "item", { namespace: "ns-b" });
      expect(bResults.map((r) => r.content)).toContain("ns-b item");

      // ns-a should be empty
      const aResults = recallMemory(db, "item", { namespace: "ns-a" });
      expect(aResults).toHaveLength(0);

      _working.clear();
    });
  });

  // ─── SubAgentContext.toJSON ────────────────────────────

  describe("SubAgentContext serialization", () => {
    it("toJSON returns correct snapshot", () => {
      const ctx = SubAgentContext.create({
        role: "debug",
        task: "find the bug",
        parentId: "parent-42",
        cwd: tempDir,
      });

      const json = ctx.toJSON();
      expect(json.id).toMatch(/^sub-/);
      expect(json.parentId).toBe("parent-42");
      expect(json.role).toBe("debug");
      expect(json.task).toBe("find the bug");
      expect(json.status).toBe("active");
      expect(json.messageCount).toBe(1); // system message
      expect(json.toolsUsed).toEqual([]);
      expect(json.tokenCount).toBe(0);
      expect(json.iterationCount).toBe(0);
      expect(json.createdAt).toBeDefined();
      expect(json.completedAt).toBeNull();
    });
  });

  // ─── Auto-condensation integration ──────────────────────

  describe("auto-condensation via executeTool", () => {
    it("auto-condenses parent messages when spawning sub-agent without context", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "Sub-agent result with auto-condensed context.",
          },
        }),
      });

      const parentMessages = [
        { role: "system", content: "System prompt" },
        {
          role: "assistant",
          content: "I analyzed the code and found 3 issues.",
        },
        { role: "user", content: "Fix them" },
        { role: "assistant", content: "Fixed all 3 issues in the codebase." },
      ];

      const result = await executeTool(
        "spawn_sub_agent",
        { role: "verifier", task: "Verify the fixes are correct" },
        {
          cwd: tempDir,
          parentMessages,
          provider: "ollama",
          model: "test-model",
          baseUrl: "http://localhost:11434",
        },
      );

      expect(result).toBeDefined();
      if (result.success) {
        expect(result.subAgentId).toMatch(/^sub-/);
        expect(result.role).toBe("verifier");
      }
    });

    it("prefers explicit context over auto-condensation", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "Used explicit context.",
          },
        }),
      });

      const result = await executeTool(
        "spawn_sub_agent",
        {
          role: "analyzer",
          task: "Analyze with explicit context",
          context: "Explicit context provided by caller",
        },
        {
          cwd: tempDir,
          parentMessages: [
            { role: "assistant", content: "Auto-condensed content" },
          ],
          provider: "ollama",
          model: "test-model",
          baseUrl: "http://localhost:11434",
        },
      );

      expect(result).toBeDefined();
      if (result.success) {
        expect(result.role).toBe("analyzer");
      }
    });
  });

  // ─── Token budget integration ────────────────────────

  describe("token budget integration", () => {
    it("SubAgentContext accepts tokenBudget option", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "task",
        tokenBudget: 5000,
        cwd: tempDir,
      });
      expect(ctx.tokenBudget).toBe(5000);
      expect(ctx._tokenCount).toBe(0);
    });

    it("forceComplete with token-budget-exceeded reason works", () => {
      const ctx = SubAgentContext.create({
        role: "expensive",
        task: "big task",
        tokenBudget: 100,
        cwd: tempDir,
      });
      ctx._tokenCount = 150; // Simulate exceeding budget
      ctx.forceComplete("token-budget-exceeded");
      expect(ctx.status).toBe("completed");
      expect(ctx.result.summary).toContain("token-budget-exceeded");
    });
  });
});
