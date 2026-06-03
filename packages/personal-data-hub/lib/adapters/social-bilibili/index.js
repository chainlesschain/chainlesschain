"use strict";

// Phase 13.1 → A8 v0.1 (2026-05-22): refactored into adapter.js with snapshot
// mode added for the Android in-APK cc path. Legacy sqlite mode preserved.
// This file is the public entry point — re-exports from adapter.js so callers
// using `require("@chainlesschain/personal-data-hub/lib/adapters/social-bilibili")`
// continue to see the same { BilibiliAdapter, NAME, VERSION } shape.

const {
  BilibiliAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_KINDS,
} = require("./adapter");

module.exports = {
  BilibiliAdapter,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_KINDS,
};
