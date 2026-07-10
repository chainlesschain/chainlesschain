/**
 * `cc agent --ax-screen-reader` — screen-reader friendly output.
 *
 * Screen readers linearize the terminal: colors are invisible, and anything
 * that repaints in place (the context status line) reads as noisy duplicate
 * lines. This mode therefore:
 *   - forces the `mono` theme (chalk level 0 — no ANSI color codes) in the
 *     interactive REPL (consumed via CC_SCREEN_READER in agent-repl.js);
 *   - disables the repainting status line (reuses the existing
 *     CC_STATUSLINE=0 kill-switch).
 * Headless (-p) text output is already plain sequential lines.
 *
 * Ambient activation: CC_SCREEN_READER=1 (so wrappers/launchers can turn it
 * on without threading a flag through every entry point).
 */

/** env switches applied by --ax-screen-reader. */
export const SCREEN_READER_SWITCHES = Object.freeze({
  CC_SCREEN_READER: "1", // REPL: force mono theme / no ANSI decorations
  CC_STATUSLINE: "0", // in-place repainting status line off
});

/**
 * Apply screen-reader mode to an env (default process.env).
 * @returns {string[]} the switch names applied (for the startup notice)
 */
export function applyScreenReaderMode(env = process.env) {
  for (const [k, v] of Object.entries(SCREEN_READER_SWITCHES)) {
    env[k] = v;
  }
  return Object.keys(SCREEN_READER_SWITCHES);
}

/**
 * Whether screen-reader mode is requested — the explicit `--ax-screen-reader`
 * flag or the ambient CC_SCREEN_READER env var (1 / true / yes / on).
 * @param {{ axScreenReader?: boolean }} [opts]
 * @param {object} [env=process.env]
 * @returns {boolean}
 */
export function screenReaderRequested(opts = {}, env = process.env) {
  if (opts && opts.axScreenReader === true) return true;
  return screenReaderActive(env);
}

/**
 * Whether screen-reader mode is ACTIVE in the environment (what downstream
 * consumers — the REPL theme init — should check).
 * @param {object} [env=process.env]
 * @returns {boolean}
 */
export function screenReaderActive(env = process.env) {
  const raw = env.CC_SCREEN_READER;
  return raw != null && /^(1|true|yes|on)$/i.test(String(raw).trim());
}
