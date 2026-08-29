"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_STAGE,
  resolveVscodeContextMemoryAuthority,
} = require("../src/context-memory-authority.js");

test("VS Code defaults to the canonical CLI authority and stays projection-only", () => {
  const authority = resolveVscodeContextMemoryAuthority({ env: {} });
  assert.equal(authority.stage, DEFAULT_STAGE);
  assert.equal(authority.canonical, true);
  assert.equal(authority.projectionOnly, true);
  assert.deepEqual(authority.cliEnvironment, {
    CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
  });
  assert.equal("writer" in authority, false);
});

test("VS Code validates explicit rollout stages", () => {
  assert.equal(
    resolveVscodeContextMemoryAuthority({
      env: { CHAINLESSCHAIN_CONTEXT_MEMORY_VSCODE_STAGE: "shadow" },
      configuredStage: "canonical_default",
    }).stage,
    "shadow",
  );
  assert.throws(
    () =>
      resolveVscodeContextMemoryAuthority({
        env: { CHAINLESSCHAIN_CONTEXT_MEMORY_VSCODE_STAGE: "invalid" },
      }),
    { code: "CONTEXT_MEMORY_STAGE_INVALID" },
  );
});
