/**
 * Sensitive-file write guard — Claude-Code 2.1.160 parity ("prompts before
 * writing to shell startup files").
 *
 * Writing a shell startup file, PowerShell profile, or git hook plants code
 * that EXECUTES on the user's next shell/commit — a step up from a normal
 * edit, so even pre-authorized edit flows must confirm first. The check is
 * name-based (basename / well-known relative fragments), deliberately
 * conservative: build configs like Makefile/package.json are everyday edits
 * and are NOT flagged (false-positive fatigue would teach users to blind-OK).
 */

const SHELL_STARTUP_NAMES = new Set([
  ".bashrc",
  ".bash_profile",
  ".bash_login",
  ".bash_logout",
  ".bash_aliases", // auto-sourced by the default .bashrc on Debian/Ubuntu
  ".profile",
  ".zshrc",
  ".zshenv",
  ".zprofile",
  ".zlogin",
  ".zlogout",
  ".cshrc",
  ".tcshrc",
  ".kshrc",
]);

// PowerShell profiles are per-host: Microsoft.PowerShell_profile.ps1 (console),
// Microsoft.VSCode_profile.ps1, Microsoft.PowerShellISE_profile.ps1, … plus the
// all-hosts profile.ps1. `microsoft.<host>_profile.ps1` covers them all.
const POWERSHELL_PROFILE_RE =
  /(^|[\\/])(microsoft\.\w+_profile\.ps1|profile\.ps1)$/i;
// fish: config.fish AND auto-sourced conf.d/*.fish snippets.
const FISH_CONFIG_RE =
  /[\\/]fish[\\/](config\.fish|conf\.d[\\/][^\\/]+\.fish)$/i;
const GIT_HOOK_RE = /[\\/]\.git[\\/]hooks[\\/][^\\/]+$/i;
const HUSKY_HOOK_RE = /[\\/]\.husky[\\/](?!_)[^\\/]+$/i;

/**
 * @param {string} targetPath  path as the tool received it (rel or abs)
 * @returns {string|null} human reason when sensitive, null otherwise
 */
export function sensitiveFileReason(targetPath) {
  const p = String(targetPath || "");
  if (!p) return null;
  const base = p.replace(/\\/g, "/").split("/").pop() || "";
  if (SHELL_STARTUP_NAMES.has(base)) {
    return `shell startup file (${base}) — runs on the user's next shell`;
  }
  if (base === ".envrc") {
    return "direnv .envrc — executes when the user enters this directory";
  }
  if (POWERSHELL_PROFILE_RE.test(p)) {
    return "PowerShell profile — runs on the user's next PowerShell session";
  }
  if (FISH_CONFIG_RE.test(p)) {
    return "fish shell config — runs on the user's next shell";
  }
  if (GIT_HOOK_RE.test(p)) {
    return "git hook — executes on the user's next git operation";
  }
  if (HUSKY_HOOK_RE.test(p)) {
    return "husky hook — executes on the user's next git operation";
  }
  return null;
}

/**
 * Auto-exec CONFIG write guard — the CLI-side twin of the IDE extension's
 * `classifyAutoExecTarget` (vscode-extension/src/auto-exec-guard.js, kept as
 * an independent pure function: no cross-package import). These files are not
 * shells or hooks, but writing them still plants code that RUNS without an
 * explicit user action: VS Code tasks auto-run on folder open, launch configs
 * fire on debug, `.mcp.json` spawns arbitrary server processes the agent then
 * auto-loads, JetBrains run configurations execute on the next Run, and
 * devcontainer postCreate/postStart commands run on container open. Same
 * conservative name-based posture as `sensitiveFileReason`; an unknown path is
 * simply not risky (null), never a false positive.
 *
 * @param {string} targetPath  path as the tool received it (rel or abs)
 * @returns {string|null} human reason when auto-exec-risky, null otherwise
 */
export function autoExecConfigReason(targetPath) {
  const p = String(targetPath || "");
  if (!p) return null;
  const norm = p.replace(/\\/g, "/").toLowerCase();
  const base = norm.split("/").pop() || "";
  if (!base) return null;
  if (base === ".mcp.json" || base === "mcp.json") {
    return `auto-exec config: MCP server config (${base}) — can spawn arbitrary server processes the agent auto-loads`;
  }
  if (/(^|\/)\.vscode\/tasks\.json$/.test(norm)) {
    return "auto-exec config: VS Code tasks (.vscode/tasks.json) — tasks can auto-run on folder open";
  }
  if (/(^|\/)\.vscode\/launch\.json$/.test(norm)) {
    return "auto-exec config: VS Code launch/debug config (.vscode/launch.json) — runs commands on the next debug session";
  }
  if (/(^|\/)\.vscode\/settings\.json$/.test(norm)) {
    return "auto-exec config: VS Code workspace settings (.vscode/settings.json) — can rebind shells/tools the user then runs";
  }
  if (/(^|\/)\.idea\/runconfigurations\//.test(norm)) {
    return `auto-exec config: JetBrains run configuration (${base}) — executes on the user's next Run action`;
  }
  if (/(^|\/)\.idea\/workspace\.xml$/.test(norm)) {
    return "auto-exec config: JetBrains workspace.xml — can embed run/startup tasks";
  }
  if (
    base === "devcontainer.json" ||
    /(^|\/)\.devcontainer\/devcontainer\.json$/.test(norm)
  ) {
    return "auto-exec config: devcontainer.json — postCreate/postStart commands run on container open";
  }
  if (base.endsWith(".code-workspace")) {
    return `auto-exec config: VS Code workspace file (${base}) — can carry auto-run tasks and settings`;
  }
  return null;
}
