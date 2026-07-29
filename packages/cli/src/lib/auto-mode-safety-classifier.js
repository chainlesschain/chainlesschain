/**
 * Auto-mode safety classifier (P2-15).
 *
 * This is a deterministic, offline classifier for evaluating dangerous tool
 * intents. It never executes the supplied command and never reads a referenced
 * file. The output contains stable reason codes, but deliberately omits raw
 * arguments so benchmark reports cannot echo credentials from a custom corpus.
 *
 * The classifier is an additional signal, not an authority. Existing managed
 * denies, shell hard-denies, credential guards and OS sandbox decisions remain
 * authoritative. `evaluateAutoModeSafety` reports those layers separately.
 */

import path from "node:path";
import { createRequire } from "node:module";
import { classifyRemoteExecCommand } from "./install-command-policy.js";
import {
  commandReadsCredentials,
  credentialFileReason,
  isSecretEnvName,
} from "./credential-guard.js";
import { containsSecret } from "./secret-scan.js";

const require_ = createRequire(import.meta.url);
const shellPolicy = require_("../runtime/coding-agent-shell-policy.cjs");
const { evaluateShellCommandPolicy } = shellPolicy;

export const AUTO_MODE_SAFETY_CLASSIFICATION_SCHEMA =
  "chainlesschain.auto-mode-safety-classification/v1";
export const AUTO_MODE_SAFETY_VERDICT_SCHEMA =
  "chainlesschain.auto-mode-safety-verdict/v1";
export const AUTO_MODE_SAFETY_CLASSIFIER_VERSION = "1.0.0";

export const SAFETY_CATEGORY = Object.freeze({
  WORKSPACE_SCOPE_ESCAPE: "workspace.scope_escape",
  SECRET_EGRESS: "secret.egress",
  PRODUCTION_DEPLOYMENT: "deployment.production",
  GIT_FORCE_PUSH: "git.force_push",
  UNREVIEWED_MERGE: "merge.unreviewed",
  THIRD_PARTY_AGENT_UNISOLATED: "agent.third_party_unisolated",
  FILESYSTEM_DESTRUCTIVE: "filesystem.destructive",
  INFRASTRUCTURE_DESTRUCTIVE: "infrastructure.destructive",
  REMOTE_CODE_EXECUTION: "code.remote_exec",
  SHELL_ENCODED_EXECUTION: "shell.encoded_execution",
  PUBLICATION: "artifact.publication",
});

export const RELEASE_CRITICAL_SAFETY_CATEGORIES = Object.freeze([
  SAFETY_CATEGORY.WORKSPACE_SCOPE_ESCAPE,
  SAFETY_CATEGORY.SECRET_EGRESS,
  SAFETY_CATEGORY.PRODUCTION_DEPLOYMENT,
  SAFETY_CATEGORY.GIT_FORCE_PUSH,
  SAFETY_CATEGORY.UNREVIEWED_MERGE,
  SAFETY_CATEGORY.THIRD_PARTY_AGENT_UNISOLATED,
]);

const RISK_RANK = Object.freeze({ low: 0, medium: 1, high: 2 });
const SEVERITY_RANK = Object.freeze({
  none: 0,
  medium: 1,
  high: 2,
  critical: 3,
});

const MUTATING_PATH_TOOLS = new Set([
  "apply_patch",
  "delete_file",
  "edit_file",
  "edit_file_hashed",
  "move_file",
  "notebook_edit",
  "write_file",
]);

const PATH_ARG_KEYS = new Set([
  "destination",
  "destinations",
  "destinationpath",
  "file",
  "files",
  "filepath",
  "from",
  "frompath",
  "notebookpath",
  "output",
  "outputpath",
  "path",
  "paths",
  "target",
  "targets",
  "targetpath",
  "to",
  "topath",
]);

const COMMAND_WRAPPERS = new Set([
  "bash",
  "cmd",
  "dash",
  "fish",
  "ksh",
  "powershell",
  "pwsh",
  "sh",
  "zsh",
]);

const EXEC_PREFIXES = new Set([
  "command",
  "doas",
  "env",
  "exec",
  "nice",
  "nohup",
  "pkexec",
  "sudo",
]);

const PREFIX_OPTIONS_WITH_VALUES = Object.freeze({
  doas: new Set(["-a", "-c", "-u"]),
  env: new Set(["-c", "-s", "-u", "--chdir", "--split-string", "--unset"]),
  nice: new Set(["-n", "--adjustment"]),
  pkexec: new Set(["--user"]),
  sudo: new Set([
    "-c",
    "-d",
    "-g",
    "-h",
    "-p",
    "-r",
    "-t",
    "-u",
    "--chdir",
    "--chroot",
    "--close-from",
    "--command-timeout",
    "--group",
    "--host",
    "--other-user",
    "--prompt",
    "--role",
    "--type",
    "--user",
  ]),
});

const DESTRUCTIVE_COMMANDS = new Set([
  "del",
  "diskpart",
  "erase",
  "format",
  "format-volume",
  "mkfs",
  "rd",
  "remove-item",
  "ri",
  "rm",
  "rmdir",
  "shred",
  "wipefs",
]);

const AGENT_BINARIES = new Set([
  "aider",
  "claude",
  "codex",
  "gemini",
  "opencode",
]);

function normalizeRisk(value, fallback = "medium") {
  const risk = typeof value === "string" ? value.toLowerCase() : "";
  return Object.hasOwn(RISK_RANK, risk) ? risk : fallback;
}

function maxRisk(a, b) {
  const left = normalizeRisk(a);
  const right = normalizeRisk(b);
  return RISK_RANK[right] > RISK_RANK[left] ? right : left;
}

function maxSeverity(a, b) {
  const left = Object.hasOwn(SEVERITY_RANK, a) ? a : "none";
  const right = Object.hasOwn(SEVERITY_RANK, b) ? b : "none";
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

function stableSerialize(value, seen = new WeakSet()) {
  if (value == null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(String(value));
    return JSON.stringify(value);
  }
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) {
    const out = `[${value.map((item) => stableSerialize(item, seen)).join(",")}]`;
    seen.delete(value);
    return out;
  }
  const out = `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`)
    .join(",")}}`;
  seen.delete(value);
  return out;
}

function executableBase(token) {
  let normalized = String(token || "")
    .replace(/^["']|["']$/g, "")
    .replace(/[`^]/g, "");
  normalized =
    /^(?:[A-Za-z]:\\|\\\\|\.{1,2}\\)/.test(normalized) ||
    /\\[^\\]+\.(?:cmd|exe)$/i.test(normalized)
      ? normalized.replace(/\\/g, "/")
      : normalized.replace(/\\(.)/g, "$1");
  const base = normalized.split("/").pop() || "";
  return base.toLowerCase().replace(/\.(?:cmd|com|exe)$/i, "");
}

function unwrapQuoted(value) {
  const text = String(value || "").trim();
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  return (first === "'" || first === '"') && first === last
    ? text.slice(1, -1)
    : text;
}

function tokenizeSafetyCommandWithSpans(command) {
  const raw = String(command || "");
  const tokens = [];
  let current = "";
  let start = -1;
  let quote = "";

  const push = (end) => {
    if (start < 0) return;
    tokens.push({ value: current, start, end });
    current = "";
    start = -1;
  };

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (!quote && /\s/.test(ch)) {
      push(i);
      continue;
    }
    if (start < 0) start = i;
    if (quote) {
      if (ch === quote) {
        quote = "";
        continue;
      }
      if (
        ch === "\\" &&
        quote === '"' &&
        i + 1 < raw.length &&
        ['"', "\\", "$", "`"].includes(raw[i + 1])
      ) {
        current += raw[i + 1];
        i += 1;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (
      ch === "\\" &&
      i + 1 < raw.length &&
      (/\s/.test(raw[i + 1]) || ["'", '"'].includes(raw[i + 1]))
    ) {
      current += raw[i + 1];
      i += 1;
      continue;
    }
    current += ch;
  }
  push(raw.length);
  return tokens;
}

function tokenizeSafetyCommand(command) {
  return tokenizeSafetyCommandWithSpans(command).map((token) => token.value);
}

function isAssignmentToken(token) {
  return /^[A-Za-z_]\w*=/.test(String(token || ""));
}

function optionConsumesNext(prefix, token) {
  const raw = String(token || "");
  const lower = raw.toLowerCase();
  const options = PREFIX_OPTIONS_WITH_VALUES[prefix];
  if (!options || raw.includes("=")) return false;
  return options.has(lower);
}

function skipPrefixOptions(tokens, start, prefix) {
  let i = start;
  while (i < tokens.length) {
    const token = String(tokens[i] || "");
    if (prefix === "env" && isAssignmentToken(token)) {
      i += 1;
      continue;
    }
    if (token === "--") return i + 1;
    if (!token.startsWith("-") || token === "-") break;
    const consumesNext = optionConsumesNext(prefix, token);
    i += consumesNext ? 2 : 1;
  }
  return i;
}

function executableTokenIndex(tokens) {
  let i = 0;
  while (i < tokens.length) {
    if (isAssignmentToken(tokens[i])) {
      i += 1;
      continue;
    }
    const prefix = executableBase(tokens[i]);
    if (!EXEC_PREFIXES.has(prefix)) break;
    i = skipPrefixOptions(tokens, i + 1, prefix);
  }
  return i;
}

function splitSafetyCommandSegments(command) {
  const raw = String(command || "");
  const out = [];
  let start = 0;
  let quote = "";
  let escaping = false;

  const push = (end) => {
    const segment = raw
      .slice(start, end)
      .trim()
      .replace(/^[({]\s*/, "")
      .trim();
    if (segment) out.push(segment);
  };

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "\r" || ch === "\n" || "|;&".includes(ch)) {
      push(i);
      if (
        i + 1 < raw.length &&
        ((ch === "|" && raw[i + 1] === "|") ||
          (ch === "&" && raw[i + 1] === "&"))
      ) {
        i += 1;
      }
      start = i + 1;
    }
  }
  push(raw.length);
  return out;
}

function shellCommandFlag(wrapper, token) {
  const lower = String(token || "").toLowerCase();
  if (wrapper === "cmd") return lower === "/c";
  if (["powershell", "pwsh"].includes(wrapper)) {
    return ["-c", "-command", "-commandwithargs"].includes(lower);
  }
  return /^-[a-z]*c[a-z]*$/i.test(lower);
}

function shellCommandFlagIndex(tokens, wrapperIndex, wrapper) {
  for (let index = wrapperIndex + 1; index < tokens.length; index += 1) {
    const token = String(tokens[index] || "");
    if (shellCommandFlag(wrapper, token)) return index;
    if (wrapper === "cmd") {
      if (/^\/[a-z]$/i.test(token)) continue;
      return -1;
    }
    if (token === "--") continue;
    if (token.startsWith("-")) continue;
    return -1;
  }
  return -1;
}

function unwrapShellCommand(segment) {
  const raw = String(segment || "");
  const spans = tokenizeSafetyCommandWithSpans(raw);
  const tokens = spans.map((token) => token.value);
  const wrapperIndex = executableTokenIndex(tokens);
  const wrapper = executableBase(tokens[wrapperIndex]);
  if (!COMMAND_WRAPPERS.has(wrapper)) return null;
  const flagIndex = shellCommandFlagIndex(tokens, wrapperIndex, wrapper);
  if (flagIndex < 0 || flagIndex + 1 >= spans.length) return null;
  let commandStart = flagIndex + 1;
  if (tokens[commandStart] === "--" && commandStart + 1 < spans.length) {
    commandStart += 1;
  }
  return unwrapQuoted(raw.slice(spans[commandStart].start).trim());
}

function collectCommandSegments(command, depth = 0) {
  const raw = String(command || "");
  if (!raw.trim()) return [];
  let segments = splitSafetyCommandSegments(raw);
  if (!segments.length) segments = [raw];
  const out = [];
  for (const segment of segments) {
    const text = String(segment || "").trim();
    if (!text) continue;
    out.push(text);
    if (depth >= 3) continue;
    const inner = unwrapShellCommand(text);
    if (inner && inner !== text) {
      out.push(...collectCommandSegments(inner, depth + 1));
    }
  }
  return [...new Set(out)];
}

function executableTokens(segment) {
  const tokens = tokenizeSafetyCommand(String(segment || ""));
  return tokens.slice(executableTokenIndex(tokens)).map((token) => {
    let canonical = String(token || "").replace(/[`^](.)/g, "$1");
    canonical = canonical.replace(/^\\([+-])/, "$1");
    if (/^[+-]/.test(canonical)) {
      canonical = canonical.replace(/\\(.)/g, "$1");
    }
    return canonical;
  });
}

function canonicalShellKeyword(token) {
  return String(token || "")
    .replace(/[`^](.)/g, "$1")
    .replace(/\\(.)/g, "$1");
}

function inputCommand(input) {
  const command = input?.args?.command;
  if (typeof command === "string") return command;
  const argv = input?.args?.argv;
  return Array.isArray(argv)
    ? argv
        .map((value) => {
          const token = String(value);
          if (token && !/[\s|;&"'\\]/.test(token)) return token;
          return `"${token.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        })
        .join(" ")
    : "";
}

function workspaceRoots(context = {}) {
  const roots = [];
  if (Array.isArray(context.workspaceRoots)) {
    roots.push(
      ...context.workspaceRoots.filter((root) => typeof root === "string"),
    );
  }
  if (typeof context.workspaceRoot === "string") {
    roots.push(context.workspaceRoot);
  }
  return [...new Set(roots.filter((root) => root.trim()))];
}

function pathApiFor(values, platform) {
  const platformKey = String(platform || "").toLowerCase();
  if (["win32", "windows"].includes(platformKey)) return path.win32;
  if (
    [
      "aix",
      "android",
      "darwin",
      "freebsd",
      "linux",
      "macos",
      "openbsd",
      "sunos",
    ].includes(platformKey)
  ) {
    return path.posix;
  }
  return values.some(
    (value) =>
      /^[A-Za-z]:[\\/]/.test(String(value || "")) ||
      /^\\\\/.test(String(value || "")),
  )
    ? path.win32
    : path.posix;
}

function hasUnresolvedPathExpansion(target) {
  const raw = String(target || "");
  return (
    /(?:^|[\\/])\$(?:env:)?[A-Za-z_][A-Za-z0-9_]*/i.test(raw) ||
    /(?:^|[\\/])\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(raw) ||
    /(?:^|[\\/])%[A-Za-z_][A-Za-z0-9_]*%/.test(raw)
  );
}

function isPathWithinAnyRoot(target, roots, context = {}) {
  if (!roots.length) return true;
  const values = [target, ...roots, context.cwd];
  const api = pathApiFor(values, context.platform);
  const cwd =
    typeof context.cwd === "string" && context.cwd ? context.cwd : roots[0];
  const rawTarget = String(target || "").trim();
  if (!rawTarget) return true;
  if (
    /^~(?:[\\/]|$)/.test(rawTarget) ||
    hasUnresolvedPathExpansion(rawTarget)
  ) {
    return false;
  }
  const targetAbs = api.resolve(cwd, rawTarget);
  for (const root of roots) {
    const rootAbs = api.resolve(cwd, String(root));
    const relative = api.relative(rootAbs, targetAbs);
    if (
      relative === "" ||
      (!relative.startsWith("..") && !api.isAbsolute(relative))
    ) {
      return true;
    }
  }
  return false;
}

function collectPathArgs(args, depth = 0) {
  if (!args || typeof args !== "object" || depth > 4) return [];
  const out = [];
  for (const [key, value] of Object.entries(args)) {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
    if (PATH_ARG_KEYS.has(normalizedKey)) {
      if (typeof value === "string") out.push(value);
      if (Array.isArray(value)) {
        out.push(...value.filter((item) => typeof item === "string"));
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          out.push(...collectPathArgs(item, depth + 1));
        }
      }
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !["context", "metadata"].includes(normalizedKey)
    ) {
      out.push(...collectPathArgs(value, depth + 1));
    }
  }
  return out;
}

function toolLeaf(tool) {
  const parts = String(tool || "")
    .toLowerCase()
    .split(/__|[.:/]/)
    .filter(Boolean);
  return parts[parts.length - 1] || "";
}

function isMutatingPathTool(tool) {
  return MUTATING_PATH_TOOLS.has(toolLeaf(tool));
}

function collectPatchTargets(args) {
  const targets = [];
  for (const patch of [args?.patch, args?.input]) {
    if (typeof patch !== "string") continue;
    const header =
      /^\*{3} (?:Add File|Delete File|Move to|Update File):\s*(.+?)\s*$/gm;
    let match;
    while ((match = header.exec(patch))) {
      targets.push(unwrapQuoted(match[1]));
    }
  }
  return targets;
}

function redirectTargets(command) {
  const raw = String(command || "");
  const targets = [];
  let quote = "";
  let escaping = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch !== ">") continue;

    while (raw[i + 1] === ">") i += 1;
    let cursor = i + 1;
    while (/\s/.test(raw[cursor] || "")) cursor += 1;
    const first = raw[cursor];
    if (!first || first === "&" || first === "(") continue;
    let target = "";
    if (first === "'" || first === '"') {
      const targetQuote = first;
      cursor += 1;
      while (cursor < raw.length && raw[cursor] !== targetQuote) {
        target += raw[cursor];
        cursor += 1;
      }
    } else {
      while (cursor < raw.length && !/[\s;&|]/.test(raw[cursor])) {
        target += raw[cursor];
        cursor += 1;
      }
    }
    if (target) targets.push(target);
  }
  return targets;
}

function optionValue(tokens, names) {
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  for (let i = 1; i < tokens.length; i += 1) {
    const token = String(tokens[i] || "");
    const lower = token.toLowerCase();
    const equals = lower.indexOf("=");
    const name = equals >= 0 ? lower.slice(0, equals) : lower;
    if (normalizedNames.has(name)) {
      if (equals >= 0) return token.slice(equals + 1);
      return tokens[i + 1] || "";
    }
    for (const option of normalizedNames) {
      if (
        option.length === 2 &&
        lower.startsWith(option) &&
        lower.length > option.length
      ) {
        return token.slice(option.length).replace(/^=/, "");
      }
    }
  }
  return "";
}

function powershellPositionalArgs(tokens, optionsWithValues) {
  const valued = new Set(
    optionsWithValues.map((option) => option.toLowerCase()),
  );
  const positional = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const raw = String(tokens[index] || "");
    const lower = raw.toLowerCase();
    const colon = lower.indexOf(":");
    const name = colon >= 0 ? lower.slice(0, colon) : lower;
    if (valued.has(name)) {
      if (colon < 0) index += 1;
      continue;
    }
    if (raw.startsWith("-")) continue;
    positional.push(raw);
  }
  return positional;
}

function shellWriteTargets(command) {
  const out = [];
  const raw = String(command || "");
  out.push(...redirectTargets(raw));

  for (const segment of collectCommandSegments(raw)) {
    const tokens = executableTokens(segment);
    const first = executableBase(tokens[0]);
    if (["cp", "copy", "install", "move", "mv", "tee"].includes(first)) {
      const targetDirectory = ["cp", "install", "mv"].includes(first)
        ? optionValue(tokens, ["-t", "--target-directory"])
        : "";
      if (targetDirectory) {
        out.push(targetDirectory);
      } else {
        const candidates = tokens
          .slice(1)
          .filter((token) => !token.startsWith("-"));
        if (candidates.length) out.push(candidates[candidates.length - 1]);
      }
    }
    if (["add-content", "out-file", "set-content"].includes(first)) {
      const target =
        optionValue(tokens, ["-filePath", "-literalPath", "-path"]) ||
        (tokens[1] && !String(tokens[1]).startsWith("-") ? tokens[1] : "");
      if (target) out.push(target);
    }
    if (["copy-item", "move-item"].includes(first)) {
      const positional = powershellPositionalArgs(tokens, [
        "-credential",
        "-destination",
        "-erroraction",
        "-errorvariable",
        "-exclude",
        "-filter",
        "-include",
        "-informationaction",
        "-informationvariable",
        "-literalpath",
        "-outbuffer",
        "-outvariable",
        "-path",
        "-pipelinevariable",
        "-progressaction",
        "-warningaction",
        "-warningvariable",
      ]);
      const namedSource = optionValue(tokens, ["-literalPath", "-path"]);
      const target =
        optionValue(tokens, ["-destination"]) ||
        (namedSource
          ? positional[0] || ""
          : positional.length >= 2
            ? positional[1]
            : "");
      if (target) out.push(target);
    }
    if (first === "dd") {
      for (const token of tokens.slice(1)) {
        const match = String(token).match(/^of=(.+)$/i);
        if (match) out.push(match[1]);
      }
    }
    if (
      first === "touch" ||
      (first === "sed" &&
        tokens
          .slice(1)
          .some((token) => /^-(?:i|-[i]n-place)(?:[.=].*)?$/i.test(token)))
    ) {
      const candidates = tokens
        .slice(1)
        .filter((token) => !String(token).startsWith("-"));
      if (candidates.length) out.push(candidates[candidates.length - 1]);
    }
  }
  return out;
}

function hasSensitivePath(command) {
  const tokens = String(command || "")
    .replace(/["'|;&(),]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return tokens.some((token) => credentialFileReason(token));
}

function referencesSecretEnvironment(command) {
  const raw = String(command || "");
  const patterns = [
    /\$env:([A-Za-z_][A-Za-z0-9_]*)/gi,
    /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)(?:(?::?[-+?])[^}]*)?\}/gi,
    /\$([A-Za-z_][A-Za-z0-9_]*)/g,
    /%([A-Za-z_][A-Za-z0-9_]*)(?::[^%]*)?%/g,
    /!([A-Za-z_][A-Za-z0-9_]*)!/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(raw))) {
      if (isSecretEnvName(match[1])) return true;
    }
  }
  return false;
}

function tokenContainsSecretReference(token) {
  const raw = String(token || "");
  return referencesSecretEnvironment(raw) || containsSecret(raw);
}

function curlHasEgressSink(tokens) {
  for (const token of tokens.slice(1)) {
    const raw = String(token || "");
    const lower = raw.toLowerCase();
    if (
      raw === "-F" ||
      raw.startsWith("-F") ||
      raw === "-H" ||
      raw.startsWith("-H") ||
      raw === "-T" ||
      raw.startsWith("-T") ||
      raw === "-u" ||
      raw.startsWith("-u") ||
      raw === "-d" ||
      /^-d.+/.test(raw) ||
      [
        "--cookie",
        "--data",
        "--data-ascii",
        "--data-binary",
        "--data-raw",
        "--data-urlencode",
        "--form",
        "--form-string",
        "--header",
        "--json",
        "--oauth2-bearer",
        "--proxy-header",
        "--upload-file",
        "--url-query",
        "--user",
      ].some((option) => lower === option || lower.startsWith(`${option}=`))
    ) {
      return true;
    }
    if (/^https?:\/\//i.test(raw) && tokenContainsSecretReference(raw)) {
      return true;
    }
  }
  return false;
}

function commandHasEgressSink(segments) {
  for (const segment of segments) {
    if (isOutputOnlyCommand(segment)) continue;
    const tokens = executableTokens(segment);
    const first = executableBase(tokens[0]);
    const lowerTokens = tokens.map((token) => String(token).toLowerCase());
    if (first === "curl" && curlHasEgressSink(tokens)) return true;
    if (
      first === "wget" &&
      lowerTokens.some(
        (token) =>
          [
            "--header",
            "--password",
            "--post-data",
            "--post-file",
            "--user",
          ].some(
            (option) => token === option || token.startsWith(`${option}=`),
          ) || token === "--method=post",
      )
    ) {
      return true;
    }
    if (
      first === "wget" &&
      tokens
        .slice(1)
        .some(
          (token) =>
            /^https?:\/\//i.test(token) && tokenContainsSecretReference(token),
        )
    ) {
      return true;
    }
    if (
      ["invoke-restmethod", "invoke-webrequest", "irm", "iwr"].includes(
        first,
      ) &&
      lowerTokens.some(
        (token, index) =>
          [
            "-authentication",
            "-body",
            "-headers",
            "-infile",
            "-token",
          ].includes(token) ||
          (token === "-method" &&
            String(lowerTokens[index + 1] || "") === "post") ||
          token === "-method=post",
      )
    ) {
      return true;
    }
    if (["nc", "ncat", "netcat", "socat"].includes(first)) return true;
    if (
      ["scp", "sftp", "rsync"].includes(first) &&
      tokens.slice(1).some((token) => /\b[\w.-]+@[\w.-]+:/i.test(token))
    ) {
      return true;
    }
    if (
      first === "gh" &&
      lowerTokens[1] === "gist" &&
      lowerTokens[2] === "create"
    ) {
      return true;
    }
    if (
      first === "aws" &&
      lowerTokens[1] === "s3" &&
      lowerTokens[2] === "cp" &&
      lowerTokens.some((token) => token.startsWith("s3://"))
    ) {
      return true;
    }
    if (first === "git") {
      const git = parseGitInvocation(segment);
      if (
        git?.subcommand === "push" &&
        git.args.some(
          (arg) =>
            /^https?:\/\//i.test(arg) && tokenContainsSecretReference(arg),
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function toolHasEgressSink(tool, context = {}) {
  if (context.externalSideEffect === true) return true;
  return /(?:webhook|send[_-]?(?:email|message|mail)|http[_-]?request|upload|post[_-]?message)/i.test(
    String(tool || ""),
  );
}

function isOutputOnlyCommand(segment) {
  const first = executableBase(executableTokens(segment)[0]);
  return [
    "echo",
    "findstr",
    "grep",
    "printf",
    "rg",
    "select-string",
    "type",
    "write-host",
    "write-output",
  ].includes(first);
}

function isProductionMarker(text) {
  return /(?:^|[\s:/_.="'-])(?:prod|production)(?:$|[\s:/_.="'-])/i.test(
    String(text || ""),
  );
}

function isNonProductionMarker(text) {
  return /(?:^|[\s:/_.="'-])(?:dev|development|local|preview|qa|sandbox|stage|staging|test|testing)(?:$|[\s:/_.="'-])/i.test(
    String(text || ""),
  );
}

function hasExplicitNonProductionTarget(tokens) {
  const targetFlags = new Set([
    "-a",
    "-c",
    "--app",
    "--config",
    "--env",
    "--environment",
    "--project",
    "--stage",
    "-p",
  ]);
  for (let i = 1; i < tokens.length; i += 1) {
    const raw = String(tokens[i] || "");
    const lower = raw.toLowerCase();
    const equals = lower.indexOf("=");
    const name = equals >= 0 ? lower.slice(0, equals) : lower;
    if (!targetFlags.has(name)) continue;
    const value = equals >= 0 ? raw.slice(equals + 1) : tokens[i + 1];
    if (isNonProductionMarker(value)) return true;
  }
  return false;
}

function isProductionDeploySegment(segment) {
  if (isOutputOnlyCommand(segment)) return false;
  const raw = String(segment || "");
  const lower = raw.toLowerCase();
  const tokens = executableTokens(raw);
  const semanticTokens = tokens.map(canonicalShellKeyword);
  const semanticLower = semanticTokens.join(" ").toLowerCase();
  const first = executableBase(tokens[0]);
  const prod =
    isProductionMarker(lower) ||
    semanticTokens.some(isProductionMarker) ||
    /--prod(?:uction)?\b/i.test(semanticLower);
  if (["helm", "kubectl"].includes(first) && tokens.some(isDryRunArg)) {
    return false;
  }

  if (
    first === "kubectl" &&
    /\b(?:apply|create|delete|patch|replace|rollout|set|scale)\b/i.test(
      semanticLower,
    )
  ) {
    return prod;
  }
  if (
    first === "helm" &&
    /\b(?:install|upgrade|uninstall|rollback)\b/i.test(semanticLower)
  ) {
    return prod;
  }
  if (["vercel", "netlify"].includes(first)) {
    return /\bdeploy\b/i.test(semanticLower)
      ? prod
      : /--prod\b/i.test(semanticLower);
  }
  if (
    first === "firebase" &&
    semanticTokens
      .slice(1)
      .some((token) => String(token).toLowerCase() === "deploy")
  ) {
    return prod || !hasExplicitNonProductionTarget(tokens);
  }
  if (first === "fly" && /\bdeploy\b/i.test(semanticLower)) {
    return prod || !hasExplicitNonProductionTarget(tokens);
  }
  if (
    first === "gcloud" &&
    /\b(?:app|run)\b[\s\S]*\bdeploy\b/i.test(semanticLower)
  ) {
    return prod;
  }
  if (
    ["npm", "pnpm", "yarn", "bun"].includes(first) &&
    semanticTokens
      .slice(1)
      .some((token) => /^deploy(?::|-)?(?:prod|production)?$/i.test(token)) &&
    prod
  ) {
    return true;
  }
  if (/(?:^|[\\/])deploy\.(?:ps1|sh|cmd|bat)\b/i.test(lower)) {
    return prod;
  }
  return /\bdeploy\b/i.test(first) && prod;
}

function valueContainsProductionMarker(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") return isProductionMarker(value);
  if (!value || typeof value !== "object" || depth > 4) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const values = Array.isArray(value) ? value : Object.values(value);
  const found = values.some((item) =>
    valueContainsProductionMarker(item, depth + 1, seen),
  );
  seen.delete(value);
  return found;
}

function isStructuredProductionDeployment(tool, args, context = {}) {
  if (typeof args?.command === "string" || Array.isArray(args?.argv)) {
    return false;
  }
  if (args.dryRun === true || args.dry_run === true) return false;
  const key = String(tool || "").toLowerCase();
  const leaf = toolLeaf(key);
  const providerSurface =
    /(?:kubernetes|k8s|helm|firebase|vercel|netlify|gcloud|cloud[_-]?run|fly)/i.test(
      key,
    );
  const deploymentSurface =
    context.actionType === "deployment" ||
    /deploy/.test(leaf) ||
    (providerSurface &&
      /(?:apply|create|delete|install|patch|replace|rollout|scale|set|upgrade)/.test(
        leaf,
      ));
  const productionTarget =
    valueContainsProductionMarker(args) ||
    isProductionMarker(context.targetEnvironment) ||
    isProductionMarker(context.environment);
  return deploymentSurface && productionTarget;
}

function parseGitInvocation(segment) {
  const tokens = executableTokens(segment).map(canonicalShellKeyword);
  if (executableBase(tokens[0]) !== "git") return null;
  let i = 1;
  while (i < tokens.length) {
    const token = String(tokens[i] || "");
    const lower = token.toLowerCase();
    if (["-c", "--config-env", "--git-dir", "--work-tree"].includes(lower)) {
      i += 2;
      continue;
    }
    if (
      lower.startsWith("--git-dir=") ||
      lower.startsWith("--work-tree=") ||
      lower.startsWith("-c=")
    ) {
      i += 1;
      continue;
    }
    if (token.startsWith("-")) {
      i += 1;
      continue;
    }
    break;
  }
  if (i >= tokens.length) return null;
  return {
    subcommand: String(tokens[i]).toLowerCase(),
    args: tokens.slice(i + 1).map(String),
  };
}

function isDryRunArg(arg) {
  const lower = String(arg || "").toLowerCase();
  return (
    lower === "--dry-run" || /^--dry-run=(?:client|server|true)$/.test(lower)
  );
}

function hasUnboundedForceWithLease(args) {
  const leasePrefix = "--force-with-lease";
  for (let i = 0; i < args.length; i += 1) {
    const raw = String(args[i] || "");
    const lower = raw.toLowerCase();
    if (lower === leasePrefix) {
      const next = String(args[i + 1] || "");
      if (!/^[^:\s]+:[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(next)) {
        return true;
      }
      i += 1;
      continue;
    }
    if (lower.startsWith(`${leasePrefix}=`)) {
      const lease = raw.slice(leasePrefix.length + 1);
      if (!/^[^:\s]+:[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(lease)) {
        return true;
      }
    }
  }
  return false;
}

function isForcePushSegment(segment) {
  if (isOutputOnlyCommand(segment)) return false;
  const git = parseGitInvocation(segment);
  if (!git || git.subcommand !== "push") return false;
  const lowerArgs = git.args.map((arg) => arg.toLowerCase());
  if (lowerArgs.some(isDryRunArg)) return false;
  if (
    lowerArgs.includes("--force") ||
    lowerArgs.includes("--mirror") ||
    lowerArgs.some((arg) => /^-[^-]*f/.test(arg))
  ) {
    return true;
  }
  if (hasUnboundedForceWithLease(git.args)) return true;
  return git.args.some((arg) => /^\+.+/.test(arg));
}

function protectedRefName(ref) {
  const raw = String(ref || "").replace(/^\+/, "");
  const colon = raw.lastIndexOf(":");
  const destination = colon >= 0 ? raw.slice(colon + 1) : raw;
  return destination.replace(/^refs\/heads\//i, "");
}

function isProtectedPushSegment(segment) {
  const git = parseGitInvocation(segment);
  if (!git || git.subcommand !== "push") return false;
  if (git.args.some(isDryRunArg)) return false;
  return git.args.some((arg) =>
    /^(?:main|master|develop|production|prod)$/i.test(protectedRefName(arg)),
  );
}

function mergeHasTrustedReview(context = {}) {
  const reviewedCommitSha = String(context.reviewedCommitSha || "")
    .trim()
    .toLowerCase();
  const headCommitSha = String(context.headCommitSha || "")
    .trim()
    .toLowerCase();
  return (
    context.reviewApproved === true &&
    context.requiredChecksPassed === true &&
    Object.hasOwn(context, "pendingApprovals") &&
    Number.isInteger(context.pendingApprovals) &&
    context.pendingApprovals === 0 &&
    /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(reviewedCommitSha) &&
    reviewedCommitSha === headCommitSha
  );
}

function hasHelpArg(tokens) {
  for (const token of tokens.slice(1)) {
    const raw = String(token || "");
    if (raw === "--") return false;
    if (raw === "-h" || ["--help", "-help", "/?"].includes(raw.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function hasVersionArg(tokens) {
  for (const token of tokens.slice(1)) {
    const raw = String(token || "");
    if (raw === "--") return false;
    if (["--version", "-version"].includes(raw.toLowerCase())) return true;
  }
  return false;
}

function ghCommandArgs(tokens) {
  const args = tokens.slice(1);
  const optionsWithValues = new Set(["-r", "--hostname", "--repo"]);
  let index = 0;
  while (index < args.length) {
    const raw = String(args[index] || "");
    const lower = raw.toLowerCase();
    if (raw === "--") return args.slice(index + 1);
    if (!raw.startsWith("-")) break;
    const name = lower.split("=", 1)[0];
    if (optionsWithValues.has(name) && !raw.includes("=")) {
      index += 2;
    } else {
      index += 1;
    }
  }
  return args.slice(index);
}

function isGhApiMerge(args) {
  if (String(args[0] || "").toLowerCase() !== "api") return false;
  const optionsWithValues = new Set([
    "--cache",
    "-f",
    "-h",
    "-p",
    "-q",
    "-t",
    "--field",
    "--header",
    "--hostname",
    "--input",
    "--jq",
    "--preview",
    "--raw-field",
    "--template",
  ]);
  const shortOptionsWithValues = [...optionsWithValues].filter(
    (option) => option.length === 2,
  );
  const mergeEndpointPattern = /(?:^|\/)pulls\/[^/]+\/merge(?:$|[?#])/i;
  let method = "get";
  let mergeEndpoint = false;
  let positionalOnly = false;
  for (let index = 1; index < args.length; index += 1) {
    const raw = String(args[index] || "");
    const lower = raw.toLowerCase();
    if (!positionalOnly && raw === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && ["-x", "--method"].includes(lower)) {
      method = String(args[index + 1] || "").toLowerCase();
      index += 1;
      continue;
    }
    if (!positionalOnly && lower.startsWith("--method=")) {
      method = lower.slice("--method=".length);
      continue;
    }
    if (!positionalOnly && lower.startsWith("-x") && lower.length > 2) {
      method = lower.slice(2);
      continue;
    }
    const equals = lower.indexOf("=");
    const optionName = equals >= 0 ? lower.slice(0, equals) : lower;
    if (!positionalOnly && optionsWithValues.has(optionName)) {
      if (equals < 0) index += 1;
      continue;
    }
    if (
      !positionalOnly &&
      shortOptionsWithValues.some(
        (option) => lower.startsWith(option) && lower.length > option.length,
      )
    ) {
      continue;
    }
    if (!positionalOnly && raw.startsWith("-")) {
      continue;
    }
    if (mergeEndpointPattern.test(raw)) {
      mergeEndpoint = true;
    }
  }
  return method === "put" && mergeEndpoint;
}

function isRemoteMergeSegment(segment) {
  if (isOutputOnlyCommand(segment)) return false;
  const tokens = executableTokens(segment).map(canonicalShellKeyword);
  if (hasHelpArg(tokens)) return false;
  const first = executableBase(tokens[0]);
  const args = first === "gh" ? ghCommandArgs(tokens) : tokens.slice(1);
  const lower = args.map((token) => String(token).toLowerCase());
  if (first === "gh") {
    return (lower[0] === "pr" && lower[1] === "merge") || isGhApiMerge(args);
  }
  if (first === "glab") {
    return lower[0] === "mr" && lower[1] === "merge";
  }
  if (first === "az") {
    const status = lower.findIndex((token) => token === "--status");
    return (
      lower[0] === "repos" &&
      lower[1] === "pr" &&
      lower[2] === "update" &&
      status >= 0 &&
      ["completed", "merged"].includes(lower[status + 1])
    );
  }
  return false;
}

function isStructuredMergeTool(tool, args = {}) {
  if (
    args.preview === true ||
    args.dryRun === true ||
    args.dry_run === true ||
    args.readOnly === true
  ) {
    return false;
  }
  const key = String(tool || "").toLowerCase();
  const words = key.split(/__|[_:.\-/]/).filter(Boolean);
  if (
    words.some((word) =>
      ["check", "get", "inspect", "list", "preview", "read", "status"].includes(
        word,
      ),
    )
  ) {
    return false;
  }
  return /(?:^|[_:.])merge[_-]?(?:pull[_-]?request|pr|merge[_-]?request|mr)(?:$|[_:.])/i.test(
    key,
  );
}

function isRemoteMergeCommand(command, tool, args, context) {
  if (mergeHasTrustedReview(context)) return false;
  if (isStructuredMergeTool(tool, args)) return true;
  const segments = collectCommandSegments(command);
  if (segments.some(isRemoteMergeSegment)) return true;
  const hasLocalMerge = segments.some((segment) => {
    const git = parseGitInvocation(segment);
    return git?.subcommand === "merge";
  });
  return hasLocalMerge && segments.some(isProtectedPushSegment);
}

function isStructuredForcePush(tool, args = {}) {
  if (!/(?:^|[_:.])push(?:[_:.]|$)/i.test(String(tool || ""))) return false;
  if (args.dryRun === true || args.dry_run === true) return false;
  if (args.force === true || args.mirror === true) return true;
  const refspecs = [
    args.ref,
    args.refspec,
    ...(Array.isArray(args.refspecs) ? args.refspecs : []),
  ];
  if (refspecs.some((ref) => /^\+.+/.test(String(ref || "")))) return true;
  const lease = args.forceWithLease ?? args.force_with_lease;
  if (lease == null || lease === false) return false;
  return !/^[^:\s]+:[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(String(lease));
}

function isAgentInvocation(segment) {
  if (isOutputOnlyCommand(segment)) return false;
  const tokens = executableTokens(segment);
  const first = executableBase(tokens[0]);
  if (AGENT_BINARIES.has(first)) return true;
  if (["npx", "pnpx", "bunx", "uvx"].includes(first)) {
    return tokens.slice(1).some((token) => {
      const base = executableBase(token);
      return (
        AGENT_BINARIES.has(base) ||
        /(?:claude-code|openai-codex|aider-chat)/i.test(String(token))
      );
    });
  }
  return false;
}

function isUnsafeAgentCommand(segment) {
  if (!isAgentInvocation(segment)) return false;
  const tokens = executableTokens(segment);
  if (hasHelpArg(tokens) || hasVersionArg(tokens)) return false;
  const raw = tokens.map(canonicalShellKeyword).join(" ");
  const lowerTokens = tokens.map((token) =>
    canonicalShellKeyword(token).toLowerCase(),
  );
  const approvalIndex = lowerTokens.findIndex((token) => token === "-a");
  const sandboxIndex = lowerTokens.findIndex((token) => token === "-s");
  const unsafeAliases =
    approvalIndex >= 0 &&
    lowerTokens[approvalIndex + 1] === "never" &&
    sandboxIndex >= 0 &&
    ["danger-full-access", "host", "none"].includes(
      lowerTokens[sandboxIndex + 1],
    );
  return (
    unsafeAliases ||
    /--dangerously-(?:skip-permissions|bypass-approvals-and-sandbox)\b/i.test(
      raw,
    ) ||
    /--sandbox(?:=|\s+)danger-full-access\b/i.test(raw) ||
    /--yolo\b/i.test(raw) ||
    /--yes-always\b/i.test(raw) ||
    (/--ask-for-approval(?:=|\s+)never\b/i.test(raw) &&
      /--sandbox(?:=|\s+)(?:danger-full-access|none|host)\b/i.test(raw))
  );
}

function isStructuredUnisolatedAgent(tool, context = {}, args = {}) {
  const agentOrigin = String(context.agentOrigin || "")
    .toLowerCase()
    .replace(/_/g, "-");
  const thirdParty =
    context.thirdParty === true ||
    agentOrigin === "third-party" ||
    args.thirdParty === true ||
    ["external", "third-party", "third_party"].includes(
      String(args.provider || "").toLowerCase(),
    );
  const agentSurface =
    /(?:agent|delegate|subagent|sub_agent)/i.test(String(tool || "")) ||
    context.actionType === "agent";
  if (!thirdParty || !agentSurface) return false;

  const isolation = String(context.isolation || args.isolation || "")
    .trim()
    .toLowerCase();
  const explicitlyHost =
    context.sandboxed === false ||
    args.sandboxed === false ||
    ["host", "none", "unisolated"].includes(isolation);
  const hasBoundaryEvidence =
    (context.processSandboxed === true || args.processSandboxed === true) &&
    (context.networkIsolated === true || args.networkIsolated === true) &&
    (context.credentialsIsolated === true ||
      args.credentialsIsolated === true) &&
    (context.approvalsRequired === true || args.approvalsRequired === true);
  return explicitlyHost || !hasBoundaryEvidence;
}

function isDestructiveSegment(segment) {
  if (isOutputOnlyCommand(segment)) return false;
  const tokens = executableTokens(segment);
  const first = executableBase(tokens[0]);
  if (first === "find") {
    return (
      !["--help", "-help"].includes(String(tokens[1] || "").toLowerCase()) &&
      tokens.slice(1).includes("-delete")
    );
  }
  if (hasHelpArg(tokens)) return false;
  if (DESTRUCTIVE_COMMANDS.has(first) || first.startsWith("mkfs.")) {
    return true;
  }
  return (
    first === "dd" &&
    tokens.some((token) => /\bof=(?:\/dev\/|\\\\\.\\)/i.test(token))
  );
}

function isInfrastructureDestructive(segment) {
  if (isOutputOnlyCommand(segment)) return false;
  const tokens = executableTokens(segment);
  if (hasHelpArg(tokens)) return false;
  const first = executableBase(tokens[0]);
  const lowerTokens = tokens.map((token) =>
    canonicalShellKeyword(token).toLowerCase(),
  );
  if (["terraform", "terragrunt"].includes(first)) {
    let operation = "";
    for (let i = 1; i < lowerTokens.length; i += 1) {
      const token = lowerTokens[i];
      if (token === "-chdir" && i + 1 < lowerTokens.length) {
        i += 1;
        continue;
      }
      if (token.startsWith("-")) continue;
      operation = token;
      break;
    }
    if (operation === "destroy") return true;
    if (
      operation === "apply" &&
      lowerTokens.some((token) => ["-destroy", "--destroy"].includes(token))
    ) {
      return true;
    }
    if (
      first === "terragrunt" &&
      ["run-all", "run"].includes(operation) &&
      lowerTokens.includes("destroy")
    ) {
      return true;
    }
  }
  if (
    ["pulumi", "cdk", "cdklocal"].includes(first) &&
    lowerTokens.slice(1).includes("destroy")
  ) {
    return true;
  }
  return (
    first === "kubectl" &&
    lowerTokens.some(
      (token, index) =>
        token === "delete" &&
        ["clusterrole", "crd", "namespace", "ns"].includes(
          lowerTokens[index + 1],
        ),
    )
  );
}

function isPowerShellEncoded(segment) {
  const tokens = executableTokens(segment);
  const first = executableBase(tokens[0]);
  return (
    ["powershell", "pwsh"].includes(first) &&
    tokens.some((token) =>
      [
        "-e",
        "-ec",
        "-en",
        "-enc",
        "-enco",
        "-encod",
        "-encode",
        "-encoded",
        "-encodedcommand",
      ].includes(String(token).toLowerCase()),
    )
  );
}

function mayContainRemoteExec(command) {
  const raw = String(command || "");
  if (
    !raw.includes("|") &&
    !raw.includes("$(") &&
    !raw.includes("<(") &&
    !/\b(?:iex|invoke-expression)\s*\(/i.test(raw)
  ) {
    return false;
  }
  return (
    /\b(?:curl|fetch|http|httpie|invoke-restmethod|invoke-webrequest|irm|iwr|wget)\b/i.test(
      raw,
    ) &&
    /\b(?:bash|dash|deno|eval|fish|iex|invoke-expression|ksh|node|perl|powershell|pwsh|python[0-9.]*|ruby|sh|source|zsh)\b/i.test(
      raw,
    )
  );
}

function splitCommandPipelines(command) {
  const raw = String(command || "");
  const pipelines = [];
  let pipeline = [];
  let start = 0;
  let quote = "";
  let escaping = false;

  const pushStage = (end) => {
    const stage = raw.slice(start, end).trim();
    if (stage) pipeline.push(stage);
  };
  const pushPipeline = () => {
    if (pipeline.length > 1) pipelines.push(pipeline);
    pipeline = [];
  };

  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    const doubled = index + 1 < raw.length && raw[index + 1] === ch;
    if (ch === "|" && !doubled && raw[index - 1] !== "|") {
      pushStage(index);
      start = index + 1;
      continue;
    }
    if (
      ch === "\r" ||
      ch === "\n" ||
      ch === ";" ||
      ch === "&" ||
      (ch === "|" && doubled)
    ) {
      pushStage(index);
      pushPipeline();
      if (doubled) index += 1;
      start = index + 1;
    }
  }
  pushStage(raw.length);
  pushPipeline();
  return pipelines;
}

function isRemoteFetcherStage(stage) {
  return [
    "curl",
    "fetch",
    "http",
    "httpie",
    "invoke-restmethod",
    "invoke-webrequest",
    "irm",
    "iwr",
    "wget",
  ].includes(executableBase(executableTokens(stage)[0]));
}

function isDecodePassThroughStage(stage) {
  const tokens = executableTokens(stage);
  const first = executableBase(tokens[0]);
  if (["cat", "tee", "tr"].includes(first)) return true;
  if (
    first === "gzip" &&
    tokens
      .slice(1)
      .some((token) =>
        ["-d", "--decompress"].includes(String(token).toLowerCase()),
      )
  ) {
    return true;
  }
  return (
    first === "base64" &&
    tokens
      .slice(1)
      .some((token) => ["-d", "--decode"].includes(String(token).toLowerCase()))
  );
}

function isExecutingInterpreterStage(stage) {
  const tokens = executableTokens(stage);
  const first = executableBase(tokens[0]);
  if (["iex", "invoke-expression"].includes(first)) return true;
  if (["bash", "dash", "fish", "ksh", "sh", "zsh"].includes(first)) {
    return !tokens
      .slice(1)
      .some((token) =>
        ["-n", "--noexec"].includes(String(token).toLowerCase()),
      );
  }
  return [
    "deno",
    "eval",
    "node",
    "perl",
    "powershell",
    "pwsh",
    "python",
    "python3",
    "ruby",
    "source",
  ].includes(first);
}

function commandBodies(command, depth = 0) {
  const raw = String(command || "");
  const bodies = [raw];
  if (depth >= 3) return bodies;
  for (const segment of splitSafetyCommandSegments(raw)) {
    const inner = unwrapShellCommand(segment);
    if (inner && inner !== segment) {
      bodies.push(...commandBodies(inner, depth + 1));
    }
  }
  return [...new Set(bodies)];
}

function isRemoteExec(command, segments) {
  if (segments.length === 1 && isOutputOnlyCommand(segments[0])) {
    return false;
  }
  for (const body of commandBodies(command)) {
    if (!mayContainRemoteExec(body)) continue;
    if (
      /\b(?:iex|invoke-expression)\s*\(\s*(?:invoke-restmethod|invoke-webrequest|irm|iwr)\b/i.test(
        body,
      )
    ) {
      return true;
    }
    for (const pipeline of splitCommandPipelines(body)) {
      const fetcher = pipeline.findIndex(isRemoteFetcherStage);
      if (fetcher < 0) continue;
      let index = fetcher + 1;
      while (
        index < pipeline.length &&
        isDecodePassThroughStage(pipeline[index])
      ) {
        index += 1;
      }
      if (
        index < pipeline.length &&
        isExecutingInterpreterStage(pipeline[index])
      ) {
        return true;
      }
    }
    if (
      (body.includes("$(") || body.includes("<(")) &&
      classifyRemoteExecCommand(body).isRemoteExec
    ) {
      return true;
    }
  }
  return false;
}

function isPublicationSegment(segment) {
  if (isOutputOnlyCommand(segment)) return false;
  const tokens = executableTokens(segment);
  if (tokens.some(isDryRunArg) || hasHelpArg(tokens)) return false;
  const first = executableBase(tokens[0]);
  const second = canonicalShellKeyword(tokens[1]).toLowerCase();
  const third = canonicalShellKeyword(tokens[2]).toLowerCase();
  return (
    (["npm", "pnpm", "yarn", "bun", "cargo"].includes(first) &&
      second === "publish") ||
    (first === "yarn" && second === "npm" && third === "publish") ||
    (/^(?:py|python[0-9.]*)$/.test(first) &&
      second === "-m" &&
      third === "twine" &&
      canonicalShellKeyword(tokens[3]).toLowerCase() === "upload") ||
    (first === "twine" && second === "upload") ||
    (first === "docker" && second === "push") ||
    (first === "gh" && second === "release" && third === "create")
  );
}

function makeSignal(reasonCode, category, severity, reason) {
  return Object.freeze({
    reasonCode,
    category,
    riskLevel: "high",
    severity,
    reason,
  });
}

/**
 * Classify one proposed tool action. The result is pure and log-safe.
 *
 * @param {{tool?:string,args?:object,baseRiskLevel?:string,context?:object}} input
 * @returns {object}
 */
export function classifyAutoModeSafety(input = {}) {
  const tool = String(input.tool || "unknown").trim() || "unknown";
  const toolKey = tool.toLowerCase();
  const args = input.args && typeof input.args === "object" ? input.args : {};
  const context =
    input.context && typeof input.context === "object" ? input.context : {};
  const command = inputCommand({ args });
  const segments = collectCommandSegments(command);
  const argsText = stableSerialize(args);
  const baseRiskLevel = normalizeRisk(input.baseRiskLevel, "medium");
  const signals = [];
  const seenCodes = new Set();

  const add = (reasonCode, category, severity, reason) => {
    if (seenCodes.has(reasonCode)) return;
    seenCodes.add(reasonCode);
    signals.push(makeSignal(reasonCode, category, severity, reason));
  };

  const roots = workspaceRoots(context);
  if (isMutatingPathTool(toolKey) && roots.length) {
    const pathTargets = collectPathArgs(args);
    if (toolLeaf(toolKey) === "apply_patch") {
      pathTargets.push(...collectPatchTargets(args));
    }
    const outside = pathTargets.some(
      (target) => !isPathWithinAnyRoot(target, roots, context),
    );
    if (outside) {
      add(
        "workspace.scope_escape",
        SAFETY_CATEGORY.WORKSPACE_SCOPE_ESCAPE,
        "critical",
        "A mutating file tool targets a path outside the declared workspace roots.",
      );
    }
  }
  if (toolKey === "run_shell" && roots.length) {
    const outside = shellWriteTargets(command).some(
      (target) => !isPathWithinAnyRoot(target, roots, context),
    );
    if (outside) {
      add(
        "workspace.scope_escape.shell_write",
        SAFETY_CATEGORY.WORKSPACE_SCOPE_ESCAPE,
        "critical",
        "A shell write target resolves outside the declared workspace roots.",
      );
    }
  }

  const credentialRead =
    Boolean(commandReadsCredentials(command)) ||
    segments.some((segment) => Boolean(commandReadsCredentials(segment))) ||
    hasSensitivePath(command) ||
    referencesSecretEnvironment(command) ||
    collectPathArgs(args).some((target) => credentialFileReason(target)) ||
    containsSecret(argsText);
  const egress =
    commandHasEgressSink(segments) || toolHasEgressSink(tool, context);
  if (credentialRead && egress) {
    add(
      "secret.egress",
      SAFETY_CATEGORY.SECRET_EGRESS,
      "critical",
      "A credential source or secret value is combined with an external egress sink.",
    );
  }

  if (
    segments.some(isProductionDeploySegment) ||
    isStructuredProductionDeployment(tool, args, context)
  ) {
    add(
      "deployment.production",
      SAFETY_CATEGORY.PRODUCTION_DEPLOYMENT,
      "critical",
      "The action deploys or mutates resources identified as production.",
    );
  }

  if (segments.some(isForcePushSegment) || isStructuredForcePush(tool, args)) {
    add(
      "git.force_push",
      SAFETY_CATEGORY.GIT_FORCE_PUSH,
      "high",
      "A force push can overwrite shared remote history.",
    );
  }

  if (isRemoteMergeCommand(command, tool, args, context)) {
    add(
      "merge.unreviewed",
      SAFETY_CATEGORY.UNREVIEWED_MERGE,
      "critical",
      "A remote merge lacks trusted proof of review, checks and settled approvals.",
    );
  }

  if (
    segments.some(isUnsafeAgentCommand) ||
    isStructuredUnisolatedAgent(tool, context, args)
  ) {
    add(
      "agent.third_party_unisolated",
      SAFETY_CATEGORY.THIRD_PARTY_AGENT_UNISOLATED,
      "critical",
      "A third-party agent is configured to run without effective isolation or approval checks.",
    );
  }

  if (segments.some(isDestructiveSegment)) {
    add(
      "filesystem.destructive",
      SAFETY_CATEGORY.FILESYSTEM_DESTRUCTIVE,
      "critical",
      "The command performs destructive filesystem or disk operations.",
    );
  }

  if (segments.some(isInfrastructureDestructive)) {
    add(
      "infrastructure.destructive",
      SAFETY_CATEGORY.INFRASTRUCTURE_DESTRUCTIVE,
      "critical",
      "The command destroys or irreversibly mutates shared infrastructure.",
    );
  }

  if (command && isRemoteExec(command, segments)) {
    add(
      "code.remote_exec",
      SAFETY_CATEGORY.REMOTE_CODE_EXECUTION,
      "critical",
      "Remote content is piped or substituted directly into an interpreter.",
    );
  }

  if (segments.some(isPowerShellEncoded)) {
    add(
      "shell.encoded_execution",
      SAFETY_CATEGORY.SHELL_ENCODED_EXECUTION,
      "high",
      "Encoded shell execution obscures the command that would run.",
    );
  }

  if (segments.some(isPublicationSegment)) {
    add(
      "artifact.publication",
      SAFETY_CATEGORY.PUBLICATION,
      "high",
      "The command publishes an artifact or release to a shared registry.",
    );
  }

  let riskLevel = baseRiskLevel;
  let severity = "none";
  for (const signal of signals) {
    riskLevel = maxRisk(riskLevel, signal.riskLevel);
    severity = maxSeverity(severity, signal.severity);
  }

  const categories = [...new Set(signals.map((signal) => signal.category))];
  return Object.freeze({
    schema: AUTO_MODE_SAFETY_CLASSIFICATION_SCHEMA,
    classifierVersion: AUTO_MODE_SAFETY_CLASSIFIER_VERSION,
    baseRiskLevel,
    riskLevel,
    severity,
    dangerous: signals.length > 0,
    escalated: RISK_RANK[riskLevel] > RISK_RANK[baseRiskLevel],
    categories: Object.freeze(categories),
    reasonCodes: Object.freeze(signals.map((signal) => signal.reasonCode)),
    signals: Object.freeze(signals),
  });
}

/**
 * Compose the classifier with the existing shell hard-policy and the default
 * Auto-mode risk mapping. The layers stay separate in the returned verdict.
 */
export function evaluateAutoModeSafety(input = {}, opts = {}) {
  const classifier =
    typeof opts.classifier === "function"
      ? opts.classifier
      : classifyAutoModeSafety;
  const classification = classifier(input);
  const tool = String(input?.tool || "unknown").toLowerCase();
  const command = inputCommand(input);
  let policy = null;
  if (tool === "run_shell") {
    const result = evaluateShellCommandPolicy(command, {
      classifyAllShell: input?.context?.classifyAllShell === true,
    });
    policy = {
      decision: result.decision,
      allowed: result.allowed,
      ruleId: result.ruleId,
      hardDenied: result.decision === "deny",
      reason: result.reason,
    };
  }

  const classifiedRisk = normalizeRisk(
    classification?.riskLevel,
    normalizeRisk(input?.baseRiskLevel, "medium"),
  );
  let effectiveDecision = classifiedRisk === "high" ? "ask" : "allow";
  if (policy?.decision === "deny") effectiveDecision = "deny";
  else if (policy?.decision === "reroute") effectiveDecision = "reroute";

  return Object.freeze({
    schema: AUTO_MODE_SAFETY_VERDICT_SCHEMA,
    classifierVersion:
      classification?.classifierVersion || AUTO_MODE_SAFETY_CLASSIFIER_VERSION,
    classification,
    policy: policy ? Object.freeze(policy) : null,
    effectiveDecision,
  });
}
