import { describe, expect, it } from "vitest";
import { createSessionTranscriptHistoryProjection } from "../src/lib/session-transcript-history.js";

const events = Array.from({ length: 7 }, (_, index) => ({
  type: index % 2 ? "assistant_message" : "user_message",
  hash: (index + 1).toString(16).padStart(64, "0"),
  data: {
    role: index % 2 ? "assistant" : "user",
    content: `body-${index}\n${"detail ".repeat(8)}END-${index}`,
  },
}));
function page(rows, options = {}) {
  const projection = createSessionTranscriptHistoryProjection("verify07-history", {
    limit: 2,
    ...options,
  });
  rows.forEach((event) => projection.accept(event));
  return projection.finish({
    headHash: rows.at(-1)?.hash ?? "0".repeat(64),
    eventCount: rows.length,
  });
}
const ordinals = (result) => result.messages.map((row) => row.ordinal);
const texts = (rows) => rows.map((row) => row.text);

describe("durable transcript cursor boundaries", () => {
  it("walks backward to the first body without repeating a boundary", () => {
    const latest = page(events);
    expect(ordinals(latest)).toEqual([5, 6]);
    expect(latest.syncCursor).toBeTypeOf("string");
    const collected = [...latest.messages];
    let previous = latest;
    for (const expected of [[3, 4], [1, 2], [0]]) {
      expect(previous.nextCursor).toBeTypeOf("string");
      previous = page(events, { cursor: previous.nextCursor });
      expect(ordinals(previous)).toEqual(expected);
      expect(previous.syncCursor).toBeNull();
      collected.unshift(...previous.messages);
    }
    expect(previous.nextCursor).toBeNull();
    expect(collected.map((row) => row.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(texts(collected)).toEqual(events.map((event) => event.data.content));
  });

  it("includes the first appended body and the final partial page exactly once", () => {
    const initial = page(events.slice(0, 2));
    const collected = [...initial.messages];
    let cursor = initial.syncCursor;
    for (const expected of [[2, 3], [4, 5], [6]]) {
      expect(cursor).toBeTypeOf("string");
      const delta = page(events, { after: cursor });
      expect(ordinals(delta)).toEqual(expected);
      expect(delta.hasMore).toBe(expected.at(-1) < 6);
      collected.push(...delta.messages);
      cursor = delta.nextCursor;
    }
    expect(collected.map((row) => row.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(texts(collected)).toEqual(events.map((event) => event.data.content));
    const unchanged = page(events, { after: cursor });
    expect(unchanged.messages).toEqual([]);
    expect(unchanged.hasMore).toBe(false);
    expect(unchanged.nextCursor).toBe(cursor);
  });

  it("does not lose the final body when appended rows exactly fill a page", () => {
    const initial = page(events.slice(0, 3), { limit: 3 });
    const first = page(events, { after: initial.syncCursor });
    expect(ordinals(first)).toEqual([3, 4]);
    expect(first.hasMore).toBe(true);
    const final = page(events, { after: first.nextCursor });
    expect(ordinals(final)).toEqual([5, 6]);
    expect(final.hasMore).toBe(false);
    expect(texts([...initial.messages, ...first.messages, ...final.messages]))
      .toEqual(events.map((event) => event.data.content));
    expect(page(events, { after: final.nextCursor }).messages).toEqual([]);
  });

  it("handles empty and single-row histories without inventing older pages", () => {
    const empty = page([]);
    expect(empty.messages).toEqual([]);
    expect(empty.nextCursor).toBeNull();
    expect(empty.syncCursor).toBeNull();
    const single = page(events.slice(0, 1), { limit: 1 });
    expect(ordinals(single)).toEqual([0]);
    expect(texts(single.messages)).toEqual([events[0].data.content]);
    expect(single.nextCursor).toBeNull();
    expect(single.syncCursor).toBeTypeOf("string");
    const unchanged = page(events.slice(0, 1), { after: single.syncCursor, limit: 1 });
    expect(unchanged.messages).toEqual([]);
    expect(unchanged.hasMore).toBe(false);
  });
});
