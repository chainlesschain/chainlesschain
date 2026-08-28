"use strict";

/**
 * Branded host authority for bundled Skill configuration and credentials.
 *
 * The trusted host supplies a synchronous `resolveValue` adapter backed by an
 * OS SecretStore, reviewed application configuration, or a minimal runtime
 * environment snapshot. Handlers cannot read `process.env`, choose new keys,
 * enumerate unrelated values, or construct their own authority.
 */

const { logger } = require("../../../utils/logger.js");

const MAX_AUTHORITY_ID_LENGTH = 256;
const MAX_SNAPSHOT_BYTES = 128 * 1024;
const MAX_VALUE_BYTES = Object.freeze({
  secret: 16 * 1024,
  path: 32 * 1024,
  config: 32 * 1024,
  runtime: 64 * 1024,
  rollout: 32 * 1024,
});
const RUNTIME_KEYS = Object.freeze({
  PATH: "runtime",
  Path: "runtime",
  PATHEXT: "runtime",
  SystemRoot: "runtime",
  WINDIR: "runtime",
  COMSPEC: "runtime",
  HOME: "runtime",
  USERPROFILE: "runtime",
  TMP: "runtime",
  TEMP: "runtime",
  LANG: "runtime",
  LC_ALL: "runtime",
});
const GRAPH_ROLLOUT_KEYS = Object.freeze({
  CHAINLESSCHAIN_GRAPH_DESKTOP: "rollout",
  CHAINLESSCHAIN_GRAPH_CUTOVER_STATE_DIR: "rollout",
  CHAINLESSCHAIN_DESKTOP_LEGACY_READ_ONLY: "rollout",
});

const BUNDLED_SKILL_ENVIRONMENT_POLICIES = Object.freeze({
  "api-gateway": Object.freeze({
    "config-directory": "path",
  }),
  "audio-transcriber": Object.freeze({
    "openai-api-key": "secret",
  }),
  "code-runner": RUNTIME_KEYS,
  "github-manager": Object.freeze({
    "github-token": "secret",
  }),
  "google-workspace": Object.freeze({
    "google-api-key": "secret",
    "google-client-id": "secret",
    "google-client-secret": "secret",
    "google-refresh-token": "secret",
    "google-access-token": "secret",
  }),
  "image-generator": Object.freeze({
    "stable-diffusion-endpoint": "config",
    "openai-api-key": "secret",
  }),
  notion: Object.freeze({
    "notion-api-key": "secret",
  }),
  obsidian: Object.freeze({
    "vault-directory": "path",
  }),
  "self-improving-agent": Object.freeze({
    "data-directory": "path",
  }),
  "skill-creator": RUNTIME_KEYS,
  "subtitle-generator": Object.freeze({
    "openai-api-key": "secret",
  }),
  "tavily-search": Object.freeze({
    "tavily-api-key": "secret",
  }),
  team: GRAPH_ROLLOUT_KEYS,
  "workflow-automation": GRAPH_ROLLOUT_KEYS,
});

const brokerMetadata = new WeakMap();

function environmentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function defaultAuditSink(entry) {
  logger.info("[bundled-skill-environment-broker]", entry);
}

function normalizePolicy(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw environmentError(
      "CC_BUNDLED_SKILL_ENVIRONMENT_POLICY_INVALID",
      "Bundled Skill environment authority policy is required",
    );
  }
  const skillId = String(options.skillId || "").trim();
  const values = BUNDLED_SKILL_ENVIRONMENT_POLICIES[skillId];
  if (!values) {
    throw environmentError(
      "CC_BUNDLED_SKILL_ENVIRONMENT_SKILL_DENIED",
      `Bundled Skill environment authority is not reviewed for ${skillId || "unknown"}`,
    );
  }
  const authorityId = String(options.authorityId || "").trim();
  if (!authorityId || authorityId.length > MAX_AUTHORITY_ID_LENGTH) {
    throw environmentError(
      "CC_BUNDLED_SKILL_ENVIRONMENT_AUTHORITY_REQUIRED",
      "A bounded environment authority decision ID is required",
    );
  }
  return Object.freeze({ skillId, authorityId, values });
}

function createBundledSkillEnvironmentBroker(options, deps = {}) {
  const policy = normalizePolicy(options);
  const resolveValue = deps.resolveValue;
  const auditSink = deps.auditSink || defaultAuditSink;
  if (typeof resolveValue !== "function") {
    throw environmentError(
      "CC_BUNDLED_SKILL_ENVIRONMENT_RESOLVER_REQUIRED",
      "A trusted SecretStore/configuration resolver is required",
    );
  }

  function audit(key, kind, present, outcome, reason = null) {
    auditSink(
      Object.freeze({
        event: "bundled-skill-environment-access",
        skillId: policy.skillId,
        authorityId: policy.authorityId,
        key,
        kind,
        present,
        outcome,
        ...(reason ? { reason } : {}),
      }),
    );
  }

  function get(key) {
    const normalizedKey = String(key || "").trim();
    const kind = policy.values[normalizedKey];
    if (!kind) {
      audit(
        normalizedKey || "invalid",
        "unknown",
        false,
        "denied",
        "key_denied",
      );
      throw environmentError(
        "CC_BUNDLED_SKILL_ENVIRONMENT_KEY_DENIED",
        `Environment value is not approved for ${policy.skillId}: ${normalizedKey || "invalid"}`,
      );
    }
    let value;
    try {
      value = resolveValue(
        Object.freeze({
          skillId: policy.skillId,
          key: normalizedKey,
          kind,
          authorityId: policy.authorityId,
        }),
      );
    } catch (error) {
      audit(normalizedKey, kind, false, "denied", "resolver_failed");
      throw error;
    }
    if (value == null || value === "") {
      audit(normalizedKey, kind, false, "allowed");
      return null;
    }
    if (typeof value !== "string") {
      audit(normalizedKey, kind, false, "denied", "value_type_invalid");
      throw environmentError(
        "CC_BUNDLED_SKILL_ENVIRONMENT_VALUE_INVALID",
        `Environment resolver returned a non-string value for ${normalizedKey}`,
      );
    }
    if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES[kind]) {
      audit(normalizedKey, kind, true, "denied", "value_too_large");
      throw environmentError(
        "CC_BUNDLED_SKILL_ENVIRONMENT_VALUE_TOO_LARGE",
        `Environment value exceeded the ${kind} limit for ${normalizedKey}`,
      );
    }
    audit(normalizedKey, kind, true, "allowed");
    return value;
  }

  function has(key) {
    return get(key) !== null;
  }

  function snapshot() {
    const result = {};
    let totalBytes = 0;
    for (const key of Object.keys(policy.values)) {
      const value = get(key);
      if (value !== null) {
        totalBytes += Buffer.byteLength(key, "utf8") + Buffer.byteLength(value);
        if (totalBytes > MAX_SNAPSHOT_BYTES) {
          audit(key, policy.values[key], true, "denied", "snapshot_too_large");
          throw environmentError(
            "CC_BUNDLED_SKILL_ENVIRONMENT_SNAPSHOT_TOO_LARGE",
            `Environment snapshot exceeded the aggregate limit for ${policy.skillId}`,
          );
        }
        result[key] = value;
      }
    }
    return Object.freeze(result);
  }

  const broker = Object.freeze({ get, has, snapshot });
  brokerMetadata.set(broker, policy);
  return broker;
}

function requireBundledSkillEnvironmentBroker(context, skillId) {
  const broker = context?.environmentBroker;
  const metadata =
    broker && typeof broker === "object" ? brokerMetadata.get(broker) : null;
  if (
    !metadata ||
    metadata.skillId !== skillId ||
    typeof broker.get !== "function" ||
    typeof broker.has !== "function" ||
    typeof broker.snapshot !== "function"
  ) {
    throw environmentError(
      "CC_BUNDLED_SKILL_ENVIRONMENT_BROKER_UNAVAILABLE",
      `Trusted environment authority is unavailable for ${skillId}; raw environment access is disabled`,
    );
  }
  return broker;
}

module.exports = {
  BUNDLED_SKILL_ENVIRONMENT_POLICIES,
  createBundledSkillEnvironmentBroker,
  requireBundledSkillEnvironmentBroker,
};
