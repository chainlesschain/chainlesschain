import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBackendProcess } from "../__tests__/helpers/evolution-ledger-process.js";

export const EVOLUTION_LEDGER_RELIABILITY_EVIDENCE_SCHEMA =
  "chainlesschain.evolution-ledger-reliability-evidence.v2";
export const EVOLUTION_LEDGER_RELIABILITY_AGGREGATE_SCHEMA =
  "chainlesschain.evolution-ledger-reliability-aggregate.v2";

const REQUIRED_PLATFORMS = Object.freeze(["linux", "win32", "darwin"]);
const UNVERIFIED_CONDITIONS = Object.freeze([
  "physical-power-loss",
  "disk-full-filesystem-semantics",
  "independent-witness-fault-domain",
  "production-kms-hsm-pki-authority",
]);

function measureStorage(root) {
  let bytes = 0;
  let files = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) {
        bytes += fs.statSync(target).size;
        files += 1;
      }
    }
  }
  return Object.freeze({ bytes, files });
}

// Repository-only reliability exercise. Signing keys and artifact resolution
// are test authorities; the ledger, witness files and OS processes are real.
export async function runEvolutionLedgerReliabilitySoak({
  events = 1000,
  onProgress = () => {},
} = {}) {
  if (!Number.isSafeInteger(events) || events < 1 || events > 10_000) {
    throw new TypeError("events must be an integer between 1 and 10000");
  }
  if (typeof onProgress !== "function")
    throw new TypeError("onProgress must be a function");
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(
    path.join(temporaryRoot, "cc-ledger-reliability-soak-"),
  );
  let seeded = null;
  try {
    fs.mkdirSync(path.join(root, "witness"), { mode: 0o700 });
    seeded = await runBackendProcess(root, {
      mode: "seed",
      count: events,
      onProgress,
    });
    assert.equal(seeded.code, 0, JSON.stringify(seeded));
    assert.equal(seeded.signal, null);
    assert.equal(seeded.result.ok, true);
    assert.equal(seeded.result.verification.sequence, events);
    assert.equal(seeded.result.verification.eventCount, events);
    assert.ok(seeded.result.maxRssKiB > 0, "seed RSS was not measured");
    assert.ok(seeded.result.checkpointMs >= 0, "checkpoint was not measured");
    assert.ok(
      Array.isArray(seeded.result.seedResourceSamples) &&
        seeded.result.seedResourceSamples.length >= 2,
      "seed resource samples were not recorded",
    );
    const finalResourceSample = seeded.result.seedResourceSamples.at(-1);
    assert.equal(finalResourceSample.phase, "checkpoint");
    assert.equal(finalResourceSample.eventCount, events);
    assert.equal(finalResourceSample.checkpointMs, seeded.result.checkpointMs);
    assert.ok(
      finalResourceSample.disk.bytes > 0,
      "disk bytes were not measured",
    );
    assert.ok(
      finalResourceSample.disk.files > 0,
      "disk files were not measured",
    );
    onProgress("checking fresh-process snapshot readback");
    const reopened = await runBackendProcess(root, { count: events });
    assert.equal(reopened.code, 0, JSON.stringify(reopened));
    assert.equal(reopened.signal, null);
    assert.equal(reopened.result.ok, true);
    assert.notEqual(reopened.result.pid, seeded.result.pid);
    assert.equal(reopened.result.verification.sequence, events);
    assert.equal(reopened.result.verification.eventCount, events);
    assert.equal(
      reopened.result.verification.headDigest,
      seeded.result.verification.headDigest,
    );
    assert.deepEqual(
      reopened.result.samples,
      [1, Math.ceil(events / 2), events].map(
        (sequence) => `long-event-${sequence}`,
      ),
    );
    assert.equal(
      reopened.result.verificationCounts["ledger-restart:domain-event"] ?? 0,
      0,
    );
    assert.ok(
      reopened.result.verificationCounts["ledger-restart:state-snapshot"] > 0,
    );
    assert.ok(
      reopened.result.maxRssKiB < 512 * 1024,
      "reopen RSS exceeded 512 MiB",
    );
    assert.ok(reopened.result.elapsedMs < 60_000, "reopen exceeded 60 seconds");

    onProgress("checking old segment corruption behind the signed snapshot");
    const segmentRoot = path.join(root, "events", "segments-v1");
    const segmentPath = path.join(
      segmentRoot,
      fs.readdirSync(segmentRoot).sort()[0],
    );
    const segmentBytes = fs.readFileSync(segmentPath);
    fs.appendFileSync(segmentPath, "\n");
    const corruptSegment = await runBackendProcess(root, { count: events });
    assert.equal(corruptSegment.code, 2);
    assert.equal(corruptSegment.result.ok, false);
    assert.equal(corruptSegment.result.code, "CC_EVOLUTION_LEDGER_CORRUPT");
    fs.writeFileSync(segmentPath, segmentBytes);

    onProgress("checking witness authentication after restoring the segment");
    const witnessPath = path.join(root, "witness", "checkpoint.json");
    const witness = JSON.parse(fs.readFileSync(witnessPath, "utf8"));
    witness.current.signature.value = "invalid-signature";
    fs.writeFileSync(witnessPath, JSON.stringify(witness));
    const corruptWitness = await runBackendProcess(root, { count: events });
    assert.equal(corruptWitness.code, 2);
    assert.equal(corruptWitness.result.ok, false);
    assert.match(corruptWitness.result.code, /^CC_EVOLUTION_LEDGER_/u);

    return Object.freeze({
      status: "passed",
      events,
      seedPid: seeded.result.pid,
      reopenPid: reopened.result.pid,
      seedMs: seeded.result.elapsedMs,
      seedBatchSize: seeded.result.seedBatchSize,
      seedCheckpointMs: seeded.result.checkpointMs,
      seedDiskBytes: finalResourceSample.disk.bytes,
      seedDiskFileCount: finalResourceSample.disk.files,
      seedMaxRssKiB: seeded.result.maxRssKiB,
      seedResourceSamples: seeded.result.seedResourceSamples,
      seedVerificationCounts: seeded.result.verificationCounts,
      reopenMs: reopened.result.elapsedMs,
      reopenVerificationCounts: reopened.result.verificationCounts,
      reopenMaxRssKiB: reopened.result.maxRssKiB,
      childHeapLimitMiB: 256,
      segmentCorruptionRejected: true,
      witnessCorruptionRejected: true,
      productionAuthority: false,
    });
  } catch (cause) {
    const diagnostic = cause?.backendDiagnostics;
    const samples =
      seeded?.result?.seedResourceSamples ?? diagnostic?.resourceSamples ?? [];
    const disk = measureStorage(root);
    const error = cause instanceof Error ? cause : new Error(String(cause));
    error.reliabilityReport = Object.freeze({
      completedEvents:
        samples.at(-1)?.eventCount ?? diagnostic?.completedEvents ?? 0,
      elapsedMs: diagnostic?.elapsedMs ?? null,
      events,
      failureCode: error.code ?? null,
      failureMessage: error.message,
      productionAuthority: false,
      seedDiskBytesAtFailure: disk.bytes,
      seedDiskFileCountAtFailure: disk.files,
      seedResourceSamples: Object.freeze([...samples]),
      status: "failed",
    });
    throw error;
  } finally {
    // Only the newly created test directory can be cleaned up.
    assert.equal(path.dirname(path.resolve(root)), temporaryRoot);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runEvolutionLedgerFaultCampaign({
  rounds = 100,
  onProgress = () => {},
} = {}) {
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 1000)
    throw new TypeError("fault rounds must be between 1 and 1000");
  if (typeof onProgress !== "function")
    throw new TypeError("onProgress must be a function");
  const phases = [
    "after-segment-link",
    "after-segment",
    "after-anchor-link",
    "after-anchor",
    "after-witness",
    "after-head",
  ];
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const phaseCounts = Object.fromEntries(phases.map((phase) => [phase, 0]));
  const startedAt = performance.now();
  for (let round = 0; round < rounds; round += 1) {
    const phase = phases[round % phases.length];
    const committed = ["after-witness", "after-head"].includes(phase);
    const root = fs.mkdtempSync(
      path.join(temporaryRoot, "cc-ledger-fault-campaign-"),
    );
    try {
      fs.mkdirSync(path.join(root, "witness"), { mode: 0o700 });
      const seed = await runBackendProcess(root, { mode: "seed", count: 1 });
      assert.equal(seed.code, 0, JSON.stringify(seed));
      const crashed = await runBackendProcess(root, {
        mode: `crash:${phase}`,
        count: 1,
      });
      assert.equal(crashed.code, 86, JSON.stringify(crashed));
      assert.equal(crashed.result.ok, false);
      assert.equal(crashed.result.forcedExit, true);
      assert.equal(crashed.result.phase, phase);
      const count = committed ? 2 : 1;
      const recovered = await runBackendProcess(root, { count });
      assert.equal(recovered.code, 0, JSON.stringify(recovered));
      assert.equal(recovered.result.ok, true);
      assert.notEqual(recovered.result.pid, crashed.result.pid);
      assert.equal(recovered.result.verification.sequence, count);
      assert.equal(recovered.result.verification.eventCount, count);
      assert.equal(recovered.result.witness.sequence, count);
      assert.deepEqual(
        recovered.result.samples,
        [1, Math.ceil(count / 2), count].map((index) => `long-event-${index}`),
      );
      if (!committed)
        assert.equal(
          recovered.result.verification.headDigest,
          seed.result.verification.headDigest,
        );
      else
        assert.notEqual(
          recovered.result.verification.headDigest,
          seed.result.verification.headDigest,
        );
      const replay = await runBackendProcess(root, { count });
      assert.equal(replay.code, 0, JSON.stringify(replay));
      assert.equal(replay.result.verification.sequence, count);
      assert.equal(replay.result.verification.eventCount, count);
      assert.equal(
        replay.result.verification.headDigest,
        recovered.result.verification.headDigest,
      );
      assert.equal(
        replay.result.verification.witnessDigest,
        recovered.result.verification.witnessDigest,
      );
      phaseCounts[phase] += 1;
      onProgress(`recovered ${round + 1}/${rounds}: ${phase}`);
    } finally {
      assert.equal(path.dirname(path.resolve(root)), temporaryRoot);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  return Object.freeze({
    status: "passed",
    rounds,
    phaseCounts,
    elapsedMs: performance.now() - startedAt,
    falseSuccessReceipts: 0,
    productionAuthority: false,
    powerLossVerified: false,
  });
}

function assertCommitSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/iu.test(value))
    throw new TypeError(`${label} must be a full 40-character commit SHA`);
  return value.toLowerCase();
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

function assertNonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new TypeError(`${label} must be a non-negative finite number`);
  return value;
}

function assertEventResourceMetrics(report) {
  assertNonNegativeNumber(report.seedMs, "report.seedMs");
  assertNonNegativeNumber(report.seedCheckpointMs, "report.seedCheckpointMs");
  assertPositiveInteger(report.seedDiskBytes, "report.seedDiskBytes");
  assertPositiveInteger(report.seedDiskFileCount, "report.seedDiskFileCount");
  assertPositiveInteger(report.seedMaxRssKiB, "report.seedMaxRssKiB");
  assertNonNegativeNumber(report.reopenMs, "report.reopenMs");
  assertPositiveInteger(report.reopenMaxRssKiB, "report.reopenMaxRssKiB");
  if (
    !Array.isArray(report.seedResourceSamples) ||
    report.seedResourceSamples.length < 2 ||
    report.seedResourceSamples.length > 16
  ) {
    throw new TypeError("report.seedResourceSamples must be bounded");
  }
  let previousEventCount = 0;
  for (const [index, sample] of report.seedResourceSamples.entries()) {
    if (!sample || typeof sample !== "object")
      throw new TypeError(
        "report.seedResourceSamples contains an invalid sample",
      );
    assertPositiveInteger(
      sample.eventCount,
      `resource sample ${index}.eventCount`,
    );
    assertNonNegativeNumber(
      sample.elapsedMs,
      `resource sample ${index}.elapsedMs`,
    );
    assertPositiveInteger(
      sample.maxRssKiB,
      `resource sample ${index}.maxRssKiB`,
    );
    assertPositiveInteger(
      sample.disk?.bytes,
      `resource sample ${index}.disk.bytes`,
    );
    assertPositiveInteger(
      sample.disk?.files,
      `resource sample ${index}.disk.files`,
    );
    if (
      sample.eventCount < previousEventCount ||
      sample.eventCount > report.events
    )
      throw new TypeError("resource sample event counts are not monotonic");
    previousEventCount = sample.eventCount;
  }
  const final = report.seedResourceSamples.at(-1);
  if (
    final.phase !== "checkpoint" ||
    final.eventCount !== report.events ||
    final.checkpointMs !== report.seedCheckpointMs ||
    final.disk.bytes !== report.seedDiskBytes ||
    final.disk.files !== report.seedDiskFileCount
  ) {
    throw new TypeError(
      "event report is not bound to its final resource sample",
    );
  }
}

function assertPassedReport(report, mode) {
  if (!report || typeof report !== "object" || report.status !== "passed")
    throw new TypeError("reliability evidence requires a passed report");
  if (report.productionAuthority !== false)
    throw new TypeError(
      "reliability evidence cannot claim a production authority",
    );
  if (mode === "events") {
    assertPositiveInteger(report.events, "report.events");
    if (
      report.segmentCorruptionRejected !== true ||
      report.witnessCorruptionRejected !== true
    )
      throw new TypeError("event report is missing corruption-rejection proof");
    assertEventResourceMetrics(report);
    return;
  }
  if (mode === "fault-campaign") {
    assertPositiveInteger(report.rounds, "report.rounds");
    if (report.falseSuccessReceipts !== 0 || report.powerLossVerified !== false)
      throw new TypeError("fault report has an invalid fail-closed projection");
    return;
  }
  throw new TypeError("evidence mode must be events or fault-campaign");
}

export function createEvolutionLedgerReliabilityEvidence({
  mode,
  report,
  sourceRevision = null,
  now = () => new Date().toISOString(),
} = {}) {
  assertPassedReport(report, mode);
  if (sourceRevision !== null)
    sourceRevision = assertCommitSha(sourceRevision, "sourceRevision");
  const issuedAt = now();
  if (typeof issuedAt !== "string" || Number.isNaN(Date.parse(issuedAt)))
    throw new TypeError("now must return an ISO timestamp");
  return Object.freeze({
    schema: EVOLUTION_LEDGER_RELIABILITY_EVIDENCE_SCHEMA,
    issuedAt,
    mode,
    runner: Object.freeze({
      arch: process.arch,
      nodeVersion: process.version,
      platform: process.platform,
    }),
    sourceRevision,
    testAuthority: true,
    qualifiesForProduction: false,
    unverifiedConditions: UNVERIFIED_CONDITIONS,
    report: Object.freeze({ ...report }),
  });
}

export function createEvolutionLedgerReliabilityFailureEvidence({
  mode,
  report,
  sourceRevision = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (
    mode !== "events" ||
    !report ||
    report.status !== "failed" ||
    report.productionAuthority !== false
  ) {
    throw new TypeError("failure evidence requires a failed event report");
  }
  if (sourceRevision !== null)
    sourceRevision = assertCommitSha(sourceRevision, "sourceRevision");
  const issuedAt = now();
  if (typeof issuedAt !== "string" || Number.isNaN(Date.parse(issuedAt)))
    throw new TypeError("now must return an ISO timestamp");
  return Object.freeze({
    schema: EVOLUTION_LEDGER_RELIABILITY_EVIDENCE_SCHEMA,
    issuedAt,
    mode,
    runner: Object.freeze({
      arch: process.arch,
      nodeVersion: process.version,
      platform: process.platform,
    }),
    sourceRevision,
    testAuthority: true,
    qualifiesForProduction: false,
    unverifiedConditions: UNVERIFIED_CONDITIONS,
    report: Object.freeze({ ...report }),
  });
}

function writeJsonOutput(outputPath, value) {
  if (typeof outputPath !== "string" || !outputPath.trim())
    throw new TypeError("output path must be a non-empty string");
  const target = path.resolve(outputPath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporaryPath, target);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function listJsonFiles(directory) {
  const root = path.resolve(directory);
  if (!fs.statSync(root).isDirectory())
    throw new TypeError("evidence directory must be a directory");
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".json"))
        files.push(target);
    }
  };
  visit(root);
  return files.sort();
}

export function verifyEvolutionLedgerReliabilityEvidenceDirectory({
  evidenceDir,
  releaseCommit,
  minimumEvents,
  minimumFaultRounds,
} = {}) {
  releaseCommit = assertCommitSha(releaseCommit, "releaseCommit");
  minimumEvents = assertPositiveInteger(minimumEvents, "minimumEvents");
  minimumFaultRounds = assertPositiveInteger(
    minimumFaultRounds,
    "minimumFaultRounds",
  );
  const seen = new Map([
    ["events", new Set()],
    ["fault-campaign", new Set()],
  ]);
  const evidence = listJsonFiles(evidenceDir).map((file) => {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (cause) {
      throw new Error(`invalid evidence JSON: ${file}`, { cause });
    }
    if (
      !parsed ||
      parsed.schema !== EVOLUTION_LEDGER_RELIABILITY_EVIDENCE_SCHEMA ||
      !seen.has(parsed.mode) ||
      parsed.sourceRevision !== releaseCommit ||
      parsed.testAuthority !== true ||
      parsed.qualifiesForProduction !== false ||
      !Array.isArray(parsed.unverifiedConditions) ||
      UNVERIFIED_CONDITIONS.some(
        (condition) => !parsed.unverifiedConditions.includes(condition),
      ) ||
      !parsed.runner ||
      !REQUIRED_PLATFORMS.includes(parsed.runner.platform)
    )
      throw new Error(`invalid reliability evidence envelope: ${file}`);
    assertPassedReport(parsed.report, parsed.mode);
    if (parsed.mode === "events" && parsed.report.events < minimumEvents)
      throw new Error(`event evidence is below its required scale: ${file}`);
    if (
      parsed.mode === "fault-campaign" &&
      parsed.report.rounds < minimumFaultRounds
    )
      throw new Error(`fault evidence is below its required scale: ${file}`);
    if (seen.get(parsed.mode).has(parsed.runner.platform))
      throw new Error(
        `duplicate ${parsed.mode} evidence for ${parsed.runner.platform}`,
      );
    seen.get(parsed.mode).add(parsed.runner.platform);
    return Object.freeze({
      file: path.basename(file),
      mode: parsed.mode,
      platform: parsed.runner.platform,
      report: parsed.report,
    });
  });
  for (const [mode, platforms] of seen) {
    if (
      platforms.size !== REQUIRED_PLATFORMS.length ||
      REQUIRED_PLATFORMS.some((platform) => !platforms.has(platform))
    )
      throw new Error(`incomplete ${mode} platform matrix`);
  }
  return Object.freeze({
    schema: EVOLUTION_LEDGER_RELIABILITY_AGGREGATE_SCHEMA,
    status: "passed",
    sourceRevision: releaseCommit,
    minimumEvents,
    minimumFaultRounds,
    platforms: REQUIRED_PLATFORMS,
    testAuthority: true,
    qualifiesForProduction: false,
    evidence,
  });
}

function parseCliInteger(value, option) {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value))
    throw new Error(`${option} must be a positive integer`);
  return Number(value);
}

function parseCliArguments(args) {
  const parsed = {
    events: null,
    evidenceDir: null,
    faultRounds: null,
    minimumEvents: null,
    minimumFaultRounds: null,
    output: null,
    releaseCommit: null,
    sourceRevision: null,
  };
  const options = new Map([
    ["--events", "events"],
    ["--fault-rounds", "faultRounds"],
    ["--output", "output"],
    ["--source-revision", "sourceRevision"],
    ["--verify-evidence-dir", "evidenceDir"],
    ["--release-commit", "releaseCommit"],
    ["--minimum-events", "minimumEvents"],
    ["--minimum-fault-rounds", "minimumFaultRounds"],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = options.get(args[index]);
    const value = args[index + 1];
    if (!key || value === undefined)
      throw new Error("invalid evolution-ledger reliability command arguments");
    if (parsed[key] !== null)
      throw new Error(`duplicate option: ${args[index]}`);
    parsed[key] = value;
  }
  if (parsed.evidenceDir !== null) {
    if (
      parsed.events !== null ||
      parsed.faultRounds !== null ||
      parsed.sourceRevision !== null ||
      parsed.releaseCommit === null ||
      parsed.minimumEvents === null ||
      parsed.minimumFaultRounds === null
    )
      throw new Error(
        "evidence verification requires only its release and scale options",
      );
    return {
      kind: "verify",
      evidenceDir: parsed.evidenceDir,
      output: parsed.output,
      releaseCommit: parsed.releaseCommit,
      minimumEvents: parseCliInteger(parsed.minimumEvents, "--minimum-events"),
      minimumFaultRounds: parseCliInteger(
        parsed.minimumFaultRounds,
        "--minimum-fault-rounds",
      ),
    };
  }
  if (parsed.events !== null && parsed.faultRounds !== null)
    throw new Error("choose either --events or --fault-rounds");
  if (parsed.minimumEvents !== null || parsed.minimumFaultRounds !== null)
    throw new Error(
      "minimum scale options only apply to evidence verification",
    );
  return {
    kind: parsed.faultRounds === null ? "events" : "fault-campaign",
    events:
      parsed.events === null
        ? 1000
        : parseCliInteger(parsed.events, "--events"),
    faultRounds:
      parsed.faultRounds === null
        ? null
        : parseCliInteger(parsed.faultRounds, "--fault-rounds"),
    output: parsed.output,
    sourceRevision: parsed.sourceRevision,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  let command = null;
  try {
    if (args.length === 1 && args[0] === "--help") {
      console.log(
        "Usage: npm run test:evolution-ledger-reliability-soak -- [--events 1000 | --fault-rounds 100] [--source-revision <40-char SHA>] [--output <evidence.json>]\n       npm run test:evolution-ledger-reliability-soak -- --verify-evidence-dir <dir> --release-commit <40-char SHA> --minimum-events <n> --minimum-fault-rounds <n> [--output <aggregate.json>]\nTest-only authorities; real ledger/witness files and separate bounded-heap processes. Large runs may take tens of minutes. Forced process exit is not power-loss acceptance.",
      );
    } else {
      command = parseCliArguments(args);
      const onProgress = (message) => console.error(message);
      if (command.kind === "verify") {
        const aggregate = verifyEvolutionLedgerReliabilityEvidenceDirectory({
          evidenceDir: command.evidenceDir,
          releaseCommit: command.releaseCommit,
          minimumEvents: command.minimumEvents,
          minimumFaultRounds: command.minimumFaultRounds,
        });
        if (command.output) writeJsonOutput(command.output, aggregate);
        console.log(JSON.stringify(aggregate, null, 2));
      } else {
        const report =
          command.kind === "fault-campaign"
            ? await runEvolutionLedgerFaultCampaign({
                rounds: command.faultRounds,
                onProgress,
              })
            : await runEvolutionLedgerReliabilitySoak({
                events: command.events,
                onProgress,
              });
        if (command.output) {
          const evidence = createEvolutionLedgerReliabilityEvidence({
            mode: command.kind,
            report,
            sourceRevision: command.sourceRevision,
          });
          writeJsonOutput(command.output, evidence);
        }
        console.log(JSON.stringify(report, null, 2));
      }
    }
  } catch (error) {
    if (command?.output && error?.reliabilityReport) {
      try {
        writeJsonOutput(
          command.output,
          createEvolutionLedgerReliabilityFailureEvidence({
            mode: command.kind,
            report: error.reliabilityReport,
            sourceRevision: command.sourceRevision,
          }),
        );
      } catch (diagnosticError) {
        console.error(
          `failed to persist reliability diagnostics: ${diagnosticError?.message ?? String(diagnosticError)}`,
        );
      }
    }
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  }
}
