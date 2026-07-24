/**
 * In-process credential reference agent.
 *
 * The process execution broker calls this module after a command is approved.
 * Long-lived credential values stay in the broker process while the child only
 * receives short-lived opaque references. Resolving a reference requires an
 * attested agent id and the exact process/host target recorded at issuance.
 *
 * This module deliberately does not claim to provide an OS IPC transport. A
 * future broker-owned IPC implementation can call resolveCredentialRef() after
 * it has authenticated the requesting process and destination host.
 */

import crypto from "node:crypto";

const REDACTED_VALUE = "***REDACTED***";
const DEFAULT_TTL_MS = 60_000;
const MAX_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_USES = 1;
const MAX_USES_LIMIT = 16;
const DEFAULT_MAX_CREDENTIALS = 4096;
const DEFAULT_MAX_AUDIT_ENTRIES = 10_000;

const CREDENTIAL_ERROR_CODES = Object.freeze({
  DISABLED: "CC_CREDENTIAL_AGENT_DISABLED",
  APPROVAL_REQUIRED: "CC_CREDENTIAL_APPROVAL_REQUIRED",
  TARGET_REQUIRED: "CC_CREDENTIAL_TARGET_REQUIRED",
  INVALID_REQUEST: "CC_CREDENTIAL_INVALID_REQUEST",
  STORE_FULL: "CC_CREDENTIAL_STORE_FULL",
  NOT_FOUND: "CC_CREDENTIAL_REF_NOT_FOUND",
  EXPIRED: "CC_CREDENTIAL_REF_EXPIRED",
  EXHAUSTED: "CC_CREDENTIAL_REF_EXHAUSTED",
  REVOKED: "CC_CREDENTIAL_REF_REVOKED",
  AGENT_MISMATCH: "CC_CREDENTIAL_AGENT_MISMATCH",
  TARGET_MISMATCH: "CC_CREDENTIAL_TARGET_MISMATCH",
});

// Patterns for environment variables that contain secrets.
const SENSITIVE_ENV_PATTERNS = [
  /API[_-]?KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /PRIVATE[_-]?KEY/i,
  /ACCESS[_-]?KEY/i,
  /AUTH/i,
  /COOKIE/i,
  /SESSION/i,
  /BEARER/i,
  /WEBHOOK.*URL/i,
  /DATABASE.*URL/i,
  /DATABASE.*PASSWORD/i,
  /REDIS.*PASSWORD/i,
  /OPENAI/i,
  /ANTHROPIC/i,
  /VOLC/i,
  /ZHIPU/i,
  /GOOGLE.*API/i,
  /AZURE.*KEY/i,
  /AWS.*SECRET/i,
  /GIT.*TOKEN/i,
  /NPM.*TOKEN/i,
  /GH_TOKEN/i,
  /GITHUB_TOKEN/i,
  /GITLAB_TOKEN/i,
];

// Keys that are always safe to pass through (non-sensitive).
const ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "PWD",
  "EDITOR",
  "VISUAL",
  "NODE_ENV",
  "NODE_OPTIONS",
  // These identify a run; they are not authentication credentials.
  "CC_SESSION_ID",
  "CLAUDE_CODE_SESSION_ID",
  "npm_config_registry",
  "npm_config_cache",
  "NPM_CONFIG_REGISTRY",
  "NPM_CONFIG_CACHE",
  "DISPLAY",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "WINDIR",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "COMPUTERNAME",
  "LOGONSERVER",
  "USERDOMAIN",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "PUBLIC",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMSPEC",
  "PATHEXT",
  "PSMODULEPATH",
  "CHAINLESSCHAIN_HOME",
  "CHAINLESSCHAIN_CONFIG_DIR",
]);

const RESERVED_AGENT_ENV_KEYS = new Set([
  "CC_CREDENTIAL_AGENT_ID",
  "CC_CREDENTIAL_PROXY",
  "CC_CREDENTIAL_TRANSPORT",
]);

function credentialError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isTruthyEnvironmentFlag(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const integer = Math.floor(parsed);
  if (integer <= 0) return fallback;
  return Math.min(integer, maximum);
}

function requestedPositiveInteger(value, fallback, maximum, fieldName) {
  if (value === undefined || value === null) {
    return Math.min(fallback, maximum);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw credentialError(
      CREDENTIAL_ERROR_CODES.INVALID_REQUEST,
      `${fieldName} must be a positive integer`,
    );
  }
  const integer = Math.floor(parsed);
  if (integer <= 0) {
    throw credentialError(
      CREDENTIAL_ERROR_CODES.INVALID_REQUEST,
      `${fieldName} must be a positive integer`,
    );
  }
  return Math.min(integer, maximum);
}

function normalizeProcessTarget(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return process.platform === "win32"
    ? normalized.replaceAll("/", "\\").toLowerCase()
    : normalized;
}

function normalizeHostTarget(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate) return null;

  try {
    const parsed = candidate.includes("://")
      ? new URL(candidate)
      : new URL(`https://${candidate}`);
    return parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return candidate.toLowerCase().replace(/\.$/, "");
  }
}

function cloneAuditEntry(entry) {
  return {
    ...entry,
    target: entry.target ? { ...entry.target } : undefined,
    envRedacted: entry.envRedacted ? [...entry.envRedacted] : undefined,
    argRedacted: entry.argRedacted ? [...entry.argRedacted] : undefined,
    reservedEnvRemoved: entry.reservedEnvRemoved
      ? [...entry.reservedEnvRemoved]
      : undefined,
  };
}

class CredentialAgent {
  constructor(options = {}) {
    this._credentialStore = new Map();
    this._accessLog = [];
    this._environment = options.env ?? process.env;
    this._now = typeof options.now === "function" ? options.now : Date.now;
    this._randomBytes =
      typeof options.randomBytes === "function"
        ? options.randomBytes
        : crypto.randomBytes;
    this._agentId = options.agentId || crypto.randomUUID();
    this._enabledOverride =
      typeof options.enabled === "boolean" ? options.enabled : undefined;
    this._maxTtlMs = positiveInteger(
      options.maxTtlMs,
      MAX_TTL_MS,
      Number.MAX_SAFE_INTEGER,
    );
    this._defaultTtlMs = Math.min(
      positiveInteger(options.defaultTtlMs, DEFAULT_TTL_MS, this._maxTtlMs),
      this._maxTtlMs,
    );
    this._maxUsesLimit = positiveInteger(
      options.maxUsesLimit,
      MAX_USES_LIMIT,
      Number.MAX_SAFE_INTEGER,
    );
    this._defaultMaxUses = Math.min(
      positiveInteger(
        options.defaultMaxUses,
        DEFAULT_MAX_USES,
        this._maxUsesLimit,
      ),
      this._maxUsesLimit,
    );
    this._maxCredentials = positiveInteger(
      options.maxCredentials,
      DEFAULT_MAX_CREDENTIALS,
      Number.MAX_SAFE_INTEGER,
    );
    this._maxAuditEntries = positiveInteger(
      options.maxAuditEntries,
      DEFAULT_MAX_AUDIT_ENTRIES,
      Number.MAX_SAFE_INTEGER,
    );

    // "broker-api" is an in-process primitive, not a socket/pipe endpoint.
    this._transport = "broker-api";
    this._proxyReady = false;
    this._lastEnabledState = this._computeEnabled();
  }

  _computeEnabled() {
    if (this._enabledOverride !== undefined) {
      return this._enabledOverride;
    }
    return !isTruthyEnvironmentFlag(this._environment?.CC_CRED_AGENT_DISABLE);
  }

  _syncEnabledState() {
    const enabled = this._computeEnabled();
    if (enabled === this._lastEnabledState) return enabled;

    if (!enabled) {
      let revoked = 0;
      for (const record of this._credentialStore.values()) {
        if (record.status === "active") {
          record.value = null;
          record.status = "disabled";
          revoked += 1;
        }
      }
      this._recordAudit({
        event: "credential_agent_disabled",
        outcome: "allowed",
        credentialsRevoked: revoked,
      });
    } else {
      this._recordAudit({
        event: "credential_agent_enabled",
        outcome: "allowed",
      });
    }

    this._lastEnabledState = enabled;
    return enabled;
  }

  /**
   * CC_CRED_AGENT_DISABLE accepts 1/true/yes/on (case-insensitive).
   *
   * Disabled means references cannot be issued or resolved. Environment and
   * argv filtering remains mandatory so disabling the agent can never restore
   * plaintext credential inheritance.
   */
  isEnabled() {
    return this._syncEnabledState();
  }

  /**
   * Build the explicit context the ProcessExecutionBroker should pass to
   * applyWithReport(). The caller remains responsible for attesting that the
   * approval and target describe the process it will actually launch.
   */
  createBrokerContext({
    approvalId,
    process: processTarget,
    host = null,
    ttlMs,
    maxUses,
  } = {}) {
    const normalizedProcess = normalizeProcessTarget(processTarget);
    if (!approvalId) {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.APPROVAL_REQUIRED,
        "Credential approval id is required",
      );
    }
    if (!normalizedProcess) {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.TARGET_REQUIRED,
        "Credential process target is required",
      );
    }

    return Object.freeze({
      approved: true,
      approvalId: String(approvalId),
      target: Object.freeze({
        process: normalizedProcess,
        host: normalizeHostTarget(host),
      }),
      ttlMs,
      maxUses,
    });
  }

  /**
   * Check if an env var key looks sensitive.
   */
  isSensitiveKey(key) {
    if (ENV_ALLOWLIST.has(key)) return false;
    return SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key));
  }

  isReservedAgentKey(key) {
    return (
      RESERVED_AGENT_ENV_KEYS.has(key) ||
      key.startsWith("CC_CRED_REF_") ||
      key.startsWith("CC_CRED_ARG_REF_")
    );
  }

  _recordAudit(entry) {
    this._accessLog.push({
      timestamp: this._now(),
      ...entry,
    });
    while (this._accessLog.length > this._maxAuditEntries) {
      this._accessLog.shift();
    }
  }

  _fingerprint(value) {
    if (!value) return null;
    return crypto
      .createHash("sha256")
      .update(String(value))
      .digest("hex")
      .slice(0, 16);
  }

  _expireStaleCredentials() {
    const now = this._now();
    for (const record of this._credentialStore.values()) {
      if (record.status === "active" && now >= record.expiresAt) {
        record.value = null;
        record.status = "expired";
      }
    }
  }

  _ensureStoreCapacity() {
    this._expireStaleCredentials();
    if (this._credentialStore.size < this._maxCredentials) return;

    for (const [refId, record] of this._credentialStore) {
      if (record.status !== "active") {
        this._credentialStore.delete(refId);
        if (this._credentialStore.size < this._maxCredentials) return;
      }
    }

    throw credentialError(
      CREDENTIAL_ERROR_CODES.STORE_FULL,
      "Credential reference store is full",
    );
  }

  _createReferenceId() {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const refId = `cc-cred-${this._randomBytes(16).toString("hex")}`;
      if (!this._credentialStore.has(refId)) return refId;
    }
    throw credentialError(
      CREDENTIAL_ERROR_CODES.STORE_FULL,
      "Unable to allocate a unique credential reference",
    );
  }

  _normalizeIssueRequest(request = {}) {
    const approval = request.approval || {};
    const target = request.target || {};
    const processTarget = normalizeProcessTarget(
      target.process ?? request.process,
    );
    const hostTarget = normalizeHostTarget(target.host ?? request.host);
    const approvalId = request.approvalId ?? approval.id;
    const approved = request.approved ?? approval.approved;

    return {
      approved,
      approvalId: approvalId ? String(approvalId) : null,
      key: String(request.key ?? "credential"),
      value: request.value,
      target: {
        process: processTarget,
        host: hostTarget,
      },
      ttlMs: requestedPositiveInteger(
        request.ttlMs,
        this._defaultTtlMs,
        this._maxTtlMs,
        "Credential TTL",
      ),
      maxUses: requestedPositiveInteger(
        request.maxUses,
        this._defaultMaxUses,
        this._maxUsesLimit,
        "Credential maxUses",
      ),
      origin: String(request.origin ?? "unknown"),
    };
  }

  /**
   * Issue a short-lived, target-bound reference.
   *
   * This is a parent/Broker API. A child must never be allowed to call it with
   * self-asserted approval metadata.
   */
  issueCredentialRef(request = {}) {
    if (!this.isEnabled()) {
      this._recordAudit({
        event: "credential_ref_issue",
        outcome: "denied",
        reason: CREDENTIAL_ERROR_CODES.DISABLED,
        key:
          request && typeof request === "object"
            ? String(request.key ?? "credential")
            : "credential",
      });
      throw credentialError(
        CREDENTIAL_ERROR_CODES.DISABLED,
        "Credential reference issuance is disabled",
      );
    }

    let normalized;
    try {
      if (!request || typeof request !== "object") {
        throw credentialError(
          CREDENTIAL_ERROR_CODES.INVALID_REQUEST,
          "Credential issuance request is required",
        );
      }
      normalized = this._normalizeIssueRequest(request);
    } catch (error) {
      this._recordAudit({
        event: "credential_ref_issue",
        outcome: "denied",
        reason: error.code || CREDENTIAL_ERROR_CODES.INVALID_REQUEST,
      });
      throw error;
    }

    if (normalized.approved !== true || !normalized.approvalId) {
      this._recordAudit({
        event: "credential_ref_issue",
        outcome: "denied",
        reason: CREDENTIAL_ERROR_CODES.APPROVAL_REQUIRED,
        key: normalized.key,
        target: normalized.target,
      });
      throw credentialError(
        CREDENTIAL_ERROR_CODES.APPROVAL_REQUIRED,
        "Credential reference requires an approved broker decision",
      );
    }
    if (!normalized.target.process) {
      this._recordAudit({
        event: "credential_ref_issue",
        outcome: "denied",
        reason: CREDENTIAL_ERROR_CODES.TARGET_REQUIRED,
        key: normalized.key,
      });
      throw credentialError(
        CREDENTIAL_ERROR_CODES.TARGET_REQUIRED,
        "Credential process target is required",
      );
    }
    if (normalized.value === undefined || normalized.value === null) {
      this._recordAudit({
        event: "credential_ref_issue",
        outcome: "denied",
        reason: CREDENTIAL_ERROR_CODES.INVALID_REQUEST,
        key: normalized.key,
        target: normalized.target,
      });
      throw credentialError(
        CREDENTIAL_ERROR_CODES.INVALID_REQUEST,
        "Credential value is required",
      );
    }

    let refId;
    try {
      this._ensureStoreCapacity();
      refId = this._createReferenceId();
    } catch (error) {
      this._recordAudit({
        event: "credential_ref_issue",
        outcome: "denied",
        reason: error.code || CREDENTIAL_ERROR_CODES.INVALID_REQUEST,
        key: normalized.key,
        target: normalized.target,
      });
      throw error;
    }
    const createdAt = this._now();
    this._credentialStore.set(refId, {
      key: normalized.key,
      value: normalized.value,
      createdAt,
      expiresAt: createdAt + normalized.ttlMs,
      maxUses: normalized.maxUses,
      useCount: 0,
      status: "active",
      target: normalized.target,
      approvalFingerprint: this._fingerprint(normalized.approvalId),
    });
    this._recordAudit({
      event: "credential_ref_issue",
      outcome: "allowed",
      key: normalized.key,
      target: normalized.target,
      refFingerprint: this._fingerprint(refId),
      approvalFingerprint: this._fingerprint(normalized.approvalId),
      ttlMs: normalized.ttlMs,
      maxUses: normalized.maxUses,
      origin: normalized.origin,
    });
    return refId;
  }

  _assertResolutionTarget(record, request) {
    if (request.agentId !== this._agentId) {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.AGENT_MISMATCH,
        "Credential agent identity does not match",
      );
    }

    const requestTarget = {
      process: normalizeProcessTarget(
        request.target?.process ?? request.process,
      ),
      host: normalizeHostTarget(request.target?.host ?? request.host),
    };
    if (
      !requestTarget.process ||
      requestTarget.process !== record.target.process ||
      requestTarget.host !== record.target.host
    ) {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.TARGET_MISMATCH,
        "Credential resolution target does not match",
      );
    }
  }

  _throwStoredCredentialState(record) {
    if (record.status === "expired") {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.EXPIRED,
        "Credential reference has expired",
      );
    }
    if (record.status === "exhausted") {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.EXHAUSTED,
        "Credential reference usage limit has been reached",
      );
    }
    throw credentialError(
      CREDENTIAL_ERROR_CODES.REVOKED,
      "Credential reference has been revoked",
    );
  }

  /**
   * Resolve a reference for a Broker-attested request.
   *
   * The raw value is returned only to the trusted caller. An eventual IPC
   * adapter must authenticate the OS process and host before constructing this
   * request object; child-provided claims are not sufficient attestation.
   */
  resolveCredentialRef(refId, request = {}) {
    const refFingerprint = this._fingerprint(refId);
    if (!this.isEnabled()) {
      this._recordAudit({
        event: "credential_ref_resolve",
        outcome: "denied",
        reason: CREDENTIAL_ERROR_CODES.DISABLED,
        refFingerprint,
      });
      throw credentialError(
        CREDENTIAL_ERROR_CODES.DISABLED,
        "Credential reference resolution is disabled",
      );
    }

    this._expireStaleCredentials();
    const record =
      typeof refId === "string" ? this._credentialStore.get(refId) : null;
    if (!record) {
      this._recordAudit({
        event: "credential_ref_resolve",
        outcome: "denied",
        reason: CREDENTIAL_ERROR_CODES.NOT_FOUND,
        refFingerprint,
      });
      throw credentialError(
        CREDENTIAL_ERROR_CODES.NOT_FOUND,
        "Credential reference was not found",
      );
    }

    if (record.status !== "active") {
      const code =
        record.status === "expired"
          ? CREDENTIAL_ERROR_CODES.EXPIRED
          : record.status === "exhausted"
            ? CREDENTIAL_ERROR_CODES.EXHAUSTED
            : CREDENTIAL_ERROR_CODES.REVOKED;
      this._recordAudit({
        event: "credential_ref_resolve",
        outcome: "denied",
        reason: code,
        key: record.key,
        target: record.target,
        refFingerprint,
      });
      this._throwStoredCredentialState(record);
    }

    try {
      this._assertResolutionTarget(
        record,
        request && typeof request === "object" ? request : {},
      );
    } catch (error) {
      this._recordAudit({
        event: "credential_ref_resolve",
        outcome: "denied",
        reason: error.code || CREDENTIAL_ERROR_CODES.INVALID_REQUEST,
        key: record.key,
        target: record.target,
        refFingerprint,
      });
      throw error;
    }

    const value = record.value;
    record.useCount += 1;
    const remainingUses = record.maxUses - record.useCount;
    if (remainingUses <= 0) {
      record.value = null;
      record.status = "exhausted";
    }
    this._recordAudit({
      event: "credential_ref_resolve",
      outcome: "allowed",
      key: record.key,
      target: record.target,
      refFingerprint,
      useCount: record.useCount,
      remainingUses: Math.max(remainingUses, 0),
    });
    return value;
  }

  /** Strict backward-compatible name for callers migrating to the new API. */
  resolveCredential(refId, request = {}) {
    return this.resolveCredentialRef(refId, request);
  }

  revokeCredentialRef(refId, reason = "broker-revoked") {
    const record = this._credentialStore.get(refId);
    if (!record) return false;
    record.value = null;
    record.status = "revoked";
    this._recordAudit({
      event: "credential_ref_revoke",
      outcome: "allowed",
      reason: "broker-revoked",
      reasonFingerprint: this._fingerprint(reason),
      key: record.key,
      target: record.target,
      refFingerprint: this._fingerprint(refId),
    });
    return true;
  }

  _contextForSpawn(spawnOptions) {
    if (
      Object.prototype.hasOwnProperty.call(spawnOptions, "credentialContext")
    ) {
      const supplied = spawnOptions.credentialContext || {};
      return {
        approved: supplied.approved === true,
        approvalId: supplied.approvalId,
        target: {
          process:
            supplied.target?.process ??
            supplied.process ??
            spawnOptions.file ??
            spawnOptions.command,
          host: supplied.target?.host ?? supplied.host ?? null,
        },
        ttlMs: supplied.ttlMs,
        maxUses: supplied.maxUses,
        origin: spawnOptions.origin,
      };
    }

    const processTarget = spawnOptions.file ?? spawnOptions.command;
    if (!normalizeProcessTarget(processTarget)) return null;

    /*
     * Compatibility bridge for the current ProcessExecutionBroker: it invokes
     * applyWithReport only after an allow/elevated decision but does not yet
     * forward the decision id. The intended integration is to pass the result
     * of createBrokerContext() as credentialContext.
     */
    return {
      approved: spawnOptions.credentialApproved !== false,
      approvalId:
        spawnOptions.credentialApprovalId ||
        `broker-boundary:${spawnOptions.origin || "unknown"}`,
      target: {
        process: processTarget,
        host:
          spawnOptions.credentialTarget?.host ??
          spawnOptions.credentialTargetHost ??
          null,
      },
      ttlMs: spawnOptions.credentialTtlMs,
      maxUses: spawnOptions.credentialMaxUses,
      origin: spawnOptions.origin,
    };
  }

  _canIssueForContext(context) {
    return Boolean(
      context?.approved === true &&
      context.approvalId &&
      normalizeProcessTarget(context.target?.process ?? context.process),
    );
  }

  _setReferenceMarkers(safeEnv) {
    safeEnv.CC_CREDENTIAL_AGENT_ID = this._agentId;
    safeEnv.CC_CREDENTIAL_TRANSPORT = this._transport;
  }

  /**
   * Strip sensitive and reserved environment variables from spawn options.
   */
  filterEnvironment(env = process.env, context = null) {
    const safeEnv = {};
    const redacted = [];
    const reservedRemoved = [];
    const enabled = this.isEnabled();
    let refsIssued = 0;

    for (const [key, value] of Object.entries(env || {})) {
      if (this.isReservedAgentKey(key)) {
        reservedRemoved.push(key);
        continue;
      }
      if (!this.isSensitiveKey(key)) {
        safeEnv[key] = value;
        continue;
      }

      const entry = { key, refIssued: false };
      if (
        enabled &&
        this._canIssueForContext(context) &&
        value !== undefined &&
        value !== null
      ) {
        const refId = this.issueCredentialRef({
          ...context,
          key,
          value,
        });
        safeEnv[`CC_CRED_REF_${key}`] = refId;
        entry.refIssued = true;
        refsIssued += 1;
      }
      redacted.push(entry);
    }

    if (refsIssued > 0) this._setReferenceMarkers(safeEnv);
    return {
      safeEnv,
      redacted,
      reservedRemoved,
      refsIssued,
    };
  }

  _sanitizeArgsWithSecrets(args = []) {
    const sanitizedArgs = [];
    const redacted = [];
    const inputArgs = Array.isArray(args) ? args : [];
    const secretOption =
      /^--[^=]*(?:token|api[-_]?key|secret|password|passwd|credential)[^=]*$/i;

    for (let index = 0; index < inputArgs.length; index += 1) {
      const arg = String(inputArgs[index]);
      const equalsIndex = arg.indexOf("=");
      const optionName = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;

      if (equalsIndex >= 0 && secretOption.test(optionName)) {
        sanitizedArgs.push(`${optionName}=${REDACTED_VALUE}`);
        redacted.push({
          index,
          pattern: "arg-with-secret",
          secrets: [
            {
              key: optionName.replace(/^--/, "") || `argv-${index}`,
              value: arg.slice(equalsIndex + 1),
            },
          ],
        });
        continue;
      }

      if (secretOption.test(arg) && index + 1 < inputArgs.length) {
        sanitizedArgs.push(arg, REDACTED_VALUE);
        redacted.push({
          index: index + 1,
          pattern: "arg-after-secret-option",
          secrets: [
            {
              key: arg.replace(/^--/, "") || `argv-${index + 1}`,
              value: String(inputArgs[index + 1]),
            },
          ],
        });
        index += 1;
        continue;
      }

      if (arg === "-H" || /^--header$/i.test(arg)) {
        sanitizedArgs.push(arg);
        if (index + 1 < inputArgs.length) {
          const headerArg = String(inputArgs[index + 1]);
          const headerMatch = headerArg.match(
            /^(Authorization|Proxy-Authorization|X-API-Key|Cookie|Set-Cookie)\s*:\s*(.*)$/i,
          );
          if (headerMatch) {
            sanitizedArgs.push(`${headerMatch[1]}: ${REDACTED_VALUE}`);
            redacted.push({
              index: index + 1,
              pattern: "header-with-secret",
              secrets: [
                {
                  key: `header-${headerMatch[1].toLowerCase()}`,
                  value: headerMatch[2],
                },
              ],
            });
            index += 1;
          }
        }
        continue;
      }

      const directHeaderMatch = arg.match(
        /^(Authorization|Proxy-Authorization|X-API-Key|Cookie|Set-Cookie)\s*:\s*(.*)$/i,
      );
      if (directHeaderMatch) {
        sanitizedArgs.push(`${directHeaderMatch[1]}: ${REDACTED_VALUE}`);
        redacted.push({
          index,
          pattern: "header-with-secret",
          secrets: [
            {
              key: `header-${directHeaderMatch[1].toLowerCase()}`,
              value: directHeaderMatch[2],
            },
          ],
        });
        continue;
      }

      const inlineSecrets = [];
      let sanitized = arg.replace(
        /Bearer\s+([A-Za-z0-9._-]{20,})/g,
        (_match, value) => {
          inlineSecrets.push({
            key: `argv-${index}-bearer`,
            value,
          });
          return `Bearer ${REDACTED_VALUE}`;
        },
      );
      sanitized = sanitized.replace(
        /\bsk-([A-Za-z0-9]{20,})\b/g,
        (_match, value) => {
          inlineSecrets.push({
            key: `argv-${index}-sk-key`,
            value: `sk-${value}`,
          });
          return `sk-${REDACTED_VALUE}`;
        },
      );
      sanitizedArgs.push(sanitized);
      if (inlineSecrets.length > 0) {
        redacted.push({
          index,
          pattern: "inline-secret",
          secrets: inlineSecrets,
        });
      }
    }

    return { sanitizedArgs, redacted };
  }

  /**
   * Sanitize command line arguments without exposing captured values.
   */
  sanitizeArgs(args = []) {
    const { sanitizedArgs, redacted } = this._sanitizeArgsWithSecrets(args);
    return {
      sanitizedArgs,
      redacted: redacted.map(({ index, pattern }) => ({
        index,
        pattern,
      })),
    };
  }

  /**
   * Apply filtering and issue references for a broker-approved spawn.
   */
  applyWithReport(spawnOptions) {
    if (!spawnOptions || typeof spawnOptions !== "object") {
      throw credentialError(
        CREDENTIAL_ERROR_CODES.INVALID_REQUEST,
        "Spawn options are required",
      );
    }

    const context = this._contextForSpawn(spawnOptions);
    const env = spawnOptions.env || process.env;
    const {
      safeEnv,
      redacted: envRedacted,
      reservedRemoved,
      refsIssued: envRefsIssued,
    } = this.filterEnvironment(env, context);

    const args = spawnOptions.args || [];
    const { sanitizedArgs, redacted: internalArgRedacted } =
      this._sanitizeArgsWithSecrets(args);

    let argRefsIssued = 0;
    if (this.isEnabled() && this._canIssueForContext(context)) {
      for (const entry of internalArgRedacted) {
        for (
          let secretIndex = 0;
          secretIndex < entry.secrets.length;
          secretIndex += 1
        ) {
          const secret = entry.secrets[secretIndex];
          const refId = this.issueCredentialRef({
            ...context,
            key: secret.key,
            value: secret.value,
          });
          const suffix = secretIndex === 0 ? "" : `_${secretIndex}`;
          safeEnv[`CC_CRED_ARG_REF_${entry.index}${suffix}`] = refId;
          argRefsIssued += 1;
        }
      }
    }

    const refsIssued = envRefsIssued + argRefsIssued;
    if (refsIssued > 0) this._setReferenceMarkers(safeEnv);
    spawnOptions.env = safeEnv;
    spawnOptions.args = sanitizedArgs;

    const envKeys = envRedacted.map((entry) => entry.key);
    const argIndexes = internalArgRedacted.map((entry) => entry.index);
    const filtered =
      envRedacted.length > 0 ||
      internalArgRedacted.length > 0 ||
      reservedRemoved.length > 0;
    const enabled = this.isEnabled();

    if (filtered) {
      this._recordAudit({
        event: "credential_boundary_apply",
        outcome: "allowed",
        origin: String(spawnOptions.origin || "unknown"),
        target: context
          ? {
              process: normalizeProcessTarget(
                context.target?.process ?? context.process,
              ),
              host: normalizeHostTarget(context.target?.host ?? context.host),
            }
          : null,
        envRedacted: envKeys,
        argRedacted: argIndexes,
        reservedEnvRemoved: reservedRemoved,
        refsIssued,
        mode: enabled
          ? refsIssued > 0
            ? "broker-reference"
            : "redact-only"
          : "redact-only-disabled",
      });
    }

    return {
      spawnOptions,
      report: {
        envKeys,
        argIndexes,
        envCount: envRedacted.length,
        argCount: internalArgRedacted.length,
        filtered,
        refsIssued,
        agentDisabled: !enabled,
        mode: enabled
          ? refsIssued > 0
            ? "broker-reference"
            : "redact-only"
          : "redact-only-disabled",
        targetBound: refsIssued > 0,
      },
    };
  }

  /** Backward-compatible mutation API for existing integrations. */
  apply(spawnOptions) {
    return this.applyWithReport(spawnOptions).spawnOptions;
  }

  getAuditLog(limit = this._accessLog.length) {
    const safeLimit = Math.max(
      0,
      Math.min(Number(limit) || 0, this._accessLog.length),
    );
    if (safeLimit === 0) return [];
    return this._accessLog.slice(-safeLimit).map(cloneAuditEntry);
  }

  clearAuditLog() {
    this._accessLog = [];
  }

  /**
   * Get credential agent info for status reporting. No raw references or
   * credential values are included.
   */
  getInfo() {
    this.isEnabled();
    this._expireStaleCredentials();
    const statusCounts = {};
    for (const record of this._credentialStore.values()) {
      statusCounts[record.status] = (statusCounts[record.status] || 0) + 1;
    }
    return {
      agentId: this._agentId,
      enabled: this._lastEnabledState,
      mode: this._lastEnabledState
        ? "broker-reference"
        : "redact-only-disabled",
      transport: this._transport,
      proxyReady: this._proxyReady,
      ipcAvailable: false,
      credentialsTracked: this._credentialStore.size,
      activeCredentials: statusCounts.active || 0,
      accessCount: this._accessLog.length,
      sensitivePatterns: SENSITIVE_ENV_PATTERNS.length,
      allowlistSize: ENV_ALLOWLIST.size,
      defaultTtlMs: this._defaultTtlMs,
      defaultMaxUses: this._defaultMaxUses,
      defaultOn: true,
    };
  }
}

const credentialAgent = new CredentialAgent();

export {
  credentialAgent,
  CredentialAgent,
  CREDENTIAL_ERROR_CODES,
  SENSITIVE_ENV_PATTERNS,
  ENV_ALLOWLIST,
};
export default credentialAgent;
