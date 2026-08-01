import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SKILL_EXECUTION_IDENTITY_VERSION = 1;

const EXECUTION_REASONS = new Set(["run_skill", "cli_skill_run"]);

function sha256(parts) {
  const digest = createHash("sha256");
  for (const part of parts) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(String(part));
    digest.update(String(bytes.length));
    digest.update("\0");
    digest.update(bytes);
    digest.update("\0");
  }
  return `sha256:${digest.digest("hex")}`;
}

function canonicalRealPath(value) {
  let result = fs.realpathSync(path.resolve(value)).replace(/\\/g, "/");
  if (process.platform === "win32") result = result.toLowerCase();
  return result;
}

function securityError(code, message, details = {}) {
  const error = new Error(
    message,
    details.cause ? { cause: details.cause } : {},
  );
  error.name = "SkillExecutionSecurityError";
  error.code = code;
  if (details.skillId) error.skillId = details.skillId;
  if (details.previousDigest) error.previousDigest = details.previousDigest;
  if (details.currentDigest) error.currentDigest = details.currentDigest;
  return error;
}

function readStableRegularFile(file, options = {}) {
  let before;
  try {
    before = fs.lstatSync(file);
  } catch (cause) {
    if (options.optional && cause?.code === "ENOENT") return null;
    throw securityError(
      "CC_SKILL_COMPONENT_UNAVAILABLE",
      `Skill component is unavailable: ${path.basename(file)}`,
      { cause },
    );
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    throw securityError(
      "CC_SKILL_COMPONENT_UNSAFE",
      `Skill component must be a regular, non-symlink file: ${path.basename(file)}`,
    );
  }

  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  ) {
    throw securityError(
      "CC_SKILL_SNAPSHOT_RACE",
      `Skill component changed while its identity was being captured: ${path.basename(file)}`,
    );
  }
  return Object.freeze({
    bytes,
    size: bytes.length,
    digest: sha256([bytes]),
  });
}

/**
 * Capture the exact files the legacy runtime could execute or interpret.
 * SKILL.md covers frontmatter, instructions, and embedded MCP declarations;
 * handler.js covers the only handler path used by current CLI dispatch.
 */
export function captureSkillExecutionSnapshot(options = {}) {
  if (!options.skillDir) {
    throw new TypeError("captureSkillExecutionSnapshot requires skillDir");
  }
  const rootRealPath = canonicalRealPath(options.skillDir);
  const skillMdPath = path.join(rootRealPath, "SKILL.md");
  const handlerPath = path.join(rootRealPath, "handler.js");
  const skillMd = readStableRegularFile(skillMdPath);
  const handler = readStableRegularFile(handlerPath, { optional: true });
  const skillId = String(options.skillId || path.basename(rootRealPath));
  const source = String(options.source || "unknown");
  const identityDigest = sha256([
    `skill-execution-identity-v${SKILL_EXECUTION_IDENTITY_VERSION}`,
    source,
    skillId,
    rootRealPath,
  ]);
  const contentDigest = sha256([
    `skill-execution-content-v${SKILL_EXECUTION_IDENTITY_VERSION}`,
    "SKILL.md",
    skillMd.digest,
    "handler.js",
    handler?.digest || "absent",
  ]);

  return Object.freeze({
    schemaVersion: SKILL_EXECUTION_IDENTITY_VERSION,
    identityDigest,
    contentDigest,
    rootRealPath,
    handlerPresent: handler !== null,
    skillFileBytes: skillMd.size,
    componentDigests: Object.freeze({
      "SKILL.md": skillMd.digest,
      "handler.js": handler?.digest || null,
    }),
    // Kept only in the short-lived verification snapshot. Callers must store
    // executionIdentityMetadata(snapshot), never this content-bearing object.
    skillMdContent: skillMd.bytes.toString("utf8"),
  });
}

/** Produce the content-free descriptor safe to retain in loader caches. */
export function executionIdentityMetadata(snapshot) {
  return Object.freeze({
    schemaVersion: snapshot.schemaVersion,
    identityDigest: snapshot.identityDigest,
    contentDigest: snapshot.contentDigest,
    rootRealPath: snapshot.rootRealPath,
    handlerPresent: snapshot.handlerPresent,
    componentDigests: Object.freeze({ ...snapshot.componentDigests }),
  });
}

export function describeSkillExecutionAuthority(skill = {}) {
  const hasHandler = skill.hasHandler === true;
  const isolated = skill.isolation === true;
  return Object.freeze({
    schemaVersion: SKILL_EXECUTION_IDENTITY_VERSION,
    mode: !hasHandler
      ? "instructions-only"
      : isolated
        ? "controlled-agent-tools"
        : "blocked-direct-handler",
    directHandlerAllowed: false,
    controlledToolEntryRequired: hasHandler,
  });
}

export function isSkillExecutionContext(context = {}) {
  return (
    context.forExecution === true ||
    EXECUTION_REASONS.has(String(context.loadedBecause || ""))
  );
}

/**
 * The only currently mediated handler-skill route is agent-core's explicit
 * isolated-skill branch. It executes an agent loop whose tool calls re-enter
 * host policy; it never imports handler.js. Every direct-handler route is
 * denied until a restricted worker/RPC transport exists.
 */
export function assertControlledSkillExecution(skill, context = {}) {
  if (!isSkillExecutionContext(context) || skill?.hasHandler !== true) {
    return describeSkillExecutionAuthority(skill);
  }

  const reason = String(context.loadedBecause || "");
  if (reason === "run_skill" && skill.isolation === true) {
    return describeSkillExecutionAuthority(skill);
  }

  throw securityError(
    "CC_SKILL_DIRECT_HANDLER_BLOCKED",
    `Skill "${skill.id || "unknown"}" cannot execute handler.js directly. ` +
      "Use an isolated agent/tool route so every external call re-enters host policy.",
    { skillId: skill.id },
  );
}

export function skillDigestDriftError(skill, previousDigest, currentDigest) {
  return securityError(
    "CC_SKILL_DIGEST_DRIFT",
    `Skill "${skill.id || "unknown"}" changed after discovery and was not reauthorized.`,
    {
      skillId: skill.id,
      previousDigest,
      currentDigest,
    },
  );
}

export function skillIdentityChangedError(skill) {
  return securityError(
    "CC_SKILL_IDENTITY_CHANGED",
    `Skill "${skill.id || "unknown"}" changed identity after discovery; reload the skill registry before use.`,
    { skillId: skill.id },
  );
}

export function skillReauthorizationError(skill, cause) {
  return securityError(
    "CC_SKILL_REAUTHORIZE_FAILED",
    `Skill "${skill.id || "unknown"}" digest reauthorization failed.`,
    { skillId: skill.id, cause },
  );
}
