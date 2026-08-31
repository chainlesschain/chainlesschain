import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  deriveScenarioOverlapWindow,
  deriveScenarioMetrics,
  digestP110KillReceipt,
  digestP110ScenarioRecord,
  normalizeScenarioReceipt,
  P1_10_RECORD_CHAIN_GENESIS_DIGEST,
  P1_10_SCENARIO_CONTRACT,
  P1_10_SCENARIO_CONTRACT_DIGEST,
  P1_10_SCENARIO_RECEIPT_SCHEMAS,
} from "../p1-10-scenario-receipts.mjs";

const STARTED_MS = Date.parse("2026-08-24T00:00:00.000Z");
const PLATFORM = "linux";
const HOST_A = digest("physical-host-a");
const HOST_B = digest("physical-host-b");
const REGISTERED_HOST_IDS = new Set([HOST_A, HOST_B]);
const CHALLENGE = "protected_scenario_challenge_" + "c".repeat(32);
const INPUT_MANIFEST_DIGEST = digest("protected-scenario-input-manifest");

function digest(value) {
  return (
    "sha256:" + crypto.createHash("sha256").update(String(value)).digest("hex")
  );
}

function requirement(scenario) {
  const contract = P1_10_SCENARIO_CONTRACT.scenarios[scenario];
  return {
    evidenceScenario: scenario,
    requiredPlatforms: [...contract.requiredPlatforms],
    minimumDurationMs: contract.minimumDurationMs,
    minimumDistinctHosts: contract.minimumDistinctHosts,
    requiredMetrics: {
      positive: [...contract.requiredMetrics.positive],
      zero: [...contract.requiredMetrics.zero],
    },
  };
}

function scenarioInput(scenario) {
  const contract = P1_10_SCENARIO_CONTRACT.scenarios[scenario];
  const common = {
    scenario,
    interface: contract.interface,
    fixtureSetDigest: digest("fixture-set-" + scenario),
    workloadProfileDigest: digest("workload-profile-" + scenario),
  };
  if (scenario === "real-multi-host-causal-agent-stream") {
    return {
      ...common,
      payloadSetDigest: digest("causal-payload-set"),
      minimumMessagesPerHost: contract.minimumMessagesPerHost,
    };
  }
  if (scenario === "cross-version-graph-definition-migration") {
    return {
      ...common,
      sourceVersion: "runtime-v0",
      targetVersion: "runtime-v1",
      sourceRuntimeArtifactDigest: digest("source-runtime"),
      targetRuntimeArtifactDigest: digest("target-runtime"),
      packageDigest: digest("migration-package"),
      packageSignatureDigest: digest("migration-package-signature"),
      sourceStateDigest: digest("source-state"),
      expectedMigratedDigest: digest("target-state"),
    };
  }
  if (scenario === "packaged-electron-collaboration-crash-recovery") {
    return {
      ...common,
      packageDigest: digest("packaged-electron"),
      packageSignatureDigest: digest("packaged-electron-signature"),
      collaborationFixtureDigest: common.fixtureSetDigest,
      minimumRemoteUpdatesPerCrash: contract.minimumRemoteUpdatesPerCrash,
    };
  }
  if (scenario === "two-physical-host-mtc-roundtrip") {
    return {
      ...common,
      payloadSetDigest: digest("mtc-payload-set"),
      minimumRoundTripsPerHost: contract.minimumRoundTripsPerHost,
    };
  }
  return {
    ...common,
    operationProfileDigest: digest("soak-operation-profile"),
    minimumOperationsPerWindow: contract.minimumOperationsPerWindow,
  };
}

function chainRecords(events, input) {
  let chainTip = P1_10_RECORD_CHAIN_GENESIS_DIGEST;
  return events.map((event) => {
    const { offsetMs, ...body } = event;
    const record = {
      ...body,
      fixtureSetDigest: input.fixtureSetDigest,
      workloadProfileDigest: input.workloadProfileDigest,
      at: new Date(STARTED_MS + offsetMs).toISOString(),
      monotonicOffsetMs: offsetMs,
      previousRecordDigest: chainTip,
    };
    record.recordDigest = digestP110ScenarioRecord(record);
    chainTip = record.recordDigest;
    return record;
  });
}

function receiptFromEvents(scenario, hostIdDigest, slot, events) {
  const input = scenarioInput(scenario);
  const records = chainRecords(events, input);
  return receiptFromRecords(scenario, hostIdDigest, slot, records, input);
}

function receiptFromRecords(
  scenario,
  hostIdDigest,
  slot,
  records,
  input = scenarioInput(scenario),
) {
  const contract = P1_10_SCENARIO_CONTRACT.scenarios[scenario];
  return {
    schema: P1_10_SCENARIO_RECEIPT_SCHEMAS[scenario],
    contractDigest: P1_10_SCENARIO_CONTRACT_DIGEST,
    scenario,
    platform: PLATFORM,
    sourceHostIdDigest: hostIdDigest,
    executionId: "scenario_execution_" + slot + "_" + "x".repeat(32),
    challenge: CHALLENGE,
    inputManifestDigest: INPUT_MANIFEST_DIGEST,
    scenarioInput: input,
    attesterMeasurementDigest: digest("attester-" + slot),
    bootIdDigest: digest("boot-" + slot),
    supervisorDigest: digest("supervisor-" + slot),
    startedAt: new Date(STARTED_MS).toISOString(),
    endedAt: new Date(STARTED_MS + contract.minimumDurationMs).toISOString(),
    durationMs: contract.minimumDurationMs,
    recordCount: records.length,
    recordsDigest: records.at(-1).recordDigest,
    records,
  };
}

function chainState(scenario) {
  return {
    input: scenarioInput(scenario),
    chainTip: P1_10_RECORD_CHAIN_GENESIS_DIGEST,
    records: [],
  };
}

function appendRecord(state, event) {
  const { offsetMs, ...body } = event;
  const record = {
    ...body,
    fixtureSetDigest: state.input.fixtureSetDigest,
    workloadProfileDigest: state.input.workloadProfileDigest,
    at: new Date(STARTED_MS + offsetMs).toISOString(),
    monotonicOffsetMs: offsetMs,
    previousRecordDigest: state.chainTip,
  };
  record.recordDigest = digestP110ScenarioRecord(record);
  state.chainTip = record.recordDigest;
  state.records.push(record);
  return record;
}

function eventBodies(receipt) {
  return receipt.records.map((record) => {
    const body = structuredClone(record);
    const offsetMs = body.monotonicOffsetMs;
    delete body.at;
    delete body.monotonicOffsetMs;
    delete body.previousRecordDigest;
    delete body.recordDigest;
    return { ...body, offsetMs };
  });
}

function rechain(receipt, mutate) {
  const events = eventBodies(receipt);
  mutate(events);
  const records = chainRecords(events, receipt.scenarioInput);
  return {
    ...structuredClone(receipt),
    recordCount: records.length,
    recordsDigest: records.at(-1).recordDigest,
    records,
  };
}

function shiftReceiptWindow(receipt, deltaMs) {
  const shifted = structuredClone(receipt);
  shifted.startedAt = new Date(
    Date.parse(shifted.startedAt) + deltaMs,
  ).toISOString();
  shifted.endedAt = new Date(
    Date.parse(shifted.endedAt) + deltaMs,
  ).toISOString();
  let chainTip = P1_10_RECORD_CHAIN_GENESIS_DIGEST;
  for (const record of shifted.records) {
    record.at = new Date(Date.parse(record.at) + deltaMs).toISOString();
    record.previousRecordDigest = chainTip;
    record.recordDigest = digestP110ScenarioRecord(record);
    chainTip = record.recordDigest;
  }
  shifted.recordsDigest = chainTip;
  return shifted;
}

function normalize(receipt, overrides = {}) {
  const slot = receipt.sourceHostIdDigest === HOST_A ? "a" : "b";
  return normalizeScenarioReceipt(receipt, {
    requirement: requirement(receipt.scenario),
    platform: receipt.platform,
    sourceHostIdDigest: receipt.sourceHostIdDigest,
    executionId: "scenario_execution_" + slot + "_" + "x".repeat(32),
    registeredHostIds: REGISTERED_HOST_IDS,
    challenge: CHALLENGE,
    inputManifestDigest: INPUT_MANIFEST_DIGEST,
    scenarioInput: scenarioInput(receipt.scenario),
    attesterMeasurementDigest: digest("attester-" + slot),
    bootIdDigest: digest("boot-" + slot),
    supervisorDigest: digest("supervisor-" + slot),
    ...overrides,
  });
}

function causalReceipts() {
  const scenario = "real-multi-host-causal-agent-stream";
  const stateA = chainState(scenario);
  const stateB = chainState(scenario);
  const message = (
    messageId,
    senderSequence,
    fromHostIdDigest,
    toHostIdDigest,
    parent = null,
    parentReceive = null,
  ) => ({
    messageId,
    senderSequence,
    fromHostIdDigest,
    toHostIdDigest,
    payloadSetDigest: stateA.input.payloadSetDigest,
    payloadDigest: digest("payload-" + messageId),
    parentMessageId: parent?.messageId || null,
    parentSendRecordDigest: parent?.recordDigest || null,
    parentReceiveRecordDigest: parentReceive?.recordDigest || null,
    replyToMessageId: parent?.messageId || null,
    replyToSendRecordDigest: parent?.recordDigest || null,
  });
  const a1 = appendRecord(stateA, {
    type: "message-sent",
    offsetMs: 100,
    ...message("causal-a-1", 1, HOST_A, HOST_B),
  });
  const receiveA1 = appendRecord(stateB, {
    type: "message-received",
    offsetMs: 120,
    ...message("causal-a-1", 1, HOST_A, HOST_B),
    sentRecordDigest: a1.recordDigest,
  });
  const b1 = appendRecord(stateB, {
    type: "message-sent",
    offsetMs: 180,
    ...message("causal-b-1", 1, HOST_B, HOST_A, a1, receiveA1),
  });
  const receiveB1 = appendRecord(stateA, {
    type: "message-received",
    offsetMs: 220,
    ...message("causal-b-1", 1, HOST_B, HOST_A, a1, receiveA1),
    sentRecordDigest: b1.recordDigest,
  });
  const a2 = appendRecord(stateA, {
    type: "message-sent",
    offsetMs: 280,
    ...message("causal-a-2", 2, HOST_A, HOST_B, b1, receiveB1),
  });
  const receiveA2 = appendRecord(stateB, {
    type: "message-received",
    offsetMs: 320,
    ...message("causal-a-2", 2, HOST_A, HOST_B, b1, receiveB1),
    sentRecordDigest: a2.recordDigest,
  });
  const b2 = appendRecord(stateB, {
    type: "message-sent",
    offsetMs: 380,
    ...message("causal-b-2", 2, HOST_B, HOST_A, a2, receiveA2),
  });
  appendRecord(stateA, {
    type: "message-received",
    offsetMs: 420,
    ...message("causal-b-2", 2, HOST_B, HOST_A, a2, receiveA2),
    sentRecordDigest: b2.recordDigest,
  });
  return [
    receiptFromRecords(scenario, HOST_A, "a", stateA.records, stateA.input),
    receiptFromRecords(scenario, HOST_B, "b", stateB.records, stateB.input),
  ];
}

function mtcReceipts() {
  const scenario = "two-physical-host-mtc-roundtrip";
  const stateA = chainState(scenario);
  const stateB = chainState(scenario);
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
    const responseId = "response-" + roundTripId;
    const requestPayloadDigest = digest("request-payload-" + roundTripId);
    const responsePayloadDigest = digest("response-payload-" + roundTripId);
    const requestBase = {
      roundTripId,
      requestId,
      requestPayloadDigest,
      payloadSetDigest: stateA.input.payloadSetDigest,
      fromHostIdDigest: requesterHost,
      toHostIdDigest: responderHost,
    };
    const request = appendRecord(requester, {
      type: "roundtrip-request-sent",
      offsetMs: requestOffset,
      ...requestBase,
    });
    const requestReceived = appendRecord(responder, {
      type: "roundtrip-request-received",
      offsetMs: receiveOffset,
      ...requestBase,
      requestSendRecordDigest: request.recordDigest,
    });
    const responseBase = {
      roundTripId,
      requestId,
      requestPayloadDigest,
      payloadSetDigest: stateA.input.payloadSetDigest,
      fromHostIdDigest: responderHost,
      toHostIdDigest: requesterHost,
      responseId,
      responsePayloadDigest,
      replyToRequestId: requestId,
      replyToRequestSendRecordDigest: request.recordDigest,
      requestReceiveRecordDigest: requestReceived.recordDigest,
    };
    const response = appendRecord(responder, {
      type: "roundtrip-response-sent",
      offsetMs: responseOffset,
      ...responseBase,
    });
    appendRecord(requester, {
      type: "roundtrip-response-received",
      offsetMs: completeOffset,
      ...responseBase,
      responseSendRecordDigest: response.recordDigest,
    });
  };
  appendRoundTrip({
    roundTripId: "roundtrip-a",
    requester: stateA,
    responder: stateB,
    requesterHost: HOST_A,
    responderHost: HOST_B,
    requestOffset: 100,
    receiveOffset: 120,
    responseOffset: 180,
    completeOffset: 220,
  });
  appendRoundTrip({
    roundTripId: "roundtrip-b",
    requester: stateB,
    responder: stateA,
    requesterHost: HOST_B,
    responderHost: HOST_A,
    requestOffset: 300,
    receiveOffset: 320,
    responseOffset: 380,
    completeOffset: 420,
  });
  return [
    receiptFromRecords(scenario, HOST_A, "a", stateA.records, stateA.input),
    receiptFromRecords(scenario, HOST_B, "b", stateB.records, stateB.input),
  ];
}

function migrationEvents(slot) {
  const input = scenarioInput("cross-version-graph-definition-migration");
  const bindings = {
    caseId: "migration-case-" + slot,
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
  return [
    {
      type: "migration-case",
      offsetMs: 100,
      ...bindings,
      expectedDigest: bindings.migratedDigest,
    },
    {
      type: "rollback-case",
      offsetMs: 200,
      ...bindings,
      restoredDigest: bindings.sourceStateDigest,
    },
  ];
}

function crashReceipts() {
  const scenario = "packaged-electron-collaboration-crash-recovery";
  const stateA = chainState(scenario);
  const stateB = chainState(scenario);
  const transport = (
    targetCrashId,
    deliveryId,
    updateId,
    originHostIdDigest,
    targetHostIdDigest,
    originPeerId,
    targetPeerId,
  ) => ({
    targetCrashId,
    deliveryId,
    updateId,
    updateDigest: digest("remote-" + deliveryId),
    packageDigest: stateA.input.packageDigest,
    packageSignatureDigest: stateA.input.packageSignatureDigest,
    collaborationFixtureDigest: stateA.input.collaborationFixtureDigest,
    sessionId: "collaboration-session-shared",
    documentId: "collaboration-document-shared",
    originPeerId,
    targetPeerId,
    originHostIdDigest,
    targetHostIdDigest,
  });
  const transportAtoB = transport(
    "crash-b",
    "delivery-a-to-b",
    "update-a-to-b",
    HOST_A,
    HOST_B,
    "peer-a",
    "peer-b",
  );
  const transportBtoA = transport(
    "crash-a",
    "delivery-b-to-a",
    "update-b-to-a",
    HOST_B,
    HOST_A,
    "peer-b",
    "peer-a",
  );
  const originA = appendRecord(stateA, {
    type: "remote-update-originated",
    offsetMs: 50,
    ...transportAtoB,
  });
  const originB = appendRecord(stateB, {
    type: "remote-update-originated",
    offsetMs: 50,
    ...transportBtoA,
  });
  const receivedA = appendRecord(stateA, {
    type: "remote-update-received",
    offsetMs: 100,
    ...transportBtoA,
    originRecordDigest: originB.recordDigest,
  });
  const receivedB = appendRecord(stateB, {
    type: "remote-update-received",
    offsetMs: 100,
    ...transportAtoB,
    originRecordDigest: originA.recordDigest,
  });
  const appendLifecycle = (state, slot, received) => {
    const pid = slot === "a" ? 31001 : 31002;
    const processInstanceId = "electron-process-" + slot;
    const commitPreDigest = digest("commit-pre-" + slot);
    const commitPostDigest = digest("commit-post-" + slot);
    const collaboration = {
      crashId: received.targetCrashId,
      packageDigest: received.packageDigest,
      packageSignatureDigest: received.packageSignatureDigest,
      collaborationFixtureDigest: received.collaborationFixtureDigest,
      sessionId: received.sessionId,
      documentId: received.documentId,
      localPeerId: received.targetPeerId,
      remotePeerId: received.originPeerId,
      localHostIdDigest: received.targetHostIdDigest,
      remoteHostIdDigest: received.originHostIdDigest,
    };
    const committed = appendRecord(state, {
      type: "committed-update",
      offsetMs: 200,
      ...collaboration,
      processInstanceId,
      pid,
      deliveryId: received.deliveryId,
      updateId: received.updateId,
      updateDigest: received.updateDigest,
      receivedRecordDigest: received.recordDigest,
      commitPreDigest,
      commitPostDigest,
      storePreDigest: commitPreDigest,
      storePostDigest: commitPostDigest,
    });
    const killReceipt = {
      schema: P1_10_SCENARIO_CONTRACT.scenarios[scenario].killReceiptSchema,
      crashId: received.targetCrashId,
      executionId: "scenario_execution_" + slot + "_" + "x".repeat(32),
      challenge: CHALLENGE,
      bootIdDigest: digest("boot-" + slot),
      attesterMeasurementDigest: digest("attester-" + slot),
      supervisorDigest: digest("supervisor-" + slot),
      packageDigest: received.packageDigest,
      processInstanceId,
      pid,
      supervisorInstanceId: "process-supervisor-" + slot,
      terminationMethod: "signal",
      requestedMonotonicOffsetMs: 250,
      observedMonotonicOffsetMs: 300,
      exitCode: null,
      signal: "SIGKILL",
    };
    const crash = appendRecord(state, {
      type: "process-crash",
      offsetMs: 300,
      ...collaboration,
      processInstanceId,
      pid,
      lastCommittedRecordDigest: committed.recordDigest,
      terminationMethod: "signal",
      exitCode: null,
      signal: "SIGKILL",
      killReceipt,
      killReceiptDigest: digestP110KillReceipt(killReceipt),
    });
    appendRecord(state, {
      type: "recovered-update",
      offsetMs: 400,
      ...collaboration,
      crashedProcessInstanceId: processInstanceId,
      crashedPid: pid,
      recoveryProcessInstanceId: "electron-recovery-" + slot,
      recoveryPid: pid + 100,
      deliveryId: received.deliveryId,
      updateId: received.updateId,
      updateDigest: received.updateDigest,
      commitRecordDigest: committed.recordDigest,
      crashRecordDigest: crash.recordDigest,
      recoveryPreDigest: commitPreDigest,
      recoveryPostDigest: commitPostDigest,
    });
  };
  appendLifecycle(stateA, "a", receivedA);
  appendLifecycle(stateB, "b", receivedB);
  return [
    receiptFromRecords(scenario, HOST_A, "a", stateA.records, stateA.input),
    receiptFromRecords(scenario, HOST_B, "b", stateB.records, stateB.input),
  ];
}

function soakEvents(slot) {
  const contract =
    P1_10_SCENARIO_CONTRACT.scenarios["long-running-desktop-soak"];
  const input = scenarioInput("long-running-desktop-soak");
  const events = [];
  for (
    let offsetMs = contract.warmupMs;
    offsetMs <= contract.minimumDurationMs;
    offsetMs += contract.maxSampleGapMs
  ) {
    events.push({
      type: "runtime-sample",
      offsetMs,
      sampleId: "sample-" + slot + "-" + offsetMs,
      operationProfileDigest: input.operationProfileDigest,
      backlogSize: 10,
      listenerCount: 5,
      timerCount: 2,
      unsettledTasks: 0,
    });
    if (offsetMs + contract.maxSampleGapMs <= contract.minimumDurationMs) {
      events.push({
        type: "operation-completed",
        offsetMs: offsetMs + Math.floor(contract.maxSampleGapMs / 2),
        operationId: "operation-" + slot + "-" + offsetMs,
        operationProfileDigest: input.operationProfileDigest,
      });
    }
  }
  return events.sort((left, right) => left.offsetMs - right.offsetMs);
}

function happyReceipts(scenario) {
  if (scenario === "real-multi-host-causal-agent-stream") {
    return causalReceipts();
  }
  if (scenario === "two-physical-host-mtc-roundtrip") {
    return mtcReceipts();
  }
  if (scenario === "cross-version-graph-definition-migration") {
    return [receiptFromEvents(scenario, HOST_A, "a", migrationEvents("a"))];
  }
  if (scenario === "packaged-electron-collaboration-crash-recovery") {
    return crashReceipts();
  }
  return [receiptFromEvents(scenario, HOST_A, "a", soakEvents("a"))];
}

test("fixed contract and happy receipts derive every metric from authenticated events", () => {
  assert.match(P1_10_SCENARIO_CONTRACT_DIGEST, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(P1_10_SCENARIO_CONTRACT));
  assert.ok(Object.isFrozen(P1_10_SCENARIO_CONTRACT.scenarios));

  for (const scenario of Object.keys(P1_10_SCENARIO_CONTRACT.scenarios)) {
    const receipts = happyReceipts(scenario).map(normalize);
    const metrics = deriveScenarioMetrics(requirement(scenario), receipts);
    for (const name of requirement(scenario).requiredMetrics.positive) {
      assert.ok(metrics[name] > 0, scenario + ":" + name);
    }
    for (const name of requirement(scenario).requiredMetrics.zero) {
      assert.equal(metrics[name], 0, scenario + ":" + name);
    }
  }
});

test("migration rollback binds exact artifacts and rejects a fake digest plus true claim", () => {
  const scenario = "cross-version-graph-definition-migration";
  const original = happyReceipts(scenario)[0];
  const fakeDigest = digest("fake-restored-state");

  const booleanClaim = rechain(original, (events) => {
    events[1].restoredDigest = fakeDigest;
    events[1].rollbackSucceeded = true;
  });
  assert.throws(
    () => normalize(booleanClaim),
    /must contain exactly|rollbackSucceeded/i,
  );

  const fakeRestoration = normalize(
    rechain(original, (events) => {
      events[1].restoredDigest = fakeDigest;
    }),
  );
  assert.throws(
    () => deriveScenarioMetrics(requirement(scenario), [fakeRestoration]),
    /rollbackFailures must be zero/i,
  );

  assert.throws(
    () =>
      normalize(
        rechain(original, (events) => {
          events[1].packageDigest = digest("unbound-package");
        }),
      ),
    /protected migration artifacts and states/i,
  );
});

test("packaged Electron recovery rejects normal exits and unbound process instances", () => {
  const scenario = "packaged-electron-collaboration-crash-recovery";
  const [original, peer] = happyReceipts(scenario);

  const normalExit = rechain(original, (events) => {
    const crash = events.find((event) => event.type === "process-crash");
    crash.terminationMethod = "terminate-process";
    crash.exitCode = 0;
    crash.signal = null;
    crash.killReceipt.terminationMethod = "terminate-process";
    crash.killReceipt.exitCode = 0;
    crash.killReceipt.signal = null;
    crash.killReceiptDigest = digestP110KillReceipt(crash.killReceipt);
  });
  assert.throws(
    () => normalize(normalExit),
    /platform-fixed forced abnormal exit/i,
  );

  const missingKillReceipt = rechain(original, (events) => {
    delete events.find((event) => event.type === "process-crash")
      .killReceiptDigest;
  });
  assert.throws(() => normalize(missingKillReceipt), /must contain exactly/i);

  const wrongProcess = normalize(
    rechain(original, (events) => {
      const crash = events.find((event) => event.type === "process-crash");
      crash.processInstanceId = "different-process-instance";
      crash.killReceipt.processInstanceId = "different-process-instance";
      crash.killReceiptDigest = digestP110KillReceipt(crash.killReceipt);
    }),
  );
  assert.throws(
    () =>
      deriveScenarioMetrics(requirement(scenario), [
        wrongProcess,
        normalize(peer),
      ]),
    /exact packaged process crash/i,
  );
});

test("soak baseline comes only from the protected first post-warmup sample", () => {
  const scenario = "long-running-desktop-soak";
  const original = happyReceipts(scenario)[0];

  const synchronizedLift = rechain(original, (events) => {
    const samples = events.filter((event) => event.type === "runtime-sample");
    samples[1].listenerCount = 6;
    samples[1].listenerBaseline = 6;
    samples[1].timerCount = 3;
    samples[1].timerBaseline = 3;
    samples[1].backlogLimit = 1_000_000;
  });
  assert.throws(() => normalize(synchronizedLift), /must contain exactly/i);

  const listenerGrowth = normalize(
    rechain(original, (events) => {
      events.find(
        (event) =>
          event.type === "runtime-sample" &&
          event.offsetMs > P1_10_SCENARIO_CONTRACT.scenarios[scenario].warmupMs,
      ).listenerCount = 6;
    }),
  );
  assert.throws(
    () => deriveScenarioMetrics(requirement(scenario), [listenerGrowth]),
    /leakedListeners must be zero/i,
  );
});

test("record hash, append-only chain, and monotonic timestamp tampering fail closed", () => {
  const original = happyReceipts("long-running-desktop-soak")[0];

  const hashTamper = structuredClone(original);
  hashTamper.records.find(
    (record) => record.type === "runtime-sample",
  ).backlogSize += 1;
  assert.throws(() => normalize(hashTamper), /digest does not authenticate/i);

  const chainTamper = structuredClone(original);
  chainTamper.records[1].previousRecordDigest = digest(
    "forged-previous-record",
  );
  chainTamper.records[1].recordDigest = digestP110ScenarioRecord(
    chainTamper.records[1],
  );
  assert.throws(() => normalize(chainTamper), /not append-only/i);

  const monotonicTamper = structuredClone(original);
  monotonicTamper.records[0].monotonicOffsetMs += 1;
  let chainTip = P1_10_RECORD_CHAIN_GENESIS_DIGEST;
  for (const record of monotonicTamper.records) {
    record.previousRecordDigest = chainTip;
    record.recordDigest = digestP110ScenarioRecord(record);
    chainTip = record.recordDigest;
  }
  monotonicTamper.recordsDigest = chainTip;
  assert.throws(
    () => normalize(monotonicTamper),
    /startedAt plus monotonicOffsetMs/i,
  );
});

test("causal and MTC reducers require complete local evidence from every host", () => {
  for (const scenario of [
    "real-multi-host-causal-agent-stream",
    "two-physical-host-mtc-roundtrip",
  ]) {
    const [first, second] = happyReceipts(scenario);
    const incompleteSecond = normalize(
      rechain(second, (events) => {
        events.splice(0, 1);
      }),
    );
    assert.throws(
      () =>
        deriveScenarioMetrics(requirement(scenario), [
          normalize(first),
          incompleteSecond,
        ]),
      /each physical host must authenticate a local|exactly authenticate|orphan roundtrip/i,
    );
  }
});

test("derive accepts only in-process normalized receipts bound to protected inputs", () => {
  const scenario = "cross-version-graph-definition-migration";
  const raw = happyReceipts(scenario)[0];
  const normalized = normalize(raw);
  assert.throws(
    () =>
      deriveScenarioMetrics(requirement(scenario), [
        structuredClone(normalized),
      ]),
    /in-process normalized object/i,
  );

  const wrongChallenge = structuredClone(raw);
  wrongChallenge.challenge = "forged_challenge_" + "z".repeat(32);
  assert.throws(() => normalize(wrongChallenge), /protected challenge/i);

  const wrongInput = structuredClone(raw);
  wrongInput.scenarioInput.workloadProfileDigest = digest("forged-workload");
  assert.throws(() => normalize(wrongInput), /protected challenge\/input/i);

  const wrongBoot = structuredClone(raw);
  wrongBoot.bootIdDigest = digest("forged-boot");
  assert.throws(() => normalize(wrongBoot), /attester\/boot\/supervisor/i);
});

test("common-overlap scoring rejects individually valid but non-overlapping host windows", () => {
  const scenario = "real-multi-host-causal-agent-stream";
  const [first, second] = happyReceipts(scenario);
  const normalized = [normalize(first), normalize(second)];
  assert.deepEqual(
    deriveScenarioOverlapWindow(requirement(scenario), normalized),
    {
      startedAt: first.startedAt,
      endedAt: first.endedAt,
      durationMs: P1_10_SCENARIO_CONTRACT.scenarios[scenario].minimumDurationMs,
    },
  );
  const shifted = normalize(shiftReceiptWindow(second, 1));
  assert.throws(
    () =>
      deriveScenarioMetrics(requirement(scenario), [normalize(first), shifted]),
    /minimum overlap/i,
  );
});

test("overlap validation snapshots the normalized receipt array exactly once", () => {
  const scenario = "real-multi-host-causal-agent-stream";
  const normalized = happyReceipts(scenario).map(normalize);
  const indexReads = new Map();
  const switchingReceipts = new Proxy(normalized, {
    get(target, property, receiver) {
      if (property === "0" || property === "1") {
        const reads = (indexReads.get(property) || 0) + 1;
        indexReads.set(property, reads);
        return reads === 1
          ? target[Number(property)]
          : structuredClone(target[Number(property)]);
      }
      return Reflect.get(target, property, receiver);
    },
  });

  assert.equal(
    deriveScenarioMetrics(requirement(scenario), switchingReceipts)
      .lostMessages,
    0,
  );
  assert.equal(indexReads.get("0"), 1);
  assert.equal(indexReads.get("1"), 1);
});

test("causal non-root sends bind the exact earlier local parent receive", () => {
  const scenario = "real-multi-host-causal-agent-stream";
  const [causalA, causalB] = happyReceipts(scenario);

  assert.throws(
    () =>
      normalize(
        rechain(causalB, (events) => {
          delete events.find(
            (event) =>
              event.type === "message-sent" && event.senderSequence === 2,
          ).parentReceiveRecordDigest;
        }),
      ),
    /must contain exactly/i,
  );

  const forgedParentReceiveDigest = digest("forged-parent-receive");
  const wrongParentB = rechain(causalB, (events) => {
    events.find(
      (event) => event.type === "message-sent" && event.senderSequence === 2,
    ).parentReceiveRecordDigest = forgedParentReceiveDigest;
  });
  const forgedB2SendDigest = wrongParentB.records.find(
    (record) => record.type === "message-sent" && record.senderSequence === 2,
  ).recordDigest;
  const wrongParentA = rechain(causalA, (events) => {
    const received = events.find(
      (event) =>
        event.type === "message-received" && event.messageId === "causal-b-2",
    );
    received.parentReceiveRecordDigest = forgedParentReceiveDigest;
    received.sentRecordDigest = forgedB2SendDigest;
  });
  assert.throws(
    () =>
      deriveScenarioMetrics(requirement(scenario), [
        normalize(wrongParentA),
        normalize(wrongParentB),
      ]),
    /reverse-route parent\/reply-to dependency/i,
  );

  assert.throws(
    () =>
      normalize(
        rechain(causalB, (events) => {
          const parentReceive = events.find(
            (event) =>
              event.type === "message-received" &&
              event.messageId === "causal-a-2",
          );
          events.find(
            (event) =>
              event.type === "message-sent" && event.senderSequence === 2,
          ).offsetMs = parentReceive.offsetMs - 1;
        }),
      ),
    /strictly increasing/i,
  );
});

test("causal sender workload and MTC per-host bidirectional roundtrips cannot be weakened", () => {
  const causalScenario = "real-multi-host-causal-agent-stream";
  const [causalA, causalB] = happyReceipts(causalScenario);
  const discontinuous = normalize(
    rechain(causalA, (events) => {
      events.find(
        (event) => event.type === "message-sent" && event.senderSequence === 2,
      ).senderSequence = 3;
    }),
  );
  assert.throws(
    () =>
      deriveScenarioMetrics(requirement(causalScenario), [
        discontinuous,
        normalize(causalB),
      ]),
    /continuous logical sequence/i,
  );

  const mtcScenario = "two-physical-host-mtc-roundtrip";
  const [mtcA, mtcB] = happyReceipts(mtcScenario);
  const withoutBInitiation = [mtcA, mtcB].map((receipt) =>
    normalize(
      rechain(receipt, (events) => {
        for (let index = events.length - 1; index >= 0; index -= 1) {
          if (events[index].roundTripId === "roundtrip-b") {
            events.splice(index, 1);
          }
        }
      }),
    ),
  );
  assert.throws(
    () => deriveScenarioMetrics(requirement(mtcScenario), withoutBInitiation),
    /each physical host must authenticate|minimum MTC roundtrip workload/i,
  );

  assert.throws(
    () =>
      normalize(
        rechain(mtcA, (events) => {
          const request = events.find(
            (event) =>
              event.type === "roundtrip-request-sent" &&
              event.roundTripId === "roundtrip-a",
          );
          events.find(
            (event) =>
              event.type === "roundtrip-response-received" &&
              event.roundTripId === "roundtrip-a",
          ).offsetMs = request.offsetMs - 1;
        }),
      ),
    /strictly increasing/i,
  );
  assert.throws(
    () =>
      normalize(
        rechain(mtcB, (events) => {
          const requestReceived = events.find(
            (event) =>
              event.type === "roundtrip-request-received" &&
              event.roundTripId === "roundtrip-a",
          );
          events.find(
            (event) =>
              event.type === "roundtrip-response-sent" &&
              event.roundTripId === "roundtrip-a",
          ).offsetMs = requestReceived.offsetMs - 1;
        }),
      ),
    /strictly increasing/i,
  );
});

test("crash recovery binds protected kill identity, unique crash/process, and peer receipts", () => {
  const scenario = "packaged-electron-collaboration-crash-recovery";
  const [first, second] = happyReceipts(scenario);
  const forgedKill = rechain(first, (events) => {
    const crash = events.find((event) => event.type === "process-crash");
    crash.killReceipt.challenge = "forged_kill_challenge_" + "k".repeat(32);
    crash.killReceiptDigest = digestP110KillReceipt(crash.killReceipt);
  });
  assert.throws(() => normalize(forgedKill), /supervisor request|challenge/i);

  const orphanOrigin = normalize(
    rechain(first, (events) => {
      const extra = structuredClone(
        events.find((event) => event.type === "remote-update-originated"),
      );
      extra.offsetMs = 75;
      extra.targetCrashId = "crash-orphan";
      extra.deliveryId = "delivery-orphan";
      extra.updateId = "update-orphan";
      extra.updateDigest = digest("orphan-update");
      events.splice(1, 0, extra);
    }),
  );
  assert.throws(
    () =>
      deriveScenarioMetrics(requirement(scenario), [
        orphanOrigin,
        normalize(second),
      ]),
    /exactly one target delivery/i,
  );

  const reusedCrash = normalize(
    rechain(second, (events) => {
      const crash = events.find((event) => event.type === "process-crash");
      crash.crashId = "crash-a";
      crash.processInstanceId = "electron-process-a";
      crash.pid = 31001;
      crash.killReceipt.crashId = "crash-a";
      crash.killReceipt.processInstanceId = "electron-process-a";
      crash.killReceipt.pid = 31001;
      crash.killReceiptDigest = digestP110KillReceipt(crash.killReceipt);
    }),
  );
  assert.throws(
    () =>
      deriveScenarioMetrics(requirement(scenario), [
        normalize(first),
        reusedCrash,
      ]),
    /duplicate authenticated records/i,
  );

  const detachedPeer = normalize(
    rechain(second, (events) => {
      for (const event of events) event.sessionId = "detached-session";
    }),
  );
  assert.throws(
    () =>
      deriveScenarioMetrics(requirement(scenario), [
        normalize(first),
        detachedPeer,
      ]),
    /cross-host origin/i,
  );

  const independentlyClaimedUpdate = normalize(
    rechain(second, (events) => {
      const received = events.find(
        (event) => event.type === "remote-update-received",
      );
      received.updateId = "unrelated-self-reported-update";
      received.updateDigest = digest("unrelated-self-reported-update");
    }),
  );
  assert.throws(
    () =>
      deriveScenarioMetrics(requirement(scenario), [
        normalize(first),
        independentlyClaimedUpdate,
      ]),
    /cross-host origin/i,
  );

  const renamedRecoveredUpdate = normalize(
    rechain(first, (events) => {
      events.find((event) => event.type === "recovered-update").updateId =
        "recovered-update-alias";
    }),
  );
  assert.throws(
    () =>
      deriveScenarioMetrics(requirement(scenario), [
        renamedRecoveredUpdate,
        normalize(second),
      ]),
    /exact pre-crash durable state/i,
  );

  const windowsReceipts = [first, second].map((receipt) => {
    let windows = rechain(receipt, (events) => {
      const crash = events.find((event) => event.type === "process-crash");
      crash.terminationMethod = "terminate-process";
      crash.exitCode = 137;
      crash.signal = null;
      crash.killReceipt.terminationMethod = "terminate-process";
      crash.killReceipt.exitCode = 137;
      crash.killReceipt.signal = null;
      crash.killReceiptDigest = digestP110KillReceipt(crash.killReceipt);
    });
    const crashRecordDigest = windows.records.find(
      (record) => record.type === "process-crash",
    ).recordDigest;
    windows = rechain(windows, (events) => {
      events.find(
        (event) => event.type === "recovered-update",
      ).crashRecordDigest = crashRecordDigest;
    });
    windows.platform = "windows";
    return normalize(windows);
  });
  assert.equal(
    deriveScenarioMetrics(requirement(scenario), windowsReceipts).crashCount,
    2,
  );
});

test("soak requires an operation in every post-baseline cadence bucket", () => {
  const scenario = "long-running-desktop-soak";
  const raw = happyReceipts(scenario)[0];
  const singleOperation = normalize(
    rechain(raw, (events) => {
      let retained = false;
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].type === "operation-completed") {
          if (!retained) retained = true;
          else events.splice(index, 1);
        }
      }
    }),
  );
  assert.throws(
    () => deriveScenarioMetrics(requirement(scenario), [singleOperation]),
    /every post-baseline soak cadence interval/i,
  );
});

test("matrix threshold and metric weakening cannot override the protected contract", () => {
  const scenario = "long-running-desktop-soak";
  const weakened = requirement(scenario);
  weakened.minimumDurationMs -= 1;
  weakened.requiredMetrics.zero = ["unsettledTasks"];
  assert.throws(
    () =>
      deriveScenarioMetrics(weakened, happyReceipts(scenario).map(normalize)),
    /protected scenario contract|matrix thresholds/i,
  );
});
