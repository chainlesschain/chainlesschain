"use strict";

const FAILURES = Object.freeze({
  plugin: Object.freeze({
    code: "PLUGIN_OPERATION_FAILED",
    error: "Plugin operation failed",
  }),
  pluginLazy: Object.freeze({
    code: "PLUGIN_LAZY_OPERATION_FAILED",
    error: "Plugin operation failed",
  }),
  pluginMarketplace: Object.freeze({
    code: "PLUGIN_MARKETPLACE_OPERATION_FAILED",
    error: "Plugin marketplace operation failed",
  }),
  marketplace: Object.freeze({
    code: "MARKETPLACE_OPERATION_FAILED",
    error: "Marketplace operation failed",
  }),
  token: Object.freeze({
    code: "TOKEN_OPERATION_FAILED",
    error: "Token operation failed",
  }),
  skillService: Object.freeze({
    code: "SKILL_SERVICE_OPERATION_FAILED",
    error: "Skill service operation failed",
  }),
});

function createPluginIpcFailureResult(kind) {
  const failure = FAILURES[kind];
  if (!failure) {
    throw new TypeError("Plugin IPC failure kind is invalid");
  }
  return { success: false, error: failure.error, code: failure.code };
}

module.exports = { createPluginIpcFailureResult };
