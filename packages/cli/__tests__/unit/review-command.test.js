/**
 * Unit tests for `cc review` (src/commands/review.js).
 *
 * The pure helpers (resolveDiffArgs / normalizeEffort / resolveReviewMode /
 * buildReviewPrompt) are tested directly. runReview is driven with injected
 * deps (a fake git + a fake runAgentHeadless) so no real git repo or LLM is
 * needed; we assert the diff scope it asks git for and the headless options it
 * dispatches (permission mode, auto-checkpoint, expandFileRefs).
 */
import { describe, it, expect, vi } from "vitest";
import { Command } from "commander";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { log: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const {
  resolveDiffArgs,
  normalizeEffort,
  resolveReviewMode,
  buildReviewPrompt,
  runReview,
  registerReviewCommand,
} = await import("../../src/commands/review.js");

describe("resolveDiffArgs", () => {
  it("defaults to working tree vs HEAD", () => {
    const r = resolveDiffArgs({});
    expect(r.args).toEqual(["diff", "HEAD"]);
    expect(r.scope).toBe("working");
  });
  it("staged → --cached", () => {
    expect(resolveDiffArgs({ staged: true }).args).toEqual([
      "diff",
      "--cached",
    ]);
  });
  it("base → three-dot range vs HEAD", () => {
    const r = resolveDiffArgs({ base: "main" });
    expect(r.args).toEqual(["diff", "main...HEAD"]);
    expect(r.scope).toBe("base");
  });
  it("range passes through", () => {
    expect(resolveDiffArgs({ range: "A..B" }).args).toEqual(["diff", "A..B"]);
  });
  it("appends --stat and path filter", () => {
    const r = resolveDiffArgs({ paths: ["src/a.js", "src/b.js"] }, true);
    expect(r.args).toEqual([
      "diff",
      "HEAD",
      "--stat",
      "--",
      "src/a.js",
      "src/b.js",
    ]);
  });
});

describe("normalizeEffort", () => {
  it("defaults to medium", () => expect(normalizeEffort()).toBe("medium"));
  it("lowercases valid values", () =>
    expect(normalizeEffort("HIGH")).toBe("high"));
  it("rejects unknown", () =>
    expect(() => normalizeEffort("turbo")).toThrow(/Invalid effort/));
});

describe("resolveReviewMode", () => {
  it("default with no flags", () =>
    expect(resolveReviewMode({})).toBe("default"));
  it("security flag", () =>
    expect(resolveReviewMode({ security: true })).toBe("security"));
  it("simplify flag", () =>
    expect(resolveReviewMode({ simplify: true })).toBe("simplify"));
  it("rejects both", () =>
    expect(() => resolveReviewMode({ security: true, simplify: true })).toThrow(
      /mutually exclusive/,
    ));
});

describe("buildReviewPrompt", () => {
  it("review-only forbids edits and embeds the diff", () => {
    const p = buildReviewPrompt({
      diff: "@@ -1 +1 @@\n-old\n+new",
      mode: "default",
      fix: false,
      effort: "medium",
    });
    expect(p).toContain("```diff");
    expect(p).toContain("+new");
    expect(p).toMatch(/Do NOT modify any files/i);
    expect(p).not.toMatch(/APPLY the fixes/i);
  });
  it("fix mode instructs to apply edits", () => {
    const p = buildReviewPrompt({ diff: "x", fix: true });
    expect(p).toMatch(/APPLY the fixes/i);
    expect(p).toMatch(/checkpointed and reversible/i);
  });
  it("security lens for security mode", () => {
    const p = buildReviewPrompt({ diff: "x", mode: "security" });
    expect(p).toMatch(/SECURITY review/i);
  });
  it("simplify lens skips bug hunt", () => {
    const p = buildReviewPrompt({ diff: "x", mode: "simplify" });
    expect(p).toMatch(/CLEANUP-ONLY/i);
    expect(p).toMatch(/do NOT hunt for bugs/i);
  });
  it("notes truncation", () => {
    const p = buildReviewPrompt({ diff: "x", truncated: true });
    expect(p).toMatch(/diff truncated/i);
  });
});

/** A fake git that answers diff / stat / ls-files from a fixture. */
function makeGit({ diff = "patch", stat = "1 file", untracked = "" } = {}) {
  return vi.fn((args) => {
    if (args[0] === "rev-parse") return "true";
    if (args[0] === "ls-files") return untracked;
    if (args[0] === "diff") return args.includes("--stat") ? stat : diff;
    return "";
  });
}

const baseDeps = (over = {}) => ({
  git: makeGit(),
  isGitRepo: () => true,
  loadConfig: () => ({ llm: {} }),
  applyConfigLlmDefaults: vi.fn(),
  runAgentHeadless: vi.fn(async () => ({
    exitCode: 0,
    result: "report",
    isError: false,
  })),
  ...over,
});

describe("runReview", () => {
  it("throws outside a git work tree", async () => {
    await expect(
      runReview({ cwd: "/x" }, baseDeps({ isGitRepo: () => false })),
    ).rejects.toThrow(/git work tree/);
  });

  it("returns empty when there is no diff and no untracked", async () => {
    const deps = baseDeps({ git: makeGit({ diff: "", stat: "", untracked: "" }) });
    const r = await runReview({ cwd: "/repo" }, deps);
    expect(r.empty).toBe(true);
    expect(deps.runAgentHeadless).not.toHaveBeenCalled();
  });

  it("review-only runs in plan mode with no auto-checkpoint", async () => {
    const deps = baseDeps();
    await runReview({ cwd: "/repo" }, deps);
    const opts = deps.runAgentHeadless.mock.calls[0][0];
    expect(opts.permissionMode).toBe("plan");
    expect(opts.autoCheckpoint).toBe(false);
    expect(opts.expandFileRefs).toBe(false);
    expect(opts.maxTurns).toBe(20);
    expect(opts.prompt).toContain("```diff");
  });

  it("--fix runs in acceptEdits mode with auto-checkpoint on", async () => {
    const deps = baseDeps();
    await runReview({ cwd: "/repo", fix: true }, deps);
    const opts = deps.runAgentHeadless.mock.calls[0][0];
    expect(opts.permissionMode).toBe("acceptEdits");
    expect(opts.autoCheckpoint).toBe(true);
    expect(opts.maxTurns).toBe(40);
  });

  it("--fix --no-checkpoint disables auto-checkpoint", async () => {
    const deps = baseDeps();
    await runReview({ cwd: "/repo", fix: true, checkpoint: false }, deps);
    expect(deps.runAgentHeadless.mock.calls[0][0].autoCheckpoint).toBe(false);
  });

  it("asks git for the requested scope (base)", async () => {
    const deps = baseDeps();
    await runReview({ cwd: "/repo", base: "develop" }, deps);
    const diffCall = deps.git.mock.calls.find(
      (c) => c[0][0] === "diff" && !c[0].includes("--stat"),
    );
    expect(diffCall[0]).toEqual(["diff", "develop...HEAD"]);
  });

  it("honors explicit --max-turns", async () => {
    const deps = baseDeps();
    await runReview({ cwd: "/repo", maxTurns: 5 }, deps);
    expect(deps.runAgentHeadless.mock.calls[0][0].maxTurns).toBe(5);
  });

  it("propagates the headless error outcome", async () => {
    const deps = baseDeps({
      runAgentHeadless: vi.fn(async () => ({
        exitCode: 1,
        result: "boom",
        isError: true,
      })),
    });
    const r = await runReview({ cwd: "/repo" }, deps);
    expect(r.isError).toBe(true);
    expect(r.exitCode).toBe(1);
  });
});

describe("registerReviewCommand", () => {
  it("registers a `review` command with the key options", () => {
    const program = new Command();
    registerReviewCommand(program);
    const cmd = program.commands.find((c) => c.name() === "review");
    expect(cmd).toBeTruthy();
    const flags = cmd.options.map((o) => o.long);
    expect(flags).toEqual(
      expect.arrayContaining([
        "--staged",
        "--base",
        "--fix",
        "--security",
        "--simplify",
        "--no-checkpoint",
      ]),
    );
  });
});
