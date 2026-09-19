"use strict";

const { createHash } = require("node:crypto");
const path = require("node:path");
const { types } = require("node:util");
const { isDesktopModelIngressHost } = require("./desktop-model-ingress");
const {
  inspectDesktopPmExplorationExecutionHost,
  inspectDesktopPmExplorationStorageHost,
  isDesktopPmExplorationExecutionHost,
  isDesktopPmExplorationStorageHost,
} = require("./desktop-evolution-deployment");
const { isGovernedLLMManager } = require("../llm/llm-manager");

const HOSTS = new WeakMap();
const REQUIRED_ENVIRONMENT = Object.freeze({
  NODE_ENV: "production",
  MOCK_LLM: "false",
  MOCK_HARDWARE: "false",
  SKIP_SLOW_INIT: "false",
  CHAINLESSCHAIN_DISABLE_NATIVE_DB: "0",
  CHAINLESSCHAIN_DISABLE_DB_PERSISTENCE: "0",
  CC_IPC_ACTOR_GUARD: "enforce",
  CC_IPC_RBAC_GUARD: "enforce",
});
const MISSING_RUNTIME_EVIDENCE = Object.freeze([
  "live-provider-probe",
  "signed-database-pre-run-seal",
  "authenticated-transition-durability-ack",
  "snapshot-bound-transition-durability-ack",
  "authenticated-failure-transition-evidence",
  "host-enforced-structured-tool-policy",
  "disposable-workspace-and-database-reset",
  "host-enforced-token-tool-time-budget",
  "signed-independent-grader-receipt",
  "restart-persistence-and-no-residue-drill",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update("chainlesschain.desktop-pm-exploration-readiness/v1\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function exactRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function captureMethod(owner, name) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner)) return null;
  let current = owner;
  while (current && current !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) {
      if (
        !("value" in descriptor) ||
        typeof descriptor.value !== "function" ||
        types.isProxy(descriptor.value)
      ) {
        return null;
      }
      return descriptor.value.bind(owner);
    }
    current = Object.getPrototypeOf(current);
  }
  return null;
}

function ownData(owner, key) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner))
    return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function environmentValue(environment, key) {
  if (
    !environment ||
    typeof environment !== "object" ||
    types.isProxy(environment)
  )
    return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(environment, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function check(id, passed, code) {
  return Object.freeze({ id, passed: passed === true, code });
}

function safeCall(work) {
  try {
    return { ok: true, value: work() };
  } catch {
    return { ok: false, value: null };
  }
}

function identityAvailable(getCurrentIdentity) {
  if (!getCurrentIdentity) return false;
  const result = safeCall(getCurrentIdentity);
  if (
    !result.ok ||
    !result.value ||
    typeof result.value !== "object" ||
    types.isProxy(result.value)
  ) {
    return false;
  }
  const did = ownData(result.value, "did");
  return (
    typeof did === "string" &&
    did.length >= 8 &&
    did.length <= 512 &&
    did.startsWith("did:")
  );
}

function databaseProjection(getDatabase, getCurrentDatabasePath) {
  if (!getDatabase || !getCurrentDatabasePath)
    return { queryReady: false, pathReady: false };
  const databaseResult = safeCall(getDatabase);
  const pathResult = safeCall(getCurrentDatabasePath);
  const database = databaseResult.value;
  const prepare = captureMethod(database, "prepare");
  let queryReady = false;
  if (databaseResult.ok && prepare) {
    const statementResult = safeCall(() => prepare("SELECT 1 AS ok"));
    const get = captureMethod(statementResult.value, "get");
    if (statementResult.ok && get) {
      const rowResult = safeCall(() => get());
      queryReady = rowResult.ok && ownData(rowResult.value, "ok") === 1;
    }
  }
  return {
    queryReady,
    pathReady:
      pathResult.ok &&
      typeof pathResult.value === "string" &&
      path.isAbsolute(pathResult.value),
  };
}

function createDesktopPmExplorationReadinessHost(input) {
  exactRecord(
    input,
    [
      "desktopModelIngressHost",
      "llmManager",
      "didManager",
      "database",
      "environment",
      "pmExplorationExecutionHost",
      "pmExplorationStorageHost",
    ],
    "Desktop PM readiness host input",
  );
  const host = Object.freeze({});
  HOSTS.set(
    host,
    Object.freeze({
      desktopModelIngressHost: input.desktopModelIngressHost,
      llmManager: input.llmManager,
      getCurrentIdentity: captureMethod(input.didManager, "getCurrentIdentity"),
      getDatabase: captureMethod(input.database, "getDatabase"),
      getCurrentDatabasePath: captureMethod(
        input.database,
        "getCurrentDatabasePath",
      ),
      environment: input.environment,
      pmExplorationExecutionHost: input.pmExplorationExecutionHost,
      pmExplorationStorageHost: input.pmExplorationStorageHost,
    }),
  );
  return host;
}

function isDesktopPmExplorationReadinessHost(value) {
  return HOSTS.has(value);
}

/**
 * Main-process-only, read-only projection. This is not an execution token,
 * signed receipt, provider health check, or permission to start exploration.
 */
function inspectDesktopPmExplorationReadiness(host) {
  const captured = HOSTS.get(host);
  if (!captured)
    throw new TypeError("A branded Desktop PM readiness host is required");
  const llmManager = captured.llmManager;
  const database = databaseProjection(
    captured.getDatabase,
    captured.getCurrentDatabasePath,
  );
  const storage = inspectDesktopPmExplorationStorageHost(
    captured.pmExplorationStorageHost,
  );
  const execution = safeCall(() =>
    inspectDesktopPmExplorationExecutionHost(
      captured.pmExplorationExecutionHost,
    ),
  );
  const checks = [
    check(
      "governed-model-ingress",
      isDesktopModelIngressHost(captured.desktopModelIngressHost),
      "PM_GOVERNED_MODEL_INGRESS_REQUIRED",
    ),
    check(
      "governed-llm-manager",
      Boolean(llmManager) &&
        !types.isProxy(llmManager) &&
        isGovernedLLMManager(llmManager),
      "PM_GOVERNED_LLM_MANAGER_REQUIRED",
    ),
    check(
      "initialized-llm-client",
      ownData(llmManager, "isInitialized") === true &&
        ownData(llmManager, "client") != null &&
        ownData(llmManager, "paused") !== true,
      "PM_INITIALIZED_LLM_CLIENT_REQUIRED",
    ),
    check(
      "unlocked-identity",
      identityAvailable(captured.getCurrentIdentity),
      "PM_UNLOCKED_IDENTITY_REQUIRED",
    ),
    check("database-query", database.queryReady, "PM_DATABASE_QUERY_REQUIRED"),
    check(
      "database-path",
      database.pathReady,
      "PM_ABSOLUTE_DATABASE_PATH_REQUIRED",
    ),
    check(
      "durable-recovery-store",
      isDesktopPmExplorationStorageHost(captured.pmExplorationStorageHost) &&
        storage.configured,
      "PM_DURABLE_RECOVERY_STORE_REQUIRED",
    ),
    check(
      "signed-execution-host",
      isDesktopPmExplorationExecutionHost(captured.pmExplorationExecutionHost),
      "PM_SIGNED_EXECUTION_HOST_REQUIRED",
    ),
    check(
      "execution-host-untainted",
      execution.ok && ownData(execution.value, "tainted") === false,
      "PM_EXECUTION_HOST_RECOVERY_REQUIRED",
    ),
    check(
      "signed-transition-committer",
      execution.ok &&
        ownData(execution.value, "transitionDurabilityConfigured") === true,
      "PM_SIGNED_TRANSITION_COMMITTER_REQUIRED",
    ),
    check(
      "signed-transition-recovery",
      execution.ok &&
        ownData(execution.value, "transitionRecoveryConfigured") === true,
      "PM_SIGNED_TRANSITION_RECOVERY_REQUIRED",
    ),
    check(
      "durable-database-recovery-snapshot",
      execution.ok &&
        ownData(execution.value, "recoverySnapshotConfigured") === true,
      "PM_DURABLE_DATABASE_RECOVERY_SNAPSHOT_REQUIRED",
    ),
    check(
      "durable-workspace-recovery-snapshot",
      execution.ok &&
        ownData(execution.value, "workspaceSnapshotConfigured") === true,
      "PM_DURABLE_WORKSPACE_RECOVERY_SNAPSHOT_REQUIRED",
    ),
    check(
      "recovery-store-readable",
      storage.readable,
      "PM_RECOVERY_STORE_READABLE_REQUIRED",
    ),
    ...Object.entries(REQUIRED_ENVIRONMENT).map(([key, required]) =>
      check(
        `environment:${key}`,
        environmentValue(captured.environment, key) === required,
        `PM_ENVIRONMENT_${key}_REQUIRED`,
      ),
    ),
  ];
  const configurationCompatible = checks.every((entry) => entry.passed);
  const core = Object.freeze({
    schema: "chainlesschain.desktop-pm-exploration-readiness/v1",
    status: configurationCompatible ? "requires-runtime-evidence" : "blocked",
    configurationCompatible,
    checks: Object.freeze(checks),
    recoveryStorage: storage,
    missingRuntimeEvidence: MISSING_RUNTIME_EVIDENCE,
    readyForExecution: false,
    runtimeVerified: false,
    authenticated: false,
    qualifiesForPromotion: false,
  });
  return Object.freeze({ ...core, projectionDigest: digest(core) });
}

module.exports = {
  createDesktopPmExplorationReadinessHost,
  inspectDesktopPmExplorationReadiness,
  isDesktopPmExplorationReadinessHost,
};
