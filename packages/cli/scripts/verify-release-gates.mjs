#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_CLI_RELEASE_GATES = Object.freeze([
  {
    workflow: "cli-ci.yml",
    name: "CLI CI",
    platforms: ["linux", "windows", "macos"],
    optionalJobs: [/dry-run-publish/i],
  },
  {
    workflow: "cli-strict-sandbox.yml",
    name: "CLI Strict Sandbox",
    platforms: ["linux", "windows", "macos"],
  },
]);

const PLATFORM_PATTERNS = Object.freeze({
  linux: /ubuntu|linux/i,
  windows: /windows/i,
  macos: /macos|mac-/i,
});

function assertString(value, name) {
  if (!value || typeof value !== "string") {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function githubJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }
  return response.json();
}

export function jobPlatform(job) {
  const haystack = [job?.name, ...(job?.labels || [])]
    .filter(Boolean)
    .join(" ");
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    if (pattern.test(haystack)) return platform;
  }
  return null;
}

export function assertGateJobs(gate, jobs) {
  const isOptional = (job) =>
    (gate.optionalJobs || []).some((pattern) => pattern.test(job?.name || ""));
  const requiredJobs = (jobs || []).filter((job) => !isOptional(job));
  const failures = requiredJobs.filter(
    (job) => job.status !== "completed" || job.conclusion !== "success",
  );
  if (failures.length > 0) {
    throw new Error(
      `${gate.name} contains non-success jobs: ${failures
        .map((job) => `${job.name}=${job.status}/${job.conclusion}`)
        .join(", ")}`,
    );
  }
  const observed = new Set(requiredJobs.map(jobPlatform).filter(Boolean));
  const missing = gate.platforms.filter((platform) => !observed.has(platform));
  if (missing.length > 0) {
    throw new Error(
      `${gate.name} is missing required platform jobs: ${missing.join(", ")}`,
    );
  }
  return [...observed].sort();
}

export async function verifyWorkflowGate(options) {
  const {
    fetchImpl = fetch,
    apiUrl = "https://api.github.com",
    repository,
    token,
    sha,
    gate,
    waitMs = Number(process.env.CC_RELEASE_GATE_WAIT_MS || 0),
    pollMs = Number(process.env.CC_RELEASE_GATE_POLL_MS || 30000),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  assertString(repository, "repository");
  assertString(token, "token");
  assertString(sha, "sha");
  const runsUrl =
    `${apiUrl}/repos/${repository}/actions/workflows/${gate.workflow}/runs` +
    `?head_sha=${encodeURIComponent(sha)}&per_page=100`;
  const deadline = Date.now() + Math.max(0, waitMs);
  let run;
  let exactRuns = [];
  for (;;) {
    const runPayload = await githubJson(fetchImpl, runsUrl, token);
    exactRuns = (runPayload.workflow_runs || []).filter(
      (candidate) => candidate.head_sha === sha,
    );
    run = exactRuns
      .filter((candidate) => candidate.conclusion === "success")
      .sort((a, b) =>
        String(b.updated_at).localeCompare(String(a.updated_at)),
      )[0];
    if (run) break;
    const activeRun = exactRuns.some(
      (candidate) => candidate.status !== "completed",
    );
    const terminalFailure = exactRuns.find(
      (candidate) =>
        candidate.status === "completed" &&
        candidate.conclusion &&
        candidate.conclusion !== "success",
    );
    if ((!activeRun && terminalFailure) || Date.now() >= deadline) {
      const observed = exactRuns
        .map(
          (candidate) =>
            `${candidate.id}:${candidate.conclusion || candidate.status}`,
        )
        .join(", ");
      throw new Error(
        `${gate.name} has no successful completed run for exact SHA ${sha}` +
          (observed ? ` (observed ${observed})` : ""),
      );
    }
    await sleep(Math.max(1000, pollMs));
  }
  // GitHub keeps jobs from every attempt under the same run id. Release gates
  // must judge the latest attempt only; `filter=all` would mix an earlier
  // failed attempt with a successful rerun and permanently reject the SHA.
  const jobsUrl = `${apiUrl}/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`;
  const jobPayload = await githubJson(fetchImpl, jobsUrl, token);
  const platforms = assertGateJobs(gate, jobPayload.jobs || []);
  return {
    workflow: gate.workflow,
    name: gate.name,
    sha,
    runId: run.id,
    runUrl: run.html_url || null,
    conclusion: run.conclusion,
    platforms,
  };
}

export async function verifyCliReleaseGates(options = {}) {
  const sha = assertString(options.sha || process.env.GITHUB_SHA, "GITHUB_SHA");
  const repository = assertString(
    options.repository || process.env.GITHUB_REPOSITORY,
    "GITHUB_REPOSITORY",
  );
  const token = assertString(
    options.token || process.env.GITHUB_TOKEN,
    "GITHUB_TOKEN",
  );
  const results = [];
  for (const gate of options.gates || REQUIRED_CLI_RELEASE_GATES) {
    results.push(
      await verifyWorkflowGate({
        ...options,
        repository,
        token,
        sha,
        gate,
      }),
    );
  }
  return {
    schema: 1,
    verifiedAt: new Date().toISOString(),
    repository,
    sha,
    gates: results,
  };
}

async function main() {
  const result = await verifyCliReleaseGates();
  const output = path.resolve(
    process.env.CC_RELEASE_GATE_OUTPUT || "cli-release-gate.json",
  );
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Verified ${result.gates.length} CLI release gates for exact SHA ${result.sha}\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(`CLI release gate failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
