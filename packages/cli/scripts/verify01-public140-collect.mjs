// Read-only collection of existing runs: no dispatch and no model credentials.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  listZipEntries,
  readZipEntry,
} from "../../vscode-extension/scripts/verify-vsix.mjs";
const directory = "docs/research/cli/verify01-openai-140-frozen-four-20261103";
const expectedIds = [
  "verify-08",
  "verify-13",
  "verify-36",
  "first-run-darwin-vscode",
];
const token =
  process.env.GH_TOKEN ||
  execFileSync("gh", ["auth", "token"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
const githubEnvironment = { ...process.env, GH_TOKEN: token, GH_DEBUG: "" };

const dispatch = JSON.parse(
  fs.readFileSync(`${directory}/dispatch.json`, "utf8"),
);
assert.equal(dispatch.allSubmitted, true);
assert.deepEqual(dispatch.selectedSampleIds, expectedIds);
assert.equal(dispatch.provider, "openai");
const source = dispatch.source;
assert.match(source, /^[a-f0-9]{40}$/u);
const repo = "chainlesschain/chainlesschain";
const output = `${directory}/public-${source.slice(0, 10)}`;
const selections = dispatch.dispatches.map((row) => ({
  id: row.runId,
  originalRunId: row.runId,
  group:
    row.entries === "jetbrains"
      ? `${row.group}-${row.sampleIds[0]}`
      : row.group,
  samples: row.sampleIds,
}));
assert.equal(selections.length, 3);
assert.equal(new Set(selections.map((row) => row.id)).size, 3);
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
function request(route) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return execFileSync("gh", ["api", `repos/${repo}${route}`], {
        timeout: 120000,
        env: githubEnvironment,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      if (attempt === 2)
        throw new Error(
          `Read-only GitHub GET failed after three attempts: ${route}`,
        );
    }
  }
}
const api = (route) => JSON.parse(request(route).toString("utf8"));
// Interrupted read-only collections retain their original ZIPs. Reuse only
// bytes matching the current GitHub artifact digest and size, checked below.
const cachedArchives = new Map();
for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith("cc-public139-collect-"))
    continue;
  const archive = path.join(os.tmpdir(), entry.name, "artifact.zip");
  try {
    const stat = fs.lstatSync(archive);
    if (stat.isFile() && stat.size > 0 && stat.size < 64 * 1024 * 1024)
      cachedArchives.set(hash(fs.readFileSync(archive)), archive);
  } catch {
    // An unavailable cache entry never changes the original download contract.
  }
}
const files = [];
let totalBytes = 0;
function save(name, bytes) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  assert.ok(
    !/\bsk-[A-Za-z0-9_-]{20,}\b/u.test(bytes.toString("utf8")),
    "Refuse credential-shaped evidence",
  );
  totalBytes += bytes.length;
  assert.ok(
    bytes.length <= 12 * 1024 * 1024 && totalBytes <= 48 * 1024 * 1024,
    "Evidence size bound",
  );
  const file = path.resolve(output, name);
  assert.ok(file.startsWith(path.resolve(output) + path.sep));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  files.push({ path: name, digest: hash(bytes), bytes: bytes.length });
}
const json = (name, value) => save(name, JSON.stringify(value, null, 2) + "\n");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const packageDigest = hash(
  execFileSync("git", ["show", `${source}:${dispatch.packageSetPath}`]),
);
assert.equal(packageDigest, dispatch.packageSetDigest);
const runs = [];
const artifacts = [];
const rows = [];
for (const selection of selections) {
  const run = api(`/actions/runs/${selection.id}`);
  assert.equal(run.head_sha, source);
  assert.equal(run.status, "completed");
  assert.equal(run.run_attempt, 1);
  const jobs = api(`/actions/runs/${selection.id}/jobs?per_page=100`).jobs;
  const runRecord = {
    id: run.id,
    originalRunId: selection.originalRunId,
    source: run.head_sha,
    status: run.status,
    conclusion: run.conclusion,
    url: run.html_url,
    updatedAt: run.updated_at,
    jobs: jobs.map(({ id, name, status, conclusion, steps }) => ({
      id,
      name,
      status,
      conclusion,
      failedStep: steps?.find((s) => s.conclusion === "failure")?.name ?? null,
    })),
  };
  runs.push(runRecord);
  json(`runs/${selection.id}.json`, runRecord);
  const listed = api(
    `/actions/runs/${selection.id}/artifacts?per_page=100`,
  ).artifacts;
  const summaries = {};
  for (const kind of ["delivery", "acceptance"]) {
    const name = `verify01-native-subset-${kind}-${selection.group}-${source}`;
    const matches = listed.filter((a) => a.name === name);
    assert.equal(matches.length, 1);
    const artifact = matches[0];
    assert.equal(artifact.workflow_run.head_sha, source);
    assert.equal(artifact.workflow_run.id, selection.id);
    assert.equal(artifact.expired, false);
    const cached = cachedArchives.get(artifact.digest);
    const zip = cached
      ? fs.readFileSync(cached)
      : request(`/actions/artifacts/${artifact.id}/zip`);
    assert.equal(zip.length, artifact.size_in_bytes);
    assert.equal(hash(zip), artifact.digest);
    const temp = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-public139-collect-"),
    );
    const archive = path.join(temp, "artifact.zip");
    const extracted = path.join(temp, "extracted");
    fs.writeFileSync(archive, zip);
    let expanded = 0;
    for (const [name, entry] of listZipEntries(zip)) {
      if (name.endsWith("/")) continue;
      assert.ok(
        !/[\\:\r\n]/u.test(name) &&
          name
            .split("/")
            .every((part) => part && part !== "." && part !== ".."),
      );
      const target = path.resolve(extracted, name);
      assert.ok(target.startsWith(path.resolve(extracted) + path.sep));
      const bytes = readZipEntry(zip, entry);
      expanded += bytes.length;
      assert.ok(expanded < 134217728);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    const summaryBytes = fs.readFileSync(path.join(extracted, "summary.json"));
    const summary = JSON.parse(summaryBytes.toString("utf8"));
    assert.equal(summary.packageSetDigest, packageDigest);
    assert.equal(summary.executionSourceCommit, source);
    assert.deepEqual(
      [...summary.selectedSampleIds].sort(),
      [...selection.samples].sort(),
    );
    save(`raw/${name}/summary.json`, summaryBytes);
    summaries[kind] = { summary, digest: hash(summaryBytes), name };
    artifacts.push({
      id: artifact.id,
      name,
      runId: selection.id,
      digest: artifact.digest,
      zipDigestVerified: true,
      summaryDigest: hash(summaryBytes),
      sizeInBytes: zip.length,
    });
    if (kind === "acceptance") {
      assert.equal(summary.deliverySourceCommit, source);
      assert.equal(summary.acceptanceHost, "linux-docker");
      for (const row of summary.samples) {
        for (const stage of ["setup", "check"]) {
          if (!row[stage]?.receiptPath) continue;
          const bytes = fs.readFileSync(
            path.join(extracted, row[stage].receiptPath),
          );
          assert.equal(hash(bytes), row[stage].receiptDigest);
          save(`receipts/${row.sampleId}-${stage}.json`, bytes);
        }
      }
    } else {
      assert.equal(summary.modelTransport.provider, "openai");
      assert.equal(summary.modelTransport.model, "gpt-6.1-sol");
      for (const row of summary.samples) {
        for (const candidate of row.candidates ?? []) {
          const bytes = fs.readFileSync(path.join(extracted, candidate.path));
          assert.equal(hash(bytes), candidate.digest);
          save(
            `candidates/${row.sampleId}/${path.basename(candidate.file)}.txt`,
            bytes,
          );
        }
      }
    }
  }
  const g = summaries.delivery,
    a = summaries.acceptance;
  assert.equal(a.summary.sourceSummaryDigest, g.digest);
  for (const delivery of g.summary.samples) {
    const acceptance = a.summary.samples.find(
      (r) => r.sampleId === delivery.sampleId,
    );
    assert.ok(acceptance);
    const stage = (s) =>
      s &&
      Object.fromEntries(
        ["pass", "detail", "tests", "mutations", "receiptDigest"].map((key) => [
          key,
          s[key],
        ]),
      );
    rows.push({
      sampleId: delivery.sampleId,
      runId: selection.id,
      group: selection.group,
      originalGenerationPassed: delivery.generationPassed ?? null,
      generationPassed: acceptance.generationPassed ?? null,
      accepted: acceptance.passed,
      candidateAcceptancePassed: acceptance.candidateAcceptancePassed,
      host: delivery.host,
      terminal: delivery.model?.final,
      modelFailure: delivery.model?.failureCategory,
      modelError: delivery.model?.errorResult,
      modelPass: delivery.model?.pass,
      sourceScopePassed: delivery.sourceScopePassed,
      brokerStatus: delivery.brokerStatus ?? null,
      broker: delivery.broker ?? null,
      observedUsage: delivery.model?.observedUsage,
      setup: stage(acceptance.setup),
      check: stage(acceptance.check),
      generationAssessment: acceptance.generationAssessment,
    });
  }
}
assert.equal(rows.length, expectedIds.length);
assert.deepEqual(
  rows.map((row) => row.sampleId).sort(),
  [...expectedIds].sort(),
);
const sumIfComplete = (field) =>
  rows.every((row) => Number.isFinite(row.broker?.[field]))
    ? rows.reduce((total, row) => total + row.broker[field], 0)
    : null;
const report = {
  schema: 1,
  source,
  projectSource: dispatch.projectSource,
  packageDigest,
  collectorSource: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  collectorTriggerSource: process.env.GITHUB_SHA ?? null,
  complete: true,
  expected: expectedIds.length,
  accepted: rows.filter((r) => r.accepted).length,
  failed: rows.filter((r) => !r.accepted).length,
  skippedHistoricalPass: dispatch.skippedSamples
    .map((row) => row.sampleId || row.reason)
    .join("; "),
  historical45Unchanged: true,
  previous137r3Unchanged: "0/5",
  previous138Unchanged: "2/4",
  infrastructureRetry: null,
  physicalRequestsStarted: sumIfComplete("physicalRequestsStarted"),
  usageCompleteRequests: sumIfComplete("usageCompleteRequests"),
  knownTokenOnlyEstimateUsd: sumIfComplete("knownTokenOnlyEstimateUsd"),
  actualBilledCostUsd: null,
  runs,
  artifacts,
  rows,
};
json("results.json", report);
json("archive-index.json", {
  source,
  collectorSource: report.collectorSource,
  credentialShapeScanPassed: true,
  files,
});
console.log(
  JSON.stringify({
    accepted: report.accepted,
    failed: report.failed,
    physicalRequestsStarted: report.physicalRequestsStarted,
    rows: rows.map((r) => ({
      sampleId: r.sampleId,
      accepted: r.accepted,
      generationPassed: r.generationPassed,
      candidateAcceptancePassed: r.candidateAcceptancePassed,
      requests: r.broker?.physicalRequestsStarted ?? null,
    })),
  }),
);
