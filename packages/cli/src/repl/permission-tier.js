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

/** One-line description of what a tier auto-approves. */
export function describeTier(tier) {
  switch (tier) {
    case "autopilot":
      return "everything auto-approved (no prompts)";
    case "trusted":
      return "low/medium-risk auto-approved; high-risk still asks";
    case "strict":
      return "every risky action asks";
    default:
      return "";
  }
}
