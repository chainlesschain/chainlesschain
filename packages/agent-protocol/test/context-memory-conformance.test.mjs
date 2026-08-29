import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CC_AGENT_PROTOCOL_FEATURES,
  CC_AGENT_PROTOCOL_SCHEMA,
  CC_AGENT_STREAM_EVENT_TYPES,
  validateContextItem,
  validateContextPlan,
  validateMemoryDeletionReceipt,
  validateMemoryRecord,
  validateProtocolMessage,
} from "@chainlesschain/agent-protocol";
import {
  createMemoryCandidate,
  normalizeContextItem,
  planContext,
} from "../../context-memory-kernel/index.mjs";
import {
  contextMemoryLifecycleEvents,
  contextMemoryMethods,
  protocolContextMemoryDefinitions,
} from "../scripts/context-memory-schema.mjs";

const AT = "2026-08-29T00:00:00.000Z";

function crossSurfaceProjectionFixture() {
  return readFileSync(
    new URL(
      "../../context-memory-kernel/fixtures/cross-surface-projection-v1.tsv",
      import.meta.url,
    ),
    "utf8",
  )
    .trim()
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => {
      const [method, type, memoryId, memoryRevision, recordMemoryId, expectedMemoryCount] =
        line.split("\t");
      return {
        method,
        type,
        memoryId: memoryId === "-" ? "" : memoryId,
        memoryRevision: memoryRevision !== "-" ? Number(memoryRevision) : null,
        recordMemoryId: recordMemoryId === "-" ? "" : recordMemoryId,
        expectedMemoryCount:
          expectedMemoryCount !== "-" ? Number(expectedMemoryCount) : null,
      };
    });
}

function item() {
  return normalizeContextItem({
    schemaVersion: 1,
    itemId: "message-1",
    kind: "message",
    scope: "session",
    scopeId: "session-1",
    sourceRef: { store: "fixture", id: "source-1", eventSequence: 1 },
    provenance: { source: "fixture", actor: "user-1", observedAt: AT },
    trust: "user",
    sensitivity: "internal",
    allowedSinks: ["provider.local"],
    tokenEstimate: 10,
    priority: 100,
    pinned: false,
    createdAt: AT,
    content: "hello",
  });
}

function planRequest() {
  return {
    modelWindowTokens: 1000,
    reservedOutputTokens: 100,
    safetyMarginTokens: 50,
    recoveryReserveTokens: 50,
    items: [item()],
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: "session-1" }],
    policyVersion: "policy-1",
    modelProfile: "model-1",
    sessionHead: "head:1",
    memoryRevision: 0,
    now: AT,
  };
}

test("Agent Protocol embeds the canonical Context/Memory schema without a second hand-written contract", () => {
  const canonical = JSON.parse(
    readFileSync(
      new URL("../../context-memory-kernel/schema/context-memory-kernel.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const expected = protocolContextMemoryDefinitions(canonical);
  for (const [name, definition] of Object.entries(expected)) {
    assert.deepEqual(CC_AGENT_PROTOCOL_SCHEMA.$defs[name], definition, name);
  }
  assert.ok(CC_AGENT_PROTOCOL_FEATURES.includes("context_memory_kernel"));
  assert.deepEqual(
    Object.keys(CC_AGENT_PROTOCOL_SCHEMA["x-cc-protocol"].contextMemory.methods),
    Object.keys(contextMemoryMethods),
  );
});

test("fixed Context/Memory methods validate typed params and reject missing params", () => {
  const request = planRequest();
  assert.equal(
    validateProtocolMessage({
      jsonrpc: "2.0",
      id: "request-1",
      method: "context/plan",
      params: request,
    }).ok,
    true,
  );
  assert.equal(
    validateProtocolMessage({ jsonrpc: "2.0", id: "request-1", method: "context/plan" }).ok,
    false,
  );
  assert.equal(
    validateProtocolMessage({
      jsonrpc: "2.0",
      id: "request-2",
      method: "memory/delete",
      params: {
        requestId: "delete-1",
        subject: "user-1",
        scope: "user",
        scopeId: "user-1",
        selector: "memory:memory-1",
        memoryId: "memory-1",
        expectedRevision: 1,
        fence: "fence-1",
        authority: "writer-1",
      },
    }).ok,
    true,
  );
});

test("generated public validators accept canonical Kernel values", () => {
  const contextItem = item();
  const plan = planContext(planRequest());
  const memory = createMemoryCandidate({
    memoryId: "memory-1",
    scope: "user",
    scopeId: "user-1",
    category: "preference",
    content: "Prefer deterministic tests",
    provenance: { source: "fixture", actor: "user-1", observedAt: AT },
    evidenceRefs: [{ store: "fixture", id: "request-1" }],
    confidence: 0.9,
    importance: 0.8,
    tags: ["testing"],
    sensitivity: "personal",
    allowedSinks: ["provider.local"],
    retentionPolicy: { mode: "durable" },
    activate: true,
    createdAt: AT,
  });
  assert.equal(validateContextItem(contextItem).ok, true);
  assert.equal(validateContextPlan(plan).ok, true);
  assert.equal(validateMemoryRecord(memory).ok, true);
  assert.equal(validateMemoryDeletionReceipt({}).ok, false);
});

test("Agent stream inventory includes every canonical Context/Memory lifecycle event", () => {
  for (const type of contextMemoryLifecycleEvents) {
    assert.ok(CC_AGENT_STREAM_EVENT_TYPES.includes(type), type);
  }
});

test("shared cross-surface projection fixture only uses canonical protocol events", () => {
  const rows = crossSurfaceProjectionFixture();
  const expected = rows.find((row) => row.method === "expected");
  assert.ok(expected);
  assert.equal(expected.memoryRevision, 5);
  assert.equal(expected.expectedMemoryCount, 0);
  for (const row of rows.filter((entry) => entry.method !== "expected")) {
    assert.ok(["context/event", "memory/event"].includes(row.method), row.method);
    assert.ok(CC_AGENT_STREAM_EVENT_TYPES.includes(row.type), row.type);
  }
});
