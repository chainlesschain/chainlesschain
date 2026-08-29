"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONTEXT_MEMORY_SCHEMA,
  validateContextMemorySchema,
  validateContextMemoryDefinition,
  assertContextMemoryDefinition,
} = require("../lib/index.js");
const { contextItem, proposal } = require("./helpers.js");
const { createMemoryCandidate } = require("../lib/memory-reducer.js");

test("published schema has executable contract entry points and immutable definitions", () => {
  assert.equal(CONTEXT_MEMORY_SCHEMA["x-cc-context-memory"].version, 1);
  assert.ok(CONTEXT_MEMORY_SCHEMA.anyOf.length >= 14);
  assert.equal(Object.isFrozen(CONTEXT_MEMORY_SCHEMA.$defs), true);
  assert.equal(Object.isFrozen(CONTEXT_MEMORY_SCHEMA.$defs.ContextItem), true);
  assert.equal(validateContextMemorySchema(contextItem()).ok, true);
  assert.equal(validateContextMemorySchema(createMemoryCandidate(proposal())).ok, true);
});

test("definition validator and runtime invariants reject drift and invalid digests", () => {
  const item = contextItem();
  assert.deepEqual(validateContextMemoryDefinition("ContextItem", item), {
    ok: true,
    errors: [],
  });
  assert.equal(validateContextMemoryDefinition("ContextItem", { ...item, unexpected: true }).ok, false);
  assert.equal(
    validateContextMemoryDefinition("ContextItem", {
      ...item,
      digest: `sha256:${"0".repeat(64)}`,
    }).ok,
    false,
  );
  assert.equal(validateContextMemoryDefinition("MissingDefinition", {}).ok, false);
  assert.doesNotThrow(() => assertContextMemoryDefinition("ContextItem", item));
  assert.throws(() => assertContextMemoryDefinition("ContextItem", { ...item, content: undefined }), /Invalid ContextItem/u);
});
