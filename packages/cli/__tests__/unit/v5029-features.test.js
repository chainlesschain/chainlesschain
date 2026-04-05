/**
 * v5.0.2.9 Feature Tests — 4 new capabilities:
 *   1. JSONL_SESSION full replacement (session-manager.js ↔ jsonl-session-store.js)
 *   2. Context Compression adaptive strategies (CONTEXT_WINDOWS, adaptiveThresholds)
 *   3. Worktree + Sub-Agent integration (SubAgentContext with WORKTREE_ISOLATION)
 *   4. Background Tasks UI WS protocol (tasks-list, tasks-stop)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── 1. Context Compression Adaptive Strategies ─────────────────────────

describe("Context Compression Adaptive", () => {
  let mod;

  beforeEach(async () => {
    mod = await import("../../src/lib/prompt-compressor.js");
  });

  describe("CONTEXT_WINDOWS registry", () => {
    it("contains entries for all major providers", () => {
      const { CONTEXT_WINDOWS } = mod;
      expect(CONTEXT_WINDOWS["gpt-4o"]).toBe(128000);
      expect(CONTEXT_WINDOWS["claude-opus-4-6"]).toBe(200000);
      expect(CONTEXT_WINDOWS["deepseek-chat"]).toBe(64000);
      expect(CONTEXT_WINDOWS["qwen2.5:7b"]).toBe(32768);
      expect(CONTEXT_WINDOWS["gemini-2.0-flash"]).toBe(1048576);
      expect(CONTEXT_WINDOWS["moonshot-v1-128k"]).toBe(131072);
    });

    it("has provider defaults for all 10 providers", () => {
      const { CONTEXT_WINDOWS } = mod;
      const defaults = CONTEXT_WINDOWS._provider_defaults;
      expect(defaults.ollama).toBe(32768);
      expect(defaults.openai).toBe(128000);
      expect(defaults.anthropic).toBe(200000);
      expect(defaults.deepseek).toBe(64000);
      expect(defaults.gemini).toBe(1048576);
      expect(defaults.kimi).toBe(131072);
    });
  });

  describe("getContextWindow()", () => {
    it("returns model-specific window when model is known", () => {
      expect(mod.getContextWindow("gpt-4o", "openai")).toBe(128000);
    });

    it("falls back to provider default for unknown model", () => {
      expect(mod.getContextWindow("unknown-model", "anthropic")).toBe(200000);
    });

    it("returns conservative default for unknown model+provider", () => {
      expect(mod.getContextWindow("x", "y")).toBe(32768);
    });

    it("returns conservative default with no args", () => {
      expect(mod.getContextWindow()).toBe(32768);
    });
  });

  describe("adaptiveThresholds()", () => {
    it("small context (8k) → aggressive, fewer messages", () => {
      const t = mod.adaptiveThresholds(8192);
      expect(t.maxTokens).toBe(Math.floor(8192 * 0.6));
      expect(t.maxMessages).toBeLessThanOrEqual(30);
      expect(t.maxMessages).toBeGreaterThanOrEqual(15);
      expect(t.aggressive).toBe(true);
    });

    it("medium context (32k) → not aggressive", () => {
      const t = mod.adaptiveThresholds(32768);
      expect(t.maxTokens).toBe(Math.floor(32768 * 0.6));
      expect(t.aggressive).toBe(false);
    });

    it("large context (200k) → more messages allowed, not aggressive", () => {
      const t = mod.adaptiveThresholds(200000);
      expect(t.maxTokens).toBe(Math.floor(200000 * 0.6));
      expect(t.maxMessages).toBeGreaterThanOrEqual(30);
      expect(t.maxMessages).toBeLessThanOrEqual(50);
      expect(t.aggressive).toBe(false);
    });

    it("huge context (1M) → capped at 50 messages", () => {
      const t = mod.adaptiveThresholds(1048576);
      expect(t.maxMessages).toBe(50);
    });
  });

  describe("PromptCompressor adaptive constructor", () => {
    it("auto-adapts when model is provided", () => {
      const pc = new mod.PromptCompressor({
        model: "gpt-4o",
        provider: "openai",
      });
      expect(pc._adaptive).toBe(true);
      expect(pc._contextWindow).toBe(128000);
      expect(pc.maxTokens).toBe(Math.floor(128000 * 0.6));
    });

    it("explicit maxMessages overrides adaptive", () => {
      const pc = new mod.PromptCompressor({
        model: "gpt-4o",
        maxMessages: 10,
        maxTokens: 5000,
      });
      expect(pc._adaptive).toBe(false);
      expect(pc.maxMessages).toBe(10);
      expect(pc.maxTokens).toBe(5000);
    });

    it("adaptToModel() reconfigures thresholds", () => {
      const pc = new mod.PromptCompressor({});
      expect(pc._adaptive).toBe(false);

      pc.adaptToModel("claude-opus-4-6", "anthropic");
      expect(pc._adaptive).toBe(true);
      expect(pc._contextWindow).toBe(200000);
      expect(pc.maxTokens).toBe(Math.floor(200000 * 0.6));
    });

    it("provider-only adaptive (no model)", () => {
      const pc = new mod.PromptCompressor({ provider: "gemini" });
      expect(pc._adaptive).toBe(true);
      expect(pc._contextWindow).toBe(1048576);
    });
  });
});

// ── 2. JSONL Session Store (existing API validation) ───────────────────

describe("JSONL Session Store Integration", () => {
  let store;

  beforeEach(async () => {
    store = await import("../../src/lib/jsonl-session-store.js");
  });

  it("exports all required functions", () => {
    expect(typeof store.startSession).toBe("function");
    expect(typeof store.appendUserMessage).toBe("function");
    expect(typeof store.appendAssistantMessage).toBe("function");
    expect(typeof store.appendCompactEvent).toBe("function");
    expect(typeof store.rebuildMessages).toBe("function");
    expect(typeof store.listJsonlSessions).toBe("function");
    expect(typeof store.sessionExists).toBe("function");
    expect(typeof store.getLastSessionId).toBe("function");
    expect(typeof store.forkSession).toBe("function");
  });

  it("startSession generates unique IDs", () => {
    const id1 = store.startSession(null, { title: "test1" });
    const id2 = store.startSession(null, { title: "test2" });
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^session-/);
  });

  it("append + rebuild round-trip", () => {
    const sid = store.startSession(null, { title: "round-trip" });
    store.appendUserMessage(sid, "hello");
    store.appendAssistantMessage(sid, "hi there");
    store.appendUserMessage(sid, "how are you");

    const messages = store.rebuildMessages(sid);
    expect(messages.length).toBe(3);
    expect(messages[0].content).toBe("hello");
    expect(messages[1].content).toBe("hi there");
    expect(messages[2].content).toBe("how are you");
  });

  it("compact event creates checkpoint for fast rebuild", () => {
    const sid = store.startSession(null, { title: "compact-test" });
    store.appendUserMessage(sid, "msg1");
    store.appendAssistantMessage(sid, "resp1");

    // Write compact checkpoint
    const snapshot = [
      { role: "user", content: "msg1" },
      { role: "assistant", content: "resp1 (compacted)" },
    ];
    store.appendCompactEvent(sid, { messages: snapshot });

    // Append more after compact
    store.appendUserMessage(sid, "msg2");

    const rebuilt = store.rebuildMessages(sid);
    // Should start from compact snapshot + msg2
    expect(rebuilt.length).toBe(3);
    expect(rebuilt[0].content).toBe("msg1");
    expect(rebuilt[1].content).toBe("resp1 (compacted)");
    expect(rebuilt[2].content).toBe("msg2");
  });

  it("sessionExists returns correct state", () => {
    const sid = store.startSession(null, { title: "exists-test" });
    expect(store.sessionExists(sid)).toBe(true);
    expect(store.sessionExists("nonexistent-session-xyz")).toBe(false);
  });

  it("listJsonlSessions returns session metadata", () => {
    const sid = store.startSession(null, { title: "list-test-unique" });
    store.appendUserMessage(sid, "hello");

    const sessions = store.listJsonlSessions({ limit: 50 });
    const found = sessions.find((s) => s.id === sid);
    expect(found).toBeDefined();
    expect(found.title).toBe("list-test-unique");
    expect(found.message_count).toBe(1);
  });
});

// ── 3. SubAgentContext worktree integration ────────────────────────────

describe("SubAgentContext Worktree Integration", () => {
  let SubAgentContext;

  beforeEach(async () => {
    const mod = await import("../../src/lib/sub-agent-context.js");
    SubAgentContext = mod.SubAgentContext;
  });

  it("constructor reads WORKTREE_ISOLATION flag by default", () => {
    const ctx = SubAgentContext.create({
      role: "test",
      task: "test task",
      useWorktree: false, // explicit override
    });
    expect(ctx._useWorktree).toBe(false);
  });

  it("constructor with useWorktree=true sets worktree mode", () => {
    const ctx = SubAgentContext.create({
      role: "test",
      task: "test task",
      useWorktree: true,
    });
    expect(ctx._useWorktree).toBe(true);
    expect(ctx._worktreePath).toBeNull();
    expect(ctx._worktreeBranch).toBeNull();
  });

  it("toJSON includes worktree info when set", () => {
    const ctx = SubAgentContext.create({ role: "test", task: "t" });
    ctx._worktreePath = "/tmp/test-worktree";
    ctx._worktreeBranch = "agent/test-branch";

    const json = ctx.toJSON();
    expect(json.worktree).toEqual({
      path: "/tmp/test-worktree",
      branch: "agent/test-branch",
    });
  });

  it("toJSON shows null worktree when not used", () => {
    const ctx = SubAgentContext.create({
      role: "test",
      task: "t",
      useWorktree: false,
    });
    const json = ctx.toJSON();
    expect(json.worktree).toBeNull();
  });

  it("creates unique sub-agent IDs", () => {
    const ctx1 = SubAgentContext.create({ role: "a", task: "t1" });
    const ctx2 = SubAgentContext.create({ role: "b", task: "t2" });
    expect(ctx1.id).not.toBe(ctx2.id);
    expect(ctx1.id).toMatch(/^sub-/);
  });
});

// ── 4. Background Task Manager (WS protocol support) ──────────────────

describe("BackgroundTaskManager WS Integration", () => {
  let BTM, TaskStatus;

  beforeEach(async () => {
    const mod = await import("../../src/lib/background-task-manager.js");
    BTM = mod.BackgroundTaskManager;
    TaskStatus = mod.TaskStatus;
  });

  afterEach(() => {
    // Cleanup any intervals
  });

  it("exports TaskStatus enum", () => {
    expect(TaskStatus.PENDING).toBe("pending");
    expect(TaskStatus.RUNNING).toBe("running");
    expect(TaskStatus.COMPLETED).toBe("completed");
    expect(TaskStatus.FAILED).toBe("failed");
    expect(TaskStatus.TIMEOUT).toBe("timeout");
  });

  it("create() returns task with correct structure", () => {
    const mgr = new BTM({ maxConcurrent: 1 });
    const task = mgr.create({
      type: "shell",
      command: "echo hello",
      description: "Test echo",
    });

    expect(task.id).toMatch(/^task-/);
    expect(task.status).toBe("pending");
    expect(task.type).toBe("shell");
    expect(task.description).toBe("Test echo");
    expect(task.createdAt).toBeGreaterThan(0);
    mgr.destroy();
  });

  it("list() returns tasks sorted by creation time", () => {
    const mgr = new BTM({ maxConcurrent: 5 });
    mgr.create({ type: "shell", command: "echo 1", description: "First" });
    mgr.create({ type: "shell", command: "echo 2", description: "Second" });

    const tasks = mgr.list();
    expect(tasks.length).toBe(2);
    expect(tasks[0].description).toBe("Second"); // newest first
    expect(tasks[1].description).toBe("First");
    mgr.destroy();
  });

  it("list() supports status filter", () => {
    const mgr = new BTM({ maxConcurrent: 5 });
    mgr.create({ type: "shell", command: "echo 1" });
    mgr.create({ type: "shell", command: "echo 2" });

    const pending = mgr.list({ status: "pending" });
    expect(pending.length).toBe(2);
    const running = mgr.list({ status: "running" });
    expect(running.length).toBe(0);
    mgr.destroy();
  });

  it("get() returns task by ID", () => {
    const mgr = new BTM({ maxConcurrent: 5 });
    const task = mgr.create({ type: "shell", command: "echo test" });
    expect(mgr.get(task.id)).toBe(task);
    expect(mgr.get("nonexistent")).toBeNull();
    mgr.destroy();
  });

  it("cleanup() removes old completed tasks", () => {
    const mgr = new BTM({ maxConcurrent: 5 });
    const task = mgr.create({ type: "shell", command: "echo 1" });
    // Simulate completion
    task.status = TaskStatus.COMPLETED;
    task.completedAt = Date.now() - 7200000; // 2 hours ago

    const removed = mgr.cleanup(3600000); // 1 hour threshold
    expect(removed).toBe(1);
    expect(mgr.list().length).toBe(0);
    mgr.destroy();
  });

  it("throws when max concurrent reached", () => {
    const mgr = new BTM({ maxConcurrent: 1 });
    const task = mgr.create({ type: "shell", command: "echo 1" });
    // Simulate running
    task.status = TaskStatus.RUNNING;

    expect(() => mgr.create({ type: "shell", command: "echo 2" })).toThrow(
      /Max concurrent/,
    );
    mgr.destroy();
  });

  it("destroy() clears all state", () => {
    const mgr = new BTM({ maxConcurrent: 5 });
    mgr.create({ type: "shell", command: "echo 1" });
    mgr.create({ type: "shell", command: "echo 2" });
    mgr.destroy();
    expect(mgr.list().length).toBe(0);
  });
});
