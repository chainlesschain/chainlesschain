"use strict";

const STAGES = Object.freeze([
  "shadow",
  "internal_canary",
  "opt_in_canary",
  "canonical_default",
  "legacy_read_only",
  "retired",
]);
const VSCODE_STAGE_ENV = "CHAINLESSCHAIN_CONTEXT_MEMORY_VSCODE_STAGE";
const CLI_STAGE_ENV = "CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE";
const DEFAULT_STAGE = "canonical_default";

function resolveVscodeContextMemoryAuthority({
  env = process.env,
  configuredStage,
} = {}) {
  const stage = String(env[VSCODE_STAGE_ENV] || configuredStage || DEFAULT_STAGE)
    .trim()
    .toLowerCase();
  if (!STAGES.includes(stage)) {
    const error = new Error(`Unsupported VS Code Context/Memory stage: ${stage}`);
    error.code = "CONTEXT_MEMORY_STAGE_INVALID";
    throw error;
  }
  const canonical = [
    "canonical_default",
    "legacy_read_only",
    "retired",
  ].includes(stage);
  return Object.freeze({
    stage,
    canonical,
    projectionOnly: true,
    cliEnvironment: Object.freeze({ [CLI_STAGE_ENV]: stage }),
  });
}

function configuredVscodeContextMemoryAuthority(vscodeApi, env = process.env) {
  const configuredStage = vscodeApi.workspace
    .getConfiguration("chainlesschain.contextMemory")
    .get("stage", DEFAULT_STAGE);
  return resolveVscodeContextMemoryAuthority({ env, configuredStage });
}

module.exports = {
  CLI_STAGE_ENV,
  DEFAULT_STAGE,
  STAGES,
  VSCODE_STAGE_ENV,
  configuredVscodeContextMemoryAuthority,
  resolveVscodeContextMemoryAuthority,
};
