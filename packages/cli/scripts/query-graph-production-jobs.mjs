#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_PAGES = 10;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const COMMIT = /^[a-f0-9]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function fail(message) {
  throw new Error(`Graph Actions job query rejected: ${message}`);
}

function required(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value || value.startsWith("--")) fail(`${name} is required`);
  return value;
}

function positive(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(`${field} is invalid`);
  return number;
}

async function boundedJson(response) {
  if (!response.ok) fail(`GitHub Jobs API returned HTTP ${response.status}`);
  if (
    !String(response.headers.get("content-type") || "")
      .toLowerCase()
      .startsWith("application/json")
  ) {
    fail("GitHub Jobs API did not return application/json");
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (
    !Number.isSafeInteger(declared) ||
    declared < 0 ||
    declared > MAX_PAGE_BYTES
  ) {
    fail("GitHub Jobs API page has an invalid content length");
  }
  if (!response.body) fail("GitHub Jobs API page has no body");
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_PAGE_BYTES) fail("GitHub Jobs API page is oversized");
    chunks.push(Buffer.from(chunk));
  }
  if (total < 1 || (declared > 0 && total !== declared)) {
    fail("GitHub Jobs API page is empty or truncated");
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } catch {
    fail("GitHub Jobs API page is not valid JSON");
  }
}

export async function queryGraphProductionJobs({
  apiUrl,
  token,
  repository,
  runId,
  runAttempt,
  headSha,
  currentJobName,
  fetchImpl = fetch,
}) {
  let base;
  try {
    base = new URL(apiUrl);
  } catch {
    base = null;
  }
  if (
    !base ||
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !REPOSITORY.test(repository) ||
    !COMMIT.test(headSha) ||
    typeof token !== "string" ||
    token.length < 1
  ) {
    fail("API identity, repository, commit, or token is invalid");
  }
  const id = positive(runId, "run id");
  const attempt = positive(runAttempt, "run attempt");
  const jobs = [];
  const ids = new Set();
  let apiTotalCount;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const endpoint = new URL(
      `repos/${repository}/actions/runs/${id}/attempts/${attempt}/jobs`,
      `${base.toString().replace(/\/?$/u, "/")}`,
    );
    endpoint.searchParams.set("per_page", "100");
    endpoint.searchParams.set("page", String(page));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let body;
    try {
      body = await boundedJson(
        await fetchImpl(endpoint, {
          redirect: "error",
          signal: controller.signal,
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "x-github-api-version": "2022-11-28",
          },
        }),
      );
    } finally {
      clearTimeout(timeout);
    }
    if (
      !Number.isSafeInteger(Number(body?.total_count)) ||
      Number(body.total_count) < 1 ||
      !Array.isArray(body?.jobs) ||
      (apiTotalCount !== undefined &&
        apiTotalCount !== Number(body.total_count))
    ) {
      fail("GitHub Jobs API page has an inconsistent total_count");
    }
    apiTotalCount = Number(body.total_count);
    for (const job of body.jobs) {
      const jobId = positive(job?.id, "job id");
      if (ids.has(jobId)) fail("GitHub Jobs API pagination repeated a job id");
      ids.add(jobId);
      jobs.push(job);
    }
    if (jobs.length >= apiTotalCount) break;
    if (body.jobs.length === 0)
      fail("GitHub Jobs API pagination was truncated");
  }
  if (jobs.length !== apiTotalCount) {
    fail("GitHub Jobs API pagination did not match total_count");
  }
  const envelope = {
    apiTotalCount,
    workflowRunId: id,
    workflowRunAttempt: attempt,
    headSha,
  };
  if (currentJobName) {
    const matches = jobs.filter(
      (job) => job?.name === currentJobName && job?.status === "in_progress",
    );
    if (matches.length !== 1)
      fail("current source job is missing or ambiguous");
    return { ...envelope, fetchedJobCount: jobs.length, job: matches[0] };
  }
  return { ...envelope, jobs };
}

function writeNewPrivateJson(value, outputPath) {
  const output = path.resolve(outputPath);
  const runnerTemp = fs.realpathSync(
    path.resolve(process.env.RUNNER_TEMP || ""),
  );
  if (path.dirname(output) !== runnerTemp || fs.existsSync(output)) {
    fail("output must be a new direct child of RUNNER_TEMP");
  }
  const parent = fs.lstatSync(runnerTemp);
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (process.platform !== "win32" &&
      ((parent.mode & 0o022) !== 0 ||
        (typeof process.getuid === "function" &&
          parent.uid !== process.getuid())))
  ) {
    fail("RUNNER_TEMP is not a private runner-owned directory");
  }
  const fd = fs.openSync(
    output,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
    0o400,
  );
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`, "utf8");
    fs.fsyncSync(fd);
    if (process.platform !== "win32") fs.fchmodSync(fd, 0o400);
  } finally {
    fs.closeSync(fd);
  }
  return output;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  queryGraphProductionJobs({
    apiUrl: process.env.GITHUB_API_URL,
    token: process.env.GITHUB_TOKEN,
    repository: required("--repository"),
    runId: required("--run-id"),
    runAttempt: required("--run-attempt"),
    headSha: required("--commit"),
    currentJobName: process.argv.includes("--current-job-name")
      ? required("--current-job-name")
      : undefined,
  })
    .then((value) => writeNewPrivateJson(value, required("--output")))
    .then((output) => process.stdout.write(`${output}\n`))
    .catch((error) => {
      process.stderr.write(`${error?.message || error}\n`);
      process.exitCode = 1;
    });
}
