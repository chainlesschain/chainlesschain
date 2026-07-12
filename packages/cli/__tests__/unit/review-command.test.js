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
  parseFindings,
  buildCommentBody,
  buildReviewPayload,
  postReviewComments,
  runReviewComment,
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
    const deps = baseDeps({
      git: makeGit({ diff: "", stat: "", untracked: "" }),
    });
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

describe("buildReviewPrompt — comment mode", () => {
  it("asks for a JSON findings array and forbids prose", () => {
    const p = buildReviewPrompt({ diff: "x", comment: true });
    expect(p).toMatch(/ONLY a JSON array/i);
    expect(p).toMatch(/"severity"/);
    expect(p).toMatch(/output exactly \[\]/i);
    expect(p).not.toMatch(/Markdown report/i);
  });
});

describe("parseFindings", () => {
  it("parses a bare JSON array", () => {
    const f = parseFindings(
      '[{"path":"a.js","line":3,"severity":"High","title":"bug","body":"fix it"}]',
    );
    expect(f).toEqual([
      { path: "a.js", line: 3, severity: "High", title: "bug", body: "fix it" },
    ]);
  });
  it("strips a ```json fence and surrounding prose", () => {
    const f = parseFindings(
      'Here are findings:\n```json\n[{"path":"b.ts","line":10,"body":"x"}]\n```\nThanks',
    );
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe("b.ts");
    expect(f[0].severity).toBe("Note"); // default when missing
  });
  it("returns [] for empty / no-array / invalid", () => {
    expect(parseFindings("")).toEqual([]);
    expect(parseFindings("no json here")).toEqual([]);
    expect(parseFindings("[not valid")).toEqual([]);
    expect(parseFindings("[]")).toEqual([]);
  });
  it("drops findings without a valid path/line", () => {
    const f = parseFindings(
      '[{"path":"a","line":1,"body":"ok"},{"line":2,"body":"no path"},{"path":"b","line":0,"body":"bad line"}]',
    );
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe("a");
  });
  it("survives trailing prose with a stray ] (no greedy over-capture)", () => {
    // Greedy first-[..last-] would slice through the trailing "[1]" and fail to
    // parse, silently dropping the real finding. Balanced extraction recovers it.
    const f = parseFindings(
      'Findings: [{"path":"a.js","line":7,"body":"bug"}]. See note [1] for context.',
    );
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe("a.js");
    expect(f[0].line).toBe(7);
  });

  it("dedupes repeated findings for the same path:line:title (P2)", () => {
    const f = parseFindings(
      '[{"path":"a.js","line":3,"severity":"Low","title":"bug","body":"x"},' +
        '{"path":"a.js","line":3,"severity":"High","title":"Bug","body":"y"}]',
    );
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("High"); // keeps the higher severity
  });
});

describe("buildCommentBody / buildReviewPayload", () => {
  it("formats a comment body with severity + title", () => {
    expect(buildCommentBody({ severity: "High", title: "T", body: "B" })).toBe(
      "**[High]** T\n\nB",
    );
  });
  it("builds a GitHub review payload with inline comments", () => {
    const payload = buildReviewPayload(
      [{ path: "a.js", line: 5, severity: "Low", title: "t", body: "b" }],
      { commitId: "abc123" },
    );
    expect(payload.event).toBe("COMMENT");
    expect(payload.commit_id).toBe("abc123");
    expect(payload.comments).toEqual([
      { path: "a.js", line: 5, side: "RIGHT", body: "**[Low]** t\n\nb" },
    ]);
  });
});

describe("postReviewComments", () => {
  it("POSTs the review payload to the PR via gh api", () => {
    const gh = vi.fn(() => '{"id":1}');
    const r = postReviewComments(
      { repo: "o/r", number: 7 },
      [{ path: "a", line: 1, severity: "Low", title: "t", body: "b" }],
      { gh, cwd: "/repo", commitId: "sha1" },
    );
    expect(r).toEqual({ id: 1 });
    const [args, opts] = gh.mock.calls[0];
    expect(args).toEqual([
      "api",
      "--method",
      "POST",
      "repos/o/r/pulls/7/reviews",
      "--input",
      "-",
    ]);
    const sent = JSON.parse(opts.input);
    expect(sent.commit_id).toBe("sha1");
    expect(sent.comments[0].path).toBe("a");
  });
  it("throws when the PR isn't resolved", () => {
    expect(() => postReviewComments({}, [], { gh: vi.fn() })).toThrow(
      /not resolved/,
    );
  });
});

describe("runReviewComment", () => {
  const prJson = JSON.stringify({
    number: 12,
    baseRefName: "main",
    headRefName: "feat",
    headRefOid: "deadbeef",
    url: "https://gh/pr/12",
  });
  const commentDeps = (over = {}) => ({
    git: makeGit(),
    isGitRepo: () => true,
    loadConfig: () => ({ llm: {} }),
    applyConfigLlmDefaults: vi.fn(),
    gh: vi.fn((args) =>
      args[1] === "view" ? prJson : '{"nameWithOwner":"o/r"}',
    ),
    runAgentHeadless: vi.fn(async () => ({
      result:
        '[{"path":"a.js","line":2,"severity":"High","title":"bug","body":"fix"}]',
      isError: false,
    })),
    ...over,
  });

  it("resolves the PR, defaults scope to PR base, returns findings", async () => {
    const deps = commentDeps();
    const res = await runReviewComment({ cwd: "/repo" }, deps);
    expect(res.pr.number).toBe(12);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].path).toBe("a.js");
    // diff requested against the PR base (main...HEAD)
    const diffCall = deps.git.mock.calls.find(
      (c) => c[0][0] === "diff" && !c[0].includes("--stat"),
    );
    expect(diffCall[0]).toEqual(["diff", "main...HEAD"]);
    // ran read-only (plan mode)
    expect(deps.runAgentHeadless.mock.calls[0][0].permissionMode).toBe("plan");
  });

  it("propagates a missing-PR error", async () => {
    const deps = commentDeps({
      gh: vi.fn(() => {
        throw new Error("no pull requests found");
      }),
    });
    await expect(runReviewComment({ cwd: "/repo" }, deps)).rejects.toThrow(
      /no open PR/,
    );
  });

  it("returns empty when the PR diff is empty", async () => {
    const deps = commentDeps({ git: makeGit({ diff: "", stat: "" }) });
    const res = await runReviewComment({ cwd: "/repo" }, deps);
    expect(res.empty).toBe(true);
    expect(deps.runAgentHeadless).not.toHaveBeenCalled();
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
        "--comment",
        "--dry-run",
      ]),
    );
  });
});
