"use strict";

const { logger } = require("../utils/logger.js");
const crypto = require("crypto");
const secureConfigModule = require("../llm/secure-config-storage");
const {
  EmailIPCBoundaryError,
  assertBoundedString,
  createEmailIPCLimits,
} = require("./email-ipc-boundaries.js");

const EMAIL_CREDENTIAL_REF_PREFIX = "cc-email-secret:v1:";

class EmailCredentialStore {
  constructor(options = {}) {
    this.storage =
      options.storage ||
      (options.storagePath
        ? new secureConfigModule.SecureConfigStorage({
            storagePath: options.storagePath,
          })
        : secureConfigModule.getSecureConfigStorage());
    this.limits = createEmailIPCLimits(options.limits || options);
  }

  credentialRef(accountId) {
    return `${EMAIL_CREDENTIAL_REF_PREFIX}${this.credentialKey(accountId)}`;
  }

  credentialKey(accountId) {
    const id = assertBoundedString(
      accountId,
      "email_account_id",
      this.limits.maxIdBytes,
    );
    return crypto.createHash("sha256").update(id).digest("hex");
  }

  isCredentialRef(value) {
    return (
      typeof value === "string" && value.startsWith(EMAIL_CREDENTIAL_REF_PREFIX)
    );
  }

  loadAll() {
    try {
      const exists =
        typeof this.storage.exists !== "function" || this.storage.exists();
      if (!exists) {
        return {};
      }
      const config = this.storage.load?.();
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("Encrypted config root is not an object");
      }
      return config;
    } catch (error) {
      throw new EmailIPCBoundaryError(
        "CREDENTIAL_STORE_UNAVAILABLE",
        "email_credentials",
        "Unable to read encrypted email credentials",
        { cause: error },
      );
    }
  }

  saveAll(config) {
    let saved = false;
    try {
      saved = this.storage.save(config) === true;
    } catch (error) {
      throw new EmailIPCBoundaryError(
        "CREDENTIAL_STORE_UNAVAILABLE",
        "email_credentials",
        "Unable to save encrypted email credentials",
        { cause: error },
      );
    }
    if (!saved) {
      throw new EmailIPCBoundaryError(
        "CREDENTIAL_STORE_UNAVAILABLE",
        "email_credentials",
        "Unable to save encrypted email credentials",
      );
    }
  }

  setPassword(accountId, password) {
    const reference = this.credentialRef(accountId);
    const key = this.credentialKey(accountId);
    const secret = assertBoundedString(
      password,
      "email_account_password",
      this.limits.maxPasswordBytes,
    );
    const config = this.loadAll();
    if (
      !config.emailAccounts ||
      typeof config.emailAccounts !== "object" ||
      Array.isArray(config.emailAccounts)
    ) {
      config.emailAccounts = {};
    }
    config.emailAccounts[key] = { password: secret };
    this.saveAll(config);
    return reference;
  }

  getPassword(accountId, storedReference) {
    const expectedReference = this.credentialRef(accountId);
    if (storedReference !== expectedReference) {
      throw new EmailIPCBoundaryError(
        "CREDENTIAL_MIGRATION_REQUIRED",
        "email_credentials",
        "Email credential reference is missing or invalid",
      );
    }
    const password =
      this.loadAll()?.emailAccounts?.[this.credentialKey(accountId)]?.password;
    return assertBoundedString(
      password,
      "email_account_password",
      this.limits.maxPasswordBytes,
    );
  }

  deletePassword(accountId) {
    const key = this.credentialKey(accountId);
    const config = this.loadAll();
    if (!config.emailAccounts?.[key]) {
      return true;
    }
    delete config.emailAccounts[key];
    this.saveAll(config);
    return true;
  }

  migrateDatabase(database) {
    const db = database?.db || database;
    if (!db?.prepare) {
      throw new Error("Email credential migration requires a database");
    }
    const accounts = db
      .prepare("SELECT id, password FROM email_accounts LIMIT ?")
      .all([this.limits.maxAccounts + 1]);
    if (accounts.length > this.limits.maxAccounts) {
      throw new EmailIPCBoundaryError(
        "OVERLOADED",
        "email_accounts",
        "Email account migration exceeds the configured account limit",
        { limit: { maxItems: this.limits.maxAccounts } },
      );
    }

    const config = this.loadAll();
    if (
      !config.emailAccounts ||
      typeof config.emailAccounts !== "object" ||
      Array.isArray(config.emailAccounts)
    ) {
      config.emailAccounts = {};
    }
    const updates = [];
    for (const account of accounts) {
      const reference = this.credentialRef(account.id);
      const key = this.credentialKey(account.id);
      if (this.isCredentialRef(account.password)) {
        if (
          account.password !== reference ||
          !config.emailAccounts[key]?.password
        ) {
          throw new EmailIPCBoundaryError(
            "CREDENTIAL_STORE_UNAVAILABLE",
            "email_credentials",
            `Encrypted email credential is unavailable for ${account.id}`,
          );
        }
        continue;
      }
      const password = assertBoundedString(
        account.password,
        "email_account_password",
        this.limits.maxPasswordBytes,
      );
      config.emailAccounts[key] = { password };
      updates.push([reference, account.id]);
    }

    if (updates.length === 0) {
      return { migrated: 0 };
    }

    // Persist the encrypted copy first. A later database failure leaves the
    // legacy plaintext intact, so migration is retryable without losing access.
    this.saveAll(config);
    const applyUpdates = () => {
      const statement = db.prepare(
        "UPDATE email_accounts SET password = ?, updated_at = ? WHERE id = ?",
      );
      const now = Date.now();
      for (const [reference, accountId] of updates) {
        statement.run([reference, now, accountId]);
      }
    };
    if (typeof db.transaction === "function") {
      db.transaction(applyUpdates)();
    } else {
      applyUpdates();
    }
    logger.info(
      `[EmailCredentialStore] migrated ${updates.length} account credential(s)`,
    );
    return { migrated: updates.length };
  }
}

module.exports = {
  EMAIL_CREDENTIAL_REF_PREFIX,
  EmailCredentialStore,
};
