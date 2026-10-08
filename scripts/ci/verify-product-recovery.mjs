#!/usr/bin/env node
// One bounded recovery: build source identity never becomes controller identity.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const RECOVERY = Object.freeze({
  repository: "chainlesschain/chainlesschain",
  version: "v5.0.3.140",
  sourceSha: "f733f92cb953fffaafea9f91024bbf1c8846406d",
  npmSha: "65e8c21d3adfc37058ac9223a0c059b1b9a976d7",
  originalRunId: 37719495217,
  originalAttempt: 1,
  cliVersion: "0.166.93",
});
export const PRODUCERS = Object.freeze([
  [
    "build-windows",
    113124142659,
    "windows-artifacts",
    "Upload Windows artifacts",
  ],
  ["build-macos", 113124142699, "macos-artifacts", "Upload macOS artifacts"],
  ["build-linux", 113124142656, "linux-artifacts", "Upload Linux artifacts"],
  [
    "build-ios",
    113124142662,
    "ios-artifacts",
    "Verify signed iOS distribution artifact",
  ],
  [
    "Verify authorized CLI release precondition",
    113123631701,
    `product-release-cli-gate-${RECOVERY.sourceSha}`,
    "Upload consumed CLI gate attestation",
  ],
]);
export const SOURCE_GATES = Object.freeze([
  [37715634006, ".github/workflows/code-quality.yml"],
  [37715633997, ".github/workflows/test.yml"],
  [37715633934, ".github/workflows/test-automation-full.yml"],
  [37715634068, ".github/workflows/android-release-precheck.yml"],
  [37715634105, ".github/workflows/android-pr-check.yml"],
  [37715634076, ".github/workflows/cli-npm-release-readback.yml"],
]);
// Pinned from the original run's immutable artifact metadata, not name-only discovery.
export const ORIGINAL_ARTIFACTS = Object.freeze({
  "windows-artifacts": [
    11525458373,
    1032701418,
    "ed492ac35c934d513127034965a40410e4fa544bd80935ce20bbe29446e002cc",
  ],
  "macos-artifacts": [
    11527065260,
    2408051106,
    "2d3119eed03acca97094be7702510351d9a9283ecd1f8e2ed40b265530cfa930",
  ],
  "linux-artifacts": [
    11526540509,
    1812688606,
    "6b61b9841c3d8408794bbfa6c7e4dab24599804d91c7d4078392411d48aacc41",
  ],
  "ios-artifacts": [
    11524609247,
    10037429,
    "62c25d468c706c1fa0e91c57c338d92d5b74bc87d14818dd91e77dcbcbdff505",
  ],
  [`product-release-cli-gate-${RECOVERY.sourceSha}`]: [
    11525281945,
    2418,
    "3a950c3c97aa18f8e28a10882ab52aedbbc0e250733059c9ea99c82d7345a5ce",
  ],
});
const ANDROID_NAMES = [
  "app-arm64-v8a-release.apk",
  "app-armeabi-v7a-release.apk",
  "app-universal-release.apk",
  "app-release.aab",
];
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
export function hashFile(file) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, "r");
  try {
    for (let n; (n = fs.readSync(fd, buffer)) > 0;)
      hash.update(buffer.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}
function exactlyOne(items, predicate, label) {
  const found = items.filter(predicate);
  assert.equal(found.length, 1, `Expected exactly one ${label}`);
  return found[0];
}
function requireStep(job, name) {
  const step = exactlyOne(
    job.steps || [],
    (s) => s.name === name,
    `step ${name}`,
  );
  assert.equal(
    step.conclusion,
    "success",
    `${job.name}: ${name} failed or skipped`,
  );
}
function requireJob(jobs, name, sha, runId, expectedId) {
  const job = exactlyOne(jobs, (j) => j.name === name, `job ${name}`);
  assert.equal(job.head_sha, sha, `${name}: source mismatch`);
  assert.equal(job.run_id, runId, `${name}: run mismatch`);
  if (expectedId) assert.equal(job.id, expectedId, `${name}: job ID mismatch`);
  assert.equal(job.status, "completed", `${name}: not complete`);
  assert.equal(job.conclusion, "success", `${name}: not successful`);
  return job;
}
export function requireArtifact(artifacts, name, run, job, now = Date.now()) {
  const artifact = exactlyOne(
    artifacts,
    (a) => a.name === name,
    `artifact ${name}`,
  );
  assert.ok(
    Number.isSafeInteger(artifact.id) && artifact.id > 0,
    "Invalid artifact ID",
  );
  assert.equal(artifact.expired, false, `${name}: expired`);
  assert.ok(Date.parse(artifact.expires_at) > now, `${name}: expiry elapsed`);
  assert.ok(artifact.size_in_bytes > 0, `${name}: empty artifact`);
  assert.match(
    artifact.digest || "",
    /^sha256:[a-f0-9]{64}$/,
    `${name}: no immutable digest`,
  );
  assert.equal(artifact.workflow_run?.id, run.id, `${name}: foreign run`);
  assert.equal(
    artifact.workflow_run?.head_sha,
    run.head_sha,
    `${name}: foreign source`,
  );
  assert.equal(
    artifact.workflow_run?.repository_id,
    run.repository.id,
    `${name}: foreign repository`,
  );
  const created = Date.parse(artifact.created_at);
  assert.ok(
    created >= Date.parse(job.started_at) &&
      created <= Date.parse(job.completed_at),
    `${name}: artifact outside producer execution window`,
  );
  return {
    id: artifact.id,
    name,
    digest: artifact.digest,
    sizeInBytes: artifact.size_in_bytes,
    createdAt: artifact.created_at,
    expiresAt: artifact.expires_at,
    runId: run.id,
    workflowHeadSha: run.head_sha,
    producerJobId: job.id,
    producerJobName: job.name,
  };
}
export function auditOriginal(
  { run, jobs, artifacts, gates },
  now = Date.now(),
) {
  assert.equal(run.id, RECOVERY.originalRunId, "Wrong original run");
  assert.equal(
    run.repository?.full_name,
    RECOVERY.repository,
    "Foreign repository",
  );
  assert.equal(run.head_sha, RECOVERY.sourceSha, "Wrong original source");
  assert.equal(
    run.path,
    ".github/workflows/release.yml",
    "Wrong original workflow",
  );
  assert.equal(run.event, "workflow_dispatch", "Wrong original event");
  assert.equal(run.run_attempt, 1, "Original run was retried; review required");
  assert.equal(run.status, "completed", "Original run still active");
  assert.equal(run.conclusion, "failure", "Unexpected original outcome");
  const dependencies = requireJob(
    jobs,
    "Verify public workspace dependencies (no publishing)",
    RECOVERY.sourceSha,
    run.id,
    113124014902,
  );
  requireStep(dependencies, "Fetch every exact public workspace package");
  const android = exactlyOne(
    jobs,
    (j) => j.id === 113124142622,
    "original Android job",
  );
  assert.equal(android.name, "build-android");
  assert.equal(android.conclusion, "failure");
  requireStep(android, "Build release APK");
  requireStep(android, "Build App Bundle");
  assert.equal(
    exactlyOne(
      android.steps,
      (s) => s.name === "Verify cc bundle packed into APKs (hard gate)",
      "original verifier failure",
    ).conclusion,
    "failure",
  );
  const verifiedArtifacts = PRODUCERS.map(([name, id, artifactName, step]) => {
    const job = requireJob(jobs, name, RECOVERY.sourceSha, run.id, id);
    requireStep(job, step);
    const artifact = requireArtifact(artifacts, artifactName, run, job, now);
    const [artifactId, bytes, digest] = ORIGINAL_ARTIFACTS[artifactName];
    assert.equal(
      artifact.id,
      artifactId,
      `${artifactName}: original artifact ID changed`,
    );
    assert.equal(
      artifact.sizeInBytes,
      bytes,
      `${artifactName}: original artifact size changed`,
    );
    assert.equal(
      artifact.digest,
      `sha256:${digest}`,
      `${artifactName}: original artifact digest changed`,
    );
    return artifact;
  });
  for (const [id, workflow] of SOURCE_GATES) {
    const gate = exactlyOne(gates, (g) => g.id === id, `source gate ${id}`);
    assert.equal(
      gate.repository?.full_name,
      RECOVERY.repository,
      "Foreign source gate",
    );
    assert.equal(gate.head_sha, RECOVERY.sourceSha, "Stale source gate");
    assert.equal(gate.path, workflow, "Wrong source gate workflow");
    assert.equal(gate.event, "pull_request", "Wrong source gate event");
    assert.equal(gate.status, "completed");
    assert.equal(gate.conclusion, "success", `Source gate failed: ${workflow}`);
  }
  return {
    schema: 1,
    ...RECOVERY,
    auditedAt: new Date(now).toISOString(),
    artifacts: verifiedArtifacts,
    sourceGates: gates.map((g) => ({
      id: g.id,
      path: g.path,
      headSha: g.head_sha,
      conclusion: g.conclusion,
    })),
    successfulProducerJobs: [
      ...PRODUCERS.map(([name, id]) => ({ name, id })),
      { name: dependencies.name, id: dependencies.id },
    ],
  };
}
export function auditRecoveryAndroid(
  run,
  jobs,
  artifacts,
  controllerSha,
  attempt,
  now = Date.now(),
  producerAttempt = attempt,
) {
  assert.equal(run.repository?.full_name, RECOVERY.repository);
  assert.equal(run.path, ".github/workflows/product-release-recovery.yml");
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.head_sha, controllerSha);
  assert.equal(run.run_attempt, attempt);
  assert.ok(
    Number.isSafeInteger(producerAttempt) &&
      producerAttempt > 0 &&
      producerAttempt <= attempt,
    "Invalid Android producer attempt",
  );
  const job = requireJob(
    jobs,
    "Rebuild and verify original Android source",
    controllerSha,
    run.id,
  );
  requireStep(job, "Verify release signatures and pinned CLI bundle");
  requireStep(job, "Upload verified Android recovery artifact");
  if (job.run_attempt != null) assert.equal(job.run_attempt, producerAttempt);
  const artifact = requireArtifact(
    artifacts,
    `product-recovery-android-${run.id}-${producerAttempt}`,
    run,
    job,
    now,
  );
  return { ...artifact, producerAttempt };
}
export async function latestAndroidProducer(
  runId,
  attempt,
  fetchJobs = (id, n) => pages(`actions/runs/${id}/attempts/${n}/jobs`, "jobs"),
) {
  assert.ok(Number.isSafeInteger(attempt) && attempt > 0 && attempt <= 50);
  for (let producerAttempt = attempt; producerAttempt >= 1; producerAttempt--) {
    const jobs = await fetchJobs(runId, producerAttempt);
    if (
      jobs.some(
        (job) => job.name === "Rebuild and verify original Android source",
      )
    ) {
      // A newer failed producer is not replaced by an older success. The caller
      // validates this first actual producer before accepting its immutable ZIP.
      return { jobs, producerAttempt };
    }
  }
  throw new Error("No Android producer exists in this recovery run");
}
async function github(endpoint, allow404 = false) {
  assert.equal(process.env.GITHUB_REPOSITORY, RECOVERY.repository);
  const response = await fetch(
    `https://api.github.com/repos/${RECOVERY.repository}/${endpoint}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (allow404 && response.status === 404) return null;
  assert.ok(response.ok, `GitHub ${endpoint}: HTTP ${response.status}`);
  return response.json();
}
async function pages(endpoint, key) {
  const items = [];
  for (let page = 1; page <= 50; page++) {
    const data = await github(
      `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    assert.ok(Array.isArray(data[key]));
    items.push(...data[key]);
    if (items.length === data.total_count) return items;
    assert.ok(
      data[key].length > 0 && items.length < data.total_count,
      "Incomplete or inconsistent pagination",
    );
  }
  throw new Error("Pagination bound exceeded");
}
async function originalSnapshot() {
  const id = RECOVERY.originalRunId;
  const [run, jobs, artifacts, gates] = await Promise.all([
    github(`actions/runs/${id}`),
    pages(`actions/runs/${id}/attempts/1/jobs`, "jobs"),
    pages(`actions/runs/${id}/artifacts`, "artifacts"),
    Promise.all(SOURCE_GATES.map(([gate]) => github(`actions/runs/${gate}`))),
  ]);
  return { run, jobs, artifacts, gates };
}
// ZIP extraction is deliberately after verification of the raw Actions archive digest.
export function extractVerifiedZip(zip, directory, expectedDigest) {
  assert.equal(
    `sha256:${hashFile(zip)}`,
    expectedDigest,
    "Raw artifact digest mismatch",
  );
  assert.ok(!fs.existsSync(directory), "Extraction directory already exists");
  const python = process.platform === "win32" ? "python" : "python3";
  execFileSync(
    python,
    [
      "-c",
      `
import pathlib,stat,sys,zipfile
src,dest=map(pathlib.Path,sys.argv[1:])
with zipfile.ZipFile(src) as z:
 entries=z.infolist(); seen=set(); total=0
 assert len(entries)<=10000, 'Too many archive entries'
 for e in entries:
  name=e.filename; parts=name.rstrip('/').split('/')
  assert name and not name.startswith('/') and '\\\\' not in name and ':' not in name, 'Unsafe archive path'
  assert all(p not in ('','.','..') for p in parts), 'Unsafe archive components'
  assert name.lower() not in seen, 'Duplicate archive path'
  seen.add(name.lower()); kind=stat.S_IFMT(e.external_attr>>16)
  assert kind in (0,stat.S_IFREG,stat.S_IFDIR), 'Non-regular archive entry'
  total+=e.file_size; assert total<=20*1024**3, 'Oversized archive'
 dest.mkdir(parents=True)
 z.extractall(dest)
`,
      zip,
      directory,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}
async function downloadArtifact(artifact, root) {
  const zip = path.join(root, `${artifact.id}.zip`);
  const response = await fetch(
    `https://api.github.com/repos/${RECOVERY.repository}/actions/artifacts/${artifact.id}/zip`,
    {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
      signal: AbortSignal.timeout(30 * 60_000),
    },
  );
  assert.ok(
    response.ok && response.body,
    `Artifact ${artifact.id}: HTTP ${response.status}`,
  );
  await pipeline(response.body, fs.createWriteStream(zip, { flags: "wx" }));
  assert.equal(
    fs.statSync(zip).size,
    artifact.sizeInBytes,
    "Raw artifact size mismatch",
  );
  const directory = path.join(root, artifact.name);
  extractVerifiedZip(zip, directory, artifact.digest);
  fs.unlinkSync(zip);
  return directory;
}
function sourceIdentity(source) {
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim(),
    RECOVERY.sourceSha,
    "Checkout is not the original payload source",
  );
  assert.equal(
    readJson(path.join(source, "desktop-app-vue/package.json")).version,
    "5.0.3-alpha.140",
  );
  assert.equal(
    readJson(path.join(source, "packages/cli/package.json")).version,
    RECOVERY.cliVersion,
  );
  assert.equal(
    readJson(path.join(source, "packages/vscode-extension/package.json"))
      .version,
    "0.37.138",
  );
  assert.match(
    fs.readFileSync(
      path.join(source, "android-app/binaries-manifest.txt"),
      "utf8",
    ),
    /^84adcff64a5ddc00647e44ba12983ba23a9ade2ffd5bbfa3ebdb64b9d86b72a6\s+cc-cli\.tgz\s/m,
  );
  assert.equal(
    execFileSync("git", ["rev-parse", "v-npm-0-166-93^{commit}"], {
      cwd: source,
      encoding: "utf8",
    }).trim(),
    RECOVERY.npmSha,
  );
  execFileSync(
    "git",
    [
      "diff",
      "--exit-code",
      RECOVERY.npmSha,
      RECOVERY.sourceSha,
      "--",
      "packages",
    ],
    { cwd: source, stdio: "pipe" },
  );
}
function controllerIdentity(source) {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "Recovery runs only inside GitHub Actions",
  );
  assert.match(process.env.GITHUB_SHA || "", /^[a-f0-9]{40}$/);
  assert.equal(process.env.GITHUB_REPOSITORY, RECOVERY.repository);
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(
    process.env.GITHUB_REF,
    "refs/heads/main",
    "Recovery controller must be reviewed main",
  );
  const controller = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: controller,
      encoding: "utf8",
    }).trim(),
    process.env.GITHUB_SHA,
    "Controller checkout mismatch",
  );
  execFileSync(
    "git",
    [
      "diff",
      "--exit-code",
      RECOVERY.sourceSha,
      process.env.GITHUB_SHA,
      "--",
      "packages",
    ],
    { cwd: controller, stdio: "pipe" },
  );
  sourceIdentity(source);
  return controller;
}
export function verifyCliEvidence(directory) {
  const gate = readJson(path.join(directory, "cli-release-gate.json"));
  assert.equal(gate.sha, RECOVERY.npmSha);
  assert.equal(gate.repository, RECOVERY.repository);
  for (const workflow of ["cli-ci.yml", "cli-strict-sandbox.yml"]) {
    const entry = exactlyOne(
      gate.gates,
      (g) => g.workflow === workflow,
      workflow,
    );
    assert.equal(entry.sha, RECOVERY.npmSha);
    assert.equal(entry.conclusion, "success");
  }
  const provenance = readJson(path.join(directory, "cli-npm-provenance.json"));
  assert.equal(provenance.package, "chainlesschain");
  assert.equal(provenance.version, RECOVERY.cliVersion);
  assert.equal(provenance.commit, RECOVERY.npmSha);
  assert.equal(provenance.ref, "refs/tags/v-npm-0-166-93");
  assert.equal(
    provenance.repository,
    `https://github.com/${RECOVERY.repository}`,
  );
  assert.equal(provenance.workflow, ".github/workflows/npm-publish.yml");
  assert.match(provenance.sha512, /^[a-f0-9]{128}$/);
  assert.equal(provenance.audit.invalid, 0);
  assert.equal(provenance.audit.missing, 0);
  const installed = readJson(
    path.join(directory, "product-release-cli-child-install.json"),
  );
  assert.equal(installed.package, "chainlesschain");
  assert.equal(installed.version, RECOVERY.cliVersion);
  // The original job passes the source package.json (no registry `dist` field).
  // That verifier labels this mode candidate-tarball even after npm install
  // from the public registry. Public CLI byte identity is established by the
  // separate npm attestation and fresh public tarball SHA-512 comparison.
  assert.equal(installed.cliSource, "immutable-candidate-tarball");
  assert.equal(installed.childrenSource, "https://registry.npmjs.org");
  return { gate, provenance, installed };
}
function androidReceipt(source, output) {
  const controller = controllerIdentity(source);
  fs.mkdirSync(output, { recursive: true });
  const assets = ANDROID_NAMES.map((name) => {
    const original = path.join(
      source,
      "android-app/app/build/outputs",
      name.endsWith(".aab") ? "bundle/release" : "apk/release",
      name,
    );
    const target = path.join(output, name);
    fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
    return { name, size: fs.statSync(target).size, sha256: hashFile(target) };
  });
  writeJson(path.join(output, "android-build-receipt.json"), {
    schema: 1,
    sourceSha: RECOVERY.sourceSha,
    controllerSha: process.env.GITHUB_SHA,
    runId: Number(process.env.GITHUB_RUN_ID),
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    version: RECOVERY.version,
    assets,
    helperSha256: hashFile(
      path.join(controller, "scripts/ci/verify-android-release-artifacts.sh"),
    ),
    parserSha256: hashFile(
      path.join(controller, "scripts/verify-android-release-signature.cjs"),
    ),
  });
}
export function verifyAndroidReceipt(
  receipt,
  directory,
  controllerSha,
  runId,
  attempt,
) {
  assert.equal(receipt.schema, 1);
  assert.equal(
    receipt.sourceSha,
    RECOVERY.sourceSha,
    "Android payload source mismatch",
  );
  assert.equal(
    receipt.controllerSha,
    controllerSha,
    "Android controller mismatch",
  );
  assert.equal(receipt.runId, runId);
  assert.equal(receipt.runAttempt, attempt);
  assert.equal(receipt.version, RECOVERY.version);
  assert.deepEqual(
    receipt.assets.map((a) => a.name).sort(),
    [...ANDROID_NAMES].sort(),
  );
  for (const asset of receipt.assets) {
    const file = path.join(directory, asset.name);
    assert.ok(asset.size > 0);
    assert.equal(fs.statSync(file).size, asset.size);
    assert.equal(
      hashFile(file),
      asset.sha256,
      `Android bytes changed: ${asset.name}`,
    );
  }
}
function collectAssets(directory, output) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) {
      collectAssets(file, output);
      continue;
    }
    assert.ok(item.isFile(), "Non-file extracted artifact");
    if (item.name === "android-build-receipt.json") continue;
    const target = path.join(output, item.name);
    assert.ok(!fs.existsSync(target), `Duplicate asset basename: ${item.name}`);
    fs.renameSync(file, target);
  }
}
async function aggregate(source, output) {
  const controller = controllerIdentity(source);
  fs.mkdirSync(output, { recursive: true });
  const snapshot = await originalSnapshot();
  const original = auditOriginal(snapshot);
  const runId = Number(process.env.GITHUB_RUN_ID),
    attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const [run, androidProducer, artifacts] = await Promise.all([
    github(`actions/runs/${runId}`),
    latestAndroidProducer(runId, attempt),
    pages(`actions/runs/${runId}/artifacts`, "artifacts"),
  ]);
  const android = auditRecoveryAndroid(
    run,
    androidProducer.jobs,
    artifacts,
    process.env.GITHUB_SHA,
    attempt,
    Date.now(),
    androidProducer.producerAttempt,
  );
  assert.ok(
    path.isAbsolute(process.env.RUNNER_TEMP || ""),
    "RUNNER_TEMP must be absolute",
  );
  const downloads = path.join(
    process.env.RUNNER_TEMP,
    `product-recovery-downloads-${runId}-${attempt}`,
  );
  fs.mkdirSync(downloads);
  const assetDirectory = path.join(output, "release-assets");
  fs.mkdirSync(assetDirectory);
  let cliEvidence;
  for (const artifact of original.artifacts) {
    const directory = await downloadArtifact(artifact, downloads);
    if (artifact.name.startsWith("product-release-cli-gate-"))
      cliEvidence = verifyCliEvidence(directory);
    else collectAssets(directory, assetDirectory);
  }
  const androidDirectory = await downloadArtifact(android, downloads);
  const built = readJson(
    path.join(androidDirectory, "android-build-receipt.json"),
  );
  verifyAndroidReceipt(
    built,
    androidDirectory,
    process.env.GITHUB_SHA,
    runId,
    android.producerAttempt,
  );
  assert.equal(
    built.helperSha256,
    hashFile(
      path.join(controller, "scripts/ci/verify-android-release-artifacts.sh"),
    ),
  );
  assert.equal(
    built.parserSha256,
    hashFile(
      path.join(controller, "scripts/verify-android-release-signature.cjs"),
    ),
  );
  collectAssets(androidDirectory, assetDirectory);
  const require = createRequire(import.meta.url);
  const { verifyLocalAssets } = require(
    path.join(source, "scripts/verify-product-release-assets.cjs"),
  );
  const receipt = verifyLocalAssets(
    assetDirectory,
    RECOVERY.version,
    RECOVERY.sourceSha,
    readJson(path.join(source, "desktop-app-vue/package.json")).name,
  );
  assert.equal(
    receipt.assets.length,
    22,
    "Recovery requires all 22 product assets",
  );
  execFileSync(
    process.execPath,
    [
      path.join(source, "desktop-app-vue/scripts/verify-release-artifacts.js"),
      "--dir",
      assetDirectory,
    ],
    { stdio: "inherit" },
  );
  writeJson(path.join(output, "product-release-assets.json"), receipt);
  writeJson(path.join(output, "product-recovery-provenance.json"), {
    schema: 1,
    ...RECOVERY,
    controllerSha: process.env.GITHUB_SHA,
    recoveryRunId: runId,
    recoveryAttempt: attempt,
    original,
    android: { artifact: android, receipt: built },
    cliEvidence,
    assetReceiptSha256: hashFile(
      path.join(output, "product-release-assets.json"),
    ),
  });
}
export function verifyPublicPrerequisites(output) {
  const cli = readJson(path.join(output, "public-cli.json"));
  const openVsx = readJson(path.join(output, "open-vsx-public.json"));
  const jetbrains = readJson(path.join(output, "jetbrains-public.json"));
  const provenance = readJson(
    path.join(output, "product-recovery-provenance.json"),
  );
  assert.equal(cli.version, RECOVERY.cliVersion);
  assert.equal(
    cli.sha512,
    provenance.cliEvidence.provenance.sha512,
    "Current public CLI archive changed",
  );
  assert.equal(openVsx.channel, "open-vsx");
  assert.equal(openVsx.version, "0.37.138");
  assert.equal(openVsx.status, "ready");
  assert.equal(openVsx.downloadable, true);
  assert.equal(openVsx.listed, true);
  assert.equal(jetbrains.channel, "jetbrains");
  assert.equal(jetbrains.version, "0.4.156");
  assert.equal(jetbrains.status, "ready");
  assert.equal(jetbrains.approve, true);
  assert.equal(jetbrains.listed, true);
  assert.equal(jetbrains.hidden, false);
  return { cli, openVsx, jetbrains };
}
export function verifyReleaseIdentity(release, tagSha, published = false) {
  if (tagSha)
    assert.equal(
      tagSha,
      RECOVERY.sourceSha,
      "Product tag points to a different source",
    );
  else assert.ok(!published, "Published product tag is missing");
  if (!release) {
    assert.ok(!published, "Published release is missing");
    return;
  }
  assert.equal(release.tag_name, RECOVERY.version);
  assert.equal(
    release.prerelease,
    false,
    "Product release must not be a prerelease",
  );
  // Existing tags may leave target_commitish as a branch; the resolved tag wins.
  if (!tagSha)
    assert.equal(
      release.target_commitish,
      RECOVERY.sourceSha,
      "Draft target mismatch",
    );
  if (published) {
    assert.equal(release.draft, false, "Release is still draft");
    assert.equal(release.immutable, true, "Published release is not immutable");
  }
}
export function missingDraftAssets(receipt, release) {
  assert.equal(release.draft, true, "Only a draft can receive missing assets");
  assert.equal(release.tag_name, RECOVERY.version);
  assert.equal(receipt.version, RECOVERY.version);
  assert.equal(receipt.sourceSha, RECOVERY.sourceSha);
  const expected = new Map(receipt.assets.map((asset) => [asset.name, asset]));
  assert.equal(expected.size, receipt.assets.length, "Duplicate receipt asset");
  const seen = new Set();
  for (const asset of release.assets) {
    assert.ok(!seen.has(asset.name), "Duplicate draft asset");
    seen.add(asset.name);
    const verified = expected.get(asset.name);
    assert.ok(verified, `Unexpected draft asset: ${asset.name}`);
    assert.equal(
      asset.state,
      "uploaded",
      `Incomplete existing upload: ${asset.name}`,
    );
    assert.equal(
      asset.size,
      verified.size,
      `Existing draft size mismatch: ${asset.name}`,
    );
    assert.equal(
      asset.digest,
      `sha256:${verified.sha256}`,
      `Existing draft digest mismatch: ${asset.name}`,
    );
  }
  return receipt.assets
    .filter((asset) => !seen.has(asset.name))
    .map((asset) => asset.name);
}
async function releaseState(
  source,
  output,
  published = false,
  allowPartialDraft = false,
) {
  controllerIdentity(source);
  const { verifyRemoteAssets } = createRequire(import.meta.url)(
    path.join(source, "scripts/verify-product-release-assets.cjs"),
  );
  const release = await github(`releases/tags/${RECOVERY.version}`, !published);
  const receipt = readJson(path.join(output, "product-release-assets.json"));
  const remoteRef = execFileSync(
    "git",
    [
      "ls-remote",
      "origin",
      `refs/tags/${RECOVERY.version}`,
      `refs/tags/${RECOVERY.version}^{}`,
    ],
    { cwd: source, encoding: "utf8" },
  ).trim();
  const lines = remoteRef ? remoteRef.split("\n") : [];
  const tagSha = lines.length
    ? (lines.find((line) => line.endsWith("^{}")) || lines[0]).split(/\s/)[0]
    : null;
  verifyReleaseIdentity(release, tagSha, published);
  if (release) {
    if (allowPartialDraft && release.draft)
      missingDraftAssets(receipt, release);
    else {
      verifyRemoteAssets(
        receipt,
        release,
        RECOVERY.version,
        RECOVERY.sourceSha,
      );
      writeJson(
        path.join(
          output,
          published ? "public-readback.json" : "draft-readback.json",
        ),
        release,
      );
    }
  }
  return release;
}
async function main() {
  const [mode, sourceArg, outputArg] = process.argv.slice(2);
  const source = path.resolve(sourceArg),
    output = path.resolve(outputArg);
  if (mode === "audit") {
    controllerIdentity(source);
    fs.mkdirSync(output, { recursive: true });
    const snapshot = await originalSnapshot();
    writeJson(
      path.join(output, "original-run-audit.json"),
      auditOriginal(snapshot),
    );
  } else if (mode === "android-receipt") androidReceipt(source, output);
  else if (mode === "aggregate") await aggregate(source, output);
  else if (mode === "prerequisites") {
    controllerIdentity(source);
    const provenance = readJson(
      path.join(output, "product-recovery-provenance.json"),
    );
    provenance.publicPrerequisites = verifyPublicPrerequisites(output);
    writeJson(
      path.join(output, "product-recovery-provenance.json"),
      provenance,
    );
  } else if (mode === "publish") {
    const provenance = readJson(
      path.join(output, "product-recovery-provenance.json"),
    );
    assert.equal(provenance.sourceSha, RECOVERY.sourceSha);
    assert.equal(provenance.controllerSha, process.env.GITHUB_SHA);
    assert.equal(provenance.recoveryRunId, Number(process.env.GITHUB_RUN_ID));
    assert.equal(
      provenance.recoveryAttempt,
      Number(process.env.GITHUB_RUN_ATTEMPT),
    );
    assert.equal(
      provenance.assetReceiptSha256,
      hashFile(path.join(output, "product-release-assets.json")),
    );
    assert.deepEqual(
      provenance.publicPrerequisites,
      verifyPublicPrerequisites(output),
    );
    let release = await releaseState(source, output, false, true);
    if (release && !release.draft) {
      await releaseState(source, output, true);
      return;
    }
    const args = [
      "release",
      "create",
      RECOVERY.version,
      "--repo",
      RECOVERY.repository,
      "--target",
      RECOVERY.sourceSha,
      "--title",
      `ChainlessChain ${RECOVERY.version}`,
      "--notes",
      `Complete five-platform release from ${RECOVERY.sourceSha}. Android verification recovered in Actions run ${process.env.GITHUB_RUN_ID}; four original signed/validated producers retained from run ${RECOVERY.originalRunId}.`,
      "--draft",
      "--prerelease=false",
    ];
    if (!release) {
      args.push(
        ...fs
          .readdirSync(path.join(output, "release-assets"))
          .map((name) => path.join(output, "release-assets", name)),
      );
      execFileSync("gh", args, { stdio: "inherit" });
    } else {
      const receipt = readJson(
        path.join(output, "product-release-assets.json"),
      );
      const missing = missingDraftAssets(receipt, release);
      if (missing.length) {
        execFileSync(
          "gh",
          [
            "release",
            "upload",
            RECOVERY.version,
            "--repo",
            RECOVERY.repository,
            ...missing.map((name) => path.join(output, "release-assets", name)),
          ],
          { stdio: "inherit" },
        );
      }
    }
    // Retry only absent assets; existing bytes must already match and are never clobbered.
    release = await releaseState(source, output);
    assert.equal(release?.draft, true);
    if (process.env.RECOVERY_PUBLISH !== "true") return;
    execFileSync(
      "gh",
      [
        "release",
        "edit",
        RECOVERY.version,
        "--repo",
        RECOVERY.repository,
        "--target",
        RECOVERY.sourceSha,
        "--draft=false",
      ],
      { stdio: "inherit" },
    );
    await releaseState(source, output, true);
  } else throw new Error(`Unknown recovery command: ${mode}`);
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
}
