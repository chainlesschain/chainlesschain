/**
 * @chainlesschain/personal-data-hub — Phase 0 prototype
 *
 * UnifiedSchema definitions, validators, and batch helpers for the Personal
 * Data Hub middleware. See docs/design/Personal_Data_Hub_Architecture.md.
 */

"use strict";

const constants = require("./constants");
const ids = require("./ids");
const schemas = require("./schemas");
const batch = require("./batch");

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
};
