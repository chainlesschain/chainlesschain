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
 * Design constraints (this project hates model-id churn noise):
 *  - The list is deliberately SMALL and conservative — only model ids that the
 *    provider has officially retired or scheduled for removal. A false warning
 *    on a live model is worse than a missing one, so when in doubt it's left
 *    out. Matching never prefix-collides with current models (no bare `gpt-4`
 *    or `claude-3` patterns — only dated/retired snapshots).
 *  - Pure + fail-open: a lookup never throws and is trivially unit-testable.
 *  - The notice goes to stderr (keeps stdout clean for JSON/headless output),
 *    fires at most once per model per process, and is silenced with
 *    CC_MODEL_NOTICE=0.
 */

import chalk from "chalk";

/**
 * Retired / deprecated model snapshots, most-specific first. `id` is matched
 * case-insensitively as an exact id OR a prefix (so `claude-2` covers
 * `claude-2.0` / `claude-2.1`). Patterns are chosen to never prefix-match a
 * currently-GA model.
 *
 * @type {Array<{id: string, reason: string, replacement: string}>}
 */
export const DEPRECATED_MODELS = [
  // ── Anthropic (officially retired / deprecated) ───────────────────────────
  {
    id: "claude-3-opus-20240229",
    reason: "Anthropic deprecated this Claude 3 Opus snapshot",
    replacement: "claude-opus-4-8 (or another Claude 4.x model)",
  },
  {
    id: "claude-3-sonnet-20240229",
    reason: "Anthropic retired this Claude 3 Sonnet snapshot",
    replacement: "claude-sonnet-4-6",
  },
  {
    id: "claude-2",
    reason: "Anthropic retired the Claude 2 family",
    replacement: "claude-sonnet-4-6 or claude-opus-4-8",
  },
  {
    id: "claude-instant",
    reason: "Anthropic retired Claude Instant",
    replacement: "claude-haiku-4-5",
  },
  {
    id: "claude-1",
    reason: "Anthropic retired the Claude 1 family",
    replacement: "claude-sonnet-4-6 or claude-opus-4-8",
  },
  // ── OpenAI (retired snapshots) ────────────────────────────────────────────
  {
    id: "gpt-4-vision-preview",
    reason: "OpenAI retired the gpt-4 vision preview",
    replacement: "gpt-5 (natively multimodal)",
  },
  {
    id: "gpt-4-1106-vision-preview",
    reason: "OpenAI retired the gpt-4 vision preview",
    replacement: "gpt-5 (natively multimodal)",
  },
  {
    id: "gpt-4-32k",
    reason: "OpenAI retired the gpt-4-32k snapshots",
    replacement: "gpt-5 or gpt-4o",
  },
  {
    id: "gpt-4-0314",
    reason: "OpenAI retired this gpt-4 snapshot",
    replacement: "gpt-5 or gpt-4o",
  },
  {
    id: "gpt-4-0613",
    reason: "OpenAI retired this gpt-4 snapshot",
    replacement: "gpt-5 or gpt-4o",
  },
  {
    id: "gpt-3.5-turbo-0301",
    reason: "OpenAI retired this gpt-3.5-turbo snapshot",
    replacement: "gpt-4o-mini or gpt-5-mini",
  },
  {
    id: "gpt-3.5-turbo-0613",
    reason: "OpenAI retired this gpt-3.5-turbo snapshot",
    replacement: "gpt-4o-mini or gpt-5-mini",
  },
  {
    id: "text-davinci-002",
    reason: "OpenAI retired the text-davinci completion models",
    replacement: "gpt-4o-mini or gpt-5-mini",
  },
  {
    id: "text-davinci-003",
    reason: "OpenAI retired the text-davinci completion models",
    replacement: "gpt-4o-mini or gpt-5-mini",
  },
];

/**
 * Look up a model id against the retired list.
 *
 * @param {string} modelId
 * @returns {{id: string, reason: string, replacement: string}|null}
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
 * @param {{id: string, reason: string, replacement: string}} info
 * @returns {string}
 */
export function formatModelDeprecationWarning(info) {
  return (
    `Warning: model "${info.id}" is deprecated — ${info.reason}. ` +
    `Consider switching to ${info.replacement}. (CC_MODEL_NOTICE=0 to hide)`
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
 * @param {(line:string)=>void} [opts.print]  defaults to a gray stderr writer
 * @param {Set}    [opts.seen]            dedup set (defaults to module `_warned`)
 * @returns {{ warned: boolean, info: object|null }}
 */
export function maybeWarnDeprecatedModel(opts = {}) {
  const env = opts.env || process.env;
  const seen = opts.seen || _warned;
  const print =
    opts.print || ((line) => process.stderr.write(chalk.yellow(line) + "\n"));
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
