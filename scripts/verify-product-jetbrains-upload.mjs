import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// User authorization (2026-11-02): release these clients after the verified
// JetBrains upload; do not wait for Marketplace review. Other releases keep
// the normal public-listing requirement.
export const REVIEW_EXCEPTION = Object.freeze({
  productVersion: "v5.0.3.144",
  cliVersion: "0.166.139",
  version: "0.4.192",
  source: "eec8b97b6040d19004670bfead0bec1b8a27b71b",
  runId: 41434982670,
  repository: "chainlesschain/chainlesschain",
  tag: "ide-jetbrains-v0.4.192",
});

export function allowsReviewException(productVersion, version, cliVersion) {
  return (
    productVersion === REVIEW_EXCEPTION.productVersion &&
    version === REVIEW_EXCEPTION.version &&
    cliVersion === REVIEW_EXCEPTION.cliVersion
  );
}

export function verifyUploadAuthority({
  productVersion,
  version,
  cliVersion,
  tagSha,
  run,
  jobs,
}) {
  assert.ok(
    allowsReviewException(productVersion, version, cliVersion),
    "No user-authorized review exception for this product/IDE/CLI pairing",
  );
  assert.equal(tagSha, REVIEW_EXCEPTION.source, "IDE tag source mismatch");
  assert.equal(run.id, REVIEW_EXCEPTION.runId);
  assert.equal(run.repository?.full_name, REVIEW_EXCEPTION.repository);
  assert.equal(run.path, ".github/workflows/ide-extensions.yml");
  assert.equal(run.event, "push");
  assert.equal(run.head_branch, REVIEW_EXCEPTION.tag);
  assert.equal(run.head_sha, tagSha);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt >= 1);
  const upload = jobs.filter(
    (job) => job.name === "JetBrains plugin (build + publish)",
  );
  assert.equal(upload.length, 1, "Exactly one official upload job is required");
  assert.equal(upload[0].run_id, run.id);
  assert.equal(upload[0].status, "completed");
  assert.equal(upload[0].conclusion, "success");
  const publish = upload[0].steps?.filter(
    (step) => step.name === "Publish to JetBrains Marketplace",
  );
  assert.equal(publish?.length, 1, "Marketplace upload proof is missing");
  assert.equal(publish[0].status, "completed");
  assert.equal(publish[0].conclusion, "success");
  return {
    source: tagSha,
    tag: REVIEW_EXCEPTION.tag,
    runId: run.id,
    attempt: run.run_attempt,
    jobId: upload[0].id,
    uploadVerified: true,
  };
}

async function githubJson(endpoint, token) {
  const response = await fetch(`https://api.github.com/${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `GitHub upload verification HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const version = process.argv[2];
  const productVersion = JSON.parse(
    fs.readFileSync("package.json", "utf8"),
  ).productVersion;
  const cliVersion = JSON.parse(
    fs.readFileSync("packages/cli/package.json", "utf8"),
  ).version;
  assert.ok(allowsReviewException(productVersion, version, cliVersion));
  assert.equal(process.env.GITHUB_REPOSITORY, REVIEW_EXCEPTION.repository);
  const token = process.env.GITHUB_TOKEN;
  assert.ok(token, "GITHUB_TOKEN is required to verify the official upload");
  const tagSha = execFileSync(
    "git",
    ["rev-parse", `${REVIEW_EXCEPTION.tag}^{commit}`],
    { encoding: "utf8" },
  ).trim();
  const base = `repos/${REVIEW_EXCEPTION.repository}/actions/runs/${REVIEW_EXCEPTION.runId}`;
  const run = await githubJson(base, token);
  const jobs = [];
  for (let page = 1; ; page += 1) {
    const result = await githubJson(
      `${base}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
      token,
    );
    jobs.push(...result.jobs);
    if (jobs.length === result.total_count) break;
    assert.ok(
      result.jobs.length > 0 && jobs.length < result.total_count,
      "Incomplete or inconsistent upload job pagination",
    );
  }
  const authority = verifyUploadAuthority({
    productVersion,
    version,
    cliVersion,
    tagSha,
    run,
    jobs,
  });
  const marketplace = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "scripts/verify-ide-marketplace.mjs",
        "jetbrains",
        version,
        "--allow-pending",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ),
  );
  assert.equal(marketplace.channel, "jetbrains");
  assert.equal(marketplace.version, version);
  assert.ok(["ready", "pending"].includes(marketplace.status));
  console.log(
    JSON.stringify({
      schema: "chainlesschain.product-ide-upload-authorization.v1",
      productVersion,
      cliVersion,
      version,
      status:
        marketplace.status === "ready"
          ? "ready"
          : "uploaded-review-pending-authorized",
      publicAvailabilityVerified: marketplace.status === "ready",
      authorization:
        "User authorized product144 before JetBrains review completes",
      authority,
      marketplace,
    }),
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
