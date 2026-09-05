import { types } from "node:util";
import { EvolutionLedger } from "./evolution-ledger.js";
import { captureSkillReleaseRegistryReader } from "./skill-release-registry.js";
import { captureSkillReleaseOperationReader } from "./evolution-ledger-ports.js";
import { createSkillRegistryTransitionLedgerReader } from "./skill-registry-transition-ledger-adapter.js";
import {
  capturePruningData as capture,
  pruningCanonical as canonical,
  pruningDigest as hash,
} from "./governed-wiki-pruning-journal.js";

export const WORKBENCH_REGISTRY_STATE_SCHEMA =
  "chainlesschain.evolution-workbench-registry-state/v1";
const SOURCES = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const same = (a, b) => canonical(a) === canonical(b);
function fail(message) {
  throw new Error(`Workbench Registry: ${message}`);
}
function exact(value, keys, label) {
  if (
    !value ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail(`${label} fields differ`);
}
function digest(value) {
  if (!DIGEST.test(value ?? "")) fail("invalid digest");
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid revision");
}

export function captureWorkbenchRegistrySource(value) {
  if (!SOURCES.has(value))
    throw new TypeError("a genuine Workbench Registry source is required");
  return value;
}

// Pure checks for the retained/view protocol, not a replacement for the two
// real Registry and Ledger readers used to build it below.
export function verifyWorkbenchRegistryState(input, tenantId, skillName) {
  const value = capture(input);
  exact(
    value,
    [
      "schema",
      "tenantId",
      "skillName",
      "ledger",
      "migration",
      "active",
      "operations",
      "registryDigest",
    ],
    "state",
  );
  if (
    value.schema !== WORKBENCH_REGISTRY_STATE_SCHEMA ||
    value.tenantId !== tenantId ||
    value.skillName !== skillName
  )
    fail("state scope differs");
  exact(value.ledger, ["epoch", "ledgerId", "identityDigest"], "ledger");
  if (
    typeof value.ledger.epoch !== "string" ||
    typeof value.ledger.ledgerId !== "string"
  )
    fail("invalid Ledger identity");
  digest(value.ledger.identityDigest);
  if (!Array.isArray(value.operations) || value.operations.length > 10_000)
    fail("history exceeds budget");
  let previous = {
    revision: 0,
    stateDigest: null,
    activeReleaseDigest: null,
    lastKnownGoodReleaseDigest: null,
  };
  if (value.migration !== null) {
    exact(
      value.migration,
      [
        "revision",
        "stateDigest",
        "activeReleaseDigest",
        "lastKnownGoodReleaseDigest",
        "sequence",
        "eventDigest",
      ],
      "migration",
    );
    revision(value.migration.revision);
    revision(value.migration.sequence);
    for (const key of [
      "stateDigest",
      "activeReleaseDigest",
      "lastKnownGoodReleaseDigest",
      "eventDigest",
    ])
      digest(value.migration[key]);
    previous = value.migration;
  }
  const ids = new Set();
  let sequence = 0;
  for (const operation of value.operations) {
    exact(
      operation,
      [
        "operationId",
        "operation",
        "requestDigest",
        "transactionId",
        "intentDigest",
        "releaseDigest",
        "candidateId",
        "contentDigest",
        "dependencyLockDigest",
        "previousStateDigest",
        "fromReleaseDigest",
        "expectedRevision",
        "status",
        "revision",
        "stateDigest",
        "preparationSequence",
        "preparationDigest",
        "sequence",
        "eventDigest",
        "receiptDigest",
        "occurredAt",
      ],
      "operation",
    );
    if (
      typeof operation.operationId !== "string" ||
      ids.has(operation.operationId) ||
      !["promote", "rollback"].includes(operation.operation) ||
      !["prepared", "committed"].includes(operation.status)
    )
      fail("ambiguous operation");
    ids.add(operation.operationId);
    for (const key of [
      "requestDigest",
      "transactionId",
      "intentDigest",
      "releaseDigest",
      "candidateId",
      "contentDigest",
      "dependencyLockDigest",
      "preparationDigest",
      "receiptDigest",
    ])
      digest(operation[key]);
    revision(operation.expectedRevision);
    revision(operation.preparationSequence);
    if (operation.preparationSequence <= sequence)
      fail("operation history is reordered");
    sequence = operation.preparationSequence;
    if (operation.status === "prepared") {
      if (
        [
          "revision",
          "stateDigest",
          "sequence",
          "eventDigest",
          "occurredAt",
        ].some((key) => operation[key] !== null)
      )
        fail("prepared operation claims an effect");
    } else {
      revision(operation.revision);
      revision(operation.sequence);
      digest(operation.stateDigest);
      digest(operation.eventDigest);
      if (
        operation.sequence <= operation.preparationSequence ||
        typeof operation.occurredAt !== "string" ||
        !Number.isFinite(Date.parse(operation.occurredAt))
      )
        fail("invalid finalization evidence");
      if (
        operation.expectedRevision !== previous.revision ||
        operation.revision !== previous.revision + 1 ||
        operation.previousStateDigest !== previous.stateDigest ||
        operation.fromReleaseDigest !== previous.activeReleaseDigest
      )
        fail("release history is discontinuous");
      if (
        operation.operation === "rollback" &&
        operation.releaseDigest !== previous.lastKnownGoodReleaseDigest
      )
        fail("rollback did not select LKG");
      previous = {
        revision: operation.revision,
        stateDigest: operation.stateDigest,
        activeReleaseDigest: operation.releaseDigest,
        lastKnownGoodReleaseDigest:
          operation.operation === "promote"
            ? (previous.activeReleaseDigest ?? operation.releaseDigest)
            : operation.releaseDigest,
      };
    }
  }
  if (value.active === null) {
    if (previous.revision !== 0) fail("active state is missing");
  } else {
    exact(
      value.active,
      [
        "revision",
        "stateDigest",
        "releaseDigest",
        "lastKnownGoodReleaseDigest",
        "candidateId",
        "contentDigest",
        "dependencyLockDigest",
        "transactionId",
      ],
      "active",
    );
    revision(value.active.revision);
    for (const key of [
      "stateDigest",
      "releaseDigest",
      "lastKnownGoodReleaseDigest",
      "candidateId",
      "contentDigest",
      "dependencyLockDigest",
      "transactionId",
    ])
      digest(value.active[key]);
    if (
      previous.revision !== value.active.revision ||
      previous.stateDigest !== value.active.stateDigest ||
      previous.activeReleaseDigest !== value.active.releaseDigest ||
      previous.lastKnownGoodReleaseDigest !==
        value.active.lastKnownGoodReleaseDigest
    )
      fail("active state differs from authenticated history");
    const last = value.operations
      .filter((operation) => operation.status === "committed")
      .at(-1);
    if (
      last &&
      [
        "transactionId",
        "candidateId",
        "contentDigest",
        "dependencyLockDigest",
      ].some((key) => last[key] !== value.active[key])
    )
      fail("active release differs from final effect");
  }
  const { registryDigest, ...core } = value;
  if (registryDigest !== hash(WORKBENCH_REGISTRY_STATE_SCHEMA, core))
    fail("state digest differs");
  return value;
}

export function createEvolutionWorkbenchRegistrySource({
  descriptor: input,
  ledger,
  ledgerArtifactResolver,
  releaseRegistry,
  transactionLedger,
  verifierLedger,
  verifierLedgerArtifactResolver,
  verifierReleaseRegistry,
  verifierTransactionLedger,
} = {}) {
  const descriptor = capture(input);
  if (
    !(ledger instanceof EvolutionLedger) ||
    !(verifierLedger instanceof EvolutionLedger) ||
    types.isProxy(ledger) ||
    types.isProxy(verifierLedger) ||
    ledger === verifierLedger ||
    releaseRegistry === verifierReleaseRegistry ||
    transactionLedger === verifierTransactionLedger
  )
    throw new TypeError(
      "Workbench Registry source requires independent actual Ledger/Registry instances",
    );
  const readers = [
    [releaseRegistry, transactionLedger, ledger, ledgerArtifactResolver],
    [
      verifierReleaseRegistry,
      verifierTransactionLedger,
      verifierLedger,
      verifierLedgerArtifactResolver,
    ],
  ].map(([registry, transactions, journal, resolver]) => {
    const releases = captureSkillReleaseRegistryReader(registry);
    const operations = captureSkillReleaseOperationReader(transactions);
    if (
      releases.tenantId !== descriptor.tenantId ||
      !releases.matchesTransactionLedger(transactions) ||
      !operations.matchesLedger(journal)
    )
      throw new TypeError(
        "Workbench Registry/transaction/Ledger scope binding differs",
      );
    const transitions = createSkillRegistryTransitionLedgerReader({
      descriptor,
      ledger: journal,
      ledgerArtifactResolver: resolver,
      releaseRegistry: registry,
    });
    return { releases, operations, transitions };
  });
  function currentContext() {
    const left = readers[0].operations.currentContext();
    if (!same(left, readers[1].operations.currentContext()))
      fail("independent Ledger heads differ");
    return left;
  }
  function assertCurrent(context) {
    if (!same(context, currentContext()))
      fail("Ledger changed during projection authentication");
  }
  function load() {
    const context = currentContext();
    const histories = readers.map((reader) =>
      reader.operations.readReleaseHistory({
        tenantId: descriptor.tenantId,
        skillName: descriptor.skillName,
        context,
      }),
    );
    if (!same(histories[0], histories[1]))
      fail("independent release histories differ");
    const history = histories[0];
    const readRelease = (releaseDigest) => {
      const values = readers.map((reader) =>
        reader.releases.readRelease(releaseDigest),
      );
      if (
        !values[0] ||
        !same(values[0], values[1]) ||
        values[0].tenantId !== descriptor.tenantId ||
        values[0].skillName !== descriptor.skillName
      )
        fail("independent release content/lock differs");
      return values[0];
    };
    const cache = new Map();
    const releaseFor = (digest) => {
      if (!cache.has(digest)) cache.set(digest, readRelease(digest));
      return cache.get(digest);
    };
    const operations = history.operations.map(
      ({
        intent,
        previous,
        preparationCheckpoint,
        projection,
        finalizationEvidence,
      }) => {
        const release = releaseFor(intent.targetReleaseDigest);
        if (
          release.dependencyLockDigest !== intent.dependencyLockDigest ||
          (intent.operation === "promote" &&
            release.candidateId !== intent.candidateId)
        )
          fail("operation target bytes differ");
        return {
          operationId: intent.operationId,
          operation: intent.operation,
          requestDigest: intent.requestDigest,
          transactionId: intent.transactionId,
          intentDigest: intent.intentDigest,
          releaseDigest: release.releaseDigest,
          candidateId: release.candidateId,
          contentDigest: release.contentDigest,
          dependencyLockDigest: release.dependencyLockDigest,
          previousStateDigest: previous.stateDigest,
          fromReleaseDigest: previous.activeReleaseDigest,
          expectedRevision: intent.expectedRevision,
          status: projection.status,
          revision:
            projection.status === "committed" ? projection.revision : null,
          stateDigest:
            projection.status === "committed" ? projection.stateDigest : null,
          preparationSequence: preparationCheckpoint.sequence,
          preparationDigest: preparationCheckpoint.headDigest,
          sequence: finalizationEvidence ? projection.sequence : null,
          eventDigest: finalizationEvidence?.eventDigest ?? null,
          receiptDigest: projection.receiptDigest,
          occurredAt: finalizationEvidence?.timestamp ?? null,
        };
      },
    );
    const activeValues = readers.map((reader) =>
      reader.releases.readActive(descriptor.skillName),
    );
    if (!same(activeValues[0], activeValues[1]))
      fail("independent active states differ");
    const actual = activeValues[0];
    let active = null;
    if (actual) {
      if (!same(actual.release, releaseFor(actual.release.releaseDigest)))
        fail("active release bytes differ");
      releaseFor(actual.state.lastKnownGoodReleaseDigest);
      active = {
        revision: actual.state.revision,
        stateDigest: actual.state.stateDigest,
        releaseDigest: actual.release.releaseDigest,
        lastKnownGoodReleaseDigest: actual.state.lastKnownGoodReleaseDigest,
        candidateId: actual.release.candidateId,
        contentDigest: actual.release.contentDigest,
        dependencyLockDigest: actual.release.dependencyLockDigest,
        transactionId: actual.state.transactionId,
      };
    }
    const migration = history.migration
      ? {
          revision: history.migration.value.state.revision,
          stateDigest: history.migration.value.state.stateDigest,
          activeReleaseDigest:
            history.migration.value.state.activeReleaseDigest,
          lastKnownGoodReleaseDigest:
            history.migration.value.state.lastKnownGoodReleaseDigest,
          sequence: history.migration.sequence,
          eventDigest: history.migration.eventDigest,
        }
      : null;
    // Do not include unrelated later audit/Review/retention events in this
    // digest: retaining the projection must not invalidate itself.
    const { epoch, ledgerId, identityDigest } = context.checkpoint;
    const core = {
      schema: WORKBENCH_REGISTRY_STATE_SCHEMA,
      tenantId: descriptor.tenantId,
      skillName: descriptor.skillName,
      ledger: { epoch, ledgerId, identityDigest },
      migration,
      active,
      operations,
    };
    const registry = verifyWorkbenchRegistryState(
      { ...core, registryDigest: hash(WORKBENCH_REGISTRY_STATE_SCHEMA, core) },
      descriptor.tenantId,
      descriptor.skillName,
    );
    const transitions = readers.map((reader) => reader.transitions.list());
    if (!same(transitions[0], transitions[1]))
      fail("independent workflow histories differ");
    for (const transition of transitions[0])
      if (transition.settlement) {
        const settlement = transition.settlement;
        const operation = history.operations.find(
          (item) => item.intent.transactionId === settlement.transactionId,
        );
        if (
          !operation ||
          operation.projection.status !== "committed" ||
          operation.intent.operation !== "promote" ||
          operation.intent.targetReleaseDigest !==
            settlement.activeReleaseDigest ||
          operation.intent.candidateId !== settlement.candidateId ||
          operation.intent.requestDigest !== settlement.mutationRequestDigest ||
          operation.intent.authorityReceiptDigest !==
            settlement.authorityReceiptDigest ||
          operation.projection.stateDigest !== settlement.stateDigest ||
          operation.projection.revision !== settlement.revision ||
          transition.settlementEventSequence <= operation.projection.sequence
        )
          fail("workflow settlement has no exact prior Registry effect");
      }
    assertCurrent(context);
    return capture({ registry, transitions: transitions[0] });
  }
  const source = Object.freeze({
    descriptor,
    matchesLedger: (value) => value === ledger,
    currentContext,
    assertCurrent,
    load,
  });
  currentContext();
  SOURCES.add(source);
  return source;
}
