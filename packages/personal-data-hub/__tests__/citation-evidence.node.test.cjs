"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { buildPrompt, summarizeFact } = require("../lib/prompt-builder");
const { AnalysisEngine } = require("../lib/analysis");
const {
  createAuthenticatedEvolutionModelClient,
} = require("../lib/model-egress-guard");

const first = {
  id: "evt-1",
  type: "event",
  subtype: "message",
  occurredAt: 1_700_000_000_000,
  content: { text: "First version" },
  source: {
    adapter: "local-test",
    adapterVersion: "2.0.0",
    capturedAt: 1_700_000_000_001,
    capturedBy: "api",
    originalId: "external-1",
    scope: "account-a",
  },
};
const second = {
  ...first,
  id: "evt-2",
  content: { text: "Second fact" },
};

test("prompt evidence binds only included facts to source and visible content", () => {
  const result = buildPrompt({
    question: "hello",
    facts: [first, second],
    maxFacts: 1,
  });
  assert.deepEqual([...result.factIds], ["evt-1"]);
  assert.equal(result.citationEvidenceById.has("evt-2"), false);
  assert.deepEqual(result.citationEvidenceById.get("evt-1"), {
    id: "evt-1",
    status: "source-recorded",
    source: first.source,
    promptFactDigest: `sha256:${createHash("sha256")
      .update(JSON.stringify(summarizeFact(first)))
      .digest("hex")}`,
  });
  const changed = buildPrompt({
    question: "hello",
    facts: [{ ...first, content: { text: "Changed version" } }],
  });
  assert.notEqual(
    changed.citationEvidenceById.get("evt-1").promptFactDigest,
    result.citationEvidenceById.get("evt-1").promptFactDigest,
  );
});

test("duplicate fact IDs and missing source cannot claim unique provenance", () => {
  const duplicate = buildPrompt({
    question: "hello",
    facts: [first, { ...first }],
  });
  assert.deepEqual(duplicate.citationEvidenceById.get("evt-1"), {
    id: "evt-1",
    status: "ambiguous-id",
    source: null,
    promptFactDigest: null,
  });
  const noSource = buildPrompt({
    question: "hello",
    facts: [{ ...first, source: undefined }],
  });
  assert.equal(
    noSource.citationEvidenceById.get("evt-1").status,
    "source-unavailable",
  );
  const incomplete = buildPrompt({
    question: "hello",
    facts: [{ ...first, source: { adapter: "local-test" } }],
  });
  assert.equal(
    incomplete.citationEvidenceById.get("evt-1").status,
    "source-incomplete",
  );
});

test("answer and remote retrieval return evidence only for prompt facts", async () => {
  const llm = createAuthenticatedEvolutionModelClient({
    getName: () => "local-test",
    getIsLocal: () => true,
    prepare: async (messages) => ({ messages, complete: async () => {} }),
    transport: async () => ({ text: "Evidence [evt-1] [evt-2]" }),
  });
  const engine = new AnalysisEngine({ vault: { audit() {} }, llm });
  engine._gatherFacts = () => [first, second];

  const answer = await engine.ask("hello", { maxFacts: 1, skipAudit: true });
  assert.deepEqual(answer.citations, ["evt-1"]);
  assert.deepEqual(answer.hallucinatedCitations, ["evt-2"]);
  assert.deepEqual(answer.citationEvidence, [
    buildPrompt({
      question: "hello",
      facts: [first],
      maxFacts: 1,
    }).citationEvidenceById.get("evt-1"),
  ]);

  const context = await engine.retrieveContext("hello", {
    maxFacts: 1,
    skipAudit: true,
  });
  assert.deepEqual(context.factIds, ["evt-1"]);
  assert.deepEqual(context.citationEvidence, answer.citationEvidence);
});
