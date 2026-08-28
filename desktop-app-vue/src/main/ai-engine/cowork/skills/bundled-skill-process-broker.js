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
const MAX_ALLOWED_ROOTS = 16;
const MAX_ALLOWED_ENTRYPOINTS = 8;
const SAFE_REF_RE = /^[A-Za-z0-9._/#-]{1,200}$/;
const SAFE_GIT_RANGE_RE =
  /^[A-Za-z0-9._/-]{1,200}(?:\.\.[A-Za-z0-9._/-]{1,200})?$/;
const SAFE_K8S_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;

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

function isSafeK8sName(value) {
  return SAFE_K8S_NAME_RE.test(value);
}

function validateCreatePr(file, args) {
  if (file !== "git") return false;
  if (exactArgs(args, ["rev-parse", "--abbrev-ref", "HEAD"])) return true;
  if (exactArgs(args, ["diff", "--stat", "HEAD~1"])) return true;
  if (exactArgs(args, ["diff", "--stat", "--cached"])) return true;
  if (exactArgs(args, ["diff", "--cached", "--stat"])) return true;
  if (exactArgs(args, ["status", "--short"])) return true;
  if (exactArgs(args, ["log", "--oneline", "-10"])) return true;
  if (exactArgs(args, ["log", "--oneline", "-20"])) return true;
  return (
    args.length === 3 &&
    args[0] === "log" &&
    args[1] === "--oneline" &&
    isSafeGitRange(args[2])
  );
}

function validateGitWorktree(file, args) {
  if (file !== "git") return false;
  if (exactArgs(args, ["worktree", "list", "--porcelain"])) return true;
  if (exactArgs(args, ["worktree", "prune", "-v"])) return true;
  if (exactArgs(args, ["status", "--short"])) return true;
  if (
    args.length === 3 &&
    exactArgs(args.slice(0, 2), ["rev-parse", "--verify"])
  ) {
    return isSafeRef(args[2]);
  }
  if (args.length === 2 && args[0] === "branch") return isSafeRef(args[1]);
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
  if (file !== "kubectl") return false;
  if (exactArgs(args, ["get", "deployments", "-o", "wide"])) return true;
  if (exactArgs(args, ["get", "pods", "-o", "wide"])) return true;
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
  if (file !== "git") return false;
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
  if (exactArgs(args, ["--version"])) return true;
  if (exactArgs(args, ["hub", "readiness", "--json"])) return true;
  if (exactArgs(args, ["hub", "sync-adapter", "wechat-pc"])) return true;
  if (exactArgs(args, ["hub", "stats"])) return true;
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
  if (file === "cc") return validateCcArgs(args);
  if (file !== "node" || args.length < 2) return false;
  const entrypoint = canonicalExistingPath(args[0]);
  return (
    policy.allowedEntrypoints.includes(entrypoint) &&
    validateCcArgs(args.slice(1))
  );
}

const BUNDLED_SKILL_PROCESS_POLICIES = Object.freeze({
  "create-pr": Object.freeze({
    maxTimeoutMs: 10_000,
    validate: validateCreatePr,
  }),
  "git-worktree-manager": Object.freeze({
    maxTimeoutMs: 30_000,
    validate: validateGitWorktree,
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
  return Object.freeze({
    skillId,
    authorityId,
    allowedRoots,
    allowedEntrypoints,
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
    if (!policy.reviewed.validate(normalizedFile, args, policy)) {
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
    return output;
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
  requireBundledSkillProcessBroker,
};
