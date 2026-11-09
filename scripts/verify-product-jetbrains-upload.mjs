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

// User authorization (2026-11-05): publish product145 while JetBrains reviews
// the already-tested and uploaded .195 plugin. This is a separate, exact-source
// authorization; the product144 record and all other public gates stay intact.
export const REVIEW_EXCEPTIONS = Object.freeze([
  REVIEW_EXCEPTION,
  Object.freeze({
    productVersion: "v5.0.3.145",
    cliVersion: "0.166.142",
    version: "0.4.195",
    source: "b78cf0af8c8b0491189465773b148ac77c332222",
    runId: 41950791667,
    repository: "chainlesschain/chainlesschain",
    tag: "ide-jetbrains-v0.4.195",
  }),
  // User authorization (2026-11-10): product146 may follow the successful .199
  // upload during review. Its future upload is bound to the immutable CLI tag,
  // never to a PR build, a manual dispatch, or a successful listing probe alone.
  Object.freeze({
    productVersion: "v5.0.3.146",
    cliVersion: "0.166.146",
    version: "0.4.199",
    sourceTag: "v-npm-0-166-146",
    repository: "chainlesschain/chainlesschain",
    tag: "ide-jetbrains-v0.4.199",
  }),
]);

function reviewException(productVersion, version, cliVersion) {
  return REVIEW_EXCEPTIONS.find(
    (entry) =>
      productVersion === entry.productVersion &&
      version === entry.version &&
      cliVersion === entry.cliVersion,
  );
}

export function allowsReviewException(productVersion, version, cliVersion) {
  return Boolean(reviewException(productVersion, version, cliVersion));
}

export function selectOfficialUploadRun({
  productVersion,
  version,
  cliVersion,
  tagSha,
  npmTagSha,
  runs,
}) {
  const exception = reviewException(productVersion, version, cliVersion);
  assert.ok(
    exception?.sourceTag,
    "This pairing requires a pinned historical run",
  );
  assert.match(tagSha || "", /^[a-f0-9]{40}$/u);
  assert.equal(
    npmTagSha,
    tagSha,
    "IDE tag must match the immutable CLI release source",
  );
  const candidates = runs.filter(
    (run) =>
      run.repository?.full_name === exception.repository &&
      run.path === ".github/workflows/ide-extensions.yml" &&
      run.event === "push" &&
      run.head_branch === exception.tag &&
      run.head_sha === tagSha &&
      run.status === "completed" &&
      run.conclusion === "success",
  );
  assert.equal(
    candidates.length,
    1,
    "Exactly one successful official tagged upload run is required",
  );
  return candidates[0];
}

export function verifyUploadAuthority({
  productVersion,
  version,
  cliVersion,
  tagSha,
  npmTagSha,
  run,
  jobs,
  uploadAttempt = run.run_attempt,
}) {
  const exception = reviewException(productVersion, version, cliVersion);
  assert.ok(
    exception,
    "No user-authorized review exception for this product/IDE/CLI pairing",
  );
  if (exception.sourceTag) {
    assert.match(tagSha || "", /^[a-f0-9]{40}$/u);
    assert.equal(
      npmTagSha,
      tagSha,
      "IDE tag must match the immutable CLI release source",
    );
    assert.ok(Number.isSafeInteger(run.id) && run.id > 0);
  } else {
    assert.equal(tagSha, exception.source, "IDE tag source mismatch");
    assert.equal(run.id, exception.runId);
  }
  assert.equal(run.repository?.full_name, exception.repository);
  assert.equal(run.path, ".github/workflows/ide-extensions.yml");
  assert.equal(run.event, "push");
  assert.equal(run.head_branch, exception.tag);
  assert.equal(run.head_sha, tagSha);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt >= 1);
  assert.ok(
    Number.isSafeInteger(uploadAttempt) &&
      uploadAttempt >= 1 &&
      uploadAttempt <= run.run_attempt,
  );
  if (!exception.sourceTag) assert.equal(uploadAttempt, run.run_attempt);
  const upload = jobs.filter(
    (job) => job.name === "JetBrains plugin (build + publish)",
  );
  assert.equal(upload.length, 1, "Exactly one official upload job is required");
  assert.equal(upload[0].run_id, run.id);
  if (exception.sourceTag) {
    assert.equal(upload[0].head_sha, tagSha);
    assert.equal(upload[0].run_attempt, uploadAttempt);
  }
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
    tag: exception.tag,
    runId: run.id,
    attempt: run.run_attempt,
    runAttempt: run.run_attempt,
    uploadAttempt,
    jobId: upload[0].id,
    uploadVerified: true,
  };
}

export async function verifyUploadAttempts(options, loadAttemptJobs) {
  const exception = reviewException(
    options.productVersion,
    options.version,
    options.cliVersion,
  );
  assert.ok(exception, "No user-authorized review exception for this pairing");
  const latest = options.run.run_attempt;
  assert.ok(Number.isSafeInteger(latest) && latest >= 1);
  const earliest = exception.sourceTag ? 1 : latest;
  for (let uploadAttempt = latest; uploadAttempt >= earliest; uploadAttempt--) {
    const jobs = await loadAttemptJobs(uploadAttempt);
    // rerun-failed may rerun only the listing job. Never skip a present but
    // failed/skipped/ambiguous upload in order to reuse an older success.
    if (
      exception.sourceTag &&
      !jobs.some((job) => job.name === "JetBrains plugin (build + publish)")
    )
      continue;
    return verifyUploadAuthority({ ...options, jobs, uploadAttempt });
  }
  assert.fail("No actual official upload job exists in this run's attempts");
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
  const exception = reviewException(productVersion, version, cliVersion);
  assert.ok(exception, "No user-authorized review exception for this pairing");
  assert.equal(process.env.GITHUB_REPOSITORY, exception.repository);
  const token = process.env.GITHUB_TOKEN;
  assert.ok(token, "GITHUB_TOKEN is required to verify the official upload");
  const tagSha = execFileSync(
    "git",
    ["rev-parse", `${exception.tag}^{commit}`],
    { encoding: "utf8" },
  ).trim();
  let npmTagSha,
    runId = exception.runId;
  if (exception.sourceTag) {
    npmTagSha = execFileSync(
      "git",
      ["rev-parse", `${exception.sourceTag}^{commit}`],
      { encoding: "utf8" },
    ).trim();
    assert.equal(
      npmTagSha,
      tagSha,
      "IDE tag must match the immutable CLI release source",
    );
    const runs = [];
    for (let page = 1; ; page += 1) {
      const result = await githubJson(
        `repos/${exception.repository}/actions/workflows/ide-extensions.yml/runs?head_sha=${tagSha}&event=push&per_page=100&page=${page}`,
        token,
      );
      runs.push(...result.workflow_runs);
      if (runs.length === result.total_count) break;
      assert.ok(
        result.workflow_runs.length > 0 && runs.length < result.total_count,
        "Incomplete or inconsistent upload run pagination",
      );
    }
    runId = selectOfficialUploadRun({
      productVersion,
      version,
      cliVersion,
      tagSha,
      npmTagSha,
      runs,
    }).id;
  }
  const base = `repos/${exception.repository}/actions/runs/${runId}`;
  const run = await githubJson(base, token);
  const authority = await verifyUploadAttempts(
    {
      productVersion,
      version,
      cliVersion,
      tagSha,
      npmTagSha,
      run,
    },
    async (attempt) => {
      const jobs = [];
      for (let page = 1; ; page += 1) {
        const result = await githubJson(
          `${base}/attempts/${attempt}/jobs?per_page=100&page=${page}`,
          token,
        );
        jobs.push(...result.jobs);
        if (jobs.length === result.total_count) break;
        assert.ok(
          result.jobs.length > 0 && jobs.length < result.total_count,
          "Incomplete or inconsistent upload job pagination",
        );
      }
      return jobs;
    },
  );
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
      authorization: `User authorized ${productVersion} before JetBrains review completes`,
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
