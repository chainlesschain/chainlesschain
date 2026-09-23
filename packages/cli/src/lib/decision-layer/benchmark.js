import { performance } from "node:perf_hooks";

import { decisionDigest } from "./contracts.js";

export const SKILL_DECISION_BENCHMARK_SCHEMA =
  "chainlesschain.skill-decision-benchmark/v2";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ONE_SIDED_ALPHA = 0.05;

// Exact Clopper-Pearson upper bound: find p where P(Binomial(n, p) <= k)
// equals alpha. Keep zero-denominator metrics inconclusive.
function binomialUpperBound(errors, trials) {
  if (trials === 0) return null;
  if (errors === trials) return 1;
  if (errors === 0) return -Math.expm1(Math.log(ONE_SIDED_ALPHA) / trials);

  const logFactorials = [0];
  for (let i = 1; i <= trials; i += 1) {
    logFactorials.push(logFactorials[i - 1] + Math.log(i));
  }
  const logCombination =
    logFactorials[trials] -
    logFactorials[errors] -
    logFactorials[trials - errors];
  let lower = errors / trials;
  let upper = 1;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const probability = (lower + upper) / 2;
    let term = Math.exp(
      logCombination +
        errors * Math.log(probability) +
        (trials - errors) * Math.log1p(-probability),
    );
    let cumulative = term;
    for (let count = errors; count > 0; count -= 1) {
      term *=
        (count / (trials - count + 1)) * ((1 - probability) / probability);
      cumulative += term;
    }
    if (cumulative > ONE_SIDED_ALPHA) lower = probability;
    else upper = probability;
  }
  return (lower + upper) / 2;
}

function ratio(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new TypeError(`${label} must be between zero and one`);
  }
  return number;
}

function normalizeThresholds(input) {
  const p95Ms = Number(input?.p95Ms);
  if (!Number.isFinite(p95Ms) || p95Ms <= 0) {
    throw new TypeError("p95Ms must be positive");
  }
  return Object.freeze({
    acceptedSuggestionErrorRate: ratio(
      input?.acceptedSuggestionErrorRate,
      "acceptedSuggestionErrorRate",
    ),
    noMatchFalseSuggestionRate: ratio(
      input?.noMatchFalseSuggestionRate,
      "noMatchFalseSuggestionRate",
    ),
    affirmativeCoverage: ratio(
      input?.affirmativeCoverage,
      "affirmativeCoverage",
    ),
    p95Ms,
  });
}

function normalizeCases(cases) {
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 10_000) {
    throw new TypeError("decision benchmark cases are invalid or unbounded");
  }
  return cases.map((item, index) => {
    if (
      !item ||
      typeof item.query !== "string" ||
      item.query.trim() === "" ||
      !Array.isArray(item.candidates) ||
      item.candidates.length < 1 ||
      !Array.isArray(item.acceptableDigests) ||
      item.acceptableDigests.some((digest) => !DIGEST.test(digest)) ||
      new Set(item.acceptableDigests).size !== item.acceptableDigests.length
    ) {
      throw new TypeError(`decision benchmark case ${index} is invalid`);
    }
    const candidateDigests = new Set(
      item.candidates.map(({ digest }) => digest),
    );
    if (
      item.acceptableDigests.some((digest) => !candidateDigests.has(digest))
    ) {
      throw new TypeError(
        `decision benchmark case ${index} has truth outside the candidates`,
      );
    }
    return Object.freeze({
      query: item.query.trim(),
      candidates: Object.freeze(
        item.candidates.map((candidate) => Object.freeze({ ...candidate })),
      ),
      acceptableDigests: Object.freeze([...item.acceptableDigests]),
    });
  });
}

export async function runSkillDecisionBenchmark({
  runtime,
  cases,
  thresholds,
  turnIdPrefix = "benchmark",
  contextRevision = "benchmark-v1",
  clock = () => performance.now(),
} = {}) {
  if (!runtime || typeof runtime.suggest !== "function") {
    throw new TypeError("decision benchmark requires a runtime");
  }
  const normalizedCases = normalizeCases(cases);
  const gate = normalizeThresholds(thresholds);
  const latencies = [];
  let accepted = 0;
  let acceptedErrors = 0;
  let positives = 0;
  let affirmative = 0;
  let noMatches = 0;
  let noMatchFalseSuggestions = 0;
  let abstentions = 0;
  let unavailable = 0;
  const rows = [];
  for (const [index, item] of normalizedCases.entries()) {
    const start = Number(clock());
    const result = await runtime.suggest({
      query: item.query,
      candidates: item.candidates,
      turnId: `${turnIdPrefix}-${index}`,
      contextRevision,
    });
    const end = Number(clock());
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new Error("decision benchmark clock is invalid");
    }
    latencies.push(end - start);
    const isPositive = item.acceptableDigests.length > 0;
    if (isPositive) positives += 1;
    else noMatches += 1;
    if (result.status === "suggestion") {
      accepted += 1;
      if (isPositive) affirmative += 1;
      const correct = item.acceptableDigests.includes(result.selectedDigest);
      if (!correct) acceptedErrors += 1;
      if (!isPositive) noMatchFalseSuggestions += 1;
    } else if (result.status === "abstain") abstentions += 1;
    else if (result.status === "unavailable") unavailable += 1;
    rows.push(
      Object.freeze({
        index,
        status: result.status,
        selectedDigest: result.selectedDigest,
        acceptableDigests: item.acceptableDigests,
        latencyMs: end - start,
      }),
    );
  }
  latencies.sort((left, right) => left - right);
  const metrics = Object.freeze({
    acceptedSuggestionErrorRate: acceptedErrors / Math.max(1, accepted),
    noMatchFalseSuggestionRate:
      noMatchFalseSuggestions / Math.max(1, noMatches),
    affirmativeCoverage: affirmative / Math.max(1, positives),
    abstentionRate: abstentions / normalizedCases.length,
    unavailableRate: unavailable / normalizedCases.length,
    p95Ms: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)],
  });
  const counts = Object.freeze({
    accepted,
    acceptedErrors,
    positives,
    affirmative,
    noMatches,
    noMatchFalseSuggestions,
    abstentions,
    unavailable,
  });
  const oneSided95Upper = Object.freeze({
    acceptedSuggestionErrorRate: binomialUpperBound(acceptedErrors, accepted),
    noMatchFalseSuggestionRate: binomialUpperBound(
      noMatchFalseSuggestions,
      noMatches,
    ),
  });
  const core = {
    schema: SKILL_DECISION_BENCHMARK_SCHEMA,
    caseCount: normalizedCases.length,
    caseDigest: decisionDigest(
      "chainlesschain.skill-decision-benchmark-cases/v1",
      normalizedCases,
    ),
    thresholds: gate,
    metrics,
    counts,
    oneSided95Upper,
    passed:
      oneSided95Upper.acceptedSuggestionErrorRate !== null &&
      oneSided95Upper.acceptedSuggestionErrorRate <=
        gate.acceptedSuggestionErrorRate &&
      oneSided95Upper.noMatchFalseSuggestionRate !== null &&
      oneSided95Upper.noMatchFalseSuggestionRate <=
        gate.noMatchFalseSuggestionRate &&
      positives > 0 &&
      metrics.affirmativeCoverage >= gate.affirmativeCoverage &&
      metrics.p95Ms <= gate.p95Ms,
    rows: Object.freeze(rows),
  };
  return Object.freeze({
    ...core,
    reportDigest: decisionDigest(SKILL_DECISION_BENCHMARK_SCHEMA, core),
  });
}
