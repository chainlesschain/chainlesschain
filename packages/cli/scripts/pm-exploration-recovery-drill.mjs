import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPmExplorationRecoveryProcess } from "../__tests__/helpers/pm-exploration-recovery-process.js";

export const PM_EXPLORATION_RECOVERY_DRILL_SCHEMA =
  "chainlesschain.pm-exploration-recovery-drill/v2";
export const PM_EXPLORATION_RECOVERY_EVIDENCE_SCHEMA =
  "chainlesschain.pm-exploration-recovery-evidence/v2";
export const PM_EXPLORATION_RECOVERY_AGGREGATE_SCHEMA =
  "chainlesschain.pm-exploration-recovery-aggregate/v2";

const COMMIT_SHA = /^[0-9a-f]{40}$/iu;
const REQUIRED_PLATFORMS = Object.freeze(["darwin", "linux", "win32"]);

const UNVERIFIED_CONDITIONS = Object.freeze([
  "physical-power-loss",
  "production-kms-hsm-pki-authority",
  "independent-remote-fault-domain",
  "production-filesystem-and-device-cache-semantics",
  "real-disk-full",
  "real-read-only-filesystem",
  "real-remote-authority-timeout-and-disconnect",
]);

const REQUIRED_FAULT_RESULTS = Object.freeze({
  "artifact-erofs": Object.freeze({ code: "EROFS", committed: false }),
  "authority-invalid-receipt": Object.freeze({
    code: "CC_PM_EXPLORATION_LEDGER_CORRUPT",
    committed: false,
  }),
  "authority-resolve-timeout": Object.freeze({
    code: "ETIMEDOUT",
    committed: true,
  }),
  "authority-retain-reset": Object.freeze({
    code: "ECONNRESET",
    committed: false,
  }),
  "authority-retain-timeout": Object.freeze({
    code: "ETIMEDOUT",
    committed: false,
  }),
  "ledger-enospc-after-segment": Object.freeze({
    code: "ENOSPC",
    committed: false,
  }),
  "ledger-enospc-after-witness": Object.freeze({
    code: "ENOSPC",
    committed: true,
  }),
});

function sourceRevision(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value))
    throw new TypeError(`${label} must be a full 40-character commit SHA`);
  return value.toLowerCase();
}

function assertPassedReport(report) {
  if (
    !report ||
    typeof report !== "object" ||
    report.schema !== PM_EXPLORATION_RECOVERY_DRILL_SCHEMA ||
    report.status !== "passed" ||
    !Number.isSafeInteger(report.processCount) ||
    report.processCount < 24 ||
    report.falseSuccessReceipts !== 0 ||
    report.testAuthority !== true ||
    report.productionAuthority !== false ||
    report.physicalPowerLossVerified !== false ||
    report.syntheticFaultInjection !== true ||
    report.realDiskFullVerified !== false ||
    report.realReadOnlyFilesystemVerified !== false ||
    report.realRemoteAuthorityVerified !== false ||
    report.qualifiesForProduction !== false
  ) {
    throw new TypeError(
      "PM recovery evidence requires a passed test-only drill",
    );
  }
  for (const field of [
    "freshProcessRestartRecovered",
    "localCacheLossRecoveredFromAuthority",
    "authorityLossRejected",
    "forcedExitAfterRetainRejected",
    "uncommittedLedgerExitRejected",
    "committedLedgerExitRecovered",
    "divergentCasConflictRejected",
    "identicalCasCommitIdempotent",
    "artifactReadOnlyFailureRejected",
    "authorityRetainTimeoutRejected",
    "authorityDisconnectRejected",
    "invalidDurabilityReceiptRejected",
    "authorityResolveTimeoutRejected",
    "preWitnessDiskFullRejected",
    "postWitnessDiskFullRecovered",
  ]) {
    if (report[field] !== true)
      throw new TypeError(`PM recovery drill did not prove ${field}`);
  }
  if (
    !Array.isArray(report.unverifiedConditions) ||
    UNVERIFIED_CONDITIONS.some(
      (condition) => !report.unverifiedConditions.includes(condition),
    )
  ) {
    throw new TypeError("PM recovery drill omitted an unverified condition");
  }
  const expectedPhases = ["after-retain", "after-segment", "after-witness"];
  if (
    !report.crashResults ||
    typeof report.crashResults !== "object" ||
    JSON.stringify(Object.keys(report.crashResults).sort()) !==
      JSON.stringify([...expectedPhases].sort())
  ) {
    throw new TypeError("PM recovery drill crash phase evidence is incomplete");
  }
  for (const phase of expectedPhases) {
    const result = report.crashResults[phase];
    if (
      !Number.isSafeInteger(result?.crashPid) ||
      result.crashPid < 1 ||
      !Number.isSafeInteger(result?.recoveredPid) ||
      result.recoveredPid < 1 ||
      result.crashPid === result.recoveredPid ||
      result.committed !== (phase === "after-witness")
    ) {
      throw new TypeError(`PM recovery drill ${phase} evidence is invalid`);
    }
  }
  if (
    !report.faultResults ||
    typeof report.faultResults !== "object" ||
    JSON.stringify(Object.keys(report.faultResults).sort()) !==
      JSON.stringify(Object.keys(REQUIRED_FAULT_RESULTS).sort())
  ) {
    throw new TypeError("PM recovery drill fault evidence is incomplete");
  }
  for (const [profile, expected] of Object.entries(REQUIRED_FAULT_RESULTS)) {
    const result = report.faultResults[profile];
    if (
      !Number.isSafeInteger(result?.faultPid) ||
      result.faultPid < 1 ||
      !Number.isSafeInteger(result?.recoveryPid) ||
      result.recoveryPid < 1 ||
      result.faultPid === result.recoveryPid ||
      result.observedCode !== expected.code ||
      result.committed !== expected.committed
    ) {
      throw new TypeError(
        `PM recovery drill ${profile} fault evidence is invalid`,
      );
    }
  }
  return report;
}

export function createPmExplorationRecoveryEvidence({
  report,
  sourceRevision: revision,
  now = () => new Date().toISOString(),
} = {}) {
  assertPassedReport(report);
  revision = sourceRevision(revision, "sourceRevision");
  const issuedAt = now();
  if (typeof issuedAt !== "string" || Number.isNaN(Date.parse(issuedAt)))
    throw new TypeError("now must return an ISO timestamp");
  return Object.freeze({
    schema: PM_EXPLORATION_RECOVERY_EVIDENCE_SCHEMA,
    status: "passed",
    sourceRevision: revision,
    issuedAt,
    runner: Object.freeze({
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    }),
    testAuthority: true,
    productionAuthority: false,
    physicalPowerLossVerified: false,
    syntheticFaultInjection: true,
    realDiskFullVerified: false,
    realReadOnlyFilesystemVerified: false,
    realRemoteAuthorityVerified: false,
    qualifiesForProduction: false,
    unverifiedConditions: UNVERIFIED_CONDITIONS,
    report: Object.freeze({ ...report }),
  });
}

function listJsonFiles(directory) {
  const root = path.resolve(directory);
  if (!fs.statSync(root).isDirectory())
    throw new TypeError("PM recovery evidence path must be a directory");
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

export function verifyPmExplorationRecoveryEvidenceDirectory({
  evidenceDir,
  releaseCommit,
  now = () => new Date().toISOString(),
} = {}) {
  releaseCommit = sourceRevision(releaseCommit, "releaseCommit");
  const files = listJsonFiles(evidenceDir);
  if (files.length !== REQUIRED_PLATFORMS.length)
    throw new Error(
      `expected exactly three PM recovery evidence files; found ${files.length}`,
    );
  const seen = new Set();
  const entries = files.map((file) => {
    const bytes = fs.readFileSync(file);
    let evidence;
    try {
      evidence = JSON.parse(bytes.toString("utf8"));
    } catch (cause) {
      throw new Error(`invalid PM recovery evidence JSON: ${file}`, { cause });
    }
    const expectedKeys = [
      "schema",
      "status",
      "sourceRevision",
      "issuedAt",
      "runner",
      "testAuthority",
      "productionAuthority",
      "physicalPowerLossVerified",
      "syntheticFaultInjection",
      "realDiskFullVerified",
      "realReadOnlyFilesystemVerified",
      "realRemoteAuthorityVerified",
      "qualifiesForProduction",
      "unverifiedConditions",
      "report",
    ].sort();
    if (
      JSON.stringify(Object.keys(evidence).sort()) !==
        JSON.stringify(expectedKeys) ||
      evidence.schema !== PM_EXPLORATION_RECOVERY_EVIDENCE_SCHEMA ||
      evidence.status !== "passed" ||
      evidence.sourceRevision !== releaseCommit ||
      typeof evidence.issuedAt !== "string" ||
      Number.isNaN(Date.parse(evidence.issuedAt)) ||
      evidence.testAuthority !== true ||
      evidence.productionAuthority !== false ||
      evidence.physicalPowerLossVerified !== false ||
      evidence.syntheticFaultInjection !== true ||
      evidence.realDiskFullVerified !== false ||
      evidence.realReadOnlyFilesystemVerified !== false ||
      evidence.realRemoteAuthorityVerified !== false ||
      evidence.qualifiesForProduction !== false ||
      !Array.isArray(evidence.unverifiedConditions) ||
      UNVERIFIED_CONDITIONS.some(
        (condition) => !evidence.unverifiedConditions.includes(condition),
      ) ||
      !evidence.runner ||
      !REQUIRED_PLATFORMS.includes(evidence.runner.platform) ||
      typeof evidence.runner.arch !== "string" ||
      evidence.runner.arch === "" ||
      !/^v22\./u.test(evidence.runner.nodeVersion ?? "") ||
      seen.has(evidence.runner.platform)
    ) {
      throw new Error(`invalid PM recovery evidence envelope: ${file}`);
    }
    assertPassedReport(evidence.report);
    seen.add(evidence.runner.platform);
    return Object.freeze({
      file: path.basename(file),
      evidenceDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      platform: evidence.runner.platform,
      arch: evidence.runner.arch,
      nodeVersion: evidence.runner.nodeVersion,
      processCount: evidence.report.processCount,
      falseSuccessReceipts: evidence.report.falseSuccessReceipts,
    });
  });
  if (REQUIRED_PLATFORMS.some((platform) => !seen.has(platform)))
    throw new Error("PM recovery evidence platform matrix is incomplete");
  const verifiedAt = now();
  if (typeof verifiedAt !== "string" || Number.isNaN(Date.parse(verifiedAt)))
    throw new TypeError("now must return an ISO timestamp");
  return Object.freeze({
    schema: PM_EXPLORATION_RECOVERY_AGGREGATE_SCHEMA,
    status: "passed",
    releaseCommit,
    verifiedAt,
    platforms: Object.freeze(
      entries.sort((left, right) =>
        left.platform.localeCompare(right.platform),
      ),
    ),
    falseSuccessReceipts: 0,
    testAuthority: true,
    productionAuthority: false,
    physicalPowerLossVerified: false,
    syntheticFaultInjection: true,
    realDiskFullVerified: false,
    realReadOnlyFilesystemVerified: false,
    realRemoteAuthorityVerified: false,
    qualifiesForProduction: false,
    unverifiedConditions: UNVERIFIED_CONDITIONS,
  });
}

function writeJsonOutput(outputPath, value) {
  if (typeof outputPath !== "string" || outputPath.trim() === "")
    throw new TypeError("output path must be a non-empty string");
  const target = path.resolve(outputPath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function scenarioRoot(root, name) {
  const target = path.join(root, name);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  return target;
}

function removeScenarioChild(root, name) {
  const parent = path.resolve(root);
  const target = path.resolve(root, name);
  const relative = path.relative(parent, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("PM recovery drill cleanup escaped its scenario root");
  }
  fs.rmSync(target, { recursive: true, force: true });
}

async function waitForFiles(files, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (files.some((file) => !fs.existsSync(file))) {
    if (Date.now() - startedAt > timeoutMs)
      throw new Error("PM recovery drill concurrent barrier timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function concurrentCommits(
  root,
  leftSuffix,
  rightSuffix,
  barrier,
  { leftParticipant = leftSuffix, rightParticipant = rightSuffix } = {},
) {
  const left = runPmExplorationRecoveryProcess(root, {
    mode: "commit",
    suffix: leftSuffix,
    barrier,
    participant: leftParticipant,
  });
  const leftReady = `${barrier}.${leftParticipant}.ready`;
  await Promise.race([
    waitForFiles([leftReady]),
    left.then((result) => {
      throw new Error(
        `left PM recovery contender exited before its barrier: ${JSON.stringify(result)}`,
      );
    }),
  ]);
  const right = runPmExplorationRecoveryProcess(root, {
    mode: "commit",
    suffix: rightSuffix,
    barrier,
    participant: rightParticipant,
  });
  const rightReady = `${barrier}.${rightParticipant}.ready`;
  await Promise.race([
    waitForFiles([rightReady]),
    right.then((result) => {
      throw new Error(
        `right PM recovery contender exited before its barrier: ${JSON.stringify(result)}`,
      );
    }),
  ]);
  fs.writeFileSync(`${barrier}.go`, "go\n", { flag: "wx", mode: 0o600 });
  return Promise.all([left, right]);
}

function assertCrash(result, phase) {
  assert.equal(result.code, 86, JSON.stringify(result));
  assert.equal(result.result.ok, false);
  assert.equal(result.result.forcedExit, true);
  assert.equal(result.result.phase, phase);
}

function assertRejectedFault(result, { code, causeCode = null, profile } = {}) {
  assert.equal(result.code, 2, JSON.stringify(result));
  assert.equal(result.result.ok, false);
  assert.equal(result.result.fault, profile);
  assert.equal(result.result.code, code);
  if (causeCode !== null) {
    assert.ok(
      result.result.causeCodes.includes(causeCode),
      JSON.stringify(result),
    );
  }
}

function faultResult(faulted, recovered, observedCode, committed) {
  return Object.freeze({
    faultPid: faulted.result.pid,
    recoveryPid: recovered.result.pid,
    observedCode,
    committed,
  });
}

function assertEmptyRecovery(result) {
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.result.ok, true);
  assert.equal(result.result.evidence, null);
  assert.equal(result.result.ledgerSequence, 0);
  assert.equal(result.result.ledgerEventCount, 0);
}

function assertDurableRecovery(result) {
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.result.ok, true);
  assert.equal(result.result.ledgerSequence, 1);
  assert.equal(result.result.ledgerEventCount, 1);
  assert.deepEqual(
    {
      authenticated: result.result.evidence.authenticated,
      durable: result.result.evidence.durable,
      authorityDurable: result.result.evidence.authorityDurable,
      powerLossDurabilityTested:
        result.result.evidence.powerLossDurabilityTested,
      revision: result.result.evidence.revision,
      snapshotAuthenticated: result.result.evidence.snapshotAuthenticated,
      qualifiesForPromotion: result.result.evidence.qualifiesForPromotion,
    },
    {
      authenticated: true,
      durable: true,
      authorityDurable: true,
      powerLossDurabilityTested: false,
      revision: 1,
      snapshotAuthenticated: false,
      qualifiesForPromotion: false,
    },
  );
}

export async function runPmExplorationRecoveryDrill({
  onProgress = () => {},
} = {}) {
  if (typeof onProgress !== "function")
    throw new TypeError("onProgress must be a function");
  const temporaryRoot = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(
    path.join(temporaryRoot, "cc-pm-recovery-drill-"),
  );
  const pids = new Set();
  const remember = (result) => {
    if (Number.isSafeInteger(result?.result?.pid)) pids.add(result.result.pid);
    return result;
  };
  try {
    onProgress("checking fresh-process restart and authority recovery");
    const restartRoot = scenarioRoot(root, "restart");
    const seeded = remember(
      await runPmExplorationRecoveryProcess(restartRoot, {
        mode: "commit",
        suffix: "seed",
      }),
    );
    assert.equal(seeded.code, 0, JSON.stringify(seeded));
    assert.equal(seeded.result.acknowledgement.recovered, false);
    assertDurableRecovery(seeded);
    const reopened = remember(
      await runPmExplorationRecoveryProcess(restartRoot),
    );
    assertDurableRecovery(reopened);
    assert.notEqual(reopened.result.pid, seeded.result.pid);
    removeScenarioChild(restartRoot, "artifacts");
    const replicaRecovered = remember(
      await runPmExplorationRecoveryProcess(restartRoot),
    );
    assertDurableRecovery(replicaRecovered);
    removeScenarioChild(restartRoot, "durable-replica");
    const unavailable = remember(
      await runPmExplorationRecoveryProcess(restartRoot),
    );
    assert.equal(unavailable.code, 2, JSON.stringify(unavailable));
    assert.equal(unavailable.result.ok, false);

    const crashResults = {};
    for (const phase of ["after-retain", "after-segment", "after-witness"]) {
      onProgress(`checking forced exit at ${phase}`);
      const crashRoot = scenarioRoot(root, phase);
      const crashed = remember(
        await runPmExplorationRecoveryProcess(crashRoot, {
          mode: "crash",
          phase,
          suffix: phase.replaceAll("after-", ""),
        }),
      );
      assertCrash(crashed, phase);
      const recovered = remember(
        await runPmExplorationRecoveryProcess(crashRoot),
      );
      if (phase === "after-witness") assertDurableRecovery(recovered);
      else assertEmptyRecovery(recovered);
      crashResults[phase] = Object.freeze({
        crashPid: crashed.result.pid,
        recoveredPid: recovered.result.pid,
        committed: phase === "after-witness",
      });
    }

    const faultResults = {};
    const rejectedFaults = [
      {
        profile: "artifact-erofs",
        code: "CC_EVOLUTION_ARTIFACT_STORE_FAILED",
        causeCode: "EROFS",
        observedCode: "EROFS",
      },
      {
        profile: "authority-retain-timeout",
        code: "ETIMEDOUT",
        observedCode: "ETIMEDOUT",
      },
      {
        profile: "authority-retain-reset",
        code: "ECONNRESET",
        observedCode: "ECONNRESET",
      },
      {
        profile: "authority-invalid-receipt",
        code: "CC_PM_EXPLORATION_LEDGER_CORRUPT",
        observedCode: "CC_PM_EXPLORATION_LEDGER_CORRUPT",
      },
      {
        profile: "ledger-enospc-after-segment",
        code: "CC_EVOLUTION_LEDGER_WRITE_FAILED",
        causeCode: "ENOSPC",
        observedCode: "ENOSPC",
      },
    ];
    for (const scenario of rejectedFaults) {
      onProgress(`checking injected ${scenario.profile}`);
      const faultRoot = scenarioRoot(root, scenario.profile);
      const faulted = remember(
        await runPmExplorationRecoveryProcess(faultRoot, {
          mode: "commit",
          suffix: "fault",
          fault: scenario.profile,
        }),
      );
      assertRejectedFault(faulted, scenario);
      const recovered = remember(
        await runPmExplorationRecoveryProcess(faultRoot),
      );
      assertEmptyRecovery(recovered);
      faultResults[scenario.profile] = faultResult(
        faulted,
        recovered,
        scenario.observedCode,
        false,
      );
    }

    onProgress("checking injected authority-resolve-timeout");
    const resolveFaultRoot = scenarioRoot(root, "authority-resolve-timeout");
    const resolveSeed = remember(
      await runPmExplorationRecoveryProcess(resolveFaultRoot, {
        mode: "commit",
        suffix: "seed",
      }),
    );
    assertDurableRecovery(resolveSeed);
    const resolveFaulted = remember(
      await runPmExplorationRecoveryProcess(resolveFaultRoot, {
        fault: "authority-resolve-timeout",
      }),
    );
    assertRejectedFault(resolveFaulted, {
      profile: "authority-resolve-timeout",
      code: "CC_EVOLUTION_LEDGER_PORTS_UNAVAILABLE",
      causeCode: "ETIMEDOUT",
    });
    const resolveRecovered = remember(
      await runPmExplorationRecoveryProcess(resolveFaultRoot),
    );
    assertDurableRecovery(resolveRecovered);
    faultResults["authority-resolve-timeout"] = faultResult(
      resolveFaulted,
      resolveRecovered,
      "ETIMEDOUT",
      true,
    );

    onProgress("checking injected ledger-enospc-after-witness");
    const witnessFaultRoot = scenarioRoot(root, "ledger-enospc-after-witness");
    const witnessFaulted = remember(
      await runPmExplorationRecoveryProcess(witnessFaultRoot, {
        mode: "commit",
        suffix: "fault",
        fault: "ledger-enospc-after-witness",
      }),
    );
    assert.equal(witnessFaulted.code, 0, JSON.stringify(witnessFaulted));
    assert.equal(witnessFaulted.result.ok, true);
    assert.equal(witnessFaulted.result.acknowledgement.recovered, true);
    assert.deepEqual(witnessFaulted.result.observedFault, {
      code: "ENOSPC",
      phase: "after-witness",
      profile: "ledger-enospc-after-witness",
    });
    assertDurableRecovery(witnessFaulted);
    const witnessRecovered = remember(
      await runPmExplorationRecoveryProcess(witnessFaultRoot),
    );
    assertDurableRecovery(witnessRecovered);
    faultResults["ledger-enospc-after-witness"] = faultResult(
      witnessFaulted,
      witnessRecovered,
      "ENOSPC",
      true,
    );

    onProgress("checking divergent CAS race");
    const divergentRoot = scenarioRoot(root, "cas-divergent");
    const divergentBarrier = path.join(divergentRoot, "barrier");
    const divergent = (
      await concurrentCommits(divergentRoot, "alpha", "beta", divergentBarrier)
    ).map(remember);
    assert.equal(
      divergent.filter((entry) => entry.code === 0).length,
      1,
      JSON.stringify(divergent),
    );
    const divergentFailure = divergent.find((entry) => entry.code !== 0);
    assert.equal(divergentFailure.code, 2, JSON.stringify(divergent));
    assert.equal(
      divergentFailure.result.code,
      "CC_EVOLUTION_LEDGER_HEAD_CONFLICT",
    );
    assertDurableRecovery(
      remember(await runPmExplorationRecoveryProcess(divergentRoot)),
    );

    onProgress("checking identical concurrent idempotence");
    const identicalRoot = scenarioRoot(root, "cas-identical");
    const identicalBarrier = path.join(identicalRoot, "barrier");
    const identical = (
      await concurrentCommits(identicalRoot, "same", "same", identicalBarrier, {
        leftParticipant: "left",
        rightParticipant: "right",
      })
    ).map(remember);
    assert.equal(
      identical.filter((entry) => entry.code === 0).length,
      2,
      JSON.stringify(identical),
    );
    assert.deepEqual(
      identical.map((entry) => entry.result.acknowledgement.recovered).sort(),
      [false, true],
    );
    assert.equal(
      new Set(
        identical.map((entry) => entry.result.acknowledgement.snapshotDigest),
      ).size,
      1,
    );
    assertDurableRecovery(
      remember(await runPmExplorationRecoveryProcess(identicalRoot)),
    );

    return Object.freeze({
      schema: PM_EXPLORATION_RECOVERY_DRILL_SCHEMA,
      status: "passed",
      processCount: pids.size,
      freshProcessRestartRecovered: true,
      localCacheLossRecoveredFromAuthority: true,
      authorityLossRejected: true,
      forcedExitAfterRetainRejected: true,
      uncommittedLedgerExitRejected: true,
      committedLedgerExitRecovered: true,
      divergentCasConflictRejected: true,
      identicalCasCommitIdempotent: true,
      artifactReadOnlyFailureRejected: true,
      authorityRetainTimeoutRejected: true,
      authorityDisconnectRejected: true,
      invalidDurabilityReceiptRejected: true,
      authorityResolveTimeoutRejected: true,
      preWitnessDiskFullRejected: true,
      postWitnessDiskFullRecovered: true,
      falseSuccessReceipts: 0,
      testAuthority: true,
      productionAuthority: false,
      physicalPowerLossVerified: false,
      syntheticFaultInjection: true,
      realDiskFullVerified: false,
      realReadOnlyFilesystemVerified: false,
      realRemoteAuthorityVerified: false,
      qualifiesForProduction: false,
      unverifiedConditions: UNVERIFIED_CONDITIONS,
      crashResults: Object.freeze(crashResults),
      faultResults: Object.freeze(faultResults),
    });
  } finally {
    assert.equal(path.dirname(path.resolve(root)), temporaryRoot);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function parseCliArguments(args) {
  const parsed = {
    help: false,
    sourceRevision: null,
    output: null,
    evidenceDir: null,
    releaseCommit: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--help") {
      parsed.help = true;
      continue;
    }
    const key = {
      "--source-revision": "sourceRevision",
      "--output": "output",
      "--verify-evidence-dir": "evidenceDir",
      "--release-commit": "releaseCommit",
    }[option];
    if (!key || index + 1 >= args.length || parsed[key] !== null)
      throw new Error(`invalid PM recovery drill option: ${option}`);
    parsed[key] = args[index + 1];
    index += 1;
  }
  if (parsed.help) {
    if (args.length !== 1)
      throw new Error("--help cannot be combined with other options");
    return Object.freeze({ kind: "help" });
  }
  if (parsed.evidenceDir !== null || parsed.releaseCommit !== null) {
    if (
      parsed.evidenceDir === null ||
      parsed.releaseCommit === null ||
      parsed.sourceRevision !== null
    ) {
      throw new Error(
        "evidence verification requires --verify-evidence-dir and --release-commit only",
      );
    }
    return Object.freeze({ kind: "verify", ...parsed });
  }
  if (parsed.output !== null && parsed.sourceRevision === null)
    throw new Error("--output requires --source-revision for bound evidence");
  return Object.freeze({ kind: "run", ...parsed });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const command = parseCliArguments(process.argv.slice(2));
    if (command.kind === "help") {
      console.log(
        "Usage: npm run test:pm:recovery-drill -- [--source-revision <40-char SHA> [--output <evidence.json>]]\n       node packages/cli/scripts/pm-exploration-recovery-drill.mjs --verify-evidence-dir <dir> --release-commit <40-char SHA> [--output <aggregate.json>]\nTest-only authorities, forced process exits, and synthetic EROFS/ENOSPC/network faults; this command does not prove real disk, remote-network, or physical power-loss durability.",
      );
    } else if (command.kind === "verify") {
      const aggregate = verifyPmExplorationRecoveryEvidenceDirectory({
        evidenceDir: command.evidenceDir,
        releaseCommit: command.releaseCommit,
      });
      if (command.output) writeJsonOutput(command.output, aggregate);
      console.log(JSON.stringify(aggregate, null, 2));
    } else {
      const report = await runPmExplorationRecoveryDrill({
        onProgress: (message) => console.error(message),
      });
      const result =
        command.sourceRevision === null
          ? report
          : createPmExplorationRecoveryEvidence({
              report,
              sourceRevision: command.sourceRevision,
            });
      if (command.output) writeJsonOutput(command.output, result);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exitCode = 1;
  }
}
