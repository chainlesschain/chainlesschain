/**
 * Computer-use authorization (gap-2026-07-11 P1#6) — the trust core shared by
 * the computer-use MCP server. GUI control is the highest-privilege surface an
 * agent can hold (it can click "OK" on anything), so it is:
 *   - OFF unless explicitly enabled (`cc mcp computer-use` / --enable);
 *   - capability-gated: each verb (screenshot/click/type/scroll/clipboard/
 *     app-launch/window-list) can be individually withheld;
 *   - per-app scoped: an allowlist confines control to named apps, and a
 *     high-risk denylist (terminals, IDEs, file managers, system settings,
 *     password managers) always requires confirmation even when allowed.
 *
 * Pure + dependency-free so it is exhaustively unit-tested; the server and the
 * OS backend consume its verdicts.
 */

export const COMPUTER_USE_CAPABILITIES = [
  "screenshot",
  "window_list",
  "app_launch",
  "click",
  "type",
  "scroll",
  "clipboard_read",
  "clipboard_write",
];

// Read-only observation is lower risk than input injection; the tool-priority
// guidance (MCP/API > shell > browser action > computer use) lives here so the
// server can surface it and the model prefers cheaper, auditable paths.
export const TOOL_PRIORITY = [
  "mcp/api",
  "shell",
  "browser action",
  "computer use",
];

// Apps where an unattended click/type is disproportionately dangerous — a
// terminal runs commands, a password manager reveals secrets, system settings
// change the machine. Matched case-insensitively as a substring of the app /
// window identifier. Confirmation is forced even inside the allowlist.
export const HIGH_RISK_APP_PATTERNS = [
  "terminal",
  "powershell",
  "cmd.exe",
  "conhost",
  "windows terminal",
  "iterm",
  "code", // VS Code / VSCodium
  "jetbrains",
  "intellij",
  "explorer.exe",
  "finder",
  "nautilus",
  "settings",
  "control panel",
  "regedit",
  "keychain",
  "1password",
  "bitwarden",
  "lastpass",
  "keepass",
];

/**
 * @param {object} config computer-use config subtree
 *   { enabled, capabilities?: string[], appAllowlist?: string[],
 *     highRiskPatterns?: string[], confirmAll?: boolean }
 */
export function createAuthorizer(config = {}) {
  const enabled = config.enabled === true;
  const caps = new Set(
    Array.isArray(config.capabilities) && config.capabilities.length > 0
      ? config.capabilities
      : COMPUTER_USE_CAPABILITIES,
  );
  const allowlist = Array.isArray(config.appAllowlist)
    ? config.appAllowlist.map((a) => String(a).toLowerCase())
    : null; // null = no app restriction (any app), [] = deny every app
  const highRisk = (
    Array.isArray(config.highRiskPatterns)
      ? config.highRiskPatterns
      : HIGH_RISK_APP_PATTERNS
  ).map((p) => String(p).toLowerCase());
  const confirmAll = config.confirmAll === true;

  const INPUT_VERBS = new Set([
    "click",
    "type",
    "scroll",
    "app_launch",
    "clipboard_write",
  ]);

  function isHighRiskApp(app) {
    const a = String(app || "").toLowerCase();
    if (!a) return false;
    return highRisk.some((p) => a.includes(p));
  }

  /**
   * @returns {{ allowed:boolean, requiresConfirmation:boolean, reason?:string }}
   */
  function authorize(capability, context = {}) {
    if (!enabled) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason:
          "computer-use is disabled — enable it explicitly (cc mcp computer-use --enable)",
      };
    }
    if (!COMPUTER_USE_CAPABILITIES.includes(capability)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `unknown capability: ${capability}`,
      };
    }
    if (!caps.has(capability)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `capability "${capability}" is not enabled for this session`,
      };
    }

    const app = context.app || context.window || null;

    // App allowlist applies to app-targeted verbs (input + launch). Pure
    // observation (screenshot / window_list / clipboard_read) is not app-scoped.
    if (allowlist && (INPUT_VERBS.has(capability) || app)) {
      const target = String(app || context.target || "").toLowerCase();
      if (!target) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: `capability "${capability}" needs a target app while an allowlist is configured`,
        };
      }
      const ok = allowlist.some(
        (a) => target.includes(a) || a.includes(target),
      );
      if (!ok) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: `app "${app || context.target}" is not in the computer-use allowlist`,
        };
      }
    }

    // High-risk apps and input verbs (or confirmAll) require confirmation.
    const highRiskApp = isHighRiskApp(app);
    const requiresConfirmation =
      confirmAll || highRiskApp || INPUT_VERBS.has(capability);
    return {
      allowed: true,
      requiresConfirmation,
      reason: highRiskApp
        ? `high-risk app (${app}) — confirmation required`
        : requiresConfirmation
          ? `${capability} injects input — confirmation required`
          : undefined,
    };
  }

  return {
    enabled,
    capabilities: [...caps],
    authorize,
    isHighRiskApp,
  };
}
