/**
 * Stable, privacy-preserving default scopes for account-backed adapters.
 *
 * Adapter names identify a data source (email-imap, wechat, ...), but one
 * source can be re-registered for different user accounts over time. A
 * per-account scope prevents the new instance from inheriting the previous
 * account's incremental-sync cursor. The raw account identifier must not be
 * copied into the watermark table or audit log, so scopes contain only a
 * truncated SHA-256 digest.
 */

"use strict";

const crypto = require("node:crypto");

const ACCOUNT_SCOPE_PREFIX = "account";
const ACCOUNT_SCOPE_DIGEST_LENGTH = 32;
const SNAPSHOT_ACCOUNT_IDENTITY_FIELDS = Object.freeze([
  "userId",
  "uid",
  "numericUid",
  "mid",
  "uin",
  "urlToken",
  "email",
  "phone",
  "username",
  "pin",
  "deviceId",
  "accountId",
  "account_id",
  "openId",
  "openid",
  "id",
]);

function createAccountScope(namespace, identity) {
  const normalizedNamespace = normalizeNamespace(namespace);
  const normalizedIdentity = normalizeIdentity(identity);
  if (!normalizedNamespace) {
    throw new Error("createAccountScope: namespace must be a non-empty string");
  }
  if (!normalizedIdentity) {
    throw new Error("createAccountScope: identity must be a non-empty string");
  }

  const digest = crypto
    .createHash("sha256")
    .update(`${normalizedNamespace}\0${normalizedIdentity}`, "utf8")
    .digest("hex")
    .slice(0, ACCOUNT_SCOPE_DIGEST_LENGTH);
  return `${ACCOUNT_SCOPE_PREFIX}:${normalizedNamespace}:${digest}`;
}

function createAccountScopeFromAccount(namespace, account, identityFields) {
  if (!account || typeof account !== "object") return undefined;
  const fields = Array.isArray(identityFields) ? identityFields : [];
  for (const field of fields) {
    const value = account[field];
    if (
      (typeof value === "string" || typeof value === "number") &&
      normalizeIdentity(value)
    ) {
      return createAccountScope(
        namespace,
        `${field}:${normalizeIdentity(value)}`,
      );
    }
  }
  return undefined;
}

function createAccountScopeFromSnapshot(namespace, snapshot, opts = {}) {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const identityFields = Array.isArray(opts.identityFields)
    ? opts.identityFields
    : SNAPSHOT_ACCOUNT_IDENTITY_FIELDS;
  const includeField = opts.includeField !== false;
  const account =
    snapshot.account && typeof snapshot.account === "object"
      ? snapshot.account
      : null;

  const accountIdentity = findIdentity(account, identityFields);
  if (accountIdentity) {
    return createAccountScope(
      namespace,
      includeField
        ? `${accountIdentity.field}:${normalizeIdentity(accountIdentity.value)}`
        : accountIdentity.value,
    );
  }

  const topLevelIdentity = findIdentity(
    snapshot,
    Array.isArray(opts.topLevelFields) ? opts.topLevelFields : [],
  );
  if (!topLevelIdentity) return undefined;
  return createAccountScope(
    namespace,
    includeField
      ? `${topLevelIdentity.field}:${normalizeIdentity(topLevelIdentity.value)}`
      : topLevelIdentity.value,
  );
}

function findIdentity(source, fields) {
  if (!source || typeof source !== "object") return null;
  for (const field of fields) {
    const value = source[field];
    if (
      (typeof value === "string" || typeof value === "number") &&
      normalizeIdentity(value)
    ) {
      return { field, value };
    }
  }
  return null;
}

function normalizeNamespace(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeIdentity(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

module.exports = {
  ACCOUNT_SCOPE_PREFIX,
  ACCOUNT_SCOPE_DIGEST_LENGTH,
  SNAPSHOT_ACCOUNT_IDENTITY_FIELDS,
  createAccountScope,
  createAccountScopeFromAccount,
  createAccountScopeFromSnapshot,
  normalizeIdentity,
};
