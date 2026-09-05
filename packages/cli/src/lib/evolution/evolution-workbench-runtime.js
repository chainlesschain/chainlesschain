import { types } from "node:util";
import { capturePruningData as capture } from "./governed-wiki-pruning-journal.js";
import { createEvolutionWorkbenchRegistrySource } from "./evolution-workbench-registry-source.js";
import { createEvolutionWorkbenchReviewRuntime } from "./evolution-workbench-review-ledger-adapter.js";
import { createEvolutionWorkbenchRollbackRuntime } from "./evolution-workbench-rollback-ledger-adapter.js";
import { createEvolutionWorkbenchCliHost } from "./evolution-workbench-cli-host.js";

const REQUIRED = [
  "descriptor",
  "artifactPorts",
  "ledger",
  "ledgerArtifactResolver",
  "releaseRegistry",
  "transactionLedger",
  "verifierLedger",
  "verifierLedgerArtifactResolver",
  "verifierReleaseRegistry",
  "verifierTransactionLedger",
  "rollbackProvider",
  "authorizationProvider",
  "identityProvider",
  "decisionVerifier",
  "humanDecisionProvider",
  "humanDecisionVerifier",
  "humanRollbackProvider",
  "humanRollbackVerifier",
];
const OPTIONAL = ["invocationReceiptSource", "pilotSource", "now"];

function optionsRecord(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value)
  )
    throw new TypeError("Workbench runtime requires explicit resource options");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set([...REQUIRED, ...OPTIONAL]);
  if (
    Reflect.ownKeys(descriptors).some((key) => !allowed.has(key)) ||
    REQUIRED.some((key) => !Object.hasOwn(descriptors, key))
  )
    throw new TypeError("Workbench runtime resources are missing or replaced");
  const output = {};
  for (const [key, property] of Object.entries(descriptors)) {
    if (!Object.hasOwn(property, "value"))
      throw new TypeError(
        "Workbench runtime resource accessors are not allowed",
      );
    output[key] = property.value;
  }
  return output;
}

function fixed(owner, name) {
  if (!owner || types.isProxy(owner))
    throw new TypeError(`Workbench ${name} fixed port is required`);
  const fn = Object.getOwnPropertyDescriptor(owner, name)?.value;
  if (typeof fn !== "function" || types.isProxy(fn))
    throw new TypeError(`Workbench ${name} fixed own method is required`);
  return Object.freeze({ [name]: fn.bind(owner) });
}

// Open/recover the actual Registry before calling this assembly. Nothing here
// creates credentials or grants permissions. No host escapes before current
// storage, all adapters and existing-effect reconciliation have been verified.
export async function createEvolutionWorkbenchRuntime(input) {
  const options = optionsRecord(input);
  const descriptor = capture(options.descriptor);
  const shared = {
    descriptor,
    artifactPorts: options.artifactPorts,
    ledger: options.ledger,
    ledgerArtifactResolver: options.ledgerArtifactResolver,
    now: options.now ?? Date.now,
  };
  const identityProvider = fixed(options.identityProvider, "current");
  const registrySource = createEvolutionWorkbenchRegistrySource({
    ...shared,
    releaseRegistry: options.releaseRegistry,
    transactionLedger: options.transactionLedger,
    verifierLedger: options.verifierLedger,
    verifierLedgerArtifactResolver: options.verifierLedgerArtifactResolver,
    verifierReleaseRegistry: options.verifierReleaseRegistry,
    verifierTransactionLedger: options.verifierTransactionLedger,
  });
  const review = createEvolutionWorkbenchReviewRuntime({
    ...shared,
    registrySource,
    decisionVerifier: fixed(options.decisionVerifier, "verify"),
    humanDecisionProvider: fixed(options.humanDecisionProvider, "request"),
    humanDecisionVerifier: fixed(options.humanDecisionVerifier, "verify"),
    invocationReceiptSource: options.invocationReceiptSource ?? null,
    pilotSource: options.pilotSource ?? null,
  });
  const rollback = createEvolutionWorkbenchRollbackRuntime({
    ...shared,
    projectionReader: review.projectionReader,
    releaseRegistry: options.releaseRegistry,
    transactionLedger: options.transactionLedger,
    verifierReleaseRegistry: options.verifierReleaseRegistry,
    verifierTransactionLedger: options.verifierTransactionLedger,
    rollbackProvider: options.rollbackProvider,
    authorizationProvider: fixed(
      options.authorizationProvider,
      "authorizeRollback",
    ),
    humanRollbackProvider: fixed(options.humanRollbackProvider, "authorize"),
    humanRollbackVerifier: fixed(options.humanRollbackVerifier, "verify"),
  });
  const reviewRecovery = await review.reconcileCommitted();
  const rollbackRecovery = await rollback.reconcileCommitted();
  await review.projectionLoader.load();
  const workbenchHost = createEvolutionWorkbenchCliHost({
    tenantId: descriptor.tenantId,
    projectionLoader: review.projectionLoader,
    projectionAuthority: review.projectionAuthority,
    identityProvider,
    activeStateReader: rollback.activeStateReader,
    batchExecutor: review.batchExecutor,
    rollbackExecutor: rollback.rollbackExecutor,
  });
  return Object.freeze({
    workbenchHost,
    recovery: capture({
      reviewsSettled: reviewRecovery.settledItems.length,
      reviewPreparationsDeferred: reviewRecovery.deferredRequestDigests.length,
      rollbacksSettled: rollbackRecovery.settledReceipts.length,
      rollbackPlansDeferred: rollbackRecovery.deferredPlanDigests.length,
    }),
  });
}
