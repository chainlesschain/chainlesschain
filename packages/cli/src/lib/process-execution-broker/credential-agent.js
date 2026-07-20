/**
 * Credential Agent — P0-1 requirement
 *
 * Secrets are never passed raw to child processes. Instead:
 * - Environment variables are filtered (API keys, tokens stripped)
 * - Credentials are injected via a proxy/agent at runtime
 * - Audit log records credential usage without revealing values
 * - Child processes request credentials through IPC channel
 *
 * References: Claude Code CredentialAgent pattern
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// Patterns for environment variables that contain secrets
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

// Keys that are always safe to pass through (non-sensitive)
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

class CredentialAgent {
  constructor() {
    this._credentialStore = new Map();
    this._accessLog = [];
    this._agentId = crypto.randomUUID();
    this._credentialProxyPath = null;
    this._setupProxy();
  }

  _setupProxy() {
    // In a full implementation, we'd set up an IPC/UDS proxy
    // For now, we track and filter
    this._proxyReady = true;
  }

  /**
   * Check if an env var key looks sensitive
   */
  isSensitiveKey(key) {
    if (ENV_ALLOWLIST.has(key)) return false;
    return SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key));
  }

  /**
   * Strip sensitive environment variables from spawn options
   * Returns filtered env and a list of redacted keys
   */
  filterEnvironment(env = process.env) {
    const safe = {};
    const redacted = [];

    for (const [key, value] of Object.entries(env)) {
      if (this.isSensitiveKey(key)) {
        // Store a masked reference instead of passing through
        const refId = `cc-cred-${crypto.randomBytes(8).toString("hex")}`;
        this._credentialStore.set(refId, { key, value, createdAt: Date.now() });
        redacted.push({ key, refId });
        // Pass the reference ID, child can request via proxy
        safe[`CC_CRED_REF_${key}`] = refId;
      } else {
        safe[key] = value;
      }
    }

    // Set credential proxy endpoint for the child process
    safe.CC_CREDENTIAL_AGENT_ID = this._agentId;
    safe.CC_CREDENTIAL_PROXY = "builtin";

    return { safeEnv: safe, redacted };
  }

  /**
   * Sanitize command line arguments that might contain secrets
   * (e.g., curl -H "Authorization: Bearer sk-xxx")
   */
  sanitizeArgs(args = []) {
    const sanitized = [];
    const redacted = [];

    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]);

      // Check for --token=xxx or --api-key xxx patterns
      if (/^--[a-z-]*([Tt]oken|[Kk]ey|[Ss]ecret|[Pp]assword)=/i.test(arg)) {
        sanitized.push(arg.replace(/=.*/, "=***REDACTED***"));
        redacted.push({ index: i, pattern: "arg-with-secret" });
        continue;
      }

      // Check for -H "Authorization: Bearer xxx"
      if (arg === "-H" || /^--header$/i.test(arg)) {
        sanitized.push(arg);
        if (i + 1 < args.length) {
          const nextArg = String(args[i + 1]);
          if (/^(Authorization|X-API-Key|Cookie|Set-Cookie):/i.test(nextArg)) {
            sanitized.push(`${nextArg.split(":")[0]}: ***REDACTED***`);
            redacted.push({ index: i + 1, pattern: "header-with-secret" });
            i++; // skip next
            continue;
          }
        }
        continue;
      }

      // Check for inline Bearer tokens
      if (/Bearer\s+[A-Za-z0-9._-]{20,}/.test(arg)) {
        sanitized.push(
          arg.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***REDACTED***"),
        );
        redacted.push({ index: i, pattern: "bearer-token-inline" });
        continue;
      }

      // Check for sk- prefixed keys (OpenAI style)
      if (/\bsk-[A-Za-z0-9]{20,}\b/.test(arg)) {
        sanitized.push(
          arg.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, "sk-***REDACTED***"),
        );
        redacted.push({ index: i, pattern: "sk-key-inline" });
        continue;
      }

      sanitized.push(arg);
    }

    return { sanitizedArgs: sanitized, redacted };
  }

  /**
   * Apply credential filtering to spawn options
   */
  apply(spawnOptions) {
    const env = spawnOptions.env || process.env;
    const { safeEnv, redacted: envRedacted } = this.filterEnvironment(env);
    spawnOptions.env = safeEnv;

    const args = spawnOptions.args || [];
    const { sanitizedArgs, redacted: argRedacted } = this.sanitizeArgs(args);
    spawnOptions.args = sanitizedArgs;

    // Record credential access audit
    if (envRedacted.length > 0 || argRedacted.length > 0) {
      this._accessLog.push({
        timestamp: Date.now(),
        origin: spawnOptions.origin || "unknown",
        envRedacted: envRedacted.map((r) => r.key),
        argRedacted: argRedacted.length,
        command: spawnOptions.file || spawnOptions.command,
      });
      if (this._accessLog.length > 10000) this._accessLog.shift();
    }

    return spawnOptions;
  }

  /**
   * Resolve a credential reference (called via IPC from child processes)
   */
  resolveCredential(refId) {
    const cred = this._credentialStore.get(refId);
    if (!cred) return null;
    // Log access
    this._accessLog.push({
      timestamp: Date.now(),
      type: "resolve",
      refId,
      key: cred.key,
    });
    return cred.value;
  }

  /**
   * Get credential agent info for status reporting
   */
  getInfo() {
    return {
      agentId: this._agentId,
      credentialsTracked: this._credentialStore.size,
      accessCount: this._accessLog.length,
      sensitivePatterns: SENSITIVE_ENV_PATTERNS.length,
      allowlistSize: ENV_ALLOWLIST.size,
      defaultOn: true,
    };
  }
}

const credentialAgent = new CredentialAgent();
export {
  credentialAgent,
  CredentialAgent,
  SENSITIVE_ENV_PATTERNS,
  ENV_ALLOWLIST,
};
export default credentialAgent;
