import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import {
  applyMemoryCommand,
  canonicalDigest,
  createMemoryCandidate,
  normalizeMemoryRecord,
  rankMemoryRecords,
} from "../index.mjs";

const FIXTURE_URL = new URL(
  "../fixtures/lexical-retrieval-multilingual-v1.json",
  import.meta.url,
);
const TOKEN_BUDGET = 1_048_576;
const LEXICAL_FIELDS = new Set([
  "category",
  "tags",
  "summary",
  "content",
  "digest",
]);

export function loadLexicalFixture() {
  return JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
}

// This is only the previous lexical tokenizer, not a copy of ranking or policy.
// ASCII hex makes each old token opaque to the current Han-aware matcher.
function legacyTokens(value) {
  return [
    ...new Set(
      String(value || "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter(Boolean)
        .slice(0, 2048),
    ),
  ];
}

export function encodeLegacyTokens(value) {
  return legacyTokens(value)
    .map((token) => `legacy_${Buffer.from(token, "utf8").toString("hex")}`)
    .join(" ");
}

export function legacyTokenExactRecord(record) {
  const encoded = {
    ...record,
    category: encodeLegacyTokens(record.category),
    tags: record.tags.map(encodeLegacyTokens),
    content: encodeLegacyTokens(record.content),
    ...(record.summary === undefined
      ? {}
      : { summary: encodeLegacyTokens(record.summary) }),
  };
  delete encoded.digest;
  return normalizeMemoryRecord(encoded);
}

function shuffled(records, seed) {
  let state = seed >>> 0;
  const copy = [...records];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const target = (state >>> 0) % (index + 1);
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function buildLexicalRecords(fixture) {
  const clock = () => Date.parse(fixture.now);
  const records = fixture.records.map((entry) => {
    assert.ok(
      !entry.guard ||
        [
          "other_scope",
          "other_sink",
          "expired_ttl",
          "archived",
          "candidate",
          "deleted",
        ].includes(entry.guard),
      `unknown guard: ${entry.guard}`,
    );
    let record = createMemoryCandidate(
      {
        memoryId: entry.memoryId,
        scope: "project",
        scopeId:
          entry.guard === "other_scope"
            ? "other-fixture-project"
            : fixture.scopeId,
        category: "synthetic",
        content: entry.content,
        provenance: {
          source: "synthetic-lexical-fixture",
          actor: "fixture-user",
          observedAt: fixture.now,
        },
        evidenceRefs: [
          {
            store: "synthetic-lexical-fixture",
            id: `source-${entry.memoryId}`,
          },
        ],
        confidence: 0.8,
        importance: 0.5,
        tags: [],
        sensitivity: "internal",
        allowedSinks: [
          entry.guard === "other_sink" ? "provider.other" : fixture.sink,
        ],
        retentionPolicy:
          entry.guard === "expired_ttl"
            ? { mode: "until_expired", expiresAt: "2026-09-11T00:00:00.000Z" }
            : { mode: "durable" },
        activate: entry.guard !== "candidate",
      },
      { clock },
    );
    if (["archived", "deleted"].includes(entry.guard)) {
      record = applyMemoryCommand(
        record,
        {
          type: entry.guard === "archived" ? "archive" : "delete",
          expectedRevision: record.revision,
          ...(entry.guard === "deleted"
            ? { deletionFence: "fixture-deletion-fence" }
            : {}),
        },
        { clock, randomUUID: () => `fixture-${entry.memoryId}` },
      ).record;
    }
    return record;
  });
  return shuffled(records, fixture.seed);
}

function requestFor(fixture, records, query) {
  return {
    query,
    sink: fixture.sink,
    scopeAdmissions: [{ scope: "project", scopeId: fixture.scopeId }],
    limit: records.length,
    tokenBudget: TOKEN_BUDGET,
    now: fixture.now,
  };
}

function governanceFields(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !LEXICAL_FIELDS.has(key)),
  );
}

function verifyComparisonBounds(fixture, currentRecords, baselineRecords) {
  assert.ok(currentRecords.length > 0 && currentRecords.length <= 1000);
  for (let index = 0; index < currentRecords.length; index += 1) {
    assert.deepEqual(
      governanceFields(currentRecords[index]),
      governanceFields(baselineRecords[index]),
    );
    const record = currentRecords[index];
    const lexicalText = `${record.category} ${record.tags.join(" ")} ${record.summary || ""} ${record.content}`;
    assert.ok(
      lexicalText.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean).length < 2048,
      "fixture must not exercise the old tokenizer cutoff across encoded fields",
    );
  }
  for (const records of [currentRecords, baselineRecords]) {
    const totalTokens = records.reduce(
      (total, record) =>
        total +
        Math.max(1, Math.ceil(Buffer.byteLength(record.content, "utf8") / 4)),
      0,
    );
    assert.ok(
      totalTokens < TOKEN_BUDGET,
      "encoded lengths must not cause token-budget truncation",
    );
    const categories = new Set(
      records
        .filter((record) => record.state !== "deleted")
        .map((record) => record.category),
    );
    assert.equal(
      categories.size,
      1,
      "fixture must not exercise category diversity",
    );
  }
  const expected = fixture.records
    .filter((entry) => !entry.guard)
    .map((entry) => entry.memoryId)
    .sort();
  const recalled = [currentRecords, baselineRecords].map((records) =>
    rankMemoryRecords(records, requestFor(fixture, records, "*"))
      .results.map((entry) => entry.memoryId)
      .sort(),
  );
  assert.deepEqual(recalled[0], expected, "current governance filters changed");
  assert.deepEqual(
    recalled[1],
    expected,
    "baseline must use identical governance filters",
  );
  return {
    passed: true,
    admittedIds: expected,
    blockedIds: fixture.records
      .filter((entry) => entry.guard)
      .map((entry) => entry.memoryId)
      .sort(),
    note: "Same rankMemoryRecords, lifecycle, scope, sink and TTL filters; no safety difference is counted as a lexical gain.",
  };
}

function mean(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function evaluateVariant(fixture, records, encodeQuery) {
  let elapsedMs = 0;
  const queries = fixture.queries.map((entry) => {
    const request = requestFor(fixture, records, encodeQuery(entry.query));
    const start = performance.now();
    const ranked = rankMemoryRecords(records, request);
    elapsedMs += performance.now() - start;
    assert.equal(
      ranked.results.length,
      ranked.totalCandidates,
      "fixture comparison must not drop results through limit, budget or diversity",
    );
    const ids = ranked.results.map((result) => result.memoryId);
    const firstRelevant = ids.findIndex((id) => entry.relevantIds.includes(id));
    return {
      ...entry,
      ranked: ranked.results.map(({ memoryId, relevance }) => ({
        memoryId,
        relevance,
      })),
      recallAtK: Object.fromEntries(
        fixture.k.map((k) => [
          k,
          entry.relevantIds.length
            ? ids.slice(0, k).filter((id) => entry.relevantIds.includes(id))
                .length / entry.relevantIds.length
            : null,
        ]),
      ),
      reciprocalRank: entry.relevantIds.length
        ? firstRelevant < 0
          ? 0
          : 1 / (firstRelevant + 1)
        : null,
      negativeQueryFalseRecall: entry.relevantIds.length
        ? null
        : ids.length > 0,
      expectedSetMatched:
        JSON.stringify([...ids].sort()) ===
        JSON.stringify([...entry.relevantIds].sort()),
    };
  });
  const positives = queries.filter((entry) => entry.relevantIds.length);
  const negatives = queries.filter((entry) => !entry.relevantIds.length);
  return {
    positiveQueryCount: positives.length,
    negativeQueryCount: negatives.length,
    recallAtK: Object.fromEntries(
      fixture.k.map((k) => [
        k,
        mean(positives.map((entry) => entry.recallAtK[k])),
      ]),
    ),
    mrr: mean(positives.map((entry) => entry.reciprocalRank)),
    negativeQueryFalseRecallCount: negatives.filter(
      (entry) => entry.negativeQueryFalseRecall,
    ).length,
    negativeQueryFalseRecallRate: mean(
      negatives.map((entry) => Number(entry.negativeQueryFalseRecall)),
    ),
    expectedSetMatchedCount: queries.filter((entry) => entry.expectedSetMatched)
      .length,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    queries,
  };
}

export function runLexicalRetrievalEvaluation(fixture = loadLexicalFixture()) {
  const currentRecords = buildLexicalRecords(fixture);
  const baselineRecords = currentRecords.map(legacyTokenExactRecord);
  const governanceParity = verifyComparisonBounds(
    fixture,
    currentRecords,
    baselineRecords,
  );
  return {
    schema: "chainlesschain.lexical-retrieval-eval/v1",
    fixtureId: fixture.fixtureId,
    fixtureDigest: canonicalDigest(
      fixture,
      "chainlesschain.lexical-retrieval-fixture/v1",
    ),
    synthetic: true,
    qualifiesForProduction: false,
    limitations: [
      "Small hand-authored keyword/identifier fixture; no natural-language, synonym or semantic-model quality claim.",
      "Legacy comparator reproduces old token-exact lexical matching only, using the current ranker and governance.",
      "Recall@k and full-ranking MRR average positive queries; false-recall rate counts negative queries with any result.",
      "Elapsed time is one pass of rank calls, excluding setup and baseline encoding; not a speedup claim or production SLA.",
    ],
    now: fixture.now,
    seed: fixture.seed,
    recordCount: currentRecords.length,
    queryCount: fixture.queries.length,
    rankLimit: currentRecords.length,
    tokenBudget: TOKEN_BUDGET,
    k: fixture.k,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    governanceParity,
    current: evaluateVariant(fixture, currentRecords, (query) => query),
    legacyTokenExact: evaluateVariant(
      fixture,
      baselineRecords,
      encodeLegacyTokens,
    ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = runLexicalRetrievalEvaluation();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
