/**
 * Pure helpers for the "App Preview" feature (Claude-Code desktop preview-pane
 * parity): pick the project's dev-server script and recognize the URL it prints
 * when it comes up. No `vscode`, no spawning — just string/JSON logic — so it is
 * fully unit-testable. The extension command (preview.js) spawns the chosen
 * script, scans its output through detectServerUrl, then opens VS Code's Simple
 * Browser at the URL; the dev server's own HMR handles live reload on edits.
 *
 * This is slice 1 of the feature: the detection core behind the preview pane.
 */

// Conventional dev-script names, most-specific first.
const DEV_SCRIPT_PRIORITY = [
  "dev",
  "start",
  "serve",
  "develop",
  "dev:web",
  "preview",
];

// Commands that ARE a dev server even under an unconventional script name.
const DEV_TOOL_RE =
  /\b(vite|next(\s+dev)?|nuxt|react-scripts|vue-cli-service|webpack(-dev-server|\s+serve)?|ng\s+serve|astro|remix|gatsby|parcel|snowpack|svelte-kit|vitepress|vuepress|docusaurus|http-server|\bserve\b|ember\s+serve|quasar\s+dev|umi\s+dev|rsbuild)\b/;

// Build commands we should NOT auto-pick as a preview server.
const NOT_DEV_RE = /\b(build|test|lint|format|typecheck|tsc|clean|prepare)\b/;

/**
 * Choose the best dev-server script from a parsed package.json.
 * @returns {{script:string, command:string}|null}
 */
function pickDevScript(pkg) {
  const scripts = (pkg && pkg.scripts) || {};
  if (!scripts || typeof scripts !== "object") return null;
  // 1) by conventional name (skip ones that are clearly a build/test).
  for (const name of DEV_SCRIPT_PRIORITY) {
    const cmd = scripts[name];
    if (typeof cmd === "string" && cmd.trim() && !NOT_DEV_RE.test(name)) {
      return { script: name, command: cmd };
    }
  }
  // 2) by a recognized dev tool inside the command.
  for (const [name, cmd] of Object.entries(scripts)) {
    if (
      typeof cmd === "string" &&
      DEV_TOOL_RE.test(cmd) &&
      !NOT_DEV_RE.test(name)
    ) {
      return { script: name, command: cmd };
    }
  }
  return null;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const LOCAL_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s'"`]*)?/i;

/**
 * Extract the first browsable localhost dev-server URL from a line of output,
 * or null. Handles Vite/Next/CRA/webpack/etc. banners; strips ANSI colors and
 * trailing punctuation; rewrites 0.0.0.0 → localhost (not browsable as-is).
 */
function detectServerUrl(line) {
  if (typeof line !== "string") return null;
  const clean = line.replace(ANSI_RE, "");
  const m = clean.match(LOCAL_URL_RE);
  if (!m) return null;
  let url = m[0].replace(/[)\].,;:'"`]+$/, "");
  url = url.replace("://0.0.0.0", "://localhost");
  return url;
}

/**
 * Scan accumulated dev-server output and return the first detected URL, or null.
 * (Convenience for callers buffering chunks across reads.)
 */
function detectServerUrlInText(text) {
  if (typeof text !== "string") return null;
  for (const line of text.split(/\r?\n/)) {
    const url = detectServerUrl(line);
    if (url) return url;
  }
  return null;
}

module.exports = {
  pickDevScript,
  detectServerUrl,
  detectServerUrlInText,
  DEV_SCRIPT_PRIORITY,
};
