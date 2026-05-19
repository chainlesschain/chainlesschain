#!/usr/bin/env node
/**
 * Phase 8.8 — EntityResolver evaluation runner.
 *
 * Reads a labeled pair fixture, runs each pair through the configured
 * stages, computes recall / accuracy / per-stage breakdown, and exits
 * non-zero if the CI gate (recall ≥ 80%, accuracy ≥ 90%) fails.
 *
 * Usage:
 *   node scripts/evaluate-entity-resolver.js \
 *     [--fixture <path>] [--use-embedding] [--use-llm] [--require-pass]
 *
 * Defaults:
 *   - fixture: __tests__/fixtures/entity-resolver-200-mock.json
 *   - --use-embedding: skipped unless flag set (needs Ollama running)
 *   - --use-llm: skipped unless flag set (needs Ollama + chat model)
 *   - --require-pass: exit 1 when gate fails (use in CI; otherwise warn-only)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  entityResolverRuleStage: ruleStage,
} = require("../lib/entity-resolver");

const args = parseArgs(process.argv.slice(2));
const fixturePath = args.fixture || path.join(
  __dirname, "..", "__tests__", "fixtures", "entity-resolver-200-mock.json"
);
const useEmbedding = !!args["use-embedding"];
const useLlm = !!args["use-llm"];
const requirePass = !!args["require-pass"];

const RECALL_GATE = 0.80;
const ACCURACY_GATE = 0.90;

async function main() {
  console.log("== EntityResolver evaluation ==");
  console.log("fixture:", fixturePath);
  if (!fs.existsSync(fixturePath)) {
    console.error("\nFAIL: fixture not found");
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
  if (!Array.isArray(data.pairs) || data.pairs.length === 0) {
    console.error("\nFAIL: fixture has no pairs");
    process.exit(2);
  }

  const stages = { embedding: null, llm: null };
  if (useEmbedding) {
    const { EntityResolverEmbeddingStage } = require("../lib/entity-resolver");
    stages.embedding = new EntityResolverEmbeddingStage({}).asStageFn();
    console.log("embedding stage: Ollama nomic-embed-text @ localhost:11434");
  }
  if (useLlm) {
    const { EntityResolverLLMStage } = require("../lib/entity-resolver");
    const { OllamaClient } = require("../lib/llm-client");
    const llm = new OllamaClient({ baseUrl: "http://localhost:11434", model: "qwen2.5:7b-instruct" });
    stages.llm = new EntityResolverLLMStage({ llm }).asStageFn();
    console.log("llm stage: Ollama qwen2.5:7b-instruct");
  }

  // Per-stage counters
  const counts = {
    ruleSame: 0, ruleDifferent: 0, ruleUncertain: 0,
    embeddingSame: 0, embeddingDifferent: 0, embeddingUncertain: 0,
    llmSame: 0, llmDifferent: 0, llmMaybe: 0,
  };

  // Confusion matrix
  const confusion = { tp: 0, fp: 0, fn: 0, tn: 0, unresolved: 0 };

  // Per-pair breakdown
  const results = [];

  for (const pair of data.pairs) {
    const truth = pair.groundTruth; // "same" | "different"
    const ruleVerdict = ruleStage(pair.a, pair.b).verdict;
    let finalVerdict = ruleVerdict;
    let stage = "rule";

    if (ruleVerdict === "same") counts.ruleSame += 1;
    else if (ruleVerdict === "different") counts.ruleDifferent += 1;
    else counts.ruleUncertain += 1;

    if (ruleVerdict === "uncertain" && stages.embedding) {
      const e = await stages.embedding(pair.a, pair.b);
      if (e.sim >= 0.85) {
        finalVerdict = "same";
        counts.embeddingSame += 1;
        stage = "embedding";
      } else if (e.sim < 0.55) {
        finalVerdict = "different";
        counts.embeddingDifferent += 1;
        stage = "embedding";
      } else {
        counts.embeddingUncertain += 1;
        if (stages.llm) {
          const v = await stages.llm(pair.a, pair.b);
          if (v.verdict === "yes" && v.confidence >= 0.7) {
            finalVerdict = "same";
            counts.llmSame += 1;
            stage = "llm";
          } else if (v.verdict === "no" && v.confidence >= 0.7) {
            finalVerdict = "different";
            counts.llmDifferent += 1;
            stage = "llm";
          } else {
            finalVerdict = "review";
            counts.llmMaybe += 1;
            stage = "llm-review";
          }
        }
      }
    }

    // Tally confusion (only counting decided verdicts)
    if (finalVerdict === "same" && truth === "same") confusion.tp += 1;
    else if (finalVerdict === "same" && truth === "different") confusion.fp += 1;
    else if (finalVerdict === "different" && truth === "same") confusion.fn += 1;
    else if (finalVerdict === "different" && truth === "different") confusion.tn += 1;
    else confusion.unresolved += 1;

    results.push({ id: pair.id, truth, finalVerdict, stage, category: pair.category });
  }

  const total = data.pairs.length;
  const resolved = total - confusion.unresolved;
  const accuracy = resolved > 0 ? (confusion.tp + confusion.tn) / resolved : 0;
  const recall = (confusion.tp + confusion.fn) > 0
    ? confusion.tp / (confusion.tp + confusion.fn)
    : 1;
  const precision = (confusion.tp + confusion.fp) > 0
    ? confusion.tp / (confusion.tp + confusion.fp)
    : 1;
  const resolveRate = resolved / total;

  // ── Report ──
  console.log("\nPair counts:", { total, resolved, unresolved: confusion.unresolved });
  console.log("\nPipeline stages:");
  console.log(`  Rule:      same=${counts.ruleSame} different=${counts.ruleDifferent} uncertain=${counts.ruleUncertain}`);
  if (stages.embedding) console.log(`  Embedding: same=${counts.embeddingSame} different=${counts.embeddingDifferent} uncertain=${counts.embeddingUncertain}`);
  if (stages.llm) console.log(`  LLM:       same=${counts.llmSame} different=${counts.llmDifferent} maybe=${counts.llmMaybe}`);

  console.log("\nConfusion (decided only):");
  console.log(`  TP=${confusion.tp}  FP=${confusion.fp}  FN=${confusion.fn}  TN=${confusion.tn}`);
  console.log(`  unresolved=${confusion.unresolved}  (rule "uncertain" with no embedding/llm wired)`);

  console.log("\nMetrics:");
  const recallStr = (recall * 100).toFixed(1) + "%";
  const accStr = (accuracy * 100).toFixed(1) + "%";
  const precStr = (precision * 100).toFixed(1) + "%";
  const resolveStr = (resolveRate * 100).toFixed(1) + "%";
  console.log(`  Recall:       ${recallStr}  (target ≥ ${(RECALL_GATE * 100).toFixed(0)}%) ${recall >= RECALL_GATE ? "✓" : "✗"}`);
  console.log(`  Accuracy:     ${accStr}  (target ≥ ${(ACCURACY_GATE * 100).toFixed(0)}%) ${accuracy >= ACCURACY_GATE ? "✓" : "✗"}`);
  console.log(`  Precision:    ${precStr}`);
  console.log(`  Resolve rate: ${resolveStr}`);

  // Per-category breakdown (useful for spotting weak spots)
  const byCategory = {};
  for (const r of results) {
    const cat = r.category || "(uncat)";
    if (!byCategory[cat]) byCategory[cat] = { total: 0, correct: 0, unresolved: 0 };
    byCategory[cat].total += 1;
    if (r.finalVerdict === "review" || r.finalVerdict === "uncertain") {
      byCategory[cat].unresolved += 1;
    } else if (r.finalVerdict === r.truth) {
      byCategory[cat].correct += 1;
    }
  }
  console.log("\nPer-category:");
  for (const cat of Object.keys(byCategory)) {
    const s = byCategory[cat];
    const accStr = s.total - s.unresolved > 0
      ? ((s.correct / (s.total - s.unresolved)) * 100).toFixed(0) + "%"
      : "N/A";
    console.log(`  ${cat}: ${s.correct}/${s.total - s.unresolved} correct (${accStr}); ${s.unresolved} unresolved`);
  }

  // Gate decision
  const passed = recall >= RECALL_GATE && accuracy >= ACCURACY_GATE;
  console.log(`\n${passed ? "✓ PASS" : "✗ FAIL"} — recall ${recallStr} / accuracy ${accStr}`);

  if (!passed && requirePass) {
    process.exit(1);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        out[k] = argv[i + 1];
        i += 1;
      } else {
        out[k] = true;
      }
    }
  }
  return out;
}

main().catch((err) => {
  console.error("\nFATAL:", err && err.message ? err.message : err);
  process.exit(2);
});
