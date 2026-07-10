/**
 * Auto-exec config guard (P2 #13) — pure classification of workspace files that
 * can lead to CODE EXECUTION without an explicit "run" action, so the IDE can
 * warn once before the agent (which may trigger them via tasks / hooks / MCP /
 * run configs) starts working in a freshly-opened, untrusted workspace.
 *
 * This is the IDE-layer complement to the cc agent's own per-write permission
 * gates: the agent confirms before WRITING these files; this warns the human
 * that the OPEN workspace already CONTAINS them.
 *
 * Pure + host-free so it unit-tests without vscode. Matching is path-separator-
 * and case-insensitive (Windows-safe) and works on workspace-RELATIVE paths.
 */

// category → human label + severity (higher = louder). Kept small + explicit;
// an unknown path is simply not risky (null), never a false positive.
const CATEGORIES = {
  "mcp-config": { label: "MCP server config (can spawn processes)", severity: 5 },
  "git-hook": { label: "Git / husky hook (runs on git actions)", severity: 5 },
  "shell-profile": { label: "Shell profile (runs on new shells)", severity: 5 },
  "vscode-tasks": { label: "VS Code task (can auto-run on folder open)", severity: 4 },
  "jetbrains-run-config": { label: "JetBrains run configuration", severity: 4 },
  "vscode-launch": { label: "VS Code launch/debug config", severity: 3 },
  "vscode-settings": { label: "VS Code workspace settings", severity: 2 },
  "jetbrains-project": { label: "JetBrains project config (.idea)", severity: 2 },
};

/** Normalize to lower-case, forward-slash, no leading `./` or `/`. */
function norm(relPath) {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\/+/, "")
    .toLowerCase();
}

/**
 * Classify a workspace-relative path. Returns `{ category, label, severity }`
 * for an auto-exec-risky config file, or null for anything ordinary.
 */
function classifyAutoExecTarget(relPath) {
  const p = norm(relPath);
  if (!p) return null;
  const base = p.slice(p.lastIndexOf("/") + 1);

  let category = null;
  // MCP configs (agent auto-loads these → can spawn arbitrary servers).
  if (base === "mcp.json" || base === ".mcp.json") category = "mcp-config";
  else if (p.endsWith("/mcp.json") && (p.startsWith(".vscode/") || p.startsWith(".cursor/")))
    category = "mcp-config";
  // Git / husky hooks.
  else if (p.startsWith(".git/hooks/") || p.startsWith(".husky/")) {
    // .git/hooks/*.sample are inert templates git ships — not risky.
    if (!base.endsWith(".sample") && base !== "_" && base) category = "git-hook";
  }
  // Shell profiles (POSIX + PowerShell).
  else if (
    [
      ".bashrc",
      ".bash_profile",
      ".zshrc",
      ".zprofile",
      ".profile",
      ".kshrc",
      ".cshrc",
    ].includes(base) ||
    /microsoft\.powershell_profile\.ps1$/.test(base) ||
    base === "profile.ps1"
  )
    category = "shell-profile";
  // VS Code workspace configs.
  else if (p === ".vscode/tasks.json") category = "vscode-tasks";
  else if (p === ".vscode/launch.json") category = "vscode-launch";
  else if (p === ".vscode/settings.json") category = "vscode-settings";
  // JetBrains project configs.
  else if (p.startsWith(".idea/runconfigurations/")) category = "jetbrains-run-config";
  else if (p.startsWith(".idea/")) category = "jetbrains-project";

  if (!category) return null;
  const meta = CATEGORIES[category];
  return { category, label: meta.label, severity: meta.severity };
}

/**
 * Classify a list of workspace-relative paths into deduped findings, sorted by
 * severity (loudest first) then path. Input is whatever cheap listing the host
 * can produce (a shallow scan of the workspace root is enough for the common
 * cases; hooks live one level deep).
 */
function scanAutoExecConfig(relPaths) {
  const seen = new Set();
  const out = [];
  for (const rp of relPaths || []) {
    const hit = classifyAutoExecTarget(rp);
    if (!hit) continue;
    const key = norm(rp);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: norm(rp), ...hit });
  }
  out.sort((a, b) => b.severity - a.severity || a.path.localeCompare(b.path));
  return out;
}

/** One-line human summary for a confirmation prompt (empty string when none). */
function summarizeAutoExecScan(findings) {
  if (!findings || !findings.length) return "";
  const top = findings.slice(0, 6).map((f) => `• ${f.path} — ${f.label}`);
  const more =
    findings.length > top.length ? `\n…and ${findings.length - top.length} more` : "";
  return (
    `This workspace contains ${findings.length} auto-executable config file(s). ` +
    `The agent may trigger these while it works:\n` +
    top.join("\n") +
    more
  );
}

module.exports = {
  classifyAutoExecTarget,
  scanAutoExecConfig,
  summarizeAutoExecScan,
  AUTO_EXEC_CATEGORIES: CATEGORIES,
};
