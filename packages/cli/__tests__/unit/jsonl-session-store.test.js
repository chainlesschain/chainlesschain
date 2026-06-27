import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
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
  migrateLegacySessionFile,
  migrateLegacySessionsBatch,
  sampleMigratedSessionsValidation,
  validateJsonlSession,
  sessionPath,
  isUnsafeSessionId,
  toIsoSafe,
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

  // ── path-traversal safety ─────────────────────────────────────────
  describe("session id path-traversal safety", () => {
    it("flags separators / `..` / empty / non-string ids as unsafe", () => {
      for (const bad of [
        "../../etc/passwd",
        "a/b",
        "a\\b",
        "..",
        "x/..",
        "",
        null,
        undefined,
        123,
      ]) {
        expect(isUnsafeSessionId(bad)).toBe(true);
      }
      for (const ok of ["session-123-abc", "my_session.1", "abc"]) {
        expect(isUnsafeSessionId(ok)).toBe(false);
      }
    });

    it("sessionPath throws on a traversal id but builds a safe path otherwise", () => {
      expect(() => sessionPath("../../evil")).toThrow(/unsafe session id/);
      expect(sessionPath("good-1").endsWith("good-1.jsonl")).toBe(true);
    });

    it("reads/exists treat a traversal id as not-found (no escape, no throw)", () => {
      // A sibling file OUTSIDE the sessions dir that a crafted id could target.
      const victim = join(testDir, "victim.jsonl");
      writeFileSync(victim, JSON.stringify({ secret: 1 }) + "\n", "utf-8");
      try {
        const travId = "../victim"; // sessionPath would append .jsonl
        expect(readEvents(travId)).toEqual([]);
        expect(sessionExists(travId)).toBe(false);
        expect(validateJsonlSession(travId).reason).toBe("invalid session id");
        expect(existsSync(victim)).toBe(true); // never read/deleted
      } finally {
        rmSync(victim, { force: true });
      }
    });

    it("writes refuse a traversal id (nothing created outside the dir)", () => {
      const escaped = join(testDir, "pwned.jsonl");
      expect(() => appendEvent("../pwned", "x", {})).toThrow(
        /unsafe session id/,
      );
      expect(() => startSession("../pwned")).toThrow(/unsafe session id/);
      expect(existsSync(escaped)).toBe(false);
    });
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

    it("toIsoSafe converts valid ms but returns '' for missing / invalid (no throw)", () => {
      const ms = Date.UTC(2026, 0, 2, 3, 4, 5);
      expect(toIsoSafe(ms)).toBe(new Date(ms).toISOString());
      // The cases a bare `ts ? ...` truthy guard would miss or crash on:
      expect(toIsoSafe(undefined)).toBe("");
      expect(toIsoSafe(null)).toBe("");
      expect(toIsoSafe("not-a-number")).toBe(""); // truthy but invalid → no RangeError
      expect(toIsoSafe(NaN)).toBe("");
      expect(toIsoSafe(Infinity)).toBe("");
      // numeric string is coerced (Number("123") → 123)
      expect(toIsoSafe(String(ms))).toBe(new Date(ms).toISOString());
    });

    it("does not crash on a malformed compact event (missing / null data)", () => {
      // A partially-written / hand-edited line can be valid JSON but have a
      // `compact` type with no usable data — this used to throw a TypeError
      // ("Cannot read properties of null") and abort the whole resume.
      const id = "s-corrupt-compact";
      const lines =
        [
          JSON.stringify({
            type: "user_message",
            data: { role: "user", content: "hi" },
          }),
          JSON.stringify({ type: "compact" }), // no data
          JSON.stringify({ type: "compact", data: null }), // null data
          JSON.stringify({
            type: "assistant_message",
            data: { role: "assistant", content: "yo" },
          }),
        ].join("\n") + "\n";
      writeFileSync(sessionPath(id), lines, "utf-8");
      const messages = rebuildMessages(id);
      expect(messages).toEqual([
        { role: "user", content: "hi" },
        { role: "assistant", content: "yo" },
      ]);
    });

    it("drops malformed message events (null / no-role data) instead of injecting them", () => {
      const id = "s-corrupt-msg";
      const lines =
        [
          JSON.stringify({
            type: "user_message",
            data: { role: "user", content: "real" },
          }),
          JSON.stringify({ type: "assistant_message", data: null }),
          JSON.stringify({ type: "user_message" }), // no data
          JSON.stringify({ type: "system", data: { content: "no role" } }),
          JSON.stringify({
            type: "assistant_message",
            data: { role: "assistant", content: "ok" },
          }),
        ].join("\n") + "\n";
      writeFileSync(sessionPath(id), lines, "utf-8");
      expect(rebuildMessages(id)).toEqual([
        { role: "user", content: "real" },
        { role: "assistant", content: "ok" },
      ]);
    });

    it("skips a malformed compact and falls back to an earlier valid one", () => {
      const id = "s-compact-fallback";
      const lines =
        [
          JSON.stringify({
            type: "compact",
            data: { messages: [{ role: "system", content: "summary" }] },
          }),
          JSON.stringify({
            type: "user_message",
            data: { role: "user", content: "after" },
          }),
          JSON.stringify({
            type: "compact",
            data: { messages: "not-an-array" },
          }),
        ].join("\n") + "\n";
      writeFileSync(sessionPath(id), lines, "utf-8");
      const messages = rebuildMessages(id);
      expect(messages[0]).toEqual({ role: "system", content: "summary" });
      expect(messages.some((m) => m.content === "after")).toBe(true);
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

    it("does not crash on a session with a missing / invalid timestamp", () => {
      // A corrupt session_start line (valid JSON, no/garbage timestamp) used to
      // make `new Date(undefined).toISOString()` throw and abort the WHOLE list.
      writeFileSync(
        sessionPath("s-bad-ts"),
        [
          JSON.stringify({ type: "session_start", data: { title: "NoTs" } }),
          JSON.stringify({
            type: "user_message",
            data: { role: "user", content: "hi" },
            timestamp: "not-a-number",
          }),
        ].join("\n") + "\n",
        "utf-8",
      );
      // A healthy session must still appear alongside the corrupt one.
      startSession("s-good", { title: "Good" });

      const sessions = listJsonlSessions();
      const bad = sessions.find((s) => s.id === "s-bad-ts");
      const good = sessions.find((s) => s.id === "s-good");
      expect(bad).toBeTruthy();
      expect(bad.created_at).toBe(""); // invalid → empty, not a thrown RangeError
      expect(bad.updated_at).toBe("");
      expect(bad.title).toBe("NoTs");
      expect(good).toBeTruthy();
      expect(good.created_at).not.toBe(""); // healthy session keeps its date
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

  describe("migration and validation", () => {
    it("migrates a legacy JSON session file to JSONL", () => {
      const legacyPath = join(sessionsDir, "legacy.json");
      writeFileSync(
        legacyPath,
        JSON.stringify({
          id: "legacy-session",
          title: "Legacy Chat",
          provider: "ollama",
          model: "qwen",
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
          ],
        }),
        "utf-8",
      );

      const result = migrateLegacySessionFile(legacyPath);
      expect(result.migrated).toBe(true);
      expect(sessionExists("legacy-session")).toBe(true);
      expect(rebuildMessages("legacy-session")).toHaveLength(2);
    });

    it("fails-fast on a legacy file whose own id is a traversal id (no escape)", () => {
      // The legacy payload names a traversal target; the file's basename is safe.
      const legacyPath = join(sessionsDir, "evil.json");
      writeFileSync(
        legacyPath,
        JSON.stringify({
          id: "../../pwned",
          messages: [{ role: "user", content: "x" }],
        }),
        "utf-8",
      );
      const escaped = join(testDir, "..", "pwned.jsonl");

      const result = migrateLegacySessionFile(legacyPath, { force: true });
      expect(result.migrated).toBe(false);
      expect(result.failed).toBe(true);
      expect(result.reason).toMatch(/unsafe session id/);
      expect(result.attempts).toBe(1); // failed fast, no retry waste
      expect(existsSync(escaped)).toBe(false); // nothing written outside the dir
    });

    it("validates JSONL session structure", () => {
      const id = startSession("validate-me");
      appendUserMessage(id, "hello");

      const result = validateJsonlSession(id);
      expect(result.valid).toBe(true);
      expect(result.eventCount).toBe(2);
      expect(result.messageCount).toBe(1);
    });

    it("builds a dry-run batch migration report", () => {
      writeFileSync(
        join(sessionsDir, "legacy-a.json"),
        JSON.stringify({
          id: "legacy-a",
          messages: [{ role: "user", content: "a" }],
        }),
        "utf-8",
      );
      writeFileSync(
        join(sessionsDir, "legacy-b.json"),
        JSON.stringify({
          id: "legacy-b",
          messages: [{ role: "assistant", content: "b" }],
        }),
        "utf-8",
      );

      const report = migrateLegacySessionsBatch(sessionsDir, { dryRun: true });
      expect(report.summary.scanned).toBe(2);
      expect(report.summary.migrated).toBe(2);
      expect(report.summary.dryRun).toBe(true);
    });

    it("samples migrated sessions for validation", () => {
      const file = join(sessionsDir, "legacy-sample.json");
      writeFileSync(
        file,
        JSON.stringify({
          id: "legacy-sample",
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
          ],
        }),
        "utf-8",
      );

      const migrated = migrateLegacySessionFile(file);
      const sample = sampleMigratedSessionsValidation([migrated], {
        sampleSize: 1,
      });
      expect(sample).toHaveLength(1);
      expect(sample[0].valid).toBe(true);
      expect(sample[0].matchesExpectedMessages).toBe(true);
    });

    it("reports failed migration attempts when source JSON is invalid", () => {
      const brokenPath = join(sessionsDir, "broken.json");
      writeFileSync(brokenPath, "{not-json", "utf-8");

      const result = migrateLegacySessionFile(brokenPath, {
        retryFailures: true,
      });
      expect(result.failed).toBe(true);
      expect(result.attempts).toBeGreaterThan(1);
    });
  });
});
