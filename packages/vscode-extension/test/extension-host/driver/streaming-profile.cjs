"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SIZES = Object.freeze([10_000, 100_000, 200_000]);
const p95 = (values) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

function verifyStreamingProfile(value) {
  assert.equal(value.schema, "cc-ide-streaming-profile/v2");
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
  const stages = value.finalizationStagesMs;
  assert.ok(
    stages && typeof stages === "object",
    "finalization stages missing",
  );
  const stageNames = [
    "markdown",
    "decorate",
    "follow",
    "residualIncludingDomAndOverhead",
  ];
  assert.deepEqual(Object.keys(stages).sort(), [...stageNames].sort());
  for (const name of stageNames)
    assert.ok(
      Number.isFinite(stages[name]) && stages[name] >= 0,
      "invalid finalization stage: " + name,
    );
  const stageTotal = stageNames.reduce((sum, name) => sum + stages[name], 0);
  assert.ok(
    Math.abs(stageTotal - value.finalizationMs) <= 0.000001,
    "finalization stages do not match total",
  );
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
  fs.mkdirSync(artifactDir, { recursive: true });
  const journal = fs.openSync(
    path.join(artifactDir, "streaming-profile-progress.jsonl"),
    "wx",
    0o600,
  );
  const record = (value) =>
    fs.writeSync(
      journal,
      JSON.stringify({ at: new Date().toISOString(), ...value }) + "\n",
    );
  const call = async (chars, warmup = false) => {
    record({ chars, warmup, status: "started" });
    try {
      const result = await commands.executeCommand(
        "chainlesschain.internal.hostDomCommand",
        token,
        {
          action: "streamProfile",
          chars,
        },
      );
      verifyStreamingProfile(result);
      record({
        chars,
        warmup,
        status: "completed",
        elapsedMs: result.elapsedMs,
        samples: result.samples,
      });
      return result;
    } catch (error) {
      record({ chars, warmup, status: "failed", error: error.message });
      throw error;
    }
  };
  const cases = [];
  try {
    await call(10_000, true); // Warmup is excluded from the recorded cases.
    for (const chars of SIZES) cases.push(await call(chars));
  } finally {
    fs.closeSync(journal);
  }
  const evidence = {
    schema: "cc-ide-host-streaming-profile/v2",
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
  assert.equal(value.schema, "cc-ide-host-streaming-profile/v2");
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
