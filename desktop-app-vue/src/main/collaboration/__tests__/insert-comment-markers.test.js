import { describe, it, expect } from "vitest";

const { insertCommentMarkers } = require("../realtime-collab-manager");

describe("insertCommentMarkers (markdown export)", () => {
  it("places a single marker at position_end", () => {
    const out = insertCommentMarkers("Hello world test", [
      { id: "aaaaaaaa", position_end: 16 },
    ]);
    expect(out).toBe("Hello world test[^aaaaaaaa]");
  });

  it("inserts overlapping/nested markers right-to-left by END position", () => {
    // A spans the whole string (end 16); B marks the word "world" (end 11).
    // Sorting by position_START (the old bug) would order by start and shift
    // A's later insertion; sorting by position_END keeps both correct.
    const content = "Hello world test"; // 16 chars
    const comments = [
      { id: "aaaaaaaa", position_start: 0, position_end: 16 },
      { id: "bbbbbbbb", position_start: 6, position_end: 11 },
    ];
    const out = insertCommentMarkers(content, comments);
    expect(out).toBe("Hello world[^bbbbbbbb] test[^aaaaaaaa]");
  });

  it("is independent of input order (sort handles it)", () => {
    const content = "Hello world test";
    const a = { id: "aaaaaaaa", position_end: 16 };
    const b = { id: "bbbbbbbb", position_end: 11 };
    expect(insertCommentMarkers(content, [a, b])).toBe(
      insertCommentMarkers(content, [b, a]),
    );
  });

  it("skips comments with null/undefined position_end", () => {
    const out = insertCommentMarkers("Hello world test", [
      { id: "aaaaaaaa", position_end: null },
      { id: "bbbbbbbb", position_end: 11 },
      { id: "cccccccc", position_end: undefined },
    ]);
    expect(out).toBe("Hello world[^bbbbbbbb] test");
  });

  it("truncates the marker id to 8 chars", () => {
    const out = insertCommentMarkers("abc", [
      { id: "0123456789abcdef", position_end: 3 },
    ]);
    expect(out).toBe("abc[^01234567]");
  });

  it("returns the content unchanged with no comments", () => {
    expect(insertCommentMarkers("unchanged", [])).toBe("unchanged");
    expect(insertCommentMarkers("unchanged", undefined)).toBe("unchanged");
  });
});
