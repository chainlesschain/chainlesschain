import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { routeSkillDescriptors } from "./skill-retrieval-router.js";

export const SKILL_RETRIEVAL_BENCHMARK_SCHEMA =
  "chainlesschain.skill-retrieval-benchmark/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256")
    .update(SKILL_RETRIEVAL_BENCHMARK_SCHEMA)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function finiteRatio(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1)
    throw new TypeError(`${name} must be between zero and one`);
  return number;
}

function normalizeThresholds(input) {
  const recallAt5 = finiteRatio(input?.recallAt5, "recallAt5");
  const falseInvocationRate = finiteRatio(
    input?.falseInvocationRate,
    "falseInvocationRate",
  );
  const p95Ms = Number(input?.p95Ms);
  if (!Number.isFinite(p95Ms) || p95Ms <= 0)
    throw new TypeError("p95Ms must be positive");
  return Object.freeze({ recallAt5, falseInvocationRate, p95Ms });
}

export function runSkillRetrievalBenchmark({
  skills,
  cases,
  thresholds,
  clock = () => performance.now(),
} = {}) {
  if (
    !Array.isArray(skills) ||
    skills.length < 2 ||
    skills.length > 10_000 ||
    !Array.isArray(cases) ||
    cases.length < 1 ||
    cases.length > 10_000 ||
    typeof clock !== "function"
  )
    throw new TypeError("Skill retrieval benchmark input is invalid");
  const gate = normalizeThresholds(thresholds);
  const corpusDigests = new Set(
    skills.map((skill) => skill.executionIdentity?.contentDigest),
  );
  const normalizedCases = cases.map((item, index) => {
    if (
      typeof item?.query !== "string" ||
      item.query.trim() === "" ||
      !DIGEST.test(item?.expectedDigest ?? "")
    )
      throw new TypeError(`benchmark case ${index} is invalid`);
    if (!corpusDigests.has(item.expectedDigest))
      throw new TypeError(`benchmark case ${index} is absent from the corpus`);
    return { query: item.query, expectedDigest: item.expectedDigest };
  });
  const plan = Object.freeze({
    skillCorpusDigest: hash(
      skills.map((skill) => ({
        id: skill.id,
        digest: skill.executionIdentity?.contentDigest ?? null,
        description: skill.description ?? "",
      })),
    ),
    caseCorpusDigest: hash(normalizedCases),
    caseCount: normalizedCases.length,
    thresholds: gate,
  });
  const latencies = [];
  let recalled = 0;
  let falseInvocations = 0;
  let abstentions = 0;
  for (const item of normalizedCases) {
    const startedAt = Number(clock());
    const result = routeSkillDescriptors({
      skills,
      query: item.query,
      topK: 5,
      ambiguityMargin: 0,
    });
    const endedAt = Number(clock());
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(endedAt) ||
      endedAt < startedAt
    )
      throw new Error("Skill retrieval benchmark clock is invalid");
    latencies.push(endedAt - startedAt);
    if (result.candidates.some(({ digest }) => digest === item.expectedDigest))
      recalled += 1;
    if (result.selected === null) abstentions += 1;
    else if (result.selected.digest !== item.expectedDigest)
      falseInvocations += 1;
  }
  latencies.sort((a, b) => a - b);
  const recallAt5 = recalled / normalizedCases.length;
  const falseInvocationRate = falseInvocations / normalizedCases.length;
  const p95Ms = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)];
  const core = {
    schema: SKILL_RETRIEVAL_BENCHMARK_SCHEMA,
    plan,
    metrics: {
      recallAt5,
      falseInvocationRate,
      p95Ms,
      abstentionRate: abstentions / normalizedCases.length,
    },
    passed:
      recallAt5 >= gate.recallAt5 &&
      falseInvocationRate < gate.falseInvocationRate &&
      p95Ms < gate.p95Ms,
  };
  return Object.freeze({ ...core, reportDigest: hash(core) });
}
