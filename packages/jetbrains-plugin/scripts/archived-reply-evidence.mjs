/** Independent UI restoration evidence; never a new task or model verdict. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  loadVerifiedNativeAcceptedSamples,
  NATIVE_EVIDENCE_ROOT,
  validateNativePackageSetFile,
} from "../../cli/scripts/verify01-native-retest-plan.mjs";

export const REPLY_SCHEMA = "chainlesschain.archived-reply-fixture/v1";
export const RECOVERY_SCHEMA = "chainlesschain.archived-reply-recovery/v1";
export const repository = fileURLToPath(new URL("../../../", import.meta.url));
export const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const ORIGINAL_REPLY_DIGEST =
  "sha256:8f1a927835bb8bbfe0d3f3904294eb622c99c843678cb9b36103282d0545503c";
export const ORIGINAL_RENDER_DIGEST =
  "sha256:3ba50b15d06ed9bb259b33383ea416c11bb11fbb97c34664379d8ed4027e9655";

function archived(record) {
  assert.ok(record.path && !/[\\:]/u.test(record.path));
  assert.ok(
    record.path
      .split("/")
      .every((part) => part && part !== "." && part !== ".."),
  );
  let file = path.join(repository, NATIVE_EVIDENCE_ROOT);
  for (const part of record.path.split("/")) {
    file = path.join(file, part);
    assert.ok(!fs.lstatSync(file).isSymbolicLink());
  }
  const stored = fs.readFileSync(file);
  assert.equal(digest(stored), record.storedDigest);
  const raw = gunzipSync(stored, { maxOutputLength: 2 * 1024 * 1024 });
  assert.equal(raw.length, record.originalBytes);
  assert.equal(digest(raw), record.originalDigest);
  return raw;
}

/** Verify the actual accepted bytes and receipts, then bind the old UI result. */
export function loadVerify33Reply() {
  const baseline = loadVerifiedNativeAcceptedSamples();
  assert.ok(baseline.acceptedIds.has("verify-33"));
  const sample = baseline.latest.samples.find(
    (row) => row.sampleId === "verify-33",
  );
  assert.equal(sample.candidateAcceptancePassed, true);
  assert.equal(sample.endToEndPassed, false);
  const run = baseline.latest.runs.find((row) => row.runId === "39087930713");
  assert.equal(run.group, "linux-jetbrains");
  const stateRecord = run.evidence.find(
    (row) =>
      row.originalArtifactPath === "verify-33/capture/restart-state.json",
  ).archived;
  const state = JSON.parse(archived(stateRecord));
  assert.equal(state.sampleId, "verify-33");
  assert.equal(digest(state.result), ORIGINAL_REPLY_DIGEST);
  assert.equal(digest(state.renderedText), ORIGINAL_RENDER_DIGEST);
  assert.notEqual(
    state.result,
    state.renderedText,
    "raw Markdown cannot be the rendering oracle",
  );
  const rows = state.finalSnapshot.savedRows.filter(
    (row) => row.id === state.savedRowId,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceText, state.result);
  assert.equal(rows[0].bodyText, state.renderedText);
  const candidates = run.evidence.filter((row) =>
    row.originalArtifactPath.startsWith("verify-33/candidate/"),
  );
  assert.equal(candidates.length, 1);
  for (const row of candidates) archived(row.archived);
  return {
    schema: REPLY_SCHEMA,
    sampleId: "verify-33",
    originalRunId: run.runId,
    source: state.result,
    sourceDigest: ORIGINAL_REPLY_DIGEST,
    rendered: state.renderedText,
    renderedDigest: ORIGINAL_RENDER_DIGEST,
    prompt:
      "Replay archived verify-33 reply; do not generate or change any files.",
    baselineEvidence: baseline.baselineEvidence,
    originalState: stateRecord,
    originalSummary: run.generation.rawSummary,
    originalAcceptance: run.acceptance.rawSummary,
    reusedCandidates: candidates.map((row) => ({
      originalArtifactPath: row.originalArtifactPath,
      archived: row.archived,
    })),
    originalVerdict: { candidateAcceptancePassed: true, endToEndPassed: false },
    scope:
      "Deterministic archived reply, repository canonical storage/history, real public JetBrains plugin. No public CLI or new task execution claim.",
  };
}

export function validateReplyFixture(value) {
  assert.equal(value.schema, REPLY_SCHEMA);
  assert.equal(value.sampleId, "verify-33");
  assert.equal(value.originalRunId, "39087930713");
  for (const field of ["source", "rendered"]) {
    assert.equal(typeof value[field], "string");
    assert.ok(
      Buffer.byteLength(value[field]) > 0 &&
        Buffer.byteLength(value[field]) <= 1024 * 1024,
    );
    assert.equal(digest(value[field]), value[`${field}Digest`]);
  }
  assert.equal(value.sourceDigest, ORIGINAL_REPLY_DIGEST);
  assert.equal(value.renderedDigest, ORIGINAL_RENDER_DIGEST);
  assert.notEqual(value.source, value.rendered);
  assert.equal(
    value.prompt,
    "Replay archived verify-33 reply; do not generate or change any files.",
  );
  return value;
}

export function readPublicPluginBinding(
  versionsFile,
  repositoryRoot = repository,
) {
  const selected = validateNativePackageSetFile(versionsFile, repositoryRoot);
  const manifest = JSON.parse(selected.bytes);
  const version = manifest.versions.jetbrains;
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  assert.equal(manifest.versions.jetbrainsHost, "2025.2");
  const origin = manifest.origin?.jetbrains;
  assert.equal(
    origin?.url,
    "https://plugins.jetbrains.com/api/plugins/32208/updates?size=100",
  );
  assert.equal(origin.approved, true);
  assert.equal(origin.listed, true);
  assert.equal(origin.hidden, false);
  assert.ok(Number.isSafeInteger(origin.updateId) && origin.updateId > 0);
  assert.equal(
    origin.file,
    `32208/${origin.updateId}/chainlesschain-ide-bridge-${version}.zip`,
  );
  const artifact = manifest.publicArtifacts?.jetbrains;
  assert.ok(artifact, "independently verified public readback required");
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(
    Number.isSafeInteger(artifact.bytes) &&
      artifact.bytes > 0 &&
      artifact.bytes <= 256 * 1024 * 1024,
  );
  return {
    version,
    ideVersion: manifest.versions.jetbrainsHost,
    digest: artifact.digest,
    bytes: artifact.bytes,
    packageSetPath: versionsFile,
    packageSetDigest: selected.packageSetDigest,
    publicOrigin: origin,
  };
}

export function validatePublicPlugin(
  versionsFile,
  archiveFile,
  repositoryRoot = repository,
) {
  const plugin = readPublicPluginBinding(versionsFile, repositoryRoot);
  assert.ok(
    path.isAbsolute(archiveFile) && !fs.lstatSync(archiveFile).isSymbolicLink(),
  );
  const bytes = fs.readFileSync(archiveFile);
  assert.equal(
    digest(bytes),
    plugin.digest,
    "ZIP must match independently verified public readback",
  );
  assert.equal(bytes.length, plugin.bytes);
  return plugin;
}

export function assertRecoveryEvidence({
  fixture,
  initial,
  restart,
  records,
  plugin,
}) {
  validateReplyFixture(fixture);
  const live = initial.liveSnapshot;
  assert.ok(
    live,
    "retain the initial live snapshot before loading saved history",
  );
  assert.equal(live.visible, true);
  assert.equal(live.childRunning, false);
  assert.equal(live.turnActive, false);
  assert.ok(live.draftStatus.includes("Input accepted and stored by the CLI"));
  assert.equal(
    live.text.split(fixture.rendered).length - 1,
    1,
    "the live reply must appear exactly once before loading saved history",
  );
  for (const key of ["id", "sessionId", "profile", "processId"])
    assert.equal(live[key], initial.snapshot[key]);
  for (const [phase, value] of [
    ["initial", initial],
    ["restart", restart],
  ]) {
    assert.equal(value.schema, RECOVERY_SCHEMA);
    assert.equal(value.phase, phase);
    assert.equal(value.sampleId, "verify-33");
    assert.equal(value.sourceDigest, fixture.sourceDigest);
    assert.equal(value.renderedDigest, fixture.renderedDigest);
    assert.equal(value.pluginVersion, plugin.version);
    assert.equal(value.ideVersion, plugin.ideVersion);
    assert.equal(value.platform, "linux");
    assert.equal(value.installation.exactZipContents, true);
    assert.equal(value.installation.archiveSha256, plugin.digest);
    assert.ok(Object.keys(value.installation.files).length);
    const s = value.snapshot;
    assert.equal(s.visible, true);
    assert.equal(s.childRunning, false);
    assert.equal(s.turnActive, false);
    const rows = s.savedRows.filter((row) => row.role === "assistant");
    assert.equal(
      rows.length,
      1,
      "exactly one deterministic reply must be visible",
    );
    const row = rows[0];
    assert.ok(row.id.startsWith(`${s.sessionId}:`));
    assert.equal(row.truncated, false);
    assert.equal(row.sourceText, fixture.source);
    assert.equal(row.bodyText, fixture.rendered);
    assert.ok(row.text.includes(row.bodyText) && s.text.includes(row.text));
    assert.equal(
      s.text.split(fixture.rendered).length - 1,
      1,
      "saved history must not leave a duplicate live reply",
    );
  }
  for (const key of ["id", "sessionId", "profile"])
    assert.equal(initial.snapshot[key], restart.snapshot[key]);
  assert.notEqual(initial.snapshot.processId, restart.snapshot.processId);
  assert.equal(
    initial.snapshot.savedRows.find((row) => row.role === "assistant").id,
    restart.snapshot.savedRows.find((row) => row.role === "assistant").id,
  );
  assert.deepEqual(initial.installation, restart.installation);
  const beforeRestart = Date.parse(initial.at),
    afterRestart = Date.parse(restart.at);
  assert.ok(
    Number.isFinite(beforeRestart) &&
      Number.isFinite(afterRestart) &&
      afterRestart > beforeRestart,
  );
  const launches = records.filter(
    (row) => row.command === "archived-agent-start",
  );
  const replies = records.filter((row) => row.command === "archived-reply");
  assert.equal(launches.length, 1, "restoration must not launch another agent");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].sourceDigest, fixture.sourceDigest);
  assert.equal(replies[0].sessionId, initial.snapshot.sessionId);
  const history = records.filter(
    (row) =>
      row.command === "canonical-session-show" &&
      row.args?.includes("--history") &&
      row.args?.includes(initial.snapshot.sessionId) &&
      Date.parse(row.at) >= beforeRestart &&
      Date.parse(row.at) <= afterRestart,
  );
  assert.ok(
    history.some((read) =>
      records.some(
        (row) =>
          row.command === "canonical-session-show-complete" &&
          row.commandId === read.commandId &&
          row.code === 0 &&
          row.signal === null,
      ),
    ),
    "real canonical history must be read again after the first host phase",
  );
  assert.equal(
    records.filter((row) => row.command === "archived-peer-rejected").length,
    0,
  );
  return {
    schema: RECOVERY_SCHEMA,
    status: "PASSED_ARCHIVED_REPLY_RECOVERY_ONLY",
    sampleId: "verify-33",
    plugin,
    sourceDigest: fixture.sourceDigest,
    renderedDigest: fixture.renderedDigest,
    originalVerdict: fixture.originalVerdict,
    modelRequests: 0,
    newTaskExecution: false,
    publicCliVerified: false,
    scope: fixture.scope,
  };
}
