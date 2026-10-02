"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SIZES = Object.freeze([10_000, 100_000, 200_000]);
const p95 = (values) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

function verifyStreamingProfile(value) {
  assert.equal(value.schema, "cc-ide-streaming-profile/v1");
  assert.ok(SIZES.includes(value.chars));
  assert.equal(value.samples, 64);
  assert.equal(value.frameSamples, 63);
  assert.equal(value.frameIntervalsMs.length, value.frameSamples);
  assert.equal(value.updateDurationsMs.length, value.samples);
  for (const number of [
    ...value.frameIntervalsMs,
    ...value.updateDurationsMs,
    value.finalizationMs,
    value.elapsedMs,
  ])
    assert.ok(Number.isFinite(number) && number >= 0, "invalid timing sample");
  assert.equal(value.frameP95Ms, p95(value.frameIntervalsMs));
  assert.equal(value.updateP95Ms, p95(value.updateDurationsMs));
  assert.equal(value.longestUpdateMs, Math.max(...value.updateDurationsMs));
  assert.equal(
    value.longTasksSupported,
    true,
    "Chromium long-task observation missing",
  );
  assert.ok(Number.isFinite(value.longestTaskMs) && value.longestTaskMs >= 0);
  assert.equal(value.streamingParseCalls, 0);
  assert.equal(value.parseCalls, 1);
  assert.equal(value.parseChars, value.chars);
  assert.equal(value.selectionStable, true);
  assert.equal(value.deferredWhileSelected, true);
  assert.equal(value.finalizationIdempotent, true);
  assert.ok(value.textMutations >= 63);
  assert.ok(value.codeControls > 0);
  assert.equal(value.performanceGate, false);
}

async function runStreamingProfiles({ commands, token, artifactDir }) {
  const call = (chars) =>
    commands.executeCommand("chainlesschain.internal.hostDomCommand", token, {
      action: "streamProfile",
      chars,
    });
  await call(10_000); // Warmup is deliberately excluded from the recorded cases.
  const cases = [];
  for (const chars of SIZES) {
    const result = await call(chars);
    verifyStreamingProfile(result);
    cases.push(result);
  }
  const evidence = {
    schema: "cc-ide-host-streaming-profile/v1",
    renderer: "installed-vsix-production-streaming-transcript",
    fixtureOutput: true,
    hostPlatform: process.platform,
    hostArchitecture: process.arch,
    measuredAt: new Date().toISOString(),
    warmupCases: 1,
    performanceGate: false,
    cases,
  };
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, "streaming-profile.json"),
    JSON.stringify(evidence, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}

function assertStreamingProfileArtifact(artifactDir) {
  const value = JSON.parse(
    fs.readFileSync(path.join(artifactDir, "streaming-profile.json"), "utf8"),
  );
  assert.equal(value.schema, "cc-ide-host-streaming-profile/v1");
  assert.equal(
    value.renderer,
    "installed-vsix-production-streaming-transcript",
  );
  assert.equal(value.fixtureOutput, true);
  assert.equal(value.performanceGate, false);
  assert.equal(value.warmupCases, 1);
  assert.deepEqual(
    value.cases.map((c) => c.chars),
    SIZES,
  );
  value.cases.forEach(verifyStreamingProfile);
  return value;
}

module.exports = {
  runStreamingProfiles,
  verifyStreamingProfile,
  assertStreamingProfileArtifact,
};
