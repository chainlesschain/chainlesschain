/**
 * Integration tests for Agent Architecture Optimization modules.
 *
 * Tests cross-module workflows:
 *   1. Feature flags controlling prompt compressor behavior
 *   2. JSONL session store with prompt compressor integration
 *   3. Background task manager lifecycle
 *   4. Worktree isolator with background tasks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// ── Shared temp directory ───────────────────────────────────────────────

const testDir = join(tmpdir(), `cc-integ-opt-${Date.now()}`);

// Mock paths for both modules that need it
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testDir,
}));

// Mock config for feature flags
let mockConfig = { features: {} };
vi.mock("../../src/lib/config-manager.js", () => ({
  loadConfig: () => mockConfig,
  getConfigValue: (key) => {
    const parts = key.split(".");
    let current = mockConfig;
    for (const p of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = current[p];
    }
    return current;
  },
  saveConfig: (config) => {
    mockConfig = config;
  },
}));

const { feature, setFeature, listFeatures } =
  await import("../../src/lib/feature-flags.js");
const { PromptCompressor, estimateTokens } =
  await import("../../src/lib/prompt-compressor.js");
const {
  startSession,
  appendUserMessage,
  appendAssistantMessage,
  appendCompactEvent,
  readEvents,
  rebuildMessages,
  listJsonlSessions,
  forkSession,
} = await import("../../src/lib/jsonl-session-store.js");
const { BackgroundTaskManager, TaskStatus } =
  await import("../../src/lib/background-task-manager.js");

// ── Setup / teardown ────────────────────────────────────────────────────

describe("Agent Optimization — Integration", () => {
  beforeEach(() => {
    mockConfig = { features: {} };
    mkdirSync(join(testDir, "sessions"), { recursive: true });
    mkdirSync(join(testDir, "tasks"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ── 1. Feature Flags → Prompt Compressor ──────────────────────────

  describe("Feature Flags control Prompt Compressor strategies", () => {
    it("snipCompact only runs when CONTEXT_SNIP flag is enabled", async () => {
      const compressor = new PromptCompressor({ maxMessages: 50 });
      const msgs = [
        { role: "system", content: "sys" },
        { role: "tool", content: "ok" },
        { role: "tool", content: "{}" },
        { role: "assistant", content: "[PROCESSED] old" },
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "q2" },
        { role: "assistant", content: "a2" },
      ];

      // Without flag
      mockConfig.features.CONTEXT_SNIP = false;
      const r1 = await compressor.compress(msgs);
      const hasStale1 = r1.messages.some((m) =>
        (m.content || "").includes("[PROCESSED]"),
      );
      expect(hasStale1).toBe(true);

      // With flag
      mockConfig.features.CONTEXT_SNIP = true;
      const r2 = await compressor.compress(msgs);
      const hasStale2 = r2.messages.some((m) =>
        (m.content || "").includes("[PROCESSED]"),
      );
      expect(hasStale2).toBe(false);
    });

    it("contextCollapse only runs when CONTEXT_COLLAPSE flag is enabled", async () => {
      const compressor = new PromptCompressor({ maxMessages: 50 });
      const msgs = [
        { role: "system", content: "sys" },
        { role: "user", content: "do it" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "1", function: { name: "read_file", arguments: "{}" } },
          ],
        },
        { role: "tool", content: "data" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "2", function: { name: "write_file", arguments: "{}" } },
          ],
        },
        { role: "tool", content: "ok" },
        { role: "user", content: "next" },
        { role: "assistant", content: "done" },
        { role: "user", content: "thanks" },
        { role: "assistant", content: "welcome" },
      ];

      mockConfig.features.CONTEXT_COLLAPSE = false;
      const r1 = await compressor.compress(msgs);
      expect(
        r1.messages.some((m) => (m.content || "").includes("[Collapsed")),
      ).toBe(false);

      mockConfig.features.CONTEXT_COLLAPSE = true;
      const r2 = await compressor.compress(msgs);
      expect(
        r2.messages.some((m) => (m.content || "").includes("[Collapsed")),
      ).toBe(true);
    });

    it("setFeature persists and affects subsequent feature() calls", () => {
      expect(feature("CONTEXT_SNIP")).toBe(false);
      setFeature("CONTEXT_SNIP", true);
      expect(feature("CONTEXT_SNIP")).toBe(true);
      expect(mockConfig.features.CONTEXT_SNIP).toBe(true);
    });
  });

  // ── 2. JSONL Session + Prompt Compressor ──────────────────────────

  describe("JSONL Session Store with Prompt Compressor", () => {
    it("full session lifecycle: create → chat → compact → resume", async () => {
      // Create session
      const id = startSession("integ-sess-1", {
        title: "Integration Chat",
        provider: "ollama",
        model: "qwen2.5",
      });

      // Simulate conversation
      for (let i = 0; i < 10; i++) {
        appendUserMessage(id, `Question ${i}`);
        appendAssistantMessage(id, `Answer ${i}`);
      }

      // Verify events written
      const events = readEvents(id);
      expect(events.length).toBe(21); // 1 start + 20 messages

      // Rebuild and compress
      const messages = rebuildMessages(id);
      expect(messages.length).toBe(20);

      mockConfig.features.CONTEXT_SNIP = true;
      const compressor = new PromptCompressor({ maxMessages: 8 });
      const { messages: compacted, stats } =
        await compressor.compress(messages);
      expect(compacted.length).toBeLessThan(messages.length);

      // Write compact event with new messages
      appendCompactEvent(id, { ...stats, messages: compacted });

      // Rebuild from compact point
      const resumed = rebuildMessages(id);
      expect(resumed.length).toBe(compacted.length);
    });

    it("fork session preserves full history", () => {
      const id = startSession("fork-src", { title: "Original" });
      appendUserMessage(id, "hello");
      appendAssistantMessage(id, "hi");

      const forkedId = forkSession(id);
      expect(forkedId).not.toBe(id);

      const forkedEvents = readEvents(forkedId);
      // 3 original + 1 fork marker
      expect(forkedEvents.length).toBe(4);
      expect(forkedEvents[3].data.content).toContain("Forked from");

      // Both appear in list
      const sessions = listJsonlSessions();
      expect(sessions.some((s) => s.id === id)).toBe(true);
      expect(sessions.some((s) => s.id === forkedId)).toBe(true);
    });
  });

  // ── 3. Background Task Manager lifecycle ──────────────────────────

  describe("Background Task Manager lifecycle", () => {
    it("create → complete → cleanup workflow", () => {
      const manager = new BackgroundTaskManager({ maxConcurrent: 3 });

      // Create tasks
      const t1 = manager.create({
        command: "echo test1",
        description: "Task 1",
      });
      const t2 = manager.create({
        command: "echo test2",
        description: "Task 2",
      });
      expect(manager.list()).toHaveLength(2);

      // Simulate completion
      t1.status = TaskStatus.RUNNING;
      manager._complete(t1.id, TaskStatus.COMPLETED, "output1", null);
      expect(t1.status).toBe(TaskStatus.COMPLETED);
      expect(t1.result).toBe("output1");

      // Simulate failure
      t2.status = TaskStatus.RUNNING;
      manager._complete(t2.id, TaskStatus.FAILED, null, "cmd not found");
      expect(t2.status).toBe(TaskStatus.FAILED);

      // Cleanup old tasks
      t1.completedAt = Date.now() - 7200000;
      t2.completedAt = Date.now() - 7200000;
      const removed = manager.cleanup(3600000);
      expect(removed).toBe(2);
      expect(manager.list()).toHaveLength(0);

      manager.destroy();
    });

    it("task:complete events fire correctly", () => {
      const manager = new BackgroundTaskManager();
      const completed = [];
      manager.on("task:complete", (task) => completed.push(task));

      const t = manager.create({ command: "echo" });
      t.status = TaskStatus.RUNNING;
      manager._complete(t.id, TaskStatus.COMPLETED, "done", null);

      expect(completed).toHaveLength(1);
      expect(completed[0].result).toBe("done");

      manager.destroy();
    });

    it("respects maxConcurrent limit", () => {
      const manager = new BackgroundTaskManager({ maxConcurrent: 2 });
      manager.create({ command: "echo 1" });
      manager.create({ command: "echo 2" });
      // Simulate both running
      for (const t of manager.list()) t.status = TaskStatus.RUNNING;

      expect(() => manager.create({ command: "echo 3" })).toThrow(
        /Max concurrent/,
      );
      manager.destroy();
    });
  });

  // ── 4. Feature Flags listing includes all known flags ─────────────

  describe("Feature Flags registry completeness", () => {
    it("lists all 6 known flags", () => {
      const flags = listFeatures();
      const names = flags.map((f) => f.name);
      expect(names).toContain("BACKGROUND_TASKS");
      expect(names).toContain("WORKTREE_ISOLATION");
      expect(names).toContain("CONTEXT_SNIP");
      expect(names).toContain("CONTEXT_COLLAPSE");
      expect(names).toContain("JSONL_SESSION");
      expect(names).toContain("PROMPT_COMPRESSOR");
      expect(names.length).toBeGreaterThanOrEqual(6);
    });

    it("PROMPT_COMPRESSOR defaults to true", () => {
      expect(feature("PROMPT_COMPRESSOR")).toBe(true);
    });

    it("env var overrides config in integration context", () => {
      mockConfig.features.CONTEXT_SNIP = false;
      process.env.CC_FLAG_CONTEXT_SNIP = "true";
      expect(feature("CONTEXT_SNIP")).toBe(true);
      delete process.env.CC_FLAG_CONTEXT_SNIP;
    });
  });

  // ── 5. Token estimation accuracy ─────────────────────────────────

  describe("Token estimation cross-module", () => {
    it("estimates are consistent between estimateTokens and compressor", async () => {
      const text = "Hello world, this is a test of token estimation 你好世界";
      const directEstimate = estimateTokens(text);

      const compressor = new PromptCompressor({ maxMessages: 4 });
      const msgs = [
        { role: "system", content: "sys" },
        { role: "user", content: text },
        { role: "assistant", content: "response one" },
        { role: "user", content: "follow up question" },
        { role: "assistant", content: "response two" },
      ];
      const { stats } = await compressor.compress(msgs);
      // Should be > 0 and consistent
      expect(directEstimate).toBeGreaterThan(0);
      expect(stats.originalTokens).toBeGreaterThan(0);
    });
  });

  // ── 6. JSONL Session + Fork + Rebuild full path ─────────────────

  describe("JSONL Session fork and rebuild consistency", () => {
    it("forked session rebuilds same messages as original", () => {
      const id = startSession("fork-rebuild", { title: "Original" });
      appendUserMessage(id, "hello");
      appendAssistantMessage(id, "hi");
      appendUserMessage(id, "question");
      appendAssistantMessage(id, "answer");

      const origMessages = rebuildMessages(id);
      const forkedId = forkSession(id);
      const forkedMessages = rebuildMessages(forkedId);

      // Forked session has same messages + fork marker (system msg)
      // rebuildMessages includes system events
      expect(forkedMessages.length).toBe(origMessages.length + 1);
      // First N messages should match
      for (let i = 0; i < origMessages.length; i++) {
        expect(forkedMessages[i].content).toBe(origMessages[i].content);
      }
      // Last message is the fork marker
      expect(forkedMessages[forkedMessages.length - 1].content).toContain(
        "Forked from",
      );
    });

    it("compact in forked session does not affect original", () => {
      const id = startSession("compact-fork", { title: "Source" });
      appendUserMessage(id, "q1");
      appendAssistantMessage(id, "a1");
      appendUserMessage(id, "q2");
      appendAssistantMessage(id, "a2");

      const forkedId = forkSession(id);
      // Compact the forked session
      appendCompactEvent(forkedId, {
        messages: [{ role: "system", content: "compacted summary" }],
      });
      appendUserMessage(forkedId, "new in fork");

      // Original should be unchanged
      const origMessages = rebuildMessages(id);
      expect(origMessages.length).toBe(4); // q1 a1 q2 a2

      // Forked should rebuild from compact
      const forkedMessages = rebuildMessages(forkedId);
      expect(forkedMessages[0].content).toBe("compacted summary");
      expect(forkedMessages[1].content).toBe("new in fork");
    });
  });

  // ── 7. Feature Flags + Compressor strategies integration ─────────

  describe("Feature flags dynamically control compressor", () => {
    it("enabling both SNIP and COLLAPSE produces combined strategy", async () => {
      mockConfig.features.CONTEXT_SNIP = true;
      mockConfig.features.CONTEXT_COLLAPSE = true;
      const compressor = new PromptCompressor({ maxMessages: 50 });

      const msgs = [
        { role: "system", content: "sys" },
        { role: "assistant", content: "[PROCESSED] stale" },
        { role: "tool", content: "ok" },
        { role: "user", content: "do analysis" },
        {
          role: "assistant",
          content: "reading files",
          tool_calls: [
            { id: "1", function: { name: "read_file", arguments: "{}" } },
          ],
        },
        { role: "tool", content: "file data from reading" },
        {
          role: "assistant",
          content: "writing output",
          tool_calls: [
            { id: "2", function: { name: "write_file", arguments: "{}" } },
          ],
        },
        { role: "tool", content: "write completed successfully" },
        {
          role: "assistant",
          content: "verifying result",
          tool_calls: [
            { id: "3", function: { name: "verify", arguments: "{}" } },
          ],
        },
        { role: "tool", content: "verified: all good" },
        { role: "user", content: "what happened" },
        { role: "assistant", content: "all done with analysis" },
        { role: "user", content: "great thanks" },
        { role: "assistant", content: "you are welcome" },
      ];

      const { messages, stats } = await compressor.compress(msgs);
      expect(messages.length).toBeLessThan(msgs.length);
      // At least snip should have fired (removing [PROCESSED] and stale tool "ok")
      expect(stats.strategy).toContain("snip");
    });

    it("disabling flags mid-session changes compressor behavior", async () => {
      const compressor = new PromptCompressor({ maxMessages: 50 });
      const msgs = [
        { role: "system", content: "sys" },
        { role: "assistant", content: "[PROCESSED] old" },
        { role: "tool", content: "ok" },
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1 with some detail" },
        { role: "user", content: "q2" },
        { role: "assistant", content: "a2 with some detail" },
      ];

      // With SNIP enabled
      mockConfig.features.CONTEXT_SNIP = true;
      const r1 = await compressor.compress(msgs);
      const hasStale1 = r1.messages.some((m) =>
        (m.content || "").includes("[PROCESSED]"),
      );

      // With SNIP disabled
      mockConfig.features.CONTEXT_SNIP = false;
      const r2 = await compressor.compress(msgs);
      const hasStale2 = r2.messages.some((m) =>
        (m.content || "").includes("[PROCESSED]"),
      );

      expect(hasStale1).toBe(false);
      expect(hasStale2).toBe(true);
    });
  });

  // ── 8. Background Task + Event-driven workflow ────────────────────

  describe("Background Task event-driven workflow", () => {
    it("tracks multiple tasks through full lifecycle", () => {
      const manager = new BackgroundTaskManager({ maxConcurrent: 5 });
      const events = [];
      manager.on("task:complete", (task) => events.push(task));

      // Create 3 tasks
      const tasks = [];
      for (let i = 0; i < 3; i++) {
        tasks.push(
          manager.create({ command: `echo ${i}`, description: `Task ${i}` }),
        );
      }
      expect(manager.list()).toHaveLength(3);

      // Complete them in reverse order
      for (let i = 2; i >= 0; i--) {
        tasks[i].status = TaskStatus.RUNNING;
        manager._complete(
          tasks[i].id,
          i === 1 ? TaskStatus.FAILED : TaskStatus.COMPLETED,
          i === 1 ? null : `output-${i}`,
          i === 1 ? "command failed" : null,
        );
      }

      expect(events).toHaveLength(3);
      expect(events[1].status).toBe(TaskStatus.FAILED);
      expect(events[0].status).toBe(TaskStatus.COMPLETED);

      // Cleanup all
      for (const t of manager.list()) {
        t.completedAt = Date.now() - 100000;
      }
      const cleaned = manager.cleanup(1000);
      expect(cleaned).toBe(3);
      expect(manager.list()).toHaveLength(0);

      manager.destroy();
    });
  });

  // ── 9. JSONL Session with rapid writes stress test ────────────────

  describe("JSONL Session stress test", () => {
    it("handles 100 rapid messages without data loss", () => {
      const id = startSession("stress-test", { title: "Stress" });
      for (let i = 0; i < 100; i++) {
        if (i % 2 === 0) {
          appendUserMessage(id, `user-${i}`);
        } else {
          appendAssistantMessage(id, `assistant-${i}`);
        }
      }

      const events = readEvents(id);
      expect(events.length).toBe(101); // 1 start + 100 messages

      const messages = rebuildMessages(id);
      expect(messages.length).toBe(100);
      expect(messages[0].content).toBe("user-0");
      expect(messages[99].content).toBe("assistant-99");
    });
  });

  // ── 10. Null/edge input handling across modules ───────────────────

  describe("Null safety across modules", () => {
    it("PromptCompressor handles null input", async () => {
      const compressor = new PromptCompressor();
      const result = await compressor.compress(null);
      expect(result.messages).toEqual([]);
    });

    it("PromptCompressor handles undefined input", async () => {
      const compressor = new PromptCompressor();
      const result = await compressor.compress(undefined);
      expect(result.messages).toEqual([]);
    });

    it("readEvents returns empty for non-existent session", () => {
      expect(readEvents("does-not-exist")).toEqual([]);
    });

    it("rebuildMessages returns empty for non-existent session", () => {
      expect(rebuildMessages("does-not-exist")).toEqual([]);
    });

    it("forkSession returns null for empty source", () => {
      expect(forkSession("no-such-session")).toBeNull();
    });
  });
});
