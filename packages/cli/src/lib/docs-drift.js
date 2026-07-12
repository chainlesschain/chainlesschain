/**
 * Auto-generated CLI reference + doc-drift detection (P2 "文档").
 *
 * The gap: commands, agent tools, flags, exit codes, and protocol fields are
 * documented by hand and silently drift from the code. `command-manifest.json`
 * (regenerated + CI-guarded) and the `AGENT_TOOLS` registry are the authoritative
 * data sources; nothing turns them into a reference doc or checks a hand-written
 * doc against them.
 *
 * This is the PURE core: build a canonical reference from the manifest + tool
 * list, render it, and diff a documentation surface against the authoritative
 * sets to catch drift in BOTH directions (documented-but-gone / present-but-
 * undocumented). No I/O — the caller reads the manifest, tool names, and doc text.
 */

/** Normalize the command-manifest.json commands into a stable reference list. */
export function extractCommands(manifest = {}) {
  const commands = Array.isArray(manifest.commands) ? manifest.commands : [];
  return commands
    .map((c) => ({
      name: String(c?.name || "").trim(),
      aliases: Array.isArray(c?.aliases)
        ? c.aliases.map((a) => String(a).trim()).filter(Boolean)
        : [],
      summary: String(c?.summary || "").trim(),
    }))
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Normalize the AGENT_TOOLS registry into a sorted, de-duped name list. Accepts
 * plain strings, `{ name }` contracts, and OpenAI-style `{ function: { name } }`
 * function-tool definitions.
 */
export function extractToolNames(tools = []) {
  const names = (Array.isArray(tools) ? tools : [])
    .map((t) => {
      if (typeof t === "string") return t.trim();
      const n = t?.name ?? t?.function?.name;
      return String(n || "").trim();
    })
    .filter(Boolean);
  return [...new Set(names)].sort();
}

/** Every command token a user can invoke: primary names + aliases. */
export function commandTokens(commands) {
  const set = new Set();
  for (const c of commands) {
    set.add(c.name);
    for (const a of c.aliases) set.add(a);
  }
  return set;
}

/**
 * Build the canonical reference object from the authoritative sources. This is
 * the data a generator serializes; `renderReferenceMarkdown` renders it.
 */
export function buildCliReference({ manifest = {}, tools = [] } = {}) {
  const commands = extractCommands(manifest);
  const toolNames = extractToolNames(tools);
  return {
    commandCount: commands.length,
    toolCount: toolNames.length,
    commands,
    tools: toolNames,
  };
}

/** Deterministic markdown render of the reference (stable output for diffing). */
export function renderReferenceMarkdown(reference) {
  const lines = [];
  lines.push("# CLI Reference (generated)");
  lines.push("");
  lines.push(
    "<!-- Generated from command-manifest.json + AGENT_TOOLS. Do not edit by hand. -->",
  );
  lines.push("");
  lines.push(`## Commands (${reference.commandCount})`);
  lines.push("");
  for (const c of reference.commands) {
    const alias = c.aliases.length ? ` (aliases: ${c.aliases.join(", ")})` : "";
    lines.push(`- \`${c.name}\`${alias}${c.summary ? ` — ${c.summary}` : ""}`);
  }
  lines.push("");
  lines.push(`## Agent tools (${reference.toolCount})`);
  lines.push("");
  for (const name of reference.tools) lines.push(`- \`${name}\``);
  lines.push("");
  return lines.join("\n");
}

/**
 * Which authoritative command/tool tokens appear as literal `cc <token>` /
 * backticked `<token>` mentions in the doc text. We look for word-boundary
 * mentions; a token is "documented" if it appears anywhere in the doc.
 */
function isMentioned(doc, token) {
  if (!token) return false;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w-])${esc}([^\\w-]|$)`).test(doc);
}

/**
 * Diff a documentation surface against the authoritative sets. Reports drift both
 * ways so neither a NEW undocumented command nor a REMOVED-but-still-documented
 * one slips through.
 *
 * @param {object} args
 *   manifest — command-manifest.json object
 *   tools    — AGENT_TOOLS array
 *   doc      — the documentation text to check
 *   knownTokens — optional extra tokens to treat as authoritative (e.g. flags,
 *                 exit codes, protocol fields) to catch their drift too
 * @returns {{ undocumentedCommands, undocumentedTools, staleCommandMentions,
 *             ok, counts }}
 */
export function detectDocDrift({
  manifest = {},
  tools = [],
  doc = "",
  knownTokens = [],
} = {}) {
  const commands = extractCommands(manifest);
  const toolNames = extractToolNames(tools);
  const text = String(doc || "");

  const undocumentedCommands = commands
    .filter((c) => !isMentioned(text, c.name))
    .map((c) => c.name);
  const undocumentedTools = toolNames.filter((n) => !isMentioned(text, n));

  // Tokens the doc claims as commands (in a `cc <token>` construct) that are not
  // in the manifest → stale references to removed/renamed commands.
  const known = commandTokens(commands);
  for (const t of knownTokens) known.add(String(t));
  const staleCommandMentions = [];
  const seen = new Set();
  const ccRe = /\bcc\s+([a-z][a-z0-9-]*)\b/g;
  let m;
  while ((m = ccRe.exec(text)) !== null) {
    const tok = m[1];
    if (!known.has(tok) && !seen.has(tok)) {
      seen.add(tok);
      staleCommandMentions.push(tok);
    }
  }

  const counts = {
    undocumentedCommands: undocumentedCommands.length,
    undocumentedTools: undocumentedTools.length,
    staleCommandMentions: staleCommandMentions.length,
  };
  return {
    undocumentedCommands,
    undocumentedTools,
    staleCommandMentions,
    counts,
    ok:
      counts.undocumentedCommands === 0 &&
      counts.undocumentedTools === 0 &&
      counts.staleCommandMentions === 0,
  };
}
