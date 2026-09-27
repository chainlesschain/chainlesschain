import { describe, expect, it } from "vitest";
import { createSessionTranscriptPageProjection } from "../../src/lib/session-transcript-page.js";

const event = (type, data, serial) => ({
  type,
  data,
  hash: serial.toString(16).padStart(64, "0"),
});
function project(events, options) {
  const projection = createSessionTranscriptPageProjection(
    "session-a",
    options,
  );
  for (const e of events) projection.accept(e);
  return projection.finish({
    headHash: events.at(-1)?.hash,
    eventCount: events.length,
  });
}
describe("verified transcript page projection", () => {
  it("paginates backwards without duplicate or missing messages", () => {
    const events = Array.from({ length: 120 }, (_, i) =>
      event("user_message", { role: "user", content: `message-${i}` }, i + 1),
    );
    const latest = project(events, { limit: 50 });
    const previous = project(events, { limit: 50, cursor: latest.nextCursor });
    const first = project(events, { limit: 50, cursor: previous.nextCursor });
    expect(
      [...first.messages, ...previous.messages, ...latest.messages].map(
        (m) => m.ordinal,
      ),
    ).toEqual(Array.from({ length: 120 }, (_, i) => i));
    expect(first.nextCursor).toBeNull();
    expect(latest.totalMessages).toBe(120);
  });
  it.each(["compact", "checkpoint_timeline_commit"])(
    "invalidates old cursors on %s without reviving discarded content",
    (type) => {
      const events = [
        event("user_message", { role: "user", content: "old" }, 1),
        event(
          "assistant_message",
          { role: "assistant", content: "discarded" },
          2,
        ),
      ];
      const cursor = project(events, { limit: 1 }).nextCursor;
      events.push(
        event(
          type,
          {
            messages: [
              { role: "system", content: "private instructions" },
              { role: "user", content: "retained" },
            ],
          },
          3,
        ),
      );
      expect(() => project(events, { cursor })).toThrow("generation changed");
      expect(project(events).messages.map((m) => m.text)).toEqual(["retained"]);
    },
  );
  it("bounds page bytes and per-entry text before retaining history", () => {
    const events = Array.from({ length: 200 }, (_, i) =>
      event(
        "assistant_message",
        { role: "assistant", content: "中".repeat(210000) },
        i + 1,
      ),
    );
    const page = project(events, { limit: 100 });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(
      1024 * 1024 + 2048,
    );
    expect(
      page.messages.every((m) => m.truncated && m.text.length <= 200000),
    ).toBe(true);
    expect(page.nextCursor).toBeTruthy();
  });
});
