"use strict";

/**
 * Branded, shell-free process authority for reviewed bundled Skills.
 *
 * The trusted host supplies the actual ProcessExecutionBroker adapter. Skill
 * handlers can request only frozen executable/subcommand combinations, bounded
 * argv, approved working roots, and bounded synchronous output. The broker does
 * not import child_process and has no native execution fallback.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { logger } = require("../../../utils/logger.js");

const MAX_AUTHORITY_ID_LENGTH = 256;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_SINGLE_ARGUMENT_BYTES = 8 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_ENVIRONMENT_BYTES = 64 * 1024;
const MAX_ALLOWED_ROOTS = 16;
const MAX_ALLOWED_ENTRYPOINTS = 8;
const MAX_APPROVED_INVOCATIONS = 64;
const SAFE_REF_RE = /^[A-Za-z0-9._/#-]{1,200}$/;
const SAFE_GIT_RANGE_RE =
  /^[A-Za-z0-9._/-]{1,200}(?:\.\.[A-Za-z0-9._/-]{1,200})?$/;
const SAFE_GIT_REVISION_RE =
  /^[A-Za-z0-9._/#~^-]{1,200}(?:(?:\.\.|\.\.\.)[A-Za-z0-9._/#~^-]{1,200})?$/;
const SAFE_K8S_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;
const SAFE_NPM_PACKAGE_RE =
  /^(?:@[A-Za-z0-9._~-]{1,100}\/)?[A-Za-z0-9][A-Za-z0-9._~-]{0,212}$/;
const SKILL_CREATOR_ENVIRONMENT_KEYS = Object.freeze([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "HOME",
  "USERPROFILE",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "CHAINLESSCHAIN_QUIET",
]);

function exactArgs(args, expected) {
  return (
    args.length === expected.length &&
    args.every((value, index) => value === expected[index])
  );
}

function isSafeRef(value) {
  return SAFE_REF_RE.test(value);
}

function isSafeGitRange(value) {
  return SAFE_GIT_RANGE_RE.test(value);
}

function isSafeGitRevision(value) {
  return (
    typeof value === "string" &&
    !value.startsWith("-") &&
    SAFE_GIT_REVISION_RE.test(value)
  );
}

function isBoundedPositiveInteger(value, max = 1000) {
  return /^(?:[1-9]\d{0,3})$/.test(value) && Number(value) <= max;
}

function isSafeK8sName(value) {
  return SAFE_K8S_NAME_RE.test(value);
}

function isNpmExecutable(file) {
  return file === "npm" || file === "npm.cmd";
}

function isNpxExecutable(file) {
  return file === "npx" || file === "npx.cmd";
}

function isSafeNpmPackage(value) {
  return (
    typeof value === "string" &&
    !value.startsWith("-") &&
    SAFE_NPM_PACKAGE_RE.test(value)
  );
}

function isApprovedInvocation(file, args, policy) {
  return policy.approvedInvocations.some(
    (invocation) =>
      invocation.file === file && exactArgs(args, invocation.args),
  );
}

function parseShellFreeCommand(command) {
  if (typeof command !== "string" || command.includes("\0")) {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_COMMAND_INVALID",
      "A shell-free command string is required",
    );
  }
  const tokens = [];
  let token = "";
  let quote = null;
  let tokenStarted = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        token += char;
      }
      tokenStarted = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    token += char;
    tokenStarted = true;
  }
  if (quote) {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_COMMAND_INVALID",
      "Unterminated quotes are not allowed in process commands",
    );
  }
  if (tokenStarted) {
    tokens.push(token);
  }
  if (tokens.length === 0) {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_COMMAND_INVALID",
      "Process command cannot be empty",
    );
  }
  return Object.freeze({
    file: tokens[0],
    args: Object.freeze(tokens.slice(1)),
  });
}

function validateCreatePr(file, args) {
  if (file !== "git") {
    return false;
  }
  if (exactArgs(args, ["rev-parse", "--abbrev-ref", "HEAD"])) {
    return true;
  }
  if (exactArgs(args, ["diff", "--stat", "HEAD~1"])) {
    return true;
  }
  if (exactArgs(args, ["diff", "--stat", "--cached"])) {
    return true;
  }
  if (exactArgs(args, ["diff", "--cached", "--stat"])) {
    return true;
  }
  if (exactArgs(args, ["status", "--short"])) {
    return true;
  }
  if (exactArgs(args, ["log", "--oneline", "-10"])) {
    return true;
  }
  if (exactArgs(args, ["log", "--oneline", "-20"])) {
    return true;
  }
  return (
    args.length === 3 &&
    args[0] === "log" &&
    args[1] === "--oneline" &&
    isSafeGitRange(args[2])
  );
}

function validateGitWorktree(file, args) {
  if (file !== "git") {
    return false;
  }
  if (exactArgs(args, ["worktree", "list", "--porcelain"])) {
    return true;
  }
  if (exactArgs(args, ["worktree", "prune", "-v"])) {
    return true;
  }
  if (exactArgs(args, ["status", "--short"])) {
    return true;
  }
  if (
    args.length === 3 &&
    exactArgs(args.slice(0, 2), ["rev-parse", "--verify"])
  ) {
    return isSafeRef(args[2]);
  }
  if (args.length === 2 && args[0] === "branch") {
    return isSafeRef(args[1]);
  }
  if (args.length === 4 && exactArgs(args.slice(0, 2), ["worktree", "add"])) {
    return args[2].length > 0 && isSafeRef(args[3]);
  }
  return (
    args.length === 3 &&
    exactArgs(args.slice(0, 2), ["worktree", "remove"]) &&
    args[2].length > 0
  );
}

function validateK8s(file, args) {
  if (file !== "kubectl") {
    return false;
  }
  if (exactArgs(args, ["get", "deployments", "-o", "wide"])) {
    return true;
  }
  if (exactArgs(args, ["get", "pods", "-o", "wide"])) {
    return true;
  }
  if (
    args.length === 5 &&
    exactArgs(args.slice(0, 2), ["get", "deployment"]) &&
    isSafeK8sName(args[2]) &&
    exactArgs(args.slice(3), ["-o", "wide"])
  ) {
    return true;
  }
  if (
    args.length === 6 &&
    exactArgs(args.slice(0, 2), ["get", "pods"]) &&
    args[2] === "-l" &&
    args[3].startsWith("app=") &&
    isSafeK8sName(args[3].slice(4)) &&
    exactArgs(args.slice(4), ["-o", "wide"])
  ) {
    return true;
  }
  return (
    args.length === 3 &&
    args[0] === "rollout" &&
    ["restart", "undo", "status", "history"].includes(args[1]) &&
    args[2].startsWith("deployment/") &&
    isSafeK8sName(args[2].slice("deployment/".length))
  );
}

function validatePrReviewer(file, args) {
  if (file === "gh") {
    if (args.length === 3 && exactArgs(args.slice(0, 2), ["pr", "diff"])) {
      return isSafeRef(args[2]);
    }
    return (
      args.length === 5 &&
      exactArgs(args.slice(0, 2), ["pr", "view"]) &&
      isSafeRef(args[2]) &&
      exactArgs(args.slice(3), [
        "--json",
        "title,body,additions,deletions,files,author",
      ])
    );
  }
  if (file !== "git") {
    return false;
  }
  if (
    args.length === 3 &&
    args[0] === "log" &&
    args[1].endsWith("..HEAD") &&
    !args[1].endsWith("...HEAD") &&
    isSafeRef(args[1].slice(0, -"..HEAD".length)) &&
    args[2] === "--oneline"
  ) {
    return true;
  }
  return (
    (args.length === 2 || args.length === 3) &&
    args[0] === "diff" &&
    args[1].endsWith("...HEAD") &&
    isSafeRef(args[1].slice(0, -"...HEAD".length)) &&
    (args.length === 2 || ["--stat", "--shortstat"].includes(args[2]))
  );
}

function validateCcArgs(args) {
  if (exactArgs(args, ["--version"])) {
    return true;
  }
  if (exactArgs(args, ["hub", "readiness", "--json"])) {
    return true;
  }
  if (exactArgs(args, ["hub", "sync-adapter", "wechat-pc"])) {
    return true;
  }
  if (exactArgs(args, ["hub", "stats"])) {
    return true;
  }
  return (
    args.length === 5 &&
    exactArgs(args.slice(0, 4), [
      "hub",
      "sync-adapter",
      "qq-pc",
      "--passphrase",
    ]) &&
    args[4].length > 0 &&
    Buffer.byteLength(args[4], "utf8") <= 1024
  );
}

function validatePdh(file, args, policy) {
  if (file === "cc") {
    return validateCcArgs(args);
  }
  if (file !== "node" || args.length < 2) {
    return false;
  }
  const entrypoint = canonicalExistingPath(args[0]);
  return (
    policy.allowedEntrypoints.includes(entrypoint) &&
    validateCcArgs(args.slice(1))
  );
}

function validateAutoContext(file, args) {
  return (
    file === "git" &&
    exactArgs(args, [
      "log",
      "--diff-filter=M",
      "--name-only",
      "--pretty=format:",
      "-n",
      "20",
    ])
  );
}

function validateBugbot(file, args) {
  if (file !== "git") {
    return false;
  }
  if (exactArgs(args, ["diff", "--cached"])) {
    return true;
  }
  if (exactArgs(args, ["diff", "HEAD~1"])) {
    return true;
  }
  if (
    exactArgs(args, [
      "log",
      "--since=7 days ago",
      "--name-only",
      "--pretty=format:",
      "--diff-filter=ACMR",
    ])
  ) {
    return true;
  }
  return args.length === 2 && args[0] === "diff" && isSafeGitRevision(args[1]);
}

function validateChangelogGenerator(file, args) {
  if (file !== "git") {
    return false;
  }
  if (exactArgs(args, ["describe", "--tags", "--abbrev=0"])) {
    return true;
  }
  if (exactArgs(args, ["tag", "--sort=-creatordate"])) {
    return true;
  }
  if (exactArgs(args, ["rev-parse", "--is-inside-work-tree"])) {
    return true;
  }
  return (
    args.length === 3 &&
    args[0] === "log" &&
    isSafeGitRevision(args[1]) &&
    args[2] === "--pretty=format:%H|%s|%an|%ai|%b---END---"
  );
}

function validateCommitSplitter(file, args) {
  return (
    file === "git" &&
    [
      ["status", "--porcelain"],
      ["diff", "--name-only"],
      ["diff", "--cached", "--name-only"],
    ].some((expected) => exactArgs(args, expected))
  );
}

function canonicalPathWithinRoots(value, cwd, policy) {
  try {
    const candidate = canonicalExistingPath(
      nodePath.isAbsolute(value) ? value : nodePath.resolve(cwd, value),
    );
    return policy.allowedRoots.some((root) => isWithinRoot(candidate, root));
  } catch {
    return false;
  }
}

function canonicalWritablePathWithinRoots(value, cwd, policy) {
  try {
    const resolved = nodePath.isAbsolute(value)
      ? nodePath.resolve(value)
      : nodePath.resolve(cwd, value);
    const candidate = nodeFs.existsSync(resolved)
      ? canonicalExistingPath(resolved)
      : nodePath.join(
          canonicalExistingPath(nodePath.dirname(resolved)),
          nodePath.basename(resolved),
        );
    return policy.allowedRoots.some((root) => isWithinRoot(candidate, root));
  } catch {
    return false;
  }
}

function validateFfprobe(file, args, policy, cwd) {
  return (
    file === "ffprobe" &&
    args.length === 7 &&
    exactArgs(args.slice(0, 6), [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
    ]) &&
    canonicalPathWithinRoots(args[6], cwd, policy)
  );
}

function validateDiffPreviewer(file, args, policy, cwd) {
  if (file !== "git") {
    return false;
  }
  if (exactArgs(args, ["diff"]) || exactArgs(args, ["diff", "--cached"])) {
    return true;
  }
  return (
    args.length === 5 &&
    exactArgs(args.slice(0, 3), ["diff", "--no-index", "--"]) &&
    canonicalPathWithinRoots(args[3], cwd, policy) &&
    canonicalPathWithinRoots(args[4], cwd, policy)
  );
}

function validateDocGenerator(file, args) {
  return (
    file === "git" &&
    args.length === 4 &&
    args[0] === "log" &&
    isSafeGitRevision(args[1]) &&
    args[2] === "--pretty=format:%H|%s|%an|%ad" &&
    args[3] === "--date=short"
  );
}

function validateFaultLocalizer(file, args, policy, cwd) {
  return (
    file === "git" &&
    args.length === 5 &&
    exactArgs(args.slice(0, 4), ["log", "-1", "--format=%ct", "--"]) &&
    canonicalPathWithinRoots(args[4], cwd, policy)
  );
}

function validateGitCommit(file, args) {
  if (file !== "git") {
    return false;
  }
  if (
    [
      ["diff", "--cached", "--name-only"],
      ["status", "--porcelain"],
      ["diff", "--cached", "--stat"],
      ["diff", "--cached"],
    ].some((expected) => exactArgs(args, expected))
  ) {
    return true;
  }
  return (
    args.length === 3 &&
    exactArgs(args.slice(0, 2), ["commit", "-m"]) &&
    args[2].length > 0 &&
    args[2].length <= 512
  );
}

function validateGitHistoryAnalyzer(file, args) {
  if (file !== "git") {
    return false;
  }
  if (exactArgs(args, ["rev-parse", "--is-inside-work-tree"])) {
    return true;
  }
  if (exactArgs(args, ["rev-list", "--count", "HEAD"])) {
    return true;
  }
  if (
    args.length === 5 &&
    args[0] === "log" &&
    [
      ["--pretty=format:", "--name-only"],
      ["--pretty=tformat:", "--numstat"],
      ["--pretty=format:---COMMIT---", "--name-only"],
    ].some((shape) => exactArgs(args.slice(1, 3), shape)) &&
    args[3] === "-n" &&
    isBoundedPositiveInteger(args[4])
  ) {
    return true;
  }
  if (
    args.length === 5 &&
    exactArgs(args.slice(0, 4), ["shortlog", "-sn", "--all", "-n"])
  ) {
    return isBoundedPositiveInteger(args[4]);
  }
  if (
    args.length === 6 &&
    args[0] === "log" &&
    args[1].startsWith("--author=") &&
    args[1].length <= 264 &&
    args[2] === "--pretty=tformat:" &&
    args[3] === "--numstat" &&
    args[4] === "-n"
  ) {
    return isBoundedPositiveInteger(args[5]);
  }
  return (
    args.length === 5 &&
    args[0] === "log" &&
    args[1].startsWith("--author=") &&
    args[1].length <= 264 &&
    exactArgs(args.slice(2), ["--pretty=format:%H", "-n", "50"])
  );
}

function validateImpactAnalyzer(file, args) {
  return (
    file === "git" &&
    (exactArgs(args, ["diff", "--name-only"]) ||
      exactArgs(args, ["diff", "--cached", "--name-only"]))
  );
}

function validateAudioTranscriber(file, args, policy, cwd) {
  if (validateFfprobe(file, args, policy, cwd)) {
    return true;
  }
  if (file !== "whisper") {
    return false;
  }
  if (exactArgs(args, ["--help"])) {
    return true;
  }
  return (
    (args.length === 3 || args.length === 5) &&
    canonicalPathWithinRoots(args[0], cwd, policy) &&
    exactArgs(args.slice(1, 3), ["--output_format", "json"]) &&
    (args.length === 3 ||
      (args[3] === "--language" && /^[A-Za-z-]{2,32}$/.test(args[4])))
  );
}

function validateClipboardManager(file, args) {
  return [
    [
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard"],
    ],
    [
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard"],
    ],
    ["clip", []],
    ["clip.exe", []],
    ["pbpaste", []],
    ["pbcopy", []],
    ["xclip", ["-selection", "clipboard", "-o"]],
    ["xclip", ["-selection", "clipboard"]],
  ].some(
    ([expectedFile, expectedArgs]) =>
      file === expectedFile && exactArgs(args, expectedArgs),
  );
}

function validateNpmAudit(file, args) {
  return isNpmExecutable(file) && exactArgs(args, ["audit", "--json"]);
}

function validateEnvDoctor(file, args) {
  return [
    ["node", ["--version"]],
    ["npm", ["--version"]],
    ["npm.cmd", ["--version"]],
    ["java", ["--version"]],
    ["python", ["--version"]],
    ["docker", ["--version"]],
    ["git", ["--version"]],
    ["docker", ["ps", "--format", "{{.Names}}\\t{{.Status}}\\t{{.Ports}}"]],
  ].some(
    ([expectedFile, expectedArgs]) =>
      file === expectedFile && exactArgs(args, expectedArgs),
  );
}

function validateLintAndFix(file, args, policy, cwd) {
  if (!isNpxExecutable(file) || args.length < 3) {
    return false;
  }
  const target = args[args.length - 1];
  if (!canonicalPathWithinRoots(target, cwd, policy)) {
    return false;
  }
  const commandArgs = args.slice(0, -1);
  return [
    ["eslint", "--format", "json"],
    ["eslint", "--fix", "--format", "json"],
    ["prettier", "--check"],
    ["prettier", "--write"],
  ].some((expected) => exactArgs(commandArgs, expected));
}

function validatePerformanceProfiler(file, args, policy, cwd) {
  if (
    file === "node" &&
    args.length === 1 &&
    canonicalPathWithinRoots(args[0], cwd, policy)
  ) {
    return true;
  }
  return isApprovedInvocation(file, args, policy);
}

function validateReleaseManager(file, args) {
  if (file !== "git") {
    return false;
  }
  if (exactArgs(args, ["describe", "--tags", "--abbrev=0"])) {
    return true;
  }
  return (
    args.length === 4 &&
    args[0] === "log" &&
    isSafeGitRevision(args[1]) &&
    exactArgs(args.slice(2), ["--pretty=format:%H|%s|%an|%ad", "--date=short"])
  );
}

function validateResearchAgent(file, args) {
  if (!isNpmExecutable(file)) {
    return false;
  }
  return (
    exactArgs(args, ["audit", "--json"]) ||
    (args.length === 3 &&
      args[0] === "view" &&
      isSafeNpmPackage(args[1]) &&
      args[2] === "--json")
  );
}

function validateSkillCreator(file, args, policy) {
  if (file !== "node" || args.length !== 3 || args[1] !== "ask") {
    return false;
  }
  try {
    return (
      policy.allowedEntrypoints.includes(canonicalExistingPath(args[0])) &&
      args[2].trim().length > 0
    );
  } catch {
    return false;
  }
}

function validateSystemMonitor(file, args) {
  return [
    ["wmic", ["logicaldisk", "get", "caption,size,freespace", "/format:csv"]],
    ["tasklist", ["/fo", "csv", "/nh"]],
    ["df", ["-h", "--output=target,size,used,avail,pcent"]],
    ["df", ["-h"]],
    ["ps", ["aux", "--sort=-%cpu"]],
    ["ps", ["aux"]],
  ].some(
    ([expectedFile, expectedArgs]) =>
      file === expectedFile && exactArgs(args, expectedArgs),
  );
}

function validateTestAndFix(file, args, policy, cwd) {
  let target = null;
  let baseArgs = args;
  if (args.length > 0 && canonicalPathWithinRoots(args.at(-1), cwd, policy)) {
    target = args.at(-1);
    baseArgs = args.slice(0, -1);
  }
  const validBase =
    (isNpxExecutable(file) &&
      (exactArgs(baseArgs, ["vitest", "run", "--reporter=json"]) ||
        exactArgs(baseArgs, ["jest", "--json"]))) ||
    ((file === "python" || file === "python3") &&
      exactArgs(baseArgs, ["-m", "pytest", "--tb=short", "-q"]));
  return validBase && (target === null || target.length > 0);
}

function validateVerificationLoop(file, args) {
  if (isNpmExecutable(file)) {
    return (
      exactArgs(args, ["test"]) ||
      (args.length === 2 &&
        args[0] === "run" &&
        ["build", "build:main", "lint"].includes(args[1]))
    );
  }
  if (isNpxExecutable(file)) {
    return [
      ["tsc", "--noEmit"],
      ["eslint", ".", "--max-warnings=0"],
      ["vitest", "run"],
      ["jest"],
    ].some((expected) => exactArgs(args, expected));
  }
  if (file === "python" || file === "python3") {
    return [
      ["-m", "mypy", ".", "--ignore-missing-imports"],
      ["-m", "flake8", ".", "--count", "--statistics"],
      ["-m", "pytest", "--tb=short", "-q"],
    ].some((expected) => exactArgs(args, expected));
  }
  if (file === "mvn" || file === "mvn.cmd") {
    return [
      ["compile", "-q"],
      ["test", "-q"],
    ].some((expected) => exactArgs(args, expected));
  }
  return (
    file === "git" &&
    (exactArgs(args, ["diff", "--stat"]) || exactArgs(args, ["diff"]))
  );
}

function validateVerify(file, args, policy) {
  if (isApprovedInvocation(file, args, policy)) {
    return true;
  }
  return (
    (isNpmExecutable(file) && exactArgs(args, ["test"])) ||
    ((file === "mvn" || file === "mvn.cmd") &&
      exactArgs(args, ["test", "-q"])) ||
    ((file === "python" || file === "python3") &&
      exactArgs(args, ["-m", "pytest", "-q"]))
  );
}

function validateMediaMetadata(file, args, policy, cwd) {
  return validateFfprobe(file, args, policy, cwd);
}

function isSafeMediaTime(value) {
  return /^\d{1,3}:[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/.test(value);
}

function isDistinctMediaOutput(input, output, cwd, policy, extensions) {
  if (
    !canonicalPathWithinRoots(input, cwd, policy) ||
    !canonicalWritablePathWithinRoots(output, cwd, policy) ||
    !extensions.has(nodePath.extname(output).toLowerCase())
  ) {
    return false;
  }
  try {
    const source = canonicalExistingPath(
      nodePath.isAbsolute(input) ? input : nodePath.resolve(cwd, input),
    );
    const resolvedOutput = nodePath.isAbsolute(output)
      ? nodePath.resolve(output)
      : nodePath.resolve(cwd, output);
    const target = nodeFs.existsSync(resolvedOutput)
      ? canonicalExistingPath(resolvedOutput)
      : nodePath.join(
          canonicalExistingPath(nodePath.dirname(resolvedOutput)),
          nodePath.basename(resolvedOutput),
        );
    return source !== target;
  } catch {
    return false;
  }
}

function validateVideoToolkit(file, args, policy, cwd) {
  if (validateFfprobe(file, args, policy, cwd)) {
    return true;
  }
  if (file !== "ffmpeg") {
    return false;
  }
  const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  const audioExtensions = new Set([".mp3", ".wav", ".aac", ".m4a"]);
  const videoExtensions = new Set([
    ".mp4",
    ".mkv",
    ".mov",
    ".webm",
    ".avi",
    ".m4v",
  ]);
  if (
    args.length === 8 &&
    args[0] === "-y" &&
    args[1] === "-ss" &&
    isSafeMediaTime(args[2]) &&
    args[3] === "-i" &&
    exactArgs(args.slice(5, 7), ["-frames:v", "1"])
  ) {
    return isDistinctMediaOutput(
      args[4],
      args[7],
      cwd,
      policy,
      imageExtensions,
    );
  }
  if (
    args.length === 7 &&
    exactArgs(args.slice(0, 2), ["-y", "-i"]) &&
    exactArgs(args.slice(3, 5), ["-vn", "-acodec"]) &&
    ["libmp3lame", "pcm_s16le", "aac"].includes(args[5])
  ) {
    return isDistinctMediaOutput(
      args[2],
      args[6],
      cwd,
      policy,
      audioExtensions,
    );
  }
  if (
    args.length === 8 &&
    exactArgs(args.slice(0, 2), ["-y", "-i"]) &&
    args[3] === "-vf" &&
    [
      "scale=1920:1080",
      "scale=1280:720",
      "scale=854:480",
      "scale=640:360",
    ].includes(args[4]) &&
    args[5] === "-b:v" &&
    ["4000k", "2500k", "1000k", "500k"].includes(args[6])
  ) {
    return isDistinctMediaOutput(
      args[2],
      args[7],
      cwd,
      policy,
      videoExtensions,
    );
  }
  if (
    (args.length === 8 || args.length === 10) &&
    exactArgs(args.slice(0, 2), ["-y", "-ss"]) &&
    isSafeMediaTime(args[2]) &&
    args[3] === "-i" &&
    (args.length === 8 || (args[5] === "-t" && isSafeMediaTime(args[6]))) &&
    exactArgs(args.slice(-3, -1), ["-c", "copy"])
  ) {
    return isDistinctMediaOutput(
      args[4],
      args.at(-1),
      cwd,
      policy,
      videoExtensions,
    );
  }
  return (
    args.length === 4 &&
    exactArgs(args.slice(0, 2), ["-y", "-i"]) &&
    isDistinctMediaOutput(args[2], args[3], cwd, policy, videoExtensions)
  );
}

const BUNDLED_SKILL_PROCESS_POLICIES = Object.freeze({
  "audio-transcriber": Object.freeze({
    maxTimeoutMs: 300_000,
    validate: validateAudioTranscriber,
  }),
  "auto-context": Object.freeze({
    maxTimeoutMs: 5_000,
    validate: validateAutoContext,
  }),
  bugbot: Object.freeze({
    maxTimeoutMs: 15_000,
    validate: validateBugbot,
  }),
  "changelog-generator": Object.freeze({
    maxTimeoutMs: 15_000,
    validate: validateChangelogGenerator,
  }),
  "clipboard-manager": Object.freeze({
    allowStdin: true,
    maxTimeoutMs: 5_000,
    validate: validateClipboardManager,
  }),
  "commit-splitter": Object.freeze({
    maxTimeoutMs: 15_000,
    validate: validateCommitSplitter,
  }),
  "create-pr": Object.freeze({
    maxTimeoutMs: 10_000,
    validate: validateCreatePr,
  }),
  "diff-previewer": Object.freeze({
    maxTimeoutMs: 30_000,
    validate: validateDiffPreviewer,
  }),
  "dependency-analyzer": Object.freeze({
    maxTimeoutMs: 30_000,
    validate: validateNpmAudit,
  }),
  "doc-generator": Object.freeze({
    maxTimeoutMs: 15_000,
    validate: validateDocGenerator,
  }),
  "fault-localizer": Object.freeze({
    maxTimeoutMs: 10_000,
    validate: validateFaultLocalizer,
  }),
  "env-doctor": Object.freeze({
    maxTimeoutMs: 15_000,
    validate: validateEnvDoctor,
  }),
  "git-commit": Object.freeze({
    maxTimeoutMs: 10_000,
    validate: validateGitCommit,
  }),
  "git-history-analyzer": Object.freeze({
    maxTimeoutMs: 30_000,
    validate: validateGitHistoryAnalyzer,
  }),
  "git-worktree-manager": Object.freeze({
    maxTimeoutMs: 30_000,
    validate: validateGitWorktree,
  }),
  "impact-analyzer": Object.freeze({
    maxTimeoutMs: 10_000,
    validate: validateImpactAnalyzer,
  }),
  "lint-and-fix": Object.freeze({
    maxTimeoutMs: 60_000,
    validate: validateLintAndFix,
  }),
  "media-metadata": Object.freeze({
    maxTimeoutMs: 60_000,
    validate: validateMediaMetadata,
  }),
  "k8s-deployer": Object.freeze({
    maxTimeoutMs: 30_000,
    validate: validateK8s,
  }),
  "pr-reviewer": Object.freeze({
    maxTimeoutMs: 30_000,
    validate: validatePrReviewer,
  }),
  "pdh-im-collect": Object.freeze({
    maxTimeoutMs: 600_000,
    validate: validatePdh,
  }),
  "performance-profiler": Object.freeze({
    allowAuthorityInvocations: true,
    maxTimeoutMs: 60_000,
    validate: validatePerformanceProfiler,
  }),
  "release-manager": Object.freeze({
    maxTimeoutMs: 15_000,
    validate: validateReleaseManager,
  }),
  "research-agent": Object.freeze({
    maxTimeoutMs: 20_000,
    validate: validateResearchAgent,
  }),
  "skill-creator": Object.freeze({
    allowedEnvironmentKeys: SKILL_CREATOR_ENVIRONMENT_KEYS,
    maxTimeoutMs: 60_000,
    validate: validateSkillCreator,
  }),
  "system-monitor": Object.freeze({
    maxTimeoutMs: 15_000,
    validate: validateSystemMonitor,
  }),
  "test-and-fix": Object.freeze({
    maxTimeoutMs: 120_000,
    validate: validateTestAndFix,
  }),
  "verification-loop": Object.freeze({
    maxTimeoutMs: 180_000,
    validate: validateVerificationLoop,
  }),
  verify: Object.freeze({
    allowAuthorityInvocations: true,
    maxTimeoutMs: 180_000,
    validate: validateVerify,
  }),
  "vulnerability-scanner": Object.freeze({
    maxTimeoutMs: 30_000,
    validate: validateNpmAudit,
  }),
  "video-toolkit": Object.freeze({
    maxTimeoutMs: 300_000,
    validate: validateVideoToolkit,
  }),
});

const brokerMetadata = new WeakMap();

function processError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalExistingPath(value) {
  const resolved = nodeFs.realpathSync(nodePath.resolve(String(value || "")));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithinRoot(candidate, root) {
  const relative = nodePath.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !nodePath.isAbsolute(relative))
  );
}

function defaultAuditSink(entry) {
  logger.info("[bundled-skill-process-broker]", entry);
}

function normalizePolicy(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_POLICY_INVALID",
      "Bundled Skill process authority policy is required",
    );
  }
  const skillId = String(options.skillId || "").trim();
  const reviewed = BUNDLED_SKILL_PROCESS_POLICIES[skillId];
  if (!reviewed) {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_SKILL_DENIED",
      `Bundled Skill process authority is not reviewed for ${skillId || "unknown"}`,
    );
  }
  const authorityId = String(options.authorityId || "").trim();
  if (!authorityId || authorityId.length > MAX_AUTHORITY_ID_LENGTH) {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_AUTHORITY_REQUIRED",
      "A bounded process authority decision ID is required",
    );
  }
  if (
    !Array.isArray(options.allowedRoots) ||
    options.allowedRoots.length === 0 ||
    options.allowedRoots.length > MAX_ALLOWED_ROOTS
  ) {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_ROOTS_REQUIRED",
      `Between 1 and ${MAX_ALLOWED_ROOTS} approved working roots are required`,
    );
  }
  const allowedRoots = Object.freeze([
    ...new Set(options.allowedRoots.map(canonicalExistingPath)),
  ]);
  const rawEntrypoints = options.allowedEntrypoints || [];
  if (
    !Array.isArray(rawEntrypoints) ||
    rawEntrypoints.length > MAX_ALLOWED_ENTRYPOINTS
  ) {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_ENTRYPOINTS_INVALID",
      `At most ${MAX_ALLOWED_ENTRYPOINTS} approved CLI entrypoints are allowed`,
    );
  }
  const allowedEntrypoints = Object.freeze([
    ...new Set(rawEntrypoints.map(canonicalExistingPath)),
  ]);
  const rawApprovedInvocations = options.approvedInvocations || [];
  if (
    !Array.isArray(rawApprovedInvocations) ||
    rawApprovedInvocations.length > MAX_APPROVED_INVOCATIONS ||
    (rawApprovedInvocations.length > 0 && !reviewed.allowAuthorityInvocations)
  ) {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_INVOCATIONS_INVALID",
      "Exact authority invocations are not allowed for this Skill policy",
    );
  }
  const approvedInvocations = Object.freeze(
    rawApprovedInvocations.map((invocation) => {
      if (
        !invocation ||
        typeof invocation !== "object" ||
        Array.isArray(invocation)
      ) {
        throw processError(
          "CC_BUNDLED_SKILL_PROCESS_INVOCATIONS_INVALID",
          "Approved process invocations must be structured objects",
        );
      }
      const file = String(invocation.file || "").trim();
      const args = invocation.args;
      if (
        !file ||
        nodePath.basename(file) !== file ||
        !/^[A-Za-z0-9._-]+$/.test(file) ||
        !Array.isArray(args) ||
        args.length > MAX_ARGUMENTS ||
        args.some(
          (arg) =>
            typeof arg !== "string" ||
            arg.includes("\0") ||
            Buffer.byteLength(arg, "utf8") > MAX_SINGLE_ARGUMENT_BYTES,
        )
      ) {
        throw processError(
          "CC_BUNDLED_SKILL_PROCESS_INVOCATIONS_INVALID",
          "Approved process invocations must contain bounded executable argv",
        );
      }
      return Object.freeze({ file, args: Object.freeze([...args]) });
    }),
  );
  return Object.freeze({
    skillId,
    authorityId,
    allowedRoots,
    allowedEntrypoints,
    approvedInvocations,
    reviewed,
  });
}

function createBundledSkillProcessBroker(options, deps = {}) {
  const policy = normalizePolicy(options);
  const executeFileSync = deps.executeFileSync;
  const auditSink = deps.auditSink || defaultAuditSink;
  if (typeof executeFileSync !== "function") {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_ADAPTER_REQUIRED",
      "A trusted ProcessExecutionBroker adapter is required",
    );
  }

  function audit(file, args, cwd, outcome, reason = null) {
    auditSink(
      Object.freeze({
        event: "bundled-skill-process-execution",
        skillId: policy.skillId,
        authorityId: policy.authorityId,
        executable: file,
        operation: args.slice(0, 2).join(" ") || null,
        argCount: args.length,
        cwd,
        outcome,
        ...(reason ? { reason } : {}),
      }),
    );
  }

  function execFileSync(file, args, options = {}) {
    const normalizedFile = String(file || "").trim();
    if (
      !normalizedFile ||
      nodePath.basename(normalizedFile) !== normalizedFile ||
      !/^[A-Za-z0-9._-]+$/.test(normalizedFile)
    ) {
      throw processError(
        "CC_BUNDLED_SKILL_PROCESS_EXECUTABLE_DENIED",
        "Only reviewed executable names are allowed",
      );
    }
    if (
      !Array.isArray(args) ||
      args.length > MAX_ARGUMENTS ||
      args.some(
        (arg) =>
          typeof arg !== "string" ||
          arg.includes("\0") ||
          Buffer.byteLength(arg, "utf8") > MAX_SINGLE_ARGUMENT_BYTES,
      )
    ) {
      throw processError(
        "CC_BUNDLED_SKILL_PROCESS_ARGUMENTS_INVALID",
        "Process arguments must be a bounded string array",
      );
    }
    const totalArgumentBytes = args.reduce(
      (total, arg) => total + Buffer.byteLength(arg, "utf8"),
      0,
    );
    if (totalArgumentBytes > MAX_ARGUMENT_BYTES) {
      throw processError(
        "CC_BUNDLED_SKILL_PROCESS_ARGUMENTS_TOO_LARGE",
        "Process arguments exceeded the aggregate limit",
      );
    }
    const cwd = canonicalExistingPath(options.cwd);
    if (!policy.allowedRoots.some((root) => isWithinRoot(cwd, root))) {
      audit(normalizedFile, args, cwd, "denied", "cwd_denied");
      throw processError(
        "CC_BUNDLED_SKILL_PROCESS_CWD_DENIED",
        "Process working directory is outside approved roots",
      );
    }
    if (!policy.reviewed.validate(normalizedFile, args, policy, cwd)) {
      audit(normalizedFile, args, cwd, "denied", "invocation_denied");
      throw processError(
        "CC_BUNDLED_SKILL_PROCESS_INVOCATION_DENIED",
        `Process invocation is not approved for ${policy.skillId}`,
      );
    }
    const timeout =
      Number.isSafeInteger(options.timeout) && options.timeout > 0
        ? Math.min(options.timeout, policy.reviewed.maxTimeoutMs)
        : policy.reviewed.maxTimeoutMs;
    let input;
    if (options.input !== undefined) {
      if (
        !policy.reviewed.allowStdin ||
        (typeof options.input !== "string" &&
          !Buffer.isBuffer(options.input)) ||
        Buffer.byteLength(options.input) > MAX_INPUT_BYTES
      ) {
        audit(normalizedFile, args, cwd, "denied", "stdin_denied");
        throw processError(
          "CC_BUNDLED_SKILL_PROCESS_STDIN_DENIED",
          "Process stdin is not approved or exceeded the bounded input limit",
        );
      }
      input = Buffer.isBuffer(options.input)
        ? Buffer.from(options.input)
        : options.input;
    }
    let environment;
    if (options.env !== undefined) {
      const allowedKeys = policy.reviewed.allowedEnvironmentKeys;
      if (
        !allowedKeys ||
        !options.env ||
        typeof options.env !== "object" ||
        Array.isArray(options.env)
      ) {
        audit(normalizedFile, args, cwd, "denied", "environment_denied");
        throw processError(
          "CC_BUNDLED_SKILL_PROCESS_ENVIRONMENT_DENIED",
          "Process environment is not approved for this Skill",
        );
      }
      environment = {};
      let environmentBytes = 0;
      for (const [key, value] of Object.entries(options.env)) {
        if (!allowedKeys.includes(key) || typeof value !== "string") {
          audit(normalizedFile, args, cwd, "denied", "environment_denied");
          throw processError(
            "CC_BUNDLED_SKILL_PROCESS_ENVIRONMENT_DENIED",
            "Process environment contains an unapproved key or value",
          );
        }
        environmentBytes +=
          Buffer.byteLength(key, "utf8") + Buffer.byteLength(value, "utf8");
        if (environmentBytes > MAX_ENVIRONMENT_BYTES) {
          audit(normalizedFile, args, cwd, "denied", "environment_too_large");
          throw processError(
            "CC_BUNDLED_SKILL_PROCESS_ENVIRONMENT_TOO_LARGE",
            "Process environment exceeded the aggregate limit",
          );
        }
        environment[key] = value;
      }
      environment = Object.freeze(environment);
    }
    let output;
    try {
      output = executeFileSync(
        Object.freeze({
          skillId: policy.skillId,
          authorityId: policy.authorityId,
          file: normalizedFile,
          args: Object.freeze([...args]),
          cwd,
          timeout,
          encoding: "utf8",
          maxBuffer: MAX_OUTPUT_BYTES,
          ...(input !== undefined ? { input } : {}),
          ...(environment !== undefined ? { env: environment } : {}),
        }),
      );
    } catch (error) {
      audit(normalizedFile, args, cwd, "failed", "adapter_failed");
      throw error;
    }
    if (typeof output !== "string" && !Buffer.isBuffer(output)) {
      audit(normalizedFile, args, cwd, "denied", "output_type_invalid");
      throw processError(
        "CC_BUNDLED_SKILL_PROCESS_OUTPUT_INVALID",
        "Process adapter returned an unsupported output type",
      );
    }
    if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
      audit(normalizedFile, args, cwd, "denied", "output_too_large");
      throw processError(
        "CC_BUNDLED_SKILL_PROCESS_OUTPUT_TOO_LARGE",
        "Process output exceeded the broker limit",
      );
    }
    audit(normalizedFile, args, cwd, "allowed");
    return Buffer.isBuffer(output) ? output.toString("utf8") : output;
  }

  const broker = Object.freeze({ execFileSync });
  brokerMetadata.set(broker, policy);
  return broker;
}

function requireBundledSkillProcessBroker(context, skillId) {
  const broker = context?.processBroker;
  const metadata =
    broker && typeof broker === "object" ? brokerMetadata.get(broker) : null;
  if (
    !metadata ||
    metadata.skillId !== skillId ||
    typeof broker.execFileSync !== "function"
  ) {
    throw processError(
      "CC_BUNDLED_SKILL_PROCESS_BROKER_UNAVAILABLE",
      `Trusted process authority is unavailable for ${skillId}; direct child process access is disabled`,
    );
  }
  return broker;
}

module.exports = {
  BUNDLED_SKILL_PROCESS_POLICIES,
  createBundledSkillProcessBroker,
  parseShellFreeCommand,
  requireBundledSkillProcessBroker,
};
