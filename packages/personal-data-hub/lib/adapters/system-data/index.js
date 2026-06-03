"use strict";

const {
  SystemDataAdapter,
  SYSTEM_DATA_ADAPTER_NAME,
  SYSTEM_DATA_ADAPTER_VERSION,
  DEFAULT_INCLUDE,
  DEFAULT_REMOTE_PATHS,
  SDCARD_WORKAROUND_PATHS,
} = require("./system-data-adapter");
const {
  SOURCE_DESCRIPTORS,
  SOURCE_KEYS,
  sanitizeInclude,
  resolveRetentionMs,
  checkDisclosureCoverage,
  buildDisclosurePayload,
} = require("./disclosure");

module.exports = {
  SystemDataAdapter,
  SYSTEM_DATA_ADAPTER_NAME,
  SYSTEM_DATA_ADAPTER_VERSION,
  DEFAULT_INCLUDE,
  DEFAULT_REMOTE_PATHS,
  SDCARD_WORKAROUND_PATHS,
  // Disclosure helpers (Phase 4.5.6)
  SOURCE_DESCRIPTORS,
  SOURCE_KEYS,
  sanitizeInclude,
  resolveRetentionMs,
  checkDisclosureCoverage,
  buildDisclosurePayload,
};
