import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory for sessions
const testDir = join(tmpdir(), `cc-jsonl-test-${Date.now()}`);
const sessionsDir = join(testDir, "sessions");

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testDir,
}));

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

describe("jsonl-session-store", () => {
  beforeEach(() => {
    mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ── startSession ──────────────────────────────────────────────────

  describe("startSession", () => {
    it("creates a new session with auto-generated ID", () => {
      const id = startSession(null, { title: "Test Chat" });
      expect(id).toMatch(/^session-/);
      expect(sessionExists(id)).toBe(true);
    });

    it("uses provided session ID", () => {
      const id = startSession("my-session", { title: "Custom" });
      expect(id).toBe("my-session");
      expect(sessionExists("my-session")).toBe(true);
    });

    it("writes session_start event", () => {
      const id = startSession("s1", {
        title: "Chat",
        provider: "ollama",
        model: "qwen",
      });
      const events = readEvents(id);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("session_start");
      expect(events[0].data.title).toBe("Chat");
      expect(events[0].data.provider).toBe("ollama");
      expect(events[0].timestamp).toBeGreaterThan(0);
    });
  });

  // ── append operations ─────────────────────────────────────────────

  describe("append operations", () => {
    it("appends user message", () => {
      const id = startSession("s2");
      appendUserMessage(id, "Hello");
      const events = readEvents(id);
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe("user_message");
      expect(events[1].data.content).toBe("Hello");
      expect(events[1].data.role).toBe("user");
    });

    it("appends assistant message", () => {
      const id = startSession("s3");
      appendAssistantMessage(id, "Hi there");
      const events = readEvents(id);
      expect(events[1].type).toBe("assistant_message");
      expect(events[1].data.content).toBe("Hi there");
    });

    it("appends tool call and result", () => {
      const id = startSession("s4");
      appendToolCall(id, "read_file", { path: "test.txt" });
      appendToolResult(id, "read_file", "file content");
      const events = readEvents(id);
      expect(events[1].type).toBe("tool_call");
      expect(events[1].data.tool).toBe("read_file");
      expect(events[2].type).toBe("tool_result");
    });

    it("appends compact event", () => {
      const id = startSession("s5");
      appendCompactEvent(id, { saved: 100, strategy: "truncate" });
      const events = readEvents(id);
      expect(events[1].type).toBe("compact");
      expect(events[1].data.saved).toBe(100);
    });
  });

  // ── readEvents ────────────────────────────────────────────────────

  describe("readEvents", () => {
    it("returns empty array for non-existent session", () => {
      expect(readEvents("nonexistent")).toEqual([]);
    });

    it("reads all events in order", () => {
      const id = startSession("s6");
      appendUserMessage(id, "q1");
      appendAssistantMessage(id, "a1");
      appendUserMessage(id, "q2");
      appendAssistantMessage(id, "a2");
      const events = readEvents(id);
      expect(events).toHaveLength(5); // start + 4 messages
      expect(events.map((e) => e.type)).toEqual([
        "session_start",
        "user_message",
        "assistant_message",
        "user_message",
        "assistant_message",
      ]);
    });
  });

  // ── rebuildMessages ───────────────────────────────────────────────

  describe("rebuildMessages", () => {
    it("rebuilds messages from events", () => {
      const id = startSession("s7");
      appendUserMessage(id, "hello");
      appendAssistantMessage(id, "hi");
      const messages = rebuildMessages(id);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: "user", content: "hello" });
      expect(messages[1]).toEqual({ role: "assistant", content: "hi" });
    });

    it("rebuilds from last compact event if present", () => {
      const id = startSession("s8");
      appendUserMessage(id, "old msg 1");
      appendAssistantMessage(id, "old resp 1");
      // Compact with saved messages
      appendCompactEvent(id, {
        messages: [{ role: "system", content: "summary of old conversation" }],
      });
      appendUserMessage(id, "new msg");
      appendAssistantMessage(id, "new resp");

      const messages = rebuildMessages(id);
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe("summary of old conversation");
      expect(messages[1].content).toBe("new msg");
      expect(messages[2].content).toBe("new resp");
    });

    it("returns empty for non-existent session", () => {
      expect(rebuildMessages("nope")).toEqual([]);
    });
  });

  // ── listJsonlSessions ────────────────────────────────────────────

  describe("listJsonlSessions", () => {
    it("lists sessions sorted by last update", () => {
      startSession("sa", { title: "First" });
      startSession("sb", { title: "Second" });
      appendUserMessage("sb", "newer");

      const sessions = listJsonlSessions();
      expect(sessions.length).toBe(2);
      // "sb" was updated more recently
      expect(sessions[0].id).toBe("sb");
    });

    it("includes message count", () => {
      const id = startSession("sc", { title: "Chat" });
      appendUserMessage(id, "q1");
      appendAssistantMessage(id, "a1");
      appendUserMessage(id, "q2");

      const sessions = listJsonlSessions();
      const s = sessions.find((x) => x.id === "sc");
      expect(s.message_count).toBe(3);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        startSession(`lim-${i}`);
      }
      const sessions = listJsonlSessions({ limit: 3 });
      expect(sessions.length).toBe(3);
    });
  });

  // ── forkSession ───────────────────────────────────────────────────

  describe("forkSession", () => {
    it("creates a new session with copied events", () => {
      const id = startSession("orig", { title: "Original" });
      appendUserMessage(id, "q1");
      appendAssistantMessage(id, "a1");

      const forkedId = forkSession("orig");
      expect(forkedId).not.toBe("orig");
      expect(sessionExists(forkedId)).toBe(true);

      const events = readEvents(forkedId);
      // original 3 events + fork system message
      expect(events.length).toBe(4);
      expect(events[3].type).toBe("system");
      expect(events[3].data.content).toContain("Forked from");
    });

    it("returns null for non-existent session", () => {
      expect(forkSession("nope")).toBeNull();
    });
  });

  // ── sessionExists ─────────────────────────────────────────────────

  describe("sessionExists", () => {
    it("returns true for existing session", () => {
      startSession("exists-test");
      expect(sessionExists("exists-test")).toBe(true);
    });

    it("returns false for non-existent session", () => {
      expect(sessionExists("no-such-session")).toBe(false);
    });
  });

  // ── getLastSessionId ──────────────────────────────────────────────

  describe("getLastSessionId", () => {
    it("returns most recent session ID", () => {
      startSession("old-sess");
      startSession("new-sess");
      appendUserMessage("new-sess", "latest");

      const lastId = getLastSessionId();
      expect(lastId).toBe("new-sess");
    });

    it("returns null when no sessions exist", () => {
      // Clean sessions dir
      rmSync(sessionsDir, { recursive: true, force: true });
      mkdirSync(sessionsDir, { recursive: true });
      expect(getLastSessionId()).toBeNull();
    });
  });
});
