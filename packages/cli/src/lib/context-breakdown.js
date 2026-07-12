/**
 * Per-source token attribution for `cc context --sources` — the P1
 * large-monorepo "/context 按来源分解" lever. The base `cc context` view buckets
 * a session's stored messages by ROLE; this adds a BY-SOURCE view that also
 * attributes the project-memory instruction files (cc.md / CLAUDE.md / rules /
 * @imports) that would be loaded for the current working directory, each with
 * its own token cost and provenance — so a user can see WHICH instruction file
 * (or message class) fills the context window.
 *
 * Pure: token counting for instruction files is delegated to the injected
 * estimator (the same CJK-aware `estimateTokens` the window sizing uses);
 * message-role buckets already arrive pre-counted. No I/O.
 *
 * Scope note: skills and MCP tool schemas are runtime tool definitions loaded
 * when an agent actually runs — they are NOT part of a persisted transcript nor
 * of the project-instruction set, so they are intentionally not attributed here.
 */

import path from "path";

/**
 * Display path for an instruction source: relative-to-cwd when the file lives
 * inside cwd, else the absolute path (a `~/.claude/…` user-scope file, or an
 * @import that escaped the tree, is clearer shown in full).
 */
export function relativizeInstructionPath(absPath, cwd) {
  if (!absPath) return "";
  if (!cwd) return absPath;
  try {
    const rel = path.relative(cwd, absPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return absPath;
    return rel.split(path.sep).join("/");
  } catch {
    return absPath;
  }
}

/**
 * Per-file instruction sources from `loadProjectInstructions().files`.
 *
 * @param {Array<{path,scope,content,truncated}>} files
 * @param {(t:string)=>number} estimateTokens
 * @param {string} [cwd]
 * @returns {{ sources: Array<{scope,source,path,tokens,truncated}>, total:number }}
 */
export function breakdownInstructionSources(files, estimateTokens, cwd) {
  const est = typeof estimateTokens === "function" ? estimateTokens : () => 0;
  const list = Array.isArray(files) ? files : [];
  const sources = list.map((f) => ({
    scope: f?.scope || "project",
    source: relativizeInstructionPath(f?.path, cwd),
    path: f?.path || "",
    tokens: est(typeof f?.content === "string" ? f.content : ""),
    truncated: Boolean(f?.truncated),
  }));
  const total = sources.reduce((s, x) => s + x.tokens, 0);
  return { sources, total };
}

// role bucket key → { label, kind } for the ranked source list.
const MESSAGE_SOURCE_ROWS = [
  ["system", "system messages", "message"],
  ["user", "user messages", "message"],
  ["assistant", "assistant messages", "message"],
  ["tool", "tool results", "message"],
  ["toolCalls", "tool calls", "tool_calls"],
];

/**
 * Merge the project-memory instruction total with the per-role message buckets
 * into ONE ranked source list (largest first) with each source's share of the
 * combined by-source total. The message buckets are the same ones
 * `categorizeContext` produces; instructions are folded in as a single group so
 * the ranked view stays readable (per-file detail lives in the instructions
 * breakdown).
 *
 * @param {object} args
 * @param {number} [args.instructionTotal=0]  Σ instruction-file tokens
 * @param {object} [args.buckets={}]           categorizeContext buckets
 * @param {object} [args.counts={}]            categorizeContext counts
 * @returns {{ sources: Array<{kind,source,tokens,count,share}>, total:number }}
 */
export function rankContextSources({
  instructionTotal = 0,
  buckets = {},
  counts = {},
} = {}) {
  const rows = [];
  if (instructionTotal > 0) {
    rows.push({
      kind: "instructions",
      source: "project memory (instructions)",
      tokens: instructionTotal,
      count: null,
    });
  }
  for (const [key, label, kind] of MESSAGE_SOURCE_ROWS) {
    const tok = buckets[key] || 0;
    if (tok > 0) {
      rows.push({
        kind,
        source: label,
        tokens: tok,
        count: counts[key] ?? null,
      });
    }
  }
  const total = rows.reduce((s, x) => s + x.tokens, 0);
  // Stable sort: tokens desc, then source name for deterministic ties.
  rows.sort((a, b) => b.tokens - a.tokens || a.source.localeCompare(b.source));
  const sources = rows.map((r) => ({
    ...r,
    share: total ? r.tokens / total : 0,
  }));
  return { sources, total };
}
