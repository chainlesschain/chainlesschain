/** Source-bound paid dispatch only after user authorization and account-free package proof. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadPublicGeneratorProof } from "./verify01-public-generator-binding.mjs";

const ids = ["verify-08", "verify-13", "verify-36", "first-run-darwin-vscode"];
const budgets = {
  modelTurns: 20,
  physicalRequests: 24,
  outputTokens: 8192,
  requestBodyBytes: 262144,
  requestTimeoutMs: 180000,
  contextWindowTokens: 32768,
  largerThanPriorRound: false,
};
export function assertAuthorizedPublic138Dispatch(
  plan,
  { source, ref, credentialPresent, runAttempt },
) {
  assert.match(source, /^[a-f0-9]{40}$/u);
  assert.ok(
    ref.startsWith("verify01-public138-run-") &&
      ref.includes(source.slice(0, 10)),
  );
  assert.equal(
    runAttempt,
    1,
    "Do not rerun a live dispatch; reconcile its journal",
  );
  assert.equal(
    credentialPresent,
    true,
    "Repository OpenAI credential is missing; no model dispatch allowed",
  );
  assert.deepEqual(plan.selectedSampleIds, ids);
  assert.equal(plan.provider, "openai");
  assert.equal(plan.model, "gpt-6.1-sol");
  assert.equal(plan.reviewChanges, true);
  assert.deepEqual(plan.requestBudgets, budgets);
  assert.equal(plan.maximumPhysicalRequestsAcrossSelectedSamples, 96);
  assert.deepEqual(plan.dispatches, [
    {
      group: "darwin-vscode",
      hosts: "macos",
      entries: "vscode",
      sampleIds: ["verify-08", "first-run-darwin-vscode"],
    },
    {
      group: "linux-cli",
      hosts: "linux",
      entries: "cli",
      sampleIds: ["verify-13"],
    },
    {
      group: "darwin-jetbrains",
      hosts: "macos",
      entries: "jetbrains",
      sampleIds: ["verify-36"],
    },
  ]);
  assert.deepEqual(plan.versions, {
    cli: "0.166.138",
    vscode: "0.37.174",
    jetbrains: "0.4.191",
    vscodeHost: "1.132.0",
    jetbrainsHost: "2025.2",
  });
  return true;
}

async function main() {
  const root = process.cwd(),
    directory = "docs/research/cli/verify01-openai-138",
    file = path.join(directory, "dispatch.json");
  const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
  const hash = (f) =>
    "sha256:" + createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const plan = read(path.join(directory, "retest-plan.json"));
  const source =
    process.env.GITHUB_SHA ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dry = process.argv.includes("--check-only");
  const ref =
    process.env.GITHUB_REF_NAME ||
    "verify01-public138-run-" + source.slice(0, 10);
  const state = {
    schema: 1,
    credentialConfigured: process.env.OPENAI_CREDENTIAL_PRESENT === "true",
    status:
      process.env.OPENAI_CREDENTIAL_PRESENT === "true"
        ? "preparing-dispatch"
        : "blocked-missing-repository-model-credential",
    scope: plan.scope,
    source,
    ref,
    managerRunId: process.env.GITHUB_RUN_ID || null,
    createdAt: new Date().toISOString(),
    provider: plan.provider,
    model: plan.model,
    packageSetPath: plan.packageSetPath,
    packageSetDigest: plan.packageSetDigest,
    projectSource: plan.projectSource,
    projectRevisionFile: plan.projectRevisionFile,
    selectedSampleIds: plan.selectedSampleIds,
    skippedSamples: plan.skippedSamples,
    reviewChanges: true,
    dispatches: plan.dispatches.map((d) => ({
      ...d,
      submissionStartedAt: null,
      submitted: false,
      runId: null,
    })),
  };
  const save = () =>
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
  if (!dry) save();
  assertAuthorizedPublic138Dispatch(plan, {
    source,
    ref,
    credentialPresent: dry || process.env.OPENAI_CREDENTIAL_PRESENT === "true",
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || "1"),
  });
  assert.equal(hash(plan.packageSetPath), plan.packageSetDigest);
  assert.equal(hash(plan.projectRevisionFile), plan.projectRevisionDigest);
  const manifest = read(plan.packageSetPath);
  loadPublicGeneratorProof(manifest, { repositoryRoot: root });
  assert.equal(manifest.releaseSourceCommits.cli, plan.projectSource);
  if (dry) {
    console.log(
      JSON.stringify({
        authorizedScopeValidated: true,
        samples: ids,
        workflowDispatches: 3,
        maximumPhysicalRequests: 96,
        modelRequests: 0,
      }),
    );
    return;
  }
  const api = (route, body) => {
    const args = [
      "api",
      "--method",
      body === undefined ? "GET" : "POST",
      "repos/chainlesschain/chainlesschain" + route,
    ];
    if (body !== undefined) args.push("--input", "-");
    const raw = execFileSync("gh", args, {
      encoding: "utf8",
      input: body === undefined ? undefined : JSON.stringify(body),
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GH_DEBUG: "" },
    });
    return raw.trim() ? JSON.parse(raw) : null;
  };
  const workflow = "/actions/workflows/verify01-native-task-campaign.yml";
  const runs = () =>
    api(
      `${workflow}/runs?head_sha=${source}&event=workflow_dispatch&per_page=100`,
    ).workflow_runs;
  assert.equal(
    runs().length,
    0,
    "Existing paid execution found; never redispatch blindly",
  );
  const known = new Set();
  for (const dispatch of state.dispatches) {
    dispatch.submissionStartedAt = new Date().toISOString();
    save();
    let uncertain = null;
    try {
      api(workflow + "/dispatches", {
        ref,
        inputs: {
          confirm_live: "true",
          provider: "openai",
          hosts: dispatch.hosts,
          entries: dispatch.entries,
          package_set: "latest",
          package_set_file: plan.packageSetPath,
          sample_ids: dispatch.sampleIds.join(","),
          project_revision_file: plan.projectRevisionFile,
          fetch_diagnostics: "false",
          review_changes: "true",
          accept_existing_run: "",
          accept_existing_commit: "",
        },
      });
      dispatch.submitted = true;
    } catch {
      uncertain =
        "Dispatch response uncertain; read existing runs without repeating POST";
      dispatch.submissionUncertain = true;
    }
    save();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const added = runs().filter((r) => !known.has(r.id));
      assert.ok(added.length <= 1, "Unexpected additional execution; stop");
      if (added.length) {
        const run = added[0];
        assert.equal(run.head_sha, source);
        assert.equal(run.head_branch, ref);
        known.add(run.id);
        dispatch.runId = run.id;
        dispatch.url = run.html_url;
        dispatch.submitted = true;
        save();
        console.log(
          JSON.stringify({
            group: dispatch.group,
            sampleIds: dispatch.sampleIds,
            runId: run.id,
            url: run.html_url,
          }),
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    assert.ok(
      dispatch.runId,
      uncertain ||
        "No workflow identity; reconcile before any further dispatch",
    );
  }
  state.allSubmitted = true;
  state.status = "all-authorized-samples-submitted";
  state.finishedAt = new Date().toISOString();
  save();
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
