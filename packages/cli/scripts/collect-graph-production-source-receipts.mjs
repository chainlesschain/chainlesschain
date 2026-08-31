#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  GRAPH_PRODUCTION_SOURCE_REGISTRY_PATH,
  loadTrustedGraphRuntimeSurfaceManifest,
  loadTrustedJsonFile,
} from "./assemble-graph-production-cutover-evidence.mjs";
import {
  GRAPH_PRODUCTION_SOURCE_RECEIPT_SCHEMA,
  graphProductionSourceRegistryDigest,
  normalizeGraphProductionSourceRegistry,
} from "../src/lib/graph-kernel/production-source-evidence.js";
import { graphRuntimeSurfaceManifestDigest } from "../src/lib/graph-kernel/runtime-surface-manifest.js";
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const COMMIT = /^[a-f0-9]{40}$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{32,128}$/u;
const REQUIRED_ROUTING_LABELS = [
  "graph-kernel-production",
  "physical",
  "self-hosted",
];

function fail(message) {
  const error = new Error(message);
  error.code = "CC_GRAPH_PRODUCTION_COLLECTOR_INVALID";
  throw error;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseArguments(argv) {
  const fields = {
    "--platform": "platform",
    "--expected-commit": "commitSha",
    "--repository": "repository",
    "--workflow-run-id": "workflowRunId",
    "--workflow-run-attempt": "workflowRunAttempt",
    "--challenge": "challenge",
    "--current-job": "currentJob",
    "--expected-registry-digest": "expectedRegistryDigest",
    "--output-directory": "outputDirectory",
  };
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const field = fields[argv[index]];
    const value = argv[index + 1];
    if (!field || !value || value.startsWith("--")) {
      fail(`unknown or incomplete argument: ${argv[index]}`);
    }
    options[field] = value;
    index += 1;
  }
  return options;
}

function positive(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail(`${field} must be a positive safe integer`);
  }
  return number;
}

function canonicalLabels(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${field} must be a non-empty array`);
  }
  const labels = value.map((entry) =>
    String(entry || "")
      .trim()
      .toLowerCase(),
  );
  if (
    labels.some((label) => !label) ||
    new Set(labels).size !== labels.length
  ) {
    fail(`${field} must contain unique non-empty labels`);
  }
  return labels.sort();
}

export function validateCurrentGraphProductionSourceJob(
  input,
  { platform, commitSha, workflowRunId, workflowRunAttempt, source },
) {
  const job = input?.job;
  const labels = canonicalLabels(job?.labels, "currentJob.job.labels");
  const requiredLabels = [...REQUIRED_ROUTING_LABELS, platform];
  const startedAt = Date.parse(String(job?.started_at || ""));
  if (
    Number(input?.apiTotalCount) !== Number(input?.fetchedJobCount) ||
    !Number.isSafeInteger(Number(input?.apiTotalCount)) ||
    Number(input.apiTotalCount) < 1 ||
    Number(input?.workflowRunId) !== Number(workflowRunId) ||
    Number(input?.workflowRunAttempt) !== Number(workflowRunAttempt) ||
    input?.headSha !== commitSha ||
    positive(job?.run_id, "currentJob.job.run_id") !== Number(workflowRunId) ||
    (job?.run_attempt != null &&
      positive(job.run_attempt, "currentJob.job.run_attempt") !==
        Number(workflowRunAttempt)) ||
    job?.head_sha !== commitSha ||
    job?.name !== `Collect signed ${platform} source receipts` ||
    job?.status !== "in_progress" ||
    job?.conclusion != null ||
    job?.completed_at != null ||
    !Number.isFinite(startedAt) ||
    (new Date(startedAt).toISOString() !== job?.started_at &&
      new Date(startedAt).toISOString().replace(/\.000Z$/u, "Z") !==
        job?.started_at) ||
    positive(job?.runner_id, "currentJob.job.runner_id") !==
      source.runner.registrationId ||
    job?.runner_name !== source.runner.name ||
    !requiredLabels.every((label) => labels.includes(label))
  ) {
    fail(
      "current Actions source job does not bind the exact run, attempt, commit, runner registration, and routing labels",
    );
  }
  return { id: positive(job.id, "currentJob.job.id"), labels };
}

async function collect(options) {
  for (const field of [
    "platform",
    "commitSha",
    "repository",
    "workflowRunId",
    "workflowRunAttempt",
    "challenge",
    "currentJob",
    "expectedRegistryDigest",
    "outputDirectory",
  ]) {
    if (!options[field]) fail(`${field} is required`);
  }
  if (!COMMIT.test(options.commitSha) || !CHALLENGE.test(options.challenge)) {
    fail("commit and hosted challenge are malformed");
  }
  const registryInput = loadTrustedJsonFile(
    GRAPH_PRODUCTION_SOURCE_REGISTRY_PATH,
    { field: "checked-in source registry" },
  );
  if (
    registryInput.registryDigest !== options.expectedRegistryDigest ||
    graphProductionSourceRegistryDigest(registryInput) !==
      options.expectedRegistryDigest
  ) {
    fail("checked-in source registry does not match the protected digest pin");
  }
  const manifest = loadTrustedGraphRuntimeSurfaceManifest();
  const registry = normalizeGraphProductionSourceRegistry(registryInput, {
    expectedRepository: options.repository,
    expectedManifestDigest: graphRuntimeSurfaceManifestDigest(manifest),
    expectedRegistryDigest: options.expectedRegistryDigest,
  });
  const source = registry.sources.find(
    (candidate) => candidate.platform === options.platform,
  );
  if (!source || source.runner.name !== process.env.RUNNER_NAME) {
    fail("this job is not running on the registry-pinned physical host");
  }
  const currentJob = validateCurrentGraphProductionSourceJob(
    loadTrustedJsonFile(options.currentJob, {
      field: "current-attempt Actions source job",
    }),
    {
      platform: options.platform,
      commitSha: options.commitSha,
      workflowRunId: options.workflowRunId,
      workflowRunAttempt: options.workflowRunAttempt,
      source,
    },
  );
  const token = process.env.GRAPH_KERNEL_PRODUCTION_COLLECTOR_TOKEN;
  if (
    typeof token !== "string" ||
    token.length < 32 ||
    sha256(token) !== source.collector.credentialDigest
  ) {
    fail("protected collector credential does not match the registry pin");
  }
  const request = {
    schema: "chainlesschain.graph-production-collection-request/v1",
    sourceId: source.sourceId,
    platform: source.platform,
    manifestDigest: registry.manifestDigest,
    registryDigest: registry.registryDigest,
    commitSha: options.commitSha,
    repository: options.repository,
    ref: "refs/heads/main",
    workflow: ".github/workflows/graph-kernel-production-evidence.yml",
    workflowRunId: Number(options.workflowRunId),
    workflowRunAttempt: Number(options.workflowRunAttempt),
    workflowJob: "source",
    workflowJobDatabaseId: currentJob.id,
    runner: source.runner,
    hardwareIdentityDigest: source.hardwareIdentityDigest,
    operatorIdentityDigest: source.operatorIdentityDigest,
    attester: source.attester,
    challenge: options.challenge,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let bytes;
  try {
    const response = await fetch(source.collector.endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      fail(`collector endpoint returned HTTP ${response.status}`);
    }
    if (
      !String(response.headers.get("content-type") || "")
        .toLowerCase()
        .startsWith("application/json")
    ) {
      fail("collector endpoint did not return application/json");
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_RESPONSE_BYTES
    ) {
      fail("collector response has an invalid or oversized content length");
    }
    if (!response.body) fail("collector response has no body stream");
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel("bounded collector response exceeded");
        fail("collector response is oversized");
      }
      chunks.push(Buffer.from(value));
    }
    if (total < 1 || (declaredLength && declaredLength !== total)) {
      fail("collector response is empty or does not match content-length");
    }
    bytes = Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timeout);
  }
  const body = JSON.parse(bytes.toString("utf8"));
  if (
    body?.schema !== "chainlesschain.graph-production-collection-response/v1" ||
    !Array.isArray(body.receipts) ||
    body.receipts.length !== 23
  ) {
    fail("collector must return exactly 23 signed entry receipts");
  }
  const keys = new Set();
  for (const receipt of body.receipts) {
    const payload = receipt?.payload;
    const key = `${payload?.surface}/${payload?.entryId}`;
    if (
      receipt?.schema !== undefined ||
      payload?.schema !== GRAPH_PRODUCTION_SOURCE_RECEIPT_SCHEMA ||
      payload?.sourceId !== source.sourceId ||
      payload?.platform !== source.platform ||
      payload?.commitSha !== request.commitSha ||
      payload?.workflowRunId !== request.workflowRunId ||
      payload?.workflowRunAttempt !== request.workflowRunAttempt ||
      payload?.workflowJobDatabaseId !== request.workflowJobDatabaseId ||
      payload?.hardwareIdentityDigest !== request.hardwareIdentityDigest ||
      payload?.operatorIdentityDigest !== request.operatorIdentityDigest ||
      JSON.stringify(payload?.attester) !== JSON.stringify(request.attester) ||
      payload?.challenge !== request.challenge ||
      keys.has(key)
    ) {
      fail("collector returned a duplicate or incorrectly bound receipt");
    }
    keys.add(key);
  }
  if (keys.size !== 23) fail("collector receipt coverage is incomplete");
  const runnerTemp = fs.realpathSync(
    path.resolve(process.env.RUNNER_TEMP || ""),
  );
  const output = path.resolve(options.outputDirectory);
  if (path.dirname(output) !== runnerTemp || fs.existsSync(output)) {
    fail("output directory must be a new direct child of RUNNER_TEMP");
  }
  fs.mkdirSync(output, { recursive: false, mode: 0o700 });
  const outputStat = fs.lstatSync(output);
  if (
    !outputStat.isDirectory() ||
    outputStat.isSymbolicLink() ||
    fs.realpathSync(output) !== output ||
    (process.platform !== "win32" &&
      ((outputStat.mode & 0o077) !== 0 ||
        (typeof process.getuid === "function" &&
          outputStat.uid !== process.getuid())))
  ) {
    fail("output directory is not a private runner-owned real directory");
  }
  body.receipts
    .sort((left, right) =>
      `${left.payload.surface}/${left.payload.entryId}`.localeCompare(
        `${right.payload.surface}/${right.payload.entryId}`,
      ),
    )
    .forEach((receipt, index) => {
      const file = path.join(
        output,
        `${source.platform}-${String(index).padStart(2, "0")}.json`,
      );
      fs.writeFileSync(file, `${JSON.stringify(receipt)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      const stat = fs.lstatSync(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size < 1 ||
        stat.size > 512 * 1024 ||
        path.dirname(fs.realpathSync(file)) !== output
      ) {
        fail("collector output failed its post-write filesystem check");
      }
    });
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  collect(parseArguments(process.argv.slice(2))).catch((error) => {
    process.stderr.write(
      `${error?.code ? `${error.code}: ` : ""}${error?.message || error}\n`,
    );
    process.exitCode = 1;
  });
}
