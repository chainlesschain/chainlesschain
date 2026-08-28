"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const secureConfigModule = require("../llm/secure-config-storage");

const GIT_CREDENTIAL_REF_PREFIX = "cc-git-secret:v1:";
const STORE_VERSION = 1;
const MAX_CREDENTIAL_SCOPES = 64;
const MAX_SECRET_BYTES = 16 * 1024;
const SECRET_FIELDS = Object.freeze(["token", "password"]);

function credentialError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function scopeDigest(scope) {
  const value = String(scope || "").trim();
  if (!value || Buffer.byteLength(value, "utf8") > 512) {
    throw credentialError(
      "CC_GIT_CREDENTIAL_SCOPE_INVALID",
      "A bounded Git credential scope is required",
    );
  }
  return crypto.createHash("sha256").update(value).digest("hex");
}

function credentialRef(scope, field) {
  if (!SECRET_FIELDS.includes(field)) {
    throw credentialError(
      "CC_GIT_CREDENTIAL_FIELD_DENIED",
      "Unsupported Git credential field",
    );
  }
  return `${GIT_CREDENTIAL_REF_PREFIX}${scopeDigest(scope)}:${field}`;
}

function parseCredentialRef(reference) {
  if (
    typeof reference !== "string" ||
    !reference.startsWith(GIT_CREDENTIAL_REF_PREFIX)
  ) {
    throw credentialError(
      "CC_GIT_CREDENTIAL_REF_INVALID",
      "Git credential reference is missing or invalid",
    );
  }
  const suffix = reference.slice(GIT_CREDENTIAL_REF_PREFIX.length);
  const separator = suffix.lastIndexOf(":");
  const digest = suffix.slice(0, separator);
  const field = suffix.slice(separator + 1);
  if (!/^[a-f0-9]{64}$/u.test(digest) || !SECRET_FIELDS.includes(field)) {
    throw credentialError(
      "CC_GIT_CREDENTIAL_REF_INVALID",
      "Git credential reference is missing or invalid",
    );
  }
  return { digest, field };
}

function validateSecret(field, value) {
  if (!SECRET_FIELDS.includes(field)) {
    throw credentialError(
      "CC_GIT_CREDENTIAL_FIELD_DENIED",
      "Unsupported Git credential field",
    );
  }
  if (
    typeof value !== "string" ||
    !value ||
    Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES
  ) {
    throw credentialError(
      "CC_GIT_CREDENTIAL_VALUE_INVALID",
      `Git ${field} must be a non-empty bounded string`,
    );
  }
  return value;
}

class GitCredentialStore {
  constructor(options = {}) {
    if (options.storage) {
      this.storage = options.storage;
      return;
    }
    const { app } = require("electron");
    const storagePath =
      options.storagePath ||
      path.join(app.getPath("userData"), "git-credentials.enc");
    this.storage = new secureConfigModule.SecureConfigStorage({ storagePath });
  }

  _load() {
    const exists =
      typeof this.storage.exists !== "function" || this.storage.exists();
    if (!exists) {
      return { version: STORE_VERSION, credentials: {} };
    }
    const stored = this.storage.load?.(false);
    if (
      !stored ||
      stored.version !== STORE_VERSION ||
      !stored.credentials ||
      typeof stored.credentials !== "object" ||
      Array.isArray(stored.credentials)
    ) {
      throw credentialError(
        "CC_GIT_CREDENTIAL_STORE_INVALID",
        "Encrypted Git credential store is unavailable or invalid",
      );
    }
    const entries = Object.entries(stored.credentials);
    if (entries.length > MAX_CREDENTIAL_SCOPES) {
      throw credentialError(
        "CC_GIT_CREDENTIAL_STORE_INVALID",
        "Encrypted Git credential store exceeds its scope limit",
      );
    }
    const credentials = {};
    for (const [digest, values] of entries) {
      if (
        !/^[a-f0-9]{64}$/u.test(digest) ||
        !values ||
        typeof values !== "object" ||
        Array.isArray(values)
      ) {
        throw credentialError(
          "CC_GIT_CREDENTIAL_STORE_INVALID",
          "Encrypted Git credential store contains invalid entries",
        );
      }
      credentials[digest] = {};
      for (const field of SECRET_FIELDS) {
        if (values[field] != null) {
          credentials[digest][field] = validateSecret(field, values[field]);
        }
      }
    }
    return { version: STORE_VERSION, credentials };
  }

  _save(payload) {
    if (this.storage.save?.(payload) !== true) {
      throw credentialError(
        "CC_GIT_CREDENTIAL_STORE_UNAVAILABLE",
        "Unable to persist encrypted Git credentials",
      );
    }
  }

  set(scope, secrets) {
    if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
      throw credentialError(
        "CC_GIT_CREDENTIAL_VALUE_INVALID",
        "Git credentials must be an object",
      );
    }
    const digest = scopeDigest(scope);
    const payload = this._load();
    const current = payload.credentials[digest] || {};
    const next = { ...current };
    let updated = false;
    for (const field of SECRET_FIELDS) {
      if (secrets[field] != null && secrets[field] !== "") {
        next[field] = validateSecret(field, secrets[field]);
        updated = true;
      }
    }
    if (!updated) {
      throw credentialError(
        "CC_GIT_CREDENTIAL_VALUE_INVALID",
        "At least one Git credential secret is required",
      );
    }
    if (
      !payload.credentials[digest] &&
      Object.keys(payload.credentials).length >= MAX_CREDENTIAL_SCOPES
    ) {
      throw credentialError(
        "CC_GIT_CREDENTIAL_STORE_FULL",
        "Encrypted Git credential store reached its scope limit",
      );
    }
    payload.credentials[digest] = next;
    this._save(payload);
    return Object.freeze(
      Object.fromEntries(
        SECRET_FIELDS.filter((field) => next[field]).map((field) => [
          `${field}Ref`,
          credentialRef(scope, field),
        ]),
      ),
    );
  }

  get(reference) {
    const { digest, field } = parseCredentialRef(reference);
    return this._load().credentials[digest]?.[field] || null;
  }

  clear(scope) {
    const digest = scopeDigest(scope);
    const payload = this._load();
    if (!payload.credentials[digest]) {
      return true;
    }
    delete payload.credentials[digest];
    this._save(payload);
    return true;
  }

  clearAll() {
    this._save({ version: STORE_VERSION, credentials: {} });
    return true;
  }
}

let instance = null;

function getGitCredentialStore(options = {}) {
  if (!instance) {
    instance = new GitCredentialStore(options);
  }
  return instance;
}

function resetGitCredentialStoreForTest() {
  instance = null;
}

module.exports = {
  GIT_CREDENTIAL_REF_PREFIX,
  GitCredentialStore,
  credentialRef,
  getGitCredentialStore,
  parseCredentialRef,
  resetGitCredentialStoreForTest,
};
