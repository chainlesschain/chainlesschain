"use strict";

const { createHash } = require("node:crypto");
const path = require("path");
const { pathToFileURL } = require("url");
const { types } = require("util");
const { createDesktopModelIngressHost } = require("./desktop-model-ingress");
const {
  createDesktopPmReadOnlyOutcomeReader,
} = require("./desktop-pm-read-only-outcome-reader");
const {
  captureDesktopPmPreRunSeal,
  verifyDesktopPmPreRunSealValue,
} = require("./desktop-pm-pre-run-seal");
const {
  createDesktopGovernedSkillMarketplaceHost,
} = require("../marketplace/governed-skill-marketplace-host");
const {
  createEvolvableArtifactRuntimeComposition,
  isEvolvableArtifactRuntimeComposition,
  getEvolvableArtifactRuntimeDependencies,
} = require("@chainlesschain/session-core/evolvable-artifact");

const DEV_LOADER_REL =
  "../../../../packages/cli/src/lib/evolution/evolution-deployment-loader.js";
const DEV_PM_LEDGER_ADAPTER_REL =
  "../../../../packages/cli/src/lib/evolution/pm-exploration-ledger-adapter.js";
const DEV_PM_EXECUTION_HOST_REL =
  "../../../../packages/cli/src/lib/evolution/pm-exploration-execution-host.js";
const PM_EXPLORATION_STORAGE_HOSTS = new WeakMap();
const PM_EXPLORATION_EXECUTION_HOSTS = new WeakMap();
const PM_EXPLORATION_EXECUTION_LANES = new WeakMap();
const DESKTOP_PM_SEALED_EXECUTION_RESULT_SCHEMA =
  "chainlesschain.desktop-pm-sealed-execution-result/v2";

function ownDirectFunction(owner, name, label) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner))
    throw new TypeError(`${label} module is invalid`);
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (
    !descriptor ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "function" ||
    types.isProxy(descriptor.value)
  ) {
    throw new TypeError(`${label} must be a direct function`);
  }
  return descriptor.value;
}

function ownData(owner, name, label) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner))
    throw new TypeError(`${label} owner is invalid`);
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (!descriptor || !("value" in descriptor))
    throw new TypeError(`${label} must be plain data`);
  return descriptor.value;
}

function sha256Digest(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function transitionDigest(value) {
  return `sha256:${createHash("sha256")
    .update("chainlesschain.desktop-pm-database-transition/v1\0")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function executionLane(capturePmPreRunSeal) {
  let lane = PM_EXPLORATION_EXECUTION_LANES.get(capturePmPreRunSeal);
  if (!lane) {
    lane = { tail: Promise.resolve() };
    PM_EXPLORATION_EXECUTION_LANES.set(capturePmPreRunSeal, lane);
  }
  return lane;
}

function enqueueExecution(lane, operation) {
  const result = lane.tail.then(operation, operation);
  lane.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function resolveLoaderPath({ isPackaged = false, resourcesPath } = {}) {
  if (isPackaged) {
    if (typeof resourcesPath !== "string" || resourcesPath === "") {
      throw new Error("packaged evolution deployment requires resourcesPath");
    }
    return path.join(
      resourcesPath,
      "packages/cli/src/lib/evolution/evolution-deployment-loader.js",
    );
  }
  return path.resolve(__dirname, DEV_LOADER_REL);
}

function resolvePmExplorationLedgerAdapterPath({
  isPackaged = false,
  resourcesPath,
} = {}) {
  if (isPackaged) {
    if (typeof resourcesPath !== "string" || resourcesPath === "") {
      throw new Error("packaged PM exploration storage requires resourcesPath");
    }
    return path.join(
      resourcesPath,
      "packages/cli/src/lib/evolution/pm-exploration-ledger-adapter.js",
    );
  }
  return path.resolve(__dirname, DEV_PM_LEDGER_ADAPTER_REL);
}

function resolvePmExplorationExecutionHostPath({
  isPackaged = false,
  resourcesPath,
} = {}) {
  if (isPackaged) {
    if (typeof resourcesPath !== "string" || resourcesPath === "") {
      throw new Error(
        "packaged PM exploration execution requires resourcesPath",
      );
    }
    return path.join(
      resourcesPath,
      "packages/cli/src/lib/evolution/pm-exploration-execution-host.js",
    );
  }
  return path.resolve(__dirname, DEV_PM_EXECUTION_HOST_REL);
}

function createDesktopPmExplorationStorageHost(store, captureStore) {
  if (typeof captureStore !== "function" || types.isProxy(captureStore)) {
    throw new TypeError("PM exploration ledger store capture is invalid");
  }
  const ports = captureStore(store);
  const loadDescriptor = Object.getOwnPropertyDescriptor(ports, "load");
  if (
    !loadDescriptor ||
    !("value" in loadDescriptor) ||
    typeof loadDescriptor.value !== "function" ||
    types.isProxy(loadDescriptor.value)
  ) {
    throw new TypeError("PM exploration ledger store has no direct load port");
  }
  const host = Object.freeze({});
  PM_EXPLORATION_STORAGE_HOSTS.set(
    host,
    Object.freeze({ load: loadDescriptor.value }),
  );
  return host;
}

function isDesktopPmExplorationStorageHost(value) {
  return PM_EXPLORATION_STORAGE_HOSTS.has(value);
}

function inspectDesktopPmExplorationStorageHost(host) {
  const captured = PM_EXPLORATION_STORAGE_HOSTS.get(host);
  if (!captured) {
    return Object.freeze({
      configured: false,
      readable: false,
      snapshotAvailable: false,
      snapshotAuthenticated: false,
      durableSnapshotAvailable: false,
      powerLossDurabilityTested: false,
      qualifiesForPromotion: false,
    });
  }
  try {
    const evidence = captured.load();
    if (evidence && typeof evidence.then === "function") {
      throw new TypeError("PM exploration ledger load must be synchronous");
    }
    if (evidence === null) {
      return Object.freeze({
        configured: true,
        readable: true,
        snapshotAvailable: false,
        snapshotAuthenticated: false,
        durableSnapshotAvailable: false,
        powerLossDurabilityTested: false,
        qualifiesForPromotion: false,
      });
    }
    const valid =
      evidence &&
      typeof evidence === "object" &&
      !types.isProxy(evidence) &&
      evidence.schema === "chainlesschain.pm-exploration-ledger-restore/v1" &&
      evidence.authenticated === true &&
      evidence.durable === true &&
      evidence.ledgerAuthenticated === true &&
      evidence.ledgerDurable === true &&
      evidence.authorityDurable === true &&
      evidence.powerLossDurabilityTested === false &&
      typeof evidence.snapshotAuthenticated === "boolean" &&
      evidence.qualifiesForPromotion === false;
    if (!valid) {
      throw new Error("PM exploration restore evidence is invalid");
    }
    return Object.freeze({
      configured: true,
      readable: true,
      snapshotAvailable: true,
      snapshotAuthenticated: evidence.snapshotAuthenticated,
      durableSnapshotAvailable: true,
      powerLossDurabilityTested: false,
      qualifiesForPromotion: false,
    });
  } catch {
    return Object.freeze({
      configured: true,
      readable: false,
      snapshotAvailable: false,
      snapshotAuthenticated: false,
      durableSnapshotAvailable: false,
      powerLossDurabilityTested: false,
      qualifiesForPromotion: false,
    });
  }
}

function createDesktopPmExplorationExecutionHost(
  host,
  executionModule,
  capturePmPreRunSeal,
) {
  const isExecutionHost = ownDirectFunction(
    executionModule,
    "isPmExplorationExecutionHost",
    "PM exploration execution host guard",
  );
  if (!Reflect.apply(isExecutionHost, undefined, [host])) {
    throw new TypeError("a branded PM exploration execution host is required");
  }
  const inspectExecutionHost = ownDirectFunction(
    executionModule,
    "inspectPmExplorationExecutionHost",
    "PM exploration execution host inspector",
  );
  if (
    typeof capturePmPreRunSeal !== "function" ||
    types.isProxy(capturePmPreRunSeal)
  ) {
    throw new TypeError("Desktop PM pre-run seal capture must be direct");
  }
  const inspection = Reflect.apply(inspectExecutionHost, undefined, [host]);
  const preRunSealDigest = ownData(
    inspection,
    "preRunSealDigest",
    "PM exploration pre-run seal digest",
  );
  sha256Digest(preRunSealDigest, "PM exploration pre-run seal digest");
  const manifestDigest = sha256Digest(
    ownData(
      inspection,
      "manifestDigest",
      "PM exploration execution manifest digest",
    ),
    "PM exploration execution manifest digest",
  );
  const operations = {};
  for (const name of [
    "executePmExplorationRound",
    "mergePmExplorationBranches",
    "evaluatePmExplorationMemory",
  ]) {
    const operation = ownDirectFunction(
      executionModule,
      name,
      `PM exploration execution module ${name}`,
    );
    operations[name] = (...args) =>
      Reflect.apply(operation, undefined, [host, ...args]);
  }
  const desktopHost = Object.freeze({});
  PM_EXPLORATION_EXECUTION_HOSTS.set(
    desktopHost,
    Object.freeze({
      ...operations,
      capturePmPreRunSeal,
      executionLane: executionLane(capturePmPreRunSeal),
      executionState: {
        nextPreRunSealDigest: preRunSealDigest,
        previousStateTransitionDigest: null,
      },
      manifestDigest,
      preRunSealDigest,
    }),
  );
  return desktopHost;
}

function captureDesktopPmExplorationExecutionHost(host) {
  const captured = PM_EXPLORATION_EXECUTION_HOSTS.get(host);
  if (!captured) {
    throw new TypeError(
      "a branded Desktop PM exploration execution host is required",
    );
  }
  return captured;
}

function isDesktopPmExplorationExecutionHost(value) {
  return PM_EXPLORATION_EXECUTION_HOSTS.has(value);
}

async function executeDesktopPmExplorationRound(host, journal, input) {
  const captured = captureDesktopPmExplorationExecutionHost(host);
  return enqueueExecution(captured.executionLane, async () => {
    const previousStateTransitionDigest =
      captured.executionState.previousStateTransitionDigest;
    const seal = verifyDesktopPmPreRunSealValue(
      await captured.capturePmPreRunSeal(),
      captured.executionState.nextPreRunSealDigest,
    );
    const executionResult = await captured.executePmExplorationRound(
      journal,
      input,
    );
    const executionReceiptDigest = sha256Digest(
      ownData(
        ownData(
          executionResult,
          "executionReceipt",
          "PM exploration execution receipt",
        ),
        "receiptDigest",
        "PM exploration execution receipt digest",
      ),
      "PM exploration execution receipt digest",
    );
    const graderReceiptDigest = sha256Digest(
      ownData(
        ownData(
          executionResult,
          "graderReceipt",
          "PM exploration grader receipt",
        ),
        "receiptDigest",
        "PM exploration grader receipt digest",
      ),
      "PM exploration grader receipt digest",
    );
    const postRunSeal = verifyDesktopPmPreRunSealValue(
      await captured.capturePmPreRunSeal(),
    );
    if (postRunSeal.databasePathDigest !== seal.databasePathDigest)
      throw new Error("Desktop PM database path changed after execution");
    const stateTransitionDigest = transitionDigest({
      manifestDigest: captured.manifestDigest,
      executionReceiptDigest,
      graderReceiptDigest,
      preRunSealDigest: seal.sealDigest,
      postRunSealDigest: postRunSeal.sealDigest,
      previousStateTransitionDigest,
    });
    captured.executionState.nextPreRunSealDigest = postRunSeal.sealDigest;
    captured.executionState.previousStateTransitionDigest =
      stateTransitionDigest;
    return Object.freeze({
      schema: DESKTOP_PM_SEALED_EXECUTION_RESULT_SCHEMA,
      preRunSeal: seal,
      postRunSeal,
      databaseChanged:
        postRunSeal.databaseSnapshotDigest !== seal.databaseSnapshotDigest,
      previousStateTransitionDigest,
      stateTransitionDigest,
      executionResult,
      preRunSealVerified: true,
      qualifiesForPromotion: false,
    });
  });
}

function mergeDesktopPmExplorationBranches(host, journal, input) {
  return captureDesktopPmExplorationExecutionHost(
    host,
  ).mergePmExplorationBranches(journal, input);
}

function evaluateDesktopPmExplorationMemory(host, journal, input) {
  return captureDesktopPmExplorationExecutionHost(
    host,
  ).evaluatePmExplorationMemory(journal, input);
}

async function loadDesktopEvolutionDependencies({
  isPackaged = false,
  resourcesPath,
  importLoader = (url) => import(url),
  loaderOptions = {},
  importMarketplaceHostModule,
  importPmExplorationLedgerModule = (url) => import(url),
  importPmExplorationExecutionModule = (url) => import(url),
  capturePmPreRunSeal = captureDesktopPmPreRunSeal,
} = {}) {
  const loaderPath = resolveLoaderPath({ isPackaged, resourcesPath });
  const loader = await importLoader(pathToFileURL(loaderPath).href);
  if (typeof loader.loadEvolutionDeploymentCommandDependencies !== "function") {
    throw new Error("evolution deployment loader is invalid");
  }
  const result = await loader.loadEvolutionDeploymentCommandDependencies(
    "desktop",
    {
      ...loaderOptions,
      additionalFactories: Object.freeze({
        createDesktopPmReadOnlyOutcomeReader,
        createEvolvableArtifactRuntimeComposition,
      }),
    },
  );
  if (result === null) {
    return Object.freeze({});
  }

  const desktopDependencies = {};
  const modelFactoryDescriptor = Object.getOwnPropertyDescriptor(
    result,
    "evolutionCompositionFactory",
  );
  if (modelFactoryDescriptor) {
    if (!Object.hasOwn(modelFactoryDescriptor, "value")) {
      throw new TypeError(
        "Desktop model composition factory must be a data property",
      );
    }
    desktopDependencies.desktopModelIngressHost = createDesktopModelIngressHost(
      modelFactoryDescriptor.value,
      {
        isPackaged,
        resourcesPath,
      },
    );
  }
  if (result.marketplaceHost !== undefined) {
    desktopDependencies.governedSkillMarketplaceHost =
      await createDesktopGovernedSkillMarketplaceHost(result.marketplaceHost, {
        isPackaged,
        resourcesPath,
        importHostModule: importMarketplaceHostModule,
      });
  }
  const pmStoreDescriptor = Object.getOwnPropertyDescriptor(
    result,
    "pmExplorationLedgerStore",
  );
  if (pmStoreDescriptor) {
    if (
      !("value" in pmStoreDescriptor) ||
      pmStoreDescriptor.enumerable !== true
    ) {
      throw new TypeError(
        "Desktop PM exploration ledger store must be an enumerable data property",
      );
    }
    const adapterPath = resolvePmExplorationLedgerAdapterPath({
      isPackaged,
      resourcesPath,
    });
    const adapterModule = await importPmExplorationLedgerModule(
      pathToFileURL(adapterPath).href,
    );
    desktopDependencies.desktopPmExplorationStorageHost =
      createDesktopPmExplorationStorageHost(
        pmStoreDescriptor.value,
        adapterModule?.capturePmExplorationLedgerStore,
      );
  }
  const pmExecutionHostDescriptor = Object.getOwnPropertyDescriptor(
    result,
    "pmExplorationExecutionHost",
  );
  if (pmExecutionHostDescriptor) {
    if (
      !("value" in pmExecutionHostDescriptor) ||
      pmExecutionHostDescriptor.enumerable !== true
    ) {
      throw new TypeError(
        "Desktop PM exploration execution host must be an enumerable data property",
      );
    }
    const executionHostPath = resolvePmExplorationExecutionHostPath({
      isPackaged,
      resourcesPath,
    });
    const executionModule = await importPmExplorationExecutionModule(
      pathToFileURL(executionHostPath).href,
    );
    desktopDependencies.desktopPmExplorationExecutionHost =
      createDesktopPmExplorationExecutionHost(
        pmExecutionHostDescriptor.value,
        executionModule,
        capturePmPreRunSeal,
      );
  }
  const composition = result.evolvableArtifactRuntimeComposition;
  if (
    composition === undefined &&
    Object.keys(desktopDependencies).length > 0
  ) {
    return Object.freeze(desktopDependencies);
  }
  if (!isEvolvableArtifactRuntimeComposition(composition)) {
    throw new Error(
      "desktop evolution deployment must return a branded runtime composition",
    );
  }
  const dependencies = getEvolvableArtifactRuntimeDependencies(composition);
  for (const type of ["Skill", "Prompt", "Hook"]) {
    if (!dependencies[`evolvableArtifact${type}ActiveReleaseReader`]) {
      throw new Error(
        `desktop evolution deployment is missing ${type} runtime`,
      );
    }
    if (!dependencies[`evolvableArtifact${type}LifecycleProducer`]) {
      throw new Error(
        `desktop evolution deployment is missing ${type} lifecycle producer`,
      );
    }
  }
  return Object.freeze({ ...dependencies, ...desktopDependencies });
}

module.exports = {
  evaluateDesktopPmExplorationMemory,
  executeDesktopPmExplorationRound,
  inspectDesktopPmExplorationStorageHost,
  isDesktopPmExplorationExecutionHost,
  isDesktopPmExplorationStorageHost,
  loadDesktopEvolutionDependencies,
  mergeDesktopPmExplorationBranches,
  resolvePmExplorationExecutionHostPath,
  resolvePmExplorationLedgerAdapterPath,
  resolveLoaderPath,
};
