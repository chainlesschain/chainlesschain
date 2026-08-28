"use strict";

/**
 * Production host adapter for bundled Skill filesystem authorities.
 *
 * The reviewed catalog owns the exact operation/root classes. Callers may
 * choose the configured workspace and approve an execution, but task/context
 * data cannot add roots or operations.
 */

const nodeCrypto = require("node:crypto");
const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");
const {
  BUNDLED_SKILL_CAPABILITY_CATALOG,
} = require("./bundled-skill-capability-catalog");
const {
  createBundledSkillFilesystemBroker,
} = require("./bundled-skill-filesystem-broker");

const AUTHORITY_ID_MAX_LENGTH = 256;
const SKILL_TEMP_DIRECTORY = "chainlesschain-bundled-skills";

function authorityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isWithinRoot(candidate, root) {
  const relative = nodePath.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${nodePath.sep}`) &&
      relative !== ".." &&
      !nodePath.isAbsolute(relative))
  );
}

function canonicalDirectory(directory, code) {
  if (typeof directory !== "string" || !directory.trim()) {
    throw authorityError(code, "A configured filesystem directory is required");
  }
  let canonical;
  try {
    canonical = nodeFs.realpathSync(nodePath.resolve(directory));
  } catch {
    throw authorityError(
      code,
      "The configured filesystem directory is unavailable",
    );
  }
  if (!nodeFs.statSync(canonical).isDirectory()) {
    throw authorityError(
      code,
      "The configured filesystem path is not a directory",
    );
  }
  return canonical;
}

function createNativeFilesystemAdapter(fsImpl = nodeFs) {
  const operations = Object.freeze({
    appendFileSync: (...args) => fsImpl.appendFileSync(...args),
    existsSync: (...args) => fsImpl.existsSync(...args),
    mkdtempSync: (...args) => fsImpl.mkdtempSync(...args),
    mkdirSync: (...args) => fsImpl.mkdirSync(...args),
    readFileSync: (...args) => fsImpl.readFileSync(...args),
    readdirSync: (...args) => fsImpl.readdirSync(...args),
    realpathSync: (...args) => fsImpl.realpathSync(...args),
    rmdirSync: (...args) => fsImpl.rmdirSync(...args),
    statSync: (...args) => fsImpl.statSync(...args),
    unlinkSync: (...args) => fsImpl.unlinkSync(...args),
    watch: (...args) => fsImpl.watch(...args),
    writeFileSync: (...args) => fsImpl.writeFileSync(...args),
  });
  return ({ operation, args }) => {
    const invoke = operations[operation];
    if (!invoke) {
      throw authorityError(
        "CC_BUNDLED_SKILL_FILESYSTEM_ADAPTER_OPERATION_DENIED",
        `The production filesystem adapter does not expose ${operation}`,
      );
    }
    return invoke(...args);
  };
}

function stableAuthorityId(skillId, workspaceRoot, executionDecision) {
  const supplied = String(
    executionDecision?.authorityId || executionDecision?.decisionId || "",
  ).trim();
  if (supplied && supplied.length <= AUTHORITY_ID_MAX_LENGTH) {
    return supplied;
  }
  const digest = nodeCrypto
    .createHash("sha256")
    .update(`${skillId}\0${workspaceRoot}\0${supplied}`)
    .digest("hex");
  return `workspace:${digest}`;
}

function createBundledSkillFilesystemAuthorityFactory(options = {}) {
  const workspaceResolver =
    typeof options.getWorkspacePath === "function"
      ? options.getWorkspacePath
      : () => options.workspacePath;
  const temporaryRoot = options.temporaryRoot || nodeOs.tmpdir();
  const invoke = createNativeFilesystemAdapter(options.fsImpl);

  return async function createFilesystemAuthority(request = {}) {
    const skillId = String(request.skillId || "").trim();
    const catalogEntry = BUNDLED_SKILL_CAPABILITY_CATALOG[skillId];
    if (
      !catalogEntry ||
      !Array.isArray(catalogEntry.filesystemOperations) ||
      catalogEntry.filesystemOperations.length === 0
    ) {
      throw authorityError(
        "CC_BUNDLED_SKILL_FILESYSTEM_POLICY_REQUIRED",
        `No reviewed filesystem policy exists for ${skillId || "unknown"}`,
      );
    }

    if (
      request.executionDecision?.approved !== true ||
      request.executionDecision?.policyAuthorized !== true
    ) {
      throw authorityError(
        "CC_BUNDLED_SKILL_FILESYSTEM_APPROVAL_REQUIRED",
        `An approved host execution decision is required for ${skillId}`,
      );
    }

    const workspaceRoot = canonicalDirectory(
      workspaceResolver(),
      "CC_BUNDLED_SKILL_FILESYSTEM_WORKSPACE_REQUIRED",
    );
    const requestedCwd =
      request.context?.projectRoot ||
      request.context?.workspaceRoot ||
      request.context?.workspacePath ||
      workspaceRoot;
    const cwd = canonicalDirectory(
      requestedCwd,
      "CC_BUNDLED_SKILL_FILESYSTEM_CWD_INVALID",
    );
    if (!isWithinRoot(cwd, workspaceRoot)) {
      throw authorityError(
        "CC_BUNDLED_SKILL_FILESYSTEM_CWD_DENIED",
        "The requested Skill working directory is outside the configured workspace",
      );
    }

    const allowedRoots = [];
    let filesystemTempRoot = null;
    for (const rootClass of catalogEntry.filesystemRoots) {
      if (rootClass === "workspace") {
        allowedRoots.push(workspaceRoot);
        continue;
      }
      if (rootClass === "skill-temporary") {
        const base = canonicalDirectory(
          temporaryRoot,
          "CC_BUNDLED_SKILL_FILESYSTEM_TEMPORARY_ROOT_REQUIRED",
        );
        const skillTempDirectory = nodePath.join(
          base,
          SKILL_TEMP_DIRECTORY,
          skillId,
        );
        nodeFs.mkdirSync(skillTempDirectory, {
          recursive: true,
          mode: 0o700,
        });
        filesystemTempRoot = canonicalDirectory(
          skillTempDirectory,
          "CC_BUNDLED_SKILL_FILESYSTEM_TEMPORARY_ROOT_REQUIRED",
        );
        allowedRoots.push(filesystemTempRoot);
        continue;
      }
      throw authorityError(
        "CC_BUNDLED_SKILL_FILESYSTEM_ROOT_CLASS_DENIED",
        `Unknown reviewed filesystem root class: ${rootClass}`,
      );
    }

    const filesystem = createBundledSkillFilesystemBroker(
      {
        skillId,
        authorityId: stableAuthorityId(
          skillId,
          workspaceRoot,
          request.executionDecision,
        ),
        allowedRoots,
        allowedOperations: [...catalogEntry.filesystemOperations],
        cwd,
      },
      {
        invoke,
        auditSink: options.auditSink,
      },
    );

    return Object.freeze({
      filesystem,
      workspaceRoot: cwd,
      filesystemTempRoot,
    });
  };
}

module.exports = {
  createBundledSkillFilesystemAuthorityFactory,
  createNativeFilesystemAdapter,
};
