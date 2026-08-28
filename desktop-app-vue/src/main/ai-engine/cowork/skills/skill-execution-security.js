/**
 * Security boundary for executable Markdown skills.
 *
 * Discovery may describe an unsigned skill, but executable bytes are always
 * re-read immediately before use. Only package-owned bundled handlers may be
 * loaded into Electron's main process. External handlers require a trusted
 * Ed25519 signature and an explicit capability manifest, and must be handed to
 * an injected isolated executor; they are never passed to `require()` here.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  BUNDLED_SKILL_CAPABILITY_CATALOG,
} = require("./bundled-skill-capability-catalog.js");

const LOCK_FILENAME = ".skill-lock.json";
const LOCK_VERSION = 1;
const MANIFEST_SCHEMA = "chainlesschain.skill-execution-manifest/v1";
const MAX_SKILL_MD_BYTES = 256 * 1024;
const MAX_HANDLER_BYTES = 1024 * 1024;
const MAX_LOCK_BYTES = 64 * 1024;
const MAX_CAPABILITIES = 64;
const CAPABILITY_RE = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;

function securityError(code, message, details = {}) {
  const error = new Error(
    message,
    details.cause ? { cause: details.cause } : {},
  );
  error.name = "SkillExecutionSecurityError";
  error.code = code;
  for (const [key, value] of Object.entries(details)) {
    if (key !== "cause" && value !== undefined) error[key] = value;
  }
  return error;
}

function canonicalRealPath(value) {
  let result = fs.realpathSync(path.resolve(value));
  if (process.platform === "win32") result = result.toLowerCase();
  return result;
}

function isContained(root, target, { allowRoot = true } = {}) {
  const relative = path.relative(root, target);
  if (!relative) return allowRoot;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertRegularNonSymlink(filePath, component, maxBytes) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (cause) {
    throw securityError(
      "CC_SKILL_COMPONENT_UNAVAILABLE",
      `${component} is unavailable`,
      { cause, component },
    );
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    throw securityError(
      "CC_SKILL_COMPONENT_UNSAFE",
      `${component} must be a regular, non-symlink, single-link file`,
      { component },
    );
  }
  if (stat.size > maxBytes) {
    throw securityError(
      "CC_SKILL_COMPONENT_TOO_LARGE",
      `${component} exceeds the ${maxBytes}-byte limit`,
      { component, bytes: stat.size, maxBytes },
    );
  }
  return stat;
}

function readStableFile(filePath, component, maxBytes) {
  const before = assertRegularNonSymlink(filePath, component, maxBytes);
  const bytes = fs.readFileSync(filePath);
  const after = fs.lstatSync(filePath);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  ) {
    throw securityError(
      "CC_SKILL_SNAPSHOT_RACE",
      `${component} changed while its execution identity was captured`,
      { component },
    );
  }
  if (bytes.length > maxBytes) {
    throw securityError(
      "CC_SKILL_COMPONENT_TOO_LARGE",
      `${component} exceeds the ${maxBytes}-byte limit`,
      { component, bytes: bytes.length, maxBytes },
    );
  }
  return {
    bytes,
    size: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function normalizeCapabilities(value) {
  const raw = value == null ? [] : value;
  if (!Array.isArray(raw)) {
    return { valid: false, capabilities: [], reason: "must be an array" };
  }
  if (raw.length === 0) {
    return {
      valid: false,
      capabilities: [],
      reason: "must explicitly declare at least one capability",
    };
  }
  if (raw.length > MAX_CAPABILITIES) {
    return {
      valid: false,
      capabilities: [],
      reason: `exceeds ${MAX_CAPABILITIES} entries`,
    };
  }
  const capabilities = [];
  for (const item of raw) {
    const capability = String(item || "").trim();
    if (!CAPABILITY_RE.test(capability)) {
      return {
        valid: false,
        capabilities: [],
        reason: `invalid capability: ${capability || "<empty>"}`,
      };
    }
    if (!capabilities.includes(capability)) capabilities.push(capability);
  }
  capabilities.sort();
  return { valid: true, capabilities, reason: null };
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sameCapabilities(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((capability, index) => capability === expected[index])
  );
}

function inspectBundledCapabilityAudit({
  definition,
  bundledRelativePath,
  handler,
  handlerFile,
  capabilityResult,
}) {
  const catalogEntry =
    BUNDLED_SKILL_CAPABILITY_CATALOG[bundledRelativePath] || null;

  if (!catalogEntry) {
    return Object.freeze({
      migrated: false,
      valid: false,
      reason: `bundled Skill path "${bundledRelativePath}" has no reviewed capability catalog entry`,
    });
  }

  if (String(definition.name || "") !== catalogEntry.skillId) {
    return Object.freeze({
      migrated: true,
      valid: false,
      reason: `reviewed bundled Skill path "${bundledRelativePath}" must declare name "${catalogEntry.skillId}"`,
    });
  }
  if (!capabilityResult.valid) {
    return Object.freeze({
      migrated: true,
      valid: false,
      reason: `reviewed bundled Skill has an invalid capability manifest: ${capabilityResult.reason}`,
    });
  }
  if (
    !sameCapabilities(
      capabilityResult.capabilities,
      catalogEntry.executionCapabilities,
    )
  ) {
    return Object.freeze({
      migrated: true,
      valid: false,
      reason: `reviewed bundled Skill capability set does not match the catalog`,
    });
  }
  if (handler.relativePath !== catalogEntry.handlerRelativePath) {
    return Object.freeze({
      migrated: true,
      valid: false,
      reason: `reviewed bundled Skill handler path does not match the catalog`,
    });
  }

  if (handlerFile.sha256 !== catalogEntry.sourceSha256) {
    return Object.freeze({
      migrated: true,
      valid: false,
      reason: `reviewed bundled Skill handler source does not match the audited digest`,
      sourceSha256: handlerFile.sha256,
    });
  }
  return Object.freeze({
    migrated: true,
    valid: true,
    reason: null,
    sourceSha256: handlerFile.sha256,
  });
}

function normalizeTrustedFingerprints(value) {
  const input =
    value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
  return new Set(
    input
      .map((item) =>
        String(item || "")
          .trim()
          .toLowerCase(),
      )
      .filter((item) => /^[a-f0-9]{64}$/.test(item)),
  );
}

/** Validate a skill directory before any SKILL.md content is parsed. */
function preflightSkillPath(skillDir, allowedRoot = skillDir) {
  const rootRealPath = canonicalRealPath(allowedRoot);
  const skillRealPath = canonicalRealPath(skillDir);
  if (!isContained(rootRealPath, skillRealPath)) {
    throw securityError(
      "CC_SKILL_ROOT_ESCAPE",
      "Skill directory escapes its configured layer root",
    );
  }
  const skillMdPath = path.join(skillRealPath, "SKILL.md");
  assertRegularNonSymlink(skillMdPath, "SKILL.md", MAX_SKILL_MD_BYTES);
  const skillMdRealPath = canonicalRealPath(skillMdPath);
  if (!isContained(skillRealPath, skillMdRealPath, { allowRoot: false })) {
    throw securityError(
      "CC_SKILL_COMPONENT_ESCAPE",
      "SKILL.md escapes the skill directory",
    );
  }
  return { rootRealPath, skillRealPath, skillMdRealPath };
}

function resolveHandler(
  definition,
  skillRealPath,
  { allowMissingHandler = false } = {},
) {
  const declared = definition.handler;
  if (!declared) return null;
  if (typeof declared !== "string" || !declared.startsWith("./")) {
    throw securityError(
      "CC_SKILL_HANDLER_PATH_INVALID",
      "Skill handler must be a ./-relative path",
    );
  }
  const resolved = path.resolve(skillRealPath, declared);
  if (!isContained(skillRealPath, resolved, { allowRoot: false })) {
    throw securityError(
      "CC_SKILL_HANDLER_ESCAPE",
      "Skill handler path escapes the skill directory",
    );
  }
  if (![".js", ".cjs"].includes(path.extname(resolved).toLowerCase())) {
    throw securityError(
      "CC_SKILL_HANDLER_TYPE_UNSUPPORTED",
      "Skill handler must be a JavaScript or CommonJS file",
    );
  }

  try {
    assertRegularNonSymlink(resolved, "handler", MAX_HANDLER_BYTES);
  } catch (error) {
    if (
      allowMissingHandler &&
      error.code === "CC_SKILL_COMPONENT_UNAVAILABLE"
    ) {
      return {
        declared,
        relativePath: declared.replace(/\\/g, "/"),
        missing: true,
      };
    }
    throw error;
  }

  const handlerRealPath = canonicalRealPath(resolved);
  if (!isContained(skillRealPath, handlerRealPath, { allowRoot: false })) {
    throw securityError(
      "CC_SKILL_HANDLER_ESCAPE",
      "Skill handler realpath escapes the skill directory",
    );
  }
  return {
    declared,
    handlerRealPath,
    relativePath: path
      .relative(skillRealPath, handlerRealPath)
      .replace(/\\/g, "/"),
    missing: false,
  };
}

function buildManifest(definition, files, handler, capabilityResult) {
  return {
    schema: MANIFEST_SCHEMA,
    skillId: String(definition.name || ""),
    version: String(definition.version || "1.0.0"),
    handler: handler.relativePath,
    executionCapabilities: capabilityResult.capabilities,
    files: files.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
    })),
  };
}

function verifyLock(skillRealPath, actualManifest, trustedFingerprints) {
  const lockPath = path.join(skillRealPath, LOCK_FILENAME);
  if (!fs.existsSync(lockPath)) {
    return {
      signed: false,
      trusted: false,
      reason: "signature lock is missing",
    };
  }

  let lock;
  try {
    const lockBytes = readStableFile(
      lockPath,
      LOCK_FILENAME,
      MAX_LOCK_BYTES,
    ).bytes;
    lock = JSON.parse(lockBytes.toString("utf8"));
  } catch (error) {
    return {
      signed: false,
      trusted: false,
      reason: `signature lock is invalid: ${error.message}`,
    };
  }
  if (lock.lockVersion !== LOCK_VERSION || lock.algorithm !== "ed25519") {
    return {
      signed: false,
      trusted: false,
      reason: "signature lock version or algorithm is unsupported",
    };
  }
  if (canonicalJson(lock.manifest) !== canonicalJson(actualManifest)) {
    return {
      signed: false,
      trusted: false,
      reason: "signed manifest does not match current skill components",
    };
  }

  let publicKey;
  let publicKeySha256;
  try {
    publicKey = crypto.createPublicKey(lock.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") {
      throw new Error("public key is not Ed25519");
    }
    publicKeySha256 = crypto
      .createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");
  } catch (error) {
    return {
      signed: false,
      trusted: false,
      reason: `signature public key is invalid: ${error.message}`,
    };
  }

  let signed = false;
  try {
    signed = crypto.verify(
      null,
      Buffer.from(canonicalJson(actualManifest), "utf8"),
      publicKey,
      Buffer.from(String(lock.signatureBase64 || ""), "base64"),
    );
  } catch {
    signed = false;
  }
  if (!signed) {
    return {
      signed: false,
      trusted: false,
      publicKeySha256,
      reason: "Ed25519 signature verification failed",
    };
  }
  const trusted = trustedFingerprints.has(publicKeySha256);
  return {
    signed: true,
    trusted,
    publicKeySha256,
    reason: trusted ? null : "signing key is not in the trusted key set",
  };
}

function inspectSkillExecution(definition, options = {}) {
  if (!definition?.handler) {
    return Object.freeze({ mode: "instructions-only", executable: false });
  }
  if (!definition.sourcePath || definition.sourcePath === "unknown") {
    throw securityError(
      "CC_SKILL_SOURCE_UNAVAILABLE",
      "Executable skill must have an on-disk SKILL.md source",
    );
  }

  const skillDir = path.dirname(path.resolve(definition.sourcePath));
  const allowedRoot = options.allowedRoot || skillDir;
  const preflight = preflightSkillPath(skillDir, allowedRoot);
  const handler = resolveHandler(definition, preflight.skillRealPath, options);
  const capabilityResult = normalizeCapabilities(
    definition.executionCapabilities,
  );
  const trustedFingerprints = normalizeTrustedFingerprints(
    options.trustedSkillKeySha256,
  );

  if (handler?.missing) {
    const missingIdentity = {
      schema: MANIFEST_SCHEMA,
      skillId: String(definition.name || ""),
      version: String(definition.version || "1.0.0"),
      handler: handler.relativePath,
      handlerMissing: true,
      executionCapabilities: capabilityResult.capabilities,
    };
    return Object.freeze({
      mode: "handler-missing",
      executable: false,
      packageOwned: false,
      skillRootRealPath: preflight.skillRealPath,
      handlerRelativePath: handler.relativePath,
      contentDigest: sha256Canonical(missingIdentity),
      capabilityManifestValid: capabilityResult.valid,
      capabilityReason: capabilityResult.reason,
      executionCapabilities: capabilityResult.capabilities,
      signed: false,
      trusted: false,
      signatureReason: "handler is unavailable",
    });
  }

  const skillMd = readStableFile(
    preflight.skillMdRealPath,
    "SKILL.md",
    MAX_SKILL_MD_BYTES,
  );
  if (
    definition._sourceContentSha256 &&
    definition._sourceContentSha256 !== skillMd.sha256
  ) {
    throw securityError(
      "CC_SKILL_SOURCE_IDENTITY_MISMATCH",
      "Parsed execution metadata does not match the current SKILL.md bytes",
      {
        parsedDigest: definition._sourceContentSha256,
        currentDigest: skillMd.sha256,
      },
    );
  }
  const handlerFile = readStableFile(
    handler.handlerRealPath,
    "handler",
    MAX_HANDLER_BYTES,
  );
  const files = [
    { path: "SKILL.md", bytes: skillMd.size, sha256: skillMd.sha256 },
    {
      path: handler.relativePath,
      bytes: handlerFile.size,
      sha256: handlerFile.sha256,
    },
  ];
  const manifest = buildManifest(definition, files, handler, capabilityResult);
  const lock = verifyLock(
    preflight.skillRealPath,
    manifest,
    trustedFingerprints,
  );

  let packageOwned = false;
  let bundledCapabilityAudit = null;
  if (definition.source === "bundled" && options.trustedBundledRoot) {
    const bundledRoot = canonicalRealPath(options.trustedBundledRoot);
    packageOwned = isContained(bundledRoot, preflight.skillRealPath, {
      allowRoot: false,
    });
    if (packageOwned) {
      const bundledRelativePath = path
        .relative(bundledRoot, preflight.skillRealPath)
        .replace(/\\/g, "/");
      bundledCapabilityAudit = inspectBundledCapabilityAudit({
        definition,
        bundledRelativePath,
        handler,
        handlerFile,
        capabilityResult,
      });
      if (!bundledCapabilityAudit.valid) {
        throw securityError(
          "CC_BUNDLED_SKILL_CAPABILITY_AUDIT_FAILED",
          `Bundled skill "${definition.name || "unknown"}" failed its capability audit: ${bundledCapabilityAudit.reason}`,
          { bundledRelativePath },
        );
      }
    }
  }

  return Object.freeze({
    mode: packageOwned ? "package-in-process" : "external-isolated",
    executable:
      packageOwned || (lock.signed && lock.trusted && capabilityResult.valid),
    packageOwned,
    bundledCapabilityMigrated: bundledCapabilityAudit?.migrated === true,
    bundledCapabilityAuditDigest: bundledCapabilityAudit?.sourceSha256 || null,
    skillRootRealPath: preflight.skillRealPath,
    handlerRealPath: handler.handlerRealPath,
    handlerRelativePath: handler.relativePath,
    contentDigest: sha256Canonical(manifest),
    componentBytes: skillMd.size + handlerFile.size,
    componentDigests: Object.freeze({
      "SKILL.md": skillMd.sha256,
      [handler.relativePath]: handlerFile.sha256,
    }),
    capabilityManifestValid: capabilityResult.valid,
    capabilityReason: capabilityResult.reason,
    executionCapabilities: Object.freeze([...capabilityResult.capabilities]),
    signed: lock.signed,
    trusted: lock.trusted,
    publicKeySha256: lock.publicKeySha256 || null,
    signatureReason: lock.reason || null,
  });
}

function assertSkillHandlerExecution(
  definition,
  discoveredSecurity,
  options = {},
) {
  const current = inspectSkillExecution(definition, {
    ...options,
    allowMissingHandler: false,
  });
  if (
    discoveredSecurity?.contentDigest &&
    discoveredSecurity.contentDigest !== current.contentDigest
  ) {
    throw securityError(
      "CC_SKILL_DIGEST_DRIFT",
      `Skill "${definition.name || "unknown"}" changed after discovery`,
      {
        previousDigest: discoveredSecurity.contentDigest,
        currentDigest: current.contentDigest,
      },
    );
  }
  if (current.packageOwned) return current;
  if (!current.signed) {
    throw securityError(
      "CC_SKILL_SIGNATURE_REQUIRED",
      `External skill "${definition.name || "unknown"}" requires a valid Ed25519 signature: ${current.signatureReason}`,
    );
  }
  if (!current.trusted) {
    throw securityError(
      "CC_SKILL_SIGNER_UNTRUSTED",
      `External skill "${definition.name || "unknown"}" is signed by an untrusted key`,
      { publicKeySha256: current.publicKeySha256 },
    );
  }
  if (!current.capabilityManifestValid) {
    throw securityError(
      "CC_SKILL_CAPABILITY_MANIFEST_REQUIRED",
      `External skill "${definition.name || "unknown"}" has an invalid capability manifest: ${current.capabilityReason}`,
    );
  }
  return current;
}

/**
 * Capture the exact external handler bytes represented by an inspected
 * authority. The isolated executor receives source, not a mutable host path,
 * so it cannot accidentally reopen different bytes after verification.
 */
function captureExternalHandlerSource(authority) {
  if (!authority || authority.packageOwned || !authority.handlerRealPath) {
    throw new TypeError("An external handler execution authority is required");
  }
  const snapshot = readStableFile(
    authority.handlerRealPath,
    "handler",
    MAX_HANDLER_BYTES,
  );
  const expectedDigest =
    authority.componentDigests?.[authority.handlerRelativePath];
  if (!expectedDigest || snapshot.sha256 !== expectedDigest) {
    throw securityError(
      "CC_SKILL_DIGEST_DRIFT",
      "External skill handler changed before isolated execution",
      {
        previousDigest: expectedDigest || null,
        currentDigest: snapshot.sha256,
      },
    );
  }
  return snapshot.bytes.toString("utf8");
}

/** Build a detached lock object for packaging/signing tools. */
function buildSkillSignatureLock(definition, options = {}) {
  if (!options.privateKey || !options.publicKey) {
    throw new TypeError("privateKey and publicKey are required");
  }
  const inspection = inspectSkillExecution(definition, {
    allowedRoot: options.allowedRoot,
    trustedSkillKeySha256: [],
  });
  const files = Object.entries(inspection.componentDigests).map(
    ([componentPath, sha256]) => ({
      path: componentPath,
      bytes:
        componentPath === "SKILL.md"
          ? fs.statSync(definition.sourcePath).size
          : fs.statSync(inspection.handlerRealPath).size,
      sha256,
    }),
  );
  const capabilities = normalizeCapabilities(definition.executionCapabilities);
  if (!capabilities.valid) {
    throw new TypeError(
      `A valid execution capability manifest is required: ${capabilities.reason}`,
    );
  }
  const manifest = buildManifest(
    definition,
    files,
    { relativePath: inspection.handlerRelativePath },
    capabilities,
  );
  const privateKey =
    options.privateKey?.type === "private"
      ? options.privateKey
      : crypto.createPrivateKey(options.privateKey);
  const publicKey =
    options.publicKey?.type === "public"
      ? options.publicKey
      : crypto.createPublicKey(options.publicKey);
  if (
    privateKey.asymmetricKeyType !== "ed25519" ||
    publicKey.asymmetricKeyType !== "ed25519"
  ) {
    throw new TypeError("Skill signatures require Ed25519 keys");
  }
  return {
    lockVersion: LOCK_VERSION,
    algorithm: "ed25519",
    manifest,
    signatureBase64: crypto
      .sign(null, Buffer.from(canonicalJson(manifest), "utf8"), privateKey)
      .toString("base64"),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

module.exports = {
  LOCK_FILENAME,
  MANIFEST_SCHEMA,
  preflightSkillPath,
  inspectSkillExecution,
  assertSkillHandlerExecution,
  captureExternalHandlerSource,
  buildSkillSignatureLock,
  canonicalJson,
  normalizeCapabilities,
};
