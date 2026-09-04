import { createHash } from "node:crypto";

export const WIKISKILL_BENCHMARK_PLAN_SCHEMA =
  "chainlesschain.wikiskill-benchmark-plan/v1";
export const WIKISKILL_BENCHMARK_REPORT_SCHEMA =
  "chainlesschain.wikiskill-benchmark-report/v1";
export const WIKISKILL_BENCHMARK_ENVELOPE_SCHEMA =
  "chainlesschain.wikiskill-benchmark-envelope/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const FAILURE_CLASSES = new Set([
  "none",
  "model",
  "tool",
  "provider",
  "sandbox",
  "permission",
  "infrastructure",
  "grader",
  "unknown",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonical(actual) !== canonical(expected))
    throw new TypeError(`${name} has unexpected or missing fields`);
}

function string(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function sha(value, name) {
  if (!DIGEST.test(value ?? ""))
    throw new TypeError(`${name} must be a sha256 digest`);
  return value;
}

function finite(value, name, { min = 0, max = Number.MAX_VALUE } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new TypeError(`${name} is outside its allowed range`);
  return number;
}

function normalizeDatasets(datasets) {
  if (!Array.isArray(datasets) || datasets.length !== 5)
    throw new TypeError("datasets must contain exactly five entries");
  const ids = new Set();
  return datasets.map((dataset, index) => {
    exactKeys(
      dataset,
      ["id", "version", "digest", "splitIds"],
      `dataset ${index}`,
    );
    const id = string(dataset.id, `dataset ${index} id`);
    if (ids.has(id)) throw new TypeError(`duplicate dataset id: ${id}`);
    ids.add(id);
    if (!Array.isArray(dataset.splitIds) || dataset.splitIds.length === 0)
      throw new TypeError(`dataset ${id} must contain splitIds`);
    const splitIds = dataset.splitIds.map((item, splitIndex) =>
      string(item, `dataset ${id} split ${splitIndex}`),
    );
    if (new Set(splitIds).size !== splitIds.length)
      throw new TypeError(`dataset ${id} contains duplicate splitIds`);
    return Object.freeze({
      id,
      version: string(dataset.version, `dataset ${id} version`),
      digest: sha(dataset.digest, `dataset ${id} digest`),
      splitIds: Object.freeze(splitIds),
      splitDigest: digest(WIKISKILL_BENCHMARK_PLAN_SCHEMA, splitIds),
    });
  });
}

export function createWikiSkillBenchmarkPlan(input = {}) {
  exactKeys(
    input,
    [
      "gitCommit",
      "runnerDigest",
      "model",
      "inference",
      "environment",
      "datasets",
      "toolDigest",
      "apiDigest",
      "promptDigest",
      "skillDigest",
      "wikiDigest",
      "seedSchedule",
      "bootstrapSamples",
    ],
    "benchmark plan",
  );
  exactKeys(input.model, ["checkpoint", "digest"], "model");
  exactKeys(
    input.environment,
    ["containerDigest", "vllmVersion", "hardware"],
    "environment",
  );
  if (
    !input.inference ||
    typeof input.inference !== "object" ||
    Array.isArray(input.inference)
  )
    throw new TypeError("inference must be an object");
  if (!Array.isArray(input.seedSchedule) || input.seedSchedule.length < 3)
    throw new TypeError(
      "seedSchedule must contain at least three independent runs",
    );
  const seedSchedule = input.seedSchedule.map((seed, index) => {
    if (!Number.isSafeInteger(seed) || seed < 0)
      throw new TypeError(
        `seedSchedule ${index} must be a non-negative safe integer`,
      );
    return seed;
  });
  if (new Set(seedSchedule).size !== seedSchedule.length)
    throw new TypeError("seedSchedule must not contain duplicates");
  if (input.bootstrapSamples !== 1_000)
    throw new TypeError("bootstrapSamples must equal 1000");
  const gitCommit = string(input.gitCommit, "gitCommit");
  if (!COMMIT.test(gitCommit))
    throw new TypeError("gitCommit must be a full commit SHA");
  const core = {
    schema: WIKISKILL_BENCHMARK_PLAN_SCHEMA,
    gitCommit,
    runnerDigest: sha(input.runnerDigest, "runnerDigest"),
    model: Object.freeze({
      checkpoint: string(input.model.checkpoint, "model checkpoint"),
      digest: sha(input.model.digest, "model digest"),
    }),
    inference: Object.freeze(JSON.parse(canonical(input.inference))),
    environment: Object.freeze({
      containerDigest: sha(
        input.environment.containerDigest,
        "container digest",
      ),
      vllmVersion: string(input.environment.vllmVersion, "vLLM version"),
      hardware: string(input.environment.hardware, "hardware"),
    }),
    datasets: Object.freeze(normalizeDatasets(input.datasets)),
    toolDigest: sha(input.toolDigest, "toolDigest"),
    apiDigest: sha(input.apiDigest, "apiDigest"),
    promptDigest: sha(input.promptDigest, "promptDigest"),
    skillDigest: sha(input.skillDigest, "skillDigest"),
    wikiDigest: sha(input.wikiDigest, "wikiDigest"),
    seedSchedule: Object.freeze(seedSchedule),
    bootstrapSamples: 1_000,
  };
  return Object.freeze({
    ...core,
    planDigest: digest(WIKISKILL_BENCHMARK_PLAN_SCHEMA, core),
  });
}

export function verifyWikiSkillBenchmarkPlan(plan) {
  exactKeys(
    plan,
    [
      "schema",
      "gitCommit",
      "runnerDigest",
      "model",
      "inference",
      "environment",
      "datasets",
      "toolDigest",
      "apiDigest",
      "promptDigest",
      "skillDigest",
      "wikiDigest",
      "seedSchedule",
      "bootstrapSamples",
      "planDigest",
    ],
    "benchmark plan",
  );
  if (plan.schema !== WIKISKILL_BENCHMARK_PLAN_SCHEMA)
    throw new TypeError("benchmark plan schema is invalid");
  const recreated = createWikiSkillBenchmarkPlan({
    gitCommit: plan.gitCommit,
    runnerDigest: plan.runnerDigest,
    model: plan.model,
    inference: plan.inference,
    environment: plan.environment,
    datasets: plan.datasets.map(({ id, version, digest: value, splitIds }) => ({
      id,
      version,
      digest: value,
      splitIds,
    })),
    toolDigest: plan.toolDigest,
    apiDigest: plan.apiDigest,
    promptDigest: plan.promptDigest,
    skillDigest: plan.skillDigest,
    wikiDigest: plan.wikiDigest,
    seedSchedule: plan.seedSchedule,
    bootstrapSamples: plan.bootstrapSamples,
  });
  if (canonical(recreated) !== canonical(plan))
    throw new Error("benchmark plan digest mismatch");
  return recreated;
}

function normalizeArm(arm, name) {
  exactKeys(
    arm,
    [
      "score",
      "traceDigest",
      "graderReceiptDigest",
      "failureClass",
      "tokens",
      "cost",
      "latencyMs",
    ],
    name,
  );
  if (!FAILURE_CLASSES.has(arm.failureClass))
    throw new TypeError(`${name} failureClass is invalid`);
  return Object.freeze({
    score: finite(arm.score, `${name} score`, { max: 1 }),
    traceDigest: sha(arm.traceDigest, `${name} traceDigest`),
    graderReceiptDigest: sha(
      arm.graderReceiptDigest,
      `${name} graderReceiptDigest`,
    ),
    failureClass: arm.failureClass,
    tokens: finite(arm.tokens, `${name} tokens`),
    cost: finite(arm.cost, `${name} cost`),
    latencyMs: finite(arm.latencyMs, `${name} latencyMs`),
  });
}

function percentile(sorted, probability) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function prngFromDigest(value) {
  let state = Number.parseInt(value.slice(7, 15), 16) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildWikiSkillBenchmarkReport({ plan, runs } = {}) {
  try {
    plan = verifyWikiSkillBenchmarkPlan(plan);
  } catch (cause) {
    if (cause?.message === "benchmark plan digest mismatch") throw cause;
    throw new TypeError("a canonical benchmark plan is required", { cause });
  }
  if (!Array.isArray(runs) || runs.length !== plan.seedSchedule.length)
    throw new TypeError("runs must exactly cover the seed schedule");
  const expectedCases = new Map(
    plan.datasets.flatMap((dataset) =>
      dataset.splitIds.map((splitId) => [`${dataset.id}\0${splitId}`, dataset]),
    ),
  );
  const seenSeeds = new Set();
  const normalizedRuns = runs.map((run, runIndex) => {
    exactKeys(run, ["runId", "seed", "cases"], `run ${runIndex}`);
    if (!plan.seedSchedule.includes(run.seed) || seenSeeds.has(run.seed))
      throw new TypeError(`run ${runIndex} seed is absent or duplicated`);
    seenSeeds.add(run.seed);
    if (!Array.isArray(run.cases) || run.cases.length !== expectedCases.size)
      throw new TypeError(`run ${runIndex} does not cover every split`);
    const seenCases = new Set();
    const cases = run.cases.map((item, caseIndex) => {
      exactKeys(
        item,
        ["datasetId", "splitId", "baseline", "skill"],
        `run ${runIndex} case ${caseIndex}`,
      );
      const key = `${item.datasetId}\0${item.splitId}`;
      if (!expectedCases.has(key) || seenCases.has(key))
        throw new TypeError(`run ${runIndex} has an absent or duplicate split`);
      seenCases.add(key);
      return Object.freeze({
        datasetId: item.datasetId,
        splitId: item.splitId,
        baseline: normalizeArm(item.baseline, `run ${runIndex} baseline`),
        skill: normalizeArm(item.skill, `run ${runIndex} skill`),
      });
    });
    cases.sort((left, right) =>
      `${left.datasetId}\0${left.splitId}`.localeCompare(
        `${right.datasetId}\0${right.splitId}`,
      ),
    );
    return Object.freeze({
      runId: string(run.runId, `run ${runIndex} runId`),
      seed: run.seed,
      cases: Object.freeze(cases),
    });
  });
  normalizedRuns.sort(
    (left, right) =>
      plan.seedSchedule.indexOf(left.seed) -
      plan.seedSchedule.indexOf(right.seed),
  );

  const perDataset = plan.datasets.map((dataset) => {
    const observations = normalizedRuns.flatMap((run) =>
      run.cases.filter((item) => item.datasetId === dataset.id),
    );
    const baseline = mean(observations.map((item) => item.baseline.score));
    const skill = mean(observations.map((item) => item.skill.score));
    return Object.freeze({
      datasetId: dataset.id,
      count: observations.length,
      baseline,
      skill,
      delta: skill - baseline,
    });
  });
  const equalWeightBaseline = mean(perDataset.map((item) => item.baseline));
  const equalWeightSkill = mean(perDataset.map((item) => item.skill));
  const deltas = normalizedRuns.flatMap((run) =>
    run.cases.map((item) => item.skill.score - item.baseline.score),
  );
  const random = prngFromDigest(plan.planDigest);
  const bootstrap = Array.from({ length: plan.bootstrapSamples }, () => {
    const sample = Array.from(
      { length: deltas.length },
      () => deltas[Math.floor(random() * deltas.length)],
    );
    return mean(sample);
  }).sort((left, right) => left - right);
  const measurements = normalizedRuns.flatMap((run) =>
    run.cases.flatMap((item) => [item.baseline, item.skill]),
  );
  const core = {
    schema: WIKISKILL_BENCHMARK_REPORT_SCHEMA,
    planDigest: plan.planDigest,
    gitCommit: plan.gitCommit,
    runnerDigest: plan.runnerDigest,
    datasetDigests: Object.freeze(
      plan.datasets.map(({ id, digest: datasetDigest, splitDigest }) => ({
        id,
        digest: datasetDigest,
        splitDigest,
      })),
    ),
    runCount: normalizedRuns.length,
    pairedObservationCount: deltas.length,
    perDataset: Object.freeze(perDataset),
    metrics: Object.freeze({
      equalWeightBaseline,
      equalWeightSkill,
      delta: equalWeightSkill - equalWeightBaseline,
      pairedBootstrap95Ci: Object.freeze([
        percentile(bootstrap, 0.025),
        percentile(bootstrap, 0.975),
      ]),
      bootstrapSamples: plan.bootstrapSamples,
      tokens: measurements.reduce((sum, item) => sum + item.tokens, 0),
      cost: measurements.reduce((sum, item) => sum + item.cost, 0),
      latencyMs: Object.freeze({
        p50: percentile(
          measurements.map((item) => item.latencyMs).sort((a, b) => a - b),
          0.5,
        ),
        p95: percentile(
          measurements.map((item) => item.latencyMs).sort((a, b) => a - b),
          0.95,
        ),
        p99: percentile(
          measurements.map((item) => item.latencyMs).sort((a, b) => a - b),
          0.99,
        ),
      }),
    }),
    failureCounts: Object.freeze(
      [...FAILURE_CLASSES].reduce((result, classification) => {
        result[classification] = measurements.filter(
          (item) => item.failureClass === classification,
        ).length;
        return result;
      }, {}),
    ),
    runs: Object.freeze(normalizedRuns),
  };
  return Object.freeze({
    ...core,
    reportDigest: digest(WIKISKILL_BENCHMARK_REPORT_SCHEMA, core),
  });
}

export function verifyWikiSkillBenchmarkReport({ plan, report } = {}) {
  const verifiedPlan = verifyWikiSkillBenchmarkPlan(plan);
  if (!report || report.schema !== WIKISKILL_BENCHMARK_REPORT_SCHEMA)
    throw new TypeError("a canonical benchmark report is required");
  const recreated = buildWikiSkillBenchmarkReport({
    plan: verifiedPlan,
    runs: report.runs,
  });
  if (canonical(recreated) !== canonical(report))
    throw new Error("benchmark report digest mismatch");
  return recreated;
}

export async function executeWikiSkillBenchmark({ plan, runner } = {}) {
  if (
    !plan ||
    plan.schema !== WIKISKILL_BENCHMARK_PLAN_SCHEMA ||
    !DIGEST.test(plan.planDigest ?? "")
  )
    throw new TypeError("a canonical benchmark plan is required");
  if (typeof runner !== "function")
    throw new TypeError("benchmark runner is required");
  const runs = [];
  for (const seed of plan.seedSchedule) {
    const cases = [];
    for (const dataset of plan.datasets) {
      for (const splitId of dataset.splitIds) {
        const common = Object.freeze({
          planDigest: plan.planDigest,
          seed,
          dataset: Object.freeze({
            id: dataset.id,
            version: dataset.version,
            digest: dataset.digest,
            splitId,
            splitDigest: dataset.splitDigest,
          }),
          model: plan.model,
          inference: plan.inference,
          environment: plan.environment,
          toolDigest: plan.toolDigest,
          apiDigest: plan.apiDigest,
          promptDigest: plan.promptDigest,
          runnerDigest: plan.runnerDigest,
        });
        const baseline = await runner(
          Object.freeze({
            ...common,
            arm: "no-skill",
            skillDigest: null,
            wikiDigest: null,
          }),
        );
        const skill = await runner(
          Object.freeze({
            ...common,
            arm: "skill",
            skillDigest: plan.skillDigest,
            wikiDigest: plan.wikiDigest,
          }),
        );
        cases.push({
          datasetId: dataset.id,
          splitId,
          baseline,
          skill,
        });
      }
    }
    runs.push({
      runId: digest(WIKISKILL_BENCHMARK_REPORT_SCHEMA, {
        planDigest: plan.planDigest,
        seed,
      }),
      seed,
      cases,
    });
  }
  return buildWikiSkillBenchmarkReport({ plan, runs });
}

export async function signWikiSkillBenchmarkReport({ report, attestor } = {}) {
  if (
    !report ||
    report.schema !== WIKISKILL_BENCHMARK_REPORT_SCHEMA ||
    !DIGEST.test(report.reportDigest ?? "")
  )
    throw new TypeError("a canonical benchmark report is required");
  if (typeof attestor !== "function")
    throw new TypeError("attestor is required");
  const attestation = await attestor(report.reportDigest);
  if (!attestation || typeof attestation !== "object")
    throw new Error("benchmark attestor returned no attestation");
  return Object.freeze({
    schema: WIKISKILL_BENCHMARK_ENVELOPE_SCHEMA,
    report,
    attestation: Object.freeze({ ...attestation }),
  });
}

export async function projectWikiSkillBenchmarkClaim({
  envelope,
  verifyAttestation,
} = {}) {
  const hold = Object.freeze({
    provenance: "external-paper-only",
    status: "HOLD",
    reportDigest: null,
    metrics: null,
  });
  if (!envelope) return hold;
  if (
    envelope.schema !== WIKISKILL_BENCHMARK_ENVELOPE_SCHEMA ||
    typeof verifyAttestation !== "function"
  )
    throw new TypeError("signed benchmark envelope and verifier are required");
  const { report } = envelope;
  if (!report || report.schema !== WIKISKILL_BENCHMARK_REPORT_SCHEMA)
    throw new Error("benchmark report is invalid");
  const core = Object.fromEntries(
    Object.entries(report).filter(([key]) => key !== "reportDigest"),
  );
  if (digest(WIKISKILL_BENCHMARK_REPORT_SCHEMA, core) !== report.reportDigest)
    throw new Error("benchmark report digest mismatch");
  if (
    !(await verifyAttestation({
      digest: report.reportDigest,
      attestation: envelope.attestation,
    }))
  )
    throw new Error("benchmark report attestation rejected");
  return Object.freeze({
    provenance: "chainlesschain-measured",
    status: "VERIFIED",
    reportDigest: report.reportDigest,
    metrics: report.metrics,
  });
}
