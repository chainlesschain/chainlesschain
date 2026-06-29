/**
 * Security regression: pr-reviewer interpolates the skill's target (PR number /
 * branch ref) into execSync (a shell), so an unsanitized value is a command-
 * injection vector. isSafeRef must reject shell metacharacters, and the handlers
 * must NOT exec when the ref is unsafe.
 */
import { describe, it, expect, vi } from "vitest";

const handler = require("../../../../src/main/ai-engine/cowork/skills/builtin/pr-reviewer/handler.js");

describe("pr-reviewer isSafeRef (command injection guard)", () => {
  it("accepts valid PR numbers and git refs", () => {
    expect(handler.isSafeRef("123")).toBe(true);
    expect(handler.isSafeRef("#123")).toBe(true);
    expect(handler.isSafeRef("main")).toBe(true);
    expect(handler.isSafeRef("feature/foo-bar_1.2")).toBe(true);
    expect(handler.isSafeRef("origin/release-3")).toBe(true);
  });

  it("rejects shell metacharacters / spaces / empties", () => {
    expect(handler.isSafeRef("main; rm -rf ~")).toBe(false);
    expect(handler.isSafeRef("1;rm")).toBe(false);
    expect(handler.isSafeRef("$(whoami)")).toBe(false);
    expect(handler.isSafeRef("a`b`")).toBe(false);
    expect(handler.isSafeRef("a|b")).toBe(false);
    expect(handler.isSafeRef("a&&b")).toBe(false);
    expect(handler.isSafeRef("")).toBe(false);
    expect(handler.isSafeRef(undefined)).toBe(false);
  });

  it("does NOT execute a shell command when the target is unsafe", async () => {
    const spy = vi.fn(() => "");
    const orig = handler._deps.execSync;
    handler._deps.execSync = spy;
    try {
      const review = await handler.execute({ input: "review 1;rm" });
      expect(review.success).toBe(false);
      const summary = await handler.execute({ input: "summary main;evil" });
      expect(summary.success).toBe(false);
      expect(spy).not.toHaveBeenCalled(); // never reached execSync
    } finally {
      handler._deps.execSync = orig;
    }
  });

  it("does execute for a safe target", async () => {
    const spy = vi.fn(() => "abc123 commit msg");
    const orig = handler._deps.execSync;
    handler._deps.execSync = spy;
    try {
      const res = await handler.execute({ input: "summary main" });
      expect(res.success).toBe(true);
      expect(spy).toHaveBeenCalled();
    } finally {
      handler._deps.execSync = orig;
    }
  });
});
