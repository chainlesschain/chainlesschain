"use strict";

const { normalizeContextItem } = require("../lib/index.js");

const AT = "2026-08-29T00:00:00.000Z";
const CLOCK = () => Date.parse(AT);

function contextItem(overrides = {}) {
  const itemId = overrides.itemId || "item-1";
  return normalizeContextItem({
    schemaVersion: 1,
    itemId,
    kind: "message",
    scope: "session",
    scopeId: "session-1",
    sourceRef: { store: "fixture", id: `source-${itemId}`, eventSequence: 1 },
    provenance: { source: "fixture", actor: "user-1", observedAt: AT },
    trust: "user",
    sensitivity: "internal",
    allowedSinks: ["provider.local"],
    tokenEstimate: 10,
    priority: 100,
    pinned: false,
    createdAt: AT,
    content: itemId,
    ...overrides,
  });
}

function proposal(overrides = {}) {
  return {
    memoryId: "memory-1",
    scope: "user",
    scopeId: "user-1",
    category: "preference",
    content: "Prefer deterministic tests",
    provenance: { source: "explicit-user-memory", actor: "user-1", observedAt: AT },
    evidenceRefs: [{ store: "fixture", id: "request-1" }],
    confidence: 0.9,
    importance: 0.8,
    tags: ["testing"],
    sensitivity: "personal",
    allowedSinks: ["provider.local"],
    retentionPolicy: { mode: "durable" },
    activate: true,
    createdAt: AT,
    ...overrides,
  };
}

function planRequest(items, overrides = {}) {
  return {
    modelWindowTokens: 1000,
    reservedOutputTokens: 100,
    safetyMarginTokens: 50,
    recoveryReserveTokens: 50,
    items,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: "session-1" }],
    policyVersion: "policy-1",
    modelProfile: "model-1",
    sessionHead: "head:1",
    memoryRevision: 0,
    now: AT,
    ...overrides,
  };
}

module.exports = { AT, CLOCK, contextItem, proposal, planRequest };
