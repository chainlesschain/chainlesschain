/**
 * `cc hub query-events` — human-output rendering regression tests.
 *
 * Why this exists: vault events carry `occurredAt` (epoch ms) + `content`,
 * NOT `at` / `summary`. The human renderer previously read `ev.at`, so
 * `new Date(ev.at).toISOString()` threw "Invalid time value" on the FIRST
 * row and killed the entire listing (the --json path was unaffected, which
 * is why it went unnoticed). This pins the correct field usage + the
 * malformed-timestamp guard so the bug can't silently come back.
 *
 * Uses the `_getHub` injection seam — no real vault.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _internal } from "../hub.js";

const { cmdQueryEvents } = _internal;

let exitSpy, logSpy, lines;

beforeEach(() => {
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
  lines = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
});

afterEach(() => {
  exitSpy.mockRestore();
  logSpy.mockRestore();
});

function hubWith(events) {
  return { _getHub: async () => ({ vault: { queryEvents: () => events } }) };
}

describe("cc hub query-events — human rendering", () => {
  it("renders occurredAt as ISO + content summary (no crash on real shape)", async () => {
    const events = [
      {
        id: "e1",
        subtype: "message",
        occurredAt: 1782046916000,
        content: { text: "hello world" },
      },
    ];
    await cmdQueryEvents(hubWith(events));
    const text = lines.join("\n");
    expect(text).toContain("1 events:");
    expect(text).toContain(new Date(1782046916000).toISOString());
    expect(text).toContain("message");
    expect(text).toContain("hello world");
    // The pre-fix bug: this would have thrown "Invalid time value".
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("falls back to title/subject/id when content.text is absent", async () => {
    const events = [
      {
        id: "e2",
        subtype: "mail",
        occurredAt: 1,
        content: { subject: "Re: x" },
      },
      { id: "e3", subtype: "note", occurredAt: 2, content: {} },
    ];
    await cmdQueryEvents(hubWith(events));
    const text = lines.join("\n");
    expect(text).toContain("Re: x");
    expect(text).toContain("e3"); // empty content → falls back to id
  });

  it("guards a malformed timestamp instead of crashing the listing", async () => {
    const events = [
      {
        id: "bad",
        subtype: "x",
        occurredAt: undefined,
        content: { text: "t" },
      },
      {
        id: "ok",
        subtype: "y",
        occurredAt: 1782046916000,
        content: { text: "u" },
      },
    ];
    await cmdQueryEvents(hubWith(events));
    const text = lines.join("\n");
    expect(text).toContain("(no date)"); // bad row rendered, not thrown
    expect(text).toContain("t");
    expect(text).toContain("u"); // listing continued past the bad row
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
