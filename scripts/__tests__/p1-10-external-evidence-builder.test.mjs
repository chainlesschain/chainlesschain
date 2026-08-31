import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  aggregateExternalEvidence,
  collectHostEvidence,
  executionReceiptSigningPayload,
  physicalHostIdDigest,
  physicalHostRegistryDigest,
  p110BuilderTestOnly,
  P1_10_HARNESS_EXECUTION_DOMAIN,
  P1_10_HARNESS_EXECUTION_SCHEMA,
  P1_10_FIXTURE_SET_DOMAIN,
  P1_10_HOST_REGISTRY_SCHEMA,
  P1_10_PROTECTED_INPUT_MANIFEST_SCHEMA,
  P1_10_PRODUCER_ENVIRONMENT,
  P1_10_PRODUCER_WORKFLOW,
  P1_10_RAW_REPORT_SCHEMA,
  P1_10_SIGNED_HARNESS_EXECUTION_DOMAIN,
  rawReportSigningPayload,
  trustedGitHubApiBase,
} from "../p1-10-external-evidence-builder.mjs";
import {
  digestP110Evidence,
  P1_10_MATRIX_DOMAIN,
  P1_10_PLATFORM_EVIDENCE_DOMAIN,
} from "../p1-10-external-evidence-gate.mjs";
import {
  deriveScenarioMetrics,
  digestP110KillReceipt,
  digestP110ScenarioRecord,
  normalizeScenarioReceipt,
  P1_10_RECORD_CHAIN_GENESIS_DIGEST,
  P1_10_SCENARIO_CONTRACT,
  P1_10_SCENARIO_CONTRACT_DIGEST,
  P1_10_SCENARIO_RECEIPT_SCHEMAS,
} from "../p1-10-scenario-receipts.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const matrix = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "tests/fixtures/p1-10-conformance-matrix.json"),
    "utf8",
  ),
);
const runnerOs = Object.freeze({
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
});
const platforms = Object.freeze(["linux", "macos", "windows"]);
const slots = Object.freeze(["a", "b"]);
const executionStartMs = Date.parse("2026-09-01T00:00:00.000Z");
const scenarioStartMs = executionStartMs + 1_000;
const executionElapsedMs = 1_802_000;
const jobStartedAt = new Date(executionStartMs - 1_000).toISOString();
const jobCompletedAt = new Date(
  executionStartMs + executionElapsedMs + 1_000,
).toISOString();

function sha256(value) {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

function externalRequirements() {
  return matrix.scenarios
    .flatMap((scenario) =>
      scenario.cells.filter((cell) => cell.status === "external-required"),
    )
    .sort((left, right) =>
      left.evidenceScenario.localeCompare(right.evidenceScenario),
    );
}

const manifestsByExpected = new WeakMap();

function matrixScenarioFor(evidenceScenario) {
  return matrix.scenarios.find((scenario) =>
    scenario.cells.some((cell) => cell.evidenceScenario === evidenceScenario),
  );
}

function fixtureContract(scenario) {
  const fixtures = scenario.fixtures.map((fixturePath) => {
    const bytes = fs.readFileSync(path.join(repoRoot, fixturePath));
    return {
      path: fixturePath,
      digest: sha256(bytes),
      sizeBytes: bytes.length,
    };
  });
  return {
    fixtures,
    fixtureSetDigest: digestP110Evidence(
      { fixtures },
      P1_10_FIXTURE_SET_DOMAIN,
    ),
  };
}

function protectedScenarioInput(requirement, platform) {
  const scenario = matrixScenarioFor(requirement.evidenceScenario);
  const fixture = fixtureContract(scenario);
  const common = {
    scenario: requirement.evidenceScenario,
    matrixScenarioId: scenario.id,
    interface: scenario.interface,
    fixtures: fixture.fixtures,
    fixtureSetDigest: fixture.fixtureSetDigest,
    workloadProfileDigest: sha256(
      "workload-profile-" + requirement.evidenceScenario + "-" + platform,
    ),
  };
  if (requirement.evidenceScenario === "real-multi-host-causal-agent-stream") {
    return {
      ...common,
      payloadSetDigest: sha256("causal-payload-set-" + platform),
      minimumMessagesPerHost: 2,
    };
  }
  if (
    requirement.evidenceScenario === "cross-version-graph-definition-migration"
  ) {
    return {
      ...common,
      sourceVersion: "v0",
      targetVersion: "v1",
      sourceRuntimeArtifactDigest: sha256("source-runtime-" + platform),
      targetRuntimeArtifactDigest: sha256("target-runtime-" + platform),
      packageDigest: sha256("migration-package-" + platform),
      packageSignatureDigest: sha256("migration-package-signature-" + platform),
      sourceStateDigest: sha256("migration-source-state-" + platform),
      expectedMigratedDigest: sha256("migration-expected-state-" + platform),
    };
  }
  if (
    requirement.evidenceScenario ===
    "packaged-electron-collaboration-crash-recovery"
  ) {
    return {
      ...common,
      packageDigest: sha256("electron-package-" + platform),
      packageSignatureDigest: sha256("electron-package-signature-" + platform),
      collaborationFixtureDigest: fixture.fixtureSetDigest,
      minimumRemoteUpdatesPerCrash: 1,
    };
  }
  if (requirement.evidenceScenario === "two-physical-host-mtc-roundtrip") {
    return {
      ...common,
      payloadSetDigest: sha256("mtc-payload-set-" + platform),
      minimumRoundTripsPerHost: 1,
    };
  }
  return {
    ...common,
    operationProfileDigest: sha256("soak-operation-profile-" + platform),
    minimumOperationsPerWindow: 1,
  };
}

function receiptScenarioInput(requirement, platform) {
  const input = protectedScenarioInput(requirement, platform);
  const {
    matrixScenarioId: _matrixScenarioId,
    fixtures: _fixtures,
    ...value
  } = input;
  return value;
}

function protectedInputManifest(expected, platform) {
  return {
    schema: P1_10_PROTECTED_INPUT_MANIFEST_SCHEMA,
    platform,
    commitSha: expected.commitSha,
    matrixDigest: digestP110Evidence(matrix, P1_10_MATRIX_DOMAIN),
    scenarioContractDigest: P1_10_SCENARIO_CONTRACT_DIGEST,
    scenarios: externalRequirements()
      .map((requirement) => protectedScenarioInput(requirement, platform))
      .sort((left, right) => left.scenario.localeCompare(right.scenario)),
  };
}

function manifestBytes(manifest) {
  return Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

function writeProtectedInputManifest(directory, expected, platform) {
  const target = path.join(directory, "protected-input-" + platform + ".json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    manifestsByExpected.get(expected).get(platform).bytes,
    { flag: "wx" },
  );
  return target;
}

function createRegistry() {
  const privateKeys = new Map();
  const privateKeyPem = new Map();
  const hosts = [];
  let registrationId = 7000;
  for (const platform of platforms) {
    for (const hostSlot of slots) {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const publicKeyPem = publicKey
        .export({ type: "spki", format: "pem" })
        .trim();
      const idDigest = physicalHostIdDigest(publicKeyPem);
      const runnerName = "p1-10-" + platform + "-" + hostSlot;
      hosts.push({
        idDigest,
        platform,
        hostSlot,
        runnerRegistrationId: registrationId,
        runnerName,
        hardwareIdentityDigest: sha256("hardware-" + platform + "-" + hostSlot),
        requiredLabels: [
          "self-hosted",
          "physical",
          "p1-10-external-conformance",
          platform,
          "p1-10-host-" + hostSlot,
        ],
        hostClass: "physical",
        publicKeyPem,
        enabled: true,
        validFrom: "2026-08-01T00:00:00.000Z",
        validUntil: "2026-10-01T00:00:00.000Z",
        workflow: P1_10_PRODUCER_WORKFLOW,
        environment: P1_10_PRODUCER_ENVIRONMENT,
        attesterId: "p1-10-attester-" + platform + "-" + hostSlot,
        attesterVersion: "1.0.0",
        attesterEndpoint: "local://p1-10-non-exportable-attester",
        attesterMeasurementDigest: sha256(
          "attester-measurement-" + platform + "-" + hostSlot,
        ),
        supervisorDigest:
          "sha256:" + String(platforms.indexOf(platform) + 4).repeat(64),
        supervisorVersion: "1.0.0",
        inputManifestDigest:
          "sha256:" + String(platforms.indexOf(platform) + 7).repeat(64),
      });
      privateKeys.set(idDigest, privateKey);
      privateKeyPem.set(
        idDigest,
        privateKey.export({ type: "pkcs8", format: "pem" }),
      );
      registrationId += 1;
    }
  }
  const registry = { schema: P1_10_HOST_REGISTRY_SCHEMA, hosts };
  return { registry, privateKeys, privateKeyPem };
}

function expectedFor(registry, harnessDigests = null) {
  const expected = {
    commitSha: "a".repeat(40),
    repository: "chainlesschain/chainlesschain",
    workflow: P1_10_PRODUCER_WORKFLOW,
    runId: 123456,
    runAttempt: 2,
    environment: P1_10_PRODUCER_ENVIRONMENT,
    challenge: "generated_attempt_challenge_0123456789abcdef",
    harnessDigests: harnessDigests || {
      linux: "sha256:" + "1".repeat(64),
      macos: "sha256:" + "2".repeat(64),
      windows: "sha256:" + "3".repeat(64),
    },
    supervisorDigests: Object.fromEntries(
      platforms.map((platform) => [
        platform,
        registry.hosts.find((host) => host.platform === platform)
          .supervisorDigest,
      ]),
    ),
  };
  const manifests = new Map(
    platforms.map((platform) => {
      const body = protectedInputManifest(expected, platform);
      const bytes = manifestBytes(body);
      return [platform, { body, bytes, digest: sha256(bytes) }];
    }),
  );
  expected.inputManifestDigests = Object.fromEntries(
    platforms.map((platform) => [platform, manifests.get(platform).digest]),
  );
  for (const host of registry.hosts) {
    host.inputManifestDigest = expected.inputManifestDigests[host.platform];
  }
  expected.registryDigest = physicalHostRegistryDigest(registry);
  manifestsByExpected.set(expected, manifests);
  return expected;
}

function producer(expected) {
  const {
    commitSha,
    registryDigest,
    harnessDigests,
    supervisorDigests,
    inputManifestDigests,
    ...value
  } = expected;
  return value;
}

function jobDatabaseId(platform, slot) {
  return 8000 + platforms.indexOf(platform) * 10 + slots.indexOf(slot);
}

function collectorFor(registryState, expected, platform, slot) {
  const host = registryState.registry.hosts.find(
    (candidate) =>
      candidate.platform === platform && candidate.hostSlot === slot,
  );
  const labels = [...host.requiredLabels, "X64"].sort();
  return {
    runnerName: host.runnerName,
    runnerEnvironment: "self-hosted",
    runnerOs: runnerOs[platform],
    runnerRegistrationId: host.runnerRegistrationId,
    jobDatabaseId: jobDatabaseId(platform, slot),
    jobName: "Collect authenticated host (" + platform + "/" + slot + ")",
    jobId: "collect-host",
    jobSlot: slot,
    labels,
    jobStartedAt,
  };
}

function sourceFor(registryState, expected, platform, slot) {
  const collector = collectorFor(registryState, expected, platform, slot);
  const host = registryState.registry.hosts.find(
    (candidate) => candidate.runnerName === collector.runnerName,
  );
  return {
    hostIdDigest: host.idDigest,
    hostClass: "physical",
    hostSlot: slot,
    runnerRegistrationId: host.runnerRegistrationId,
    runnerName: host.runnerName,
    runnerEnvironment: "self-hosted",
    runnerOs: runnerOs[platform],
    labels: collector.labels,
    hardwareIdentityDigest: host.hardwareIdentityDigest,
    attesterId: host.attesterId,
    attesterVersion: host.attesterVersion,
    attesterEndpoint: host.attesterEndpoint,
    attesterMeasurementDigest: host.attesterMeasurementDigest,
    supervisorDigest: host.supervisorDigest,
    supervisorVersion: host.supervisorVersion,
    inputManifestDigest: host.inputManifestDigest,
    sourceJob: {
      repository: expected.repository,
      workflow: expected.workflow,
      runId: expected.runId,
      runAttempt: expected.runAttempt,
      jobId: "collect-host",
      jobName: collector.jobName,
      jobSlot: slot,
      jobDatabaseId: collector.jobDatabaseId,
      startedAt: jobStartedAt,
    },
  };
}

function eventAt(offsetMs) {
  return new Date(scenarioStartMs + offsetMs).toISOString();
}

function recordState(input) {
  return {
    input,
    chainTip: P1_10_RECORD_CHAIN_GENESIS_DIGEST,
    records: [],
  };
}

function appendScenarioRecord(state, event) {
  const { offsetMs, ...body } = event;
  const record = {
    ...body,
    fixtureSetDigest: state.input.fixtureSetDigest,
    workloadProfileDigest: state.input.workloadProfileDigest,
    at: eventAt(offsetMs),
    monotonicOffsetMs: offsetMs,
    previousRecordDigest: state.chainTip,
  };
  record.recordDigest = digestP110ScenarioRecord(record);
  state.chainTip = record.recordDigest;
  state.records.push(record);
  return record;
}

function causalRecordPair(requirement, platform, host, peer, slot) {
  const hostA = slot === "a" ? host : peer;
  const hostB = slot === "b" ? host : peer;
  const input = receiptScenarioInput(requirement, platform);
  const stateA = recordState(input);
  const stateB = recordState(input);
  const message = (
    id,
    sequence,
    from,
    to,
    parent = null,
    parentReceive = null,
  ) => ({
    messageId: id,
    senderSequence: sequence,
    fromHostIdDigest: from.idDigest,
    toHostIdDigest: to.idDigest,
    payloadSetDigest: input.payloadSetDigest,
    payloadDigest: sha256("payload-" + platform + "-" + id),
    parentMessageId: parent?.messageId || null,
    parentSendRecordDigest: parent?.recordDigest || null,
    parentReceiveRecordDigest: parentReceive?.recordDigest || null,
    replyToMessageId: parent?.messageId || null,
    replyToSendRecordDigest: parent?.recordDigest || null,
  });
  const a1 = appendScenarioRecord(stateA, {
    type: "message-sent",
    offsetMs: 100,
    ...message("causal-" + platform + "-a-1", 1, hostA, hostB),
  });
  const receivedA1 = appendScenarioRecord(stateB, {
    type: "message-received",
    offsetMs: 120,
    ...message("causal-" + platform + "-a-1", 1, hostA, hostB),
    sentRecordDigest: a1.recordDigest,
  });
  const b1 = appendScenarioRecord(stateB, {
    type: "message-sent",
    offsetMs: 180,
    ...message("causal-" + platform + "-b-1", 1, hostB, hostA, a1, receivedA1),
  });
  const receivedB1 = appendScenarioRecord(stateA, {
    type: "message-received",
    offsetMs: 220,
    ...message("causal-" + platform + "-b-1", 1, hostB, hostA, a1, receivedA1),
    sentRecordDigest: b1.recordDigest,
  });
  const a2 = appendScenarioRecord(stateA, {
    type: "message-sent",
    offsetMs: 280,
    ...message("causal-" + platform + "-a-2", 2, hostA, hostB, b1, receivedB1),
  });
  const receivedA2 = appendScenarioRecord(stateB, {
    type: "message-received",
    offsetMs: 320,
    ...message("causal-" + platform + "-a-2", 2, hostA, hostB, b1, receivedB1),
    sentRecordDigest: a2.recordDigest,
  });
  const b2 = appendScenarioRecord(stateB, {
    type: "message-sent",
    offsetMs: 380,
    ...message("causal-" + platform + "-b-2", 2, hostB, hostA, a2, receivedA2),
  });
  appendScenarioRecord(stateA, {
    type: "message-received",
    offsetMs: 420,
    ...message("causal-" + platform + "-b-2", 2, hostB, hostA, a2, receivedA2),
    sentRecordDigest: b2.recordDigest,
  });
  return slot === "a" ? stateA.records : stateB.records;
}

function mtcRecordPair(requirement, platform, host, peer, slot) {
  const hostA = slot === "a" ? host : peer;
  const hostB = slot === "b" ? host : peer;
  const input = receiptScenarioInput(requirement, platform);
  const stateA = recordState(input);
  const stateB = recordState(input);
  const appendRoundTrip = ({
    roundTripId,
    requester,
    responder,
    requesterHost,
    responderHost,
    requestOffset,
    receiveOffset,
    responseOffset,
    completeOffset,
  }) => {
    const requestId = "request-" + roundTripId;
    const requestPayloadDigest = sha256("request-payload-" + roundTripId);
    const requestBase = {
      roundTripId,
      requestId,
      requestPayloadDigest,
      payloadSetDigest: input.payloadSetDigest,
      fromHostIdDigest: requesterHost.idDigest,
      toHostIdDigest: responderHost.idDigest,
    };
    const request = appendScenarioRecord(requester, {
      type: "roundtrip-request-sent",
      offsetMs: requestOffset,
      ...requestBase,
    });
    const received = appendScenarioRecord(responder, {
      type: "roundtrip-request-received",
      offsetMs: receiveOffset,
      ...requestBase,
      requestSendRecordDigest: request.recordDigest,
    });
    const responseBase = {
      roundTripId,
      requestId,
      requestPayloadDigest,
      payloadSetDigest: input.payloadSetDigest,
      fromHostIdDigest: responderHost.idDigest,
      toHostIdDigest: requesterHost.idDigest,
      responseId: "response-" + roundTripId,
      responsePayloadDigest: sha256("response-payload-" + roundTripId),
      replyToRequestId: requestId,
      replyToRequestSendRecordDigest: request.recordDigest,
      requestReceiveRecordDigest: received.recordDigest,
    };
    const response = appendScenarioRecord(responder, {
      type: "roundtrip-response-sent",
      offsetMs: responseOffset,
      ...responseBase,
    });
    appendScenarioRecord(requester, {
      type: "roundtrip-response-received",
      offsetMs: completeOffset,
      ...responseBase,
      responseSendRecordDigest: response.recordDigest,
    });
  };
  appendRoundTrip({
    roundTripId: "roundtrip-" + platform + "-a",
    requester: stateA,
    responder: stateB,
    requesterHost: hostA,
    responderHost: hostB,
    requestOffset: 100,
    receiveOffset: 120,
    responseOffset: 180,
    completeOffset: 220,
  });
  appendRoundTrip({
    roundTripId: "roundtrip-" + platform + "-b",
    requester: stateB,
    responder: stateA,
    requesterHost: hostB,
    responderHost: hostA,
    requestOffset: 300,
    receiveOffset: 320,
    responseOffset: 380,
    completeOffset: 420,
  });
  return slot === "a" ? stateA.records : stateB.records;
}

function scenarioRecords(
  requirement,
  platform,
  host,
  peer,
  slot,
  executionId,
  expected,
  bootIdDigest,
) {
  const scenario = requirement.evidenceScenario;
  if (scenario === "real-multi-host-causal-agent-stream") {
    return causalRecordPair(requirement, platform, host, peer, slot);
  }
  if (scenario === "two-physical-host-mtc-roundtrip") {
    return mtcRecordPair(requirement, platform, host, peer, slot);
  }
  const input = receiptScenarioInput(requirement, platform);
  const state = recordState(input);
  if (scenario === "cross-version-graph-definition-migration") {
    const bindings = {
      caseId: "case-" + slot,
      sourceVersion: input.sourceVersion,
      targetVersion: input.targetVersion,
      sourceRuntimeArtifactDigest: input.sourceRuntimeArtifactDigest,
      targetRuntimeArtifactDigest: input.targetRuntimeArtifactDigest,
      packageDigest: input.packageDigest,
      packageSignatureDigest: input.packageSignatureDigest,
      fixtureDigest: input.fixtureSetDigest,
      sourceStateDigest: input.sourceStateDigest,
      migratedDigest: input.expectedMigratedDigest,
    };
    appendScenarioRecord(state, {
      type: "migration-case",
      offsetMs: 100,
      ...bindings,
      expectedDigest: input.expectedMigratedDigest,
    });
    appendScenarioRecord(state, {
      type: "rollback-case",
      offsetMs: 200,
      ...bindings,
      restoredDigest: input.sourceStateDigest,
    });
    return state.records;
  }
  if (scenario === "packaged-electron-collaboration-crash-recovery") {
    const peerSlot = slot === "a" ? "b" : "a";
    const crashId = "crash-" + platform + "-" + slot;
    const processInstanceId = "electron-process-" + platform + "-" + slot;
    const pid =
      31_000 + platforms.indexOf(platform) * 100 + slots.indexOf(slot) + 1;
    const commitPreDigest = sha256("commit-pre-" + platform + "-" + slot);
    const commitPostDigest = sha256("commit-post-" + platform + "-" + slot);
    const transport = (origin, target, originSlot, targetSlot) => ({
      targetCrashId: "crash-" + platform + "-" + targetSlot,
      deliveryId:
        "delivery-" + platform + "-" + originSlot + "-to-" + targetSlot,
      updateId: "update-" + platform + "-" + originSlot + "-to-" + targetSlot,
      updateDigest: sha256(
        "remote-update-" + platform + "-" + originSlot + "-to-" + targetSlot,
      ),
      packageDigest: input.packageDigest,
      packageSignatureDigest: input.packageSignatureDigest,
      collaborationFixtureDigest: input.collaborationFixtureDigest,
      sessionId: "collaboration-session-" + platform,
      documentId: "collaboration-document-" + platform,
      originPeerId: "peer-" + platform + "-" + originSlot,
      targetPeerId: "peer-" + platform + "-" + targetSlot,
      originHostIdDigest: origin.idDigest,
      targetHostIdDigest: target.idDigest,
    });
    const originatedForPeer = transport(host, peer, slot, peerSlot);
    const originatedByPeer = transport(peer, host, peerSlot, slot);
    const peerOriginState = recordState(input);
    const peerOrigin = appendScenarioRecord(peerOriginState, {
      type: "remote-update-originated",
      offsetMs: 100,
      ...originatedByPeer,
    });
    appendScenarioRecord(state, {
      type: "remote-update-originated",
      offsetMs: 100,
      ...originatedForPeer,
    });
    const received = appendScenarioRecord(state, {
      type: "remote-update-received",
      offsetMs: 150,
      ...originatedByPeer,
      originRecordDigest: peerOrigin.recordDigest,
    });
    const { deliveryId, updateId, updateDigest } = originatedByPeer;
    const collaboration = {
      crashId,
      packageDigest: input.packageDigest,
      packageSignatureDigest: input.packageSignatureDigest,
      collaborationFixtureDigest: input.collaborationFixtureDigest,
      sessionId: "collaboration-session-" + platform,
      documentId: "collaboration-document-" + platform,
      localPeerId: "peer-" + platform + "-" + slot,
      remotePeerId: "peer-" + platform + "-" + peerSlot,
      localHostIdDigest: host.idDigest,
      remoteHostIdDigest: peer.idDigest,
    };
    const committed = appendScenarioRecord(state, {
      type: "committed-update",
      offsetMs: 200,
      ...collaboration,
      processInstanceId,
      pid,
      deliveryId,
      updateId,
      updateDigest,
      receivedRecordDigest: received.recordDigest,
      commitPreDigest,
      commitPostDigest,
      storePreDigest: commitPreDigest,
      storePostDigest: commitPostDigest,
    });
    const forced =
      P1_10_SCENARIO_CONTRACT.scenarios[scenario].forcedTerminationByPlatform[
        platform
      ];
    const killReceipt = {
      schema: P1_10_SCENARIO_CONTRACT.scenarios[scenario].killReceiptSchema,
      crashId,
      executionId,
      challenge: expected.challenge,
      bootIdDigest,
      attesterMeasurementDigest: host.attesterMeasurementDigest,
      supervisorDigest: host.supervisorDigest,
      packageDigest: input.packageDigest,
      processInstanceId,
      pid,
      supervisorInstanceId:
        "local-attester-supervisor-" + platform + "-" + slot,
      terminationMethod: forced.terminationMethod,
      requestedMonotonicOffsetMs: 250,
      observedMonotonicOffsetMs: 300,
      exitCode: forced.exitCode,
      signal: forced.signal,
    };
    const crash = appendScenarioRecord(state, {
      type: "process-crash",
      offsetMs: 300,
      ...collaboration,
      processInstanceId,
      pid,
      lastCommittedRecordDigest: committed.recordDigest,
      terminationMethod: forced.terminationMethod,
      exitCode: forced.exitCode,
      signal: forced.signal,
      killReceipt,
      killReceiptDigest: digestP110KillReceipt(killReceipt),
    });
    appendScenarioRecord(state, {
      type: "recovered-update",
      offsetMs: 400,
      ...collaboration,
      crashedProcessInstanceId: processInstanceId,
      crashedPid: pid,
      recoveryProcessInstanceId: "electron-recovery-" + platform + "-" + slot,
      recoveryPid: pid + 1_000,
      deliveryId,
      updateId,
      updateDigest,
      commitRecordDigest: committed.recordDigest,
      crashRecordDigest: crash.recordDigest,
      recoveryPreDigest: commitPreDigest,
      recoveryPostDigest: commitPostDigest,
    });
    return state.records;
  }
  const contract = P1_10_SCENARIO_CONTRACT.scenarios[scenario];
  for (
    let offsetMs = contract.warmupMs;
    offsetMs <= contract.minimumDurationMs;
    offsetMs += contract.maxSampleGapMs
  ) {
    appendScenarioRecord(state, {
      type: "runtime-sample",
      offsetMs,
      sampleId: "sample-" + slot + "-" + offsetMs,
      operationProfileDigest: input.operationProfileDigest,
      backlogSize: 0,
      listenerCount: 5,
      timerCount: 2,
      unsettledTasks: 0,
    });
    if (offsetMs + contract.maxSampleGapMs <= contract.minimumDurationMs) {
      appendScenarioRecord(state, {
        type: "operation-completed",
        offsetMs: offsetMs + Math.floor(contract.maxSampleGapMs / 2),
        operationId: "operation-" + slot + "-" + offsetMs,
        operationProfileDigest: input.operationProfileDigest,
      });
    }
  }
  state.records.sort(
    (left, right) => left.monotonicOffsetMs - right.monotonicOffsetMs,
  );
  // Rebuild after sorting samples and operations into one append-only stream.
  const sortedState = recordState(input);
  for (const record of state.records) {
    const body = { ...record, offsetMs: record.monotonicOffsetMs };
    for (const key of [
      "at",
      "monotonicOffsetMs",
      "previousRecordDigest",
      "recordDigest",
      "fixtureSetDigest",
      "workloadProfileDigest",
    ])
      delete body[key];
    appendScenarioRecord(sortedState, body);
  }
  return sortedState.records;
}

function scenarioReceipt(
  requirement,
  platform,
  host,
  peer,
  slot,
  executionId,
  expected,
  bootIdDigest,
) {
  const endedAt = new Date(
    scenarioStartMs + requirement.minimumDurationMs,
  ).toISOString();
  const records = scenarioRecords(
    requirement,
    platform,
    host,
    peer,
    slot,
    executionId,
    expected,
    bootIdDigest,
  );
  return {
    schema: P1_10_SCENARIO_RECEIPT_SCHEMAS[requirement.evidenceScenario],
    contractDigest: P1_10_SCENARIO_CONTRACT_DIGEST,
    scenario: requirement.evidenceScenario,
    platform,
    sourceHostIdDigest: host.idDigest,
    executionId,
    challenge: expected.challenge,
    inputManifestDigest: expected.inputManifestDigests[platform],
    attesterMeasurementDigest: host.attesterMeasurementDigest,
    bootIdDigest,
    supervisorDigest: host.supervisorDigest,
    scenarioInput: receiptScenarioInput(requirement, platform),
    startedAt: new Date(scenarioStartMs).toISOString(),
    endedAt,
    durationMs: requirement.minimumDurationMs,
    recordCount: records.length,
    recordsDigest: records.at(-1).recordDigest,
    records,
  };
}

function writeHostReports(
  root,
  registryState,
  expected,
  platform,
  slot,
  overrides = {},
) {
  const source = sourceFor(registryState, expected, platform, slot);
  const host = registryState.registry.hosts.find(
    (candidate) => candidate.idDigest === source.hostIdDigest,
  );
  const peer = registryState.registry.hosts.find(
    (candidate) =>
      candidate.platform === platform && candidate.hostSlot !== slot,
  );
  const executionId =
    overrides.executionId ||
    "execution_" + platform + "_" + slot + "_" + "x".repeat(32);
  const attesterRequestDigest =
    overrides.attesterRequestDigest ||
    sha256("attester-request-" + platform + "-" + slot);
  const bootIdDigest =
    overrides.bootIdDigest || sha256("boot-" + platform + "-" + slot);
  const trust = {
    registryDigest: expected.registryDigest,
    harnessDigest: expected.harnessDigests[platform],
    supervisorDigest: expected.supervisorDigests[platform],
    inputManifestDigest: expected.inputManifestDigests[platform],
    scenarioContractDigest: P1_10_SCENARIO_CONTRACT_DIGEST,
  };
  for (const requirement of externalRequirements()) {
    const directory = path.join(root, requirement.evidenceScenario);
    fs.mkdirSync(directory, { recursive: true });
    const receipt = scenarioReceipt(
      requirement,
      platform,
      host,
      peer,
      slot,
      executionId,
      expected,
      bootIdDigest,
    );
    const receiptPath = path.join(directory, "scenario-receipt.json");
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
    const receiptBytes = fs.readFileSync(receiptPath);
    const unsigned = {
      schema: P1_10_RAW_REPORT_SCHEMA,
      status: "passed",
      commitSha: expected.commitSha,
      producer: producer(expected),
      scenario: requirement.evidenceScenario,
      platform,
      trust,
      source,
      executionId,
      receipt: {
        schema: receipt.schema,
        path: "scenario-receipt.json",
        digest: sha256(receiptBytes),
        sizeBytes: receiptBytes.length,
      },
    };
    const report = {
      ...unsigned,
      attestation: {
        hostIdDigest: host.idDigest,
        algorithm: "ed25519",
        signature: sign(
          null,
          rawReportSigningPayload(unsigned),
          registryState.privateKeys.get(host.idDigest),
        ).toString("base64"),
      },
    };
    fs.writeFileSync(
      path.join(directory, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  const executionBody = {
    schema: P1_10_HARNESS_EXECUTION_SCHEMA,
    status: "passed",
    commitSha: expected.commitSha,
    producer: producer(expected),
    platform,
    trust,
    source,
    executionId,
    attesterRequestDigest,
    wallClockStartedAt: new Date(executionStartMs).toISOString(),
    wallClockEndedAt: new Date(
      executionStartMs + executionElapsedMs,
    ).toISOString(),
    wallClockElapsedMs: executionElapsedMs,
    monotonicElapsedMs: executionElapsedMs,
    requiredMinimumMs: 1_800_000,
    containment: {
      kind:
        platform === "linux"
          ? "linux-delegated-cgroup-v2"
          : platform === "macos"
            ? "macos-strong-external-supervisor"
            : "windows-job-object",
      attesterId: host.attesterId,
      attesterVersion: host.attesterVersion,
      attesterMeasurementDigest: host.attesterMeasurementDigest,
      supervisorDigest: host.supervisorDigest,
      supervisorVersion: host.supervisorVersion,
      bootIdDigest,
      processTreeTerminated: true,
      daemonizationDenied: true,
      secretsCleared: true,
    },
    processTreeTerminated: true,
  };
  const unsignedExecutionReceipt = {
    ...executionBody,
    receiptDigest: digestP110Evidence(
      executionBody,
      P1_10_HARNESS_EXECUTION_DOMAIN,
    ),
  };
  const executionAttestation = {
    hostIdDigest: host.idDigest,
    algorithm: "ed25519",
    signature: sign(
      null,
      executionReceiptSigningPayload(unsignedExecutionReceipt),
      registryState.privateKeys.get(host.idDigest),
    ).toString("base64"),
  };
  const signedExecutionReceiptDigest = digestP110Evidence(
    {
      receipt: unsignedExecutionReceipt,
      attestation: executionAttestation,
    },
    P1_10_SIGNED_HARNESS_EXECUTION_DOMAIN,
  );
  for (const requirement of externalRequirements()) {
    const reportPath = path.join(
      root,
      requirement.evidenceScenario,
      "report.json",
    );
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const unsigned = { ...report };
    delete unsigned.attestation;
    unsigned.signedExecutionReceiptDigest = signedExecutionReceiptDigest;
    report.signedExecutionReceiptDigest = signedExecutionReceiptDigest;
    report.attestation.signature = sign(
      null,
      rawReportSigningPayload(unsigned),
      registryState.privateKeys.get(host.idDigest),
    ).toString("base64");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  return {
    executionReceipt: {
      ...unsignedExecutionReceipt,
      attestation: executionAttestation,
      signedExecutionReceiptDigest,
    },
    executionId,
  };
}

function authoritativeJob(registryState, expected, platform, slot) {
  const collector = collectorFor(registryState, expected, platform, slot);
  return {
    id: collector.jobDatabaseId,
    name: collector.jobName,
    runner_id: collector.runnerRegistrationId,
    runner_name: collector.runnerName,
    labels: collector.labels,
    status: "completed",
    conclusion: "success",
    run_id: expected.runId,
    run_attempt: expected.runAttempt,
    // Real Actions Jobs API timestamps omit milliseconds.
    started_at: jobStartedAt.replace(".000Z", "Z"),
    completed_at: jobCompletedAt.replace(".000Z", "Z"),
  };
}

function collectAllHosts(
  tempDirectory,
  registryState,
  expected,
  overridesForHost = () => ({}),
) {
  const artifactRoot = path.join(tempDirectory, "host-artifacts");
  fs.mkdirSync(artifactRoot);
  const jobs = [];
  const artifacts = [];
  for (const platform of platforms) {
    for (const slot of slots) {
      const inputManifestPath = writeProtectedInputManifest(
        path.join(tempDirectory, "manifests", platform, slot),
        expected,
        platform,
      );
      const reportsRoot = path.join(tempDirectory, "reports", platform, slot);
      const { executionReceipt } = writeHostReports(
        reportsRoot,
        registryState,
        expected,
        platform,
        slot,
        overridesForHost(platform, slot),
      );
      const executionReceiptPath = path.join(
        tempDirectory,
        "execution-" + platform + "-" + slot + ".json",
      );
      fs.writeFileSync(
        executionReceiptPath,
        JSON.stringify(executionReceipt, null, 2) + "\n",
      );
      collectHostEvidence({
        reportsRoot,
        executionReceiptPath,
        outputDirectory: path.join(
          artifactRoot,
          "p1-10-raw-host-" +
            platform +
            "-" +
            slot +
            "-" +
            expected.runId +
            "-" +
            expected.runAttempt,
        ),
        platform,
        matrix,
        registry: registryState.registry,
        expected,
        collector: collectorFor(registryState, expected, platform, slot),
        inputManifestPath,
      });
      jobs.push(authoritativeJob(registryState, expected, platform, slot));
      artifacts.push({
        id: 9000 + artifacts.length,
        name:
          "p1-10-raw-host-" +
          platform +
          "-" +
          slot +
          "-" +
          expected.runId +
          "-" +
          expected.runAttempt,
        expired: false,
        created_at: "2026-09-01T00:30:00Z",
        updated_at: "2026-09-01T00:31:00Z",
        workflow_run: { id: expected.runId, head_sha: expected.commitSha },
      });
    }
  }
  return {
    artifactRoot,
    jobs: {
      schema: "chainlesschain.p1-10-actions-jobs-envelope/v2",
      repository: expected.repository,
      commitSha: expected.commitSha,
      workflow: expected.workflow,
      runId: expected.runId,
      runAttempt: expected.runAttempt,
      endpointPath:
        "/repos/" +
        expected.repository +
        "/actions/runs/" +
        expected.runId +
        "/attempts/" +
        expected.runAttempt +
        "/jobs",
      totalCount: jobs.length,
      pageCount: 1,
      jobs,
    },
    artifacts: {
      schema: "chainlesschain.p1-10-actions-artifacts-envelope/v1",
      repository: expected.repository,
      commitSha: expected.commitSha,
      workflow: expected.workflow,
      runId: expected.runId,
      runAttempt: expected.runAttempt,
      endpointPath:
        "/repos/" +
        expected.repository +
        "/actions/runs/" +
        expected.runId +
        "/artifacts",
      totalCount: artifacts.length,
      pageCount: 1,
      artifacts,
    },
  };
}

function withTemp(prefix, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("six independent signed host jobs aggregate into 15 derived platform cells", () => {
  withTemp("cc-p1-10-v2-", (tempDirectory) => {
    const registryState = createRegistry();
    const expected = expectedFor(registryState.registry);
    const { artifactRoot, jobs, artifacts } = collectAllHosts(
      tempDirectory,
      registryState,
      expected,
    );
    const evidence = aggregateExternalEvidence({
      platformArtifactsRoot: artifactRoot,
      jobs,
      artifacts,
      matrix,
      registry: registryState.registry,
      expected,
      issuedAt: "2026-09-01T01:00:00.000Z",
    });
    assert.equal(evidence.results.length, 5);
    assert.equal(
      evidence.results.reduce(
        (total, result) => total + result.platforms.length,
        0,
      ),
      15,
    );
    assert.ok(
      evidence.results.every((result) =>
        result.platforms.every(
          (platform) =>
            platform.hosts.length === 2 &&
            new Set(platform.hosts.map((host) => host.sourceJob.jobDatabaseId))
              .size === 2 &&
            platform.artifacts.length === 2,
        ),
      ),
    );
    assert.equal(evidence.trust.registryDigest, expected.registryDigest);
  });
});

test("registry/harness pins and authoritative runner job identities fail closed", () => {
  withTemp("cc-p1-10-trust-", (tempDirectory) => {
    const registryState = createRegistry();
    const expected = expectedFor(registryState.registry);
    const { artifactRoot, jobs, artifacts } = collectAllHosts(
      tempDirectory,
      registryState,
      expected,
    );
    assert.throws(
      () =>
        aggregateExternalEvidence({
          platformArtifactsRoot: artifactRoot,
          jobs,
          artifacts,
          matrix,
          registry: registryState.registry,
          expected: { ...expected, registryDigest: "sha256:" + "f".repeat(64) },
        }),
      /registry.*digest|digest.*registry/i,
    );
    const wrongRunner = structuredClone(jobs);
    wrongRunner.jobs[0].runner_id += 1;
    assert.throws(
      () =>
        aggregateExternalEvidence({
          platformArtifactsRoot: artifactRoot,
          jobs: wrongRunner,
          artifacts,
          matrix,
          registry: registryState.registry,
          expected,
        }),
      /registered physical job/,
    );
    const wrongWindow = structuredClone(jobs);
    wrongWindow.jobs[0].completed_at = "2026-09-01T00:10:00Z";
    assert.throws(
      () =>
        aggregateExternalEvidence({
          platformArtifactsRoot: artifactRoot,
          jobs: wrongWindow,
          artifacts,
          matrix,
          registry: registryState.registry,
          expected,
        }),
      /job window\/runner/,
    );
    const expiredArtifact = structuredClone(artifacts);
    expiredArtifact.artifacts[0].expired = true;
    assert.throws(
      () =>
        aggregateExternalEvidence({
          platformArtifactsRoot: artifactRoot,
          jobs,
          artifacts: expiredArtifact,
          matrix,
          registry: registryState.registry,
          expected,
        }),
      /expired or detached/,
    );

    const hostDirectory = path.join(
      artifactRoot,
      "p1-10-raw-host-linux-a-" + expected.runId + "-" + expected.runAttempt,
    );
    const inputManifestArtifact = path.join(
      hostDirectory,
      "protected-input-manifest.json",
    );
    const originalInputManifest = fs.readFileSync(inputManifestArtifact);
    fs.appendFileSync(inputManifestArtifact, " ");
    assert.throws(
      () =>
        aggregateExternalEvidence({
          platformArtifactsRoot: artifactRoot,
          jobs,
          artifacts,
          matrix,
          registry: registryState.registry,
          expected,
        }),
      /input manifest.*protected.*digest pin|bytes do not match/i,
    );
    fs.writeFileSync(inputManifestArtifact, originalInputManifest);

    const executionPath = path.join(hostDirectory, "harness-execution.json");
    const bundlePath = path.join(hostDirectory, "host-evidence.json");
    const execution = JSON.parse(fs.readFileSync(executionPath, "utf8"));
    execution.containment.kind = "windows-job-object";
    const executionBody = { ...execution };
    delete executionBody.receiptDigest;
    delete executionBody.attestation;
    delete executionBody.signedExecutionReceiptDigest;
    execution.receiptDigest = digestP110Evidence(
      executionBody,
      P1_10_HARNESS_EXECUTION_DOMAIN,
    );
    execution.signedExecutionReceiptDigest = digestP110Evidence(
      {
        receipt: { ...executionBody, receiptDigest: execution.receiptDigest },
        attestation: execution.attestation,
      },
      P1_10_SIGNED_HARNESS_EXECUTION_DOMAIN,
    );
    fs.writeFileSync(executionPath, JSON.stringify(execution, null, 2) + "\n");
    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
    bundle.executionReceipt = execution;
    bundle.signedExecutionReceiptDigest =
      execution.signedExecutionReceiptDigest;
    fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + "\n");
    assert.throws(
      () =>
        aggregateExternalEvidence({
          platformArtifactsRoot: artifactRoot,
          jobs,
          artifacts,
          matrix,
          registry: registryState.registry,
          expected,
        }),
      /execution receipt host signature is invalid|required measured runtime/,
    );
  });
});

test("hardware, attester measurement, and boot identities prove six independent hosts", () => {
  const registryState = createRegistry();
  const duplicateHardware = structuredClone(registryState.registry);
  duplicateHardware.hosts[1].hardwareIdentityDigest =
    duplicateHardware.hosts[0].hardwareIdentityDigest;
  assert.throws(
    () => physicalHostRegistryDigest(duplicateHardware),
    /physical runner identities must be unique/,
  );

  withTemp("cc-p1-10-boot-", (tempDirectory) => {
    const expected = expectedFor(registryState.registry);
    const sharedBoot = sha256("same-physical-boot");
    const { artifactRoot, jobs, artifacts } = collectAllHosts(
      tempDirectory,
      registryState,
      expected,
      (platform) => (platform === "linux" ? { bootIdDigest: sharedBoot } : {}),
    );
    assert.throws(
      () =>
        aggregateExternalEvidence({
          platformArtifactsRoot: artifactRoot,
          jobs,
          artifacts,
          matrix,
          registry: registryState.registry,
          expected,
        }),
      /globally independent bootIdDigest/,
    );
  });
});

test("all five receipt schemas derive metrics and reject semantic shortcuts", () => {
  const registryState = createRegistry();
  const expected = expectedFor(registryState.registry);
  const platform = "linux";
  const hosts = registryState.registry.hosts.filter(
    (host) => host.platform === platform,
  );
  const registeredHostIds = new Set(hosts.map((host) => host.idDigest));
  for (const requirement of externalRequirements()) {
    const receipts = hosts.map((host, index) => {
      const peer = hosts[1 - index];
      const slot = host.hostSlot;
      const executionId = "semantic_execution_" + slot + "_" + "q".repeat(32);
      const bootIdDigest = sha256("semantic-boot-" + slot);
      const input = scenarioReceipt(
        requirement,
        platform,
        host,
        peer,
        slot,
        executionId,
        expected,
        bootIdDigest,
      );
      return normalizeScenarioReceipt(input, {
        requirement,
        platform,
        sourceHostIdDigest: host.idDigest,
        executionId,
        registeredHostIds,
        challenge: expected.challenge,
        inputManifestDigest: expected.inputManifestDigests[platform],
        scenarioInput: receiptScenarioInput(requirement, platform),
        attesterMeasurementDigest: host.attesterMeasurementDigest,
        bootIdDigest,
        supervisorDigest: host.supervisorDigest,
      });
    });
    assert.doesNotThrow(() => deriveScenarioMetrics(requirement, receipts));
    const broken = structuredClone(receipts);
    if (
      requirement.evidenceScenario === "real-multi-host-causal-agent-stream"
    ) {
      broken[0].records = broken[0].records.filter(
        (record) => record.type !== "message-received",
      );
    } else if (
      requirement.evidenceScenario ===
      "cross-version-graph-definition-migration"
    ) {
      broken[0].records.find(
        (record) => record.type === "rollback-case",
      ).caseId = "orphan";
    } else if (
      requirement.evidenceScenario ===
      "packaged-electron-collaboration-crash-recovery"
    ) {
      broken[0].records = broken[0].records.filter(
        (record) => record.type !== "recovered-update",
      );
    } else if (
      requirement.evidenceScenario === "two-physical-host-mtc-roundtrip"
    ) {
      const delivery = broken[0].records.find(
        (record) => record.type === "message-delivered",
      );
      broken[0].records.push({ ...delivery, at: eventAt(300) });
    } else {
      broken[0].records = broken[0].records.filter(
        (record, index) =>
          record.type !== "runtime-sample" ||
          index === 0 ||
          record.at === broken[0].endedAt,
      );
    }
    assert.throws(
      () => deriveScenarioMetrics(requirement, broken),
      /metric|rollback|recovered|cadence|duplicate|lost|digest chain|recordCount|normalized object/i,
    );
  }
});

test("claimed metrics and arbitrary/tampered receipt bytes are never accepted", () => {
  withTemp("cc-p1-10-bytes-", (tempDirectory) => {
    const registryState = createRegistry();
    const expected = expectedFor(registryState.registry);
    const inputManifestPath = writeProtectedInputManifest(
      path.join(tempDirectory, "manifest"),
      expected,
      "linux",
    );
    const reportsRoot = path.join(tempDirectory, "reports");
    const { executionReceipt } = writeHostReports(
      reportsRoot,
      registryState,
      expected,
      "linux",
      "a",
    );
    const executionReceiptPath = path.join(tempDirectory, "execution.json");
    fs.writeFileSync(
      executionReceiptPath,
      JSON.stringify(executionReceipt, null, 2) + "\n",
    );
    const first = externalRequirements()[0].evidenceScenario;
    const reportPath = path.join(reportsRoot, first, "report.json");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    report.metrics = { messagesSent: 999 };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    assert.throws(
      () =>
        collectHostEvidence({
          reportsRoot,
          executionReceiptPath,
          outputDirectory: path.join(tempDirectory, "output-claimed"),
          platform: "linux",
          matrix,
          registry: registryState.registry,
          expected,
          collector: collectorFor(registryState, expected, "linux", "a"),
          inputManifestPath,
        }),
      /must contain exactly/,
    );

    writeHostReports(
      path.join(tempDirectory, "fresh"),
      registryState,
      expected,
      "linux",
      "a",
    );
    const freshReceipt = path.join(
      tempDirectory,
      "fresh",
      first,
      "scenario-receipt.json",
    );
    fs.appendFileSync(freshReceipt, "tamper");
    assert.throws(
      () =>
        collectHostEvidence({
          reportsRoot: path.join(tempDirectory, "fresh"),
          executionReceiptPath,
          outputDirectory: path.join(tempDirectory, "output-tampered"),
          platform: "linux",
          matrix,
          registry: registryState.registry,
          expected,
          collector: collectorFor(registryState, expected, "linux", "a"),
          inputManifestPath,
        }),
      /bytes do not match|valid JSON/,
    );
  });
});

test("builder-owned wall/monotonic receipt enforces the real 1800-second run via test-only seam", async () => {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-p1-10-runtime-"),
  );
  const oldToken = process.env.P1_10_HARNESS_COORDINATOR_TOKEN;
  try {
    process.env.P1_10_HARNESS_COORDINATOR_TOKEN = "must-not-reach-child";
    const registryState = createRegistry();
    const harnessPath = path.join(tempDirectory, "physical-harness.bin");
    const attesterPath = path.join(tempDirectory, "local-attester.bin");
    fs.writeFileSync(harnessPath, "reviewed external harness bytes");
    fs.writeFileSync(
      attesterPath,
      "reviewed non-exportable local attester bytes",
    );
    const harnessDigest = sha256(fs.readFileSync(harnessPath));
    const attesterDigest = sha256(fs.readFileSync(attesterPath));
    for (const enrolledHost of registryState.registry.hosts.filter(
      (candidate) => candidate.platform === "linux",
    )) {
      enrolledHost.supervisorDigest = attesterDigest;
    }
    const expected = expectedFor(registryState.registry, {
      linux: harnessDigest,
      macos: "sha256:" + "2".repeat(64),
      windows: "sha256:" + "3".repeat(64),
    });
    const inputManifestPath = writeProtectedInputManifest(
      path.join(tempDirectory, "manifest"),
      expected,
      "linux",
    );
    const host = registryState.registry.hosts.find(
      (candidate) =>
        candidate.platform === "linux" && candidate.hostSlot === "a",
    );
    const output = path.join(tempDirectory, "raw");
    const executionReceiptPath = path.join(tempDirectory, "execution.json");
    const executionId = "builder_test_execution_" + "z".repeat(32);
    let childEnvironment;
    const wallTimes = [executionStartMs, executionStartMs + executionElapsedMs];
    await p110BuilderTestOnly.runPhysicalHarnessWithDependencies(
      {
        outputDirectory: output,
        executionReceiptPath,
        platform: "linux",
        matrix,
        expected,
        registry: registryState.registry,
        collector: collectorFor(registryState, expected, "linux", "a"),
        runnerTemp: tempDirectory,
        harnessPath,
        harnessDigest,
        attesterPath,
        attesterDigest,
        inputManifestPath,
      },
      {
        wallNow: () => wallTimes.shift(),
        executionId: () => executionId,
        assertAttesterProtected: () => {},
        runProcess: async (_executable, args, options) => {
          childEnvironment = options.env;
          assert.deepEqual(args.slice(0, 1), ["--request-base64"]);
          const envelope = JSON.parse(
            Buffer.from(args[1], "base64").toString("utf8"),
          );
          const { requestDigest, ...request } = envelope;
          assert.equal(request.executionId, executionId);
          const { executionReceipt } = writeHostReports(
            request.outputDirectory,
            registryState,
            expected,
            "linux",
            "a",
            { executionId, attesterRequestDigest: requestDigest },
          );
          fs.writeFileSync(
            request.executionReceiptPath,
            JSON.stringify(executionReceipt, null, 2) + "\n",
            { flag: "wx" },
          );
          return {
            monotonicElapsedMs: executionElapsedMs,
          };
        },
      },
    );
    const execution = JSON.parse(fs.readFileSync(executionReceiptPath, "utf8"));
    assert.equal(execution.monotonicElapsedMs, executionElapsedMs);
    assert.equal(execution.requiredMinimumMs, 1_800_000);
    assert.equal(execution.processTreeTerminated, true);
    assert.ok(
      fs.existsSync(
        path.join(
          output,
          externalRequirements()[0].evidenceScenario,
          "report.json",
        ),
      ),
    );
    assert.equal("P1_10_HARNESS_COORDINATOR_TOKEN" in childEnvironment, false);
    assert.equal(
      "P1_10_PHYSICAL_HOST_SIGNING_KEY_PATH" in childEnvironment,
      false,
    );
    assert.equal("GITHUB_TOKEN" in childEnvironment, false);

    const shortDirectory = path.join(tempDirectory, "short");
    const shortTimes = [
      executionStartMs,
      executionStartMs + executionElapsedMs,
    ];
    await assert.rejects(
      p110BuilderTestOnly.runPhysicalHarnessWithDependencies(
        {
          outputDirectory: shortDirectory,
          executionReceiptPath: path.join(
            tempDirectory,
            "short-execution.json",
          ),
          platform: "linux",
          matrix,
          expected,
          registry: registryState.registry,
          collector: collectorFor(registryState, expected, "linux", "a"),
          runnerTemp: tempDirectory,
          harnessPath,
          harnessDigest,
          attesterPath,
          attesterDigest,
          inputManifestPath,
        },
        {
          wallNow: () => shortTimes.shift(),
          executionId: () => "short_test_execution_" + "y".repeat(32),
          assertAttesterProtected: () => {},
          runProcess: async () => ({
            monotonicElapsedMs: 10,
          }),
        },
      ),
      /real monotonic and wall-clock minimum|did not cover/,
    );
  } finally {
    if (oldToken == null) delete process.env.P1_10_HARNESS_COORDINATOR_TOKEN;
    else process.env.P1_10_HARNESS_COORDINATOR_TOKEN = oldToken;
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("production CLI exposes no clock/process test override", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "scripts/p1-10-external-evidence-builder.mjs"),
      "run-harness",
      "--test-clock",
      "instant",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /arguments must contain exactly/);
});

test("GitHub token endpoints are constructed only from trusted API origins", () => {
  assert.equal(
    trustedGitHubApiBase("https://github.com", "https://api.github.com"),
    "https://api.github.com",
  );
  assert.equal(
    trustedGitHubApiBase(
      "https://github.corp.example",
      "https://github.corp.example/api/v3",
    ),
    "https://github.corp.example/api/v3",
  );
  for (const malicious of [
    "https://evil.example",
    "https://api.github.com/repos/attacker/repo",
    "https://api.github.com?next=https://evil.example",
  ]) {
    assert.throws(
      () => trustedGitHubApiBase("https://github.com", malicious),
      /exactly https:\/\/api\.github\.com|credential-free HTTPS/,
    );
  }
  for (const maliciousServer of [
    "https://github.com/attacker/path",
    "https://github.com?redirect=evil.example",
    "https://github.com#evil.example",
  ]) {
    assert.throws(
      () => trustedGitHubApiBase(maliciousServer, "https://api.github.com"),
      /credential-free HTTPS/,
    );
  }
});

test("GitHub jobs and artifacts pages use bounded chunked JSON reads", async () => {
  const expected = {
    repository: "chainlesschain/chainlesschain",
    commitSha: "a".repeat(40),
    workflow: P1_10_PRODUCER_WORKFLOW,
    runId: 123456,
    runAttempt: 2,
  };
  const requests = [];
  let legacyJsonCalls = 0;
  function streamedResponse(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const split = Math.max(1, Math.floor(bytes.byteLength / 2));
    const chunks = [bytes.slice(0, split), bytes.slice(split)];
    let index = 0;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader() {
          return {
            async read() {
              if (index >= chunks.length) return { done: true };
              return { done: false, value: chunks[index++] };
            },
            async cancel() {},
            releaseLock() {},
          };
        },
      },
      async json() {
        legacyJsonCalls += 1;
        throw new Error("response.json() must not be used");
      },
    };
  }
  const jobs = await p110BuilderTestOnly.fetchAuthoritativeJobs({
    token: "test-token",
    expected,
    serverUrl: "https://github.com",
    apiUrl: "https://api.github.com",
    fetchImpl: async (...request) => {
      requests.push(request);
      return streamedResponse({ total_count: 1, jobs: [{ id: 11 }] });
    },
  });
  const artifacts = await p110BuilderTestOnly.fetchAuthoritativeArtifacts({
    token: "test-token",
    expected,
    serverUrl: "https://github.com",
    apiUrl: "https://api.github.com",
    fetchImpl: async (...request) => {
      requests.push(request);
      return streamedResponse({
        total_count: 1,
        artifacts: [{ id: 22 }],
      });
    },
  });

  assert.equal(jobs.totalCount, 1);
  assert.equal(artifacts.totalCount, 1);
  assert.equal(legacyJsonCalls, 0);
  assert.equal(requests.length, 2);
  assert.equal(requests[0][1].redirect, "error");
  assert.equal(requests[0][1].signal.aborted, false);
  assert.equal(requests[1][1].signal.aborted, false);
  assert.match(
    requests[0][0].toString(),
    /\/actions\/runs\/123456\/attempts\/2\/jobs\?per_page=100&page=1$/u,
  );
  assert.match(
    requests[1][0].toString(),
    /\/actions\/runs\/123456\/artifacts\?per_page=100&page=1$/u,
  );
});

test("bounded GitHub page reads cancel immediately after the byte cap", async () => {
  let reads = 0;
  let canceled = false;
  const chunks = [new Uint8Array(12), new Uint8Array(5), new Uint8Array(20)];
  const response = {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    body: {
      getReader() {
        return {
          async read() {
            reads += 1;
            if (chunks.length === 0) return { done: true };
            return { done: false, value: chunks.shift() };
          },
          async cancel() {
            canceled = true;
          },
          releaseLock() {},
        };
      },
    },
  };

  await assert.rejects(
    p110BuilderTestOnly.readBoundedGithubApiJson(response, 16),
    /response size is invalid/u,
  );
  assert.equal(canceled, true);
  assert.equal(reads, 2);
  assert.equal(chunks.length, 1);

  let declaredOversizeCanceled = false;
  await assert.rejects(
    p110BuilderTestOnly.readBoundedGithubApiJson(
      {
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "application/json",
          "content-length": "17",
        }),
        body: {
          async cancel() {
            declaredOversizeCanceled = true;
          },
          getReader() {
            throw new Error("oversized declared bodies must not be read");
          },
        },
      },
      16,
    ),
    /response size is invalid/u,
  );
  assert.equal(declaredOversizeCanceled, true);
});

test("producer and close workflows freeze challenge, six slots, trust pins, and hosted attestation", () => {
  const producerWorkflow = fs.readFileSync(
    path.join(
      repoRoot,
      ".github/workflows/p1-10-external-evidence-producer.yml",
    ),
    "utf8",
  );
  const closeWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/p1-10-external-evidence-close.yml"),
    "utf8",
  );
  assert.equal(producerWorkflow.includes("challenge:\n"), false);
  assert.ok(producerWorkflow.includes("randomBytes(32).toString('base64url')"));
  assert.equal((producerWorkflow.match(/host_slot: [ab]/gu) || []).length, 6);
  assert.equal(producerWorkflow.includes("PHYSICAL_HOST_SIGNING_KEY"), false);
  for (const required of [
    "p1-10-host-a",
    "p1-10-host-b",
    "resolve-job",
    "collect-host",
    "p1-10-authoritative-jobs.json",
    "capture-jobs",
    "p1-10-challenge-${{ github.run_id }}-${{ github.run_attempt }}",
    "p1-10-external-evidence-${{ github.run_id }}-${{ github.run_attempt }}",
    "P1_10_LOCAL_ATTESTER_PATH",
    "P1_10_PROTECTED_INPUT_MANIFEST_PATH",
    "P1_10_LINUX_PROTECTED_INPUT_MANIFEST_SHA256",
    "P1_10_PHYSICAL_HOST_REGISTRY_SHA256",
    ".github/p1-10-physical-host-registry.json",
  ]) {
    assert.ok(
      producerWorkflow.includes(required) ||
        fs.existsSync(path.join(repoRoot, required)),
      required,
    );
  }
  assert.ok(closeWorkflow.includes("--deny-self-hosted-runners"));
  assert.ok(closeWorkflow.includes("--expected-linux-input-manifest-digest"));
  assert.ok(producerWorkflow.includes("capture-artifacts"));
  assert.equal(
    (
      producerWorkflow.match(
        /repos\/\$\{GITHUB_REPOSITORY\}\/branches\/main/gu,
      ) || []
    ).length,
    3,
  );
  assert.equal(
    (
      closeWorkflow.match(/repos\/\$\{GITHUB_REPOSITORY\}\/branches\/main/gu) ||
      []
    ).length,
    3,
  );
  assert.ok(
    producerWorkflow.includes(
      "Refuse publishing an attestation after main changes",
    ),
  );
  assert.ok(
    closeWorkflow.includes(
      "Refuse publishing a close receipt after main changes",
    ),
  );
  assert.ok(producerWorkflow.includes('branch_protected}" != "true"'));
  assert.ok(closeWorkflow.includes('branch_protected}" != "true"'));
  assert.ok(closeWorkflow.includes("artifact-ids:"));
  assert.ok(closeWorkflow.includes("--signer-digest"));
  assert.ok(
    closeWorkflow.includes("runInvocationURI") ||
      closeWorkflow.includes("p1-10-github-trust.mjs"),
  );
  assert.ok(closeWorkflow.includes("--expected-registry-digest"));
  assert.equal(closeWorkflow.includes("inputs.challenge"), false);
});

test("checked-in production registry contains no generated or placeholder enrollment", () => {
  const registry = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, ".github/p1-10-physical-host-registry.json"),
      "utf8",
    ),
  );
  assert.equal(registry.schema, P1_10_HOST_REGISTRY_SCHEMA);
  assert.deepEqual(registry.hosts, []);
  assert.match(physicalHostRegistryDigest(registry), /^sha256:[a-f0-9]{64}$/u);
});
