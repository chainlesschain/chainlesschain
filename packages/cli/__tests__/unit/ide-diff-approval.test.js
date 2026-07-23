/**
 * IDE-native diff approval (gap #4, Claude-Code parity) — when a settings
 * `ask` fires for a file edit in an INTERACTIVE session with an IDE bridge
 * connected, the confirmation is the editor's blocking openDiff review:
 *   accepted → the IDE already wrote the (possibly user-edited) text, the
 *              tool's own write is SKIPPED (approval replaces execution)
 *   rejected → denied, file untouched
 *   IDE dead / no proposal → fall back to the terminal confirm
 * Headless (no permissionConfirm) never routes to the IDE (fail-closed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ideDiffApprovalEnabled,
  hasIdeOpenDiff,
  requestIdeDiffApproval,
  normalizeDiffReviewAudit,
  formatReviewComments,
  summarizeUserAmendments,
} from "../../src/lib/ide-context.js";
import {
  computeProposedEdit,
  executeTool,
} from "../../src/runtime/agent-core.js";

const txt = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});

const audit = (over = {}) => ({
  schema: "cc-diff-review/v1",
  reviewId: "drev_1234567890abcdef12345678",
  createdAt: "2026-07-23T00:00:00.000Z",
  actor: "local-user",
  host: "vscode",
  path: "/spoofed",
  outcome: "accepted",
  source: "agent-proposed",
  written: true,
  proposed: {
    sha256: "a".repeat(64),
    chars: 3,
    lines: 1,
  },
  selectedHunks: [],
  comments: [],
  ...over,
});

function fakeDiffMcp({ callTool } = {}) {
  const calls = [];
  return {
    mcpClient: {
      callTool:
        callTool ||
        (async (server, tool, args) => {
          calls.push({ server, tool, args });
          return txt({ outcome: "accepted", finalText: args.modifiedText });
        }),
    },
    externalToolExecutors: {
      mcp__ide__openDiff: {
        kind: "mcp",
        serverName: "ide",
        toolName: "openDiff",
      },
    },
    calls,
  };
}

/** An mcp surface WITHOUT openDiff (selection tools only). */
function selectionOnlyMcp() {
  return {
    mcpClient: { callTool: async () => txt(null) },
    externalToolExecutors: {
      mcp__ide__getSelection: {
        kind: "mcp",
        serverName: "ide",
        toolName: "getSelection",
      },
    },
  };
}

describe("ideDiffApprovalEnabled / hasIdeOpenDiff", () => {
  it("defaults on; 0/false/off disable", () => {
    expect(ideDiffApprovalEnabled({})).toBe(true);
    expect(ideDiffApprovalEnabled({ CC_IDE_DIFF_APPROVAL: "0" })).toBe(false);
    expect(ideDiffApprovalEnabled({ CC_IDE_DIFF_APPROVAL: "off" })).toBe(false);
  });
  it("detects the openDiff executor", () => {
    expect(hasIdeOpenDiff(fakeDiffMcp())).toBe(true);
    expect(hasIdeOpenDiff(selectionOnlyMcp())).toBe(false);
    expect(hasIdeOpenDiff(null)).toBe(false);
  });
});

describe("requestIdeDiffApproval", () => {
  it("returns accepted with finalText and forwards the request", async () => {
    const mcp = fakeDiffMcp();
    const v = await requestIdeDiffApproval(mcp, {
      path: "C:/x/a.js",
      modifiedText: "new",
      originalText: "old",
      title: "t",
    });
    expect(v).toEqual({ outcome: "accepted", finalText: "new" });
    expect(mcp.calls[0]).toMatchObject({
      server: "ide",
      tool: "openDiff",
      args: { path: "C:/x/a.js", modifiedText: "new", originalText: "old" },
    });
  });

  it("forwards an explicit rename operation and destination", async () => {
    const mcp = fakeDiffMcp();
    await requestIdeDiffApproval(mcp, {
      path: "C:/x/old.js",
      targetPath: "C:/x/new.js",
      operation: "rename",
      modifiedText: "same",
      originalText: "same",
    });
    expect(mcp.calls[0].args).toMatchObject({
      path: "C:/x/old.js",
      targetPath: "C:/x/new.js",
      operation: "rename",
      modifiedText: "same",
    });
  });

  it("returns rejected", async () => {
    const mcp = fakeDiffMcp({
      callTool: async () => txt({ outcome: "rejected" }),
    });
    expect(
      await requestIdeDiffApproval(mcp, { path: "p", modifiedText: "m" }),
    ).toEqual({ outcome: "rejected" });
  });

  it("bounds the audit and binds correlation ids from the CLI request", async () => {
    const mcp = fakeDiffMcp({
      callTool: async (_server, _tool, args) =>
        txt({
          outcome: "accepted",
          finalText: "new",
          audit: audit({
            outcome: "changes-requested",
            operation: "rename",
            targetPath: "C:/spoofed.js",
            sessionId: "spoofed-session",
            comments: [
              {
                line: 0,
                lineFingerprint: {
                  sha256: "b".repeat(64),
                  chars: 8,
                  lines: 1,
                },
                note: "n".repeat(1500),
                unexpected: "drop",
              },
            ],
            unexpected: "drop",
          }),
          receivedContext: args.reviewContext,
        }),
    });
    const result = await requestIdeDiffApproval(mcp, {
      path: "C:/x/a.js",
      modifiedText: "new",
      sessionId: "sess-1",
      turnId: "run-1:t2",
      toolUseId: "call-7",
    });
    expect(result.audit).toMatchObject({
      schema: "cc-diff-review/v1",
      path: "C:/x/a.js",
      sessionId: "sess-1",
      turnId: "run-1:t2",
      toolUseId: "call-7",
      outcome: "accepted",
      followUpRequested: false,
      operation: "modify",
      targetPath: null,
      proposed: { sha256: "a".repeat(64), chars: 3, lines: 1 },
    });
    expect(result.audit.comments[0].note).toHaveLength(1000);
    expect(result.audit).not.toHaveProperty("unexpected");
    expect(result.audit.comments[0]).not.toHaveProperty("unexpected");
  });

  it("rejects malformed or unknown audit envelopes", () => {
    expect(normalizeDiffReviewAudit(null)).toBeNull();
    expect(
      normalizeDiffReviewAudit({ schema: "cc-diff-review/v2" }),
    ).toBeNull();
  });

  it("returns changes-requested with comments and reviewedText", async () => {
    const comments = [
      { line: 4, endLine: 4, lineText: "let x", note: "use const" },
    ];
    const mcp = fakeDiffMcp({
      callTool: async () =>
        txt({ outcome: "changes-requested", comments, reviewedText: "edited" }),
    });
    expect(
      await requestIdeDiffApproval(mcp, { path: "p", modifiedText: "m" }),
    ).toEqual({
      outcome: "changes-requested",
      comments,
      reviewedText: "edited",
    });
  });

  it("changes-requested coerces missing comments/reviewedText to []/null", async () => {
    const mcp = fakeDiffMcp({
      callTool: async () => txt({ outcome: "changes-requested" }),
    });
    expect(
      await requestIdeDiffApproval(mcp, { path: "p", modifiedText: "m" }),
    ).toEqual({
      outcome: "changes-requested",
      comments: [],
      reviewedText: null,
    });
  });

  it("returns null on transport error, malformed verdict, or bad request", async () => {
    const dead = fakeDiffMcp({
      callTool: async () => {
        throw new Error("dead");
      },
    });
    expect(
      await requestIdeDiffApproval(dead, { path: "p", modifiedText: "m" }),
    ).toBe(null);
    const weird = fakeDiffMcp({ callTool: async () => txt({ shown: true }) });
    expect(
      await requestIdeDiffApproval(weird, { path: "p", modifiedText: "m" }),
    ).toBe(null);
    expect(await requestIdeDiffApproval(fakeDiffMcp(), { path: "p" })).toBe(
      null,
    );
    expect(
      await requestIdeDiffApproval(selectionOnlyMcp(), {
        path: "p",
        modifiedText: "m",
      }),
    ).toBe(null);
  });
});

describe("formatReviewComments", () => {
  it("renders line-anchored notes with 1-based lines and a file header", () => {
    const out = formatReviewComments(
      [
        { line: 4, endLine: 4, lineText: "let x = 1", note: "use const" },
        { line: 9, endLine: 11, note: "extract a helper" },
        { note: "general nit" },
      ],
      { path: "C:/x/a.js" },
    );
    expect(out).toContain("Review comments on C:/x/a.js:");
    expect(out).toContain("• line 5: use const  ⟪let x = 1⟫");
    expect(out).toContain("• lines 10-12: extract a helper");
    expect(out).toContain("• (general): general nit");
  });

  it("returns null when there is no actionable note", () => {
    expect(formatReviewComments([])).toBe(null);
    expect(formatReviewComments(null)).toBe(null);
    expect(formatReviewComments([{ line: 1 }, { note: "   " }])).toBe(null);
  });
});

describe("summarizeUserAmendments", () => {
  it("returns null for equal texts or non-strings", () => {
    expect(summarizeUserAmendments("same", "same")).toBe(null);
    expect(summarizeUserAmendments(null, "x")).toBe(null);
    expect(summarizeUserAmendments("x", undefined)).toBe(null);
  });

  it("renders a -/+ delta anchored to the final file's 1-based line", () => {
    const proposed = "a\nlet x = 1\nc";
    const final_ = "a\nconst x = 1\nc";
    const out = summarizeUserAmendments(proposed, final_);
    expect(out).toContain("edited the proposal in the IDE diff");
    expect(out).toContain("@ line 2:");
    expect(out).toContain("- let x = 1");
    expect(out).toContain("+ const x = 1");
  });

  it("reports each separated change block with its own anchor", () => {
    const proposed = "a\nB1\nc\nd\nE1\nf";
    const final_ = "a\nB2\nc\nd\nE2a\nE2b\nf";
    const out = summarizeUserAmendments(proposed, final_);
    expect(out).toContain("@ line 2:");
    expect(out).toContain("- B1");
    expect(out).toContain("+ B2");
    expect(out).toContain("@ line 5:");
    expect(out).toContain("- E1");
    expect(out).toContain("+ E2a");
    expect(out).toContain("+ E2b");
  });

  it("handles pure insertions and deletions", () => {
    const ins = summarizeUserAmendments("a\nb", "a\nX\nb");
    expect(ins).toContain("+ X");
    expect(ins).not.toContain("- a");
    const del = summarizeUserAmendments("a\nX\nb", "a\nb");
    expect(del).toContain("- X");
    expect(del).not.toContain("+ a");
  });

  it("caps the body at maxLines and maxChars", () => {
    const proposed = Array.from({ length: 200 }, (_, i) => `p${i}`).join("\n");
    const final_ = Array.from({ length: 200 }, (_, i) => `f${i}`).join("\n");
    const out = summarizeUserAmendments(proposed, final_, {
      maxLines: 10,
      maxChars: 100000,
    });
    expect(out).toMatch(/… \(\d+ more lines changed\)/);
    const tight = summarizeUserAmendments(proposed, final_, { maxChars: 300 });
    expect(tight.length).toBeLessThanOrEqual(320);
    expect(tight).toContain("… (truncated)");
  });

  it("degrades to one coarse block on pathological sizes without blowing up", () => {
    // > 1M DP cells after trim (uniquely-numbered lines defeat the trim).
    const proposed = Array.from({ length: 1100 }, (_, i) => `a${i}`).join("\n");
    const final_ = Array.from({ length: 1100 }, (_, i) => `b${i}`).join("\n");
    const out = summarizeUserAmendments(proposed, final_, { maxLines: 6 });
    expect(out).toContain("@ line 1:");
    expect(out).toMatch(/… \(\d+ more lines changed\)/);
  });
});

describe("computeProposedEdit", () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-proposed-"));
    fs.writeFileSync(path.join(tmp, "a.js"), "const x = 1;\n", "utf-8");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("write_file: proposes content with the on-disk original (or empty)", () => {
    const p1 = computeProposedEdit(
      "write_file",
      { path: "a.js", content: "Z" },
      tmp,
    );
    expect(p1).toMatchObject({
      newContent: "Z",
      originalText: "const x = 1;\n",
      operation: "modify",
    });
    const p2 = computeProposedEdit(
      "write_file",
      { path: "new.js", content: "Z" },
      tmp,
    );
    expect(p2).toMatchObject({
      newContent: "Z",
      originalText: "",
      operation: "create",
    });
  });

  it("delete_file and move_file preserve explicit lifecycle intent", () => {
    const deleted = computeProposedEdit("delete_file", { path: "a.js" }, tmp);
    expect(deleted).toMatchObject({
      operation: "delete",
      originalText: "const x = 1;\n",
      newContent: "",
    });

    const moved = computeProposedEdit(
      "move_file",
      { path: "a.js", target_path: "renamed.js" },
      tmp,
    );
    expect(moved).toMatchObject({
      operation: "rename",
      originalText: "const x = 1;\n",
      newContent: "const x = 1;\n",
      targetPath: path.join(tmp, "renamed.js"),
    });
    expect(fs.existsSync(path.join(tmp, "a.js"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "renamed.js"))).toBe(false);
  });

  it("edit_file: applies the replacement without writing", () => {
    const p = computeProposedEdit(
      "edit_file",
      { path: "a.js", old_string: "x = 1", new_string: "x = 2" },
      tmp,
    );
    expect(p.newContent).toBe("const x = 2;\n");
    expect(fs.readFileSync(path.join(tmp, "a.js"), "utf-8")).toBe(
      "const x = 1;\n",
    );
  });

  it("returns null when the edit cannot be computed", () => {
    expect(
      computeProposedEdit(
        "edit_file",
        { path: "a.js", old_string: "nope", new_string: "x" },
        tmp,
      ),
    ).toBe(null);
    expect(
      computeProposedEdit(
        "edit_file",
        { path: "missing.js", old_string: "a", new_string: "b" },
        tmp,
      ),
    ).toBe(null);
    expect(
      computeProposedEdit(
        "edit_file_hashed",
        { path: "a.js", anchor_hash: "zzzzzz", new_line: "x" },
        tmp,
      ),
    ).toBe(null);
    expect(computeProposedEdit("run_shell", { command: "ls" }, tmp)).toBe(null);
  });
});

describe("executeTool — IDE diff approval wiring (settings ask)", () => {
  const ASK_RULES = { allow: [], ask: ["Write", "Edit"], deny: [] };
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-diffappr-"));
    process.env.CC_IDE_DIAG_SETTLE_MS = "0";
  });
  afterEach(() => {
    delete process.env.CC_IDE_DIAG_SETTLE_MS;
    delete process.env.CC_IDE_DIFF_APPROVAL;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ctx = (mcp, over = {}) => ({
    cwd: tmp,
    permissionRules: ASK_RULES,
    permissionConfirm: vi.fn(async () => true),
    mcpClient: mcp ? mcp.mcpClient : undefined,
    externalToolExecutors: mcp ? mcp.externalToolExecutors : undefined,
    ...over,
  });

  it("accepted review replaces execution (IDE wrote; tool write skipped)", async () => {
    const mcp = fakeDiffMcp();
    const context = ctx(mcp);
    const res = await executeTool(
      "write_file",
      { path: "out.js", content: "const a = 1;" },
      context,
    );
    expect(res).toMatchObject({
      success: true,
      appliedVia: "ide-diff",
      policy: { decision: "allow", via: "ide-diff" },
    });
    expect(res.userEdited).toBeUndefined();
    expect(fs.existsSync(path.join(tmp, "out.js"))).toBe(false);
    expect(context.permissionConfirm).not.toHaveBeenCalled();
    expect(mcp.calls[0].args.title).toContain("write_file");
  });

  it("routes delete and rename as explicit IDE lifecycle reviews", async () => {
    const source = path.join(tmp, "lifecycle.js");
    fs.writeFileSync(source, "x", "utf8");
    const mcp = fakeDiffMcp();

    const deleted = await executeTool(
      "delete_file",
      { path: "lifecycle.js" },
      ctx(mcp),
    );
    expect(deleted).toMatchObject({
      success: true,
      operation: "delete",
      appliedVia: "ide-diff",
    });
    expect(mcp.calls[0].args).toMatchObject({
      operation: "delete",
      modifiedText: "",
      originalText: "x",
    });

    const moved = await executeTool(
      "move_file",
      { path: "lifecycle.js", target_path: "renamed.js" },
      ctx(mcp),
    );
    expect(moved).toMatchObject({
      success: true,
      operation: "rename",
      targetPath: path.join(tmp, "renamed.js"),
      appliedVia: "ide-diff",
    });
    expect(mcp.calls[1].args).toMatchObject({
      operation: "rename",
      targetPath: path.join(tmp, "renamed.js"),
    });
    // The fake host reports acceptance but intentionally performs no I/O.
    expect(fs.existsSync(source)).toBe(true);
  });

  it("executes delete and move safely when an allow rule bypasses IDE review", async () => {
    const deletePath = path.join(tmp, "delete.js");
    const movePath = path.join(tmp, "move.js");
    const targetPath = path.join(tmp, "moved.js");
    fs.writeFileSync(deletePath, "delete", "utf8");
    fs.writeFileSync(movePath, "move", "utf8");
    const context = ctx(null, {
      permissionRules: { allow: ["Edit"], ask: [], deny: [] },
    });

    const deleted = await executeTool(
      "delete_file",
      { path: "delete.js" },
      context,
    );
    expect(deleted).toMatchObject({ success: true, operation: "delete" });
    expect(fs.existsSync(deletePath)).toBe(false);

    const moved = await executeTool(
      "move_file",
      { path: "move.js", target_path: "moved.js" },
      context,
    );
    expect(moved).toMatchObject({
      success: true,
      operation: "rename",
      targetPath,
    });
    expect(fs.existsSync(movePath)).toBe(false);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("move");
  });

  it("keeps a bound audit off the model-facing JSON result", async () => {
    let requestArgs;
    const mcp = fakeDiffMcp({
      callTool: async (_server, _tool, args) => {
        requestArgs = args;
        return txt({
          outcome: "accepted",
          finalText: args.modifiedText,
          audit: audit(),
        });
      },
    });
    const res = await executeTool(
      "write_file",
      { path: "audited.js", content: "x" },
      ctx(mcp, {
        sessionId: "sess-1",
        turnId: "run-1:t2",
        toolCallId: "call-7",
      }),
    );
    expect(requestArgs.reviewContext).toEqual({
      sessionId: "sess-1",
      turnId: "run-1:t2",
      toolUseId: "call-7",
    });
    expect(res._diffReviewAudit).toMatchObject({
      sessionId: "sess-1",
      turnId: "run-1:t2",
      toolUseId: "call-7",
    });
    expect(Object.keys(res)).not.toContain("_diffReviewAudit");
    expect(JSON.stringify(res)).not.toContain("cc-diff-review/v1");
  });

  it("flags userEdited AND hands the agent the -/+ amendments", async () => {
    const mcp = fakeDiffMcp({
      callTool: async (_s, _t, args) =>
        txt({
          outcome: "accepted",
          finalText: args.modifiedText + "\n// tweaked by reviewer",
        }),
    });
    const res = await executeTool(
      "write_file",
      { path: "o.js", content: "x" },
      ctx(mcp),
    );
    expect(res.userEdited).toBe(true);
    expect(res.userAmendments).toContain("edited the proposal in the IDE diff");
    expect(res.userAmendments).toContain("+ // tweaked by reviewer");
  });

  it("rejected review denies without touching the file", async () => {
    fs.writeFileSync(path.join(tmp, "a.js"), "const x = 1;\n", "utf-8");
    const mcp = fakeDiffMcp({
      callTool: async () => txt({ outcome: "rejected" }),
    });
    const context = ctx(mcp);
    const res = await executeTool(
      "edit_file",
      { path: "a.js", old_string: "x = 1", new_string: "x = 2" },
      context,
    );
    expect(res.error).toMatch(/rejected in the IDE diff review/);
    expect(res.policy).toMatchObject({ decision: "deny", via: "ide-diff" });
    expect(fs.readFileSync(path.join(tmp, "a.js"), "utf-8")).toBe(
      "const x = 1;\n",
    );
    expect(context.permissionConfirm).not.toHaveBeenCalled();
  });

  it("changes-requested feeds review notes back without touching the file", async () => {
    fs.writeFileSync(path.join(tmp, "a.js"), "const x = 1;\n", "utf-8");
    const mcp = fakeDiffMcp({
      callTool: async () =>
        txt({
          outcome: "changes-requested",
          comments: [{ line: 0, note: "rename x to count" }],
          reviewedText: "const x = 2;\n",
        }),
    });
    const context = ctx(mcp);
    const res = await executeTool(
      "edit_file",
      { path: "a.js", old_string: "x = 1", new_string: "x = 2" },
      context,
    );
    expect(res.error).toMatch(/the user requested changes/);
    expect(res.error).toMatch(/rename x to count/);
    expect(res.error).toMatch(/propose it again/);
    expect(res.policy).toMatchObject({
      decision: "deny",
      via: "ide-diff-review",
    });
    expect(res.reviewComments).toEqual([
      { line: 0, note: "rename x to count" },
    ]);
    expect(fs.readFileSync(path.join(tmp, "a.js"), "utf-8")).toBe(
      "const x = 1;\n",
    );
    expect(context.permissionConfirm).not.toHaveBeenCalled();
  });

  it("falls back to terminal confirm when the IDE dies mid-review", async () => {
    const mcp = fakeDiffMcp({
      callTool: async () => {
        throw new Error("ide gone");
      },
    });
    const context = ctx(mcp);
    const res = await executeTool(
      "write_file",
      { path: "fb.js", content: "ok" },
      context,
    );
    expect(context.permissionConfirm).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(fs.readFileSync(path.join(tmp, "fb.js"), "utf-8")).toBe("ok");
  });

  it("falls back to terminal confirm when no proposal is computable", async () => {
    const mcp = fakeDiffMcp();
    const context = ctx(mcp);
    const res = await executeTool(
      "edit_file",
      { path: "ghost.js", old_string: "a", new_string: "b" },
      context,
    );
    expect(mcp.calls).toHaveLength(0); // no diff without a proposal
    expect(context.permissionConfirm).toHaveBeenCalled();
    expect(res.error).toMatch(/File not found/); // tool produced its own error
  });

  it("stays out of headless (no permissionConfirm → fail-closed, no diff)", async () => {
    const mcp = fakeDiffMcp();
    const res = await executeTool(
      "write_file",
      { path: "h.js", content: "x" },
      ctx(mcp, { permissionConfirm: undefined }),
    );
    expect(res.error).toMatch(/requires confirmation/);
    expect(mcp.calls).toHaveLength(0);
  });

  it("CC_IDE_DIFF_APPROVAL=0 routes back to terminal confirm", async () => {
    process.env.CC_IDE_DIFF_APPROVAL = "0";
    const mcp = fakeDiffMcp();
    const context = ctx(mcp);
    await executeTool("write_file", { path: "k.js", content: "x" }, context);
    expect(mcp.calls).toHaveLength(0);
    expect(context.permissionConfirm).toHaveBeenCalled();
  });

  it("non-edit tools never route to the IDE diff", async () => {
    const mcp = fakeDiffMcp();
    const context = ctx(mcp, {
      permissionRules: { allow: [], ask: ["Read"], deny: [] },
    });
    fs.writeFileSync(path.join(tmp, "r.txt"), "hi", "utf-8");
    await executeTool("read_file", { path: "r.txt" }, context);
    expect(mcp.calls).toHaveLength(0);
    expect(context.permissionConfirm).toHaveBeenCalled();
  });
});

describe("executeTool — IDE diff approval wiring (PreToolUse hook ask)", () => {
  const HOOK_ASK =
    "node -e \"console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:'ask'}}))\"";
  const askHooks = (matcher = "*") => ({
    PreToolUse: [{ matcher, hooks: [{ type: "command", command: HOOK_ASK }] }],
  });
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hookdiff-"));
    process.env.CC_IDE_DIAG_SETTLE_MS = "0";
  });
  afterEach(() => {
    delete process.env.CC_IDE_DIAG_SETTLE_MS;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ctx = (mcp, over = {}) => ({
    cwd: tmp,
    settingsHooks: askHooks(),
    permissionConfirm: vi.fn(async () => true),
    mcpClient: mcp ? mcp.mcpClient : undefined,
    externalToolExecutors: mcp ? mcp.externalToolExecutors : undefined,
    ...over,
  });

  it("hook ask + accepted diff replaces execution", async () => {
    const mcp = fakeDiffMcp();
    const context = ctx(mcp);
    const res = await executeTool(
      "write_file",
      { path: "h-ok.js", content: "x" },
      context,
    );
    expect(res).toMatchObject({ success: true, appliedVia: "ide-diff" });
    expect(res.policy.rule).toMatch(/^hook:/);
    expect(fs.existsSync(path.join(tmp, "h-ok.js"))).toBe(false);
    expect(context.permissionConfirm).not.toHaveBeenCalled();
  });

  it("hook ask + rejected diff denies with via ide-diff (not via hook)", async () => {
    const mcp = fakeDiffMcp({
      callTool: async () => txt({ outcome: "rejected" }),
    });
    const context = ctx(mcp);
    const res = await executeTool(
      "write_file",
      { path: "h-no.js", content: "x" },
      context,
    );
    expect(res.error).toMatch(/rejected in the IDE diff review/);
    expect(res.policy).toMatchObject({ decision: "deny", via: "ide-diff" });
    expect(fs.existsSync(path.join(tmp, "h-no.js"))).toBe(false);
  });

  it("hook ask + changes-requested denies with review notes (via ide-diff-review)", async () => {
    const mcp = fakeDiffMcp({
      callTool: async () =>
        txt({
          outcome: "changes-requested",
          comments: [{ line: 2, note: "add a null check" }],
        }),
    });
    const context = ctx(mcp);
    const res = await executeTool(
      "write_file",
      { path: "h-cr.js", content: "x" },
      context,
    );
    expect(res.error).toMatch(/the user requested changes/);
    expect(res.error).toMatch(/add a null check/);
    expect(res.policy).toMatchObject({ via: "ide-diff-review" });
    expect(fs.existsSync(path.join(tmp, "h-cr.js"))).toBe(false);
    expect(context.permissionConfirm).not.toHaveBeenCalled();
  });

  it("hook ask without an IDE still uses the terminal confirm", async () => {
    const context = ctx(null);
    const res = await executeTool(
      "write_file",
      { path: "h-fb.js", content: "ok" },
      context,
    );
    expect(context.permissionConfirm).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(fs.readFileSync(path.join(tmp, "h-fb.js"), "utf-8")).toBe("ok");
  });
});
