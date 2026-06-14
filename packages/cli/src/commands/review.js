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
    return git(["rev-parse", "--is-inside-work-tree"], { cwd }).trim() === "true";
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
    label = "working tree vs HEAD",
    untrackedBlocks = "",
    truncated = false,
  } = o;

  const tail = fix
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
      ? diff + "\n\n[... diff truncated — review what is shown; note the cutoff]"
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
    if (content.includes(" ")) {
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
 * Core review run — collects the diff and dispatches one headless agent turn.
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
  if (scope === "working" && options.untracked !== false) {
    untracked = collectUntracked(cwd, git);
  }

  const hasDiff = Boolean(diff.trim());
  const hasUntracked = Boolean(untracked.blocks);
  if (!hasDiff && !hasUntracked) {
    return { exitCode: 0, isError: false, scope, empty: true };
  }

  const truncated = diff.length > MAX_DIFF_CHARS;
  if (truncated) diff = diff.slice(0, MAX_DIFF_CHARS);

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
    const loadConfig = deps.loadConfig || (await import("../lib/config-manager.js")).loadConfig;
    const { applyConfigLlmDefaults } =
      deps.applyConfigLlmDefaults
        ? { applyConfigLlmDefaults: deps.applyConfigLlmDefaults }
        : await import("../lib/llm-config-defaults.js");
    applyConfigLlmDefaults(options, loadConfig().llm || {}, {
      explicitModel: options.model,
    });
  } catch {
    // fall back to runner defaults
  }

  // review-only → plan mode (clamped to read-only tools, cannot mutate).
  // --fix     → acceptEdits + auto-checkpoint (reversible edits).
  const permissionMode = fix ? "acceptEdits" : "plan";
  const autoCheckpoint = fix && options.checkpoint !== false;
  const defaultMaxTurns = fix ? 40 : 20;
  const maxTurns = Number.isFinite(options.maxTurns)
    ? options.maxTurns
    : defaultMaxTurns;

  const run = deps.runAgentHeadless ||
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
    .option("--no-checkpoint", "With --fix: do not auto-checkpoint before edits")
    .option("--model <model>", "Override the review model")
    .option("--provider <provider>", "Override the LLM provider")
    .option("--base-url <url>", "Override the API base URL")
    .option("--api-key <key>", "Override the API key")
    .option("--max-turns <n>", "Cap agent loop iterations")
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
