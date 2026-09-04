import { createHash } from "node:crypto";

import {
  buildWikiSkillBenchmarkReport,
  signWikiSkillBenchmarkReport,
  verifyWikiSkillBenchmarkPlan,
} from "./wikiskill-benchmark.js";

export const WIKISKILL_BENCHMARK_EXECUTION_MANIFEST_SCHEMA =
  "chainlesschain.wikiskill-benchmark-execution-manifest/v1";
export const WIKISKILL_BENCHMARK_DATASET_RESOLUTION_SCHEMA =
  "chainlesschain.wikiskill-benchmark-dataset-resolution/v1";
export const WIKISKILL_BENCHMARK_RUNNER_RECEIPT_SCHEMA =
  "chainlesschain.wikiskill-benchmark-runner-receipt/v1";
export const WIKISKILL_BENCHMARK_GRADER_RECEIPT_SCHEMA =
  "chainlesschain.wikiskill-benchmark-grader-receipt/v1";
export const WIKISKILL_BENCHMARK_REPORT_ATTESTATION_SCHEMA =
  "chainlesschain.wikiskill-benchmark-report-attestation/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
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
const DATASET_PROVIDERS = new WeakSet();
const RUNNER_PROVIDERS = new WeakSet();
const GRADER_PROVIDERS = new WeakSet();
const REPORT_ATTESTORS = new WeakSet();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${label} is required`);
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? ""))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} must be a non-negative safe integer`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError(`${label} must be finite and non-negative`);
  return value;
}

function json(value, label, maxBytes = 1024 * 1024) {
  let encoded;
  let result;
  try {
    encoded = JSON.stringify(value);
    result = JSON.parse(encoded);
  } catch (cause) {
    throw new TypeError(`${label} must be JSON data`, { cause });
  }
  if (!encoded || Buffer.byteLength(encoded) > maxBytes)
    throw new TypeError(`${label} is outside its size bound`);
  if (canonical(result) !== canonical(value))
    throw new TypeError(`${label} contains non-JSON values`);
  return Object.freeze(result);
}

function authorityDescriptor(value, label) {
  exact(value, ["authorityId", "revision", "handlerArtifactDigest"], label);
  return Object.freeze({
    authorityId: text(value.authorityId, `${label}.authorityId`),
    revision:
      Number.isSafeInteger(value.revision) && value.revision >= 1
        ? value.revision
        : (() => {
            throw new TypeError(`${label}.revision is invalid`);
          })(),
    handlerArtifactDigest: digest(
      value.handlerArtifactDigest,
      `${label}.handlerArtifactDigest`,
    ),
  });
}

function sameAuthority(left, right) {
  return canonical(left) === canonical(right);
}

function receiptCore(value) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !["receiptDigest", "attestation"].includes(key),
    ),
  );
}

async function verifyReceipt({
  value,
  schema,
  domain,
  authority,
  verifier,
  label,
}) {
  if (
    value.schema !== schema ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.authorityId !== authority.authorityId ||
    value.revision !== authority.revision ||
    value.handlerArtifactDigest !== authority.handlerArtifactDigest
  ) {
    throw new Error(`${label} is not authenticated by its bound authority`);
  }
  const expectedDigest = hash(domain, receiptCore(value));
  if (value.receiptDigest !== expectedDigest)
    throw new Error(`${label} digest mismatch`);
  if (
    (await verifier({
      digest: expectedDigest,
      attestation: value.attestation,
      authority,
    })) !== true
  ) {
    throw new Error(`${label} attestation rejected`);
  }
}

export function createWikiSkillBenchmarkExecutionManifest(input = {}) {
  exact(
    input,
    [
      "datasetProvider",
      "runner",
      "grader",
      "reportAttestor",
      "targetEnvironmentDigest",
    ],
    "benchmark execution manifest",
  );
  const core = {
    schema: WIKISKILL_BENCHMARK_EXECUTION_MANIFEST_SCHEMA,
    datasetProvider: authorityDescriptor(
      input.datasetProvider,
      "datasetProvider",
    ),
    runner: authorityDescriptor(input.runner, "runner"),
    grader: authorityDescriptor(input.grader, "grader"),
    reportAttestor: authorityDescriptor(input.reportAttestor, "reportAttestor"),
    targetEnvironmentDigest: digest(
      input.targetEnvironmentDigest,
      "targetEnvironmentDigest",
    ),
  };
  return Object.freeze({
    ...core,
    manifestDigest: hash(WIKISKILL_BENCHMARK_EXECUTION_MANIFEST_SCHEMA, core),
  });
}

export function verifyWikiSkillBenchmarkExecutionManifest(value) {
  exact(
    value,
    [
      "schema",
      "datasetProvider",
      "runner",
      "grader",
      "reportAttestor",
      "targetEnvironmentDigest",
      "manifestDigest",
    ],
    "benchmark execution manifest",
  );
  if (value.schema !== WIKISKILL_BENCHMARK_EXECUTION_MANIFEST_SCHEMA)
    throw new TypeError("benchmark execution manifest schema is invalid");
  const recreated = createWikiSkillBenchmarkExecutionManifest({
    datasetProvider: value.datasetProvider,
    runner: value.runner,
    grader: value.grader,
    reportAttestor: value.reportAttestor,
    targetEnvironmentDigest: value.targetEnvironmentDigest,
  });
  if (canonical(recreated) !== canonical(value))
    throw new Error("benchmark execution manifest digest mismatch");
  return recreated;
}

export function verifyWikiSkillBenchmarkExecutionBinding({
  plan: planInput,
  executionManifest: manifestInput,
} = {}) {
  const plan = verifyWikiSkillBenchmarkPlan(planInput);
  const executionManifest =
    verifyWikiSkillBenchmarkExecutionManifest(manifestInput);
  if (
    plan.executionManifestDigest !== executionManifest.manifestDigest ||
    plan.runnerDigest !== executionManifest.runner.handlerArtifactDigest ||
    hash(
      "chainlesschain.wikiskill-benchmark-target-environment/v1",
      plan.environment,
    ) !== executionManifest.targetEnvironmentDigest
  ) {
    throw new Error("benchmark plan is not bound to its execution manifest");
  }
  return Object.freeze({ plan, executionManifest });
}

function createProvider({
  descriptor: input,
  method,
  handler,
  verifyAttestation,
  instances,
  label,
}) {
  const descriptor = authorityDescriptor(input, `${label} descriptor`);
  if (typeof handler !== "function")
    throw new TypeError(`${label} handler is required`);
  if (typeof verifyAttestation !== "function")
    throw new TypeError(`${label} receipt verifier is required`);
  const provider = {
    descriptor,
    [method]: handler,
    verifyAttestation,
  };
  instances.add(provider);
  return Object.freeze(provider);
}

export function createWikiSkillBenchmarkDatasetProvider(options = {}) {
  return createProvider({
    descriptor: options.descriptor,
    method: "load",
    handler: options.load,
    verifyAttestation: options.verifyAttestation,
    instances: DATASET_PROVIDERS,
    label: "dataset provider",
  });
}

export function createWikiSkillBenchmarkRunner(options = {}) {
  return createProvider({
    descriptor: options.descriptor,
    method: "run",
    handler: options.run,
    verifyAttestation: options.verifyAttestation,
    instances: RUNNER_PROVIDERS,
    label: "benchmark runner",
  });
}

export function createWikiSkillBenchmarkGrader(options = {}) {
  return createProvider({
    descriptor: options.descriptor,
    method: "grade",
    handler: options.grade,
    verifyAttestation: options.verifyAttestation,
    instances: GRADER_PROVIDERS,
    label: "benchmark grader",
  });
}

export function createWikiSkillBenchmarkReportAttestor(options = {}) {
  return createProvider({
    descriptor: options.descriptor,
    method: "attest",
    handler: options.attest,
    verifyAttestation: options.verifyAttestation,
    instances: REPORT_ATTESTORS,
    label: "benchmark report attestor",
  });
}

export function isWikiSkillBenchmarkDatasetProvider(value) {
  return Boolean(value && DATASET_PROVIDERS.has(value));
}

export function isWikiSkillBenchmarkRunner(value) {
  return Boolean(value && RUNNER_PROVIDERS.has(value));
}

export function isWikiSkillBenchmarkGrader(value) {
  return Boolean(value && GRADER_PROVIDERS.has(value));
}

export function isWikiSkillBenchmarkReportAttestor(value) {
  return Boolean(value && REPORT_ATTESTORS.has(value));
}

function captureProvider(value, instances, method, label) {
  if (!value || !instances.has(value))
    throw new TypeError(`a branded ${label} is required`);
  return Object.freeze({
    descriptor: value.descriptor,
    invoke: value[method].bind(value),
    verify: value.verifyAttestation.bind(value),
  });
}

async function loadDataset(provider, plan, dataset) {
  const request = Object.freeze({
    planDigest: plan.planDigest,
    datasetId: dataset.id,
    version: dataset.version,
    datasetDigest: dataset.digest,
    splitDigest: dataset.splitDigest,
  });
  const requestDigest = hash(
    "chainlesschain.wikiskill-benchmark-dataset-request/v1",
    request,
  );
  const value = await provider.invoke({ ...request, requestDigest });
  exact(
    value,
    [
      "schema",
      "authenticated",
      "durable",
      "authorityId",
      "revision",
      "handlerArtifactDigest",
      "requestDigest",
      "datasetId",
      "version",
      "datasetDigest",
      "splitDigest",
      "cases",
      "receiptDigest",
      "attestation",
    ],
    "dataset resolution",
  );
  if (
    value.requestDigest !== requestDigest ||
    value.datasetId !== dataset.id ||
    value.version !== dataset.version ||
    value.datasetDigest !== dataset.digest ||
    value.splitDigest !== dataset.splitDigest ||
    !Array.isArray(value.cases) ||
    value.cases.length !== dataset.splitIds.length
  ) {
    throw new Error("dataset resolution differs from the benchmark plan");
  }
  const seen = new Set();
  const cases = value.cases.map((entry, index) => {
    exact(entry, ["splitId", "input", "inputDigest"], `dataset case ${index}`);
    if (!dataset.splitIds.includes(entry.splitId) || seen.has(entry.splitId))
      throw new Error("dataset resolution has an absent or duplicate split");
    seen.add(entry.splitId);
    const input = json(entry.input, `dataset case ${index} input`);
    const inputDigest = hash(
      "chainlesschain.wikiskill-benchmark-input/v1",
      input,
    );
    if (entry.inputDigest !== inputDigest)
      throw new Error("dataset input digest mismatch");
    return Object.freeze({ splitId: entry.splitId, input, inputDigest });
  });
  await verifyReceipt({
    value,
    schema: WIKISKILL_BENCHMARK_DATASET_RESOLUTION_SCHEMA,
    domain: WIKISKILL_BENCHMARK_DATASET_RESOLUTION_SCHEMA,
    authority: provider.descriptor,
    verifier: provider.verify,
    label: "dataset resolution",
  });
  return { cases, receiptDigest: value.receiptDigest };
}

async function runArm({
  runner,
  grader,
  plan,
  manifest,
  dataset,
  datasetReceiptDigest,
  item,
  seed,
  arm,
}) {
  const request = {
    planDigest: plan.planDigest,
    executionManifestDigest: manifest.manifestDigest,
    environmentDigest: manifest.targetEnvironmentDigest,
    seed,
    datasetId: dataset.id,
    datasetDigest: dataset.digest,
    datasetReceiptDigest,
    splitId: item.splitId,
    input: item.input,
    inputDigest: item.inputDigest,
    arm,
    skillDigest: arm === "skill" ? plan.skillDigest : null,
    wikiDigest: arm === "skill" ? plan.wikiDigest : null,
    model: plan.model,
    inference: plan.inference,
    environment: plan.environment,
    toolDigest: plan.toolDigest,
    apiDigest: plan.apiDigest,
    promptDigest: plan.promptDigest,
  };
  const requestDigest = hash(
    "chainlesschain.wikiskill-benchmark-runner-request/v1",
    request,
  );
  const result = await runner.invoke(
    Object.freeze({ ...request, requestDigest }),
  );
  exact(
    result,
    [
      "schema",
      "authenticated",
      "durable",
      "authorityId",
      "revision",
      "handlerArtifactDigest",
      "requestDigest",
      "outputRef",
      "outputDigest",
      "traceDigest",
      "failureClass",
      "tokens",
      "cost",
      "latencyMs",
      "receiptDigest",
      "attestation",
    ],
    "runner receipt",
  );
  if (
    result.requestDigest !== requestDigest ||
    !FAILURE_CLASSES.has(result.failureClass)
  ) {
    throw new Error("runner receipt differs from its request");
  }
  text(result.outputRef, "runner outputRef");
  digest(result.outputDigest, "runner outputDigest");
  digest(result.traceDigest, "runner traceDigest");
  integer(result.tokens, "runner tokens");
  finite(result.cost, "runner cost");
  finite(result.latencyMs, "runner latencyMs");
  await verifyReceipt({
    value: result,
    schema: WIKISKILL_BENCHMARK_RUNNER_RECEIPT_SCHEMA,
    domain: WIKISKILL_BENCHMARK_RUNNER_RECEIPT_SCHEMA,
    authority: runner.descriptor,
    verifier: runner.verify,
    label: "runner receipt",
  });

  const gradeRequest = {
    planDigest: plan.planDigest,
    executionManifestDigest: manifest.manifestDigest,
    datasetId: dataset.id,
    datasetDigest: dataset.digest,
    splitId: item.splitId,
    inputDigest: item.inputDigest,
    seed,
    arm,
    runnerReceiptDigest: result.receiptDigest,
    outputRef: result.outputRef,
    outputDigest: result.outputDigest,
    traceDigest: result.traceDigest,
  };
  const gradeRequestDigest = hash(
    "chainlesschain.wikiskill-benchmark-grader-request/v1",
    gradeRequest,
  );
  const grade = await grader.invoke(
    Object.freeze({ ...gradeRequest, requestDigest: gradeRequestDigest }),
  );
  exact(
    grade,
    [
      "schema",
      "authenticated",
      "durable",
      "authorityId",
      "revision",
      "handlerArtifactDigest",
      "requestDigest",
      "score",
      "receiptDigest",
      "attestation",
    ],
    "grader receipt",
  );
  if (
    grade.requestDigest !== gradeRequestDigest ||
    !Number.isFinite(grade.score) ||
    grade.score < 0 ||
    grade.score > 1
  ) {
    throw new Error("grader receipt differs from its request");
  }
  await verifyReceipt({
    value: grade,
    schema: WIKISKILL_BENCHMARK_GRADER_RECEIPT_SCHEMA,
    domain: WIKISKILL_BENCHMARK_GRADER_RECEIPT_SCHEMA,
    authority: grader.descriptor,
    verifier: grader.verify,
    label: "grader receipt",
  });
  return Object.freeze({
    score: grade.score,
    traceDigest: result.traceDigest,
    graderReceiptDigest: grade.receiptDigest,
    failureClass: result.failureClass,
    tokens: result.tokens,
    cost: result.cost,
    latencyMs: result.latencyMs,
  });
}

export async function executeWikiSkillBenchmarkProduction({
  plan: planInput,
  executionManifest: manifestInput,
  datasetProvider,
  runner,
  grader,
  reportAttestor,
} = {}) {
  const { plan, executionManifest: manifest } =
    verifyWikiSkillBenchmarkExecutionBinding({
      plan: planInput,
      executionManifest: manifestInput,
    });
  const datasets = captureProvider(
    datasetProvider,
    DATASET_PROVIDERS,
    "load",
    "benchmark dataset provider",
  );
  const targetRunner = captureProvider(
    runner,
    RUNNER_PROVIDERS,
    "run",
    "benchmark runner",
  );
  const independentGrader = captureProvider(
    grader,
    GRADER_PROVIDERS,
    "grade",
    "benchmark grader",
  );
  const attestor = captureProvider(
    reportAttestor,
    REPORT_ATTESTORS,
    "attest",
    "benchmark report attestor",
  );
  for (const [actual, expected, label] of [
    [datasets.descriptor, manifest.datasetProvider, "dataset provider"],
    [targetRunner.descriptor, manifest.runner, "runner"],
    [independentGrader.descriptor, manifest.grader, "grader"],
    [attestor.descriptor, manifest.reportAttestor, "report attestor"],
  ]) {
    if (!sameAuthority(actual, expected))
      throw new Error(`${label} differs from the execution manifest`);
  }

  const loaded = new Map();
  for (const dataset of plan.datasets) {
    loaded.set(dataset.id, await loadDataset(datasets, plan, dataset));
  }
  const runs = [];
  for (const seed of plan.seedSchedule) {
    const cases = [];
    for (const dataset of plan.datasets) {
      const resolved = loaded.get(dataset.id);
      for (const splitId of dataset.splitIds) {
        const item = resolved.cases.find((entry) => entry.splitId === splitId);
        const baseline = await runArm({
          runner: targetRunner,
          grader: independentGrader,
          plan,
          manifest,
          dataset,
          datasetReceiptDigest: resolved.receiptDigest,
          item,
          seed,
          arm: "no-skill",
        });
        const skill = await runArm({
          runner: targetRunner,
          grader: independentGrader,
          plan,
          manifest,
          dataset,
          datasetReceiptDigest: resolved.receiptDigest,
          item,
          seed,
          arm: "skill",
        });
        cases.push({ datasetId: dataset.id, splitId, baseline, skill });
      }
    }
    runs.push({
      runId: hash("chainlesschain.wikiskill-benchmark-production-run/v1", {
        planDigest: plan.planDigest,
        executionManifestDigest: manifest.manifestDigest,
        seed,
      }),
      seed,
      cases,
    });
  }
  const report = buildWikiSkillBenchmarkReport({ plan, runs });
  const envelope = await signWikiSkillBenchmarkReport({
    report,
    attestor: async (reportDigest) => {
      const value = await attestor.invoke({
        reportDigest,
        planDigest: plan.planDigest,
        executionManifestDigest: manifest.manifestDigest,
      });
      exact(
        value,
        [
          "schema",
          "authorityId",
          "revision",
          "handlerArtifactDigest",
          "reportDigest",
          "planDigest",
          "executionManifestDigest",
          "issuedAt",
          "signature",
        ],
        "benchmark report attestation",
      );
      if (
        value.schema !== WIKISKILL_BENCHMARK_REPORT_ATTESTATION_SCHEMA ||
        value.reportDigest !== reportDigest ||
        value.planDigest !== plan.planDigest ||
        value.executionManifestDigest !== manifest.manifestDigest ||
        !sameAuthority(
          {
            authorityId: value.authorityId,
            revision: value.revision,
            handlerArtifactDigest: value.handlerArtifactDigest,
          },
          attestor.descriptor,
        ) ||
        !Number.isFinite(Date.parse(value.issuedAt ?? "")) ||
        typeof value.signature !== "string" ||
        value.signature.length < 32 ||
        (await attestor.verify({
          digest: reportDigest,
          attestation: value,
          authority: attestor.descriptor,
        })) !== true
      ) {
        throw new Error("benchmark report attestation rejected");
      }
      return value;
    },
  });
  return Object.freeze({ report, envelope });
}

export const computeWikiSkillBenchmarkExecutionDigest = hash;
