"use strict";

const path = require("node:path");
const secureConfigModule = require("../../../llm/secure-config-storage");

const STORE_VERSION = 1;
const MAX_SECRET_BYTES = 16 * 1024;
const BUNDLED_SKILL_CREDENTIAL_KEYS = Object.freeze([
  "google-client-id",
  "google-client-secret",
  "google-refresh-token",
  "google-access-token",
  "notion-api-key",
  "tavily-api-key",
]);

function credentialError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateCredentialKey(key) {
  if (typeof key !== "string" || !BUNDLED_SKILL_CREDENTIAL_KEYS.includes(key)) {
    throw credentialError(
      "CC_BUNDLED_SKILL_CREDENTIAL_KEY_DENIED",
      "Unsupported bundled Skill credential key",
    );
  }
  return key;
}

function validateCredentialValue(value) {
  if (
    typeof value !== "string" ||
    !value ||
    Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES
  ) {
    throw credentialError(
      "CC_BUNDLED_SKILL_CREDENTIAL_VALUE_INVALID",
      "A non-empty bounded bundled Skill credential is required",
    );
  }
  return value;
}

class BundledSkillCredentialStore {
  constructor(options = {}) {
    if (options.storage) {
      this.storage = options.storage;
      return;
    }
    const { app } = require("electron");
    const storagePath =
      options.storagePath ||
      path.join(app.getPath("userData"), "bundled-skill-credentials.enc");
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
        "CC_BUNDLED_SKILL_CREDENTIAL_STORE_INVALID",
        "Encrypted bundled Skill credential store is unavailable or invalid",
      );
    }

    const credentials = {};
    for (const [key, value] of Object.entries(stored.credentials)) {
      validateCredentialKey(key);
      credentials[key] = validateCredentialValue(value);
    }
    return { version: STORE_VERSION, credentials };
  }

  _save(payload) {
    if (this.storage.save?.(payload) !== true) {
      throw credentialError(
        "CC_BUNDLED_SKILL_CREDENTIAL_STORE_UNAVAILABLE",
        "Unable to persist encrypted bundled Skill credentials",
      );
    }
  }

  get(key) {
    return this._load().credentials[validateCredentialKey(key)] || null;
  }

  set(key, value) {
    const approvedKey = validateCredentialKey(key);
    const approvedValue = validateCredentialValue(value);
    const payload = this._load();
    payload.credentials[approvedKey] = approvedValue;
    this._save(payload);
    return true;
  }

  clear(key) {
    const approvedKey = validateCredentialKey(key);
    const payload = this._load();
    if (!payload.credentials[approvedKey]) {
      return true;
    }
    delete payload.credentials[approvedKey];
    this._save(payload);
    return true;
  }

  status() {
    const credentials = this._load().credentials;
    return Object.freeze(
      Object.fromEntries(
        BUNDLED_SKILL_CREDENTIAL_KEYS.map((key) => [
          key,
          Boolean(credentials[key]),
        ]),
      ),
    );
  }
}

let instance = null;

function getBundledSkillCredentialStore(options = {}) {
  if (!instance) {
    instance = new BundledSkillCredentialStore(options);
  }
  return instance;
}

function resetBundledSkillCredentialStoreForTest() {
  instance = null;
}

module.exports = {
  BUNDLED_SKILL_CREDENTIAL_KEYS,
  BundledSkillCredentialStore,
  getBundledSkillCredentialStore,
  resetBundledSkillCredentialStoreForTest,
  validateCredentialKey,
  validateCredentialValue,
};
