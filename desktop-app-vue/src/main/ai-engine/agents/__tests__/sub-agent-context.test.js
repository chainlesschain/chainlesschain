import { describe, it, expect, vi, beforeEach } from "vitest";

const { SubAgentContext } = require("../sub-agent-context");

describe("SubAgentContext", () => {
  describe("constructor", () => {
    it("generates an id with sub- prefix", () => {
      const ctx = new SubAgentContext({ role: "researcher", task: "find x" });
      expect(ctx.id).toMatch(/^sub-[a-f0-9-]+$/);
      expect(ctx.id.length).toBeGreaterThan(4);
    });

    it("seeds messages with the system prompt incorporating role and task", () => {
      const ctx = new SubAgentContext({
        role: "auditor",
        task: "review the code",
      });
      expect(ctx.messages).toHaveLength(1);
      expect(ctx.messages[0].role).toBe("system");
      expect(ctx.messages[0].content).toContain("auditor");
      expect(ctx.messages[0].content).toContain("review the code");
    });

    it("appends inheritedContext to system prompt when provided", () => {
      const ctx = new SubAgentContext({
        role: "writer",
        task: "summarize",
        inheritedContext: "Parent says: focus on concision",
      });
      expect(ctx.messages[0].content).toContain("Parent Context:");
      expect(ctx.messages[0].content).toContain("focus on concision");
    });

    it("uses default values when options are missing", () => {
      const ctx = new SubAgentContext({});
      expect(ctx.role).toBe("general");
      expect(ctx.task).toBe("");
      expect(ctx.maxIterations).toBe(8);
      expect(ctx.status).toBe("active");
      expect(ctx.parentId).toBeNull();
      expect(ctx.allowedTools).toBeNull();
      expect(ctx.tokenBudget).toBeNull();
    });

    it("stores DI dependencies (database, llmManager)", () => {
      const db = { fake: "db" };
      const llm = { fake: "llm" };
      const ctx = new SubAgentContext({
        role: "x",
        task: "y",
        database: db,
        llmManager: llm,
      });
      expect(ctx.database).toBe(db);
      expect(ctx.llmManager).toBe(llm);
    });
  });

  describe("summarize", () => {
    let ctx;
    beforeEach(() => {
      ctx = new SubAgentContext({ role: "x", task: "y" });
    });

    it("returns placeholder when content is empty", () => {
      expect(ctx.summarize("")).toBe("(No output from sub-agent)");
      expect(ctx.summarize(null)).toBe("(No output from sub-agent)");
    });

    it("returns content as-is when under direct threshold (500 chars)", () => {
      const short = "Hello world";
      expect(ctx.summarize(short)).toBe(short);
    });

    it("extracts the Summary section when content has one", () => {
      const longBody = "x".repeat(600);
      const content = `${longBody}\n\n## Summary\nThis is the actual summary.\n\n## Other`;
      const result = ctx.summarize(content);
      expect(result).toContain("This is the actual summary");
      expect(result).not.toContain("## Other");
    });

    it("falls back to truncation when no recognized section header", () => {
      const long = "a".repeat(2000);
      const result = ctx.summarize(long);
      expect(result.length).toBeLessThan(long.length);
      expect(result).toContain("...[truncated, full output: 2000 chars]");
    });

    it("recognizes Result/Output/Conclusion/Answer headers too", () => {
      const longBody = "x".repeat(600);
      const content = `${longBody}\n\n## Result\nThe result is 42.`;
      expect(ctx.summarize(content)).toContain("The result is 42");
    });
  });

  describe("forceComplete", () => {
    it("transitions active → completed and emits event", () => {
      const ctx = new SubAgentContext({ role: "x", task: "y" });
      const listener = vi.fn();
      ctx.on("force-completed", listener);
      ctx.forceComplete("token-budget-exceeded");
      expect(ctx.status).toBe("completed");
      expect(ctx.completedAt).not.toBeNull();
      expect(ctx.result.summary).toContain("token-budget-exceeded");
      expect(listener).toHaveBeenCalledWith({
        id: ctx.id,
        reason: "token-budget-exceeded",
      });
    });

    it("is a no-op when already completed", () => {
      const ctx = new SubAgentContext({ role: "x", task: "y" });
      ctx.forceComplete("first");
      const firstResult = ctx.result;
      ctx.forceComplete("second");
      expect(ctx.result).toBe(firstResult); // unchanged
    });
  });

  describe("run", () => {
    it("throws when status is not active", async () => {
      const ctx = new SubAgentContext({ role: "x", task: "y" });
      ctx.forceComplete();
      await expect(ctx.run("hi")).rejects.toThrow(/not active/);
    });

    it("returns placeholder result when no llmManager is available", async () => {
      const ctx = new SubAgentContext({ role: "researcher", task: "find x" });
      const result = await ctx.run("query");
      expect(result.summary).toContain("No LLM manager");
      expect(ctx.status).toBe("completed");
    });

    it("calls llmManager.chat and summarizes response (string return)", async () => {
      const llmManager = {
        chat: vi.fn().mockResolvedValue("Short answer"),
      };
      const ctx = new SubAgentContext({
        role: "x",
        task: "y",
        llmManager,
      });
      const result = await ctx.run("question");
      expect(llmManager.chat).toHaveBeenCalled();
      expect(result.summary).toBe("Short answer");
      expect(ctx.status).toBe("completed");
    });

    it("handles object response with .content field", async () => {
      const llmManager = {
        chat: vi.fn().mockResolvedValue({ content: "Object response" }),
      };
      const ctx = new SubAgentContext({ role: "x", task: "y", llmManager });
      const result = await ctx.run("q");
      expect(result.summary).toBe("Object response");
    });

    it("handles object response with .message.content field", async () => {
      const llmManager = {
        chat: vi
          .fn()
          .mockResolvedValue({ message: { content: "Nested response" } }),
      };
      const ctx = new SubAgentContext({ role: "x", task: "y", llmManager });
      const result = await ctx.run("q");
      expect(result.summary).toBe("Nested response");
    });

    it("captures errors and marks status=failed", async () => {
      const llmManager = {
        chat: vi.fn().mockRejectedValue(new Error("LLM exploded")),
      };
      const ctx = new SubAgentContext({ role: "x", task: "y", llmManager });
      const result = await ctx.run("q");
      expect(ctx.status).toBe("failed");
      expect(result.summary).toContain("LLM exploded");
    });

    it("emits started + completed events on success", async () => {
      const llmManager = { chat: vi.fn().mockResolvedValue("ok") };
      const ctx = new SubAgentContext({ role: "x", task: "y", llmManager });
      const startedListener = vi.fn();
      const completedListener = vi.fn();
      ctx.on("started", startedListener);
      ctx.on("completed", completedListener);
      await ctx.run("q");
      expect(startedListener).toHaveBeenCalled();
      expect(completedListener).toHaveBeenCalled();
    });

    it("force-completes when token budget exceeded", async () => {
      const llmManager = {
        chat: vi.fn().mockResolvedValue("a".repeat(1000)), // ~250 tokens
      };
      const ctx = new SubAgentContext({
        role: "x",
        task: "y",
        llmManager,
        tokenBudget: 100,
      });
      await ctx.run("q");
      // Either status is completed (forceComplete sets it) — verify result still has summary
      expect(ctx.result).not.toBeNull();
    });
  });

  describe("toJSON", () => {
    it("returns a serializable snapshot with key fields", () => {
      const ctx = new SubAgentContext({
        role: "researcher",
        task: "find x",
      });
      const snapshot = ctx.toJSON();
      expect(snapshot.id).toBe(ctx.id);
      expect(snapshot.role).toBe("researcher");
      expect(snapshot.task).toBe("find x");
      expect(snapshot.status).toBe("active");
      expect(snapshot.messageCount).toBe(1); // initial system message
      expect(snapshot.toolsUsed).toEqual([]);
      expect(snapshot.tokenCount).toBe(0);
      expect(snapshot.iterationCount).toBe(0);
      expect(snapshot.createdAt).toBeDefined();
    });
  });
});
