// Offline, read-only verification of the archived failed job; never a release gate.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const COMMIT = "1fe7a46c0f97b93fb5110ea3427cc8551d0dab37";
const HEADLESS = "__tests__/unit/headless-runner.test.js";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function decode(record) {
  assert.equal(record.encoding, "gzip+base64");
  const bytes = gunzipSync(Buffer.from(record.data, "base64"));
  assert.equal(bytes.length, record.bytes);
  assert.equal(sha256(bytes), record.sha256);
  return bytes;
}

// The pinned artifact contains one ordinary ZIP entry. No extraction or writes.
export function readJUnit(zip) {
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 4), 0);
  assert.equal(zip.readUInt16LE(eocd + 6), 0);
  assert.equal(zip.readUInt16LE(eocd + 8), 1);
  assert.equal(zip.readUInt16LE(eocd + 10), 1);
  assert.equal(zip.readUInt16LE(eocd + 20), 0);
  const central = zip.readUInt32LE(eocd + 16);
  assert.equal(central + zip.readUInt32LE(eocd + 12), eocd);
  assert.equal(zip.readUInt32LE(central), 0x02014b50);
  const flags = zip.readUInt16LE(central + 8);
  assert.equal(flags & 1, 0);
  const method = zip.readUInt16LE(central + 10);
  const size = zip.readUInt32LE(central + 20);
  const nameLength = zip.readUInt16LE(central + 28);
  const name = zip.toString("utf8", central + 46, central + 46 + nameLength);
  assert.equal(name, "unit-14.xml");
  const local = zip.readUInt32LE(central + 42);
  assert.equal(zip.readUInt32LE(local), 0x04034b50);
  assert.equal(zip.readUInt16LE(local + 6), flags);
  assert.equal(zip.readUInt16LE(local + 8), method);
  const localNameLength = zip.readUInt16LE(local + 26);
  assert.equal(
    zip.toString("utf8", local + 30, local + 30 + localNameLength),
    name,
  );
  const start = local + 30 + localNameLength + zip.readUInt16LE(local + 28);
  assert(start + size <= central);
  const compressed = zip.subarray(start, start + size);
  assert([0, 8].includes(method));
  const bytes = method === 8 ? inflateRawSync(compressed) : compressed;
  assert.equal(bytes.length, zip.readUInt32LE(central + 24));
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  assert.equal((crc ^ 0xffffffff) >>> 0, zip.readUInt32LE(central + 16));
  return bytes;
}

export function logFacts(bytes) {
  const text = bytes.toString("utf8").replace(/\x1b\[[0-9;]*m/g, "");
  const parts = text.split(
    "rerunning the entire suite once without file parallelism.",
  );
  assert.equal(parts.length, 2);
  const attempts = parts.map((part, i) => {
    const files = [
      ...part.matchAll(/\u2713\s+(__tests__\/[^\s]+\.test\.js)/g),
    ].map((m) => m[1]);
    assert.equal(new Set(files).size, files.length);
    const summary = part.match(/Test Files\s+(\d+) passed\s+\((\d+)\)/);
    const tests = part.match(
      /Tests\s+(\d+) passed\s+\|\s+(\d+) skipped\s+\((\d+)\)/,
    );
    const duration = part.match(/Duration\s+([\d.]+)s/);
    assert(summary && tests && duration);
    assert.match(part, /Error: \[vitest-pool\]: Worker forks emitted error\./);
    assert.match(part, /Caused by: Error: Worker exited unexpectedly/);
    assert.match(part, /Vitest caught 1 unhandled error/);
    return {
      attempt: i + 1,
      passedFiles: Number(summary[1]),
      totalFiles: Number(summary[2]),
      passedTests: Number(tests[1]),
      skippedTests: Number(tests[2]),
      totalTests: Number(tests[3]),
      unhandledErrors: 1,
      durationSeconds: Number(duration[1]),
      completedFileNames: files.sort(),
    };
  });
  assert.match(text, /Process completed with exit code 1\./);
  const command = text.match(
    /##\[group\]Run (node scripts\/run-vitest-with-worker-retry\.mjs[^\r\n]+)/,
  )?.[1];
  assert(command);
  assert(!command.includes("--reporter=json"));
  return {
    command,
    wrapperExitCode: 1,
    attempts,
    missingCompletionOnRetry: attempts[0].completedFileNames.filter(
      (f) => !attempts[1].completedFileNames.includes(f),
    ),
  };
}

const attrs = (tag) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
export function junitFacts(bytes) {
  const xml = bytes.toString("utf8");
  assert(!/<!DOCTYPE|<!ENTITY/.test(xml));
  const suites = [...xml.matchAll(/<testsuite\s[^>]*>/g)].map((m) =>
    attrs(m[0]),
  );
  const headless = xml.match(
    /<testsuite name="__tests__\/unit\/headless-runner\.test\.js"[\s\S]*?<\/testsuite>/,
  )?.[0];
  assert(headless);
  return {
    rootAttributes: attrs(xml.match(/<testsuites\s[^>]*>/)[0]),
    suiteCount: suites.length,
    testcaseCount: (xml.match(/<testcase\s/g) || []).length,
    skippedElements: (xml.match(/<skipped\b/g) || []).length,
    failureElements: (xml.match(/<failure\b/g) || []).length,
    errorElements: (xml.match(/<error\b/g) || []).length,
    suiteNames: suites.map((s) => s.name).sort(),
    headless: {
      attributes: attrs(headless.match(/<testsuite\s[^>]*>/)[0]),
      testcaseCount: (headless.match(/<testcase\s/g) || []).length,
    },
  };
}

export function verify(evidence) {
  assert.equal(evidence.schema, "cc-windows-worker-failure/v1");
  assert.equal(evidence.commit, COMMIT);
  assert.equal(evidence.releaseGateEligible, false);
  assert.equal(evidence.status, "failed-unresolved");
  assert.equal(evidence.rootCauseEstablished, false);
  const run = JSON.parse(decode(evidence.blobs.runMetadata));
  const job = JSON.parse(decode(evidence.blobs.jobMetadata));
  const artifact = JSON.parse(decode(evidence.blobs.artifactMetadata));
  assert.equal(run.id, 37101924173);
  assert.equal(run.head_sha, COMMIT);
  assert.equal(run.run_attempt, 1);
  assert.equal(run.name, "CLI CI");
  assert.equal(run.status, evidence.github.runSnapshotStatus);
  assert.equal(run.conclusion, evidence.github.runSnapshotConclusion);
  assert.equal(run.head_branch, "feature/cli-ide-gap-completion-2026-10-02");
  assert.equal(run.repository.full_name, evidence.github.repository);
  assert.equal(job.id, 111143098841);
  assert.equal(job.run_id, run.id);
  assert.equal(job.run_attempt, run.run_attempt);
  assert.equal(job.head_sha, COMMIT);
  assert.equal(job.status, "completed");
  assert.equal(job.conclusion, "failure");
  assert.equal(job.started_at, evidence.github.jobStartedAt);
  assert.equal(job.completed_at, evidence.github.jobCompletedAt);
  assert.equal(job.html_url, evidence.github.jobUrl);
  assert.equal(job.name, "test-windows / unit (windows-latest, shard 14/16)");
  assert.equal(
    job.steps.find((s) => s.name === "Verify exact source identity").conclusion,
    "success",
  );
  assert.equal(
    job.steps.find((s) => s.name === "vitest unit shard 14/16").conclusion,
    "failure",
  );
  assert.equal(artifact.id, 11267980804);
  assert.equal(artifact.name, "cli-windows-latest-unit-14-results");
  assert.equal(artifact.workflow_run.id, run.id);
  assert.equal(artifact.workflow_run.head_sha, COMMIT);
  assert.equal(artifact.size_in_bytes, 68861);
  assert.equal(
    artifact.digest,
    "sha256:9bba71956284f67c2dcfa141c130f35e285dbbe9a110bfa08f8da52ad47f730b",
  );
  assert(Date.parse(artifact.created_at) >= Date.parse(job.started_at));
  assert(Date.parse(artifact.created_at) <= Date.parse(job.completed_at));
  const zip = decode(evidence.blobs.artifactZip);
  assert.equal(zip.length, artifact.size_in_bytes);
  assert.equal(`sha256:${sha256(zip)}`, artifact.digest);
  const xml = readJUnit(zip);
  assert.equal(xml.length, evidence.junit.bytes);
  assert.equal(sha256(xml), evidence.junit.sha256);
  const junit = junitFacts(xml);
  assert.deepEqual(junit, evidence.junit.facts);
  assert.equal(junit.suiteCount, 104);
  assert.equal(junit.testcaseCount, 2500);
  assert.equal(junit.skippedElements, 2);
  assert.equal(junit.failureElements + junit.errorElements, 0);
  assert.equal(junit.headless.testcaseCount, 86);
  assert.equal(junit.headless.attributes.time, "0");
  const log = decode(evidence.blobs.jobLog);
  const facts = logFacts(log);
  const savedLog = log.toString("utf8").replace(/\x1b\[[0-9;]*m/g, "");
  assert(savedLog.includes(`test "$(git rev-parse HEAD)" = "${COMMIT}"`));
  assert.match(savedLog, /node: v22\.22\.2/);
  assert.match(savedLog, /RUN\s+v4\.1\.10/);
  assert.equal(
    facts.command,
    "node scripts/run-vitest-with-worker-retry.mjs -- run --shard=14/16 --reporter=default --reporter=junit --outputFile.junit=test-results/unit-14.xml --silent=passed-only --maxWorkers=1 --no-file-parallelism __tests__/unit/",
  );
  assert.deepEqual(facts, evidence.hostedResult);
  assert.deepEqual(facts.missingCompletionOnRetry, [HEADLESS]);
  assert.deepEqual(
    facts.attempts.map((a) => [
      a.passedFiles,
      a.totalFiles,
      a.passedTests,
      a.skippedTests,
      a.totalTests,
      a.durationSeconds,
    ]),
    [
      [104, 104, 2498, 2, 2500, 491.46],
      [103, 104, 2498, 2, 2500, 458],
    ],
  );
  assert.deepEqual(junit.suiteNames, facts.attempts[0].completedFileNames);
  assert.equal(evidence.logProvenance.originalApiBytesAttested, false);
  const local = JSON.parse(decode(evidence.blobs.localHeadlessJson));
  const localLogBytes = decode(evidence.blobs.localHeadlessLog);
  assert.equal(localLogBytes.readUInt16LE(0), 0xfeff);
  const localLog = localLogBytes.subarray(2).toString("utf16le");
  assert.equal(local.success, true);
  assert.equal(local.numPassedTests, 86);
  assert.equal(local.numFailedTests, 0);
  assert.equal(local.testResults.length, 1);
  assert(local.testResults[0].name.endsWith(HEADLESS));
  assert.equal(local.testResults[0].assertionResults.length, 86);
  assert(
    local.testResults[0].assertionResults.every((t) => t.status === "passed"),
  );
  assert.match(localLog, /Duration\s+68\.60s/);
  assert.equal(evidence.localHeadless.fullShard, false);
  assert.equal(evidence.localHeadless.exitCode, 0);
  assert.equal(
    evidence.localHeadless.exitCodeSource,
    "root tools.write_stdin session 45196 final exit_code; not independently encoded in the log or JSON report",
  );
  for (const source of evidence.sources) {
    const bytes = decode(source);
    assert.equal(source.commit, COMMIT);
    const gitHash = createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    assert.equal(gitHash, source.gitBlob);
  }
  assert.deepEqual(
    evidence.sources.map((s) => s.source),
    [
      "packages/cli/scripts/run-vitest-with-worker-retry.mjs",
      "packages/cli/vitest.config.js",
      ".github/workflows/_cli-test.yml",
    ],
  );
  return {
    verified: true,
    status: evidence.status,
    releaseGateEligible: false,
    hostedJob: job.id,
    attempts: facts.attempts.length,
    missingCompletionOnRetry: facts.missingCompletionOnRetry,
    junitTestcases: junit.testcaseCount,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  assert(
    args.every((a) => a === "--self-test" || !a.startsWith("--")),
    "Unknown option",
  );
  const filename = args.find((a) => a !== "--self-test");
  const evidence = JSON.parse(
    fs.readFileSync(
      filename ||
        new URL("./windows-worker-failure-1fe7.json", import.meta.url),
      "utf8",
    ),
  );
  const result = verify(evidence);
  if (args.includes("--self-test")) {
    const mutations = [
      (e) => {
        e.releaseGateEligible = true;
      },
      (e) => {
        e.hostedResult.wrapperExitCode = 0;
      },
      (e) => {
        e.hostedResult.attempts[1].passedFiles = 104;
      },
      (e) => {
        e.blobs.artifactZip.sha256 = "0".repeat(64);
      },
      (e) => {
        e.junit.facts.headless.testcaseCount = 85;
      },
      (e) => {
        e.logProvenance.originalApiBytesAttested = true;
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(evidence);
      mutate(changed);
      assert.throws(() => verify(changed));
    }
    result.rejectedCorruptions = mutations.length;
  }
  console.log(JSON.stringify(result));
}
