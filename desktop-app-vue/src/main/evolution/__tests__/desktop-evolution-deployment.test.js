import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
const {
  ARTIFACT_TYPE,
} = require("@chainlesschain/session-core/evolvable-artifact");
const {
  evaluateDesktopPmExplorationMemory,
  executeDesktopPmExplorationRound,
  inspectDesktopPmExplorationStorageHost,
  isDesktopPmExplorationExecutionHost,
  isDesktopPmExplorationStorageHost,
  loadDesktopEvolutionDependencies,
  mergeDesktopPmExplorationBranches,
  resolveLoaderPath,
  resolvePmExplorationExecutionHostPath,
  resolvePmExplorationLedgerAdapterPath,
} = require("../desktop-evolution-deployment");
const {
  createDesktopPmPreRunSealValue,
} = require("../desktop-pm-pre-run-seal");

function runtimeConfig(revision) {
  const allow = () => ({ decision: "allow", policyRevision: revision });
  return {
    policy: {
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    },
    candidateWriter: { persistCandidate: async () => null },
    transitionWriter: { commitTransition: async () => null },
    transitionReader: { readTransition: async () => null },
    activeProvider: {
      listActive: async () => [],
      readActive: async () => null,
    },
    candidateProvider: { readCandidate: async () => null },
    promotionProvider: { authorizePromotion: async () => null },
    revalidationProvider: { authorizeRevalidation: async () => null },
  };
}

describe("desktop evolution deployment", () => {
  it("rejects unbound model clients before a direct egress can be opened", async () => {
    const {
      prepareDesktopModelRequest,
      runDesktopOllamaRequest,
    } = require("../desktop-model-ingress");
    const post = vi.fn();
    const client = { model: "test", client: { post } };

    await expect(
      prepareDesktopModelRequest(client, {
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    await expect(
      runDesktopOllamaRequest(client, "hello", {}, null, false),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects bound tool execution outside its workflow and unresolved iteration limits", async () => {
    const {
      createDesktopModelIngressHost,
      bindDesktopModelIngressClient,
      runDesktopToolExecution,
      assertDesktopToolLoopComplete,
    } = require("../desktop-model-ingress");
    const client = bindDesktopModelIngressClient(
      {},
      createDesktopModelIngressHost(() => {}),
    );
    const execute = vi.fn();
    await expect(
      runDesktopToolExecution(
        client,
        { id: "call", function: { name: "lookup", arguments: "{}" } },
        execute,
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(execute).not.toHaveBeenCalled();
    expect(() => assertDesktopToolLoopComplete(client)).toThrow(
      /iteration limit/,
    );
  });
  it("rejects opaque Ollama context before opening authority or dispatching", async () => {
    const {
      createDesktopModelIngressHost,
      bindDesktopModelIngressClient,
      runDesktopOllamaRequest,
    } = require("../desktop-model-ingress");
    const factory = vi.fn();
    const post = vi.fn();
    const client = bindDesktopModelIngressClient(
      { model: "test", client: { post } },
      createDesktopModelIngressHost(factory),
    );
    await expect(
      runDesktopOllamaRequest(
        client,
        "hi",
        { context: [1, 2, 3] },
        null,
        false,
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(factory).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it("rejects malformed multimodal requests before opening a composition", async () => {
    const {
      createDesktopModelIngressHost,
      openDesktopMultimodalModelRun,
    } = require("../desktop-model-ingress");
    const factory = vi.fn();
    const host = createDesktopModelIngressHost(factory);

    await expect(
      openDesktopMultimodalModelRun(host, "not-a-request"),
    ).rejects.toThrow(/must be an object/);
    expect(factory).not.toHaveBeenCalled();
  });
  it("retains an independent model factory as an opaque branded host", async () => {
    const factory = vi.fn();
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          evolutionCompositionFactory: factory,
        }),
      }),
    });
    const { isDesktopModelIngressHost } = require("../desktop-model-ingress");
    expect(isDesktopModelIngressHost(result.desktopModelIngressHost)).toBe(
      true,
    );
    expect(Object.keys(result.desktopModelIngressHost)).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(factory).not.toHaveBeenCalled();
  });

  it("narrows a branded PM ledger store to an opaque read-only Desktop host", async () => {
    const store = Object.freeze({ name: "real-store-placeholder" });
    const load = vi.fn(() => null);
    const commitJournal = vi.fn();
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationLedgerStore: store,
        }),
      }),
      importPmExplorationLedgerModule: async () => ({
        capturePmExplorationLedgerStore(value) {
          if (value !== store) throw new TypeError("unbranded store");
          return Object.freeze({
            load,
            commitJournal,
            restoreLatestJournal: vi.fn(),
          });
        },
      }),
    });

    const host = result.desktopPmExplorationStorageHost;
    expect(isDesktopPmExplorationStorageHost(host)).toBe(true);
    expect(Object.keys(host)).toEqual([]);
    expect(Object.isFrozen(host)).toBe(true);
    expect(host.load).toBeUndefined();
    expect(host.commitJournal).toBeUndefined();
    expect(inspectDesktopPmExplorationStorageHost(host)).toEqual({
      configured: true,
      readable: true,
      snapshotAvailable: false,
      snapshotAuthenticated: false,
      durableSnapshotAvailable: false,
      powerLossDurabilityTested: false,
      qualifiesForPromotion: false,
    });
    expect(load).toHaveBeenCalledOnce();
    expect(commitJournal).not.toHaveBeenCalled();
  });

  it("sanitizes durable restore evidence and fails closed on unreadable storage", async () => {
    const durableStore = Object.freeze({ name: "durable-store" });
    const brokenStore = Object.freeze({ name: "broken-store" });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationLedgerStore: durableStore,
        }),
      }),
      importPmExplorationLedgerModule: async () => ({
        capturePmExplorationLedgerStore(value) {
          if (value === durableStore) {
            return Object.freeze({
              load: () => ({
                schema: "chainlesschain.pm-exploration-ledger-restore/v1",
                authenticated: true,
                durable: true,
                ledgerAuthenticated: true,
                ledgerDurable: true,
                authorityDurable: true,
                powerLossDurabilityTested: false,
                snapshotAuthenticated: false,
                qualifiesForPromotion: false,
                snapshot: { secret: "must-not-leak" },
              }),
            });
          }
          if (value === brokenStore) {
            return Object.freeze({
              load: () => {
                throw new Error("corrupt ledger");
              },
            });
          }
          throw new TypeError("unbranded store");
        },
      }),
    });
    const projection = inspectDesktopPmExplorationStorageHost(
      result.desktopPmExplorationStorageHost,
    );
    expect(projection).toMatchObject({
      configured: true,
      readable: true,
      snapshotAvailable: true,
      durableSnapshotAvailable: true,
      snapshotAuthenticated: false,
      qualifiesForPromotion: false,
    });
    expect(JSON.stringify(projection)).not.toContain("must-not-leak");

    const broken = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationLedgerStore: brokenStore,
        }),
      }),
      importPmExplorationLedgerModule: async () => ({
        capturePmExplorationLedgerStore: (value) => {
          if (value !== brokenStore) throw new TypeError("unbranded store");
          return Object.freeze({
            load: () => {
              throw new Error("corrupt ledger");
            },
          });
        },
      }),
    });
    expect(
      inspectDesktopPmExplorationStorageHost(
        broken.desktopPmExplorationStorageHost,
      ),
    ).toMatchObject({ configured: true, readable: false });

    for (const load of [
      async () => null,
      () => ({ schema: "chainlesschain.pm-exploration-ledger-restore/v1" }),
    ]) {
      const store = Object.freeze({});
      const degraded = await loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationLedgerStore: store,
          }),
        }),
        importPmExplorationLedgerModule: async () => ({
          capturePmExplorationLedgerStore: (value) => {
            if (value !== store) throw new TypeError("unbranded store");
            return Object.freeze({ load });
          },
        }),
      });
      expect(
        inspectDesktopPmExplorationStorageHost(
          degraded.desktopPmExplorationStorageHost,
        ),
      ).toMatchObject({ configured: true, readable: false });
    }
  });

  it("rejects unbranded or accessor PM ledger stores without invoking getters", async () => {
    const store = Object.freeze({});
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationLedgerStore: store,
          }),
        }),
        importPmExplorationLedgerModule: async () => ({
          capturePmExplorationLedgerStore: () => {
            throw new TypeError(
              "a real PmExplorationLedgerAdapter is required",
            );
          },
        }),
      }),
    ).rejects.toThrow(/real PmExplorationLedgerAdapter/);

    const getter = vi.fn();
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () =>
            Object.defineProperty({}, "pmExplorationLedgerStore", {
              enumerable: true,
              get: getter,
            }),
        }),
      }),
    ).rejects.toThrow(/enumerable data property/);
    expect(getter).not.toHaveBeenCalled();
  });

  it("narrows a signed PM execution host to an opaque main-process capability", async () => {
    const rawHost = Object.freeze({ name: "signed-host-placeholder" });
    const manifestDigest = `sha256:${"4".repeat(64)}`;
    const executionReceiptDigest = `sha256:${"5".repeat(64)}`;
    const graderReceiptDigest = `sha256:${"6".repeat(64)}`;
    const preRunSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const postRunSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: preRunSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"3".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const capturePmPreRunSeal = vi
      .fn()
      .mockResolvedValueOnce(preRunSeal)
      .mockResolvedValueOnce(postRunSeal);
    const executeRound = vi.fn(async (_host, journal, input) => ({
      kind: "round",
      journal,
      input,
      executionReceipt: { receiptDigest: executionReceiptDigest },
      graderReceipt: { receiptDigest: graderReceiptDigest },
    }));
    const mergeBranches = vi.fn(async (_host, journal, input) => ({
      kind: "merge",
      journal,
      input,
    }));
    const evaluateMemory = vi.fn(async (_host, journal, input) => ({
      kind: "evaluate",
      journal,
      input,
    }));
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: preRunSeal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: mergeBranches,
        evaluatePmExplorationMemory: evaluateMemory,
      }),
      capturePmPreRunSeal,
    });

    const host = result.desktopPmExplorationExecutionHost;
    expect(isDesktopPmExplorationExecutionHost(host)).toBe(true);
    expect(Object.keys(host)).toEqual([]);
    expect(Object.isFrozen(host)).toBe(true);
    expect(host.executePmExplorationRound).toBeUndefined();

    const stateTransitionDigest = `sha256:${createHash("sha256")
      .update("chainlesschain.desktop-pm-database-transition/v1\0")
      .update(
        JSON.stringify({
          manifestDigest,
          executionReceiptDigest,
          graderReceiptDigest,
          preRunSealDigest: preRunSeal.sealDigest,
          postRunSealDigest: postRunSeal.sealDigest,
          previousStateTransitionDigest: null,
        }),
      )
      .digest("hex")}`;

    await expect(
      executeDesktopPmExplorationRound(host, "journal", { roundId: "r1" }),
    ).resolves.toEqual({
      schema: "chainlesschain.desktop-pm-sealed-execution-result/v2",
      preRunSeal,
      postRunSeal,
      databaseChanged: true,
      previousStateTransitionDigest: null,
      stateTransitionDigest,
      executionResult: {
        kind: "round",
        journal: "journal",
        input: { roundId: "r1" },
        executionReceipt: { receiptDigest: executionReceiptDigest },
        graderReceipt: { receiptDigest: graderReceiptDigest },
      },
      preRunSealVerified: true,
      qualifiesForPromotion: false,
    });
    await expect(
      mergeDesktopPmExplorationBranches(host, "journal", { mergeId: "m1" }),
    ).resolves.toMatchObject({ kind: "merge" });
    await expect(
      evaluateDesktopPmExplorationMemory(host, "journal", {
        finalMemoryDigest: "sha256:test",
      }),
    ).resolves.toMatchObject({ kind: "evaluate" });
    expect(executeRound).toHaveBeenCalledWith(rawHost, "journal", {
      roundId: "r1",
    });
    expect(capturePmPreRunSeal).toHaveBeenCalledTimes(2);
    expect(mergeBranches).toHaveBeenCalledWith(rawHost, "journal", {
      mergeId: "m1",
    });
    expect(evaluateMemory).toHaveBeenCalledWith(rawHost, "journal", {
      finalMemoryDigest: "sha256:test",
    });
  });

  it("serializes seal-execute-seal windows that share a database capture", async () => {
    const rawHost = Object.freeze({});
    const seal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const events = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const capturePmPreRunSeal = vi.fn(async () => {
      events.push("seal");
      return seal;
    });
    const executeRound = vi.fn(async (_host, _journal, input) => {
      events.push(`execute:${input.roundId}:start`);
      if (input.roundId === "r1") await firstGate;
      events.push(`execute:${input.roundId}:end`);
      return {
        executionReceipt: { receiptDigest: `sha256:${"5".repeat(64)}` },
        graderReceipt: { receiptDigest: `sha256:${"6".repeat(64)}` },
      };
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest: `sha256:${"4".repeat(64)}`,
          preRunSealDigest: seal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      capturePmPreRunSeal,
    });
    const first = executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "r1" },
    );
    const second = executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "r2" },
    );

    await Promise.resolve();
    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual([
      "seal",
      "execute:r1:start",
      "execute:r1:end",
      "seal",
      "seal",
      "execute:r2:start",
      "execute:r2:end",
      "seal",
    ]);
  });

  it("chains each later pre-run seal to the previous post-run seal", async () => {
    const rawHost = Object.freeze({});
    const initialSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const firstPostSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: initialSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"3".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const secondPostSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: initialSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"7".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const capturePmPreRunSeal = vi
      .fn()
      .mockResolvedValueOnce(initialSeal)
      .mockResolvedValueOnce(firstPostSeal)
      .mockResolvedValueOnce(firstPostSeal)
      .mockResolvedValueOnce(secondPostSeal);
    const executeRound = vi.fn(async () => ({
      executionReceipt: { receiptDigest: `sha256:${"5".repeat(64)}` },
      graderReceipt: { receiptDigest: `sha256:${"6".repeat(64)}` },
    }));
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest: `sha256:${"4".repeat(64)}`,
          preRunSealDigest: initialSeal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      capturePmPreRunSeal,
    });

    const first = await executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "r1" },
    );
    const second = await executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "r2" },
    );

    expect(first.preRunSeal).toEqual(initialSeal);
    expect(first.postRunSeal).toEqual(firstPostSeal);
    expect(first.previousStateTransitionDigest).toBeNull();
    expect(second.preRunSeal).toEqual(firstPostSeal);
    expect(second.postRunSeal).toEqual(secondPostSeal);
    expect(second.previousStateTransitionDigest).toBe(
      first.stateTransitionDigest,
    );
    expect(second.stateTransitionDigest).not.toBe(first.stateTransitionDigest);
    expect(capturePmPreRunSeal).toHaveBeenCalledTimes(4);
  });

  it("rejects unbranded or accessor PM execution hosts", async () => {
    const rawHost = Object.freeze({});
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationExecutionHost: rawHost,
          }),
        }),
        importPmExplorationExecutionModule: async () => ({
          isPmExplorationExecutionHost: () => false,
          executePmExplorationRound: vi.fn(),
          mergePmExplorationBranches: vi.fn(),
          evaluatePmExplorationMemory: vi.fn(),
        }),
      }),
    ).rejects.toThrow(/branded PM exploration execution host/);

    const inspectorGetter = vi.fn();
    const accessorModule = {
      isPmExplorationExecutionHost: () => true,
      executePmExplorationRound: vi.fn(),
      mergePmExplorationBranches: vi.fn(),
      evaluatePmExplorationMemory: vi.fn(),
    };
    Object.defineProperty(accessorModule, "inspectPmExplorationExecutionHost", {
      enumerable: true,
      get: inspectorGetter,
    });
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationExecutionHost: rawHost,
          }),
        }),
        importPmExplorationExecutionModule: async () => accessorModule,
      }),
    ).rejects.toThrow(/inspector must be a direct function/);
    expect(inspectorGetter).not.toHaveBeenCalled();

    const getter = vi.fn();
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () =>
            Object.defineProperty({}, "pmExplorationExecutionHost", {
              enumerable: true,
              get: getter,
            }),
        }),
      }),
    ).rejects.toThrow(/enumerable data property/);
    expect(getter).not.toHaveBeenCalled();
    await expect(executeDesktopPmExplorationRound({}, {}, {})).rejects.toThrow(
      /branded Desktop PM exploration execution host/,
    );
  });

  it("blocks Desktop execution before the signed pre-run seal diverges", async () => {
    const rawHost = Object.freeze({});
    const signedSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const observedSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: signedSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"3".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const executeRound = vi.fn();
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest: `sha256:${"4".repeat(64)}`,
          preRunSealDigest: signedSeal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      capturePmPreRunSeal: async () => observedSeal,
    });

    await expect(
      executeDesktopPmExplorationRound(
        result.desktopPmExplorationExecutionHost,
        "journal",
        { roundId: "round-one" },
      ),
    ).rejects.toThrow("differs from signed manifest");
    expect(executeRound).not.toHaveBeenCalled();
  });

  it("creates a frozen WebShell composition capability without exposing its factory", async () => {
    const {
      createDesktopModelIngressHost,
      createDesktopEvolutionCompositionFactory,
    } = require("../desktop-model-ingress");
    const factory = vi.fn(async (context) => ({ context }));
    const host = createDesktopModelIngressHost(factory);
    const capability = createDesktopEvolutionCompositionFactory(host);
    const context = Object.freeze({ mode: "ws-chat", runId: "run-1" });

    await expect(capability(context)).resolves.toEqual({ context });
    expect(capability).not.toBe(factory);
    expect(Object.isFrozen(capability)).toBe(true);
    expect(factory).toHaveBeenCalledWith(context);
    expect(() => createDesktopEvolutionCompositionFactory({})).toThrow(
      /branded Desktop model ingress host/,
    );
  });

  it("rejects accessor and Proxy model factories", async () => {
    const getter = vi.fn();
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () =>
            Object.defineProperty({}, "evolutionCompositionFactory", {
              get: getter,
            }),
        }),
      }),
    ).rejects.toThrow(/data property/);
    expect(getter).not.toHaveBeenCalled();
    const {
      createDesktopModelIngressHost,
    } = require("../desktop-model-ingress");
    expect(() =>
      createDesktopModelIngressHost(new Proxy(() => {}, {})),
    ).toThrow(/must be a function/);
    expect(() =>
      createDesktopModelIngressHost(() => {}, {
        isPackaged: true,
        resourcesPath: "relative",
      }),
    ).toThrow(/absolute/);
  });
  it("loads an independent marketplace capability through its branded Desktop facade", async () => {
    const marketplaceHost = {
      tenantId: "tenant:desktop",
      target: {
        tool: "desktop",
        model: "test",
        os: "win32-x64",
        runtime: "electron-39",
      },
      ...Object.fromEntries(
        ["inspect", "install", "list", "state", "rollout", "revoke"].map(
          (name) => [name, vi.fn()],
        ),
      ),
    };
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          marketplaceHost,
        }),
      }),
      importMarketplaceHostModule: async () => ({
        isGovernedSkillMarketplaceCliHost: (value) => value === marketplaceHost,
      }),
    });
    const {
      isDesktopGovernedSkillMarketplaceHost,
    } = require("../../marketplace/governed-skill-marketplace-host");
    expect(
      isDesktopGovernedSkillMarketplaceHost(
        result.governedSkillMarketplaceHost,
      ),
    ).toBe(true);
    expect(result.governedSkillMarketplaceHost.target.tool).toBe("desktop");
    result.governedSkillMarketplaceHost.state({ skillName: "safe-refactor" });
    expect(marketplaceHost.state).toHaveBeenCalledWith({
      skillName: "safe-refactor",
    });
  });

  it("rejects a marketplace host for a non-Desktop target", async () => {
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            marketplaceHost: { target: { tool: "cli" } },
          }),
        }),
        importMarketplaceHostModule: async () => ({
          isGovernedSkillMarketplaceCliHost: () => true,
        }),
      }),
    ).rejects.toThrow("fixed desktop target");
  });

  it("returns no governed dependencies when deployment is not configured", async () => {
    const load = vi.fn(async () => null);
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: load,
        }),
      }),
    ).resolves.toEqual({});
    expect(load).toHaveBeenCalledWith(
      "desktop",
      expect.objectContaining({ additionalFactories: expect.any(Object) }),
    );
    const factories = load.mock.calls[0][1].additionalFactories;
    expect(Object.isFrozen(factories)).toBe(true);
    expect(factories).toEqual({
      createDesktopPmReadOnlyOutcomeReader: expect.any(Function),
      createEvolvableArtifactRuntimeComposition: expect.any(Function),
    });
    const outcomeReader = factories.createDesktopPmReadOnlyOutcomeReader({
      planDigest: `sha256:${"1".repeat(64)}`,
      environmentDigest: `sha256:${"2".repeat(64)}`,
      databasePathDigest: `sha256:${"3".repeat(64)}`,
      bindings: [
        {
          taskId: "task-one",
          kind: "project-state",
          projectId: "project-one",
        },
      ],
    });
    expect(outcomeReader).toEqual({
      bindingDigest: expect.stringMatching(/^sha256:/u),
      readProjectState: expect.any(Function),
      readBoardExport: expect.any(Function),
    });
    expect(Object.isFrozen(outcomeReader)).toBe(true);
  });

  it("extracts all three readers only from its branded composition", async () => {
    const load = vi.fn(async (_command, options) => ({
      evolvableArtifactRuntimeComposition:
        options.additionalFactories.createEvolvableArtifactRuntimeComposition({
          tenantId: "desktop-tenant",
          artifacts: {
            [ARTIFACT_TYPE.SKILL]: runtimeConfig("skill-v1"),
            [ARTIFACT_TYPE.PROMPT]: runtimeConfig("prompt-v1"),
            [ARTIFACT_TYPE.HOOK]: runtimeConfig("hook-v1"),
          },
        }),
    }));
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: load,
      }),
    });

    expect(result.evolvableArtifactSkillActiveReleaseReader).toBeDefined();
    expect(result.evolvableArtifactPromptActiveReleaseReader).toBeDefined();
    expect(result.evolvableArtifactHookActiveReleaseReader).toBeDefined();
    expect(result.evolvableArtifactSkillLifecycleProducer).toBeDefined();
    expect(result.evolvableArtifactPromptLifecycleProducer).toBeDefined();
    expect(result.evolvableArtifactHookLifecycleProducer).toBeDefined();
  });

  it("rejects unbranded and incomplete deployment results", async () => {
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            evolvableArtifactRuntimeComposition: {},
          }),
        }),
      }),
    ).rejects.toThrow("branded runtime composition");

    expect(
      resolveLoaderPath({ isPackaged: true, resourcesPath: "C:\\app" }),
    ).toBe(
      path.join(
        "C:\\app",
        "packages",
        "cli",
        "src",
        "lib",
        "evolution",
        "evolution-deployment-loader.js",
      ),
    );
    expect(
      resolvePmExplorationLedgerAdapterPath({
        isPackaged: true,
        resourcesPath: "C:\\app",
      }),
    ).toBe(
      path.join(
        "C:\\app",
        "packages",
        "cli",
        "src",
        "lib",
        "evolution",
        "pm-exploration-ledger-adapter.js",
      ),
    );
    expect(
      resolvePmExplorationExecutionHostPath({
        isPackaged: true,
        resourcesPath: "C:\\app",
      }),
    ).toBe(
      path.join(
        "C:\\app",
        "packages",
        "cli",
        "src",
        "lib",
        "evolution",
        "pm-exploration-execution-host.js",
      ),
    );
  });
});
