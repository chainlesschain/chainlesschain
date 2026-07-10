/**
 * Usage report (P1 #6 账户/用量 UI) — pure logic for the
 * `chainlesschain.usage.show` command. Joins `cc session usage --json`
 * (per-session token totals + per-model rollup) with `cc session list --json`
 * (titles + last-activity timestamps) and renders a markdown report with
 * activity-window buckets (last 24 h / 7 d / 30 d / all time).
 *
 * The usage store records no per-event timestamps, so windows bucket by each
 * SESSION's last-activity time — an approximation the report states openly.
 * Attribution by skill/subagent/plugin (Claude-Code parity) needs CLI-side
 * event tagging and is out of the IDE's hands.
 */

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
  };
}

function strip({ totalTokens, calls, sessions }) {
  return { totalTokens, calls, sessions };
}

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
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
  lines.push(
    "",
    "_Per-skill / per-subagent / per-plugin attribution needs CLI-side event tagging (not recorded yet)._",
    "",
  );
  return lines.join("\n");
}

function row(label, w) {
  return `| ${label} | ${fmt(w.totalTokens)} | ${fmt(w.calls)} | ${fmt(w.sessions)} |`;
}

function escapeCell(s) {
  return String(s || "")
    .replace(/\|/g, "\\|")
    .slice(0, 60);
}

module.exports = {
  buildSessionListArgs,
  buildUsageArgs,
  parseSessionListJson,
  parseUsageJson,
  summarizeUsage,
  usageToMarkdown,
};
