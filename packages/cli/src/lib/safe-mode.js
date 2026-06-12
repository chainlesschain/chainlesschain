/**
 * `cc agent --safe-mode` — Claude-Code 2.1.169 parity ("--safe-mode flag
 * disables customizations"): one flag flips every customization kill-switch
 * so a misbehaving hook / memory file / persona can be isolated by running
 * the agent bare.
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
