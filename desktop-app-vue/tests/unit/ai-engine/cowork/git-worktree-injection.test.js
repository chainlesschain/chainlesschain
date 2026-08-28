/**
 * Security regression: git-worktree-manager interpolates branch / worktree path /
 * target (from the skill's task input) into execSync (a shell) via
 * git(`... ${x}`). isSafeRef/isSafePath must reject shell metacharacters and the
 * handlers must NOT exec on unsafe input.
 */
import { describe, it, expect, vi } from "vitest";
import { createTestProcessContext } from "../../../../src/main/ai-engine/cowork/skills/__tests__/helpers/bundled-skill-process.js";

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
    const context = {
      cwd: process.cwd(),
      ...createTestProcessContext("git-worktree-manager", spy),
    };
    const create = await handler.execute({ input: "create main;rm" }, context);
    expect(create.success).toBe(false);
    const remove = await handler.execute(
      { input: "remove /tmp/x;rm" },
      context,
    );
    expect(remove.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
