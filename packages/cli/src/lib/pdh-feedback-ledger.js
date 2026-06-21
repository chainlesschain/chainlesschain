/**
 * PDH feedback ledger (design module 101 §3.5.13) — durable, cross-session
 * persistence of the self-learning feedback the personal-data chat collects.
 *
 * The Android 纠正卡 sends {type:feedback,turn_id,kind,comment} to the cc agent;
 * headless-stream.js consumes it within the session (ack + correction turn /
 * preference note). That is in-session only. This ledger appends every feedback
 * to <home>/pdh-feedback.jsonl so future sessions can learn the user's standing
 * preferences — the "越用越聪明" flywheel (§3.5.13/§8.2). Append-only and
 * best-effort: a learning ledger must never break the live chat.
 *
 * Pure CLI, no Android dependency, fully unit-testable through `_deps`.
 */
import fs from "node:fs";
import path from "node:path";
import { getHomeDir } from "./paths.js";

const VALID_KINDS = new Set(["positive", "negative", "correction"]);

export const _deps = {
  homeDir: () => getHomeDir(),
  appendFile: (p, s) => fs.appendFileSync(p, s, "utf-8"),
  readFile: (p) => fs.readFileSync(p, "utf-8"),
  exists: (p) => fs.existsSync(p),
  mkdir: (d) => fs.mkdirSync(d, { recursive: true }),
  now: () => Date.now(),
};

/** `<home>/pdh-feedback.jsonl`. */
export function feedbackLedgerPath(deps = _deps) {
  return path.join(deps.homeDir(), "pdh-feedback.jsonl");
}

/**
 * Append one feedback entry. Best-effort: never throws (a learning ledger must
 * not break the live chat). Returns the written record, or null on skip/failure.
 * A `comment` is only kept for `correction` (thumbs carry no ground truth).
 */
export function appendFeedback(entry, deps = _deps) {
  const kind = String(entry?.kind || "").toLowerCase();
  if (!VALID_KINDS.has(kind)) return null;
  const rec = {
    ts: deps.now(),
    sessionId: entry.sessionId != null ? String(entry.sessionId) : null,
    turnId: entry.turnId != null ? String(entry.turnId) : null,
    kind,
    comment:
      kind === "correction" &&
      typeof entry.comment === "string" &&
      entry.comment
        ? entry.comment
        : null,
  };
  try {
    const file = feedbackLedgerPath(deps);
    const dir = path.dirname(file);
    if (!deps.exists(dir)) deps.mkdir(dir);
    deps.appendFile(file, JSON.stringify(rec) + "\n");
    return rec;
  } catch {
    return null; // persistence is best-effort; the live turn carries on
  }
}

/** Read all ledger entries (oldest-first), skipping malformed/invalid lines. */
export function readFeedback(deps = _deps) {
  const file = feedbackLedgerPath(deps);
  let raw;
  try {
    if (!deps.exists(file)) return [];
    raw = deps.readFile(file);
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o && VALID_KINDS.has(o.kind)) out.push(o);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/**
 * Summarize the ledger into the user's standing preferences:
 *   { total, positive, negative, corrections:[newest-first], sentiment }
 * Pure over a list (caller passes readFeedback()). Corrections are the most
 * actionable ground truth, so the newest few are surfaced verbatim.
 */
export function summarizeFeedback(entries, { maxCorrections = 5 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  let positive = 0;
  let negative = 0;
  const corrections = [];
  for (const e of list) {
    if (e.kind === "positive") positive++;
    else if (e.kind === "negative") negative++;
    else if (e.kind === "correction" && e.comment) corrections.push(e.comment);
  }
  return {
    total: list.length,
    positive,
    negative,
    corrections: corrections.slice(-maxCorrections).reverse(),
    sentiment: positive - negative,
  };
}

/**
 * A compact Chinese system-note from a summary, for re-injecting learned
 * preferences into a new session's prompt. "" when nothing has been learned.
 */
export function feedbackSystemNote(summary) {
  if (!summary || !summary.total) return "";
  const parts = [];
  if (summary.corrections.length) {
    parts.push(
      "用户过往纠正（请遵循）：" +
        summary.corrections.map((c) => `「${c}」`).join("；"),
    );
  }
  if (summary.sentiment > 0) parts.push("用户总体认可你的回复风格。");
  else if (summary.sentiment < 0)
    parts.push("用户对过往回复多有不满，请更严谨、更贴合需求。");
  return parts.join(" ");
}
