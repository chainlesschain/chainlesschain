import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
const { createDesktopModelIngressHost } = require("../desktop-model-ingress");
const {
  loadDesktopEvolutionDependencies,
} = require("../desktop-evolution-deployment");
const { LLMManager } = require("../../llm/llm-manager");
const {
  createDesktopPmWorkspaceSnapshotter,
} = require("../desktop-pm-workspace-snapshot");
const {
  createDesktopPmExplorationReadinessHost,
  inspectDesktopPmExplorationReadiness,
  isDesktopPmExplorationReadinessHost,
} = require("../desktop-pm-exploration-readiness");

let storageHost;
let unreadableStorageHost;
let executionHost;

async function createStorageHost(load) {
  const store = Object.freeze({});
  const dependencies = await loadDesktopEvolutionDependencies({
    importLoader: async () => ({
      loadEvolutionDeploymentCommandDependencies: async () => ({
        pmExplorationLedgerStore: store,
      }),
    }),
    importPmExplorationLedgerModule: async () => ({
      capturePmExplorationLedgerStore(value) {
        if (value !== store) throw new TypeError("unbranded store");
        return Object.freeze({ load });
      },
    }),
  });
  return dependencies.desktopPmExplorationStorageHost;
}

async function createExecutionHost({ includeSnapshotStore = true } = {}) {
  const host = Object.freeze({});
  const committer = Object.freeze({});
  const snapshotStore = Object.freeze({});
  const manifestDigest = `sha256:${"2".repeat(64)}`;
  const workspaceSnapshotter = createDesktopPmWorkspaceSnapshotter({
    manifestDigest,
    workspaceRoot: process.cwd(),
    includePaths: ["package.json"],
    maxFileCount: 1,
    maxFileBytes: 1024 * 1024,
    maxSnapshotBytes: 2 * 1024 * 1024,
  });
  const dependencies = await loadDesktopEvolutionDependencies({
    importLoader: async () => ({
      loadEvolutionDeploymentCommandDependencies: async () => ({
        pmExplorationExecutionHost: host,
        pmExplorationTransitionCommitter: committer,
        ...(includeSnapshotStore
          ? {
              pmExplorationRecoverySnapshotStore: snapshotStore,
              pmExplorationWorkspaceSnapshotter: workspaceSnapshotter,
            }
          : {}),
      }),
    }),
    importPmExplorationExecutionModule: async () => ({
      isPmExplorationExecutionHost: (value) => value === host,
      inspectPmExplorationExecutionHost: () => ({
        manifestDigest,
        preRunSealDigest: `sha256:${"1".repeat(64)}`,
      }),
      executePmExplorationRound: vi.fn(),
      mergePmExplorationBranches: vi.fn(),
      evaluatePmExplorationMemory: vi.fn(),
    }),
    importPmExplorationTransitionModule: async () => ({
      capturePmExplorationTransitionCommitter(value) {
        if (value !== committer) throw new TypeError("unbranded committer");
        return Object.freeze({
          manifestDigest,
          commitTransition: vi.fn(),
          recoverTransition: vi.fn(async () => ({
            schema: "chainlesschain.pm-exploration-transition-recovery/v1",
            authenticated: true,
            durable: true,
            readbackVerified: true,
            manifestDigest,
            revision: 0,
            transitionKind: null,
            evidenceDigest: null,
            evidence: null,
            ledgerHeadDigest: `sha256:${"3".repeat(64)}`,
            ledgerEventDigest: null,
            durabilityReceiptDigest: null,
            qualifiesForPromotion: false,
          })),
        });
      },
    }),
    importPmExplorationRecoverySnapshotModule: async () => ({
      capturePmExplorationRecoverySnapshotStore(value) {
        if (value !== snapshotStore) throw new TypeError("unbranded store");
        return Object.freeze({
          manifestDigest,
          retainTransitionSnapshot: vi.fn(),
        });
      },
    }),
  });
  return dependencies.desktopPmExplorationExecutionHost;
}

beforeAll(async () => {
  storageHost = await createStorageHost(() => null);
  unreadableStorageHost = await createStorageHost(() => {
    throw new Error("corrupt ledger");
  });
  executionHost = await createExecutionHost();
});

function environment() {
  return {
    NODE_ENV: "production",
    MOCK_LLM: "false",
    MOCK_HARDWARE: "false",
    SKIP_SLOW_INIT: "false",
    CHAINLESSCHAIN_DISABLE_NATIVE_DB: "0",
    CHAINLESSCHAIN_DISABLE_DB_PERSISTENCE: "0",
    CC_IPC_ACTOR_GUARD: "enforce",
    CC_IPC_RBAC_GUARD: "enforce",
  };
}

function readyDependencies() {
  const ingressHost = createDesktopModelIngressHost(async () => null);
  const llmManager = new LLMManager(
    { provider: "ollama", enableStateBus: false },
    ingressHost,
  );
  llmManager.isInitialized = true;
  llmManager.client = { checkStatus: vi.fn() };
  llmManager.paused = false;
  return {
    desktopModelIngressHost: ingressHost,
    llmManager,
    didManager: { getCurrentIdentity: () => ({ did: "did:key:real-user" }) },
    database: {
      getDatabase: () => ({
        prepare: (sql) => ({
          get: () => ({ ok: sql === "SELECT 1 AS ok" ? 1 : 0 }),
        }),
      }),
      getCurrentDatabasePath: () => path.resolve("test-data", "pm.db"),
    },
    environment: environment(),
    pmExplorationExecutionHost: executionHost,
    pmExplorationStorageHost: storageHost,
  };
}

function inspect(overrides = {}) {
  return inspectDesktopPmExplorationReadiness(
    createDesktopPmExplorationReadinessHost({
      ...readyDependencies(),
      ...overrides,
    }),
  );
}

describe("Desktop PM exploration readiness host", () => {
  it("brands an opaque main-process host", () => {
    const host = createDesktopPmExplorationReadinessHost(readyDependencies());
    expect(isDesktopPmExplorationReadinessHost(host)).toBe(true);
    expect(Object.keys(host)).toEqual([]);
    expect(Object.isFrozen(host)).toBe(true);
    expect(() => inspectDesktopPmExplorationReadiness({})).toThrow(/branded/);
  });

  it("projects compatible local prerequisites but never grants execution", () => {
    const result = inspect();
    expect(result).toMatchObject({
      status: "requires-runtime-evidence",
      configurationCompatible: true,
      readyForExecution: false,
      runtimeVerified: false,
      authenticated: false,
      qualifiesForPromotion: false,
    });
    expect(result.checks.every((entry) => entry.passed)).toBe(true);
    expect(result.missingRuntimeEvidence).toContain("live-provider-probe");
    expect(result.missingRuntimeEvidence).toContain(
      "signed-database-pre-run-seal",
    );
    expect(result.missingRuntimeEvidence).toContain(
      "authenticated-transition-durability-ack",
    );
    expect(result.missingRuntimeEvidence).toContain(
      "snapshot-bound-transition-durability-ack",
    );
    expect(result.missingRuntimeEvidence).toContain(
      "authenticated-failure-transition-evidence",
    );
    expect(result.missingRuntimeEvidence).toContain(
      "host-enforced-structured-tool-policy",
    );
    expect(
      result.checks.find((entry) => entry.id === "signed-execution-host")
        .passed,
    ).toBe(true);
    expect(
      result.checks.find((entry) => entry.id === "execution-host-untainted")
        .passed,
    ).toBe(true);
    expect(
      result.checks.find((entry) => entry.id === "signed-transition-committer")
        .passed,
    ).toBe(true);
    expect(
      result.checks.find((entry) => entry.id === "signed-transition-recovery")
        .passed,
    ).toBe(true);
    expect(
      result.checks.find(
        (entry) => entry.id === "durable-database-recovery-snapshot",
      ).passed,
    ).toBe(true);
    expect(result.recoveryStorage).toEqual({
      configured: true,
      readable: true,
      snapshotAvailable: false,
      snapshotAuthenticated: false,
      durableSnapshotAvailable: false,
      powerLossDurabilityTested: false,
      qualifiesForPromotion: false,
    });
    expect(result.projectionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("does not call the provider during a read-only inspection", () => {
    const dependencies = readyDependencies();
    const checkStatus = dependencies.llmManager.client.checkStatus;
    inspectDesktopPmExplorationReadiness(
      createDesktopPmExplorationReadinessHost(dependencies),
    );
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it("rejects an unbranded manager even when its public flags look ready", () => {
    const result = inspect({
      llmManager: { isInitialized: true, client: {}, paused: false },
    });
    expect(result.status).toBe("blocked");
    expect(
      result.checks.find((entry) => entry.id === "governed-llm-manager").passed,
    ).toBe(false);
  });

  it.each([
    ["CC_IPC_ACTOR_GUARD", "off"],
    ["CC_IPC_RBAC_GUARD", "report"],
    ["MOCK_LLM", "true"],
    ["CHAINLESSCHAIN_DISABLE_DB_PERSISTENCE", "1"],
    ["NODE_ENV", "test"],
  ])("blocks incompatible %s", (key, value) => {
    const result = inspect({ environment: { ...environment(), [key]: value } });
    expect(result.status).toBe("blocked");
    expect(
      result.checks.find((entry) => entry.id === `environment:${key}`).passed,
    ).toBe(false);
  });

  it("blocks a missing identity, unusable database or relative path", () => {
    const missingIdentity = inspect({
      didManager: { getCurrentIdentity: () => null },
    });
    expect(
      missingIdentity.checks.find((entry) => entry.id === "unlocked-identity")
        .passed,
    ).toBe(false);

    const unusableDatabase = inspect({
      database: {
        getDatabase: () => ({ prepare: () => ({ get: () => ({ ok: 0 }) }) }),
        getCurrentDatabasePath: () => "relative.db",
      },
    });
    expect(unusableDatabase.configurationCompatible).toBe(false);
    expect(
      unusableDatabase.checks.find((entry) => entry.id === "database-query")
        .passed,
    ).toBe(false);
    expect(
      unusableDatabase.checks.find((entry) => entry.id === "database-path")
        .passed,
    ).toBe(false);
  });

  it("blocks a missing, unbranded or unreadable recovery store", () => {
    for (const pmExplorationStorageHost of [
      null,
      Object.freeze({}),
      unreadableStorageHost,
    ]) {
      const result = inspect({ pmExplorationStorageHost });
      expect(result.status).toBe("blocked");
      expect(result.configurationCompatible).toBe(false);
    }
    const missing = inspect({ pmExplorationStorageHost: null });
    expect(
      missing.checks.find((entry) => entry.id === "durable-recovery-store")
        .passed,
    ).toBe(false);
    const unreadable = inspect({
      pmExplorationStorageHost: unreadableStorageHost,
    });
    expect(
      unreadable.checks.find((entry) => entry.id === "recovery-store-readable")
        .passed,
    ).toBe(false);
  });

  it("blocks a missing or unbranded signed execution host", () => {
    for (const pmExplorationExecutionHost of [null, Object.freeze({})]) {
      const result = inspect({ pmExplorationExecutionHost });
      expect(result.status).toBe("blocked");
      expect(result.configurationCompatible).toBe(false);
      expect(
        result.checks.find((entry) => entry.id === "signed-execution-host")
          .passed,
      ).toBe(false);
      expect(
        result.checks.find((entry) => entry.id === "execution-host-untainted")
          .passed,
      ).toBe(false);
    }
  });

  it("blocks an execution host without a signed transition committer", async () => {
    const hostWithoutCommitter = await (async () => {
      const host = Object.freeze({});
      const dependencies = await loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationExecutionHost: host,
          }),
        }),
        importPmExplorationExecutionModule: async () => ({
          isPmExplorationExecutionHost: (value) => value === host,
          inspectPmExplorationExecutionHost: () => ({
            manifestDigest: `sha256:${"2".repeat(64)}`,
            preRunSealDigest: `sha256:${"1".repeat(64)}`,
          }),
          executePmExplorationRound: vi.fn(),
          mergePmExplorationBranches: vi.fn(),
          evaluatePmExplorationMemory: vi.fn(),
        }),
      });
      return dependencies.desktopPmExplorationExecutionHost;
    })();

    const result = inspect({
      pmExplorationExecutionHost: hostWithoutCommitter,
    });
    expect(result.status).toBe("blocked");
    expect(
      result.checks.find((entry) => entry.id === "signed-transition-committer")
        .passed,
    ).toBe(false);
  });

  it("blocks a transition committer without authenticated recovery readback", async () => {
    const host = Object.freeze({});
    const committer = Object.freeze({});
    const manifestDigest = `sha256:${"2".repeat(64)}`;
    const dependencies = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: host,
          pmExplorationTransitionCommitter: committer,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === host,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: `sha256:${"1".repeat(64)}`,
        }),
        executePmExplorationRound: vi.fn(),
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: () => ({
          manifestDigest,
          commitTransition: vi.fn(),
          recoverTransition: null,
        }),
      }),
    });

    const result = inspect({
      pmExplorationExecutionHost:
        dependencies.desktopPmExplorationExecutionHost,
    });
    expect(result.status).toBe("blocked");
    expect(
      result.checks.find((entry) => entry.id === "signed-transition-committer")
        .passed,
    ).toBe(true);
    expect(
      result.checks.find((entry) => entry.id === "signed-transition-recovery")
        .passed,
    ).toBe(false);
  });

  it("blocks an execution host without durable database snapshot retention", async () => {
    const hostWithoutSnapshots = await createExecutionHost({
      includeSnapshotStore: false,
    });
    const result = inspect({
      pmExplorationExecutionHost: hostWithoutSnapshots,
    });

    expect(result.status).toBe("blocked");
    expect(
      result.checks.find((entry) => entry.id === "signed-transition-recovery")
        .passed,
    ).toBe(true);
    expect(
      result.checks.find(
        (entry) => entry.id === "durable-database-recovery-snapshot",
      ).passed,
    ).toBe(false);
  });

  it("does not invoke accessor traps or expose identity, path or environment values", () => {
    const getter = vi.fn(() => {
      throw new Error("must not run");
    });
    const environmentWithGetter = environment();
    Object.defineProperty(environmentWithGetter, "MOCK_LLM", {
      enumerable: true,
      get: getter,
    });
    const didManager = Object.defineProperty({}, "getCurrentIdentity", {
      enumerable: true,
      get: getter,
    });
    const result = inspect({ environment: environmentWithGetter, didManager });
    expect(getter).not.toHaveBeenCalled();
    expect(result.status).toBe("blocked");
    const encoded = JSON.stringify(result);
    expect(encoded).not.toContain("did:key:real-user");
    expect(encoded).not.toContain("pm.db");
    expect(encoded).not.toContain("production");
  });

  it("rejects accessor host inputs before reading them", () => {
    const dependencies = readyDependencies();
    const getter = vi.fn();
    Object.defineProperty(dependencies, "database", {
      enumerable: true,
      get: getter,
    });
    expect(() => createDesktopPmExplorationReadinessHost(dependencies)).toThrow(
      /accessor fields/,
    );
    expect(getter).not.toHaveBeenCalled();
  });
});
