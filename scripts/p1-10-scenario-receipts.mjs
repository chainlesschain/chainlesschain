import crypto from "node:crypto";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const EXECUTION_ID = /^[A-Za-z0-9_-]{32,128}$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{32,128}$/u;
const PLATFORMS = new Set(["linux", "macos", "windows"]);
const MAX_RECORDS = 100_000;
const RECORD_CHAIN_DOMAIN = "chainlesschain.p1-10-receipt.record-chain/v1";
const CONTRACT_DIGEST_DOMAIN = "chainlesschain.p1-10-receipt.contract/v1";
const KILL_RECEIPT_DOMAIN =
  "chainlesschain.p1-10-receipt.forced-termination/v2";
const NORMALIZED_SCENARIO_RECEIPTS = new WeakSet();

export const P1_10_SCENARIO_RECEIPT_SCHEMAS = Object.freeze({
  "real-multi-host-causal-agent-stream":
    "chainlesschain.p1-10-receipt.causal-agent-stream/v3",
  "cross-version-graph-definition-migration":
    "chainlesschain.p1-10-receipt.graph-migration/v3",
  "packaged-electron-collaboration-crash-recovery":
    "chainlesschain.p1-10-receipt.collaboration-crash-recovery/v3",
  "two-physical-host-mtc-roundtrip":
    "chainlesschain.p1-10-receipt.mtc-roundtrip/v3",
  "long-running-desktop-soak": "chainlesschain.p1-10-receipt.desktop-soak/v3",
});

function fail(message, field = "") {
  const error = new Error(message);
  error.name = "P110ScenarioReceiptError";
  error.code = "CC_P1_10_SCENARIO_RECEIPT_INVALID";
  if (field) error.field = field;
  throw error;
}

function canonicalJson(value, field = "value") {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail(field + " contains a non-canonical number", field);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return (
      "[" +
      value
        .map((entry, index) => canonicalJson(entry, field + "[" + index + "]"))
        .join(",") +
      "]"
    );
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(field + " must contain only plain JSON objects", field);
    }
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            canonicalJson(value[key], field + "." + key),
        )
        .join(",") +
      "}"
    );
  }
  fail(field + " must contain only canonical JSON values", field);
}

function sha256(value) {
  return "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
}

function domainDigest(domain, value) {
  return sha256(Buffer.from(domain + "\0" + canonicalJson(value), "utf8"));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const P1_10_RECORD_CHAIN_GENESIS_DIGEST = sha256(
  Buffer.from(RECORD_CHAIN_DOMAIN + "\0genesis", "utf8"),
);

export const P1_10_SCENARIO_CONTRACT = deepFreeze({
  schema: "chainlesschain.p1-10-scenario-contract/v2",
  recordChain: {
    schema: "chainlesschain.p1-10-receipt.record-chain/v1",
    digestAlgorithm: "sha256",
    domain: RECORD_CHAIN_DOMAIN,
    genesisDigest: P1_10_RECORD_CHAIN_GENESIS_DIGEST,
    offsetUnit: "milliseconds",
    timestampBinding: "startedAt-plus-monotonicOffsetMs",
  },
  scenarios: {
    "real-multi-host-causal-agent-stream": {
      receiptSchema:
        P1_10_SCENARIO_RECEIPT_SCHEMAS["real-multi-host-causal-agent-stream"],
      minimumDurationMs: 60_000,
      minimumDistinctHosts: 2,
      interface: "agent-stream causal ordering",
      minimumMessagesPerHost: 2,
      requiredPlatforms: ["linux", "macos", "windows"],
      requiredLocalEventTypes: ["message-sent", "message-received"],
      requiredMetrics: {
        positive: ["messagesReceived", "messagesSent"],
        zero: ["causalOrderViolations", "lostMessages"],
      },
    },
    "cross-version-graph-definition-migration": {
      receiptSchema:
        P1_10_SCENARIO_RECEIPT_SCHEMAS[
          "cross-version-graph-definition-migration"
        ],
      minimumDurationMs: 1_000,
      minimumDistinctHosts: 1,
      interface: "old adapter to graph kernel definition migration",
      requiredPlatforms: ["linux", "macos", "windows"],
      requiredLocalEventTypes: ["migration-case", "rollback-case"],
      requiredMetrics: {
        positive: ["migrationCases", "rollbackCases"],
        zero: ["digestMismatches", "rollbackFailures"],
      },
    },
    "packaged-electron-collaboration-crash-recovery": {
      receiptSchema:
        P1_10_SCENARIO_RECEIPT_SCHEMAS[
          "packaged-electron-collaboration-crash-recovery"
        ],
      minimumDurationMs: 1_000,
      minimumDistinctHosts: 2,
      interface: "durable collaboration update recovery",
      minimumRemoteUpdatesPerCrash: 1,
      requiredPlatforms: ["linux", "macos", "windows"],
      requiredLocalEventTypes: [
        "remote-update-originated",
        "remote-update-received",
        "committed-update",
        "process-crash",
        "recovered-update",
      ],
      killReceiptSchema: "chainlesschain.p1-10-receipt.forced-termination/v2",
      forcedTerminationByPlatform: {
        linux: {
          terminationMethod: "signal",
          exitCode: null,
          signal: "SIGKILL",
        },
        macos: {
          terminationMethod: "signal",
          exitCode: null,
          signal: "SIGKILL",
        },
        windows: {
          terminationMethod: "terminate-process",
          exitCode: 137,
          signal: null,
        },
      },
      requiredMetrics: {
        positive: ["crashCount", "recoveredUpdates"],
        zero: ["duplicateRecoveredUpdates", "lostCommittedUpdates"],
      },
    },
    "two-physical-host-mtc-roundtrip": {
      receiptSchema:
        P1_10_SCENARIO_RECEIPT_SCHEMAS["two-physical-host-mtc-roundtrip"],
      minimumDurationMs: 60_000,
      minimumDistinctHosts: 2,
      interface: "MTC gossipsub roundtrip",
      minimumRoundTripsPerHost: 1,
      requiredPlatforms: ["linux", "macos", "windows"],
      requiredLocalEventTypes: [
        "roundtrip-request-sent",
        "roundtrip-request-received",
        "roundtrip-response-sent",
        "roundtrip-response-received",
      ],
      requiredMetrics: {
        positive: ["messagesDelivered", "messagesSent"],
        zero: ["duplicateEffects", "lostMessages"],
      },
    },
    "long-running-desktop-soak": {
      receiptSchema:
        P1_10_SCENARIO_RECEIPT_SCHEMAS["long-running-desktop-soak"],
      minimumDurationMs: 1_800_000,
      minimumDistinctHosts: 1,
      interface: "bounded backlog and lifecycle stability",
      minimumOperationsPerWindow: 1,
      requiredPlatforms: ["linux", "macos", "windows"],
      requiredLocalEventTypes: ["runtime-sample", "operation-completed"],
      warmupMs: 120_000,
      maxSampleGapMs: 60_000,
      backlogLimit: 100,
      maxListenerGrowth: 0,
      maxTimerGrowth: 0,
      maxUnsettledTasks: 0,
      requiredMetrics: {
        positive: ["completedOperations", "samples"],
        zero: [
          "backlogLimitViolations",
          "leakedListeners",
          "leakedTimers",
          "unsettledTasks",
        ],
      },
    },
  },
});

export const P1_10_SCENARIO_CONTRACT_DIGEST = domainDigest(
  CONTRACT_DIGEST_DOMAIN,
  P1_10_SCENARIO_CONTRACT,
);

export const P1_10_SOAK_MAX_SAMPLE_GAP_MS =
  P1_10_SCENARIO_CONTRACT.scenarios["long-running-desktop-soak"].maxSampleGapMs;

export function digestP110ScenarioRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    fail("record must be an object", "record");
  }
  const payload = { ...record };
  delete payload.recordDigest;
  return domainDigest(RECORD_CHAIN_DOMAIN, payload);
}

export function digestP110KillReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("killReceipt must be an object", "killReceipt");
  }
  return domainDigest(KILL_RECEIPT_DOMAIN, receipt);
}

function exactKeys(value, keys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(field + " must be an object", field);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(field + " must contain exactly: " + expected.join(", "), field);
  }
}

function recordKeys(...specificKeys) {
  return [
    "type",
    "at",
    "monotonicOffsetMs",
    "previousRecordDigest",
    "recordDigest",
    "fixtureSetDigest",
    "workloadProfileDigest",
    ...specificKeys,
  ];
}

function text(value, field, maximumBytes = 256) {
  if (typeof value !== "string") fail(field + " must be a string", field);
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximumBytes) {
    fail(field + " must be a non-empty bounded string", field);
  }
  return normalized;
}

function digest(value, field) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(field + " must be a lowercase sha256 digest", field);
  }
  return value;
}

function integer(value, field, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    fail(
      field +
        " must be a " +
        (positive ? "positive" : "non-negative") +
        " safe integer",
      field,
    );
  }
  return value;
}

function nullableInteger(value, field) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) {
    fail(field + " must be null or a safe integer", field);
  }
  return value;
}

function nullableText(value, field, maximumBytes = 64) {
  return value === null ? null : text(value, field, maximumBytes);
}

function nullableDigest(value, field) {
  return value === null ? null : digest(value, field);
}

function timestamp(value, field) {
  if (typeof value !== "string") fail(field + " must be a timestamp", field);
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(field + " must be a canonical timestamp", field);
  }
  return { value, milliseconds };
}

function hostId(value, field, registeredHostIds) {
  const normalized = digest(value, field);
  if (!registeredHostIds.has(normalized)) {
    fail(field + " is not a registered host for this platform", field);
  }
  return normalized;
}

function exactStringMembers(actual, expected, field) {
  if (!Array.isArray(actual)) fail(field + " must be an array", field);
  const normalized = actual.map((entry, index) =>
    text(entry, field + "[" + index + "]", 128),
  );
  const left = [...normalized].sort();
  const right = [...expected].sort();
  if (
    left.length !== right.length ||
    left.some((entry, index) => entry !== right[index])
  ) {
    fail(field + " does not match the protected scenario contract", field);
  }
  return normalized;
}

function scenarioContract(requirement) {
  const scenario = text(
    requirement?.evidenceScenario,
    "requirement.evidenceScenario",
    128,
  );
  const contract = P1_10_SCENARIO_CONTRACT.scenarios[scenario];
  if (!contract) fail("unsupported P1-10 scenario: " + scenario, "scenario");
  if (
    requirement.minimumDurationMs !== contract.minimumDurationMs ||
    requirement.minimumDistinctHosts !== contract.minimumDistinctHosts
  ) {
    fail(
      "matrix thresholds do not match the protected scenario contract",
      "requirement",
    );
  }
  exactStringMembers(
    requirement.requiredPlatforms,
    contract.requiredPlatforms,
    "requirement.requiredPlatforms",
  );
  exactStringMembers(
    requirement.requiredMetrics?.positive,
    contract.requiredMetrics.positive,
    "requirement.requiredMetrics.positive",
  );
  exactStringMembers(
    requirement.requiredMetrics?.zero,
    contract.requiredMetrics.zero,
    "requirement.requiredMetrics.zero",
  );
  return { scenario, contract };
}

function normalizeScenarioInput(input, scenario, contract) {
  const commonKeys = [
    "scenario",
    "interface",
    "fixtureSetDigest",
    "workloadProfileDigest",
  ];
  const specificKeys = {
    "real-multi-host-causal-agent-stream": [
      "payloadSetDigest",
      "minimumMessagesPerHost",
    ],
    "cross-version-graph-definition-migration": [
      "sourceVersion",
      "targetVersion",
      "sourceRuntimeArtifactDigest",
      "targetRuntimeArtifactDigest",
      "packageDigest",
      "packageSignatureDigest",
      "sourceStateDigest",
      "expectedMigratedDigest",
    ],
    "packaged-electron-collaboration-crash-recovery": [
      "packageDigest",
      "packageSignatureDigest",
      "collaborationFixtureDigest",
      "minimumRemoteUpdatesPerCrash",
    ],
    "two-physical-host-mtc-roundtrip": [
      "payloadSetDigest",
      "minimumRoundTripsPerHost",
    ],
    "long-running-desktop-soak": [
      "operationProfileDigest",
      "minimumOperationsPerWindow",
    ],
  }[scenario];
  exactKeys(input, [...commonKeys, ...specificKeys], "scenarioInput");
  const normalized = {
    scenario: text(input.scenario, "scenarioInput.scenario", 128),
    interface: text(input.interface, "scenarioInput.interface", 128),
    fixtureSetDigest: digest(
      input.fixtureSetDigest,
      "scenarioInput.fixtureSetDigest",
    ),
    workloadProfileDigest: digest(
      input.workloadProfileDigest,
      "scenarioInput.workloadProfileDigest",
    ),
  };
  if (
    normalized.scenario !== scenario ||
    normalized.interface !== contract.interface
  ) {
    fail(
      "scenarioInput identity does not match the protected scenario contract",
      "scenarioInput",
    );
  }
  if (scenario === "real-multi-host-causal-agent-stream") {
    normalized.payloadSetDigest = digest(
      input.payloadSetDigest,
      "scenarioInput.payloadSetDigest",
    );
    normalized.minimumMessagesPerHost = integer(
      input.minimumMessagesPerHost,
      "scenarioInput.minimumMessagesPerHost",
      true,
    );
    if (normalized.minimumMessagesPerHost !== contract.minimumMessagesPerHost) {
      fail(
        "scenarioInput minimumMessagesPerHost does not match the protected workload",
        "scenarioInput.minimumMessagesPerHost",
      );
    }
  } else if (scenario === "cross-version-graph-definition-migration") {
    normalized.sourceVersion = text(
      input.sourceVersion,
      "scenarioInput.sourceVersion",
      64,
    );
    normalized.targetVersion = text(
      input.targetVersion,
      "scenarioInput.targetVersion",
      64,
    );
    for (const field of [
      "sourceRuntimeArtifactDigest",
      "targetRuntimeArtifactDigest",
      "packageDigest",
      "packageSignatureDigest",
      "sourceStateDigest",
      "expectedMigratedDigest",
    ]) {
      normalized[field] = digest(input[field], "scenarioInput." + field);
    }
    if (
      normalized.sourceVersion === normalized.targetVersion ||
      normalized.sourceRuntimeArtifactDigest ===
        normalized.targetRuntimeArtifactDigest ||
      normalized.sourceStateDigest === normalized.expectedMigratedDigest
    ) {
      fail(
        "scenarioInput migration must bind distinct reviewed source and target states",
        "scenarioInput",
      );
    }
  } else if (scenario === "packaged-electron-collaboration-crash-recovery") {
    for (const field of [
      "packageDigest",
      "packageSignatureDigest",
      "collaborationFixtureDigest",
    ]) {
      normalized[field] = digest(input[field], "scenarioInput." + field);
    }
    if (normalized.collaborationFixtureDigest !== normalized.fixtureSetDigest) {
      fail(
        "scenarioInput collaboration fixture must equal the protected fixture set digest",
        "scenarioInput.collaborationFixtureDigest",
      );
    }
    normalized.minimumRemoteUpdatesPerCrash = integer(
      input.minimumRemoteUpdatesPerCrash,
      "scenarioInput.minimumRemoteUpdatesPerCrash",
      true,
    );
    if (
      normalized.minimumRemoteUpdatesPerCrash !==
      contract.minimumRemoteUpdatesPerCrash
    ) {
      fail(
        "scenarioInput minimumRemoteUpdatesPerCrash does not match the protected workload",
        "scenarioInput.minimumRemoteUpdatesPerCrash",
      );
    }
  } else if (scenario === "two-physical-host-mtc-roundtrip") {
    normalized.payloadSetDigest = digest(
      input.payloadSetDigest,
      "scenarioInput.payloadSetDigest",
    );
    normalized.minimumRoundTripsPerHost = integer(
      input.minimumRoundTripsPerHost,
      "scenarioInput.minimumRoundTripsPerHost",
      true,
    );
    if (
      normalized.minimumRoundTripsPerHost !== contract.minimumRoundTripsPerHost
    ) {
      fail(
        "scenarioInput minimumRoundTripsPerHost does not match the protected workload",
        "scenarioInput.minimumRoundTripsPerHost",
      );
    }
  } else {
    normalized.operationProfileDigest = digest(
      input.operationProfileDigest,
      "scenarioInput.operationProfileDigest",
    );
    normalized.minimumOperationsPerWindow = integer(
      input.minimumOperationsPerWindow,
      "scenarioInput.minimumOperationsPerWindow",
      true,
    );
    if (
      normalized.minimumOperationsPerWindow !==
      contract.minimumOperationsPerWindow
    ) {
      fail(
        "scenarioInput minimumOperationsPerWindow does not match the protected workload",
        "scenarioInput.minimumOperationsPerWindow",
      );
    }
  }
  return normalized;
}

function normalizeRecordChain(record, context, index) {
  const field = "scenarioReceipt.records[" + index + "]";
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    fail(field + " must be an object", field);
  }
  const type = text(record.type, field + ".type", 64);
  const fixtureSetDigest = digest(
    record.fixtureSetDigest,
    field + ".fixtureSetDigest",
  );
  const workloadProfileDigest = digest(
    record.workloadProfileDigest,
    field + ".workloadProfileDigest",
  );
  if (
    fixtureSetDigest !== context.scenarioInput.fixtureSetDigest ||
    workloadProfileDigest !== context.scenarioInput.workloadProfileDigest
  ) {
    fail(
      field + " is detached from the protected fixture/workload manifest",
      field,
    );
  }
  const at = timestamp(record.at, field + ".at");
  const monotonicOffsetMs = integer(
    record.monotonicOffsetMs,
    field + ".monotonicOffsetMs",
  );
  if (
    monotonicOffsetMs <= context.previousOffsetMs ||
    monotonicOffsetMs > context.durationMs
  ) {
    fail(
      field +
        ".monotonicOffsetMs must be strictly increasing inside the scenario window",
      field + ".monotonicOffsetMs",
    );
  }
  if (at.milliseconds !== context.startedMs + monotonicOffsetMs) {
    fail(
      field + ".at must equal startedAt plus monotonicOffsetMs",
      field + ".at",
    );
  }
  const previousRecordDigest = digest(
    record.previousRecordDigest,
    field + ".previousRecordDigest",
  );
  if (previousRecordDigest !== context.chainTip) {
    fail(
      field + " is not append-only from the preceding record digest",
      field + ".previousRecordDigest",
    );
  }
  const recordDigest = digest(record.recordDigest, field + ".recordDigest");
  if (recordDigest !== digestP110ScenarioRecord(record)) {
    fail(
      field + " digest does not authenticate its canonical event",
      field + ".recordDigest",
    );
  }
  context.previousOffsetMs = monotonicOffsetMs;
  context.chainTip = recordDigest;
  return {
    field,
    common: {
      type,
      at: at.value,
      monotonicOffsetMs,
      previousRecordDigest,
      recordDigest,
      fixtureSetDigest,
      workloadProfileDigest,
    },
  };
}

function normalizeKillReceipt(value, expected, field) {
  exactKeys(
    value,
    [
      "schema",
      "crashId",
      "executionId",
      "challenge",
      "bootIdDigest",
      "attesterMeasurementDigest",
      "supervisorDigest",
      "packageDigest",
      "processInstanceId",
      "pid",
      "supervisorInstanceId",
      "terminationMethod",
      "requestedMonotonicOffsetMs",
      "observedMonotonicOffsetMs",
      "exitCode",
      "signal",
    ],
    field,
  );
  const crashContract =
    P1_10_SCENARIO_CONTRACT.scenarios[
      "packaged-electron-collaboration-crash-recovery"
    ];
  const normalized = {
    schema: value.schema,
    crashId: text(value.crashId, field + ".crashId"),
    executionId: text(value.executionId, field + ".executionId", 128),
    challenge: text(value.challenge, field + ".challenge", 128),
    bootIdDigest: digest(value.bootIdDigest, field + ".bootIdDigest"),
    attesterMeasurementDigest: digest(
      value.attesterMeasurementDigest,
      field + ".attesterMeasurementDigest",
    ),
    supervisorDigest: digest(
      value.supervisorDigest,
      field + ".supervisorDigest",
    ),
    packageDigest: digest(value.packageDigest, field + ".packageDigest"),
    processInstanceId: text(
      value.processInstanceId,
      field + ".processInstanceId",
      128,
    ),
    pid: integer(value.pid, field + ".pid", true),
    supervisorInstanceId: text(
      value.supervisorInstanceId,
      field + ".supervisorInstanceId",
      128,
    ),
    terminationMethod: text(
      value.terminationMethod,
      field + ".terminationMethod",
      64,
    ),
    requestedMonotonicOffsetMs: integer(
      value.requestedMonotonicOffsetMs,
      field + ".requestedMonotonicOffsetMs",
    ),
    observedMonotonicOffsetMs: integer(
      value.observedMonotonicOffsetMs,
      field + ".observedMonotonicOffsetMs",
    ),
    exitCode: nullableInteger(value.exitCode, field + ".exitCode"),
    signal: nullableText(value.signal, field + ".signal", 32),
  };
  if (
    normalized.schema !== crashContract.killReceiptSchema ||
    normalized.crashId !== expected.crashId ||
    normalized.executionId !== expected.executionId ||
    normalized.challenge !== expected.challenge ||
    !CHALLENGE.test(normalized.challenge) ||
    normalized.bootIdDigest !== expected.bootIdDigest ||
    normalized.attesterMeasurementDigest !==
      expected.attesterMeasurementDigest ||
    normalized.supervisorDigest !== expected.supervisorDigest ||
    normalized.packageDigest !== expected.packageDigest ||
    normalized.processInstanceId !== expected.processInstanceId ||
    normalized.pid !== expected.pid ||
    normalized.supervisorInstanceId === expected.processInstanceId ||
    normalized.terminationMethod !== expected.terminationMethod ||
    normalized.exitCode !== expected.exitCode ||
    normalized.signal !== expected.signal ||
    normalized.observedMonotonicOffsetMs !== expected.monotonicOffsetMs ||
    normalized.requestedMonotonicOffsetMs >=
      normalized.observedMonotonicOffsetMs
  ) {
    fail(
      field +
        " does not bind one supervisor request to the observed target process exit",
      field,
    );
  }
  return normalized;
}

function normalizeCrashBindings(record, context, field) {
  const normalized = {
    crashId: text(record.crashId, field + ".crashId"),
    packageDigest: digest(record.packageDigest, field + ".packageDigest"),
    packageSignatureDigest: digest(
      record.packageSignatureDigest,
      field + ".packageSignatureDigest",
    ),
    collaborationFixtureDigest: digest(
      record.collaborationFixtureDigest,
      field + ".collaborationFixtureDigest",
    ),
    sessionId: text(record.sessionId, field + ".sessionId"),
    documentId: text(record.documentId, field + ".documentId"),
    localPeerId: text(record.localPeerId, field + ".localPeerId"),
    remotePeerId: text(record.remotePeerId, field + ".remotePeerId"),
    localHostIdDigest: hostId(
      record.localHostIdDigest,
      field + ".localHostIdDigest",
      context.registeredHostIds,
    ),
    remoteHostIdDigest: hostId(
      record.remoteHostIdDigest,
      field + ".remoteHostIdDigest",
      context.registeredHostIds,
    ),
  };
  if (
    normalized.packageDigest !== context.scenarioInput.packageDigest ||
    normalized.packageSignatureDigest !==
      context.scenarioInput.packageSignatureDigest ||
    normalized.collaborationFixtureDigest !==
      context.scenarioInput.collaborationFixtureDigest ||
    normalized.localPeerId === normalized.remotePeerId ||
    normalized.localHostIdDigest !== context.sourceHostIdDigest ||
    normalized.remoteHostIdDigest === context.sourceHostIdDigest
  ) {
    fail(
      field +
        " is detached from the protected collaboration package/session peers",
      field,
    );
  }
  return normalized;
}

function normalizeCrashTransportBindings(record, context, field, type) {
  const normalized = {
    targetCrashId: text(record.targetCrashId, field + ".targetCrashId"),
    deliveryId: text(record.deliveryId, field + ".deliveryId"),
    updateId: text(record.updateId, field + ".updateId"),
    updateDigest: digest(record.updateDigest, field + ".updateDigest"),
    packageDigest: digest(record.packageDigest, field + ".packageDigest"),
    packageSignatureDigest: digest(
      record.packageSignatureDigest,
      field + ".packageSignatureDigest",
    ),
    collaborationFixtureDigest: digest(
      record.collaborationFixtureDigest,
      field + ".collaborationFixtureDigest",
    ),
    sessionId: text(record.sessionId, field + ".sessionId"),
    documentId: text(record.documentId, field + ".documentId"),
    originPeerId: text(record.originPeerId, field + ".originPeerId"),
    targetPeerId: text(record.targetPeerId, field + ".targetPeerId"),
    originHostIdDigest: hostId(
      record.originHostIdDigest,
      field + ".originHostIdDigest",
      context.registeredHostIds,
    ),
    targetHostIdDigest: hostId(
      record.targetHostIdDigest,
      field + ".targetHostIdDigest",
      context.registeredHostIds,
    ),
  };
  const localHost =
    type === "remote-update-originated"
      ? normalized.originHostIdDigest
      : normalized.targetHostIdDigest;
  if (
    normalized.packageDigest !== context.scenarioInput.packageDigest ||
    normalized.packageSignatureDigest !==
      context.scenarioInput.packageSignatureDigest ||
    normalized.collaborationFixtureDigest !==
      context.scenarioInput.collaborationFixtureDigest ||
    normalized.originHostIdDigest === normalized.targetHostIdDigest ||
    normalized.originPeerId === normalized.targetPeerId ||
    localHost !== context.sourceHostIdDigest
  ) {
    fail(
      field +
        " is detached from the protected cross-host collaboration transport",
      field,
    );
  }
  return normalized;
}

function normalizeRecord(record, context, index) {
  const { field, common } = normalizeRecordChain(record, context, index);
  const { type } = common;

  if (context.scenario === "real-multi-host-causal-agent-stream") {
    if (type !== "message-sent" && type !== "message-received") {
      fail(field + ".type is unsupported for causal stream", field + ".type");
    }
    const causalKeys = [
      "messageId",
      "senderSequence",
      "fromHostIdDigest",
      "toHostIdDigest",
      "payloadSetDigest",
      "payloadDigest",
      "parentMessageId",
      "parentSendRecordDigest",
      "parentReceiveRecordDigest",
      "replyToMessageId",
      "replyToSendRecordDigest",
    ];
    exactKeys(
      record,
      recordKeys(
        ...causalKeys,
        ...(type === "message-received" ? ["sentRecordDigest"] : []),
      ),
      field,
    );
    const fromHostIdDigest = hostId(
      record.fromHostIdDigest,
      field + ".fromHostIdDigest",
      context.registeredHostIds,
    );
    const toHostIdDigest = hostId(
      record.toHostIdDigest,
      field + ".toHostIdDigest",
      context.registeredHostIds,
    );
    if (fromHostIdDigest === toHostIdDigest) {
      fail(field + " must cross two physical hosts", field);
    }
    if (
      (type === "message-sent" &&
        fromHostIdDigest !== context.sourceHostIdDigest) ||
      (type === "message-received" &&
        toHostIdDigest !== context.sourceHostIdDigest)
    ) {
      fail(field + " is not a local authenticated host observation", field);
    }
    const payloadSetDigest = digest(
      record.payloadSetDigest,
      field + ".payloadSetDigest",
    );
    if (payloadSetDigest !== context.scenarioInput.payloadSetDigest) {
      fail(field + " is detached from the protected payload set", field);
    }
    const parentMessageId = nullableText(
      record.parentMessageId,
      field + ".parentMessageId",
    );
    const parentSendRecordDigest = nullableDigest(
      record.parentSendRecordDigest,
      field + ".parentSendRecordDigest",
    );
    const replyToMessageId = nullableText(
      record.replyToMessageId,
      field + ".replyToMessageId",
    );
    const replyToSendRecordDigest = nullableDigest(
      record.replyToSendRecordDigest,
      field + ".replyToSendRecordDigest",
    );
    const parentReceiveRecordDigest = nullableDigest(
      record.parentReceiveRecordDigest,
      field + ".parentReceiveRecordDigest",
    );
    if (
      (parentMessageId === null) !== (parentSendRecordDigest === null) ||
      (parentMessageId === null) !== (parentReceiveRecordDigest === null) ||
      (replyToMessageId === null) !== (replyToSendRecordDigest === null) ||
      parentMessageId !== replyToMessageId ||
      parentSendRecordDigest !== replyToSendRecordDigest
    ) {
      fail(
        field + " must explicitly bind one matching parent/reply-to send",
        field,
      );
    }
    const normalized = {
      ...common,
      messageId: text(record.messageId, field + ".messageId"),
      senderSequence: integer(
        record.senderSequence,
        field + ".senderSequence",
        true,
      ),
      fromHostIdDigest,
      toHostIdDigest,
      payloadSetDigest,
      payloadDigest: digest(record.payloadDigest, field + ".payloadDigest"),
      parentMessageId,
      parentSendRecordDigest,
      parentReceiveRecordDigest,
      replyToMessageId,
      replyToSendRecordDigest,
    };
    if (type === "message-received") {
      normalized.sentRecordDigest = digest(
        record.sentRecordDigest,
        field + ".sentRecordDigest",
      );
    }
    return normalized;
  }

  if (context.scenario === "cross-version-graph-definition-migration") {
    const migrationBindings = [
      "caseId",
      "sourceVersion",
      "targetVersion",
      "sourceRuntimeArtifactDigest",
      "targetRuntimeArtifactDigest",
      "packageDigest",
      "packageSignatureDigest",
      "fixtureDigest",
      "sourceStateDigest",
      "migratedDigest",
    ];
    if (type === "migration-case") {
      exactKeys(
        record,
        recordKeys(...migrationBindings, "expectedDigest"),
        field,
      );
      const sourceVersion = text(
        record.sourceVersion,
        field + ".sourceVersion",
        64,
      );
      const targetVersion = text(
        record.targetVersion,
        field + ".targetVersion",
        64,
      );
      const sourceRuntimeArtifactDigest = digest(
        record.sourceRuntimeArtifactDigest,
        field + ".sourceRuntimeArtifactDigest",
      );
      const targetRuntimeArtifactDigest = digest(
        record.targetRuntimeArtifactDigest,
        field + ".targetRuntimeArtifactDigest",
      );
      if (
        sourceVersion === targetVersion ||
        sourceRuntimeArtifactDigest === targetRuntimeArtifactDigest ||
        sourceVersion !== context.scenarioInput.sourceVersion ||
        targetVersion !== context.scenarioInput.targetVersion ||
        sourceRuntimeArtifactDigest !==
          context.scenarioInput.sourceRuntimeArtifactDigest ||
        targetRuntimeArtifactDigest !==
          context.scenarioInput.targetRuntimeArtifactDigest ||
        record.packageDigest !== context.scenarioInput.packageDigest ||
        record.packageSignatureDigest !==
          context.scenarioInput.packageSignatureDigest ||
        record.fixtureDigest !== context.scenarioInput.fixtureSetDigest ||
        record.sourceStateDigest !== context.scenarioInput.sourceStateDigest ||
        record.migratedDigest !==
          context.scenarioInput.expectedMigratedDigest ||
        record.expectedDigest !== context.scenarioInput.expectedMigratedDigest
      ) {
        fail(
          field +
            " must bind the exact protected migration artifacts and states",
          field,
        );
      }
      return {
        ...common,
        caseId: text(record.caseId, field + ".caseId"),
        sourceVersion,
        targetVersion,
        sourceRuntimeArtifactDigest,
        targetRuntimeArtifactDigest,
        packageDigest: digest(record.packageDigest, field + ".packageDigest"),
        packageSignatureDigest: digest(
          record.packageSignatureDigest,
          field + ".packageSignatureDigest",
        ),
        fixtureDigest: digest(record.fixtureDigest, field + ".fixtureDigest"),
        sourceStateDigest: digest(
          record.sourceStateDigest,
          field + ".sourceStateDigest",
        ),
        migratedDigest: digest(
          record.migratedDigest,
          field + ".migratedDigest",
        ),
        expectedDigest: digest(
          record.expectedDigest,
          field + ".expectedDigest",
        ),
      };
    }
    if (type === "rollback-case") {
      exactKeys(
        record,
        recordKeys(...migrationBindings, "restoredDigest"),
        field,
      );
      if (
        record.sourceVersion !== context.scenarioInput.sourceVersion ||
        record.targetVersion !== context.scenarioInput.targetVersion ||
        record.sourceRuntimeArtifactDigest !==
          context.scenarioInput.sourceRuntimeArtifactDigest ||
        record.targetRuntimeArtifactDigest !==
          context.scenarioInput.targetRuntimeArtifactDigest ||
        record.packageDigest !== context.scenarioInput.packageDigest ||
        record.packageSignatureDigest !==
          context.scenarioInput.packageSignatureDigest ||
        record.fixtureDigest !== context.scenarioInput.fixtureSetDigest ||
        record.sourceStateDigest !== context.scenarioInput.sourceStateDigest ||
        record.migratedDigest !== context.scenarioInput.expectedMigratedDigest
      ) {
        fail(
          field +
            " must bind the exact protected migration artifacts and states",
          field,
        );
      }
      return {
        ...common,
        caseId: text(record.caseId, field + ".caseId"),
        sourceVersion: text(record.sourceVersion, field + ".sourceVersion", 64),
        targetVersion: text(record.targetVersion, field + ".targetVersion", 64),
        sourceRuntimeArtifactDigest: digest(
          record.sourceRuntimeArtifactDigest,
          field + ".sourceRuntimeArtifactDigest",
        ),
        targetRuntimeArtifactDigest: digest(
          record.targetRuntimeArtifactDigest,
          field + ".targetRuntimeArtifactDigest",
        ),
        packageDigest: digest(record.packageDigest, field + ".packageDigest"),
        packageSignatureDigest: digest(
          record.packageSignatureDigest,
          field + ".packageSignatureDigest",
        ),
        fixtureDigest: digest(record.fixtureDigest, field + ".fixtureDigest"),
        sourceStateDigest: digest(
          record.sourceStateDigest,
          field + ".sourceStateDigest",
        ),
        migratedDigest: digest(
          record.migratedDigest,
          field + ".migratedDigest",
        ),
        restoredDigest: digest(
          record.restoredDigest,
          field + ".restoredDigest",
        ),
      };
    }
    fail(field + ".type is unsupported for graph migration", field + ".type");
  }

  if (context.scenario === "packaged-electron-collaboration-crash-recovery") {
    const collaborationKeys = [
      "crashId",
      "packageDigest",
      "packageSignatureDigest",
      "collaborationFixtureDigest",
      "sessionId",
      "documentId",
      "localPeerId",
      "remotePeerId",
      "localHostIdDigest",
      "remoteHostIdDigest",
    ];
    if (
      type === "remote-update-originated" ||
      type === "remote-update-received"
    ) {
      const transportKeys = [
        "targetCrashId",
        "deliveryId",
        "updateId",
        "updateDigest",
        "packageDigest",
        "packageSignatureDigest",
        "collaborationFixtureDigest",
        "sessionId",
        "documentId",
        "originPeerId",
        "targetPeerId",
        "originHostIdDigest",
        "targetHostIdDigest",
      ];
      exactKeys(
        record,
        recordKeys(
          ...transportKeys,
          ...(type === "remote-update-received" ? ["originRecordDigest"] : []),
        ),
        field,
      );
      const normalized = {
        ...common,
        ...normalizeCrashTransportBindings(record, context, field, type),
      };
      if (type === "remote-update-received") {
        normalized.originRecordDigest = digest(
          record.originRecordDigest,
          field + ".originRecordDigest",
        );
      }
      return normalized;
    }
    if (type === "committed-update") {
      exactKeys(
        record,
        recordKeys(
          ...collaborationKeys,
          "processInstanceId",
          "pid",
          "updateId",
          "updateDigest",
          "deliveryId",
          "receivedRecordDigest",
          "commitPreDigest",
          "commitPostDigest",
          "storePreDigest",
          "storePostDigest",
        ),
        field,
      );
      const commitPreDigest = digest(
        record.commitPreDigest,
        field + ".commitPreDigest",
      );
      const commitPostDigest = digest(
        record.commitPostDigest,
        field + ".commitPostDigest",
      );
      const storePreDigest = digest(
        record.storePreDigest,
        field + ".storePreDigest",
      );
      const storePostDigest = digest(
        record.storePostDigest,
        field + ".storePostDigest",
      );
      if (
        commitPreDigest !== storePreDigest ||
        commitPostDigest !== storePostDigest ||
        commitPreDigest === commitPostDigest
      ) {
        fail(
          field +
            " does not prove one canonical state transition was durably stored",
          field,
        );
      }
      const bindings = normalizeCrashBindings(record, context, field);
      return {
        ...common,
        ...bindings,
        processInstanceId: text(
          record.processInstanceId,
          field + ".processInstanceId",
          128,
        ),
        pid: integer(record.pid, field + ".pid", true),
        updateId: text(record.updateId, field + ".updateId"),
        updateDigest: digest(record.updateDigest, field + ".updateDigest"),
        deliveryId: text(record.deliveryId, field + ".deliveryId"),
        receivedRecordDigest: digest(
          record.receivedRecordDigest,
          field + ".receivedRecordDigest",
        ),
        commitPreDigest,
        commitPostDigest,
        storePreDigest,
        storePostDigest,
      };
    }
    if (type === "process-crash") {
      exactKeys(
        record,
        recordKeys(
          ...collaborationKeys,
          "processInstanceId",
          "pid",
          "lastCommittedRecordDigest",
          "terminationMethod",
          "exitCode",
          "signal",
          "killReceipt",
          "killReceiptDigest",
        ),
        field,
      );
      const bindings = normalizeCrashBindings(record, context, field);
      const processInstanceId = text(
        record.processInstanceId,
        field + ".processInstanceId",
        128,
      );
      const pid = integer(record.pid, field + ".pid", true);
      const terminationMethod = text(
        record.terminationMethod,
        field + ".terminationMethod",
        64,
      );
      const exitCode = nullableInteger(record.exitCode, field + ".exitCode");
      const signal = nullableText(record.signal, field + ".signal", 32);
      const crashContract =
        P1_10_SCENARIO_CONTRACT.scenarios[
          "packaged-electron-collaboration-crash-recovery"
        ];
      const forcedTermination =
        crashContract.forcedTerminationByPlatform[context.platform];
      if (
        !forcedTermination ||
        terminationMethod !== forcedTermination.terminationMethod ||
        exitCode !== forcedTermination.exitCode ||
        signal !== forcedTermination.signal
      ) {
        fail(
          field + " does not prove the platform-fixed forced abnormal exit",
          field,
        );
      }
      const killReceipt = normalizeKillReceipt(
        record.killReceipt,
        {
          crashId: bindings.crashId,
          executionId: context.executionId,
          challenge: context.challenge,
          bootIdDigest: context.bootIdDigest,
          attesterMeasurementDigest: context.attesterMeasurementDigest,
          supervisorDigest: context.supervisorDigest,
          packageDigest: bindings.packageDigest,
          processInstanceId,
          pid,
          terminationMethod,
          exitCode,
          signal,
          monotonicOffsetMs: common.monotonicOffsetMs,
        },
        field + ".killReceipt",
      );
      const killReceiptDigest = digest(
        record.killReceiptDigest,
        field + ".killReceiptDigest",
      );
      if (killReceiptDigest !== digestP110KillReceipt(killReceipt)) {
        fail(
          field +
            ".killReceiptDigest does not authenticate the canonical kill receipt",
          field + ".killReceiptDigest",
        );
      }
      return {
        ...common,
        ...bindings,
        processInstanceId,
        pid,
        lastCommittedRecordDigest: digest(
          record.lastCommittedRecordDigest,
          field + ".lastCommittedRecordDigest",
        ),
        terminationMethod,
        exitCode,
        signal,
        killReceipt,
        killReceiptDigest,
      };
    }
    if (type === "recovered-update") {
      exactKeys(
        record,
        recordKeys(
          ...collaborationKeys,
          "crashedProcessInstanceId",
          "crashedPid",
          "recoveryProcessInstanceId",
          "recoveryPid",
          "deliveryId",
          "updateId",
          "updateDigest",
          "commitRecordDigest",
          "crashRecordDigest",
          "recoveryPreDigest",
          "recoveryPostDigest",
        ),
        field,
      );
      const crashedProcessInstanceId = text(
        record.crashedProcessInstanceId,
        field + ".crashedProcessInstanceId",
        128,
      );
      const recoveryProcessInstanceId = text(
        record.recoveryProcessInstanceId,
        field + ".recoveryProcessInstanceId",
        128,
      );
      const crashedPid = integer(
        record.crashedPid,
        field + ".crashedPid",
        true,
      );
      const recoveryPid = integer(
        record.recoveryPid,
        field + ".recoveryPid",
        true,
      );
      if (
        crashedProcessInstanceId === recoveryProcessInstanceId ||
        crashedPid === recoveryPid
      ) {
        fail(
          field + " must be observed from a replacement process instance",
          field,
        );
      }
      const bindings = normalizeCrashBindings(record, context, field);
      return {
        ...common,
        ...bindings,
        crashedProcessInstanceId,
        crashedPid,
        recoveryProcessInstanceId,
        recoveryPid,
        deliveryId: text(record.deliveryId, field + ".deliveryId"),
        updateId: text(record.updateId, field + ".updateId"),
        updateDigest: digest(record.updateDigest, field + ".updateDigest"),
        commitRecordDigest: digest(
          record.commitRecordDigest,
          field + ".commitRecordDigest",
        ),
        crashRecordDigest: digest(
          record.crashRecordDigest,
          field + ".crashRecordDigest",
        ),
        recoveryPreDigest: digest(
          record.recoveryPreDigest,
          field + ".recoveryPreDigest",
        ),
        recoveryPostDigest: digest(
          record.recoveryPostDigest,
          field + ".recoveryPostDigest",
        ),
      };
    }
    fail(field + ".type is unsupported for crash recovery", field + ".type");
  }

  if (context.scenario === "two-physical-host-mtc-roundtrip") {
    const mtcTypes = [
      "roundtrip-request-sent",
      "roundtrip-request-received",
      "roundtrip-response-sent",
      "roundtrip-response-received",
    ];
    if (!mtcTypes.includes(type)) {
      fail(field + ".type is unsupported for MTC roundtrip", field + ".type");
    }
    const isRequest = type.startsWith("roundtrip-request-");
    const isReceived = type.endsWith("-received");
    const keys = [
      "roundTripId",
      "requestId",
      "requestPayloadDigest",
      "payloadSetDigest",
      "fromHostIdDigest",
      "toHostIdDigest",
    ];
    if (!isRequest) {
      keys.push(
        "responseId",
        "responsePayloadDigest",
        "replyToRequestId",
        "replyToRequestSendRecordDigest",
        "requestReceiveRecordDigest",
      );
    }
    if (type === "roundtrip-request-received") {
      keys.push("requestSendRecordDigest");
    }
    if (type === "roundtrip-response-received") {
      keys.push("responseSendRecordDigest");
    }
    exactKeys(record, recordKeys(...keys), field);
    const fromHostIdDigest = hostId(
      record.fromHostIdDigest,
      field + ".fromHostIdDigest",
      context.registeredHostIds,
    );
    const toHostIdDigest = hostId(
      record.toHostIdDigest,
      field + ".toHostIdDigest",
      context.registeredHostIds,
    );
    if (fromHostIdDigest === toHostIdDigest) {
      fail(field + " must cross two physical hosts", field);
    }
    if (
      (!isReceived && fromHostIdDigest !== context.sourceHostIdDigest) ||
      (isReceived && toHostIdDigest !== context.sourceHostIdDigest)
    ) {
      fail(field + " is not a local authenticated host observation", field);
    }
    const payloadSetDigest = digest(
      record.payloadSetDigest,
      field + ".payloadSetDigest",
    );
    if (payloadSetDigest !== context.scenarioInput.payloadSetDigest) {
      fail(field + " is detached from the protected MTC payload set", field);
    }
    const normalized = {
      ...common,
      roundTripId: text(record.roundTripId, field + ".roundTripId"),
      requestId: text(record.requestId, field + ".requestId"),
      requestPayloadDigest: digest(
        record.requestPayloadDigest,
        field + ".requestPayloadDigest",
      ),
      payloadSetDigest,
      fromHostIdDigest,
      toHostIdDigest,
    };
    if (type === "roundtrip-request-received") {
      normalized.requestSendRecordDigest = digest(
        record.requestSendRecordDigest,
        field + ".requestSendRecordDigest",
      );
    }
    if (!isRequest) {
      normalized.responseId = text(record.responseId, field + ".responseId");
      normalized.responsePayloadDigest = digest(
        record.responsePayloadDigest,
        field + ".responsePayloadDigest",
      );
      normalized.replyToRequestId = text(
        record.replyToRequestId,
        field + ".replyToRequestId",
      );
      normalized.replyToRequestSendRecordDigest = digest(
        record.replyToRequestSendRecordDigest,
        field + ".replyToRequestSendRecordDigest",
      );
      normalized.requestReceiveRecordDigest = digest(
        record.requestReceiveRecordDigest,
        field + ".requestReceiveRecordDigest",
      );
      if (normalized.replyToRequestId !== normalized.requestId) {
        fail(field + " does not explicitly reply to its request", field);
      }
      if (type === "roundtrip-response-received") {
        normalized.responseSendRecordDigest = digest(
          record.responseSendRecordDigest,
          field + ".responseSendRecordDigest",
        );
      }
    }
    return normalized;
  }

  if (context.scenario === "long-running-desktop-soak") {
    if (type === "runtime-sample") {
      exactKeys(
        record,
        recordKeys(
          "sampleId",
          "operationProfileDigest",
          "backlogSize",
          "listenerCount",
          "timerCount",
          "unsettledTasks",
        ),
        field,
      );
      const operationProfileDigest = digest(
        record.operationProfileDigest,
        field + ".operationProfileDigest",
      );
      if (
        operationProfileDigest !== context.scenarioInput.operationProfileDigest
      ) {
        fail(
          field + " is detached from the protected operation profile",
          field,
        );
      }
      return {
        ...common,
        sampleId: text(record.sampleId, field + ".sampleId"),
        operationProfileDigest,
        backlogSize: integer(record.backlogSize, field + ".backlogSize"),
        listenerCount: integer(record.listenerCount, field + ".listenerCount"),
        timerCount: integer(record.timerCount, field + ".timerCount"),
        unsettledTasks: integer(
          record.unsettledTasks,
          field + ".unsettledTasks",
        ),
      };
    }
    if (type === "operation-completed") {
      exactKeys(
        record,
        recordKeys("operationId", "operationProfileDigest"),
        field,
      );
      const operationProfileDigest = digest(
        record.operationProfileDigest,
        field + ".operationProfileDigest",
      );
      if (
        operationProfileDigest !== context.scenarioInput.operationProfileDigest
      ) {
        fail(
          field + " is detached from the protected operation profile",
          field,
        );
      }
      return {
        ...common,
        operationId: text(record.operationId, field + ".operationId"),
        operationProfileDigest,
      };
    }
    fail(field + ".type is unsupported for desktop soak", field + ".type");
  }

  fail(
    "unsupported P1-10 scenario: " + context.scenario,
    "scenarioReceipt.scenario",
  );
}

function verifyReceiptChain(receipt, field = "receipt") {
  if (receipt.contractDigest !== P1_10_SCENARIO_CONTRACT_DIGEST) {
    fail(
      field + " is not bound to the protected scenario contract",
      field + ".contractDigest",
    );
  }
  if (
    !Array.isArray(receipt.records) ||
    receipt.records.length < 1 ||
    receipt.records.length > MAX_RECORDS ||
    receipt.recordCount !== receipt.records.length
  ) {
    fail(
      field + " recordCount does not match its event stream",
      field + ".recordCount",
    );
  }
  let chainTip = P1_10_RECORD_CHAIN_GENESIS_DIGEST;
  let previousOffsetMs = -1;
  const startedMs = timestamp(
    receipt.startedAt,
    field + ".startedAt",
  ).milliseconds;
  const endedMs = timestamp(receipt.endedAt, field + ".endedAt").milliseconds;
  if (
    !Number.isSafeInteger(receipt.durationMs) ||
    receipt.durationMs !== endedMs - startedMs
  ) {
    fail(
      field + " durationMs does not match its timestamp window",
      field + ".durationMs",
    );
  }
  for (let index = 0; index < receipt.records.length; index += 1) {
    const record = receipt.records[index];
    const recordField = field + ".records[" + index + "]";
    if (
      record.previousRecordDigest !== chainTip ||
      record.recordDigest !== digestP110ScenarioRecord(record)
    ) {
      fail(recordField + " breaks the append-only digest chain", recordField);
    }
    if (
      !Number.isSafeInteger(record.monotonicOffsetMs) ||
      record.monotonicOffsetMs <= previousOffsetMs ||
      record.monotonicOffsetMs > receipt.durationMs ||
      Date.parse(record.at) !== startedMs + record.monotonicOffsetMs
    ) {
      fail(
        recordField + " breaks the monotonic timestamp binding",
        recordField,
      );
    }
    chainTip = record.recordDigest;
    previousOffsetMs = record.monotonicOffsetMs;
  }
  if (receipt.recordsDigest !== chainTip) {
    fail(
      field + " recordsDigest is not the final event-chain digest",
      field + ".recordsDigest",
    );
  }
}

export function normalizeScenarioReceipt(
  input,
  {
    requirement,
    platform,
    sourceHostIdDigest,
    executionId,
    registeredHostIds,
    challenge,
    inputManifestDigest,
    scenarioInput,
    attesterMeasurementDigest,
    bootIdDigest,
    supervisorDigest,
  },
) {
  const { scenario, contract } = scenarioContract(requirement);
  exactKeys(
    input,
    [
      "schema",
      "contractDigest",
      "scenario",
      "platform",
      "sourceHostIdDigest",
      "executionId",
      "challenge",
      "inputManifestDigest",
      "scenarioInput",
      "attesterMeasurementDigest",
      "bootIdDigest",
      "supervisorDigest",
      "startedAt",
      "endedAt",
      "durationMs",
      "recordCount",
      "recordsDigest",
      "records",
    ],
    "scenarioReceipt",
  );
  if (input.schema !== contract.receiptSchema) {
    fail(
      "scenarioReceipt.schema is not the fixed schema for " + scenario,
      "scenarioReceipt.schema",
    );
  }
  if (input.contractDigest !== P1_10_SCENARIO_CONTRACT_DIGEST) {
    fail(
      "scenarioReceipt is not bound to the protected scenario contract",
      "scenarioReceipt.contractDigest",
    );
  }
  if (
    input.scenario !== scenario ||
    input.platform !== platform ||
    !PLATFORMS.has(platform)
  ) {
    fail(
      "scenario receipt identity does not match its matrix cell",
      "scenarioReceipt",
    );
  }
  if (input.sourceHostIdDigest !== sourceHostIdDigest) {
    fail(
      "scenario receipt is not from the authenticated source host",
      "scenarioReceipt.sourceHostIdDigest",
    );
  }
  if (
    input.executionId !== executionId ||
    !EXECUTION_ID.test(input.executionId)
  ) {
    fail(
      "scenario receipt executionId is not builder-issued",
      "scenarioReceipt.executionId",
    );
  }
  const expectedScenarioInput = normalizeScenarioInput(
    scenarioInput,
    scenario,
    contract,
  );
  const receiptScenarioInput = normalizeScenarioInput(
    input.scenarioInput,
    scenario,
    contract,
  );
  const normalizedChallenge = text(challenge, "context.challenge", 128);
  const normalizedInputManifestDigest = digest(
    inputManifestDigest,
    "context.inputManifestDigest",
  );
  const normalizedAttesterMeasurementDigest = digest(
    attesterMeasurementDigest,
    "context.attesterMeasurementDigest",
  );
  const normalizedBootIdDigest = digest(bootIdDigest, "context.bootIdDigest");
  const normalizedSupervisorDigest = digest(
    supervisorDigest,
    "context.supervisorDigest",
  );
  if (
    !CHALLENGE.test(normalizedChallenge) ||
    input.challenge !== normalizedChallenge ||
    input.inputManifestDigest !== normalizedInputManifestDigest ||
    input.attesterMeasurementDigest !== normalizedAttesterMeasurementDigest ||
    input.bootIdDigest !== normalizedBootIdDigest ||
    input.supervisorDigest !== normalizedSupervisorDigest ||
    canonicalJson(receiptScenarioInput, "scenarioReceipt.scenarioInput") !==
      canonicalJson(expectedScenarioInput, "context.scenarioInput")
  ) {
    fail(
      "scenario receipt is detached from the protected challenge/input/attester/boot/supervisor context",
      "scenarioReceipt",
    );
  }
  const started = timestamp(input.startedAt, "scenarioReceipt.startedAt");
  const ended = timestamp(input.endedAt, "scenarioReceipt.endedAt");
  const durationMs = ended.milliseconds - started.milliseconds;
  if (
    durationMs < contract.minimumDurationMs ||
    input.durationMs !== durationMs
  ) {
    fail(
      "scenarioReceipt.durationMs must meet the protected minimum and match its timestamp window",
      "scenarioReceipt.durationMs",
    );
  }
  if (
    !Array.isArray(input.records) ||
    input.records.length < 1 ||
    input.records.length > MAX_RECORDS ||
    input.recordCount !== input.records.length
  ) {
    fail(
      "scenarioReceipt.records must be a non-empty bounded array bound by recordCount",
      "scenarioReceipt.records",
    );
  }
  digest(input.recordsDigest, "scenarioReceipt.recordsDigest");
  const context = {
    scenario,
    platform,
    sourceHostIdDigest,
    executionId,
    challenge: normalizedChallenge,
    inputManifestDigest: normalizedInputManifestDigest,
    scenarioInput: expectedScenarioInput,
    attesterMeasurementDigest: normalizedAttesterMeasurementDigest,
    bootIdDigest: normalizedBootIdDigest,
    supervisorDigest: normalizedSupervisorDigest,
    registeredHostIds,
    startedMs: started.milliseconds,
    durationMs,
    previousOffsetMs: -1,
    chainTip: P1_10_RECORD_CHAIN_GENESIS_DIGEST,
  };
  const records = input.records.map((record, index) =>
    normalizeRecord(record, context, index),
  );
  if (input.recordsDigest !== context.chainTip) {
    fail(
      "scenarioReceipt.recordsDigest is not the final append-only digest",
      "scenarioReceipt.recordsDigest",
    );
  }
  const normalized = {
    schema: input.schema,
    contractDigest: input.contractDigest,
    scenario,
    platform,
    sourceHostIdDigest,
    executionId,
    challenge: normalizedChallenge,
    inputManifestDigest: normalizedInputManifestDigest,
    scenarioInput: expectedScenarioInput,
    attesterMeasurementDigest: normalizedAttesterMeasurementDigest,
    bootIdDigest: normalizedBootIdDigest,
    supervisorDigest: normalizedSupervisorDigest,
    startedAt: started.value,
    endedAt: ended.value,
    durationMs,
    recordCount: records.length,
    recordsDigest: input.recordsDigest,
    records,
  };
  verifyReceiptChain(normalized, "scenarioReceipt");
  NORMALIZED_SCENARIO_RECEIPTS.add(normalized);
  return deepFreeze(normalized);
}

function exactMetricContract(requirement, contract, metrics) {
  exactStringMembers(
    requirement.requiredMetrics.positive,
    contract.requiredMetrics.positive,
    "requirement.requiredMetrics.positive",
  );
  exactStringMembers(
    requirement.requiredMetrics.zero,
    contract.requiredMetrics.zero,
    "requirement.requiredMetrics.zero",
  );
  const actual = Object.keys(metrics).sort();
  const expected = [
    ...contract.requiredMetrics.positive,
    ...contract.requiredMetrics.zero,
  ].sort();
  if (
    actual.length !== expected.length ||
    actual.some((name, index) => name !== expected[index])
  ) {
    fail(
      "derived metric schema does not match the protected contract",
      "metrics",
    );
  }
  for (const name of contract.requiredMetrics.positive) {
    if (metrics[name] < 1) {
      fail("derived metric " + name + " must be positive", "metrics." + name);
    }
  }
  for (const name of contract.requiredMetrics.zero) {
    if (metrics[name] !== 0) {
      fail("derived metric " + name + " must be zero", "metrics." + name);
    }
  }
  return metrics;
}

function normalizedScenarioOverlap(requirement, receipts) {
  if (!Array.isArray(receipts)) {
    fail("authenticated scenario receipts are required", "receipts");
  }
  const receiptSnapshot = Array.from(receipts);
  if (receiptSnapshot.length < 1) {
    fail("authenticated scenario receipts are required", "receipts");
  }
  receipts = receiptSnapshot;
  const { scenario, contract } = scenarioContract(requirement);
  requireUnique(
    receipts,
    (receipt) => receipt?.sourceHostIdDigest,
    "receipts.hosts",
  );
  if (receipts.length < contract.minimumDistinctHosts) {
    fail(
      "authenticated receipts do not cover the protected distinct-host minimum",
      "receipts.hosts",
    );
  }
  const platforms = new Set();
  const first = receipts[0];
  for (const [index, receipt] of receipts.entries()) {
    const field = "receipts[" + index + "]";
    if (
      !receipt ||
      !NORMALIZED_SCENARIO_RECEIPTS.has(receipt) ||
      receipt.schema !== contract.receiptSchema ||
      receipt.scenario !== scenario ||
      receipt.contractDigest !== P1_10_SCENARIO_CONTRACT_DIGEST ||
      !PLATFORMS.has(receipt.platform) ||
      receipt.durationMs < contract.minimumDurationMs ||
      !EXECUTION_ID.test(receipt.executionId)
    ) {
      fail(
        "receipt is not an in-process normalized object under the protected scenario contract",
        field,
      );
    }
    if (
      receipt.challenge !== first.challenge ||
      receipt.inputManifestDigest !== first.inputManifestDigest ||
      canonicalJson(receipt.scenarioInput, field + ".scenarioInput") !==
        canonicalJson(first.scenarioInput, "receipts[0].scenarioInput")
    ) {
      fail(
        "scenario receipts do not share one protected challenge and input manifest",
        field,
      );
    }
    digest(receipt.sourceHostIdDigest, field + ".sourceHostIdDigest");
    platforms.add(receipt.platform);
    verifyReceiptChain(receipt, field);
  }
  if (platforms.size !== 1) {
    fail("scenario metrics must be derived per platform", "receipts.platform");
  }
  const startedMs = Math.max(
    ...receipts.map((receipt) => Date.parse(receipt.startedAt)),
  );
  const endedMs = Math.min(
    ...receipts.map((receipt) => Date.parse(receipt.endedAt)),
  );
  const durationMs = endedMs - startedMs;
  if (durationMs < contract.minimumDurationMs) {
    fail(
      "authenticated receipt windows do not share the protected minimum overlap",
      "receipts.overlap",
    );
  }
  const window = {
    startedAt: new Date(startedMs).toISOString(),
    endedAt: new Date(endedMs).toISOString(),
    durationMs,
  };
  const overlapReceipts = receipts.map((receipt) => ({
    ...receipt,
    records: receipt.records.filter((record) => {
      const at = Date.parse(record.at);
      return at >= startedMs && at <= endedMs;
    }),
  }));
  return { scenario, contract, window, receipts: overlapReceipts };
}

export function deriveScenarioOverlapWindow(requirement, receipts) {
  const { window } = normalizedScenarioOverlap(requirement, receipts);
  return deepFreeze(window);
}

function keyedRecords(receipts) {
  return receipts.flatMap((receipt) =>
    receipt.records.map((record) => ({
      ...record,
      sourceHostIdDigest: receipt.sourceHostIdDigest,
    })),
  );
}

function requireUnique(records, key, field) {
  const values = records.map(key);
  if (new Set(values).size !== values.length) {
    fail(field + " contains duplicate authenticated records", field);
  }
}

function requireLocalEventTypes(receipts, eventTypes, field) {
  for (const receipt of receipts) {
    for (const eventType of eventTypes) {
      if (!receipt.records.some((record) => record.type === eventType)) {
        fail(
          "each physical host must authenticate a local " +
            eventType +
            " event",
          field,
        );
      }
    }
  }
}

function deriveCausal(receipts) {
  requireLocalEventTypes(
    receipts,
    ["message-sent", "message-received"],
    "causal.hosts",
  );
  const records = keyedRecords(receipts);
  const sent = records.filter((record) => record.type === "message-sent");
  const received = records.filter(
    (record) => record.type === "message-received",
  );
  requireUnique(sent, (record) => record.messageId, "causal.sent");
  requireUnique(received, (record) => record.messageId, "causal.received");
  const sentById = new Map(sent.map((record) => [record.messageId, record]));
  const receivedById = new Map(
    received.map((record) => [record.messageId, record]),
  );
  const minimumMessagesPerHost =
    receipts[0].scenarioInput.minimumMessagesPerHost;
  for (const receipt of receipts) {
    const hostSent = sent
      .filter(
        (record) => record.sourceHostIdDigest === receipt.sourceHostIdDigest,
      )
      .sort((left, right) => left.senderSequence - right.senderSequence);
    if (
      hostSent.length < minimumMessagesPerHost ||
      hostSent.some((record, index) => record.senderSequence !== index + 1)
    ) {
      fail(
        "each causal sender must provide the fixed workload with a continuous logical sequence",
        "causal.sent",
      );
    }
  }
  for (const record of received) {
    const source = sentById.get(record.messageId);
    if (!source) {
      fail(
        "causal receipt contains a receive without an authenticated send",
        "causal.received",
      );
    }
    if (
      source.senderSequence !== record.senderSequence ||
      source.fromHostIdDigest !== record.fromHostIdDigest ||
      source.toHostIdDigest !== record.toHostIdDigest ||
      source.payloadSetDigest !== record.payloadSetDigest ||
      source.payloadDigest !== record.payloadDigest ||
      source.parentMessageId !== record.parentMessageId ||
      source.parentSendRecordDigest !== record.parentSendRecordDigest ||
      source.parentReceiveRecordDigest !== record.parentReceiveRecordDigest ||
      source.replyToMessageId !== record.replyToMessageId ||
      source.replyToSendRecordDigest !== record.replyToSendRecordDigest ||
      record.sentRecordDigest !== source.recordDigest
    ) {
      fail(
        "causal receive does not exactly authenticate its send event",
        "causal.received",
      );
    }
  }
  const roots = sent.filter((record) => record.parentMessageId === null);
  if (roots.length !== 1) {
    fail(
      "causal stream must have exactly one explicit root send",
      "causal.parents",
    );
  }
  for (const record of sent) {
    if (record.parentMessageId === null) continue;
    const parent = sentById.get(record.parentMessageId);
    const parentReceive = receivedById.get(record.parentMessageId);
    if (
      !parent ||
      !parentReceive ||
      parent.recordDigest !== record.parentSendRecordDigest ||
      parentReceive.sourceHostIdDigest !== record.sourceHostIdDigest ||
      parentReceive.recordDigest !== record.parentReceiveRecordDigest ||
      parentReceive.sentRecordDigest !== parent.recordDigest ||
      parentReceive.monotonicOffsetMs >= record.monotonicOffsetMs ||
      parent.messageId !== record.replyToMessageId ||
      parent.recordDigest !== record.replyToSendRecordDigest ||
      parent.fromHostIdDigest !== record.toHostIdDigest ||
      parent.toHostIdDigest !== record.fromHostIdDigest
    ) {
      fail(
        "causal send does not close an authenticated reverse-route parent/reply-to dependency",
        "causal.parents",
      );
    }
  }
  for (const record of sent) {
    const visited = new Set();
    let cursor = record;
    while (cursor.parentMessageId !== null) {
      if (visited.has(cursor.messageId)) {
        fail("causal parent graph contains a cycle", "causal.parents");
      }
      visited.add(cursor.messageId);
      cursor = sentById.get(cursor.parentMessageId);
    }
    if (cursor.messageId !== roots[0].messageId) {
      fail(
        "causal send is detached from the authenticated root dependency",
        "causal.parents",
      );
    }
  }
  return {
    messagesSent: sent.length,
    messagesReceived: received.length,
    causalOrderViolations: 0,
    lostMessages: sent.filter((record) => !receivedById.has(record.messageId))
      .length,
  };
}

const MIGRATION_BINDING_FIELDS = Object.freeze([
  "sourceVersion",
  "targetVersion",
  "sourceRuntimeArtifactDigest",
  "targetRuntimeArtifactDigest",
  "packageDigest",
  "packageSignatureDigest",
  "fixtureDigest",
  "sourceStateDigest",
  "migratedDigest",
]);

function deriveMigration(receipts) {
  requireLocalEventTypes(
    receipts,
    ["migration-case", "rollback-case"],
    "migration.hosts",
  );
  const records = keyedRecords(receipts);
  const migrations = records.filter(
    (record) => record.type === "migration-case",
  );
  const rollbacks = records.filter((record) => record.type === "rollback-case");
  requireUnique(
    migrations,
    (record) => record.sourceHostIdDigest + "\0" + record.caseId,
    "migration.cases",
  );
  requireUnique(
    rollbacks,
    (record) => record.sourceHostIdDigest + "\0" + record.caseId,
    "migration.rollbacks",
  );
  const migrationsByKey = new Map(
    migrations.map((record) => [
      record.sourceHostIdDigest + "\0" + record.caseId,
      record,
    ]),
  );
  const rollbacksByKey = new Map(
    rollbacks.map((record) => [
      record.sourceHostIdDigest + "\0" + record.caseId,
      record,
    ]),
  );
  if (migrationsByKey.size !== rollbacksByKey.size) {
    fail(
      "every migration case must have exactly one bound rollback",
      "migration.rollbacks",
    );
  }
  for (const [key, migration] of migrationsByKey) {
    const rollback = rollbacksByKey.get(key);
    if (
      !rollback ||
      MIGRATION_BINDING_FIELDS.some(
        (binding) => rollback[binding] !== migration[binding],
      ) ||
      Date.parse(rollback.at) <= Date.parse(migration.at)
    ) {
      fail(
        "rollback is orphaned from its exact host, runtime, package, fixture, and state case",
        "migration.rollbacks",
      );
    }
  }
  return {
    migrationCases: migrations.length,
    rollbackCases: rollbacks.length,
    digestMismatches: migrations.filter(
      (record) => record.migratedDigest !== record.expectedDigest,
    ).length,
    rollbackFailures: rollbacks.filter(
      (record) => record.restoredDigest !== record.sourceStateDigest,
    ).length,
  };
}

function deriveCrashRecovery(receipts) {
  requireLocalEventTypes(
    receipts,
    [
      "remote-update-originated",
      "remote-update-received",
      "committed-update",
      "process-crash",
      "recovered-update",
    ],
    "crashRecovery.hosts",
  );
  const allRecords = keyedRecords(receipts);
  const allCrashes = allRecords.filter(
    (record) => record.type === "process-crash",
  );
  requireUnique(
    allCrashes,
    (record) => record.crashId,
    "crashRecovery.crashes",
  );
  requireUnique(
    allCrashes,
    (record) => record.processInstanceId + "\0" + record.pid,
    "crashRecovery.processes",
  );
  requireUnique(
    allCrashes,
    (record) => record.killReceiptDigest,
    "crashRecovery.killReceipts",
  );
  const allRecovered = allRecords.filter(
    (record) => record.type === "recovered-update",
  );
  requireUnique(
    allRecovered,
    (record) => record.recoveryProcessInstanceId + "\0" + record.recoveryPid,
    "crashRecovery.replacementProcesses",
  );
  const crashedProcesses = new Set(
    allCrashes.map((record) => record.processInstanceId + "\0" + record.pid),
  );
  if (
    allRecovered.some((record) =>
      crashedProcesses.has(
        record.recoveryProcessInstanceId + "\0" + record.recoveryPid,
      ),
    )
  ) {
    fail(
      "replacement recovery process reuses a crashed process identity",
      "crashRecovery.replacementProcesses",
    );
  }
  const receiptHosts = new Set(
    receipts.map((receipt) => receipt.sourceHostIdDigest),
  );
  const origins = allRecords.filter(
    (record) => record.type === "remote-update-originated",
  );
  const receivedTransports = allRecords.filter(
    (record) => record.type === "remote-update-received",
  );
  requireUnique(
    origins,
    (record) => record.deliveryId,
    "crashRecovery.origins",
  );
  requireUnique(origins, (record) => record.updateId, "crashRecovery.origins");
  requireUnique(
    origins,
    (record) => record.targetCrashId,
    "crashRecovery.targetCrashes",
  );
  requireUnique(
    receivedTransports,
    (record) => record.deliveryId,
    "crashRecovery.deliveries",
  );
  const originsByDelivery = new Map(
    origins.map((record) => [record.deliveryId, record]),
  );
  const receivedByDelivery = new Map(
    receivedTransports.map((record) => [record.deliveryId, record]),
  );
  if (
    originsByDelivery.size !== receivedByDelivery.size ||
    [...originsByDelivery.keys()].some(
      (deliveryId) => !receivedByDelivery.has(deliveryId),
    )
  ) {
    fail(
      "every cross-host update origin must have exactly one target delivery",
      "crashRecovery.deliveries",
    );
  }
  const transportBindings = [
    "targetCrashId",
    "deliveryId",
    "updateId",
    "updateDigest",
    "packageDigest",
    "packageSignatureDigest",
    "collaborationFixtureDigest",
    "sessionId",
    "documentId",
    "originPeerId",
    "targetPeerId",
    "originHostIdDigest",
    "targetHostIdDigest",
  ];
  for (const received of receivedTransports) {
    const origin = originsByDelivery.get(received.deliveryId);
    if (
      !origin ||
      !receiptHosts.has(origin.originHostIdDigest) ||
      !receiptHosts.has(origin.targetHostIdDigest) ||
      origin.sourceHostIdDigest !== origin.originHostIdDigest ||
      received.sourceHostIdDigest !== origin.targetHostIdDigest ||
      received.originRecordDigest !== origin.recordDigest ||
      transportBindings.some((field) => received[field] !== origin[field])
    ) {
      fail(
        "remote collaboration delivery does not exactly authenticate its cross-host origin",
        "crashRecovery.deliveries",
      );
    }
  }
  let crashCount = 0;
  let recoveredUpdates = 0;
  let lostCommittedUpdates = 0;
  let duplicateRecoveredUpdates = 0;
  for (const receipt of receipts) {
    const receivedUpdates = receipt.records.filter(
      (record) => record.type === "remote-update-received",
    );
    const crashes = receipt.records.filter(
      (record) => record.type === "process-crash",
    );
    const committed = receipt.records.filter(
      (record) => record.type === "committed-update",
    );
    const recovered = receipt.records.filter(
      (record) => record.type === "recovered-update",
    );
    requireUnique(crashes, (record) => record.crashId, "crashRecovery.crashes");
    requireUnique(
      committed,
      (record) => record.crashId + "\0" + record.deliveryId,
      "crashRecovery.committed",
    );
    requireUnique(
      receivedUpdates,
      (record) => record.targetCrashId + "\0" + record.deliveryId,
      "crashRecovery.deliveries",
    );
    const receivedByKey = new Map(
      receivedUpdates.map((record) => [
        record.targetCrashId + "\0" + record.deliveryId,
        record,
      ]),
    );
    const crashesById = new Map(
      crashes.map((record) => [record.crashId, record]),
    );
    const committedByKey = new Map(
      committed.map((record) => [
        record.crashId + "\0" + record.deliveryId,
        record,
      ]),
    );
    const recoveredCounts = new Map();
    const crashCoverage = new Map(
      crashes.map((record) => [
        record.crashId,
        { received: 0, committed: 0, recovered: 0 },
      ]),
    );
    for (const record of committed) {
      const key = record.crashId + "\0" + record.deliveryId;
      const received = receivedByKey.get(key);
      const crash = crashesById.get(record.crashId);
      if (
        !received ||
        !crash ||
        !receiptHosts.has(record.remoteHostIdDigest) ||
        received.recordDigest !== record.receivedRecordDigest ||
        received.updateId !== record.updateId ||
        received.updateDigest !== record.updateDigest ||
        received.sessionId !== record.sessionId ||
        received.documentId !== record.documentId ||
        received.targetPeerId !== record.localPeerId ||
        received.originPeerId !== record.remotePeerId ||
        received.targetHostIdDigest !== record.localHostIdDigest ||
        received.originHostIdDigest !== record.remoteHostIdDigest ||
        received.monotonicOffsetMs >= record.monotonicOffsetMs ||
        record.packageDigest !== crash.packageDigest ||
        record.packageSignatureDigest !== crash.packageSignatureDigest ||
        record.collaborationFixtureDigest !==
          crash.collaborationFixtureDigest ||
        record.sessionId !== crash.sessionId ||
        record.documentId !== crash.documentId ||
        record.localPeerId !== crash.localPeerId ||
        record.remotePeerId !== crash.remotePeerId ||
        record.processInstanceId !== crash.processInstanceId ||
        record.pid !== crash.pid ||
        record.monotonicOffsetMs >=
          crash.killReceipt.requestedMonotonicOffsetMs ||
        record.monotonicOffsetMs >= crash.monotonicOffsetMs
      ) {
        fail(
          "remote update delivery/commit is not bound before its exact packaged process crash and peer host",
          "crashRecovery.committed",
        );
      }
      crashCoverage.get(record.crashId).received += 1;
      crashCoverage.get(record.crashId).committed += 1;
    }
    if (
      receivedByKey.size !== committedByKey.size ||
      [...receivedByKey.keys()].some((key) => !committedByKey.has(key))
    ) {
      fail(
        "every authenticated remote update delivery must have exactly one durable commit",
        "crashRecovery.committed",
      );
    }
    for (const record of recovered) {
      const key = record.crashId + "\0" + record.deliveryId;
      const source = committedByKey.get(key);
      const crash = crashesById.get(record.crashId);
      if (
        !source ||
        !crash ||
        record.packageDigest !== crash.packageDigest ||
        record.packageSignatureDigest !== crash.packageSignatureDigest ||
        record.collaborationFixtureDigest !==
          crash.collaborationFixtureDigest ||
        record.sessionId !== crash.sessionId ||
        record.documentId !== crash.documentId ||
        record.localPeerId !== crash.localPeerId ||
        record.remotePeerId !== crash.remotePeerId ||
        record.localHostIdDigest !== crash.localHostIdDigest ||
        record.remoteHostIdDigest !== crash.remoteHostIdDigest ||
        record.deliveryId !== source.deliveryId ||
        record.updateId !== source.updateId ||
        record.updateDigest !== source.updateDigest ||
        record.commitRecordDigest !== source.recordDigest ||
        record.crashRecordDigest !== crash.recordDigest ||
        record.crashedProcessInstanceId !== crash.processInstanceId ||
        record.crashedPid !== crash.pid ||
        record.recoveryPreDigest !== source.commitPreDigest ||
        record.recoveryPostDigest !== source.commitPostDigest ||
        record.monotonicOffsetMs <= crash.monotonicOffsetMs
      ) {
        fail(
          "recovered update does not prove the exact pre-crash durable state was restored by a replacement process",
          "crashRecovery.recovered",
        );
      }
      recoveredCounts.set(key, (recoveredCounts.get(key) || 0) + 1);
      crashCoverage.get(record.crashId).recovered += 1;
    }
    for (const [crashId, coverage] of crashCoverage) {
      const crash = crashesById.get(crashId);
      const crashCommits = committed
        .filter((record) => record.crashId === crashId)
        .sort(
          (left, right) => left.monotonicOffsetMs - right.monotonicOffsetMs,
        );
      if (
        coverage.received <
          receipt.scenarioInput.minimumRemoteUpdatesPerCrash ||
        coverage.committed <
          receipt.scenarioInput.minimumRemoteUpdatesPerCrash ||
        coverage.recovered !== coverage.committed ||
        crashCommits.at(-1)?.recordDigest !== crash.lastCommittedRecordDigest
      ) {
        fail(
          "every forced crash must bind the protected remote delivery/commit/replacement recovery workload",
          "crashRecovery",
        );
      }
    }
    crashCount += crashes.length;
    recoveredUpdates += recovered.length;
    lostCommittedUpdates += committed.filter(
      (record) =>
        !recoveredCounts.has(record.crashId + "\0" + record.deliveryId),
    ).length;
    duplicateRecoveredUpdates += [...recoveredCounts.values()].reduce(
      (total, count) => total + Math.max(0, count - 1),
      0,
    );
  }
  return {
    crashCount,
    recoveredUpdates,
    lostCommittedUpdates,
    duplicateRecoveredUpdates,
  };
}

function deriveMtc(receipts) {
  requireLocalEventTypes(
    receipts,
    [
      "roundtrip-request-sent",
      "roundtrip-request-received",
      "roundtrip-response-sent",
      "roundtrip-response-received",
    ],
    "mtc.hosts",
  );
  const records = keyedRecords(receipts);
  const requests = records.filter(
    (record) => record.type === "roundtrip-request-sent",
  );
  const requestReceipts = records.filter(
    (record) => record.type === "roundtrip-request-received",
  );
  const responses = records.filter(
    (record) => record.type === "roundtrip-response-sent",
  );
  const responseReceipts = records.filter(
    (record) => record.type === "roundtrip-response-received",
  );
  for (const [recordsForType, field] of [
    [requests, "mtc.requests"],
    [requestReceipts, "mtc.requestReceipts"],
    [responses, "mtc.responses"],
    [responseReceipts, "mtc.responseReceipts"],
  ]) {
    requireUnique(recordsForType, (record) => record.roundTripId, field);
  }
  const requestsByRoundTrip = new Map(
    requests.map((record) => [record.roundTripId, record]),
  );
  const requestReceiptsByRoundTrip = new Map(
    requestReceipts.map((record) => [record.roundTripId, record]),
  );
  const responsesByRoundTrip = new Map(
    responses.map((record) => [record.roundTripId, record]),
  );
  const responseReceiptsByRoundTrip = new Map(
    responseReceipts.map((record) => [record.roundTripId, record]),
  );
  requireUnique(requests, (record) => record.requestId, "mtc.requestIds");
  requireUnique(responses, (record) => record.responseId, "mtc.responseIds");
  for (const collection of [requestReceipts, responses, responseReceipts]) {
    if (
      collection.some((record) => !requestsByRoundTrip.has(record.roundTripId))
    ) {
      fail("MTC receipt contains an orphan roundtrip phase", "mtc.roundTrips");
    }
  }
  for (const receipt of receipts) {
    const initiated = requests.filter(
      (record) => record.sourceHostIdDigest === receipt.sourceHostIdDigest,
    ).length;
    if (initiated < receipt.scenarioInput.minimumRoundTripsPerHost) {
      fail(
        "each physical host must initiate the protected minimum MTC roundtrip workload",
        "mtc.requests",
      );
    }
  }
  let lostMessages = 0;
  for (const request of requests) {
    const received = requestReceiptsByRoundTrip.get(request.roundTripId);
    const response = responsesByRoundTrip.get(request.roundTripId);
    const responseReceived = responseReceiptsByRoundTrip.get(
      request.roundTripId,
    );
    if (!received || !response || !responseReceived) {
      lostMessages += 1;
      continue;
    }
    if (
      received.requestId !== request.requestId ||
      received.requestPayloadDigest !== request.requestPayloadDigest ||
      received.requestSendRecordDigest !== request.recordDigest ||
      responseReceived.sourceHostIdDigest !== request.sourceHostIdDigest ||
      request.monotonicOffsetMs >= responseReceived.monotonicOffsetMs ||
      response.sourceHostIdDigest !== received.sourceHostIdDigest ||
      received.monotonicOffsetMs >= response.monotonicOffsetMs ||
      received.fromHostIdDigest !== request.fromHostIdDigest ||
      received.toHostIdDigest !== request.toHostIdDigest ||
      response.requestId !== request.requestId ||
      response.replyToRequestId !== request.requestId ||
      response.replyToRequestSendRecordDigest !== request.recordDigest ||
      response.requestReceiveRecordDigest !== received.recordDigest ||
      response.fromHostIdDigest !== request.toHostIdDigest ||
      response.toHostIdDigest !== request.fromHostIdDigest ||
      responseReceived.requestId !== request.requestId ||
      responseReceived.responseId !== response.responseId ||
      responseReceived.requestPayloadDigest !== request.requestPayloadDigest ||
      responseReceived.responsePayloadDigest !==
        response.responsePayloadDigest ||
      responseReceived.replyToRequestId !== request.requestId ||
      responseReceived.replyToRequestSendRecordDigest !==
        request.recordDigest ||
      responseReceived.requestReceiveRecordDigest !== received.recordDigest ||
      responseReceived.responseSendRecordDigest !== response.recordDigest ||
      responseReceived.fromHostIdDigest !== response.fromHostIdDigest ||
      responseReceived.toHostIdDigest !== response.toHostIdDigest
    ) {
      fail(
        "MTC request/response/replyTo records do not form one authenticated bidirectional roundtrip",
        "mtc.roundTrips",
      );
    }
  }
  return {
    messagesSent: requests.length + responses.length,
    messagesDelivered: requestReceipts.length + responseReceipts.length,
    duplicateEffects: 0,
    lostMessages,
  };
}

function deriveSoak(receipts, window) {
  requireLocalEventTypes(
    receipts,
    ["runtime-sample", "operation-completed"],
    "soak.hosts",
  );
  const soakContract =
    P1_10_SCENARIO_CONTRACT.scenarios["long-running-desktop-soak"];
  const records = keyedRecords(receipts);
  const samples = records.filter((record) => record.type === "runtime-sample");
  const operations = records.filter(
    (record) => record.type === "operation-completed",
  );
  requireUnique(
    samples,
    (record) => record.sourceHostIdDigest + "\0" + record.sampleId,
    "soak.samples",
  );
  requireUnique(
    operations,
    (record) => record.sourceHostIdDigest + "\0" + record.operationId,
    "soak.operations",
  );
  const baselines = new Map();
  for (const receipt of receipts) {
    const hostSamples = receipt.records.filter(
      (record) => record.type === "runtime-sample",
    );
    const hostOperations = receipt.records.filter(
      (record) => record.type === "operation-completed",
    );
    if (hostSamples.length < 2) {
      fail(
        "soak receipt requires fixed-cadence samples after warmup",
        "soak.samples",
      );
    }
    const first = hostSamples[0];
    const last = hostSamples.at(-1);
    const expectedBaselineMs = Math.max(
      Date.parse(window.startedAt),
      Date.parse(receipt.startedAt) + soakContract.warmupMs,
    );
    if (
      Date.parse(first.at) < expectedBaselineMs ||
      Date.parse(first.at) - expectedBaselineMs > soakContract.maxSampleGapMs ||
      Date.parse(window.endedAt) - Date.parse(last.at) >
        soakContract.maxSampleGapMs ||
      hostSamples.some(
        (sample, index) =>
          index > 0 &&
          Date.parse(sample.at) - Date.parse(hostSamples[index - 1].at) >
            soakContract.maxSampleGapMs,
      )
    ) {
      fail(
        "soak samples exceed the protected post-warmup cadence or omit a boundary",
        "soak.samples",
      );
    }
    if (
      hostOperations.some(
        (operation) => Date.parse(operation.at) <= Date.parse(first.at),
      ) ||
      hostOperations.length < 1 ||
      Date.parse(last.at) <=
        Math.max(...hostOperations.map((operation) => Date.parse(operation.at)))
    ) {
      fail(
        "soak operations must complete after the fixed baseline and before the final sample",
        "soak.operations",
      );
    }
    for (let index = 1; index < hostSamples.length; index += 1) {
      const intervalStart = Date.parse(hostSamples[index - 1].at);
      const intervalEnd = Date.parse(hostSamples[index].at);
      const intervalOperations = hostOperations.filter((operation) => {
        const at = Date.parse(operation.at);
        return at > intervalStart && at <= intervalEnd;
      });
      if (
        intervalOperations.length <
        receipt.scenarioInput.minimumOperationsPerWindow
      ) {
        fail(
          "every post-baseline soak cadence interval must contain the protected operation workload",
          "soak.operations",
        );
      }
    }
    baselines.set(receipt.sourceHostIdDigest, {
      listenerCount: first.listenerCount,
      timerCount: first.timerCount,
    });
  }
  return {
    samples: samples.length,
    completedOperations: operations.length,
    backlogLimitViolations: samples.filter(
      (record) => record.backlogSize > soakContract.backlogLimit,
    ).length,
    leakedListeners: samples.filter(
      (record) =>
        record.listenerCount -
          baselines.get(record.sourceHostIdDigest).listenerCount >
        soakContract.maxListenerGrowth,
    ).length,
    leakedTimers: samples.filter(
      (record) =>
        record.timerCount -
          baselines.get(record.sourceHostIdDigest).timerCount >
        soakContract.maxTimerGrowth,
    ).length,
    unsettledTasks: samples.reduce(
      (total, record) => total + record.unsettledTasks,
      0,
    ),
  };
}

export function deriveScenarioMetrics(requirement, receipts) {
  const overlap = normalizedScenarioOverlap(requirement, receipts);
  const { scenario, contract, window } = overlap;
  receipts = overlap.receipts;
  let metrics;
  if (scenario === "real-multi-host-causal-agent-stream") {
    metrics = deriveCausal(receipts);
  } else if (scenario === "cross-version-graph-definition-migration") {
    metrics = deriveMigration(receipts);
  } else if (scenario === "packaged-electron-collaboration-crash-recovery") {
    metrics = deriveCrashRecovery(receipts);
  } else if (scenario === "two-physical-host-mtc-roundtrip") {
    metrics = deriveMtc(receipts);
  } else if (scenario === "long-running-desktop-soak") {
    metrics = deriveSoak(receipts, window);
  } else {
    fail("unsupported P1-10 scenario: " + scenario, "scenario");
  }
  return exactMetricContract(requirement, contract, metrics);
}
