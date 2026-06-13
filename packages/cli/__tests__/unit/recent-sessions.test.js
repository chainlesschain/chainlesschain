/**
 * `/sessions` REPL command — render recent resumable sessions
 * (listRecentSessions rows). Pure renderer.
 */
import { describe, it, expect } from "vitest";
import { renderRecentSessions } from "../../src/repl/recent-sessions.js";

const rows = [
  {
    id: "headless-1700000000000-111",
    title: "Refactor exporter",
    message_count: 12,
    updated_at: "2026-06-13T09:07:06.000Z",
    _store: "jsonl",
  },
  {
    id: "chat-abc",
    title: "Untitled",
    message_count: 3,
    updated_at: "2026-06-12T08:00:00.000Z",
    _store: "db",
  },
];

describe("renderRecentSessions", () => {
  it("lists id (short), store, msgs, time, title with a resume hint", () => {
    const out = renderRecentSessions(rows);
    expect(out).toContain("resume with `cc agent --resume <id>`");
    expect(out).toContain("headless-170");
    expect(out).toContain("[jsonl]");
    expect(out).toContain("12 msgs");
    expect(out).toContain("2026-06-13 09:07:06");
    expect(out).toContain("— Refactor exporter");
    // "Untitled" title is suppressed
    expect(out).not.toContain("— Untitled");
  });

  it("marks the current session", () => {
    const out = renderRecentSessions(rows, { currentId: "chat-abc" });
    const currentLine = out.split("\n").find((l) => l.includes("chat-abc"));
    expect(currentLine).toContain("← current");
  });

  it("caps the list and notes overflow", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: "s" + i,
      message_count: i,
      updated_at: "2026-06-13T00:00:00.000Z",
    }));
    const out = renderRecentSessions(many, { limit: 5 });
    expect(out).toContain("… +15 more");
  });

  it("handles empty / malformed input", () => {
    expect(renderRecentSessions([])).toMatch(/No recent sessions/);
    expect(renderRecentSessions(null)).toMatch(/No recent sessions/);
    // rows without ids are skipped, not rendered as blanks
    const out = renderRecentSessions([{ message_count: 1 }, { id: "ok" }]);
    expect(out).toContain("ok");
  });
});
