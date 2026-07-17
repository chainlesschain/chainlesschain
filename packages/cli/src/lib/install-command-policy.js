/**
 * install-command-policy — a UNIFIED classifier + audit for package-install
 * shell commands across managers (npm / pnpm / yarn / bun / pip / pipx / poetry /
 * conda / brew / winget / choco / apt / dnf / yum / apk / snap / gem / cargo /
 * go / composer / dotnet).
 *
 * The gap (docs/…INCREMENTAL_GAP_ANALYSIS P0 "跨平台沙箱"): "npm、pip、winget、brew
 * 等安装入口需要统一权限类型与审计事件". Today a `run_shell` install command is just
 * another shell command — there is no single place that recognizes "this fetches
 * and runs third-party code" regardless of which tool does it, and no unified
 * audit trail. This module supplies both, as PURE detection (no I/O) plus a
 * best-effort injected-IO audit sink, so it can be reused by the shell approval
 * path today and other entry points (run_code, hooks) later.
 *
 * Design: a per-manager table maps a binary to its install subcommand(s), a
 * global-scope signal, and package extraction. `classifyInstallCommand` splits a
 * compound command into segments (reusing the shell-policy splitter) so
 * `npm i foo && pip install bar` reports BOTH installs. Nothing here changes a
 * permission decision — callers decide whether to raise a risk floor; the
 * classification is advisory + auditable.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import shellPolicy from "../runtime/coding-agent-shell-policy.cjs";

const { splitCommandSegments, tokenizeShellCommand } = shellPolicy;

// Leading tokens that wrap the real command and must be stripped before the
// binary is read: privilege elevation, env-var assignments, and `env`/`command`.
const WRAPPER_TOKENS = new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "exec",
  "nice",
]);

/**
 * Per-manager install detection. `sub` = subcommand keywords that mean "install".
 * `system` = the install always affects the whole machine/user (no project
 * scope), so it is treated as global regardless of flags. `globalFlags`/
 * `globalWords` mark a per-tool global install. `packageWord` (dotnet) requires a
 * keyword before the package name.
 */
const MANAGERS = [
  {
    name: "npm",
    bin: /^npm$/,
    sub: ["install", "i", "add", "ci"],
    globalFlags: ["-g", "--global"],
  },
  {
    name: "pnpm",
    bin: /^pnpm$/,
    sub: ["install", "i", "add"],
    globalFlags: ["-g", "--global"],
  },
  {
    name: "yarn",
    bin: /^yarn$/,
    sub: ["add", "install"],
    globalWords: ["global"],
  },
  {
    name: "bun",
    bin: /^bun$/,
    sub: ["install", "i", "add"],
    globalFlags: ["-g", "--global"],
  },
  { name: "pip", bin: /^pip[0-9.]*$/, sub: ["install"], globalFlags: [] },
  { name: "pipx", bin: /^pipx$/, sub: ["install"], system: true },
  { name: "poetry", bin: /^poetry$/, sub: ["add"], globalFlags: [] },
  { name: "conda", bin: /^conda$/, sub: ["install"], globalFlags: [] },
  { name: "brew", bin: /^brew$/, sub: ["install"], system: true },
  { name: "winget", bin: /^winget$/, sub: ["install"], system: true },
  { name: "choco", bin: /^choco(latey)?$/, sub: ["install"], system: true },
  { name: "apt", bin: /^apt(-get)?$/, sub: ["install"], system: true },
  { name: "dnf", bin: /^(dnf|yum)$/, sub: ["install"], system: true },
  { name: "apk", bin: /^apk$/, sub: ["add"], system: true },
  { name: "snap", bin: /^snap$/, sub: ["install"], system: true },
  { name: "gem", bin: /^gem$/, sub: ["install"], system: true },
  { name: "cargo", bin: /^cargo$/, sub: ["install"], system: true },
  { name: "go", bin: /^go$/, sub: ["install", "get"], system: true },
  {
    name: "composer",
    bin: /^composer$/,
    sub: ["require", "install"],
    globalWords: ["global"],
  },
  {
    name: "dotnet",
    bin: /^dotnet$/,
    sub: ["add"],
    packageWord: "package",
    system: false,
  },
];

/** Basename of a binary path, minus a Windows .exe/.cmd/.bat/.ps1 suffix. */
function normalizeBin(token) {
  const base = String(token || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

/** Strip leading wrapper tokens (sudo/env/VAR=val) → the real argv, or null. */
function unwrapArgv(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (WRAPPER_TOKENS.has(t) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i += 1;
      continue;
    }
    break;
  }
  return tokens.slice(i);
}

/**
 * Classify ONE already-split command segment. Returns an install descriptor or
 * null. Pure.
 * @returns {{manager:string, subcommand:string, packages:string[], global:boolean}|null}
 */
export function classifyInstallSegment(segment) {
  let argv = unwrapArgv(tokenizeShellCommand(segment));
  if (argv.length === 0) return null;
  // Module invocation: `python -m pip install …` (and `py -m pip …`) is the
  // canonical way run_code's auto-install — and plenty of humans — invoke pip;
  // treat the module as the binary so it classifies like a direct `pip`.
  if (
    /^(python[0-9.]*|py)$/.test(normalizeBin(argv[0])) &&
    argv[1] === "-m" &&
    argv.length > 2
  ) {
    argv = argv.slice(2);
  }
  const bin = normalizeBin(argv[0]);
  const mgr = MANAGERS.find((m) => m.bin.test(bin));
  if (!mgr) return null;

  const rest = argv.slice(1);
  // Find the install subcommand token (first non-flag token that matches). For
  // dotnet, the trigger is `add … package`, so also require the package word.
  let subIdx = -1;
  let subcommand = null;
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (mgr.sub.includes(tok)) {
      subIdx = i;
      subcommand = tok;
      break;
    }
  }
  if (subIdx === -1) return null;
  if (mgr.packageWord && !rest.slice(subIdx + 1).includes(mgr.packageWord)) {
    return null; // e.g. `dotnet add reference` is not a package install
  }

  // Everything after the subcommand (and, for dotnet, after `package`) that is
  // not a flag = the requested packages (best-effort; enough for audit).
  let argsAfter = rest.slice(subIdx + 1);
  if (mgr.packageWord) {
    const pw = argsAfter.indexOf(mgr.packageWord);
    argsAfter = pw >= 0 ? argsAfter.slice(pw + 1) : argsAfter;
  }
  const packages = argsAfter.filter((t) => !t.startsWith("-"));

  const global =
    mgr.system === true ||
    (mgr.globalFlags || []).some((f) => rest.includes(f)) ||
    (mgr.globalWords || []).some((w) => rest.includes(w));

  return { manager: mgr.name, subcommand, packages, global };
}

/**
 * Classify a full (possibly compound) shell command. Splits on `&&`/`||`/`;`/`|`
 * so `npm i a && pip install b` reports BOTH. Returns `{ isInstall, installs }`.
 * Pure.
 */
export function classifyInstallCommand(command) {
  const segments = splitCommandSegments(String(command || ""));
  const installs = [];
  for (const seg of segments) {
    const hit = classifyInstallSegment(seg);
    if (hit) installs.push(hit);
  }
  return { isInstall: installs.length > 0, installs };
}

/** True if any classified install is global/system-scoped (higher blast radius). */
export function hasGlobalInstall(classification) {
  return !!(
    classification &&
    Array.isArray(classification.installs) &&
    classification.installs.some((i) => i.global)
  );
}

// ── remote-script execution ("curl … | sh") ────────────────────────────────
// The most dangerous "fetch and run third-party code" vector isn't a package
// manager at all — it's piping a download straight into a shell, or running a
// shell over a command/process substitution that downloads. It runs UNPINNED,
// UNVERIFIED, attacker-mutable code with the agent's privileges. These patterns
// must be recognized on the RAW command (the pipe/substitution structure is lost
// once split into segments), so they use anchored regexes rather than the
// per-segment classifier.
const REMOTE_FETCHERS = "curl|wget|fetch|iwr|invoke-webrequest|http|httpie";
const SHELL_INTERPRETERS =
  "sh|bash|zsh|ksh|dash|fish|python[0-9.]*|ruby|perl|node|deno|pwsh|powershell|eval|source";

// `curl URL | sh`, `wget -O- URL | sudo bash`, `curl URL | tee f | sh`. After
// the pipe, skip inline wrappers (`sudo `/`env `, space-separated) AND piped
// pass-throughs (`tee f |`, `cat |`) before the interpreter.
const PIPE_TO_SHELL_RE = new RegExp(
  `\\b(${REMOTE_FETCHERS})\\b[^|]*\\|\\s*(?:(?:sudo|env|command|nice)\\s+|(?:tee|cat)\\b[^|]*\\|\\s*)*(${SHELL_INTERPRETERS})\\b`,
  "i",
);
// `bash -c "$(curl URL)"`, `sh <(curl URL)`, `eval "$(wget -O- URL)"`
const SUBST_TO_SHELL_RE = new RegExp(
  `\\b(${SHELL_INTERPRETERS})\\b[^\\n]*[$<]\\(\\s*(?:sudo\\s+)?(${REMOTE_FETCHERS})\\b`,
  "i",
);

function firstUrl(s) {
  const m = String(s).match(/\bhttps?:\/\/[^\s'"|)>]+/i);
  return m ? m[0] : null;
}

/**
 * Detect remote-script execution in a raw shell command: a network fetcher piped
 * into (or command/process-substituted into) a shell interpreter. Returns
 * `{ isRemoteExec, matches:[{pattern, fetcher, interpreter, url}] }`. Pure.
 */
export function classifyRemoteExecCommand(command) {
  const s = String(command || "");
  const matches = [];
  const pipe = PIPE_TO_SHELL_RE.exec(s);
  if (pipe) {
    matches.push({
      pattern: "pipe-to-shell",
      fetcher: pipe[1].toLowerCase(),
      interpreter: pipe[2].toLowerCase(),
      url: firstUrl(s),
    });
  }
  const subst = SUBST_TO_SHELL_RE.exec(s);
  if (subst) {
    matches.push({
      pattern: "cmdsubst-to-shell",
      interpreter: subst[1].toLowerCase(),
      fetcher: subst[2].toLowerCase(),
      url: firstUrl(s),
    });
  }
  return { isRemoteExec: matches.length > 0, matches };
}

/**
 * Combined "untrusted code acquisition" classification: package installs AND
 * remote-script execution. `flagged` is true if EITHER fires — the single signal
 * a caller gates/audits on. Pure.
 */
export function classifyCodeAcquisition(command) {
  const install = classifyInstallCommand(command);
  const remote = classifyRemoteExecCommand(command);
  return {
    flagged: install.isInstall || remote.isRemoteExec,
    isInstall: install.isInstall,
    installs: install.installs,
    isRemoteExec: remote.isRemoteExec,
    remoteExec: remote.matches,
  };
}

/**
 * Classify a PLUGIN install (`cc plugin add`/`upgrade`) into the unified
 * "downloading and running third-party code" trail. A plugin ships executable
 * components (bin/hooks/LSP/MCP servers run as processes), so installing one
 * is the plugin-runtime sibling of a global package install — same audit
 * file, same opt-in policy. Pure; returns null for a nameless input.
 */
export function classifyPluginInstall({
  name,
  version,
  scope,
  source,
  capabilities,
} = {}) {
  if (!name || typeof name !== "string") return null;
  return {
    manager: "cc-plugin",
    packages: [version ? `${name}@${version}` : name],
    // A user-scope plugin loads in EVERY repo the user runs cc in — the
    // plugin-runtime analogue of `npm install -g`. Project/local scopes stay
    // confined to one repository.
    global: scope === "user",
    ...(source ? { source: String(source) } : {}),
    ...(Array.isArray(capabilities) && capabilities.length
      ? { capabilities }
      : {}),
  };
}

/**
 * Resolve the install-command policy from env/settings (opt-in, so the default
 * shell path is byte-unchanged). `audit` enables the audit trail; `riskFloor`
 * ("low"|"medium"|"high") is the MINIMUM risk an install command is treated as
 * (never lowers an already-higher risk).
 */
export function resolveInstallPolicy({
  env = process.env,
  settings = null,
} = {}) {
  const s = (settings && settings.installPolicy) || {};
  const envAudit = env.CC_INSTALL_AUDIT;
  const audit =
    envAudit === "1" ? true : envAudit === "0" ? false : s.audit === true;
  const riskFloor =
    env.CC_INSTALL_RISK_FLOOR ||
    (typeof s.riskFloor === "string" ? s.riskFloor : null) ||
    null;
  return {
    audit,
    riskFloor: riskFloor ? String(riskFloor).toLowerCase() : null,
    enabled: audit || !!riskFloor,
  };
}

const RISK_RANK = { low: 0, medium: 1, high: 2 };

/**
 * Apply a risk floor: return whichever of `currentRisk` / `floor` is HIGHER
 * (never downgrades). Unknown values pass `currentRisk` through unchanged.
 */
export function applyRiskFloor(currentRisk, floor) {
  if (!floor || !(floor in RISK_RANK)) return currentRisk;
  const cur = RISK_RANK[currentRisk];
  if (cur == null) return currentRisk;
  return RISK_RANK[floor] > cur ? floor : currentRisk;
}

/** Best-effort append of one install-command audit record. Never throws. */
export function recordInstallCommandAudit(entry, opts = {}) {
  try {
    const baseDir =
      opts.baseDir ||
      (opts.env || process.env).CC_AUDIT_DIR ||
      path.join(os.homedir(), ".chainlesschain", "audit");
    const _fs = opts.fs || fs;
    _fs.mkdirSync(baseDir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date(opts.now ? opts.now() : Date.now()).toISOString(),
      kind: "install-command",
      ...entry,
    });
    _fs.appendFileSync(
      path.join(baseDir, "install-commands.jsonl"),
      line + "\n",
      "utf-8",
    );
    return true;
  } catch {
    return false; // audit is best-effort — never affect the run
  }
}
