/**
 * REPL `/theme` — color theme selection for the agent REPL (Claude-Code
 * `/theme` parity). cc's REPL paints with chalk directly rather than a
 * full-screen TUI, so a theme controls two observable things:
 *   (a) whether color is emitted at all — `mono` strips ALL color by dropping
 *       chalk's level to 0 (useful on terminals where the palette is unreadable
 *       or when capturing plain output);
 *   (b) the accent color of the prompt — `light` uses blue (green is hard to
 *       read on light backgrounds), `dark`/`auto` use green.
 *
 * Pure helpers (theme table, resolver, renderer, accent lookup) + a thin chalk
 * applier that mutates the injected chalk instance's level. Persistence is the
 * caller's job (config `cli.theme`).
 */

export const THEMES = Object.freeze({
  auto: {
    color: true,
    prompt: "green",
    desc: "terminal-detected color, green prompt (default)",
  },
  dark: { color: true, prompt: "green", desc: "for dark terminals" },
  light: {
    color: true,
    prompt: "blue",
    desc: "for light terminals (blue prompt accent)",
  },
  mono: { color: false, prompt: "none", desc: "no color — plain text" },
});

export const DEFAULT_THEME = "auto";

/** Available theme names, in display order. Pure. */
export function listThemeNames() {
  return Object.keys(THEMES);
}

/** Normalize/validate a theme name; returns the canonical name or null. Pure. */
export function resolveTheme(name) {
  const n = String(name || "")
    .toLowerCase()
    .trim();
  return Object.prototype.hasOwnProperty.call(THEMES, n) ? n : null;
}

/** The prompt accent style for a theme: "green" | "blue" | "none". Pure. */
export function promptAccent(themeName) {
  const t = THEMES[themeName] || THEMES[DEFAULT_THEME];
  return t.prompt;
}

/**
 * Apply a theme's color level to a chalk instance (side effect on `chalk`).
 * `baseline` is chalk's auto-detected level captured before any theme was
 * applied, so switching back to a colored theme restores real color depth.
 * @returns {number} the resulting chalk level
 */
export function applyThemeChalk(themeName, chalk, baseline) {
  const t = THEMES[themeName] || THEMES[DEFAULT_THEME];
  if (!t.color) {
    chalk.level = 0;
  } else if (baseline != null) {
    chalk.level = baseline;
  }
  return chalk.level;
}

/** Render the theme list with the active one marked. Pure. */
export function renderThemeList(active) {
  const lines = ["Themes:"];
  for (const [name, t] of Object.entries(THEMES)) {
    const mark = name === active ? "*" : " ";
    lines.push(`  ${mark} ${name.padEnd(6)} ${t.desc}`);
  }
  lines.push("Usage: /theme <auto|dark|light|mono>");
  return lines.join("\n");
}
