import { describe, it, expect } from "vitest";
import {
  mergeConsecutiveMessages,
  _internal,
} from "../message-roles.js";

describe("mergeConsecutiveMessages", () => {
  it("is a no-op on a healthy alternating transcript", () => {
    const msgs = [
      { role: "system", content: "sys" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    expect(mergeConsecutiveMessages(msgs)).toEqual(msgs);
  });

  it("merges two consecutive user turns (the --resume no-response bug)", () => {
    // history ended with a bare `user` (prior run produced no assistant
    // response); a new user prompt was spliced after it.
    const out = mergeConsecutiveMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "original task" },
      { role: "user", content: "continue please" },
    ]);
    expect(out).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "original task\n\ncontinue please" },
    ]);
  });

  it("merges three-plus consecutive same-role turns", () => {
    const out = mergeConsecutiveMessages([
      { role: "user", content: "one" },
      { role: "user", content: "two" },
      { role: "user", content: "three" },
    ]);
    expect(out).toEqual([{ role: "user", content: "one\n\ntwo\n\nthree" }]);
  });

  it("merges consecutive assistant turns defensively", () => {
    const out = mergeConsecutiveMessages([
      { role: "assistant", content: "x" },
      { role: "assistant", content: "y" },
    ]);
    expect(out).toEqual([{ role: "assistant", content: "x\n\ny" }]);
  });

  it("never merges system messages (leading base + context pair kept distinct)", () => {
    const msgs = [
      { role: "system", content: "base" },
      { role: "system", content: "session-context" },
      { role: "user", content: "hi" },
    ];
    expect(mergeConsecutiveMessages(msgs)).toEqual(msgs);
  });

  it("preserves the user turn after a healthy assistant tail", () => {
    const out = mergeConsecutiveMessages([
      { role: "assistant", content: "done" },
      { role: "user", content: "next" },
    ]);
    expect(out).toEqual([
      { role: "assistant", content: "done" },
      { role: "user", content: "next" },
    ]);
  });

  it("combines multimodal content arrays when merging user turns", () => {
    const out = mergeConsecutiveMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", source: "x" },
        ],
      },
      { role: "user", content: "and describe" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
    expect(out[0].content).toEqual([
      { type: "text", text: "look" },
      { type: "image", source: "x" },
      { type: "text", text: "and describe" },
    ]);
  });

  it("treats an empty-string content as nothing when merging", () => {
    const out = mergeConsecutiveMessages([
      { role: "user", content: "" },
      { role: "user", content: "real" },
    ]);
    expect(out).toEqual([{ role: "user", content: "real" }]);
  });

  it("does not mutate the input array or its messages", () => {
    const input = [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeConsecutiveMessages(input);
    expect(input).toEqual(snapshot);
  });

  it("passes through falsy / role-less entries verbatim without crashing", () => {
    const out = mergeConsecutiveMessages([
      null,
      { content: "no role" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
    expect(out).toEqual([
      null,
      { content: "no role" },
      { role: "user", content: "a\n\nb" },
    ]);
  });

  it("returns the argument unchanged when not an array", () => {
    expect(mergeConsecutiveMessages(null)).toBe(null);
    expect(mergeConsecutiveMessages(undefined)).toBe(undefined);
  });

  describe("_internal.joinContent", () => {
    const { joinContent } = _internal;
    it("joins two strings with a blank line", () => {
      expect(joinContent("a", "b")).toBe("a\n\nb");
    });
    it("returns the non-empty side when one string is empty", () => {
      expect(joinContent("", "b")).toBe("b");
      expect(joinContent("a", "")).toBe("a");
    });
    it("promotes a string to a text block when joining with an array", () => {
      expect(joinContent("hi", [{ type: "image", source: "x" }])).toEqual([
        { type: "text", text: "hi" },
        { type: "image", source: "x" },
      ]);
    });
  });
});
