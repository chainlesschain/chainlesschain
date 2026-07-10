/**
 * `cc agent --safe-mode` — Claude-Code 2.1.169 parity ("--safe-mode flag
 * AND CLAUDE_CODE_SAFE_MODE env var disable customizations"): one flag (or an
 * ambient env var) flips every customization kill-switch so a misbehaving
 * hook / memory file / persona can be isolated by running the agent bare.
 *
 * Deliberate divergence from Claude Code: settings PERMISSION RULES stay
 * active — deny rules are a safety surface, and "debug my customizations"
 * must never widen what the agent may do.
 */

/** env switches applied by --safe-mode (all existing kill-switches). */
export const SAFE_MODE_SWITCHES = Object.freeze({
  CC_PROJECT_MEMORY: "0", // cc.md / CLAUDE.md / rules auto-load
  CC_SETTINGS_HOOKS: "0", // .claude/settings.json hooks
  CC_MEMORY_INJECT: "0", // session-core startup memory recall
  CC_IDE_CONTEXT: "0", // <ide-context> injection + diagnostics feedback
  CC_STATUSLINE: "0", // custom/built-in status line
  CC_UPDATE_NOTICE: "0", // passive update nudge
});

/**
 * Apply safe mode to an env (default process.env).
 * @returns {string[]} the switch names applied (for the startup notice)
 */
export function applySafeMode(env = process.env) {
  for (const [k, v] of Object.entries(SAFE_MODE_SWITCHES)) {
    env[k] = v;
  }
  return Object.keys(SAFE_MODE_SWITCHES);
}

/**
 * Whether safe mode is requested — via the explicit `--safe-mode` flag OR an
 * ambient env var: `CC_SAFE_MODE` (native) or `CLAUDE_CODE_SAFE_MODE`
 * (Claude-Code 2.1.169 portability). Truthy env values: 1 / true / yes / on.
 * @param {{ safeMode?: boolean }} [opts]
 * @param {object} [env=process.env]
 * @returns {boolean}
 */
export function safeModeRequested(opts = {}, env = process.env) {
  if (opts && opts.safeMode === true) return true;
  const raw = env.CC_SAFE_MODE || env.CLAUDE_CODE_SAFE_MODE;
  return raw != null && /^(1|true|yes|on)$/i.test(String(raw).trim());
}

/**
 * `cc agent --bare` — everything --safe-mode disables PLUS skills, plugins and
 * MCP auto-connect: a minimal, fast agent surface for scripted invocations.
 * The two extra env switches are consumed at the single chokepoints all
 * loading funnels through (skill-loader `loadAll`, plugin-runtime
 * `discoverPlugins`); MCP/IDE/PDH/JetBrains auto-connect are flipped off on
 * the parsed options by the agent command itself (an explicit --mcp-config
 * still loads — bare kills ambient auto-connects, not explicit input).
 * Permission rules stay active, same as safe mode.
 */
export const BARE_MODE_EXTRA_SWITCHES = Object.freeze({
  CC_SKILLS: "0", // every skill layer (list_skills/run_skill surface empties)
  CC_PLUGINS: "0", // plugin runtime (hooks/monitors/MCP/LSP/bin/env/skills/agents)
});

/**
 * Apply bare mode to an env: all safe-mode switches + the bare extras.
 * @returns {string[]} the switch names applied (for the startup notice)
 */
export function applyBareMode(env = process.env) {
  const applied = applySafeMode(env);
  for (const [k, v] of Object.entries(BARE_MODE_EXTRA_SWITCHES)) {
    env[k] = v;
  }
  return [...applied, ...Object.keys(BARE_MODE_EXTRA_SWITCHES)];
}

/**
 * Whether bare mode is requested — the explicit `--bare` flag or the ambient
 * `CC_BARE` env var (truthy values: 1 / true / yes / on).
 * @param {{ bare?: boolean }} [opts]
 * @param {object} [env=process.env]
 * @returns {boolean}
 */
export function bareModeRequested(opts = {}, env = process.env) {
  if (opts && opts.bare === true) return true;
  const raw = env.CC_BARE;
  return raw != null && /^(1|true|yes|on)$/i.test(String(raw).trim());
}
