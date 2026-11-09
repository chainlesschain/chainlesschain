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

test("correction schema accepts only explicit content and CAS authority fields", () => {
  const request = {
    memoryId: "rule-1",
    type: "correct",
    expectedRevision: 1,
    content: "Updated rule",
  };
  assert.equal(
    validateContextMemoryDefinition("MemoryDecisionRequest", request).ok,
    true,
  );
  for (const extra of [
    { summary: "old" },
    { allowedSinks: ["*"] },
    { confidenceDelta: 0.1 },
    { successorMemoryId: "other" },
  ])
    assert.equal(
      validateContextMemoryDefinition("MemoryDecisionRequest", {
        ...request,
        ...extra,
      }).ok,
      false,
    );
  const { content, ...missingContent } = request;
  assert.equal(
    validateContextMemoryDefinition("MemoryDecisionRequest", missingContent).ok,
    false,
  );
  assert.equal(
    validateContextMemoryDefinition("MemoryDecisionRequest", {
      ...request,
      type: "reinforce",
    }).ok,
    false,
  );
});

test("published schema has executable contract entry points and immutable definitions", () => {
  assert.equal(CONTEXT_MEMORY_SCHEMA["x-cc-context-memory"].version, 1);
  assert.ok(CONTEXT_MEMORY_SCHEMA.anyOf.length >= 14);
  assert.equal(Object.isFrozen(CONTEXT_MEMORY_SCHEMA.$defs), true);
  assert.equal(Object.isFrozen(CONTEXT_MEMORY_SCHEMA.$defs.ContextItem), true);
  assert.equal(validateContextMemorySchema(contextItem()).ok, true);
  assert.equal(
    validateContextMemorySchema(createMemoryCandidate(proposal())).ok,
    true,
  );
  assert.ok(
    CONTEXT_MEMORY_SCHEMA.$defs.MemoryRecallRequest.properties
      .semanticCandidates,
  );
  assert.equal(
    CONTEXT_MEMORY_SCHEMA.$defs.ContextPlanRequest.properties
      .semanticCandidates,
    undefined,
  );
  assert.deepEqual(
    validateContextMemoryDefinition("MemoryRecallRequest", {
      query: "可复现检查",
      sink: "provider.local",
      scopeAdmissions: [{ scope: "project", scopeId: "project-1" }],
      semanticCandidates: [
        {
          memoryId: "memory-1",
          revision: 1,
          recordDigest: `sha256:${"a".repeat(64)}`,
          score: 0.75,
        },
      ],
    }),
    { ok: true, errors: [] },
  );
});

test("definition validator and runtime invariants reject drift and invalid digests", () => {
  const item = contextItem();
  assert.deepEqual(validateContextMemoryDefinition("ContextItem", item), {
    ok: true,
    errors: [],
  });
  assert.equal(
    validateContextMemoryDefinition("ContextItem", {
      ...item,
      unexpected: true,
    }).ok,
    false,
  );
  assert.equal(
    validateContextMemoryDefinition("ContextItem", {
      ...item,
      digest: `sha256:${"0".repeat(64)}`,
    }).ok,
    false,
  );
  assert.equal(
    validateContextMemoryDefinition("MissingDefinition", {}).ok,
    false,
  );
  assert.doesNotThrow(() => assertContextMemoryDefinition("ContextItem", item));
  assert.throws(
    () =>
      assertContextMemoryDefinition("ContextItem", {
        ...item,
        content: undefined,
      }),
    /Invalid ContextItem/u,
  );
});
