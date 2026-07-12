/**
 * cc review — diff-first code review (Claude-Code `/code-review` parity).
 *
 *   cc review                      review the working tree vs HEAD
 *   cc review --staged             review staged changes only (git diff --cached)
 *   cc review --base main          review this branch vs main (main...HEAD)
 *   cc review --range A..B         review an explicit revision range
 *   cc review high                 broader, more thorough pass (effort tier)
 *   cc review --fix                apply fixes to the working tree (reversible)
 *   cc review --security           security-focused review (/security-review)
 *   cc review --simplify           cleanup-only review (/simplify), no bug hunt
 *
 * "Diff-first" means the changed lines are collected with git and handed to the
 * agent up front, so the review is anchored on what actually changed instead of
 * the whole repo. The agent still has read/search tools to open surrounding code
 * for context.
 *
 * Two modes:
 *  - review-only (default): runs in PLAN permission mode → the agent is clamped
 *    to read-only tools and CANNOT modify files. It emits a Markdown findings
 *    report on stdout.
 *  - --fix: runs in acceptEdits mode with auto-checkpointing ON, so the agent
 *    applies the fixes directly; every file edit is captured as a git-plumbing
 *    shadow commit first, so the whole pass is reversible with `cc checkpoint
 *    restore <id>`.
 *
 * Requires a git work tree (the diff is the input). LLM defaults follow
 * .chainlesschain/config.json `llm` exactly like `cc agent` / `cc ask`.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { firstBalancedJson } from "../lib/json-schema-output.js";
import {
  dedupeFindings,
  buildReviewReport,
  findingKey,
} from "../lib/review-pipeline.js";

/** Diffs larger than this are truncated before going to the model. */
const MAX_DIFF_CHARS = 200_000;
/** Per-untracked-file and total caps when inlining brand-new files. */
const MAX_UNTRACKED_FILE_CHARS = 32_000;
const MAX_UNTRACKED_TOTAL_CHARS = 128_000;

const VALID_EFFORTS = Object.freeze(["low", "medium", "high"]);

/**
 * Run git with an argv array (no shell → no quoting hazards). UTF-8 in/out.
 * Returns trimmed stdout; throws with git's stderr on failure.
 */
function gitCli(args, { cwd } = {}) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || "").toString().trim();
    throw new Error(msg || `git ${args.join(" ")} failed (exit ${res.status})`);
  }
  return (res.stdout || "").toString();
}

function isGitRepo(cwd, git = gitCli) {
  try {
    return (
      git(["rev-parse", "--is-inside-work-tree"], { cwd }).trim() === "true"
    );
  } catch {
    return false;
  }
}

/**
 * Build the `git diff` argv for the requested scope. Pure.
 *
 * @param {object} opts { staged, base, range, paths }
 * @param {boolean} [stat] append --stat for the summary variant
 * @returns {{ args:string[], scope:string, label:string }}
 */
export function resolveDiffArgs(opts = {}, stat = false) {
  const { staged, base, range, paths } = opts;
  let args;
  let scope;
  let label;
  if (range) {
    args = ["diff", range];
    scope = "range";
    label = `range ${range}`;
  } else if (base) {
    // three-dot: changes on HEAD since it diverged from <base> (PR-style).
    args = ["diff", `${base}...HEAD`];
    scope = "base";
    label = `${base}...HEAD`;
  } else if (staged) {
    args = ["diff", "--cached"];
    scope = "staged";
    label = "staged changes";
  } else {
    args = ["diff", "HEAD"];
    scope = "working";
    label = "working tree vs HEAD";
  }
  if (stat) args.push("--stat");
  const cleanPaths = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (cleanPaths.length) args.push("--", ...cleanPaths);
  return { args, scope, label };
}

/** Normalize/validate an effort tier; defaults to "medium". Pure. */
export function normalizeEffort(value) {
  if (!value) return "medium";
  const v = String(value).toLowerCase().trim();
  if (!VALID_EFFORTS.includes(v)) {
    throw new Error(
      `Invalid effort "${value}". Expected one of: ${VALID_EFFORTS.join(", ")}.`,
    );
  }
  return v;
}

/** Resolve the review lens from flags. Pure. */
export function resolveReviewMode({ security, simplify } = {}) {
  if (security && simplify) {
    throw new Error("--security and --simplify are mutually exclusive.");
  }
  if (security) return "security";
  if (simplify) return "simplify";
  return "default";
}

const LENS = Object.freeze({
  default:
    "Review the changes for, in priority order: (1) CORRECTNESS bugs — logic " +
    "errors, unhandled edge cases, null/undefined hazards, off-by-one, race " +
    "conditions, missing/incorrect error handling, resource leaks, wrong API " +
    "usage, broken invariants; and (2) CLEANUP — duplicated logic that could " +
    "reuse an existing helper, code that could be simplified, and obvious " +
    "inefficiencies. Correctness findings come first.",
  security:
    "This is a SECURITY review. Look only for security-relevant defects: " +
    "injection (SQL / shell / path), broken authentication or authorization, " +
    "secrets committed in code, weak or misused cryptography, SSRF, unsafe " +
    "deserialization, path traversal, XSS, insecure randomness, missing input " +
    "validation, TOCTOU races, and insecure defaults. Ignore style and " +
    "non-security cleanups.",
  simplify:
    "This is a CLEANUP-ONLY review — do NOT hunt for bugs. Look for: duplicated " +
    "logic that could reuse existing code, over-complicated code that can be " +
    "simplified, inefficient patterns, and wrong-altitude abstractions. Only " +
    "propose changes that PRESERVE behavior.",
});

const EFFORT_GUIDE = Object.freeze({
  low:
    "Report ONLY the few highest-confidence, highest-impact findings. Skip " +
    "anything speculative or minor.",
  medium:
    "Report high-confidence findings across the whole diff. Skip speculative " +
    "nitpicks.",
  high:
    "Be thorough across the whole diff. You may include lower-confidence " +
    "findings, but clearly mark each as such.",
});

/**
 * Build the review prompt embedding the diff. Pure.
 *
 * @param {object} o { diff, summary, effort, mode, fix, label, untrackedBlocks, truncated }
 * @returns {string}
 */
export function buildReviewPrompt(o = {}) {
  const {
    diff = "",
    summary = "",
    effort = "medium",
    mode = "default",
    fix = false,
    comment = false,
    label = "working tree vs HEAD",
    untrackedBlocks = "",
    truncated = false,
  } = o;

  // comment mode → machine-readable findings so each maps to a PR inline comment.
  const commentTail =
    "Output ONLY a JSON array of findings and nothing else — no prose, no " +
    "markdown fence. Each element: " +
    '{"path": "<repo-relative file path exactly as in the diff>", ' +
    '"line": <integer line number in the NEW version of the file, which MUST ' +
    "appear in the diff>, " +
    '"severity": "Critical"|"High"|"Medium"|"Low", ' +
    '"title": "<one-line summary>", ' +
    '"body": "<why it matters + a concrete suggested fix>"}. ' +
    "Only report lines that are present in the diff (added/context lines on the " +
    "new side). Do NOT modify any files. If there is nothing worth raising, " +
    "output exactly [].";

  const tail = comment
    ? commentTail
    : fix
      ? "First identify the issues as above. Then APPLY the fixes directly with " +
        "your edit tools — make the smallest change that resolves each issue and " +
        "match the surrounding code's style. Every file edit is automatically " +
        "checkpointed and reversible, so edit confidently. Stay within the " +
        "reviewed change and its immediate dependencies — do not refactor " +
        "unrelated code. Do NOT run destructive shell commands. When done, output " +
        "a Markdown summary: what you changed (with `path:line`) and any issue you " +
        "deliberately did NOT fix, each with a one-line reason."
      : "Output a Markdown report. For each finding give: a severity " +
        "(Critical / High / Medium / Low), the `path:line`, a one-line title, " +
        "why it matters, and a concrete suggested fix (a short code snippet when " +
        "it helps). Group findings by severity, most severe first. If nothing is " +
        "worth raising, say so plainly. Do NOT modify any files — this is a " +
        "review only.";

  return [
    `You are an expert code reviewer. ${LENS[mode]}`,
    EFFORT_GUIDE[effort],
    "",
    `The change under review is the ${label}, shown below as a unified diff. ` +
      "Before judging a hunk, use your read/search tools to open the " +
      "surrounding code so your findings reflect real context, not just the " +
      "diff window.",
    "",
    summary ? "Diffstat:\n```\n" + summary.trim() + "\n```\n" : "",
    "Unified diff:",
    "```diff",
    truncated
      ? diff +
        "\n\n[... diff truncated — review what is shown; note the cutoff]"
      : diff,
    "```",
    untrackedBlocks ? "\n" + untrackedBlocks : "",
    "",
    tail,
  ]
    .filter((s) => s !== "")
    .join("\n");
}

/**
 * Collect untracked files (working scope only) and render them as labeled
 * "new file" blocks so brand-new code is reviewed too (git diff HEAD omits it).
 */
function collectUntracked(cwd, git) {
  let list = [];
  try {
    list = git(["ls-files", "--others", "--exclude-standard"], { cwd })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return { blocks: "", files: [], skipped: [] };
  }
  if (!list.length) return { blocks: "", files: [], skipped: [] };

  const parts = [];
  const included = [];
  const skipped = [];
  let total = 0;
  for (const rel of list) {
    if (total >= MAX_UNTRACKED_TOTAL_CHARS) {
      skipped.push(rel);
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(path.resolve(cwd, rel), "utf-8");
    } catch {
      skipped.push(rel);
      continue;
    }
    // Skip files that look binary (NUL byte in the first chunk).
    if (content.includes("\u0000")) {
      skipped.push(rel);
      continue;
    }
    let body = content;
    if (body.length > MAX_UNTRACKED_FILE_CHARS) {
      body = body.slice(0, MAX_UNTRACKED_FILE_CHARS) + "\n[... file truncated]";
    }
    total += body.length;
    included.push(rel);
    parts.push(`New file \`${rel}\`:\n\`\`\`\n${body}\n\`\`\``);
  }
  return {
    blocks: parts.length ? "Untracked new files:\n\n" + parts.join("\n\n") : "",
    files: included,
    skipped,
  };
}

/**
 * Collect the diff (+ untracked new files) for a review scope. Shared by
 * runReview and runReviewComment. Returns the (possibly truncated) diff.
 */
function collectReviewDiff(scopeOpts, { cwd, git, includeUntracked }) {
  const { args: diffArgs, scope, label } = resolveDiffArgs(scopeOpts, false);
  const { args: statArgs } = resolveDiffArgs(scopeOpts, true);
  let diff = "";
  let summary = "";
  try {
    diff = git(diffArgs, { cwd });
    summary = git(statArgs, { cwd });
  } catch (err) {
    throw new Error(`git diff failed: ${err.message}`);
  }
  // Untracked new files only matter for the default working scope; staged /
  // base / range are already fully described by git.
  let untracked = { blocks: "", files: [], skipped: [] };
  if (scope === "working" && includeUntracked) {
    untracked = collectUntracked(cwd, git);
  }
  const hasDiff = Boolean(diff.trim());
  const hasUntracked = Boolean(untracked.blocks);
  const truncated = diff.length > MAX_DIFF_CHARS;
  if (truncated) diff = diff.slice(0, MAX_DIFF_CHARS);
  return {
    diff,
    summary,
    scope,
    label,
    untracked,
    hasDiff,
    hasUntracked,
    truncated,
  };
}

/** Run `gh` with an argv array (no shell). UTF-8 in/out; throws on failure. */
function ghCli(args, { cwd, input } = {}) {
  const res = spawnSync("gh", args, {
    cwd,
    input,
    encoding: "utf-8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || "").toString().trim();
    throw new Error(msg || `gh ${args.join(" ")} failed (exit ${res.status})`);
  }
  return (res.stdout || "").toString();
}

/** Resolve the PR for the current branch via gh (read-only). Throws if none. */
function resolvePr(cwd, gh) {
  let out;
  try {
    out = gh(
      ["pr", "view", "--json", "number,baseRefName,headRefName,headRefOid,url"],
      { cwd },
    );
  } catch (err) {
    throw new Error(
      `no open PR for the current branch (gh: ${err.message}). ` +
        "Push the branch and open a PR first, or use `cc review` without --comment.",
    );
  }
  let pr;
  try {
    pr = JSON.parse(out);
  } catch {
    throw new Error("could not parse `gh pr view` output.");
  }
  let repo = null;
  try {
    repo = JSON.parse(
      gh(["repo", "view", "--json", "nameWithOwner"], { cwd }),
    ).nameWithOwner;
  } catch {
    repo = null;
  }
  return { ...pr, repo };
}

/**
 * Parse the agent's findings JSON (lenient). Strips a code fence, extracts the
 * first JSON array, and keeps only well-formed findings. Pure.
 *
 * @returns {{path:string,line:number,severity:string,title:string,body:string}[]}
 */
export function parseFindings(text) {
  if (!text) return [];
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Try a BALANCED array first (stops at the first complete [...]); fall back to
  // the greedy first-[..last-] slice. The greedy slice ALONE over-captures when
  // the reply has trailing prose or a stray `]` (e.g. "findings: [ … ]. See [1]")
  // — JSON.parse then fails and EVERY finding is silently dropped.
  const candidates = [];
  const balanced = firstBalancedJson(s, "[");
  if (balanced) candidates.push(balanced);
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start !== -1 && end > start) candidates.push(s.slice(start, end + 1));
  let arr = null;
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) {
        arr = parsed;
        break;
      }
    } catch {
      /* try the next candidate */
    }
  }
  if (!arr) return [];
  const mapped = arr
    .filter(
      (f) =>
        f &&
        typeof f === "object" &&
        f.path &&
        Number.isFinite(Number(f.line)) &&
        Number(f.line) > 0,
    )
    .map((f) => ({
      path: String(f.path),
      line: Math.floor(Number(f.line)),
      severity: f.severity ? String(f.severity) : "Note",
      title: f.title ? String(f.title) : "",
      body: f.body ? String(f.body) : f.title ? String(f.title) : "finding",
    }));
  // Collapse duplicate findings the model may repeat for the same path:line:title
  // (keeps the highest severity). Shape-preserving for this {path,line,severity,
  // title,body} model — see review-pipeline.dedupeFindings.
  return dedupeFindings(mapped);
}

/** Format one finding into a PR comment body. Pure. */
export function buildCommentBody(f) {
  const sev = f.severity ? `**[${f.severity}]** ` : "";
  const title = f.title ? `${f.title}\n\n` : "";
  return `${sev}${title}${f.body}`.trim();
}

/** Build the GitHub "create review" API payload from findings. Pure. */
export function buildReviewPayload(findings, { commitId } = {}) {
  const comments = (findings || []).map((f) => ({
    path: f.path,
    line: f.line,
    side: "RIGHT",
    body: buildCommentBody(f),
  }));
  const payload = {
    event: "COMMENT",
    body: `cc review — ${comments.length} finding(s).`,
    comments,
  };
  if (commitId) payload.commit_id = commitId;
  return payload;
}

/**
 * Post the findings to the PR as a single review with inline comments
 * (outward-facing — callers gate this behind --dry-run / confirmation).
 */
export function postReviewComments(
  pr,
  findings,
  { gh = ghCli, cwd, commitId } = {},
) {
  if (!pr || !pr.repo || !pr.number) {
    throw new Error("cannot post: PR repo/number not resolved.");
  }
  const payload = buildReviewPayload(findings, { commitId });
  const out = gh(
    [
      "api",
      "--method",
      "POST",
      `repos/${pr.repo}/pulls/${pr.number}/reviews`,
      "--input",
      "-",
    ],
    { cwd, input: JSON.stringify(payload) },
  );
  try {
    return JSON.parse(out);
  } catch {
    return { raw: out };
  }
}

/**
 * Comment-mode review: resolve the PR, collect its diff, get machine-readable
 * findings from one read-only agent turn. Side-effect-free (PR resolution is a
 * read); the caller posts after confirmation. Deps injected for tests.
 *
 * @returns {Promise<{empty:boolean, pr:object, findings:object[], scope?:string,
 *                     label?:string, isError?:boolean}>}
 */
export async function runReviewComment(options = {}, deps = {}) {
  const cwd = options.cwd || process.cwd();
  const git = deps.git || gitCli;
  const gh = deps.gh || ghCli;
  const repoCheck = deps.isGitRepo || isGitRepo;
  if (!repoCheck(cwd, git)) {
    throw new Error("cc review needs a git work tree.");
  }

  const pr = (deps.resolvePr || resolvePr)(cwd, gh);

  // Default the scope to the PR's base branch (review the PR's changes) unless
  // the user gave an explicit scope.
  const explicitScope =
    options.staged ||
    options.base ||
    options.range ||
    (options.paths || []).length;
  const scopeOpts = {
    staged: options.staged === true,
    base: options.base || (explicitScope ? null : pr.baseRefName),
    range: options.range || null,
    paths: options.paths || [],
  };

  const collected = collectReviewDiff(scopeOpts, {
    cwd,
    git,
    includeUntracked: false,
  });
  if (!collected.hasDiff && !collected.hasUntracked) {
    return { empty: true, pr, findings: [] };
  }

  // LLM config defaults (parity with runReview).
  try {
    const loadConfig =
      deps.loadConfig || (await import("../lib/config-manager.js")).loadConfig;
    const { applyConfigLlmDefaults } = deps.applyConfigLlmDefaults
      ? { applyConfigLlmDefaults: deps.applyConfigLlmDefaults }
      : await import("../lib/llm-config-defaults.js");
    applyConfigLlmDefaults(options, loadConfig().llm || {}, {
      explicitModel: options.model,
    });
  } catch {
    /* fall back to runner defaults */
  }

  const prompt = buildReviewPrompt({
    diff: collected.hasDiff ? collected.diff : "(no tracked changes)",
    summary: collected.summary,
    effort: normalizeEffort(options.effort),
    mode: resolveReviewMode(options),
    comment: true,
    label: collected.label,
    truncated: collected.truncated,
  });

  const run =
    deps.runAgentHeadless ||
    (await import("../runtime/headless-runner.js")).runAgentHeadless;
  // Suppress the runner's own stdout/stderr — we only want the structured result.
  const outcome = await run(
    {
      prompt,
      model: options.model,
      provider: options.provider,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      outputFormat: "text",
      permissionMode: "plan",
      maxTurns: Number.isFinite(options.maxTurns) ? options.maxTurns : 20,
      cwd,
      expandFileRefs: false,
    },
    { writeOut: () => {}, writeErr: () => {} },
  );

  return {
    empty: false,
    pr,
    scope: collected.scope,
    label: collected.label,
    findings: parseFindings(outcome.result || ""),
    isError: outcome.isError === true,
  };
}

// ── multi-agent fan-out (opt-in `--multi`) ──────────────────────────────────
// A high-confidence review runs one focused FINDER per dimension, then dedupes
// and ranks their findings into a single structured report — instead of the
// default single agent that hunts everything at once. Each finder is blind to
// the others; overlapping findings merge (union categories, keep max severity).

/** The review dimensions fanned out, one finder agent each. */
export const REVIEW_DIMENSIONS = Object.freeze([
  {
    key: "correctness",
    label: "correctness",
    hint: "logic errors, off-by-one, null/undefined, wrong API usage, unhandled errors, race conditions",
  },
  {
    key: "security",
    label: "security",
    hint: "injection, auth/authz gaps, secrets, path traversal, SSRF, unsafe deserialization, missing input validation",
  },
  {
    key: "performance",
    label: "performance",
    hint: "N+1 queries, unbounded loops, sync IO on hot paths, memory leaks, needless allocations/copies",
  },
  {
    key: "tests",
    label: "test coverage",
    hint: "untested branches, missing edge cases, weak assertions, changed behavior lacking a test",
  },
]);

const JSON_FINDINGS_CONTRACT =
  'Output ONLY a JSON array (no prose, no fences). Each element: {"path":"file","line":12,"severity":"Critical|High|Medium|Low|Note","title":"one-line issue","body":"why it is a bug and how to fix"}. Output [] if you find nothing.';

/** Build a single dimension finder's prompt from the shared diff context. Pure. */
export function buildDimensionPrompt(ctx = {}, dim = {}) {
  const {
    diff = "",
    summary = "",
    label = "",
    untrackedBlocks = [],
    truncated = false,
  } = ctx;
  return [
    `You are a ${dim.label} code reviewer. Report ONLY ${dim.label} issues: ${dim.hint}.`,
    `Review this diff (${label}). ${summary}`,
    truncated ? "(diff truncated — review what is shown)" : "",
    "```diff",
    diff,
    "```",
    ...(untrackedBlocks && untrackedBlocks.length
      ? ["", "New untracked files:", ...untrackedBlocks]
      : []),
    "",
    JSON_FINDINGS_CONTRACT,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Render a structured review report to markdown. Pure. */
export function renderMultiFinderReport(report = {}, byDimension = {}) {
  const findings = report.findings || [];
  const summary = report.summary || { total: 0, bySeverity: {} };
  const sevOrder = ["Critical", "High", "Medium", "Low", "Note"];
  const lines = [];
  lines.push(`# Multi-agent review — ${summary.total} finding(s)`);
  lines.push("");
  lines.push(
    sevOrder.map((s) => `${s}: ${summary.bySeverity?.[s] || 0}`).join("  ·  "),
  );
  const dimLine = Object.entries(byDimension)
    .map(([k, v]) => `${k} ${v}`)
    .join("  ·  ");
  if (dimLine) lines.push(`By dimension: ${dimLine}`);
  lines.push("");
  for (const f of findings) {
    lines.push(
      `## [${f.severity}] ${f.path}:${f.line}${f.category ? ` (${f.category})` : ""}`,
    );
    if (f.failure_scenario) lines.push(f.failure_scenario);
    if (f.evidence) lines.push(`> ${f.evidence}`);
    lines.push("");
  }
  if (findings.length === 0) lines.push("No findings.");
  return lines.join("\n") + "\n";
}

/** Build a skeptic verifier's prompt for one finding. Pure. */
export function buildVerifierPrompt(f = {}) {
  return [
    "You are a SKEPTICAL code reviewer. Independently verify the finding below by reading the actual code with your tools. Assume it is WRONG until you can reproduce it; default to REFUTED if you cannot.",
    `Finding: [${f.severity}] ${f.path}:${f.line}`,
    f.title ? `Claim: ${f.title}` : "",
    f.evidence || f.failureScenario
      ? `Details: ${f.evidence || f.failureScenario}`
      : "",
    "",
    'Reply with ONLY a JSON object (no prose): {"reproduced": true|false, "confidence": 0.0-1.0, "reason": "one line"}. Set reproduced=true ONLY if the defect is real and reachable.',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Parse a verifier reply into an applyVerdicts verdict. Pure; null if unparseable. */
export function parseVerdict(text) {
  const balanced = firstBalancedJson(String(text || ""), "{");
  if (!balanced) return null;
  let obj;
  try {
    obj = JSON.parse(balanced);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const reproduced = obj.reproduced === true || obj.verified === true;
  const conf = Number(obj.confidence);
  return {
    verified: reproduced,
    ...(Number.isFinite(conf) ? { confidence: conf } : {}),
    ...(obj.reason ? { note: String(obj.reason) } : {}),
  };
}

/**
 * Run one skeptic verifier agent per (already-deduped) finding and collect a
 * verdicts map keyed by findingKey. A verifier that throws/parses to nothing
 * leaves the finding unverified (kept as-is). Deps: { runAgentHeadless }.
 */
export async function runVerifierPass(findings, ctx = {}, deps = {}) {
  const run =
    deps.runAgentHeadless ||
    (await import("../runtime/headless-runner.js")).runAgentHeadless;
  const writeErr = ctx.writeErr || (() => {});
  const verdicts = {};
  for (const f of findings || []) {
    let captured = "";
    let outcome;
    try {
      outcome = await run(
        {
          ...(ctx.baseOptions || {}),
          prompt: buildVerifierPrompt(f),
          outputFormat: "text",
        },
        {
          writeOut: (s) => {
            captured += s;
          },
          writeErr,
        },
      );
    } catch (e) {
      writeErr(
        `review --verify: verifier failed for ${f.path}:${f.line}: ${e.message}\n`,
      );
      continue;
    }
    const text = String(outcome?.result ?? captured ?? "");
    const v = parseVerdict(text);
    if (v) verdicts[findingKey(f)] = v;
  }
  return verdicts;
}

/**
 * Fan out one finder agent per review dimension, capture each finder's JSON
 * findings, and dedupe/rank them into a structured report. With `ctx.verify`, a
 * skeptic verifier agent then independently reproduces each finding and REFUTED
 * ones are dropped. Each agent runs a captured headless turn (its raw output
 * never hits stdout — only the final report does).
 * Deps: { runAgentHeadless, dimensions }.
 */
export async function runMultiFinderReview(ctx = {}, deps = {}) {
  const run =
    deps.runAgentHeadless ||
    (await import("../runtime/headless-runner.js")).runAgentHeadless;
  const dimensions = deps.dimensions || REVIEW_DIMENSIONS;
  const writeOut = ctx.writeOut || ((s) => process.stdout.write(s));
  const writeErr = ctx.writeErr || ((s) => process.stderr.write(s));

  const all = [];
  const byDimension = {};
  for (const dim of dimensions) {
    let captured = "";
    let outcome;
    try {
      outcome = await run(
        {
          ...(ctx.baseOptions || {}),
          prompt: buildDimensionPrompt(ctx, dim),
          outputFormat: "text",
        },
        {
          writeOut: (s) => {
            captured += s;
          },
          writeErr,
        },
      );
    } catch (e) {
      writeErr(`review --multi: ${dim.key} finder failed: ${e.message}\n`);
      byDimension[dim.key] = 0;
      continue;
    }
    const text =
      String(outcome?.result ?? captured ?? "").trim() || captured.trim();
    // Carry title into `failureScenario` (the one-line issue) and body into
    // `evidence` so the structured report keeps them; `title` stays on the
    // object so cross-dimension dedup keys on path:line:title.
    const found = parseFindings(text).map((f) => ({
      path: f.path,
      line: f.line,
      severity: f.severity,
      title: f.title,
      category: dim.key,
      failureScenario: f.title || f.body || "",
      evidence: f.body || "",
    }));
    byDimension[dim.key] = found.length;
    all.push(...found);
  }

  // Optional skeptic pass: verify each unique finding; refuted ones are dropped
  // by buildReviewReport via applyVerdicts. Verify the DEDUPED set so a finding
  // reported by several finders is only checked once.
  let verdicts = {};
  let verifiedCount = null;
  if (ctx.verify) {
    const unique = dedupeFindings(all);
    verdicts = await runVerifierPass(unique, ctx, deps);
    verifiedCount = Object.values(verdicts).filter((v) => v.verified).length;
  }

  const report = buildReviewReport(all, { verdicts });
  const meta = {
    byDimension,
    ...(ctx.verify ? { verified: verifiedCount } : {}),
  };
  if (ctx.outputFormat === "json") {
    writeOut(`${JSON.stringify({ ...report, ...meta }, null, 2)}\n`);
  } else {
    writeOut(renderMultiFinderReport(report, byDimension));
  }
  return {
    exitCode: 0,
    isError: false,
    scope: ctx.scope,
    empty: false,
    multi: true,
    report,
    byDimension,
    ...(ctx.verify ? { verified: verifiedCount } : {}),
  };
}

/**
 * Core review run — collects the diff and dispatches one headless agent turn
 * (or, with `--multi`, one finder agent per dimension merged into a report).
 * Deps are injected for tests (git / runAgentHeadless / config helpers).
 *
 * @returns {Promise<{exitCode:number, isError:boolean, scope:string, empty?:boolean}>}
 */
export async function runReview(options = {}, deps = {}) {
  const cwd = options.cwd || process.cwd();
  const git = deps.git || gitCli;
  const repoCheck = deps.isGitRepo || isGitRepo;

  if (!repoCheck(cwd, git)) {
    throw new Error(
      "cc review needs a git work tree (the diff is the review input).",
    );
  }

  const effort = normalizeEffort(options.effort);
  const mode = resolveReviewMode(options);
  const fix = options.fix === true;

  const scopeOpts = {
    staged: options.staged === true,
    base: options.base || null,
    range: options.range || null,
    paths: options.paths || [],
  };

  const {
    diff,
    summary,
    scope,
    label,
    untracked,
    hasDiff,
    hasUntracked,
    truncated,
  } = collectReviewDiff(scopeOpts, {
    cwd,
    git,
    includeUntracked: options.untracked !== false,
  });
  if (!hasDiff && !hasUntracked) {
    return { exitCode: 0, isError: false, scope, empty: true };
  }

  const prompt = buildReviewPrompt({
    diff: hasDiff ? diff : "(no tracked changes)",
    summary,
    effort,
    mode,
    fix,
    label,
    untrackedBlocks: untracked.blocks,
    truncated,
  });

  // LLM defaults: honor .chainlesschain/config.json `llm` like cc agent/ask.
  // Explicit flags win. Best-effort — never block the review.
  try {
    const loadConfig =
      deps.loadConfig || (await import("../lib/config-manager.js")).loadConfig;
    const { applyConfigLlmDefaults } = deps.applyConfigLlmDefaults
      ? { applyConfigLlmDefaults: deps.applyConfigLlmDefaults }
      : await import("../lib/llm-config-defaults.js");
    applyConfigLlmDefaults(options, loadConfig().llm || {}, {
      explicitModel: options.model,
    });
  } catch {
    // fall back to runner defaults
  }

  // --multi: fan out one finder per dimension and merge into a structured
  // report. Opt-in — the default single-pass path below is byte-identical.
  if (options.multi) {
    return runMultiFinderReview(
      {
        diff: hasDiff ? diff : "(no tracked changes)",
        summary,
        label,
        scope,
        untrackedBlocks: untracked.blocks,
        truncated,
        verify: options.verify === true,
        outputFormat: options.outputFormat || "text",
        writeOut: deps.writeOut,
        writeErr: deps.writeErr,
        baseOptions: {
          model: options.model,
          provider: options.provider,
          baseUrl: options.baseUrl,
          apiKey: options.apiKey,
          cwd,
          permissionMode: "plan",
          expandFileRefs: false,
          maxTurns: Number.isFinite(options.maxTurns) ? options.maxTurns : 20,
        },
      },
      deps,
    );
  }

  // review-only → plan mode (clamped to read-only tools, cannot mutate).
  // --fix     → acceptEdits + auto-checkpoint (reversible edits).
  const permissionMode = fix ? "acceptEdits" : "plan";
  const autoCheckpoint = fix && options.checkpoint !== false;
  const defaultMaxTurns = fix ? 40 : 20;
  const maxTurns = Number.isFinite(options.maxTurns)
    ? options.maxTurns
    : defaultMaxTurns;

  const run =
    deps.runAgentHeadless ||
    (await import("../runtime/headless-runner.js")).runAgentHeadless;

  const outcome = await run({
    prompt,
    model: options.model,
    provider: options.provider,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    outputFormat: options.outputFormat || "text",
    permissionMode,
    autoCheckpoint,
    checkpointSession: options.checkpointSession || `review-${scope}`,
    maxTurns,
    cwd,
    // The diff carries `@@` hunk markers and may contain `@tokens`; never run
    // the @file-reference expander over it.
    expandFileRefs: false,
  });

  return { ...outcome, scope, empty: false };
}

export function registerReviewCommand(program) {
  program
    .command("review [effort]")
    .description(
      "Diff-first code review of your changes (Claude-Code /code-review parity)",
    )
    .option("--staged", "Review staged changes only (git diff --cached)")
    .option("--base <ref>", "Review this branch vs a base ref (<ref>...HEAD)")
    .option("--range <range>", "Review an explicit revision range (e.g. A..B)")
    .option(
      "--paths <paths...>",
      "Limit the review to these paths (repeatable)",
    )
    .option("-e, --effort <level>", "low | medium | high (default: medium)")
    .option("--fix", "Apply the fixes to the working tree (auto-checkpointed)")
    .option("--security", "Security-focused review (/security-review parity)")
    .option("--simplify", "Cleanup-only review, no bug hunt (/simplify parity)")
    .option("--no-untracked", "Skip untracked new files (working scope)")
    .option(
      "--no-checkpoint",
      "With --fix: do not auto-checkpoint before edits",
    )
    .option("--model <model>", "Override the review model")
    .option("--provider <provider>", "Override the LLM provider")
    .option("--base-url <url>", "Override the API base URL")
    .option("--api-key <key>", "Override the API key")
    .option("--max-turns <n>", "Cap agent loop iterations")
    .option(
      "--comment",
      "Post findings as inline comments on the current branch's PR (via gh); defaults the scope to the PR base",
    )
    .option(
      "--dry-run",
      "With --comment: show what would be posted without posting",
    )
    .option(
      "--multi",
      "Fan out one finder agent per dimension (correctness/security/performance/tests) and merge into a structured report",
    )
    .option(
      "--verify",
      "With --multi: run a skeptic verifier agent per finding and drop the ones it cannot reproduce",
    )
    .option("--json", "Emit the agent result envelope as JSON")
    .action(async (effortArg, options) => {
      try {
        const merged = {
          ...options,
          effort: options.effort || effortArg,
          // commander stores --no-untracked as untracked:false, --no-checkpoint
          // as checkpoint:false; pass them through unchanged.
          maxTurns: options.maxTurns
            ? parseInt(options.maxTurns, 10)
            : undefined,
          outputFormat: options.json ? "json" : "text",
          cwd: process.cwd(),
        };

        // Pre-flight messaging on stderr so stdout stays a clean payload.
        const mode = resolveReviewMode(merged);
        const effort = normalizeEffort(merged.effort);
        const { label } = resolveDiffArgs({
          staged: merged.staged,
          base: merged.base,
          range: merged.range,
          paths: merged.paths,
        });
        const modeLabel =
          mode === "security"
            ? "security"
            : mode === "simplify"
              ? "cleanup-only"
              : "bugs + cleanup";

        // ── --comment: review the PR's diff and post inline comments ────────
        if (merged.comment) {
          logger.info(
            chalk.gray(
              `Reviewing PR diff · ${effort} effort · ${modeLabel} · ` +
                (merged.dryRun ? "dry-run" : "will post comments"),
            ),
          );
          const res = await runReviewComment(merged, {});
          if (res.empty) {
            logger.log(chalk.gray("No changes to review on this PR."));
            return;
          }
          logger.log(
            chalk.bold(
              `${res.findings.length} finding(s) for PR #${res.pr.number}`,
            ) + chalk.gray(`  ${res.pr.url || ""}`),
          );
          for (const f of res.findings) {
            logger.log(
              `  ${chalk.yellow(`[${f.severity}]`)} ${chalk.cyan(`${f.path}:${f.line}`)} ${f.title}`,
            );
          }
          if (res.findings.length === 0) {
            logger.log(chalk.gray("Nothing to post."));
            return;
          }
          if (merged.dryRun) {
            logger.log(
              chalk.gray("(--dry-run: not posting; re-run without --dry-run)"),
            );
            return;
          }
          // Outward-facing: confirm before posting when interactive.
          if (process.stdin.isTTY) {
            const { confirm } = await import("@inquirer/prompts");
            const ok = await confirm({
              message: `Post ${res.findings.length} comment(s) to PR #${res.pr.number}?`,
              default: false,
            }).catch(() => false);
            if (!ok) {
              logger.log(chalk.gray("Aborted — nothing posted."));
              return;
            }
          }
          try {
            postReviewComments(res.pr, res.findings, {
              cwd: merged.cwd,
              commitId: res.pr.headRefOid,
            });
            logger.log(
              chalk.green(
                `✓ posted ${res.findings.length} comment(s) to PR #${res.pr.number}`,
              ),
            );
          } catch (err) {
            logger.error(chalk.red(`failed to post review: ${err.message}`));
            process.exitCode = 1;
          }
          return;
        }

        logger.info(
          chalk.gray(
            `Reviewing ${label} · ${effort} effort · ${modeLabel}` +
              (merged.fix ? " · applying fixes" : " · read-only"),
          ),
        );

        const result = await runReview(merged, {});

        if (result.empty) {
          logger.log(chalk.gray("No changes to review."));
          return;
        }
        if (result.isError) {
          process.exitCode = result.exitCode || 1;
        }
      } catch (err) {
        logger.error(chalk.red(`review failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
