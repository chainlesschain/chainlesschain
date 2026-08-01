import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { getConfigPath } from "./paths.js";

export const BACKGROUND_LAUNCH_PROFILE_VERSION = 1;

const PERMISSION_MODES = new Set([
  "manual",
  "auto",
  "dontAsk",
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
]);
const SANDBOX_MODES = new Set(["off", "workspace-write", "strict"]);
const TRI_STATES = new Set(["auto", "enabled", "disabled"]);
const PERMISSION_RANK = new Map([
  ["plan", 0],
  ["manual", 1],
  ["default", 1],
  ["dontAsk", 2],
  ["acceptEdits", 3],
  ["auto", 4],
  ["bypassPermissions", 5],
]);

function scalar(value, max = 1024) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function positive(value, integer = false) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return integer ? Math.floor(number) : number;
}

function sortedStrings(values, { split = false, pathsFrom = null } = {}) {
  const raw = Array.isArray(values) ? values : values ? [values] : [];
  const expanded = split
    ? raw.flatMap((value) => String(value).split(/[\s,]+/))
    : raw;
  return [
    ...new Set(
      expanded
        .map((value) => scalar(value, 4096))
        .filter(Boolean)
        .map((value) => (pathsFrom ? resolve(pathsFrom, value) : value)),
    ),
  ].sort();
}

function orderedStrings(values, { split = false } = {}) {
  const raw = Array.isArray(values) ? values : values ? [values] : [];
  const expanded = split
    ? raw.flatMap((value) => String(value).split(/[\s,]+/))
    : raw;
  return [
    ...new Set(expanded.map((value) => scalar(value, 4096)).filter(Boolean)),
  ];
}

function canonicalPath(value, cwd) {
  const absolute = resolve(cwd || process.cwd(), String(value || ""));
  try {
    return realpathSync.native
      ? realpathSync.native(absolute)
      : realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function hashPathEntry(hash, absolute, relative = ".") {
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    hash.update(`link\0${relative}\0${readlinkSync(absolute)}\0`);
    return;
  }
  if (stat.isDirectory()) {
    hash.update(`dir\0${relative}\0`);
    for (const name of readdirSync(absolute).sort()) {
      hashPathEntry(hash, join(absolute, name), `${relative}/${name}`);
    }
    return;
  }
  if (stat.isFile()) {
    hash.update(`file\0${relative}\0${stat.size}\0`);
    hash.update(readFileSync(absolute));
    hash.update("\0");
    return;
  }
  hash.update(`other\0${relative}\0${stat.mode}\0${stat.size}\0`);
}

/**
 * Describe a configuration input without storing its contents. The digest is
 * deliberately content-addressed (rather than mtime-addressed), so touching a
 * file does not make a compatible background session impossible to resume.
 */
export function describeBackgroundConfigSource(path, options = {}) {
  const absolute = canonicalPath(path, options.cwd);
  if (!existsSync(absolute)) {
    return { path: absolute, kind: "missing", sha256: null };
  }
  try {
    const stat = lstatSync(absolute);
    const kind = stat.isDirectory()
      ? "directory"
      : stat.isFile()
        ? "file"
        : stat.isSymbolicLink()
          ? "symlink"
          : "other";
    const hash = createHash("sha256");
    hashPathEntry(hash, absolute);
    return { path: absolute, kind, sha256: hash.digest("hex") };
  } catch {
    // Never serialize an exception message: filesystem errors can include
    // credential-bearing paths supplied by external configuration.
    return { path: absolute, kind: "unavailable", sha256: null };
  }
}

function findAncestorFile(cwd, ...parts) {
  let current = resolve(cwd || process.cwd());
  const root = parse(current).root;
  for (let depth = 0; depth < 64; depth++) {
    const candidate = join(current, ...parts);
    if (existsSync(candidate)) return candidate;
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function findGitRoot(cwd) {
  const marker = findAncestorFile(cwd, ".git");
  return marker ? dirname(marker) : null;
}

function sourceList({ cwd, settingsFile, mcpConfig, bundle, projectMcp }) {
  const files = [getConfigPath()];
  const gitRoot = findGitRoot(cwd);
  const projectConfig = findAncestorFile(cwd, ".chainlesschain", "config.json");
  files.push(
    projectConfig || join(gitRoot || cwd, ".chainlesschain", "config.json"),
  );

  files.push(join(homedir(), ".claude", "settings.json"));
  if (gitRoot && canonicalPath(gitRoot) !== canonicalPath(cwd)) {
    files.push(join(gitRoot, ".claude", "settings.json"));
    files.push(join(gitRoot, ".claude", "settings.local.json"));
  }
  files.push(join(cwd, ".claude", "settings.json"));
  files.push(join(cwd, ".claude", "settings.local.json"));
  if (settingsFile) files.push(resolve(cwd, settingsFile));

  const managed =
    process.env.CC_MANAGED_SETTINGS ||
    (process.platform === "win32"
      ? join(
          process.env.ProgramData ||
            process.env.PROGRAMDATA ||
            "C:\\ProgramData",
          "ChainlessChain",
          "managed-settings.json",
        )
      : "/etc/chainlesschain/managed-settings.json");
  files.push(resolve(managed));
  if (mcpConfig) files.push(resolve(cwd, mcpConfig));
  if (projectMcp) {
    files.push(join(gitRoot || cwd, ".mcp.json"));
  }
  if (bundle) files.push(resolve(cwd, bundle));

  const unique = [...new Set(files.map((file) => canonicalPath(file)))].sort();
  return unique.map((file) => describeBackgroundConfigSource(file));
}

/** Return a credential-free representation of a base URL. */
export function sanitizeBackgroundBaseUrl(value) {
  const original = scalar(value, 8192);
  if (!original) return { value: null, redacted: false };
  try {
    const url = new URL(original);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { value: null, redacted: true };
    }
    const redacted = Boolean(
      url.username || url.password || url.search || url.hash,
    );
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return { value: url.toString(), redacted };
  } catch {
    return { value: null, redacted: true };
  }
}

function splitLongOption(token) {
  const index = token.indexOf("=");
  return index === -1
    ? { name: token, inline: null }
    : { name: token.slice(0, index), inline: token.slice(index + 1) };
}

function emptyParsedProfile(cwd, worktree, governance) {
  return {
    version: BACKGROUND_LAUNCH_PROFILE_VERSION,
    command: "agent",
    llm: {
      provider: null,
      model: null,
      baseUrl: null,
      baseUrlRedacted: false,
      visionModel: null,
      fallbackModels: [],
    },
    tools: { allowed: null, disallowed: [] },
    permission: {
      mode: scalar(governance?.permissionMode) || "default",
      dangerousBypass: false,
      unattended: false,
      unattendedAllow: [],
      interactiveApprovals: false,
      promptTool: null,
      remoteControl: false,
    },
    sandbox: { enabled: false, image: null, mode: null, network: false },
    mcp: {
      configFile: null,
      disabled: false,
      strict: false,
      project: false,
      ide: "auto",
      pdh: "auto",
      jetbrains: "auto",
    },
    settings: { file: null },
    plugins: { bundle: null, disabled: false },
    workspace: {
      cwd: canonicalPath(cwd || process.cwd()),
      addDirs: [],
      worktree: worktree
        ? {
            repoRoot: canonicalPath(worktree.repoRoot),
            worktreePath: canonicalPath(worktree.worktreePath || worktree.path),
            baseSha: scalar(worktree.baseSha),
            branch: scalar(worktree.branch),
          }
        : null,
    },
    budget: {
      maxTurns: positive(governance?.resourceBudget?.maxTurns, true),
      maxCostUsd: positive(governance?.resourceBudget?.maxCostUsd),
      thinkingTokens: null,
      maxRewakes: null,
      maxOuterTurns: null,
      goalMaxTokens: null,
      goalMaxCostUsd: null,
      goalMaxTimeMs: null,
    },
    runtime: {
      safeMode: false,
      bare: false,
      checkpoint: "default",
      managedCheckpoint: false,
      managedCheckpointState: null,
      managedCheckpointExcludes: [],
      noProjectMemory: false,
      noFileRefs: false,
      noSlashMacros: false,
      noRecallMemory: false,
      noMcpAutoConnect: false,
      outputStyle: null,
      outputFormat: "text",
      inputFormat: "text",
      thinking: null,
      autoRewake: false,
      autoPin: false,
      noStream: false,
      noParkOnExit: false,
    },
    credentials: { apiKey: "default" },
    configuration: { sources: [] },
    omitted: [],
  };
}

/**
 * Capture the effective, resumable CLI envelope while intentionally omitting
 * task/system prompts, API keys, images, trace ids and environment values.
 */
export function captureBackgroundLaunchProfile({
  argv = [],
  cwd = process.cwd(),
  worktree = null,
  governance = null,
} = {}) {
  const profile = emptyParsedProfile(cwd, worktree, governance);
  const omitted = new Set();
  const addDirs = [];
  const fallbackModels = [];
  const managedExcludes = [];
  let settingsFile = null;
  let mcpConfig = null;
  let bundle = null;

  const args = Array.isArray(argv) ? argv.map(String) : [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "agent" || token === "a") continue;
    if (token === "--") {
      if (index + 1 < args.length) omitted.add("taskPrompt");
      break;
    }
    if (token === "-p") {
      omitted.add("taskPrompt");
      if (args[index + 1] && !args[index + 1].startsWith("-")) index++;
      continue;
    }
    if (token === "-c") continue;
    if (token === "-y") {
      profile.permission.dangerousBypass = true;
      continue;
    }
    if (!token.startsWith("--")) {
      omitted.add("taskPrompt");
      continue;
    }

    const { name, inline } = splitLongOption(token);
    const take = (optional = false) => {
      if (inline !== null) return inline;
      const next = args[index + 1];
      if (next === undefined || (optional && next.startsWith("-"))) return null;
      index++;
      return next;
    };
    switch (name) {
      case "--provider":
        profile.llm.provider = scalar(take());
        break;
      case "--model":
        profile.llm.model = scalar(take());
        break;
      case "--base-url": {
        const safe = sanitizeBackgroundBaseUrl(take());
        profile.llm.baseUrl = safe.value;
        profile.llm.baseUrlRedacted = safe.redacted;
        break;
      }
      case "--vision-model":
        profile.llm.visionModel = scalar(take());
        break;
      case "--fallback-model":
        fallbackModels.push(...orderedStrings(take(), { split: true }));
        break;
      case "--allowed-tools":
        profile.tools.allowed = sortedStrings(take(), { split: true });
        break;
      case "--disallowed-tools":
        profile.tools.disallowed = sortedStrings(take(), { split: true });
        break;
      case "--permission-mode": {
        const mode = scalar(take());
        profile.permission.mode = PERMISSION_MODES.has(mode) ? mode : "default";
        break;
      }
      case "--allow-dangerous-bypass":
      case "--dangerously-skip-permissions":
      case "--yolo":
        profile.permission.dangerousBypass = true;
        break;
      case "--unattended":
        profile.permission.unattended = true;
        break;
      case "--unattended-allow":
        profile.permission.unattendedAllow = sortedStrings(take(), {
          split: true,
        });
        break;
      case "--interactive-approvals":
        profile.permission.interactiveApprovals = true;
        break;
      case "--permission-prompt-tool":
        profile.permission.promptTool = scalar(take());
        break;
      case "--remote-control":
        profile.permission.remoteControl = true;
        break;
      case "--sandbox":
        profile.sandbox.enabled = true;
        profile.sandbox.image = scalar(take(true));
        break;
      case "--sandbox-mode": {
        const mode = scalar(take());
        profile.sandbox.mode = SANDBOX_MODES.has(mode) ? mode : null;
        break;
      }
      case "--sandbox-network":
        profile.sandbox.network = true;
        break;
      case "--mcp-config":
        mcpConfig = scalar(take(), 4096);
        break;
      case "--no-mcp":
        profile.mcp.disabled = true;
        profile.runtime.noMcpAutoConnect = true;
        break;
      case "--strict-mcp-config":
        profile.mcp.strict = true;
        break;
      case "--project-mcp":
        profile.mcp.project = true;
        break;
      case "--ide":
        profile.mcp.ide = "enabled";
        break;
      case "--no-ide":
        profile.mcp.ide = "disabled";
        break;
      case "--pdh":
        profile.mcp.pdh = "enabled";
        break;
      case "--no-pdh":
        profile.mcp.pdh = "disabled";
        break;
      case "--jetbrains":
        profile.mcp.jetbrains = "enabled";
        break;
      case "--no-jetbrains":
        profile.mcp.jetbrains = "disabled";
        break;
      case "--settings":
        settingsFile = scalar(take(), 4096);
        break;
      case "--bundle":
        bundle = scalar(take(), 4096);
        break;
      case "--add-dir":
        addDirs.push(take());
        break;
      case "--max-turns":
        profile.budget.maxTurns = positive(take(), true);
        break;
      case "--max-budget-usd":
        profile.budget.maxCostUsd = positive(take());
        break;
      case "--thinking-budget":
        profile.budget.thinkingTokens = positive(take(), true);
        break;
      case "--max-rewakes":
        profile.budget.maxRewakes = positive(take(), true);
        break;
      case "--max-outer-turns":
        profile.budget.maxOuterTurns = positive(take(), true);
        break;
      case "--goal-max-tokens":
        profile.budget.goalMaxTokens = positive(take(), true);
        break;
      case "--goal-max-cost":
        profile.budget.goalMaxCostUsd = positive(take());
        break;
      case "--goal-max-time":
        profile.budget.goalMaxTimeMs = positive(take(), true);
        break;
      case "--safe-mode":
        profile.runtime.safeMode = true;
        break;
      case "--bare":
        profile.runtime.bare = true;
        profile.plugins.disabled = true;
        break;
      case "--checkpoint":
        profile.runtime.checkpoint = "enabled";
        break;
      case "--no-checkpoint":
        profile.runtime.checkpoint = "disabled";
        break;
      case "--managed-checkpoint":
        profile.runtime.managedCheckpoint = true;
        break;
      case "--managed-checkpoint-state":
        profile.runtime.managedCheckpointState = canonicalPath(take(), cwd);
        break;
      case "--managed-checkpoint-exclude":
        managedExcludes.push(take());
        break;
      case "--no-project-memory":
        profile.runtime.noProjectMemory = true;
        break;
      case "--no-file-refs":
        profile.runtime.noFileRefs = true;
        break;
      case "--no-slash-macros":
        profile.runtime.noSlashMacros = true;
        break;
      case "--no-recall-memory":
        profile.runtime.noRecallMemory = true;
        break;
      case "--output-style":
        profile.runtime.outputStyle = scalar(take());
        break;
      case "--output-format":
        profile.runtime.outputFormat = scalar(take()) || "text";
        break;
      case "--input-format":
        profile.runtime.inputFormat = scalar(take()) || "text";
        break;
      case "--think":
        profile.runtime.thinking = scalar(take(true)) || "think";
        break;
      case "--ultrathink":
        profile.runtime.thinking = "ultra";
        break;
      case "--auto-rewake":
        profile.runtime.autoRewake = true;
        break;
      case "--auto-pin":
        profile.runtime.autoPin = true;
        break;
      case "--no-stream":
        profile.runtime.noStream = true;
        break;
      case "--no-park-on-exit":
        profile.runtime.noParkOnExit = true;
        break;
      case "--api-key":
        take();
        profile.credentials.apiKey = "external";
        omitted.add("apiKey");
        break;
      case "--print":
        take(true);
        omitted.add("taskPrompt");
        break;
      case "--system-prompt":
        take();
        omitted.add("systemPrompt");
        break;
      case "--append-system-prompt":
        take();
        omitted.add("appendSystemPrompt");
        break;
      case "--recall-query":
        take();
        omitted.add("recallQuery");
        break;
      case "--image":
        take();
        omitted.add("initialImage");
        break;
      case "--goal-condition":
        take();
        omitted.add("goalCondition");
        break;
      case "--trace-id":
      case "--otlp":
      case "--json-schema":
      case "--channels":
      case "--agent-id":
      case "--recall-limit":
      case "--goal":
        take(name === "--goal");
        omitted.add(name.slice(2));
        break;
      case "--session":
        take();
        break;
      case "--resume":
        take(true);
        break;
      case "--continue":
      case "--fork-session":
      case "--bg":
      case "--background":
      case "--worktree":
      case "--ephemeral":
      case "--capabilities":
      case "--disable-slash-commands":
      case "--ax-screen-reader":
      case "--replay-user-messages":
      case "--include-partial-messages":
      case "--goal-assess":
      case "--otlp-content":
        break;
      default:
        // Unknown flags are never copied into persistent state: a future flag
        // could carry a credential. Record only its option name for diagnosis.
        omitted.add(`option:${name.slice(0, 96)}`);
        break;
    }
  }

  profile.llm.fallbackModels = orderedStrings(fallbackModels);
  profile.workspace.addDirs = sortedStrings(addDirs, {
    pathsFrom: profile.workspace.cwd,
  });
  profile.runtime.managedCheckpointExcludes = sortedStrings(managedExcludes, {
    pathsFrom: profile.workspace.cwd,
  });
  profile.settings.file = settingsFile
    ? canonicalPath(settingsFile, profile.workspace.cwd)
    : null;
  profile.mcp.configFile = mcpConfig
    ? canonicalPath(mcpConfig, profile.workspace.cwd)
    : null;
  profile.plugins.bundle = bundle
    ? canonicalPath(bundle, profile.workspace.cwd)
    : null;
  profile.configuration.sources = sourceList({
    cwd: profile.workspace.cwd,
    settingsFile,
    mcpConfig,
    bundle,
    projectMcp: profile.mcp.project,
  });
  profile.omitted = [...omitted].sort();
  return normalizeBackgroundLaunchProfile(profile);
}

function normalizeSource(source) {
  const path = scalar(source?.path, 8192);
  if (!path) return null;
  const kind = new Set([
    "missing",
    "file",
    "directory",
    "symlink",
    "other",
    "unavailable",
  ]).has(source?.kind)
    ? source.kind
    : "unavailable";
  const sha256 = /^[a-f0-9]{64}$/.test(String(source?.sha256 || ""))
    ? String(source.sha256)
    : null;
  return { path: canonicalPath(path), kind, sha256 };
}

/** Whitelist and normalize a profile supplied across an API boundary. */
export function normalizeBackgroundLaunchProfile(input) {
  if (!input || Number(input.version) !== BACKGROUND_LAUNCH_PROFILE_VERSION) {
    throw new Error(
      `Unsupported background launch profile version: ${input?.version ?? "missing"}`,
    );
  }
  const cwd = canonicalPath(input.workspace?.cwd || process.cwd());
  const safeBase = sanitizeBackgroundBaseUrl(input.llm?.baseUrl);
  const permissionMode = PERMISSION_MODES.has(input.permission?.mode)
    ? input.permission.mode
    : "default";
  const sandboxMode = SANDBOX_MODES.has(input.sandbox?.mode)
    ? input.sandbox.mode
    : null;
  const tri = (value) => (TRI_STATES.has(value) ? value : "auto");
  const pathOrNull = (value) =>
    value ? canonicalPath(scalar(value, 8192), cwd) : null;
  const sources = (
    Array.isArray(input.configuration?.sources)
      ? input.configuration.sources
      : []
  )
    .map(normalizeSource)
    .filter(Boolean)
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    version: BACKGROUND_LAUNCH_PROFILE_VERSION,
    command: "agent",
    llm: {
      provider: scalar(input.llm?.provider),
      model: scalar(input.llm?.model),
      baseUrl: safeBase.value,
      baseUrlRedacted: input.llm?.baseUrlRedacted === true || safeBase.redacted,
      visionModel: scalar(input.llm?.visionModel),
      fallbackModels: orderedStrings(input.llm?.fallbackModels),
    },
    tools: {
      allowed: Array.isArray(input.tools?.allowed)
        ? sortedStrings(input.tools.allowed)
        : null,
      disallowed: sortedStrings(input.tools?.disallowed),
    },
    permission: {
      mode: permissionMode,
      dangerousBypass: input.permission?.dangerousBypass === true,
      unattended: input.permission?.unattended === true,
      unattendedAllow: sortedStrings(input.permission?.unattendedAllow),
      interactiveApprovals: input.permission?.interactiveApprovals === true,
      promptTool: scalar(input.permission?.promptTool),
      remoteControl: input.permission?.remoteControl === true,
    },
    sandbox: {
      enabled: input.sandbox?.enabled === true,
      image: scalar(input.sandbox?.image),
      mode: sandboxMode,
      network: input.sandbox?.network === true,
    },
    mcp: {
      configFile: pathOrNull(input.mcp?.configFile),
      disabled: input.mcp?.disabled === true,
      strict: input.mcp?.strict === true,
      project: input.mcp?.project === true,
      ide: tri(input.mcp?.ide),
      pdh: tri(input.mcp?.pdh),
      jetbrains: tri(input.mcp?.jetbrains),
    },
    settings: { file: pathOrNull(input.settings?.file) },
    plugins: {
      bundle: pathOrNull(input.plugins?.bundle),
      disabled: input.plugins?.disabled === true,
    },
    workspace: {
      cwd,
      addDirs: sortedStrings(input.workspace?.addDirs, { pathsFrom: cwd }),
      worktree: input.workspace?.worktree
        ? {
            repoRoot: pathOrNull(input.workspace.worktree.repoRoot),
            worktreePath: pathOrNull(input.workspace.worktree.worktreePath),
            baseSha: scalar(input.workspace.worktree.baseSha),
            branch: scalar(input.workspace.worktree.branch),
          }
        : null,
    },
    budget: {
      maxTurns: positive(input.budget?.maxTurns, true),
      maxCostUsd: positive(input.budget?.maxCostUsd),
      thinkingTokens: positive(input.budget?.thinkingTokens, true),
      maxRewakes: positive(input.budget?.maxRewakes, true),
      maxOuterTurns: positive(input.budget?.maxOuterTurns, true),
      goalMaxTokens: positive(input.budget?.goalMaxTokens, true),
      goalMaxCostUsd: positive(input.budget?.goalMaxCostUsd),
      goalMaxTimeMs: positive(input.budget?.goalMaxTimeMs, true),
    },
    runtime: {
      safeMode: input.runtime?.safeMode === true,
      bare: input.runtime?.bare === true,
      checkpoint: new Set(["default", "enabled", "disabled"]).has(
        input.runtime?.checkpoint,
      )
        ? input.runtime.checkpoint
        : "default",
      managedCheckpoint: input.runtime?.managedCheckpoint === true,
      managedCheckpointState: pathOrNull(input.runtime?.managedCheckpointState),
      managedCheckpointExcludes: sortedStrings(
        input.runtime?.managedCheckpointExcludes,
        { pathsFrom: cwd },
      ),
      noProjectMemory: input.runtime?.noProjectMemory === true,
      noFileRefs: input.runtime?.noFileRefs === true,
      noSlashMacros: input.runtime?.noSlashMacros === true,
      noRecallMemory: input.runtime?.noRecallMemory === true,
      noMcpAutoConnect: input.runtime?.noMcpAutoConnect === true,
      outputStyle: scalar(input.runtime?.outputStyle),
      outputFormat: scalar(input.runtime?.outputFormat) || "text",
      inputFormat: scalar(input.runtime?.inputFormat) || "text",
      thinking: scalar(input.runtime?.thinking),
      autoRewake: input.runtime?.autoRewake === true,
      autoPin: input.runtime?.autoPin === true,
      noStream: input.runtime?.noStream === true,
      noParkOnExit: input.runtime?.noParkOnExit === true,
    },
    credentials: {
      apiKey: input.credentials?.apiKey === "external" ? "external" : "default",
    },
    configuration: { sources },
    omitted: sortedStrings(input.omitted),
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalBackgroundLaunchProfileJson(profile) {
  return JSON.stringify(
    canonicalValue(normalizeBackgroundLaunchProfile(profile)),
  );
}

export function fingerprintBackgroundLaunchProfile(profile) {
  return createHash("sha256")
    .update(canonicalBackgroundLaunchProfileJson(profile))
    .digest("hex");
}

export function refreshBackgroundLaunchProfileSources(profile) {
  const normalized = normalizeBackgroundLaunchProfile(profile);
  return normalizeBackgroundLaunchProfile({
    ...normalized,
    configuration: {
      sources: normalized.configuration.sources.map((source) =>
        describeBackgroundConfigSource(source.path),
      ),
    },
  });
}

export function verifyBackgroundLaunchProfileSources(profile) {
  const normalized = normalizeBackgroundLaunchProfile(profile);
  const refreshed = refreshBackgroundLaunchProfileSources(normalized);
  const issues = [];
  for (
    let index = 0;
    index < normalized.configuration.sources.length;
    index++
  ) {
    const before = normalized.configuration.sources[index];
    const after = refreshed.configuration.sources[index];
    if (before.kind === "unavailable" || after.kind === "unavailable") {
      issues.push(`configuration-source-unverifiable:${before.path}`);
    } else if (
      before.path !== after.path ||
      before.kind !== after.kind ||
      before.sha256 !== after.sha256
    ) {
      issues.push(`configuration-source-changed:${before.path}`);
    }
  }
  if (normalized.llm.baseUrlRedacted) issues.push("base-url-redacted");
  return { valid: issues.length === 0, issues, profile: refreshed };
}

function same(a, b) {
  return (
    JSON.stringify(canonicalValue(a)) === JSON.stringify(canonicalValue(b))
  );
}

function isBudgetLooser(before, after) {
  if (before === null) return false;
  return after === null || Number(after) > Number(before);
}

function isToolPolicyLooser(before, after) {
  if (
    Array.isArray(before.allowed) &&
    (after.allowed === null ||
      after.allowed.some((tool) => !before.allowed.includes(tool)))
  ) {
    return true;
  }
  return before.disallowed.some((tool) => !after.disallowed.includes(tool));
}

function sandboxRank(sandbox) {
  if (sandbox.mode === "strict") return 0;
  if (sandbox.mode === "workspace-write") return 1;
  if (sandbox.mode === "off") return 3;
  if (sandbox.enabled) return 0;
  return 2;
}

/** Explain why a proposed profile cannot silently replace the persisted one. */
export function assessBackgroundLaunchProfileCompatibility(original, proposed) {
  const before = normalizeBackgroundLaunchProfile(original);
  const after = normalizeBackgroundLaunchProfile(proposed);
  if (
    fingerprintBackgroundLaunchProfile(before) ===
    fingerprintBackgroundLaunchProfile(after)
  ) {
    return { compatible: true, reasons: [] };
  }
  const reasons = new Set();
  if (before.llm.provider !== after.llm.provider)
    reasons.add("provider-changed");
  if (before.llm.model !== after.llm.model) reasons.add("model-changed");
  if (before.llm.baseUrl !== after.llm.baseUrl) reasons.add("base-url-changed");
  if (before.permission.mode !== after.permission.mode) {
    reasons.add(
      (PERMISSION_RANK.get(after.permission.mode) ?? 99) >
        (PERMISSION_RANK.get(before.permission.mode) ?? 99)
        ? "permission-mode-loosened"
        : "permission-mode-changed",
    );
  }
  if (!before.permission.dangerousBypass && after.permission.dangerousBypass) {
    reasons.add("permission-bypass-enabled");
  }
  if (!same(before.tools, after.tools)) {
    reasons.add(
      isToolPolicyLooser(before.tools, after.tools)
        ? "tool-policy-loosened"
        : "tool-policy-changed",
    );
  }
  if (!same(before.sandbox, after.sandbox)) {
    reasons.add(
      sandboxRank(after.sandbox) > sandboxRank(before.sandbox) ||
        (!before.sandbox.network && after.sandbox.network)
        ? "sandbox-loosened"
        : "sandbox-changed",
    );
  }
  if (!same(before.mcp, after.mcp)) reasons.add("mcp-changed");
  if (!same(before.settings, after.settings)) reasons.add("settings-changed");
  if (!same(before.plugins, after.plugins)) reasons.add("plugin-changed");
  if (!same(before.workspace, after.workspace))
    reasons.add("workspace-changed");
  if (!same(before.configuration, after.configuration)) {
    reasons.add("configuration-changed");
  }
  if (
    Object.keys(before.budget).some((key) =>
      isBudgetLooser(before.budget[key], after.budget[key]),
    )
  ) {
    reasons.add("budget-loosened");
  } else if (!same(before.budget, after.budget)) {
    reasons.add("budget-changed");
  }
  if (!same(before.runtime, after.runtime)) reasons.add("runtime-changed");
  if (!same(before.omitted, after.omitted)) reasons.add("redactions-changed");
  if (reasons.size === 0) reasons.add("launch-profile-changed");
  return { compatible: false, reasons: [...reasons].sort() };
}

function pushValue(argv, flag, value) {
  if (value !== null && value !== undefined && value !== "") {
    argv.push(flag, String(value));
  }
}

function pushFlag(argv, flag, enabled) {
  if (enabled) argv.push(flag);
}

/** Reconstruct a prompt-free argv template from a persisted profile. */
export function buildArgvFromBackgroundLaunchProfile(profile) {
  const p = normalizeBackgroundLaunchProfile(profile);
  const argv = ["agent"];
  pushValue(argv, "--provider", p.llm.provider);
  pushValue(argv, "--model", p.llm.model);
  pushValue(argv, "--base-url", p.llm.baseUrl);
  pushValue(argv, "--vision-model", p.llm.visionModel);
  for (const model of p.llm.fallbackModels) {
    pushValue(argv, "--fallback-model", model);
  }
  if (p.tools.allowed !== null) {
    pushValue(argv, "--allowed-tools", p.tools.allowed.join(","));
  }
  pushValue(argv, "--disallowed-tools", p.tools.disallowed.join(","));
  pushValue(argv, "--permission-mode", p.permission.mode);
  pushFlag(argv, "--allow-dangerous-bypass", p.permission.dangerousBypass);
  pushFlag(argv, "--unattended", p.permission.unattended);
  pushValue(argv, "--unattended-allow", p.permission.unattendedAllow.join(","));
  pushFlag(argv, "--interactive-approvals", p.permission.interactiveApprovals);
  pushValue(argv, "--permission-prompt-tool", p.permission.promptTool);
  pushFlag(argv, "--remote-control", p.permission.remoteControl);
  if (p.sandbox.enabled) {
    argv.push("--sandbox");
    if (p.sandbox.image) argv.push(p.sandbox.image);
  }
  pushValue(argv, "--sandbox-mode", p.sandbox.mode);
  pushFlag(argv, "--sandbox-network", p.sandbox.network);
  pushValue(argv, "--mcp-config", p.mcp.configFile);
  pushFlag(argv, "--no-mcp", p.mcp.disabled);
  pushFlag(argv, "--strict-mcp-config", p.mcp.strict);
  pushFlag(argv, "--project-mcp", p.mcp.project);
  for (const [key, value] of [
    ["ide", p.mcp.ide],
    ["pdh", p.mcp.pdh],
    ["jetbrains", p.mcp.jetbrains],
  ]) {
    if (value === "enabled") argv.push(`--${key}`);
    if (value === "disabled") argv.push(`--no-${key}`);
  }
  pushValue(argv, "--settings", p.settings.file);
  pushValue(argv, "--bundle", p.plugins.bundle);
  for (const dir of p.workspace.addDirs) pushValue(argv, "--add-dir", dir);
  pushValue(argv, "--max-turns", p.budget.maxTurns);
  pushValue(argv, "--max-budget-usd", p.budget.maxCostUsd);
  pushValue(argv, "--thinking-budget", p.budget.thinkingTokens);
  pushValue(argv, "--max-rewakes", p.budget.maxRewakes);
  pushValue(argv, "--max-outer-turns", p.budget.maxOuterTurns);
  pushValue(argv, "--goal-max-tokens", p.budget.goalMaxTokens);
  pushValue(argv, "--goal-max-cost", p.budget.goalMaxCostUsd);
  pushValue(argv, "--goal-max-time", p.budget.goalMaxTimeMs);
  pushFlag(argv, "--safe-mode", p.runtime.safeMode);
  pushFlag(argv, "--bare", p.runtime.bare);
  pushFlag(argv, "--checkpoint", p.runtime.checkpoint === "enabled");
  pushFlag(argv, "--no-checkpoint", p.runtime.checkpoint === "disabled");
  pushFlag(argv, "--managed-checkpoint", p.runtime.managedCheckpoint);
  pushValue(
    argv,
    "--managed-checkpoint-state",
    p.runtime.managedCheckpointState,
  );
  for (const excluded of p.runtime.managedCheckpointExcludes) {
    pushValue(argv, "--managed-checkpoint-exclude", excluded);
  }
  pushFlag(argv, "--no-project-memory", p.runtime.noProjectMemory);
  pushFlag(argv, "--no-file-refs", p.runtime.noFileRefs);
  pushFlag(argv, "--no-slash-macros", p.runtime.noSlashMacros);
  pushFlag(argv, "--no-recall-memory", p.runtime.noRecallMemory);
  pushValue(argv, "--output-style", p.runtime.outputStyle);
  pushValue(argv, "--output-format", p.runtime.outputFormat);
  pushValue(argv, "--input-format", p.runtime.inputFormat);
  if (p.runtime.thinking) {
    pushValue(argv, "--think", p.runtime.thinking);
  }
  pushFlag(argv, "--auto-rewake", p.runtime.autoRewake);
  pushFlag(argv, "--auto-pin", p.runtime.autoPin);
  pushFlag(argv, "--no-stream", p.runtime.noStream);
  pushFlag(argv, "--no-park-on-exit", p.runtime.noParkOnExit);
  return argv;
}

/** Remove API key flags before argv is serialized into the transient job. */
export function stripBackgroundLaunchSecrets(argv) {
  const clean = [];
  let apiKey = null;
  const args = Array.isArray(argv) ? argv.map(String) : [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "--") {
      clean.push(...args.slice(index));
      break;
    }
    if (token === "--api-key") {
      apiKey = args[index + 1] ?? apiKey;
      if (index + 1 < args.length) index++;
      continue;
    }
    if (token.startsWith("--api-key=")) {
      apiKey = token.slice("--api-key=".length) || apiKey;
      continue;
    }
    clean.push(token);
  }
  return { argv: clean, apiKey };
}
