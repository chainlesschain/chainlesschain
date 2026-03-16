import { describe, it, expect, beforeEach, vi } from "vitest";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";

describe("sub-agent-context", () => {
  // ─── Construction & Isolation ─────────────────────────────

  describe("create()", () => {
    it("creates a context with unique id", () => {
      const ctx = SubAgentContext.create({
        role: "reviewer",
        task: "Review code",
      });
      expect(ctx.id).toMatch(/^sub-/);
      expect(ctx.role).toBe("reviewer");
      expect(ctx.task).toBe("Review code");
      expect(ctx.status).toBe("active");
    });

    it("creates isolated messages array with system prompt", () => {
      const ctx = SubAgentContext.create({ role: "test", task: "Test task" });
      expect(ctx.messages).toHaveLength(1);
      expect(ctx.messages[0].role).toBe("system");
      expect(ctx.messages[0].content).toContain("Sub-Agent Role: test");
    });

    it("includes inherited context in system prompt", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "Task",
        inheritedContext: "Parent context info",
      });
      expect(ctx.messages[0].content).toContain("Parent Context");
      expect(ctx.messages[0].content).toContain("Parent context info");
    });

    it("each context has independent messages", () => {
      const ctx1 = SubAgentContext.create({ role: "a", task: "A" });
      const ctx2 = SubAgentContext.create({ role: "b", task: "B" });
      ctx1.messages.push({ role: "user", content: "hello from ctx1" });
      expect(ctx2.messages).toHaveLength(1); // Only system prompt
    });

    it("sets parentId when provided", () => {
      const ctx = SubAgentContext.create({
        role: "child",
        task: "task",
        parentId: "parent-123",
      });
      expect(ctx.parentId).toBe("parent-123");
    });

    it("defaults maxIterations to 8", () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      expect(ctx.maxIterations).toBe(8);
    });

    it("accepts custom maxIterations", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "task",
        maxIterations: 5,
      });
      expect(ctx.maxIterations).toBe(5);
    });
  });

  // ─── Tool Whitelist ──────────────────────────────────────

  describe("_getFilteredTools()", () => {
    it("returns all tools when allowedTools is null", () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      const tools = ctx._getFilteredTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it("filters tools based on whitelist", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "task",
        allowedTools: ["read_file", "list_dir"],
      });
      const tools = ctx._getFilteredTools();
      expect(
        tools.every((t) => ["read_file", "list_dir"].includes(t.function.name)),
      ).toBe(true);
    });

    it("returns empty array for non-matching whitelist", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "task",
        allowedTools: ["nonexistent_tool"],
      });
      const tools = ctx._getFilteredTools();
      expect(tools).toHaveLength(0);
    });
  });

  // ─── Summarization ───────────────────────────────────────

  describe("summarize()", () => {
    let ctx;

    beforeEach(() => {
      ctx = SubAgentContext.create({ role: "test", task: "task" });
    });

    it("returns empty message for empty content", () => {
      expect(ctx.summarize("")).toBe("(No output from sub-agent)");
      expect(ctx.summarize(null)).toBe("(No output from sub-agent)");
    });

    it("returns short content directly (strategy 1)", () => {
      const short = "This is a short result";
      expect(ctx.summarize(short)).toBe(short);
    });

    it("extracts ## Summary section (strategy 2)", () => {
      const content =
        "Some preamble text that is quite long and definitely over 500 chars ".repeat(
          10,
        ) +
        "\n\n## Summary\nThis is the extracted summary.\n\n## Details\nMore info here.";
      const result = ctx.summarize(content);
      expect(result).toContain("This is the extracted summary");
      expect(result).not.toContain("More info here");
    });

    it("extracts ## Result section (strategy 2)", () => {
      const content =
        "Long preamble ".repeat(50) +
        "\n\n## Result\nThe actual result.\n\n## Notes\nSome notes.";
      const result = ctx.summarize(content);
      expect(result).toContain("The actual result");
    });

    it("truncates long content without summary section (strategy 3)", () => {
      const long = "A".repeat(1000);
      const result = ctx.summarize(long);
      expect(result).toContain("...[truncated");
      expect(result.length).toBeLessThan(600);
    });
  });

  // ─── Force Complete ──────────────────────────────────────

  describe("forceComplete()", () => {
    it("transitions status to completed", () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      ctx.forceComplete("timeout");
      expect(ctx.status).toBe("completed");
      expect(ctx.completedAt).toBeTruthy();
    });

    it("sets result with reason", () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      ctx.forceComplete("session-closed");
      expect(ctx.result.summary).toContain("session-closed");
    });

    it("is idempotent on completed context", () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      ctx.status = "completed";
      ctx.result = { summary: "original" };
      ctx.forceComplete("double-force");
      expect(ctx.result.summary).toBe("original"); // not overwritten
    });
  });

  // ─── toJSON ──────────────────────────────────────────────

  describe("toJSON()", () => {
    it("returns serializable snapshot", () => {
      const ctx = SubAgentContext.create({
        role: "reviewer",
        task: "Review code",
        parentId: "parent-1",
      });
      const json = ctx.toJSON();
      expect(json.id).toMatch(/^sub-/);
      expect(json.role).toBe("reviewer");
      expect(json.parentId).toBe("parent-1");
      expect(json.status).toBe("active");
      expect(json.messageCount).toBe(1);
      expect(json).not.toHaveProperty("messages"); // messages not leaked
    });
  });

  // ─── Run (requires mocked agentLoop) ────────────────────

  describe("run()", () => {
    it("rejects when not active", async () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      ctx.status = "completed";
      await expect(ctx.run("do something")).rejects.toThrow("not active");
    });

    it("adds user message to isolated messages", async () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      // run() will fail without LLM, but we can check messages were added
      try {
        await ctx.run("user prompt");
      } catch (_err) {
        // Expected - no LLM available
      }
      const userMsgs = ctx.messages.filter((m) => m.role === "user");
      expect(userMsgs).toHaveLength(1);
      expect(userMsgs[0].content).toBe("user prompt");
    });
  });

  // ─── Context Engine Isolation ──────────────────────────

  describe("context engine isolation", () => {
    it("each context has its own contextEngine instance", () => {
      const ctx1 = SubAgentContext.create({ role: "a", task: "A" });
      const ctx2 = SubAgentContext.create({ role: "b", task: "B" });
      expect(ctx1.contextEngine).not.toBe(ctx2.contextEngine);
    });

    it("contextEngine scope matches sub-agent id and role", () => {
      const ctx = SubAgentContext.create({ role: "reviewer", task: "Review" });
      expect(ctx.contextEngine.scope).toBeTruthy();
      expect(ctx.contextEngine.scope.taskId).toBe(ctx.id);
      expect(ctx.contextEngine.scope.role).toBe("reviewer");
      expect(ctx.contextEngine.scope.parentObjective).toBe("Review");
    });
  });

  // ─── Summarize edge cases ──────────────────────────────

  describe("summarize() edge cases", () => {
    let ctx;

    beforeEach(() => {
      ctx = SubAgentContext.create({ role: "test", task: "task" });
    });

    it("extracts ## Conclusion section", () => {
      const content =
        "Long preamble ".repeat(50) +
        "\n\n## Conclusion\nThe conclusion is here.\n\n## Appendix\nExtra data.";
      const result = ctx.summarize(content);
      expect(result).toContain("The conclusion is here");
      expect(result).not.toContain("Extra data");
    });

    it("extracts ## Answer section", () => {
      const content =
        "Long preamble ".repeat(50) + "\n\n## Answer\n42 is the answer.";
      const result = ctx.summarize(content);
      expect(result).toContain("42 is the answer");
    });

    it("falls back to truncation when extracted section is too long", () => {
      const content =
        "Long preamble ".repeat(50) +
        "\n\n## Summary\n" +
        "Very detailed summary paragraph. ".repeat(100);
      const result = ctx.summarize(content);
      // Section > 1000 chars, should fall through to truncation
      expect(result).toContain("...[truncated");
    });

    it("handles content exactly at threshold boundary", () => {
      const content = "X".repeat(500);
      expect(ctx.summarize(content)).toBe(content); // Exactly 500 = direct

      const content501 = "Y".repeat(501);
      const result = ctx.summarize(content501);
      expect(result).toContain("...[truncated");
    });

    it("handles undefined content", () => {
      expect(ctx.summarize(undefined)).toBe("(No output from sub-agent)");
    });
  });

  // ─── Defaults ──────────────────────────────────────────

  describe("defaults", () => {
    it("defaults role to 'general'", () => {
      const ctx = SubAgentContext.create({ task: "task" });
      expect(ctx.role).toBe("general");
    });

    it("defaults task to empty string", () => {
      const ctx = SubAgentContext.create({ role: "test" });
      expect(ctx.task).toBe("");
    });

    it("defaults tokenBudget to null", () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      expect(ctx.tokenBudget).toBeNull();
    });

    it("accepts custom tokenBudget", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "task",
        tokenBudget: 5000,
      });
      expect(ctx.tokenBudget).toBe(5000);
    });

    it("defaults parentId to null", () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      expect(ctx.parentId).toBeNull();
    });

    it("sets createdAt on construction", () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      expect(ctx.createdAt).toBeTruthy();
      expect(ctx.completedAt).toBeNull();
    });
  });

  // ─── Token Budget ────────────────────────────────────────

  describe("token budget enforcement", () => {
    it("tracks _tokenCount starting at 0", () => {
      const ctx = SubAgentContext.create({ role: "test", task: "task" });
      expect(ctx._tokenCount).toBe(0);
    });

    it("forceComplete sets reason to token-budget-exceeded", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "task",
        tokenBudget: 100,
      });
      ctx.forceComplete("token-budget-exceeded");
      expect(ctx.status).toBe("completed");
      expect(ctx.result.summary).toContain("token-budget-exceeded");
    });

    it("tokenBudget is stored when provided", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "task",
        tokenBudget: 2000,
      });
      expect(ctx.tokenBudget).toBe(2000);
    });

    it("null tokenBudget means no enforcement", () => {
      const ctx = SubAgentContext.create({
        role: "test",
        task: "task",
        tokenBudget: null,
      });
      expect(ctx.tokenBudget).toBeNull();
      // Simulate high token count — should not trigger forceComplete
      ctx._tokenCount = 999999;
      expect(ctx.status).toBe("active"); // still active
    });
  });
});
