/**
 * @chainlesschain/personal-data-hub
 *
 * UnifiedSchema, validators, batch helpers, and SQLCipher-backed LocalVault
 * for the Personal Data Hub middleware.
 *
 * Phase 0 (landed): constants / ids / schemas / batch
 * Phase 1 (this):   vault / migrations / key-providers
 *
 * See docs/design/Personal_Data_Hub_Architecture.md.
 */

"use strict";

const constants = require("./constants");
const ids = require("./ids");
const schemas = require("./schemas");
const batch = require("./batch");
const migrations = require("./migrations");
const keyProviders = require("./key-providers");
const { LocalVault } = require("./vault");

module.exports = {
  // Constants / enums
  ...constants,

  // ID generation
  newId: ids.newId,
  newIdForSource: ids.newIdForSource,
  timestampFromId: ids.timestampFromId,

  // Per-entity validators
  validate: schemas.validate,
  validatePerson: schemas.validatePerson,
  validateEvent: schemas.validateEvent,
  validatePlace: schemas.validatePlace,
  validateItem: schemas.validateItem,
  validateTopic: schemas.validateTopic,

  // Batch helpers
  emptyBatch: batch.emptyBatch,
  mergeBatches: batch.mergeBatches,
  validateBatch: batch.validateBatch,
  partitionBatch: batch.partitionBatch,

  // Migrations
  MIGRATIONS: migrations.MIGRATIONS,
  TARGET_SCHEMA_VERSION: migrations.TARGET_VERSION,
  applyMigrations: migrations.applyMigrations,
  getSchemaVersion: migrations.getSchemaVersion,

  // Key providers
  KEY_HEX_LEN: keyProviders.KEY_HEX_LEN,
  isValidKeyHex: keyProviders.isValidKeyHex,
  generateKeyHex: keyProviders.generateKeyHex,
  InMemoryKeyProvider: keyProviders.InMemoryKeyProvider,
  FileKeyProvider: keyProviders.FileKeyProvider,

  // Vault
  LocalVault,
};
