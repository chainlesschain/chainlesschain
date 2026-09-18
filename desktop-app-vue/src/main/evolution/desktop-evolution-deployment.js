"use strict";

const path = require("path");
const { pathToFileURL } = require("url");
const { types } = require("util");
const { createDesktopModelIngressHost } = require("./desktop-model-ingress");
const {
  createDesktopPmReadOnlyOutcomeReader,
} = require("./desktop-pm-read-only-outcome-reader");
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

function createDesktopPmExplorationExecutionHost(host, executionModule) {
  if (
    !executionModule ||
    typeof executionModule !== "object" ||
    types.isProxy(executionModule) ||
    typeof executionModule.isPmExplorationExecutionHost !== "function" ||
    types.isProxy(executionModule.isPmExplorationExecutionHost) ||
    !executionModule.isPmExplorationExecutionHost(host)
  ) {
    throw new TypeError("a branded PM exploration execution host is required");
  }
  const operations = {};
  for (const name of [
    "executePmExplorationRound",
    "mergePmExplorationBranches",
    "evaluatePmExplorationMemory",
  ]) {
    const operation = executionModule[name];
    if (typeof operation !== "function" || types.isProxy(operation)) {
      throw new TypeError(`PM exploration execution module is missing ${name}`);
    }
    operations[name] = (...args) =>
      Reflect.apply(operation, undefined, [host, ...args]);
  }
  const desktopHost = Object.freeze({});
  PM_EXPLORATION_EXECUTION_HOSTS.set(desktopHost, Object.freeze(operations));
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

function executeDesktopPmExplorationRound(host, journal, input) {
  return captureDesktopPmExplorationExecutionHost(
    host,
  ).executePmExplorationRound(journal, input);
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
