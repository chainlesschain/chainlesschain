#!/usr/bin/env node
/** Offline validation of one unfinished-task diagnostic, separate from latest round counts. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = "verify-19";
const GROUP = "win32-cli";
const PRELOAD = "packages/cli/scripts/verify01-fetch-diagnostics-preload.cjs";
const hash = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
const jsonBytes = (b) => JSON.parse(b.toString("utf8"));
const names = new Set([
  "Error",
  "TypeError",
  "AbortError",
  "TimeoutError",
  "AggregateError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
  "SocketError",
  "RequestAbortedError",
  "ClientDestroyedError",
  "ClientClosedError",
]);
const codes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_INVALID_URL",
  "ABORT_ERR",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_ABORTED",
  "UND_ERR_DESTROYED",
  "UND_ERR_CLOSED",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_INVALID_ARG",
  "UND_ERR_INVALID_RETURN_VALUE",
]);
function safePath(name) {
  assert.equal(typeof name, "string");
  assert.ok(
    name.length &&
      !name.includes("\\") &&
      !name.includes(":") &&
      !path.posix.isAbsolute(name),
  );
  assert.ok(
    name.split("/").every((s) => s && s !== "." && s !== ".."),
    "unsafe evidence path",
  );
  return name;
}
function keys(object, expected) {
  assert.deepEqual(
    Object.keys(object).sort(),
    [...expected].sort(),
    "unexpected diagnostic fields",
  );
}

export function validateFetchDiagnosticLog(bytes) {
  assert.ok(bytes.length > 0 && bytes.length <= 65536, "diagnostic byte cap");
  const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  assert.ok(text.endsWith("\n"), "incomplete diagnostic line");
  const rows = text
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(rows.length > 0 && rows.length <= 128, "diagnostic record cap");
  for (const [index, row] of rows.entries()) {
    assert.equal(row.schema, "chainlesschain.fetch-diagnostics/v1");
    assert.equal(row.sequence, index);
    assert.equal(new Date(row.at).toISOString(), row.at);
    if (index === 0) {
      keys(row, [
        "schema",
        "sequence",
        "at",
        "event",
        "passive",
        "maxRecords",
        "maxBytes",
      ]);
      assert.equal(row.event, "enabled");
      assert.equal(row.passive, true);
      assert.equal(row.maxRecords, 128);
      assert.equal(row.maxBytes, 65536);
    } else if (row.event === "truncated") {
      keys(row, ["schema", "sequence", "at", "event", "reason"]);
      assert.equal(index, 127);
      assert.equal(index, rows.length - 1);
      assert.equal(row.reason, "record-limit");
    } else {
      keys(row, ["schema", "sequence", "at", "event", "endpoint", "error"]);
      assert.ok(
        ["undici:request:error", "undici:client:connectError"].includes(
          row.event,
        ),
      );
      assert.ok(["loopback-broker", "other", "unknown"].includes(row.endpoint));
      keys(row.error, ["name", "code", "causeCode"]);
      assert.ok(row.error.name === null || names.has(row.error.name));
      for (const key of ["code", "causeCode"])
        assert.ok(row.error[key] === null || codes.has(row.error[key]));
    }
  }
  return rows.length;
}

export function verifyFetchDiagnosticFollowup(options = {}) {
  const root = path.resolve(options.root ?? here);
  const repository = path.resolve(
    options.repository ??
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
  );
  const prefix = safePath(
    path.relative(repository, root).replaceAll("\\", "/"),
  );
  const cache = new Map();
  function repoRead(name) {
    safePath(name);
    if (cache.has(name)) return cache.get(name);
    let bytes;
    if (options.readRepository) bytes = options.readRepository(name);
    else if (options.gitHead) {
      const mode = execFileSync("git", ["ls-tree", "HEAD", "--", name], {
        cwd: repository,
        encoding: "utf8",
      });
      assert.match(mode, /^100(?:644|755) blob /u, "regular Git blob required");
      bytes = execFileSync("git", ["show", `HEAD:${name}`], {
        cwd: repository,
        maxBuffer: 64 * 1024 * 1024,
      });
    } else {
      const file = path.join(repository, name),
        relative = path.relative(
          fs.realpathSync(repository),
          fs.realpathSync(file),
        );
      assert.ok(
        relative && !relative.startsWith("..") && !path.isAbsolute(relative),
      );
      assert.ok(fs.lstatSync(file).isFile());
      bytes = fs.readFileSync(file);
    }
    cache.set(name, bytes);
    return bytes;
  }
  function read(name) {
    safePath(name);
    if (options.readEvidence) return options.readEvidence(name);
    if (!options.gitHead) {
      const relative = path.relative(
        fs.realpathSync(root),
        fs.realpathSync(path.join(root, name)),
      );
      assert.ok(
        relative && !relative.startsWith("..") && !path.isAbsolute(relative),
        "file escapes report root",
      );
    }
    return repoRead(prefix + "/" + name);
  }
  const json = (name) => jsonBytes(read(name));
  function archive(ref, namespace) {
    safePath(ref.path);
    if (namespace)
      assert.ok(
        ref.path.startsWith(namespace),
        "wrong followup archive namespace",
      );
    const stored = read(ref.path);
    assert.equal(hash(stored), ref.storedDigest);
    const raw = gunzipSync(stored, { maxOutputLength: 64 * 1024 * 1024 });
    assert.equal(hash(raw), ref.originalDigest);
    assert.equal(raw.length, ref.originalBytes);
    return raw;
  }
  function evidenceFor(run, followup = false) {
    const map = new Map();
    for (const e of run.evidence ?? []) {
      assert.ok(["generation", "acceptance"].includes(e.stage));
      safePath(e.originalArtifactPath);
      const key = e.stage + "/" + e.originalArtifactPath;
      assert.ok(!map.has(key), "duplicate artifact member");
      if (followup) {
        const base = `fetch-diagnostics-followup/${run.runId}/`;
        const direct = `${base}${key}.gz`;
        const compact = `${base}objects/${hash(Buffer.from(key)).slice(7)}.gz`;
        assert.ok(
          e.archived.path === direct || e.archived.path === compact,
          "wrong followup member storage binding",
        );
      }
      map.set(
        key,
        archive(
          e.archived,
          followup ? `fetch-diagnostics-followup/${run.runId}/` : undefined,
        ),
      );
    }
    return (stage, member, optional = false) => {
      safePath(member);
      const bytes = map.get(stage + "/" + member);
      if (!optional) assert.ok(bytes, `missing ${stage}/${member}`);
      return bytes;
    };
  }
  const data = json("fetch-diagnostics-followup.json"),
    latest = json("latest-package-round.json");
  assert.equal(data.schema, "chainlesschain.fetch-diagnostic-followup/v1");
  assert.equal(data.billingAssessed, false);
  assert.equal(data.samples.length, 1);
  assert.equal(data.samples[0].sampleId, SAMPLE);
  const projection = data.samples[0];
  assert.equal(projection.newModelGenerationRequired, true);
  assert.equal(projection.taskId, SAMPLE);
  assert.equal(projection.kind, "task");
  assert.equal(projection.group, GROUP);
  assert.equal(data.runs.length, 1);
  const run = data.runs[0];
  assert.equal(run.group, GROUP);
  assert.deepEqual(run.selectedSampleIds, [SAMPLE]);
  assert.match(run.runId, /^[1-9]\d*$/u);
  assert.match(run.sourceCommit, /^[a-f0-9]{40}$/u);
  const knownAccepted = new Set(
    json("native-verified-deliveries.json")
      .filter((s) => s.candidateAcceptancePassed === true)
      .map((s) => s.sampleId),
  );
  for (const s of latest.samples)
    if (s.candidateAcceptancePassed === true) knownAccepted.add(s.sampleId);
  assert.ok(
    !knownAccepted.has(SAMPLE),
    "cannot repeat an already accepted task",
  );
  assert.deepEqual(data.versions, latest.versions);
  assert.equal(data.packageSetPath, latest.packageSetPath);
  assert.equal(data.packageSetDigest, latest.packageSetDigest);
  const pinnedBytes = repoRead(data.packageSetPath);
  assert.equal(hash(pinnedBytes), data.packageSetDigest);
  const pinned = jsonBytes(pinnedBytes);
  assert.equal(pinned.schema, "chainlesschain.native-package-set/v1");
  assert.deepEqual(pinned.versions, data.versions);
  const planRoot = "docs/research/cli/verify01-plan-2026-10-13-volcengine/";
  const plan = jsonBytes(repoRead(planRoot + "plan.json")),
    catalog = jsonBytes(repoRead(planRoot + "tasks.json"));
  const planDigest = repoRead(planRoot + "plan.sha256")
    .toString("utf8")
    .trim();
  assert.equal(plan.commitSha, latest.frozenProjectCommit);
  const planned = plan.samples.find((s) => s.id === SAMPLE);
  assert.equal(planned.taskId, SAMPLE);
  assert.equal(planned.stratum, GROUP + "-volcengine");
  assert.equal(planned.kind, "task");
  const task = catalog.tasks.find((t) => t.id === SAMPLE);
  assert.ok(task);
  function candidates(row, getFile) {
    const files = new Set();
    for (const candidate of row.candidates ?? []) {
      assert.ok(task.expectedFiles.includes(candidate.file));
      assert.ok(!files.has(candidate.file));
      files.add(candidate.file);
      assert.equal(candidate.path, `${SAMPLE}/candidate/${candidate.file}`);
      const bytes = getFile("generation", candidate.path);
      assert.equal(hash(bytes), candidate.digest);
      assert.equal(bytes.length, candidate.bytes);
    }
  }
  function receipts(row, getFile) {
    for (const stage of ["setup", "check"]) {
      const step = row[stage];
      if (!step) continue;
      assert.ok(step.receiptPath);
      const bytes = getFile("acceptance", step.receiptPath);
      assert.equal(hash(bytes), step.receiptDigest);
      const receipt = jsonBytes(bytes);
      assert.equal(receipt.taskId, SAMPLE);
      assert.equal(receipt.stage, stage);
      assert.equal(receipt.pass, step.pass);
      for (const key of ["tests", "mutations"])
        if (key in step) assert.deepEqual(step[key], receipt[key]);
      if (receipt.pass) {
        assert.ok(
          receipt.tests?.some((t) => t.kind === "baseline" && t.total > 0),
        );
        for (const t of receipt.tests) {
          assert.ok(t.total > 0);
          assert.equal(t.failed, 0);
          assert.equal(t.passed, t.total);
        }
        if (stage === "check") {
          assert.ok(
            receipt.tests.some((t) => t.kind === "candidate" && t.total > 0),
          );
          assert.ok(receipt.mutations?.length);
          for (const m of receipt.mutations)
            assert.ok(m.total > 0 && m.failed > 0);
        }
      }
    }
    assert.equal(
      row.candidateAcceptancePassed,
      row.setup?.pass === true && row.check?.pass === true,
    );
    assert.equal(
      row.passed,
      row.generationPassed === true && row.candidateAcceptancePassed,
    );
  }
  const original = run.originalFailedAttempt;
  assert.equal(original.runId, "39087878780");
  assert.equal(original.sampleId, SAMPLE);
  assert.notEqual(run.runId, original.runId);
  const oldRun = latest.runs.find((r) => r.runId === original.runId);
  assert.ok(oldRun?.generation && oldRun?.acceptance);
  assert.equal(oldRun.group, GROUP);
  assert.equal(
    original.generationSummaryDigest,
    oldRun.generation.rawSummary.originalDigest,
  );
  assert.equal(
    original.acceptanceSummaryDigest,
    oldRun.acceptance.rawSummary.originalDigest,
  );
  const oldGen = jsonBytes(archive(oldRun.generation.rawSummary)),
    oldAcc = jsonBytes(archive(oldRun.acceptance.rawSummary));
  assert.equal(oldAcc.sourceSummaryDigest, original.generationSummaryDigest);
  assert.equal(oldGen.executionSourceCommit, oldRun.sourceCommit);
  assert.equal(oldAcc.deliverySourceCommit, oldRun.sourceCommit);
  const oldNative = oldGen.samples.find((s) => s.sampleId === SAMPLE),
    oldChecked = oldAcc.samples.find((s) => s.sampleId === SAMPLE);
  assert.ok(oldNative && oldChecked);
  assert.equal(oldChecked.candidateAcceptancePassed, false);
  assert.equal(oldNative.model.failureCategory, "provider-fetch-failed");
  assert.deepEqual(oldNative.model.final, {
    type: "result",
    subtype: "error",
    is_error: true,
    error: "fetch failed",
  });
  for (const broker of [oldNative.brokerStatus, oldNative.broker].filter(
    Boolean,
  )) {
    assert.equal(broker.physicalRequestsStarted, 4);
    assert.equal(broker.usageCompleteRequests, 4);
    assert.equal(broker.poisoned, null);
    if ("errorCode" in broker) assert.equal(broker.errorCode, null);
    if ("passed" in broker) assert.equal(broker.passed, true);
    for (const t of broker.tasks ?? []) {
      assert.equal(t.requests, 4);
      assert.equal(t.errorCode, null);
    }
  }
  assert.ok(oldNative.brokerStatus || oldNative.broker);
  const oldFiles = evidenceFor(oldRun);
  candidates(oldNative, oldFiles);
  receipts(oldChecked, oldFiles);

  const getFile = evidenceFor(run, true),
    stages = {};
  const counts = {
    generationRecordsCollected: 0,
    acceptanceRecordsCollected: 0,
    candidateAcceptancePassed: 0,
    endToEndPassed: 0,
  };
  let diagnosticState = "NOT_OBSERVED",
    diagnosticRecords = 0;
  for (const stage of ["generation", "acceptance"]) {
    const ref = run[stage];
    if (!ref) continue;
    assert.ok(Number.isSafeInteger(ref.artifactId) && ref.artifactId > 0);
    assert.equal(
      ref.artifactName,
      `verify01-native-subset-${stage === "generation" ? "delivery" : "acceptance"}-${GROUP}-${run.sourceCommit}`,
    );
    assert.deepEqual(ref.sampleIds, [SAMPLE]);
    const summary = jsonBytes(
      archive(
        ref.rawSummary,
        `fetch-diagnostics-followup/${run.runId}/${stage}/`,
      ),
    );
    stages[stage] = summary;
    assert.equal(
      summary.schema,
      `chainlesschain.verify01-native-task-${stage === "generation" ? "campaign" : "acceptance"}/v1`,
    );
    assert.equal(summary.executionSourceCommit, run.sourceCommit);
    assert.equal(summary.group, GROUP);
    assert.equal(summary.projectCommit, plan.commitSha);
    assert.equal(summary.planDigest, planDigest);
    assert.deepEqual(summary.versions, data.versions);
    assert.equal(summary.packageSetDigest, data.packageSetDigest);
    assert.equal(summary.selectionScope, "operator-subset");
    assert.deepEqual(summary.selectedSampleIds, [SAMPLE]);
    assert.equal(summary.samples.length, 1);
    const s = summary.samples[0];
    assert.equal(s.sampleId, SAMPLE);
    assert.equal(s.taskId, SAMPLE);
    assert.equal(s.kind, "task");
    assert.deepEqual(s.versions, data.versions);
    assert.equal(s.packageSetDigest, data.packageSetDigest);
  }
  const gen = stages.generation,
    acc = stages.acceptance;
  if (gen) {
    const native = gen.samples[0];
    counts.generationRecordsCollected = 1;
    assert.equal(gen.actualPlatform, "win32");
    assert.equal(gen.actualEntry, "cli");
    assert.equal(gen.generationPassed, native.generationPassed);
    assert.equal(native.executionSourceCommit, run.sourceCommit);
    assert.equal(native.projectCommit, plan.commitSha);
    assert.equal(native.planDigest, planDigest);
    assert.deepEqual(getFile("generation", "package-set.json"), pinnedBytes);
    candidates(native, getFile);
    assert.equal(gen.fetchDiagnostics.enabled, true);
    assert.equal(native.fetchDiagnostics.enabled, true);
    const preload = gen.fetchDiagnostics.preload;
    assert.deepEqual(native.fetchDiagnostics.preload, preload);
    assert.equal(preload.path, "operator-fetch-diagnostics.cjs");
    const preBytes = getFile("generation", preload.path);
    assert.equal(hash(preBytes), preload.digest);
    assert.equal(preBytes.length, preload.bytes);
    const bindings = gen.executionSourceBindings.filter(
      (b) => b.file === PRELOAD,
    );
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].digest, preload.digest);
    const diag = native.fetchDiagnostics;
    assert.equal(diag.logPath, `${SAMPLE}/commands/fetch-diagnostics.jsonl`);
    if (diag.captureError !== undefined) {
      assert.equal(diag.captureError, "DIAGNOSTIC_LOG_UNAVAILABLE");
      assert.equal(diag.log, undefined);
      diagnosticState = "CAPTURE_ERROR";
    } else {
      assert.equal(diag.log.path, diag.logPath);
      const bytes = getFile("generation", diag.log.path);
      assert.equal(hash(bytes), diag.log.digest);
      assert.equal(bytes.length, diag.log.bytes);
      diagnosticRecords = validateFetchDiagnosticLog(bytes);
      diagnosticState = "CAPTURED";
    }
    assert.equal(projection.latestPackageGenerationObserved, true);
    assert.equal(projection.latestGenerationRunId, run.runId);
    assert.equal(
      projection.sourceSummaryDigest,
      run.generation.rawSummary.originalDigest,
    );
    for (const key of ["generationPassed", "host", "brokerStatus"])
      assert.deepEqual(projection[key], native[key]);
    assert.equal(
      projection.modelFailureCategory,
      native.model?.failureCategory ?? null,
    );
    if (!acc) {
      assert.equal(projection.status, "AWAITING_DIAGNOSTIC_ACCEPTANCE");
      assert.equal(projection.candidateAcceptancePassed, undefined);
      assert.equal(projection.endToEndPassed, undefined);
    }
  } else {
    assert.ok(!acc);
    assert.equal(projection.status, "PENDING_DIAGNOSTIC_EXECUTION");
    assert.equal(projection.latestPackageGenerationObserved, false);
    for (const key of [
      "latestGenerationRunId",
      "sourceSummaryDigest",
      "generationPassed",
      "candidateAcceptancePassed",
      "endToEndPassed",
    ])
      assert.equal(projection[key], undefined);
  }
  if (acc) {
    assert.equal(
      acc.sourceSummaryDigest,
      run.generation.rawSummary.originalDigest,
    );
    assert.equal(acc.deliverySourceCommit, run.sourceCommit);
    assert.equal(acc.acceptanceHost, "linux-docker");
    assert.equal(acc.actualGenerationHost.platform, "win32");
    assert.equal(acc.actualGenerationHost.entry, "cli");
    const checked = acc.samples[0];
    receipts(checked, getFile);
    assert.equal(
      checked.originalGenerationPassed,
      gen.samples[0].generationPassed === true,
    );
    if (checked.passed) {
      assert.equal(gen.samples[0].host.passed, true);
      assert.equal(gen.samples[0].sourceScopePassed, true);
      assert.notEqual(checked.frozenSourceAssessment?.exact, false);
    }
    assert.equal(acc.passed, checked.passed);
    assert.equal(
      projection.candidateAcceptancePassed,
      checked.candidateAcceptancePassed,
    );
    assert.equal(projection.endToEndPassed, checked.passed);
    assert.equal(
      projection.status,
      checked.candidateAcceptancePassed
        ? "DIAGNOSTIC_CANDIDATE_ACCEPTED"
        : "DIAGNOSTIC_ATTEMPT_FAILED",
    );
    counts.acceptanceRecordsCollected = 1;
    counts.candidateAcceptancePassed = Number(
      checked.candidateAcceptancePassed,
    );
    counts.endToEndPassed = Number(checked.passed);
  }
  assert.deepEqual(data.counts, counts);
  const complete = run.remoteStatus === "completed" && Boolean(gen && acc);
  assert.equal(run.status, complete ? "COMPLETED" : "IN_PROGRESS");
  assert.equal(data.status, run.status);
  if (complete)
    for (const s of [gen, acc])
      assert.ok(
        typeof s.finishedAt === "string" &&
          Number.isFinite(Date.parse(s.finishedAt)),
      );
  if (options.requireComplete) {
    assert.equal(complete, true, "diagnostic attempt records incomplete");
    assert.equal(counts.generationRecordsCollected, 1);
    assert.equal(counts.acceptanceRecordsCollected, 1);
  }
  return { status: data.status, counts, diagnosticState, diagnosticRecords };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const arg of process.argv.slice(2))
    assert.ok(["--git-head", "--require-complete"].includes(arg));
  console.log(
    JSON.stringify(
      verifyFetchDiagnosticFollowup({
        gitHead: process.argv.includes("--git-head"),
        requireComplete: process.argv.includes("--require-complete"),
      }),
    ),
  );
}
