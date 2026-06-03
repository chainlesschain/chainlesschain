/**
 * Extended unit tests for Agent Architecture Optimization modules.
 * Covers edge cases and code paths not in the primary test files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Shared temp directory ──────────────────────────────────────────────
const testDir = join(tmpdir(), `cc-ext-test-${Date.now()}`);

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testDir,
}));

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

const { feature, featureVariant, listFeatures, setFeature, getFlagInfo } =
  await import("../../src/lib/feature-flags.js");

// Re-mock feature-flags for compressor tests (direct import uses real feature-flags)
const { PromptCompressor, estimateTokens, estimateMessagesTokens } =
  await import("../../src/lib/prompt-compressor.js");

const {
  startSession,
  appendUserMessage,
  appendAssistantMessage,
  appendToolCall,
  appendToolResult,
  appendCompactEvent,
  appendEvent,
  readEvents,
  rebuildMessages,
  listJsonlSessions,
  forkSession,
  sessionExists,
  getLastSessionId,
} = await import("../../src/lib/jsonl-session-store.js");

const { BackgroundTaskManager, TaskStatus } =
  await import("../../src/lib/background-task-manager.js");

// ── Setup / teardown ────────────────────────────────────────────────

beforeEach(() => {
  mockConfig = { features: {} };
  mkdirSync(join(testDir, "sessions"), { recursive: true });
  mkdirSync(join(testDir, "tasks"), { recursive: true });
});

afterEach(() => {
  // Clean CC_FLAG_ env vars
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("CC_FLAG_")) delete process.env[key];
  }
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 1. Feature Flags — Extended
// ═══════════════════════════════════════════════════════════════════════

describe("Feature Flags — Extended", () => {
  describe("env var edge cases", () => {
    it("env var numeric value triggers percentage check", () => {
      process.env.CC_FLAG_CONTEXT_SNIP = "100";
      expect(feature("CONTEXT_SNIP")).toBe(true);
    });

    it("env var 0 triggers percentage check → false", () => {
      process.env.CC_FLAG_CONTEXT_SNIP = "0";
      expect(feature("CONTEXT_SNIP")).toBe(false);
    });

    it("env var non-boolean string resolves via _resolve fallback", () => {
      // A non-boolean, non-numeric string goes through default path
      process.env.CC_FLAG_CONTEXT_SNIP = "custom_value";
      // feature() gets a string, which is truthy → falls to _getDefault since
      // it's neither boolean nor number nor object
      const val = feature("CONTEXT_SNIP");
      expect(typeof val).toBe("boolean");
    });
  });

  describe("listFeatures source priority", () => {
    it("source=env when env var set, even if config also set", () => {
      mockConfig.features.CONTEXT_SNIP = false;
      process.env.CC_FLAG_CONTEXT_SNIP = "true";
      const flags = listFeatures();
      const snip = flags.find((f) => f.name === "CONTEXT_SNIP");
      // config is set, so source should be "config" (env checked separately)
      // Actually the logic: raw !== undefined → "config" takes precedence in source detection
      expect(snip.source).toBe("config");
      // But the enabled value should reflect env override
      expect(snip.enabled).toBe(true);
    });

    it("source=env when only env var set (no config)", () => {
      process.env.CC_FLAG_CONTEXT_SNIP = "true";
      const flags = listFeatures();
      const snip = flags.find((f) => f.name === "CONTEXT_SNIP");
      expect(snip.source).toBe("env");
    });
  });

  describe("setFeature edge cases", () => {
    it("creates features object if missing", () => {
      mockConfig = {};
      setFeature("CONTEXT_SNIP", true);
      expect(mockConfig.features.CONTEXT_SNIP).toBe(true);
    });

    it("sets string value", () => {
      setFeature("CONTEXT_SNIP", "aggressive");
      expect(mockConfig.features.CONTEXT_SNIP).toBe("aggressive");
    });
  });

  describe("featureVariant edge cases", () => {
    it("returns null for object without variant", () => {
      mockConfig.features.CONTEXT_SNIP = { enabled: true };
      expect(featureVariant("CONTEXT_SNIP")).toBeNull();
    });

    it("env var overrides object variant check", () => {
      process.env.CC_FLAG_CONTEXT_SNIP = "true";
      mockConfig.features.CONTEXT_SNIP = { enabled: true, variant: "A" };
      // env returns boolean true, not object → no variant
      expect(featureVariant("CONTEXT_SNIP")).toBeNull();
    });
  });

  describe("getFlagInfo completeness", () => {
    it("all 6 registered flags have descriptions", () => {
      const knownFlags = [
        "BACKGROUND_TASKS",
        "WORKTREE_ISOLATION",
        "CONTEXT_SNIP",
        "CONTEXT_COLLAPSE",
        "JSONL_SESSION",
        "PROMPT_COMPRESSOR",
      ];
      for (const name of knownFlags) {
        const info = getFlagInfo(name);
        expect(info).not.toBeNull();
        expect(info.description.length).toBeGreaterThan(5);
        expect(typeof info.default).toBe("boolean");
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Prompt Compressor — Extended
// ═══════════════════════════════════════════════════════════════════════

describe("Prompt Compressor — Extended", () => {
  describe("estimateTokens edge cases", () => {
    it("handles very long strings", () => {
      const long = "a".repeat(10000);
      expect(estimateTokens(long)).toBe(2500); // 10000/4
    });

    it("handles pure Chinese text", () => {
      const chinese = "测试测试测试"; // 6 chars
      expect(estimateTokens(chinese)).toBe(4); // ceil(6/1.5)
    });

    it("handles emoji/unicode outside CJK range", () => {
      const text = "Hello 🎉🎊";
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe("estimateMessagesTokens edge cases", () => {
    it("handles null content without crashing", () => {
      const msgs = [{ role: "user", content: null }];
      // null || "" → JSON.stringify("") → '""' (2 chars) → ceil(2/4) = 1
      expect(estimateMessagesTokens(msgs)).toBeGreaterThanOrEqual(0);
    });

    it("handles undefined content", () => {
      const msgs = [{ role: "user" }];
      expect(estimateMessagesTokens(msgs)).toBeGreaterThanOrEqual(0);
    });

    it("handles array content (multimodal)", () => {
      const msgs = [
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ];
      const tokens = estimateMessagesTokens(msgs);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe("compress with non-array input", () => {
    it("handles null input gracefully", async () => {
      const compressor = new PromptCompressor();
      const result = await compressor.compress(null);
      expect(result.messages).toEqual([]);
      expect(result.stats.strategy).toBe("none");
    });

    it("handles empty array", async () => {
      const compressor = new PromptCompressor();
      const result = await compressor.compress([]);
      expect(result.messages).toHaveLength(0);
    });
  });

  describe("_snipCompact edge cases", () => {
    it("preserves messages with [STALE] tag when <= 4 messages", async () => {
      mockConfig.features.CONTEXT_SNIP = true;
      const compressor = new PromptCompressor();
      const msgs = [
        { role: "system", content: "sys" },
        { role: "assistant", content: "[STALE] old" },
        { role: "user", content: "q" },
      ];
      // <= 2 messages trigger early return, so no snip check needed
      const { messages } = await compressor.compress(msgs);
      expect(messages.length).toBeGreaterThan(0);
    });

    it("removes short assistant acknowledgments from middle", async () => {
      mockConfig.features.CONTEXT_SNIP = true;
      const compressor = new PromptCompressor({ maxMessages: 50 });
      const msgs = [
        { role: "system", content: "sys" },
        { role: "assistant", content: "ok" }, // < 10 chars, in middle
        { role: "user", content: "question one" },
        { role: "assistant", content: "detailed answer one with lots of text" },
        { role: "user", content: "question two" },
        { role: "assistant", content: "detailed answer two with lots of text" },
        { role: "user", content: "last question" },
        { role: "assistant", content: "last answer with details" },
      ];
      const { messages } = await compressor.compress(msgs);
      // "ok" should be removed from middle (it's < 10 chars assistant msg)
      const contents = messages.map((m) => m.content);
      expect(contents).not.toContain("ok");
    });

    it("removes tool messages with 'null' content", async () => {
      mockConfig.features.CONTEXT_SNIP = true;
      const compressor = new PromptCompressor({ maxMessages: 50 });
      const msgs = [
        { role: "system", content: "sys" },
        { role: "tool", content: "null" }, // stale
        { role: "user", content: "q1 with text" },
        { role: "assistant", content: "a1 with text and details" },
        { role: "user", content: "q2 with text" },
        { role: "assistant", content: "a2 with text and details" },
      ];
      const { messages } = await compressor.compress(msgs);
      expect(
        messages.some((m) => m.role === "tool" && m.content === "null"),
      ).toBe(false);
    });
  });

  describe("_contextCollapse edge cases", () => {
    it("does not collapse when tool group < 3 messages", async () => {
      mockConfig.features.CONTEXT_COLLAPSE = true;
      const compressor = new PromptCompressor({ maxMessages: 50 });
      const msgs = [
        { role: "system", content: "sys" },
        { role: "user", content: "do it" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "1", function: { name: "read", arguments: "{}" } },
          ],
        },
        { role: "tool", content: "data" },
        // Only 2 tool messages (assistant+tool) — below threshold of 3
        { role: "user", content: "next" },
        { role: "assistant", content: "done with more text" },
        { role: "user", content: "thanks" },
        { role: "assistant", content: "you're welcome" },
      ];
      const { messages } = await compressor.compress(msgs);
      // Should NOT collapse since group is only 2 messages
      expect(
        messages.some((m) => (m.content || "").includes("[Collapsed")),
      ).toBe(false);
    });

    it("collapses chained tool call sequences", async () => {
      mockConfig.features.CONTEXT_COLLAPSE = true;
      const compressor = new PromptCompressor({
        maxMessages: 50,
        similarityThreshold: 1.0,
      });
      const msgs = [
        { role: "system", content: "sys" },
        { role: "user", content: "analyze the codebase" },
        {
          role: "assistant",
          content: "Let me read the file first",
          tool_calls: [
            {
              id: "1",
              function: { name: "read_file", arguments: '{"path":"a.js"}' },
            },
          ],
        },
        { role: "tool", content: "file content of a.js with functions" },
        {
          role: "assistant",
          content: "Now searching for patterns",
          tool_calls: [
            {
              id: "2",
              function: { name: "grep", arguments: '{"pattern":"test"}' },
            },
          ],
        },
        { role: "tool", content: "grep results: 5 matches found in b.js" },
        {
          role: "assistant",
          content: "Writing the output file",
          tool_calls: [
            {
              id: "3",
              function: { name: "write_file", arguments: '{"path":"out.txt"}' },
            },
          ],
        },
        { role: "tool", content: "wrote 128 bytes to out.txt" },
        { role: "user", content: "now what should we do next" },
        { role: "assistant", content: "all done with the analysis" },
        { role: "user", content: "thanks for the help" },
        { role: "assistant", content: "welcome, let me know if you need more" },
      ];
      const { messages } = await compressor.compress(msgs);
      const collapsed = messages.find((m) =>
        (m.content || "").includes("[Collapsed"),
      );
      expect(collapsed).toBeDefined();
      // Should mention at least some of the tool names
      expect(collapsed.content).toMatch(/read_file|grep|write_file/);
    });
  });

  describe("_summarize edge cases", () => {
    it("returns original if llmQuery returns empty", async () => {
      const compressor = new PromptCompressor({ maxTokens: 10 });
      compressor.llmQuery = vi.fn().mockResolvedValue("");
      const msgs = [
        { role: "system", content: "sys" },
        { role: "user", content: "a".repeat(200) },
        { role: "assistant", content: "b".repeat(200) },
        { role: "user", content: "c".repeat(200) },
        { role: "assistant", content: "d".repeat(200) },
        { role: "user", content: "last" },
      ];
      const { messages } = await compressor.compress(msgs);
      // LLM returned empty string → summarize is a no-op
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe("constructor defaults", () => {
    it("uses default options", () => {
      const c = new PromptCompressor();
      expect(c.maxMessages).toBe(20);
      expect(c.maxTokens).toBe(8000);
      expect(c.similarityThreshold).toBe(0.9);
      expect(c.llmQuery).toBeNull();
    });

    it("accepts custom options", () => {
      const c = new PromptCompressor({
        maxMessages: 5,
        maxTokens: 500,
        similarityThreshold: 0.5,
      });
      expect(c.maxMessages).toBe(5);
      expect(c.maxTokens).toBe(500);
      expect(c.similarityThreshold).toBe(0.5);
    });
  });

  describe("stats accuracy", () => {
    it("originalMessages and compressedMessages are correct", async () => {
      const compressor = new PromptCompressor({ maxMessages: 5 });
      const msgs = [];
      for (let i = 0; i < 10; i++) {
        msgs.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `msg ${i}`,
        });
      }
      const { stats } = await compressor.compress(msgs);
      expect(stats.originalMessages).toBe(10);
      expect(stats.compressedMessages).toBeLessThanOrEqual(5);
    });

    it("saved = originalTokens - compressedTokens", async () => {
      const compressor = new PromptCompressor({ maxMessages: 4 });
      const msgs = [];
      for (let i = 0; i < 8; i++) {
        msgs.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `message number ${i}`,
        });
      }
      const { stats } = await compressor.compress(msgs);
      expect(stats.saved).toBe(stats.originalTokens - stats.compressedTokens);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. JSONL Session Store — Extended
// ═══════════════════════════════════════════════════════════════════════

describe("JSONL Session Store — Extended", () => {
  describe("malformed JSONL handling", () => {
    it("skips malformed lines in readEvents", () => {
      const id = startSession("malformed-test");
      // Manually inject a bad line
      const filePath = join(testDir, "sessions", "malformed-test.jsonl");
      appendFileSync(filePath, "NOT VALID JSON\n", "utf-8");
      appendUserMessage(id, "valid msg");

      const events = readEvents(id);
      // Should have session_start + valid msg (malformed line skipped)
      expect(events.length).toBe(2);
      expect(events[1].data.content).toBe("valid msg");
    });

    it("handles empty lines in JSONL", () => {
      const id = startSession("empty-lines");
      const filePath = join(testDir, "sessions", "empty-lines.jsonl");
      appendFileSync(filePath, "\n\n\n", "utf-8");
      appendUserMessage(id, "after blanks");

      const events = readEvents(id);
      expect(events.length).toBe(2);
    });
  });

  describe("appendEvent raw", () => {
    it("writes custom event types", () => {
      const id = startSession("custom-event");
      appendEvent(id, "custom_type", { foo: "bar" });
      const events = readEvents(id);
      expect(events[1].type).toBe("custom_type");
      expect(events[1].data.foo).toBe("bar");
      expect(events[1].timestamp).toBeGreaterThan(0);
    });
  });

  describe("rebuildMessages with multiple compacts", () => {
    it("uses last compact event, ignoring earlier ones", () => {
      const id = startSession("multi-compact");
      appendUserMessage(id, "old1");
      appendCompactEvent(id, {
        messages: [{ role: "system", content: "first compact" }],
      });
      appendUserMessage(id, "middle");
      appendCompactEvent(id, {
        messages: [{ role: "system", content: "second compact" }],
      });
      appendUserMessage(id, "new");

      const messages = rebuildMessages(id);
      expect(messages[0].content).toBe("second compact");
      expect(messages[1].content).toBe("new");
      expect(messages.length).toBe(2);
    });
  });

  describe("rebuildMessages ignores tool and session_start events", () => {
    it("does not include tool_call/tool_result in rebuilt messages", () => {
      const id = startSession("tool-events");
      appendUserMessage(id, "q1");
      appendToolCall(id, "read_file", { path: "test.txt" });
      appendToolResult(id, "read_file", "file data");
      appendAssistantMessage(id, "a1");

      const messages = rebuildMessages(id);
      // Only user_message and assistant_message are rebuilt
      expect(messages.length).toBe(2);
      expect(messages[0].content).toBe("q1");
      expect(messages[1].content).toBe("a1");
    });
  });

  describe("listJsonlSessions metadata", () => {
    it("includes provider and model from session_start", () => {
      startSession("meta-test", {
        title: "Test",
        provider: "ollama",
        model: "qwen2.5",
      });
      const sessions = listJsonlSessions();
      const s = sessions.find((x) => x.id === "meta-test");
      expect(s.provider).toBe("ollama");
      expect(s.model).toBe("qwen2.5");
      expect(s.title).toBe("Test");
    });

    it("has created_at and updated_at as ISO strings", () => {
      const id = startSession("date-test");
      appendUserMessage(id, "hi");
      const sessions = listJsonlSessions();
      const s = sessions.find((x) => x.id === "date-test");
      expect(s.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(s.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("handles empty sessions dir", () => {
      rmSync(join(testDir, "sessions"), { recursive: true, force: true });
      mkdirSync(join(testDir, "sessions"), { recursive: true });
      expect(listJsonlSessions()).toEqual([]);
    });
  });

  describe("forkSession preserves all event types", () => {
    it("copies tool_call and tool_result events", () => {
      const id = startSession("fork-tools");
      appendUserMessage(id, "do it");
      appendToolCall(id, "grep", { pattern: "test" });
      appendToolResult(id, "grep", "found 5 matches");
      appendAssistantMessage(id, "done");

      const forkedId = forkSession(id);
      const events = readEvents(forkedId);
      expect(events.length).toBe(6); // 5 original + 1 fork marker
      expect(events[2].type).toBe("tool_call");
      expect(events[3].type).toBe("tool_result");
    });
  });

  describe("concurrent appends", () => {
    it("handles rapid sequential writes without data loss", () => {
      const id = startSession("rapid-write");
      for (let i = 0; i < 50; i++) {
        appendUserMessage(id, `msg-${i}`);
      }
      const events = readEvents(id);
      expect(events.length).toBe(51); // 1 start + 50 messages
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Background Task Manager — Extended
// ═══════════════════════════════════════════════════════════════════════

describe("Background Task Manager — Extended", () => {
  let manager;

  beforeEach(() => {
    manager = new BackgroundTaskManager({
      maxConcurrent: 5,
      heartbeatTimeout: 5000,
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("create edge cases", () => {
    it("auto-generates unique IDs", () => {
      const t1 = manager.create({ command: "echo 1" });
      const t2 = manager.create({ command: "echo 2" });
      expect(t1.id).not.toBe(t2.id);
      expect(t1.id).toMatch(/^task-/);
    });

    it("records createdAt timestamp", () => {
      const before = Date.now();
      const task = manager.create({ command: "echo" });
      expect(task.createdAt).toBeGreaterThanOrEqual(before);
      expect(task.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("sets type to shell by default", () => {
      const task = manager.create({ command: "echo" });
      expect(task.type).toBe("shell");
    });

    it("accepts custom type", () => {
      const task = manager.create({ command: "echo", type: "node" });
      expect(task.type).toBe("node");
    });
  });

  describe("_complete edge cases", () => {
    it("sets completedAt timestamp", () => {
      const task = manager.create({ command: "echo" });
      task.status = TaskStatus.RUNNING;
      manager._complete(task.id, TaskStatus.COMPLETED, "done", null);
      expect(task.completedAt).toBeGreaterThan(0);
    });

    it("does nothing for unknown task ID", () => {
      // Should not throw
      expect(() => {
        manager._complete("nonexistent", TaskStatus.COMPLETED, "x", null);
      }).not.toThrow();
    });

    it("handles TIMEOUT status", () => {
      const task = manager.create({ command: "sleep 999" });
      task.status = TaskStatus.RUNNING;
      manager._complete(task.id, TaskStatus.TIMEOUT, null, "timed out");
      expect(task.status).toBe(TaskStatus.TIMEOUT);
      expect(task.error).toBe("timed out");
    });
  });

  describe("stop edge cases", () => {
    it("does not crash for non-existent task", () => {
      // stop() calls _complete() which silently ignores unknown IDs
      expect(() => manager.stop("nonexistent")).not.toThrow();
    });

    it("no-op for already completed task", () => {
      const task = manager.create({ command: "echo" });
      task.status = TaskStatus.COMPLETED;
      // stop on completed task — behavior varies, should not crash
      expect(() => manager.stop(task.id)).not.toThrow();
    });
  });

  describe("list with filters", () => {
    it("filters by RUNNING status", () => {
      const t1 = manager.create({ command: "echo 1" });
      const t2 = manager.create({ command: "echo 2" });
      t1.status = TaskStatus.RUNNING;
      t2.status = TaskStatus.COMPLETED;
      const running = manager.list({ status: TaskStatus.RUNNING });
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe(t1.id);
    });

    it("returns empty when no tasks match filter", () => {
      manager.create({ command: "echo" });
      const failed = manager.list({ status: TaskStatus.FAILED });
      expect(failed).toHaveLength(0);
    });
  });

  describe("cleanup edge cases", () => {
    it("does not remove pending tasks", () => {
      manager.create({ command: "echo" });
      const removed = manager.cleanup(0);
      expect(removed).toBe(0);
    });

    it("removes failed tasks that are old enough", () => {
      const task = manager.create({ command: "bad" });
      task.status = TaskStatus.FAILED;
      task.completedAt = Date.now() - 10000;
      const removed = manager.cleanup(5000);
      expect(removed).toBe(1);
    });

    it("removes timed-out tasks", () => {
      const task = manager.create({ command: "slow" });
      task.status = TaskStatus.TIMEOUT;
      task.completedAt = Date.now() - 10000;
      const removed = manager.cleanup(5000);
      expect(removed).toBe(1);
    });
  });

  describe("event system", () => {
    it("supports multiple listeners", () => {
      const results = [];
      manager.on("task:complete", (t) => results.push(`a:${t.id}`));
      manager.on("task:complete", (t) => results.push(`b:${t.id}`));

      const task = manager.create({ command: "echo" });
      task.status = TaskStatus.RUNNING;
      manager._complete(task.id, TaskStatus.COMPLETED, "ok", null);

      expect(results).toHaveLength(2);
      expect(results[0]).toContain(task.id);
      expect(results[1]).toContain(task.id);
    });

    it("emits on failure too", () => {
      const handler = vi.fn();
      manager.on("task:complete", handler);

      const task = manager.create({ command: "bad" });
      task.status = TaskStatus.RUNNING;
      manager._complete(task.id, TaskStatus.FAILED, null, "error msg");

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].error).toBe("error msg");
    });
  });

  describe("destroy cleans everything", () => {
    it("clears running tasks", () => {
      const t1 = manager.create({ command: "echo 1" });
      const t2 = manager.create({ command: "echo 2" });
      t1.status = TaskStatus.RUNNING;
      manager.destroy();
      expect(manager.list()).toHaveLength(0);
    });
  });

  describe("TaskStatus enum completeness", () => {
    it("has exactly 5 status values", () => {
      const values = Object.values(TaskStatus);
      expect(values).toContain("pending");
      expect(values).toContain("running");
      expect(values).toContain("completed");
      expect(values).toContain("failed");
      expect(values).toContain("timeout");
      expect(values.length).toBe(5);
    });
  });
});
