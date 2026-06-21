/**
 * Deprecated-model warning — Claude-Code 2.1.183 parity:
 * "a warning when the requested model is deprecated or automatically updated
 *  to a newer model".
 *
 * The "automatically updated to a newer model" half is already covered by the
 * fallback-model machinery (a model-not-found error switches to the next model
 * in the chain and surfaces an onFallback notice — see fallback-model.js +
 * agent.js / agent-repl.js). This module covers the PROACTIVE half: warn once,
 * up front, when the user's *configured / requested* model id is on a small,
 * high-confidence list of provider-retired model snapshots — before the run
 * fails with an opaque "model not found".
 *
 * The Anthropic entries below are kept in sync with the authoritative model
 * deprecation table (platform.claude.com/docs/en/about-claude/model-deprecations,
 * verified 2026-06-21). `state` distinguishes "retired" (requests now fail) from
 * "deprecated" (still works, not recommended, has a retirement date).
 *
 * Design constraints (this project hates model-id churn noise):
 *  - Only ids the provider has officially retired or deprecated. A false warning
 *    on a live model is worse than a missing one.
 *  - CRITICAL: the Claude 4 family has BOTH active and retired members that
 *    differ only by date suffix (claude-opus-4-8 active vs claude-opus-4-20250514
 *    retired), so those entries use EXACT dated ids and must never be turned into
 *    bare prefixes. Older families (1 / 2 / 3 / 3.5 / 3.7) are fully retired, so a
 *    family prefix is safe there.
 *  - Pure + fail-open: a lookup never throws and is trivially unit-testable.
 *  - The notice goes to stderr (keeps stdout clean for JSON/headless output),
 *    fires at most once per model per process, and is silenced with
 *    CC_MODEL_NOTICE=0.
 */

import chalk from "chalk";

/**
 * Retired / deprecated model snapshots, most-specific first. `id` is matched
 * case-insensitively as an exact id OR a prefix (so `claude-2` covers
 * `claude-2.0` / `claude-2.1`, and `claude-3-5-sonnet` covers both 3.5 Sonnet
 * snapshots). Prefixes are only used for fully-retired families — never for the
 * Claude 4 family, whose active and retired members share a prefix.
 *
 * @type {Array<{id: string, state: "retired"|"deprecated", reason: string, replacement: string}>}
 */
export const DEPRECATED_MODELS = [
  // ── Anthropic — Claude 4 family (EXACT dated ids only; prefixes would hit
  //    the active claude-opus-4-8 / -4-7 / -4-6 / -4-5-20251101 / sonnet-4-6 /
  //    sonnet-4-5-20250929 / haiku-4-5-20251001 models) ──────────────────────
  {
    id: "claude-opus-4-1-20250805",
    state: "deprecated",
    reason: "Anthropic deprecated Claude Opus 4.1 (retires 2026-08-05)",
    replacement: "claude-opus-4-8",
  },
  {
    id: "claude-opus-4-20250514",
    state: "retired",
    reason: "Anthropic retired the original Claude Opus 4 snapshot",
    replacement: "claude-opus-4-8",
  },
  {
    id: "claude-sonnet-4-20250514",
    state: "retired",
    reason: "Anthropic retired the original Claude Sonnet 4 snapshot",
    replacement: "claude-sonnet-4-6",
  },
  // ── Anthropic — fully-retired older families (family prefix is safe) ───────
  {
    id: "claude-3-7-sonnet",
    state: "retired",
    reason: "Anthropic retired Claude Sonnet 3.7",
    replacement: "claude-sonnet-4-6",
  },
  {
    id: "claude-3-5-sonnet",
    state: "retired",
    reason: "Anthropic retired the Claude 3.5 Sonnet snapshots",
    replacement: "claude-sonnet-4-6",
  },
  {
    id: "claude-3-5-haiku",
    state: "retired",
    reason: "Anthropic retired Claude Haiku 3.5",
    replacement: "claude-haiku-4-5",
  },
  {
    id: "claude-3-opus-20240229",
    state: "retired",
    reason: "Anthropic retired Claude 3 Opus",
    replacement: "claude-opus-4-8",
  },
  {
    id: "claude-3-sonnet-20240229",
    state: "retired",
    reason: "Anthropic retired Claude 3 Sonnet",
    replacement: "claude-sonnet-4-6",
  },
  {
    id: "claude-3-haiku-20240307",
    state: "retired",
    reason: "Anthropic retired Claude 3 Haiku",
    replacement: "claude-haiku-4-5",
  },
  {
    id: "claude-2",
    state: "retired",
    reason: "Anthropic retired the Claude 2 family",
    replacement: "claude-sonnet-4-6 or claude-opus-4-8",
  },
  {
    id: "claude-instant",
    state: "retired",
    reason: "Anthropic retired Claude Instant",
    replacement: "claude-haiku-4-5",
  },
  {
    id: "claude-1",
    state: "retired",
    reason: "Anthropic retired the Claude 1 family",
    replacement: "claude-sonnet-4-6 or claude-opus-4-8",
  },
  // ── OpenAI (retired snapshots) ────────────────────────────────────────────
  {
    id: "gpt-4-vision-preview",
    state: "retired",
    reason: "OpenAI retired the gpt-4 vision preview",
    replacement: "gpt-5 (natively multimodal)",
  },
  {
    id: "gpt-4-1106-vision-preview",
    state: "retired",
    reason: "OpenAI retired the gpt-4 vision preview",
    replacement: "gpt-5 (natively multimodal)",
  },
  {
    id: "gpt-4-32k",
    state: "retired",
    reason: "OpenAI retired the gpt-4-32k snapshots",
    replacement: "gpt-5 or gpt-4o",
  },
  {
    id: "gpt-4-0314",
    state: "retired",
    reason: "OpenAI retired this gpt-4 snapshot",
    replacement: "gpt-5 or gpt-4o",
  },
  {
    id: "gpt-4-0613",
    state: "retired",
    reason: "OpenAI retired this gpt-4 snapshot",
    replacement: "gpt-5 or gpt-4o",
  },
  {
    id: "gpt-3.5-turbo-0301",
    state: "retired",
    reason: "OpenAI retired this gpt-3.5-turbo snapshot",
    replacement: "gpt-4o-mini or gpt-5-mini",
  },
  {
    id: "gpt-3.5-turbo-0613",
    state: "retired",
    reason: "OpenAI retired this gpt-3.5-turbo snapshot",
    replacement: "gpt-4o-mini or gpt-5-mini",
  },
  {
    id: "text-davinci-002",
    state: "retired",
    reason: "OpenAI retired the text-davinci completion models",
    replacement: "gpt-4o-mini or gpt-5-mini",
  },
  {
    id: "text-davinci-003",
    state: "retired",
    reason: "OpenAI retired the text-davinci completion models",
    replacement: "gpt-4o-mini or gpt-5-mini",
  },
];

/**
 * Look up a model id against the retired list.
 *
 * @param {string} modelId
 * @returns {{id: string, state: string, reason: string, replacement: string}|null}
 *          the matched entry (with `id` = the configured model), or null.
 */
export function checkModelDeprecation(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  const norm = modelId.trim().toLowerCase();
  if (!norm) return null;
  for (const entry of DEPRECATED_MODELS) {
    const pat = entry.id.toLowerCase();
    if (norm === pat || norm.startsWith(pat)) {
      return { ...entry, id: modelId };
    }
  }
  return null;
}

/**
 * Human-readable one-line warning for a matched deprecation.
 *
 * @param {{id: string, state?: string, reason: string, replacement: string}} info
 * @returns {string}
 */
export function formatModelDeprecationWarning(info) {
  const verb = info.state === "retired" ? "has been retired" : "is deprecated";
  return (
    `Warning: model "${info.id}" ${verb} — ${info.reason}. ` +
    `Switch to ${info.replacement}. (CC_MODEL_NOTICE=0 to hide)`
  );
}

/** Models already warned about in this process — one notice per id. */
export const _warned = new Set();

/**
 * Entry-point hook: warn once on stderr if `model` is a retired snapshot.
 * Cheap, fail-open, never throws.
 *
 * @param {object} opts
 * @param {string}  opts.model            the resolved model id
 * @param {object} [opts.env]             defaults to process.env
 * @param {(line:string)=>void} [opts.print]  defaults to a yellow stderr writer
 * @param {Set}    [opts.seen]            dedup set (defaults to module `_warned`)
 * @returns {{ warned: boolean, info: object|null }}
 */
export function maybeWarnDeprecatedModel(opts = {}) {
  const env = opts.env || process.env;
  const seen = opts.seen || _warned;
  const print =
    opts.print ||
    ((line) => process.stderr.write(chalk.yellow(line) + "\n"));
  const out = { warned: false, info: null };
  try {
    if (env.CC_MODEL_NOTICE === "0") return out;
    const info = checkModelDeprecation(opts.model);
    if (!info) return out;
    const key = String(opts.model).toLowerCase();
    if (seen.has(key)) {
      out.info = info;
      return out;
    }
    seen.add(key);
    print(formatModelDeprecationWarning(info));
    out.warned = true;
    out.info = info;
  } catch {
    /* fail-open: a deprecation notice must never affect the run */
  }
  return out;
}
