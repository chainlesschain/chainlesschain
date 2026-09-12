"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { lexicalRelevance } = require("../lib/index.js");

const evaluator = import("../scripts/lexical-retrieval-eval.mjs");

test("synthetic multilingual fixture matches every positive and negative expectation", async () => {
  const { runLexicalRetrievalEvaluation } = await evaluator;
  const report = runLexicalRetrievalEvaluation();
  assert.equal(report.queryCount, 25);
  assert.equal(report.current.positiveQueryCount, 17);
  assert.equal(report.current.negativeQueryCount, 8);
  for (const query of report.current.queries) {
    assert.equal(query.expectedSetMatched, true, query.id);
  }
  assert.equal(report.current.recallAtK[3], 1);
  assert.equal(report.current.recallAtK[5], 1);
  assert.equal(report.current.mrr, 1);
  assert.equal(report.current.negativeQueryFalseRecallRate, 0);
  const multiRelevant = report.current.queries.find(
    (entry) => entry.id === "han-two-relevant",
  );
  assert.equal(
    multiRelevant.recallAtK[1],
    0.5,
    "Recall is fraction of relevant records, not hit rate",
  );
});

test("old token-exact comparator preserves English behavior but reproduces the Han counterexample", async () => {
  const { runLexicalRetrievalEvaluation } = await evaluator;
  const { current, legacyTokenExact: baseline } =
    runLexicalRetrievalEvaluation();
  for (const query of current.queries.filter(
    (entry) => entry.group === "english",
  )) {
    const old = baseline.queries.find((entry) => entry.id === query.id);
    assert.deepEqual(old.ranked, query.ranked, query.id);
  }
  assert.equal(
    baseline.queries.find((entry) => entry.id === "original-full-phrase")
      .expectedSetMatched,
    true,
  );
  assert.deepEqual(
    baseline.queries.find(
      (entry) => entry.id === "original-substring-counterexample",
    ).ranked,
    [],
  );
  assert.equal(baseline.negativeQueryFalseRecallCount, 0);
  assert.ok(current.recallAtK[5] > baseline.recallAtK[5]);
  assert.ok(current.mrr > baseline.mrr);
});

test("baseline re-normalizes digests and shares all lifecycle and admission filters", async () => {
  const {
    buildLexicalRecords,
    legacyTokenExactRecord,
    loadLexicalFixture,
    runLexicalRetrievalEvaluation,
  } = await evaluator;
  const records = buildLexicalRecords(loadLexicalFixture());
  const lexicalFields = new Set([
    "category",
    "tags",
    "summary",
    "content",
    "digest",
  ]);
  for (const record of records) {
    const encoded = legacyTokenExactRecord(record);
    assert.notEqual(encoded.digest, record.digest);
    for (const key of Object.keys(record).filter(
      (field) => !lexicalFields.has(field),
    )) {
      assert.deepEqual(encoded[key], record[key], `${record.memoryId}.${key}`);
    }
  }
  const report = runLexicalRetrievalEvaluation();
  assert.equal(report.governanceParity.passed, true);
  assert.equal(report.governanceParity.blockedIds.length, 6);
  for (const variant of [report.current, report.legacyTokenExact]) {
    for (const query of variant.queries) {
      assert.ok(
        query.ranked.every(
          (entry) =>
            !report.governanceParity.blockedIds.includes(entry.memoryId),
        ),
        query.id,
      );
    }
  }
});

test("opaque baseline encoding reproduces old token-exact scores for every fixture pair", async () => {
  const {
    buildLexicalRecords,
    encodeLegacyTokens,
    legacyTokenExactRecord,
    loadLexicalFixture,
  } = await evaluator;
  const fixture = loadLexicalFixture();
  const tokens = (value) =>
    new Set(
      String(value || "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter(Boolean)
        .slice(0, 2048),
    );
  for (const record of buildLexicalRecords(fixture)) {
    const memoryTokens = tokens(
      `${record.category} ${record.tags.join(" ")} ${record.summary || ""} ${record.content}`,
    );
    const encoded = legacyTokenExactRecord(record);
    for (const entry of fixture.queries) {
      const queryTokens = tokens(entry.query);
      const expected =
        [...queryTokens].filter((token) => memoryTokens.has(token)).length /
        queryTokens.size;
      assert.equal(
        lexicalRelevance(encodeLegacyTokens(entry.query), encoded),
        expected,
        `${record.memoryId}/${entry.id}`,
      );
    }
  }
});

test("fixed seed and clock produce stable scores and metrics apart from observed elapsed time", async () => {
  const { runLexicalRetrievalEvaluation } = await evaluator;
  const first = runLexicalRetrievalEvaluation();
  const second = runLexicalRetrievalEvaluation();
  for (const report of [first, second]) {
    assert.equal(report.now, "2026-09-12T00:00:00.000Z");
    assert.equal(report.seed, 20260912);
    for (const variant of [report.current, report.legacyTokenExact]) {
      assert.ok(Number.isFinite(variant.elapsedMs) && variant.elapsedMs >= 0);
      delete variant.elapsedMs;
    }
  }
  assert.deepEqual(first, second);
});

test("standalone evaluation emits JSON and explicitly disclaims production and semantic evidence", () => {
  const stdout = execFileSync(
    process.execPath,
    [path.join(__dirname, "../scripts/lexical-retrieval-eval.mjs")],
    {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    },
  );
  const report = JSON.parse(stdout);
  assert.equal(report.schema, "chainlesschain.lexical-retrieval-eval/v1");
  assert.equal(report.synthetic, true);
  assert.equal(report.qualifiesForProduction, false);
  assert.equal(report.current.expectedSetMatchedCount, report.queryCount);
  assert.match(
    report.limitations.join(" "),
    /not a speedup claim or production SLA/,
  );
});
