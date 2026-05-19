/**
 * @chainlesschain/personal-data-hub
 *
 * UnifiedSchema, validators, SQLCipher LocalVault, and AdapterRegistry for
 * the Personal Data Hub middleware.
 *
 * Phase 0 (landed): constants / ids / schemas / batch
 * Phase 1 (landed): vault / migrations / key-providers
 * Phase 2 (this):   adapter-spec / kg-derive / rag-derive / registry / mock-adapter
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
const adapterSpec = require("./adapter-spec");
const kgDerive = require("./kg-derive");
const ragDerive = require("./rag-derive");
const { AdapterRegistry, DEFAULT_BATCH_SIZE } = require("./registry");
const { MockAdapter } = require("./mock-adapter");

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

  // Adapter contract
  SENSITIVITY_LEVELS: adapterSpec.SENSITIVITY_LEVELS,
  assertAdapter: adapterSpec.assertAdapter,

  // KG + RAG derivation
  triple: kgDerive.triple,
  deriveEventTriples: kgDerive.deriveEventTriples,
  derivePersonTriples: kgDerive.derivePersonTriples,
  derivePlaceTriples: kgDerive.derivePlaceTriples,
  deriveItemTriples: kgDerive.deriveItemTriples,
  deriveTopicTriples: kgDerive.deriveTopicTriples,
  deriveBatchTriples: kgDerive.deriveBatchTriples,
  deriveEntityTriples: kgDerive.deriveEntityTriples,
  eventToRagDoc: ragDerive.eventToRagDoc,
  personToRagDoc: ragDerive.personToRagDoc,
  placeToRagDoc: ragDerive.placeToRagDoc,
  itemToRagDoc: ragDerive.itemToRagDoc,
  topicToRagDoc: ragDerive.topicToRagDoc,
  entityToRagDoc: ragDerive.entityToRagDoc,
  deriveBatchDocs: ragDerive.deriveBatchDocs,

  // Registry + reference adapter
  AdapterRegistry,
  DEFAULT_BATCH_SIZE,
  MockAdapter,
};
