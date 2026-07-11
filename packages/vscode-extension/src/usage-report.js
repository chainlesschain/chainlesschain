/**
 * Usage report (P1 #6 账户/用量 UI) — pure logic for the
 * `chainlesschain.usage.show` command. Joins `cc session usage --json`
 * (per-session token totals + per-model rollup) with `cc session list --json`
 * (titles + last-activity timestamps) and renders a markdown report with
 * activity-window buckets (last 24 h / 7 d / 30 d / all time).
 *
 * The usage store records no per-event timestamps, so windows bucket by each
 * SESSION's last-activity time — an approximation the report states openly.
 *
 * Usage attribution (用量归因): newer CLIs additionally return an ADDITIVE
 * `attribution` section on `cc session usage --json` (byOrigin / bySkill /
 * bySubagent roll-ups + per-tool / MCP-server call counts with a
 * turn-approximated token figure). When present it is rendered as extra
 * report sections plus derived high-cost hints; when absent (old CLI) the
 * report output is byte-identical to the pre-attribution renderer.
 */

/** Max rows rendered per attribution table before folding into "others". */
const ATTRIBUTION_MAX_ROWS = 10;
/** Sub-agent-heavy hint: subagent share of attributed tokens above this. */
const SUBAGENT_SHARE_HINT_THRESHOLD = 0.4;
/** Cache-miss hint: cacheRead below this fraction of input tokens… */
const CACHE_MISS_MAX_READ_RATIO = 0.25;
/** …but only once input volume is large enough for the ratio to mean much. */
const CACHE_MISS_MIN_INPUT_TOKENS = 10000;
/** Long-context hint: average input tokens per LLM call above this. */
const LONG_CONTEXT_AVG_INPUT_TOKENS = 50000;

function buildUsageArgs(limit = 1000) {
  return ["session", "usage", "--json", "--limit", String(limit)];
}

function buildSessionListArgs(limit = 1000) {
  return ["session", "list", "--json", "-n", String(limit)];
}

/** Tolerant parse of `cc session usage --json` (null unless it has a total). */
function parseUsageJson(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim());
    return parsed && typeof parsed === "object" && parsed.total ? parsed : null;
  } catch {
    return null;
  }
}

/** Tolerant parse of `cc session list --json` → [{id, title, updatedAt}]. */
function parseSessionListJson(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim());
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.id === "string" && s.id)
      .map((s) => ({
        id: s.id,
        title: typeof s.title === "string" ? s.title : "",
        updatedAt: s.updated_at || s.updatedAt || null,
      }));
  } catch {
    return [];
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tolerant normalization of the CLI's additive `attribution` section.
 * Returns null when the section is absent/malformed (old CLI) so the
 * renderer can keep the legacy output byte-identical.
 */
function normalizeAttribution(a) {
  if (!a || typeof a !== "object") return null;
  const rows = (arr) =>
    Array.isArray(arr) ? arr.filter((r) => r && typeof r === "object") : [];
  const tools = a.tools && typeof a.tools === "object" ? a.tools : {};
  return {
    byOrigin: rows(a.byOrigin),
    bySkill: rows(a.bySkill),
    bySubagent: rows(a.bySubagent),
    tools: {
      totalCalls: num(tools.totalCalls),
      totalErrors: num(tools.totalErrors),
      byTool: rows(tools.byTool),
      byMcpServer: rows(tools.byMcpServer),
    },
  };
}

/**
 * Join usage with session metadata and bucket by last-activity windows.
 * Sessions without a known timestamp only count toward the all-time total.
 */
function summarizeUsage({ usage, sessions = [], now = Date.now() } = {}) {
  if (!usage || !usage.total) return null;
  const meta = new Map();
  for (const s of sessions) meta.set(s.id, s);

  const windows = {
    last24h: { maxAgeMs: DAY_MS, totalTokens: 0, calls: 0, sessions: 0 },
    last7d: { maxAgeMs: 7 * DAY_MS, totalTokens: 0, calls: 0, sessions: 0 },
    last30d: { maxAgeMs: 30 * DAY_MS, totalTokens: 0, calls: 0, sessions: 0 },
  };

  const perSession = [];
  for (const s of Array.isArray(usage.sessions) ? usage.sessions : []) {
    if (!s || !s.total) continue;
    const m = meta.get(s.sessionId);
    const ts = m?.updatedAt ? Date.parse(m.updatedAt) : NaN;
    const age = Number.isFinite(ts) ? now - ts : null;
    perSession.push({
      id: s.sessionId,
      title: m?.title || "",
      updatedAt: m?.updatedAt || null,
      totalTokens: s.total.totalTokens || 0,
      calls: s.total.calls || 0,
    });
    if (age === null) continue;
    for (const w of Object.values(windows)) {
      if (age <= w.maxAgeMs) {
        w.totalTokens += s.total.totalTokens || 0;
        w.calls += s.total.calls || 0;
        w.sessions += 1;
      }
    }
  }
  perSession.sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    total: usage.total,
    skipped: usage.skipped || 0,
    sessionCount: Array.isArray(usage.sessions) ? usage.sessions.length : 0,
    byModel: Array.isArray(usage.byModel) ? usage.byModel : [],
    windows: {
      last24h: strip(windows.last24h),
      last7d: strip(windows.last7d),
      last30d: strip(windows.last30d),
    },
    topSessions: perSession.slice(0, 10),
    // Additive: null on old CLIs, which keeps the report byte-identical.
    attribution: normalizeAttribution(usage.attribution),
  };
}

function strip({ totalTokens, calls, sessions }) {
  return { totalTokens, calls, sessions };
}

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}

/**
 * Derive one-line high-cost hints from the summary. Only computed when the
 * CLI reported an attribution section (new CLI), and each hint only fires
 * when the fields it reads actually exist — no guessing on old data.
 */
function deriveUsageHints(summary) {
  const hints = [];
  if (!summary || !summary.attribution) return hints;

  // 1. Sub-agent-heavy: subagent share of attributed tokens.
  const byOrigin = summary.attribution.byOrigin;
  const attributedTotal = byOrigin.reduce((n, r) => n + num(r.totalTokens), 0);
  const sub = byOrigin.find((r) => r.origin === "subagent");
  if (sub && attributedTotal > 0) {
    const share = num(sub.totalTokens) / attributedTotal;
    if (share > SUBAGENT_SHARE_HINT_THRESHOLD) {
      hints.push(
        `Sub-agent-heavy: ${(share * 100).toFixed(0)}% of attributed tokens (${fmt(sub.totalTokens)} of ${fmt(attributedTotal)}) came from sub-agents (threshold ${SUBAGENT_SHARE_HINT_THRESHOLD * 100}%) — review spawn_sub_agent fan-out if unintended.`,
      );
    }
  }

  // 2. High cache-miss: only when the provider reports cache fields at all.
  const t = summary.total || {};
  if (
    typeof t.cacheReadTokens === "number" &&
    typeof t.cacheCreationTokens === "number" &&
    t.cacheReadTokens + t.cacheCreationTokens > 0
  ) {
    const input = num(t.inputTokens);
    if (
      input >= CACHE_MISS_MIN_INPUT_TOKENS &&
      num(t.cacheReadTokens) < CACHE_MISS_MAX_READ_RATIO * input
    ) {
      const pct = input > 0 ? ((num(t.cacheReadTokens) / input) * 100).toFixed(1) : "0";
      hints.push(
        `High cache-miss: only ${fmt(t.cacheReadTokens)} cache-read vs ${fmt(input)} input tokens (${pct}%, threshold ${CACHE_MISS_MAX_READ_RATIO * 100}%) — stable prompt prefixes may not be cache-aligned.`,
      );
    }
  }

  // 3. Long-context sessions: average input per LLM call.
  const calls = num(t.calls);
  if (typeof t.inputTokens === "number" && calls > 0) {
    const avg = num(t.inputTokens) / calls;
    if (avg > LONG_CONTEXT_AVG_INPUT_TOKENS) {
      hints.push(
        `Long-context: average input per LLM call is ${fmt(Math.round(avg))} tokens (threshold ${fmt(LONG_CONTEXT_AVG_INPUT_TOKENS)}) — consider compacting or splitting long sessions.`,
      );
    }
  }

  return hints;
}

/** Split rows into top-N + the folded remainder (null when under the cap). */
function capRows(rows, max = ATTRIBUTION_MAX_ROWS) {
  if (!Array.isArray(rows) || rows.length <= max)
    return { top: rows || [], others: null };
  return { top: rows.slice(0, max), others: rows.slice(max) };
}

function sumBy(rows, key) {
  return rows.reduce((n, r) => n + num(r[key]), 0);
}

const TURN_TOKENS_CAVEAT =
  "_Turn tokens ≈ is an approximation: every token_usage event in a turn is" +
  " attributed to EVERY tool that ran in that turn, so a turn's tokens count" +
  " once per distinct tool/server — do not sum that column across rows (it is" +
  " not a partition)._";

/** Markdown lines for the attribution sections (attribution known present). */
function attributionToLines(summary) {
  const a = summary.attribution;
  const lines = [];

  // ── By origin ──
  lines.push("## By origin", "");
  if (a.byOrigin.length === 0) {
    lines.push("_No attributed token_usage events recorded._");
  } else {
    const total = sumBy(a.byOrigin, "totalTokens");
    lines.push(
      "| Origin | Tokens | Share | In | Out | Calls |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const r of a.byOrigin) {
      const share =
        total > 0 ? `${((num(r.totalTokens) / total) * 100).toFixed(1)}%` : "—";
      lines.push(
        `| ${escapeCell(r.origin || "?")} | ${fmt(r.totalTokens)} | ${share} | ${fmt(r.inputTokens)} | ${fmt(r.outputTokens)} | ${fmt(r.calls)} |`,
      );
    }
  }

  // ── By skill ──
  lines.push("", "## By skill", "");
  if (a.bySkill.length === 0) {
    lines.push("_No skill-attributed usage (isolated skill runs) recorded._");
  } else {
    lines.push(
      "| Skill | Tokens | In | Out | Calls |",
      "| --- | ---: | ---: | ---: | ---: |",
    );
    const { top, others } = capRows(a.bySkill);
    for (const r of top) {
      lines.push(
        `| ${escapeCell(r.skill || "?")} | ${fmt(r.totalTokens)} | ${fmt(r.inputTokens)} | ${fmt(r.outputTokens)} | ${fmt(r.calls)} |`,
      );
    }
    if (others) {
      lines.push(
        `| _…${others.length} more_ | ${fmt(sumBy(others, "totalTokens"))} | ${fmt(sumBy(others, "inputTokens"))} | ${fmt(sumBy(others, "outputTokens"))} | ${fmt(sumBy(others, "calls"))} |`,
      );
    }
  }

  // ── By sub-agent ──
  lines.push("", "## By subagent", "");
  if (a.bySubagent.length === 0) {
    lines.push("_No sub-agent-attributed usage recorded._");
  } else {
    lines.push(
      "| Sub-agent | Role | Origin | Tokens | Calls |",
      "| --- | --- | --- | ---: | ---: |",
    );
    const { top, others } = capRows(a.bySubagent);
    for (const r of top) {
      lines.push(
        `| ${escapeCell(r.subagentId || "?")} | ${escapeCell(r.role || "")} | ${escapeCell(r.origin || "?")} | ${fmt(r.totalTokens)} | ${fmt(r.calls)} |`,
      );
    }
    if (others) {
      lines.push(
        `| _…${others.length} more_ | | | ${fmt(sumBy(others, "totalTokens"))} | ${fmt(sumBy(others, "calls"))} |`,
      );
    }
  }

  // ── Tool calls ──
  lines.push("", "## Tool calls", "");
  if (a.tools.byTool.length === 0) {
    lines.push("_No tool_call events recorded._");
  } else {
    lines.push(
      `**${fmt(a.tools.totalCalls)} calls · ${fmt(a.tools.totalErrors)} errors** across ${fmt(a.tools.byTool.length)} tool(s).`,
      "",
      "| Tool | MCP server | Calls | Errors | Turn tokens ≈ |",
      "| --- | --- | ---: | ---: | ---: |",
    );
    const { top, others } = capRows(a.tools.byTool);
    for (const r of top) {
      lines.push(
        `| ${escapeCell(r.tool || "?")} | ${escapeCell(r.mcpServer || "")} | ${fmt(r.calls)} | ${fmt(r.errors)} | ${fmt(r.turnTokens)} |`,
      );
    }
    if (others) {
      // turnTokens is per-row non-summable (see caveat) → never totalled.
      lines.push(
        `| _…${others.length} more_ | | ${fmt(sumBy(others, "calls"))} | ${fmt(sumBy(others, "errors"))} | — |`,
      );
    }
    if (a.tools.byMcpServer.length > 0) {
      lines.push(
        "",
        "### MCP servers",
        "",
        "| Server | Calls | Errors | Turn tokens ≈ |",
        "| --- | ---: | ---: | ---: |",
      );
      const servers = capRows(a.tools.byMcpServer);
      for (const r of servers.top) {
        lines.push(
          `| ${escapeCell(r.server || "?")} | ${fmt(r.calls)} | ${fmt(r.errors)} | ${fmt(r.turnTokens)} |`,
        );
      }
      if (servers.others) {
        lines.push(
          `| _…${servers.others.length} more_ | ${fmt(sumBy(servers.others, "calls"))} | ${fmt(sumBy(servers.others, "errors"))} | — |`,
        );
      }
    }
    lines.push("", TURN_TOKENS_CAVEAT);
  }

  // ── Hints ──
  const hints = deriveUsageHints(summary);
  if (hints.length > 0) {
    lines.push("", "## Hints", "");
    for (const h of hints) lines.push(`- ${h}`);
  }

  return lines;
}

/** Render the summary as the markdown report the command previews. */
function usageToMarkdown(summary) {
  if (!summary) return null;
  const t = summary.total;
  const lines = [
    "# ChainlessChain — Token Usage",
    "",
    `**All time:** ${fmt(t.totalTokens)} tokens · in ${fmt(t.inputTokens)} / out ${fmt(t.outputTokens)} · ${fmt(t.calls)} LLM calls · ${fmt(summary.sessionCount)} sessions` +
      (summary.skipped
        ? ` · ${summary.skipped} unreadable session(s) skipped`
        : ""),
    "",
    "## Activity windows",
    "",
    "Windows bucket by each session's LAST activity time (the usage store has",
    "no per-event timestamps), so a long-running session counts wholly toward",
    "its most recent window — treat these as approximations.",
    "",
    "| Window | Tokens | LLM calls | Sessions |",
    "| --- | ---: | ---: | ---: |",
    row("Last 24 h", summary.windows.last24h),
    row("Last 7 days", summary.windows.last7d),
    row("Last 30 days", summary.windows.last30d),
    "",
    "## By provider / model",
    "",
  ];
  if (summary.byModel.length === 0) {
    lines.push("_No token_usage events recorded yet._");
  } else {
    lines.push(
      "| Provider | Model | Tokens | In | Out | Calls |",
      "| --- | --- | ---: | ---: | ---: | ---: |",
    );
    for (const m of summary.byModel) {
      lines.push(
        `| ${m.provider || "?"} | ${m.model || "?"} | ${fmt(m.totalTokens)} | ${fmt(m.inputTokens)} | ${fmt(m.outputTokens)} | ${fmt(m.calls)} |`,
      );
    }
  }
  lines.push("", "## Top sessions", "");
  if (summary.topSessions.length === 0) {
    lines.push("_No sessions with recorded usage._");
  } else {
    lines.push(
      "| Session | Title | Last activity | Tokens | Calls |",
      "| --- | --- | --- | ---: | ---: |",
    );
    for (const s of summary.topSessions) {
      lines.push(
        `| \`${s.id.slice(0, 24)}\` | ${escapeCell(s.title)} | ${s.updatedAt || "?"} | ${fmt(s.totalTokens)} | ${fmt(s.calls)} |`,
      );
    }
  }
  if (summary.attribution) {
    // New CLI (attribution section present): render the 用量归因 sections.
    lines.push("", ...attributionToLines(summary), "");
  } else {
    // Old CLI: keep the legacy tail byte-identical.
    lines.push(
      "",
      "_Per-skill / per-subagent / per-plugin attribution needs CLI-side event tagging (not recorded yet)._",
      "",
    );
  }
  return lines.join("\n");
}

function row(label, w) {
  return `| ${label} | ${fmt(w.totalTokens)} | ${fmt(w.calls)} | ${fmt(w.sessions)} |`;
}

function escapeCell(s) {
  // Newlines/backticks would break the table row; pipes would open new cells.
  return String(s || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .slice(0, 60);
}

module.exports = {
  ATTRIBUTION_MAX_ROWS,
  CACHE_MISS_MAX_READ_RATIO,
  CACHE_MISS_MIN_INPUT_TOKENS,
  LONG_CONTEXT_AVG_INPUT_TOKENS,
  SUBAGENT_SHARE_HINT_THRESHOLD,
  buildSessionListArgs,
  buildUsageArgs,
  deriveUsageHints,
  parseSessionListJson,
  parseUsageJson,
  summarizeUsage,
  usageToMarkdown,
};
