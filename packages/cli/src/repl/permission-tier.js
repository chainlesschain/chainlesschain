/**
 * Map a `/permissions <arg>` tier alias to an ApprovalGate session-policy tier
 * (strict | trusted | autopilot), or null when the arg is not a known tier.
 * Pure → unit-testable. Mirrors `cc session policy --set` and the headless
 * --permission-mode mapping (default → strict, acceptEdits → trusted,
 * bypassPermissions → autopilot), giving the interactive REPL a mid-session
 * permission-mode toggle (Claude-Code Shift+Tab mode-cycling parity).
 */
const TIER_ALIASES = {
  // strict — every risky action asks (the default)
  strict: "strict",
  default: "strict",
  manual: "strict",
  normal: "strict",
  off: "strict",
  // trusted — low/medium-risk auto-approved, high-risk still asks (acceptEdits)
  trusted: "trusted",
  accept: "trusted",
  "accept-edits": "trusted",
  acceptedits: "trusted",
  // autopilot — everything auto-approved (bypassPermissions)
  autopilot: "autopilot",
  bypass: "autopilot",
  bypasspermissions: "autopilot",
  yolo: "autopilot",
};

/** Cycle order for Shift+Tab mode cycling (Claude-Code parity). */
export const TIER_CYCLE = Object.freeze(["strict", "trusted", "autopilot"]);

/**
 * Next tier in the Shift+Tab cycle: strict → trusted → autopilot → strict.
 * An unrecognized current tier resets to the first (strict).
 */
export function nextTier(current) {
  const i = TIER_CYCLE.indexOf(current);
  return TIER_CYCLE[(i + 1) % TIER_CYCLE.length];
}

export function parsePermissionTier(arg) {
  const a = String(arg == null ? "" : arg)
    .trim()
    .toLowerCase();
  return Object.prototype.hasOwnProperty.call(TIER_ALIASES, a)
    ? TIER_ALIASES[a]
    : null;
}

const AUTO_ALIASES = new Set(["auto", "auto-mode", "automode"]);
const DONT_ASK_ALIASES = new Set(["dontask", "dont-ask", "noask", "no-ask"]);

/**
 * Parse a permission-mode argument that may also be `auto` (the configurable
 * autoMode.decisions classifier) or `dontAsk` (anything that would prompt is
 * denied instead — headless semantics brought to the interactive session).
 * Auto rides the trusted gate tier; dontAsk rides strict; the REPL activates
 * the matching behavior while the mode is engaged.
 *
 * @param {string} arg
 * @returns {{ tier: "strict"|"trusted"|"autopilot", auto: boolean, dontAsk: boolean } | null}
 */
export function parsePermissionModeArg(arg) {
  const a = String(arg == null ? "" : arg)
    .trim()
    .toLowerCase();
  if (AUTO_ALIASES.has(a))
    return { tier: "trusted", auto: true, dontAsk: false };
  if (DONT_ASK_ALIASES.has(a)) {
    return { tier: "strict", auto: false, dontAsk: true };
  }
  const tier = parsePermissionTier(a);
  return tier ? { tier, auto: false, dontAsk: false } : null;
}

/**
 * Inverse of the tier mapping: turn a live REPL session tier back into a
 * subagent-contract permission MODE, so a spawned sub-agent inherits/tightens
 * from the interactive session's CURRENT approval tier (its run-mode ceiling).
 * Lossy on the restrictive end (strict ← default/manual/plan) — "default" is the
 * safe representative and resolves identically for a child — but the PERMISSIVE
 * end (autopilot → bypassPermissions) is exact, which is what lets a bypass
 * session hand its children the allow confirmer. `auto`/`dontAsk` carry through.
 *
 * @param {string} tier  strict | trusted | autopilot | auto | dontAsk
 * @returns {"default"|"acceptEdits"|"bypassPermissions"|"auto"|"dontAsk"}
 */
export function permissionModeForTier(tier) {
  switch (tier) {
    case "autopilot":
      return "bypassPermissions";
    case "trusted":
      return "acceptEdits";
    case "auto":
      return "auto";
    case "dontAsk":
      return "dontAsk";
    case "strict":
    default:
      return "default";
  }
}

/** One-line description of what a tier auto-approves. */
export function describeTier(tier) {
  switch (tier) {
    case "autopilot":
      return "everything auto-approved (no prompts)";
    case "trusted":
      return "low/medium-risk auto-approved; high-risk still asks";
    case "strict":
      return "every risky action asks";
    case "auto":
      return "autoMode.decisions classifier (riskLevel → allow/ask/deny); unconfigured = trusted";
    case "dontAsk":
      return "anything that would ask is denied instead (no prompts)";
    default:
      return "";
  }
}
