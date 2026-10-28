import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const [runId, sha, destination] = process.argv.slice(2);
assert.match(runId || "", /^\d+$/);
assert.match(sha || "", /^[a-f0-9]{40}$/);
assert.ok(destination);
const root = resolve(destination),
  repo = "chainlesschain/chainlesschain";
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
const api = (path) => JSON.parse(gh("api", "repos/" + repo + "/" + path));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const run = api("actions/runs/" + runId);
assert.equal(run.head_sha, sha);
assert.equal(run.name, "Codex App Server Compatibility");
assert.equal(run.status, "completed");
assert.equal(run.conclusion, "success");
assert.equal(run.event, "pull_request");
const jobs = api(
  "actions/runs/" +
    runId +
    "/attempts/" +
    run.run_attempt +
    "/jobs?per_page=100",
);
assert.equal(jobs.total_count, 21);
assert.equal(jobs.jobs.length, 21);
for (const job of jobs.jobs) assert.equal(job.conclusion, "success", job.name);
const artifacts = api("actions/runs/" + runId + "/artifacts?per_page=100");
assert.equal(artifacts.total_count, 19);
assert.equal(artifacts.artifacts.length, 19);
for (const item of artifacts.artifacts) {
  assert.equal(item.expired, false);
  assert.ok(item.name.endsWith(sha + "-" + run.run_attempt));
}
mkdirSync(root, { recursive: true });
writeFileSync(join(root, "run.json"), JSON.stringify(run, null, 2) + "\n");
writeFileSync(join(root, "jobs.json"), JSON.stringify(jobs, null, 2) + "\n");
writeFileSync(
  join(root, "artifacts.json"),
  JSON.stringify(artifacts, null, 2) + "\n",
);
const downloaded = join(root, "artifacts");
gh(
  "run",
  "download",
  runId,
  "--repo",
  repo,
  "--pattern",
  "codex-real-turns-*-" + sha + "-" + run.run_attempt,
  "--dir",
  downloaded,
);
const aggregateName = "codex-app-server-matrix-" + sha + "-" + run.run_attempt;
gh(
  "run",
  "download",
  runId,
  "--repo",
  repo,
  "--name",
  aggregateName,
  "--dir",
  join(root, "aggregate"),
);
const aggregate = json(join(root, "aggregate/codex-app-server-matrix.json"));
assert.equal(aggregate.commitSha, sha);
assert.equal(aggregate.status, "passed");
assert.deepEqual(aggregate.versions.map((item) => item.version).sort(), [
  "0.149.0",
  "0.150.0",
  "0.150.1",
  "0.154.0",
]);
for (const entry of aggregate.versions)
  assert.deepEqual(entry.platforms.map((item) => item.platform).sort(), [
    "linux",
    "macos",
    "windows",
  ]);
assert.equal(readdirSync(downloaded).length, 6);
const reports = [];
for (const version of ["0.160.0", "0.164.0"]) {
  for (const [runner, platform] of [
    ["ubuntu-latest", "linux"],
    ["windows-latest", "win32"],
    ["macos-latest", "darwin"],
  ]) {
    const artifact =
      "codex-real-turns-" +
      version +
      "-" +
      runner +
      "-" +
      sha +
      "-" +
      run.run_attempt;
    const path = join(downloaded, artifact);
    assert.ok(existsSync(path));
    const turn = json(join(path, "report.json")),
      history = json(join(path, "history.json"));
    assert.equal(turn.upstream.binarySha256, history.upstream.binarySha256);
    for (const [name, report] of [
      ["report", turn],
      ["history", history],
    ]) {
      assert.equal(report.status, "passed");
      assert.equal(report.commitSha, sha);
      assert.equal(report.upstream.version, version);
      assert.equal(report.platform, platform);
      assert.equal(report.realProviderAcceptance, false);
      assert.equal(report.productionAdmission, false);
      assert.match(report.upstream.binarySha256, /^[a-f0-9]{64}$/);
      assert.equal(
        digest(readFileSync(join(path, name + ".json.notifications.json"))),
        report.notificationsSha256,
      );
      for (const [kind, hash] of Object.entries(report.officialSchema.hashes)) {
        const fixture = execFileSync(
          "git",
          [
            "show",
            sha +
              ":packages/cli/__tests__/fixtures/external-agent/codex-app-server-" +
              version +
              "-" +
              kind +
              ".schema.json",
          ],
          { maxBuffer: 4 * 1024 * 1024, windowsHide: true },
        );
        assert.equal(digest(fixture), hash);
      }
    }
    assert.equal(
      digest(readFileSync(join(path, "report.json.approvals.json"))),
      turn.approvalsSha256,
    );
    assert.deepEqual(
      turn.results.map((item) => item.terminal),
      ["completed", "failed", "interrupted", "interrupted"],
    );
    assert.equal(turn.interleavedThreads, true);
    assert.equal(turn.transportLoss.fallbackCalls, 0);
    assert.equal(turn.approvalCancellation.markerPresent, false);
    assert.equal(turn.approvalCancellation.toolStatus, "declined");
    assert.equal(turn.providerRequests.length, 5);
    assert.equal(history.processRestarted, true);
    assert.equal(history.settingsRestored, true);
    assert.equal(history.threadListMode, "state-db-only");
    assert.equal(history.threadListSortKey, "recency_at");
    assert.equal(history.rolloutScanPaginationVerified, false);
    assert.equal(history.completedRequestReplayed, false);
    assert.equal(history.providerRequests.length, 3);
    assert.equal(history.providerRequests[2].retainedContext, true);
    assert.ok(history.threadPages.length >= 2);
    assert.ok(history.turnPagesAfterResume.length >= 2);
    assert.deepEqual(history.processClosed, [
      { code: 0, signal: null },
      { code: 0, signal: null },
    ]);
    reports.push({
      version,
      runner,
      platform,
      arch: turn.arch,
      artifact,
      sameCreatedAtSecond: history.sameCreatedAtSecond,
      turn: digest(readFileSync(join(path, "report.json"))),
      history: digest(readFileSync(join(path, "history.json"))),
    });
  }
}
const summary = {
  schema: "chainlesschain.codex-three-platform-ci-readback/v1",
  checkedAt: new Date().toISOString(),
  sourceCommit: sha,
  runId: Number(runId),
  runAttempt: run.run_attempt,
  runUrl: run.html_url,
  status: "passed",
  jobsPassed: 21,
  baseCompatibilityCells: 12,
  schemaTurnHistoryCells: 6,
  reports,
  localFixtureRequests: 48,
  externalProviderCalls: 0,
  threadListContract: {
    useStateDbOnly: true,
    sortKey: "recency_at",
    rolloutScanPaginationVerified: false,
  },
  experimentalAllowlistChanged: false,
  productionAdmissionChanged: false,
  npmReleaseReadinessVerified: false,
};
writeFileSync(
  join(root, "verification.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary));
