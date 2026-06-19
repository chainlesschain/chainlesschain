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
