/**
 * Subagent contract — the full inheritance/override envelope for a spawned
 * child agent (P1 "补齐 Subagent 契约").
 *
 * `agents.js` already parses tools/disallowedTools/model/maxTurns/isolation and
 * agent-core's `_executeSpawnSubAgent` enforces a depth cap
 * (`MAX_SUB_AGENT_DEPTH`) + a shared breadth counter. This module adds the REST
 * of the Claude-Code subagent contract — `permissionMode`, `skills`,
 * `mcpServers`, `hooks`, `memory`, `effort`, `background`,
 * `context (fresh|fork)`, `maxDepth`/`maxChildren` and token/cost/time budgets —
 * as PURE, deterministic functions (no timers, no RNG, no I/O):
 *
 *   normalizeSubagentContract(raw)   validate + canonicalize one declaration
 *   resolveSubagentContract(...)     merge parent ⊕ definition ⊕ spawnArgs with
 *                                    SECURITY INVARIANTS
 *   enforceRecursionLimits(...)      fail-closed depth / breadth guard
 *   resolveIsolationFailClosed(...)  worktree isolation must fail, not fall back
 *
 * Security invariants (mirrors [[agent-authority.js]] — never trust the child to
 * de-escalate the parent's guardrails; a child may only ever be EQUAL OR MORE
 * RESTRICTIVE than its parent, never widen):
 *   - `permissionMode` is TIGHTEN-ONLY: a child requesting a more permissive
 *     mode than its parent is clamped to the parent's mode.
 *   - `skills`/`mcpServers`/`hooks` are INTERSECTED with the parent's set (the
 *     parent list is the ceiling; a child can never gain a capability the
 *     parent lacked). `context: fresh` withholds them entirely; only `fork`
 *     inherits when the child is silent.
 *   - `memory` access can be inherited on fork but never granted if the parent
 *     explicitly denied it.
 *   - every budget field (tokens/cost/time) is capped at the parent's REMAINING.
 *   - `maxDepth`/`maxChildren` are ceilings a child may lower but never raise.
 *
 * These are POLICY functions. The spawn path (`_executeSpawnSubAgent`) and the
 * agent-file parser (`agents.js`) feed them; deeper runtime application of the
 * resolved fields (e.g. threading `permissionMode`/`effort` into the child
 * agentLoop) is wired incrementally.
 */

// Public → canonical permission modes, ordered by PERMISSIVENESS (see rank).
// Kept in sync with headless-runner's VALID_PERMISSION_MODES.
export const SUBAGENT_PERMISSION_MODES = Object.freeze([
  "plan",
  "manual",
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
]);

// Higher = more powerful. `plan` is read-only (most restrictive);
// `bypassPermissions` skips every gate (most permissive). `auto` and `dontAsk`
// share a tier (both auto-approve). Used only for tighten-only clamping.
const PERMISSION_RANK = Object.freeze({
  plan: 0,
  manual: 1,
  default: 2,
  acceptEdits: 3,
  auto: 4,
  dontAsk: 4,
  bypassPermissions: 5,
});

export const SUBAGENT_CONTEXT_MODES = Object.freeze(["fresh", "fork"]);

// Reasoning-effort levels (matches the REPL `/effort` command's vocabulary).
export const SUBAGENT_EFFORT_LEVELS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
]);
const EFFORT_SYNONYMS = Object.freeze({ med: "medium", max: "xhigh" });

// ─── small pure helpers ─────────────────────────────────────────────────────

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  return null; // unrecognized → unspecified
}

function toPosInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function toPosNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The smaller of two ceilings, treating null as "no limit from that source". */
function minNullable(a, b) {
  if (a == null) return b == null ? null : b;
  if (b == null) return a;
  return Math.min(a, b);
}

/**
 * Normalize a capability list (skills/mcpServers/hooks). `null`/`undefined` →
 * `null` (UNSPECIFIED — inherit per context). A string or array → a trimmed,
 * de-duplicated `string[]` (possibly `[]`, meaning EXPLICITLY NONE).
 */
export function normalizeCapabilityList(v) {
  if (v == null) return null;
  const list = Array.isArray(v) ? v : String(v).split(/[,\s]+/);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const s = String(item).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out; // may be [] (explicit empty)
}

/** Normalize a `{tokens, cost/costUsd, time/timeMs}` budget → canonical or null. */
export function normalizeBudget(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tokens = toPosNum(raw.tokens);
  const costUsd = toPosNum(raw.costUsd ?? raw.cost);
  const timeMs = toPosNum(raw.timeMs ?? raw.time);
  if (tokens == null && costUsd == null && timeMs == null) return null;
  return { tokens, costUsd, timeMs };
}

/** Permissiveness rank of a mode (unknown → `default`'s rank). */
export function permissionRank(mode) {
  return PERMISSION_RANK[mode] ?? PERMISSION_RANK.default;
}

/**
 * TIGHTEN-ONLY permission resolution. The child's exact choice is honored when
 * it is equal-or-more-restrictive than the parent; a widening request (or an
 * invalid/absent one) clamps to the parent's mode. A child can never escalate.
 */
export function tightenPermissionMode(parentMode, requestedMode) {
  const parent = SUBAGENT_PERMISSION_MODES.includes(parentMode)
    ? parentMode
    : "default";
  if (requestedMode == null) return parent; // silent child → inherit
  if (!SUBAGENT_PERMISSION_MODES.includes(requestedMode)) return parent; // invalid → fail-safe
  return permissionRank(requestedMode) <= permissionRank(parent)
    ? requestedMode
    : parent;
}

// ─── normalize one declaration ──────────────────────────────────────────────

/**
 * Validate + canonicalize a raw contract declaration (agent-file frontmatter or
 * spawn args). Unknown/invalid values are DROPPED (→ null), never thrown, so a
 * malformed field degrades to "unspecified" rather than breaking the spawn.
 *
 * Every field is nullable: `null` means UNSPECIFIED (defer to inheritance),
 * distinct from an explicit value like `false` or `[]`.
 */
export function normalizeSubagentContract(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};

  const permissionMode = SUBAGENT_PERMISSION_MODES.includes(r.permissionMode)
    ? r.permissionMode
    : null;

  const context = SUBAGENT_CONTEXT_MODES.includes(r.context) ? r.context : null;

  let effort = null;
  if (r.effort != null) {
    const e = String(r.effort).trim().toLowerCase();
    const canon = EFFORT_SYNONYMS[e] || e;
    if (SUBAGENT_EFFORT_LEVELS.includes(canon)) effort = canon;
  }

  return {
    permissionMode,
    skills: normalizeCapabilityList(r.skills),
    mcpServers: normalizeCapabilityList(r.mcpServers),
    hooks: normalizeCapabilityList(r.hooks),
    memory: r.memory == null ? null : toBool(r.memory),
    effort,
    background: r.background == null ? null : toBool(r.background),
    context,
    maxDepth: toPosInt(r.maxDepth),
    maxChildren: toPosInt(r.maxChildren),
    budget: normalizeBudget(r.budget),
  };
}

// ─── resolve inheritance / override ─────────────────────────────────────────

/** spawnArgs ⊕ definition — the child's REQUESTED value for one field. */
function requested(field, definition, spawnArgs) {
  const s = spawnArgs ? spawnArgs[field] : undefined;
  if (s != null) return s;
  const d = definition ? definition[field] : undefined;
  return d != null ? d : null;
}

/**
 * Resolve a capability list (skills/mcp/hooks) with tighten-only semantics.
 * The parent list is the CEILING (null = "all available", no restriction).
 *   - explicit child list → INTERSECT with the parent ceiling.
 *   - silent child → inherit the parent list on `fork`; `[]` (none) on `fresh`.
 */
function resolveCapability(parentList, reqList, context) {
  if (reqList != null) {
    if (parentList == null) return reqList; // parent unrestricted → child's list as-is
    const allowed = new Set(parentList);
    return reqList.filter((x) => allowed.has(x)); // never gain what parent lacked
  }
  // silent child
  if (context === "fork") return parentList == null ? null : [...parentList];
  return []; // fresh → no inherited capabilities
}

/** Cap a requested budget at the parent's remaining (per field; null=unlimited). */
export function capBudget(requestedBudget, parentRemaining) {
  const req = requestedBudget || null;
  const rem = parentRemaining || null;
  if (!req && !rem) return null;
  const cap = (a, b) => {
    if (a == null) return b == null ? null : b;
    if (b == null) return a;
    return Math.min(a, b);
  };
  const tokens = cap(req?.tokens ?? null, rem?.tokens ?? null);
  const costUsd = cap(req?.costUsd ?? null, rem?.costUsd ?? null);
  const timeMs = cap(req?.timeMs ?? null, rem?.timeMs ?? null);
  if (tokens == null && costUsd == null && timeMs == null) return null;
  return { tokens, costUsd, timeMs };
}

/**
 * Merge a parent's effective contract with the child's agent-file definition
 * and per-spawn args into the child's EFFECTIVE contract, applying every
 * security invariant. Precedence for the raw request: spawnArgs > definition;
 * the parent then acts as the ceiling.
 *
 * @param {object} opts
 * @param {object} [opts.parent]      parent's EFFECTIVE contract, plus
 *        `budgetRemaining` ({tokens,costUsd,timeMs}) if the run tracks it.
 * @param {object} [opts.definition]  normalized agent-file contract (or null).
 * @param {object} [opts.spawnArgs]   normalized per-spawn contract (or null).
 * @returns {object} effective contract (all fields resolved, never null-widening)
 */
export function resolveSubagentContract({
  parent = {},
  definition = null,
  spawnArgs = null,
} = {}) {
  const p = parent && typeof parent === "object" ? parent : {};

  // context first — it governs how silent capability/memory fields inherit.
  const context =
    requested("context", definition, spawnArgs) ||
    (SUBAGENT_CONTEXT_MODES.includes(p.context) ? p.context : "fresh");

  const permissionMode = tightenPermissionMode(
    p.permissionMode,
    requested("permissionMode", definition, spawnArgs),
  );

  // effort is compute, not authority — inherit when the child is silent.
  const effort = requested("effort", definition, spawnArgs) ?? p.effort ?? null;

  const skills = resolveCapability(
    p.skills ?? null,
    requested("skills", definition, spawnArgs),
    context,
  );
  const mcpServers = resolveCapability(
    p.mcpServers ?? null,
    requested("mcpServers", definition, spawnArgs),
    context,
  );
  const hooks = resolveCapability(
    p.hooks ?? null,
    requested("hooks", definition, spawnArgs),
    context,
  );

  // memory: want it explicitly, or inherit on fork if the parent had it; but a
  // parent that explicitly denied memory can never have it granted downstream.
  const memReq = requested("memory", definition, spawnArgs);
  const want =
    memReq != null ? Boolean(memReq) : context === "fork" && p.memory === true;
  const memory = want && p.memory !== false;

  const backgroundReq = requested("background", definition, spawnArgs);
  const background = backgroundReq != null ? Boolean(backgroundReq) : false;

  // depth/children ceilings — a child may lower but never raise the inherited cap.
  const maxDepth = minNullable(
    p.maxDepth ?? null,
    requested("maxDepth", definition, spawnArgs),
  );
  const maxChildren = minNullable(
    p.maxChildren ?? null,
    requested("maxChildren", definition, spawnArgs),
  );

  const budget = capBudget(
    requested("budget", definition, spawnArgs),
    p.budgetRemaining ?? null,
  );

  return {
    permissionMode,
    context,
    effort,
    skills,
    mcpServers,
    hooks,
    memory,
    background,
    maxDepth,
    maxChildren,
    budget,
  };
}

// ─── recursion guard ────────────────────────────────────────────────────────

/**
 * Fail-closed depth / breadth guard. `contract.maxDepth`/`maxChildren` are the
 * child-declared ceilings; `hardDepthCap`/`hardChildrenCap` are the run's
 * absolute backstops. The effective cap is the smaller of the two.
 *
 * @returns {{ok: boolean, reason: string|null}}
 */
export function enforceRecursionLimits({
  depth = 0,
  spawnedCount = 0,
  contract = {},
  hardDepthCap = null,
  hardChildrenCap = null,
} = {}) {
  const depthCap = minNullable(contract?.maxDepth ?? null, hardDepthCap);
  if (depthCap != null && Number(depth) >= depthCap) {
    return {
      ok: false,
      reason: `max nesting depth (${depthCap}) reached`,
    };
  }
  const childCap = minNullable(contract?.maxChildren ?? null, hardChildrenCap);
  if (childCap != null && Number(spawnedCount) >= childCap) {
    return {
      ok: false,
      reason: `max sub-agents (${childCap}) reached`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * Worktree isolation must FAIL CLOSED, never silently fall back to the parent
 * checkout. When a contract requests `isolation: worktree` but the environment
 * can't provide one (not a git repo, worktree add failed), the spawn is denied.
 *
 * @returns {{ok: boolean, isolation: string|null, reason: string|null}}
 */
export function resolveIsolationFailClosed({
  requested: isolationRequested = null,
  available = false,
} = {}) {
  if (isolationRequested !== "worktree") {
    return { ok: true, isolation: null, reason: null };
  }
  if (!available) {
    return {
      ok: false,
      isolation: "worktree",
      reason:
        "worktree isolation was requested but is unavailable — refusing to run in the parent checkout",
    };
  }
  return { ok: true, isolation: "worktree", reason: null };
}
