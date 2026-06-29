/**
 * Security regression: git-worktree-manager interpolates branch / worktree path /
 * target (from the skill's task input) into execSync (a shell) via
 * git(`... ${x}`). isSafeRef/isSafePath must reject shell metacharacters and the
 * handlers must NOT exec on unsafe input.
 */
import { describe, it, expect, vi } from "vitest";

const handler = require("../../../../src/main/ai-engine/cowork/skills/builtin/git-worktree-manager/handler.js");

describe("git-worktree-manager injection guards", () => {
  it("isSafeRef accepts refs, rejects metacharacters", () => {
    expect(handler.isSafeRef("feature/x-1")).toBe(true);
    expect(handler.isSafeRef("main; rm -rf ~")).toBe(false);
    expect(handler.isSafeRef("$(whoami)")).toBe(false);
    expect(handler.isSafeRef("a`b`")).toBe(false);
    expect(handler.isSafeRef("")).toBe(false);
  });

  it("isSafePath accepts paths, rejects shell metacharacters / quotes", () => {
    expect(handler.isSafePath("/tmp/wt-1")).toBe(true);
    expect(handler.isSafePath("C:\\work\\wt")).toBe(true);
    expect(handler.isSafePath('x"; rm -rf ~; "')).toBe(false);
    expect(handler.isSafePath("$(rm -rf ~)")).toBe(false);
    expect(handler.isSafePath("a;b")).toBe(false);
  });

  it("does NOT execute on unsafe branch/target", async () => {
    const spy = vi.fn(() => "");
    const orig = handler._deps.execSync;
    handler._deps.execSync = spy;
    try {
      const create = await handler.execute({ input: "create main;rm" });
      expect(create.success).toBe(false);
      const remove = await handler.execute({ input: "remove /tmp/x;rm" });
      expect(remove.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      handler._deps.execSync = orig;
    }
  });
});
