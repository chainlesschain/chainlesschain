"use strict";

/**
 * Production resolver for reviewed bundled Skill environment values.
 *
 * Secrets are resolved from the safeStorage-backed LLM configuration or an
 * explicitly injected host SecretStore resolver. Runtime/rollout values use
 * only the broker's reviewed key list; arbitrary process.env access is never
 * exposed to a handler.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const {
  BUNDLED_SKILL_ENVIRONMENT_POLICIES,
  createBundledSkillEnvironmentBroker,
} = require("./bundled-skill-environment-broker");

const DEFAULT_PATHS = Object.freeze({
  "config-directory": [".chainlesschain", "api-gateway"],
  "vault-directory": [],
  "data-directory": [".chainlesschain", "self-improving-agent"],
});
const DEFAULT_CONFIG = Object.freeze({
  "stable-diffusion-endpoint": "http://127.0.0.1:7860",
});

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

function canonicalWorkspace(workspacePath) {
  if (typeof workspacePath !== "string" || !workspacePath.trim()) {
    throw authorityError(
      "CC_BUNDLED_SKILL_ENVIRONMENT_WORKSPACE_REQUIRED",
      "A configured workspace directory is required",
    );
  }
  let workspaceRoot;
  try {
    workspaceRoot = nodeFs.realpathSync(nodePath.resolve(workspacePath));
  } catch {
    throw authorityError(
      "CC_BUNDLED_SKILL_ENVIRONMENT_WORKSPACE_REQUIRED",
      "The configured workspace directory is unavailable",
    );
  }
  if (!nodeFs.statSync(workspaceRoot).isDirectory()) {
    throw authorityError(
      "CC_BUNDLED_SKILL_ENVIRONMENT_WORKSPACE_REQUIRED",
      "The configured workspace path is not a directory",
    );
  }
  return workspaceRoot;
}

function createDefaultSecretResolver(options = {}) {
  const llmConfigResolver =
    options.getLLMConfig ||
    (() => {
      const { getLLMConfig } = require("../../../llm/llm-config");
      return getLLMConfig();
    });
  const gitConfigResolver =
    options.getGitConfig ||
    (() => {
      const { getGitConfig } = require("../../../git/git-config");
      return getGitConfig();
    });
  const bundledSkillCredentialStoreResolver =
    options.getBundledSkillCredentialStore ||
    (() => {
      const {
        getBundledSkillCredentialStore,
      } = require("./bundled-skill-credential-store");
      return getBundledSkillCredentialStore();
    });

  return function resolveDefaultSecret({ key }) {
    if (key === "openai-api-key") {
      return llmConfigResolver().get("openai.apiKey", null) || null;
    }
    if (key === "google-api-key") {
      return llmConfigResolver().get("google.apiKey", null) || null;
    }
    if (key === "github-token") {
      return gitConfigResolver().getAuth()?.token || null;
    }
    if (
      [
        "google-client-id",
        "google-client-secret",
        "google-refresh-token",
        "google-access-token",
        "notion-api-key",
        "tavily-api-key",
      ].includes(key)
    ) {
      return bundledSkillCredentialStoreResolver().get(key) || null;
    }
    return null;
  };
}

function createBundledSkillEnvironmentAuthorityFactory(options = {}) {
  const workspaceResolver =
    typeof options.getWorkspacePath === "function"
      ? options.getWorkspacePath
      : () => options.workspacePath;
  const secretResolver =
    options.secretResolver || createDefaultSecretResolver(options);
  const configResolver = options.configResolver || (() => null);
  const pathResolver = options.pathResolver || (() => null);
  const runtimeEnvironment = options.runtimeEnvironment || process.env;
  const rolloutEnvironment = options.rolloutEnvironment || process.env;

  return async function createEnvironmentAuthority(request = {}) {
    const skillId = String(request.skillId || "").trim();
    if (!BUNDLED_SKILL_ENVIRONMENT_POLICIES[skillId]) {
      throw authorityError(
        "CC_BUNDLED_SKILL_ENVIRONMENT_POLICY_REQUIRED",
        `No reviewed environment policy exists for ${skillId || "unknown"}`,
      );
    }
    if (
      request.executionDecision?.approved !== true ||
      request.executionDecision?.policyAuthorized !== true
    ) {
      throw authorityError(
        "CC_BUNDLED_SKILL_ENVIRONMENT_APPROVAL_REQUIRED",
        `An approved host execution decision is required for ${skillId}`,
      );
    }

    const workspaceRoot = canonicalWorkspace(workspaceResolver());
    const resolveValue = ({ key, kind, authorityId }) => {
      if (kind === "secret") {
        return secretResolver({ skillId, key, kind, authorityId }) ?? null;
      }
      if (kind === "runtime") {
        return runtimeEnvironment[key] ?? null;
      }
      if (kind === "rollout") {
        return rolloutEnvironment[key] ?? null;
      }
      if (kind === "config") {
        return (
          configResolver({ skillId, key, kind, authorityId, workspaceRoot }) ??
          DEFAULT_CONFIG[key] ??
          null
        );
      }
      if (kind === "path") {
        const configured = pathResolver({
          skillId,
          key,
          kind,
          authorityId,
          workspaceRoot,
        });
        const pathSegments = DEFAULT_PATHS[key];
        const candidate = configured
          ? nodePath.resolve(configured)
          : Array.isArray(pathSegments)
            ? nodePath.join(workspaceRoot, ...pathSegments)
            : null;
        if (!candidate || !isWithinRoot(candidate, workspaceRoot)) {
          throw authorityError(
            "CC_BUNDLED_SKILL_ENVIRONMENT_PATH_DENIED",
            `Configured path is outside the approved workspace for ${skillId}`,
          );
        }
        return candidate;
      }
      throw authorityError(
        "CC_BUNDLED_SKILL_ENVIRONMENT_KIND_DENIED",
        `Unsupported environment value kind: ${kind}`,
      );
    };

    return createBundledSkillEnvironmentBroker(
      {
        skillId,
        authorityId: request.executionDecision.authorityId,
      },
      {
        resolveValue,
        auditSink: options.auditSink,
      },
    );
  };
}

module.exports = {
  createBundledSkillEnvironmentAuthorityFactory,
  createDefaultSecretResolver,
};
