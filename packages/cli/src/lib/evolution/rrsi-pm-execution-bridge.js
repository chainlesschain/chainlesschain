/** RRSI accounting around an existing PM host. No provider or signing factory. */
import { isProxy } from "node:util/types";
import { captureRrsiHistoryLedgerAdapter } from "./rrsi-history-ledger-adapter.js";
import {
  recheckRrsiEffectiveParent,
  assertRrsiEffectiveParentHistory,
  RRSI_PARENT_BINDING_V2_SCHEMA,
} from "./rrsi-parent-binding.js";
import { verifyRrsiCampaign, RRSI_BUDGET_FIELDS } from "./rrsi-contracts.js";
import {
  RRSI_PREPARATION_RESERVATION_SCHEMA_V2,
  rrsiTrainingSourcesDigest,
} from "./rrsi-preparation-contracts.js";
import { verifyRrsiPmTrainingMapping } from "./rrsi-pm-training-mapping.js";
import {
  inspectPmExplorationJournal,
  verifyPmExplorationPlan,
} from "./pm-exploration-rounds.js";
import {
  inspectPmExplorationExecutionHost,
  verifyPmExplorationExecutionManifest,
  executePmExplorationRound,
} from "./pm-exploration-execution-host.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiId,
  rrsiInteger,
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  freezeRrsiData,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_PM_BRIDGE_SCHEMA =
  "chainlesschain.rrsi-pm-execution-bridge/v1";
export const RRSI_PM_BRIDGE_RESULT_SCHEMA =
  "chainlesschain.rrsi-pm-bridge-result/v1";
const BRIDGES = new WeakMap();
const HOST_OWNERS = new WeakMap();
const JOURNAL_OWNERS = new WeakMap();
const IN_FLIGHT = new WeakSet();
const PENDING = new WeakMap();

function composition(input) {
  const keys = [
    "history",
    "host",
    "campaign",
    "suite",
    "plan",
    "manifest",
    "mapping",
  ];
  if (
    !input ||
    typeof input !== "object" ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== keys.length
  )
    rrsiFail("PM bridge composition must be plain own fields");
  return Object.fromEntries(
    keys.map((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("PM bridge composition cannot use accessors");
      return [key, field.value];
    }),
  );
}

function stateFor(bridge) {
  const state = BRIDGES.get(bridge);
  if (!state) rrsiFail("a branded RRSI PM bridge is required");
  return state;
}

/** Root-owned composition, once per host. Direct bridge calls retain the binding. */
export function bindRrsiPmRuntime(bridge, parentBinding, mode) {
  const state = stateFor(bridge);
  if (!["off", "shadow"].includes(mode))
    rrsiFail(
      "enforced RRSI runtime requires complete production admission",
      "CC_RRSI_COMPOSITION_UNAVAILABLE",
    );
  recheckRrsiEffectiveParent(parentBinding);
  if (parentBinding.descriptor.campaignDigest !== state.campaign.campaignDigest)
    rrsiFail("effective parent is bound to another campaign");
  if (parentBinding.descriptor.schema === RRSI_PARENT_BINDING_V2_SCHEMA)
    assertRrsiEffectiveParentHistory(parentBinding, state.history);
  if (
    state.runtimeBinding &&
    (state.runtimeBinding.parentBinding !== parentBinding ||
      state.runtimeBinding.mode !== mode)
  )
    rrsiFail("PM bridge runtime binding is immutable");
  state.runtimeBinding ??= Object.freeze({ parentBinding, mode });
  return Object.freeze({
    descriptor: bridge.descriptor,
    mode,
    parentBindingDigest: parentBinding.descriptor.parentBindingDigest,
    inspectHistory: state.history.inspect,
    reserveBroadRound: (journal, input) =>
      reserveRrsiPmBroadRound(bridge, journal, input),
    executeBroadRound: (response) => executeRrsiPmBroadRound(bridge, response),
  });
}

function checkRuntime(state) {
  const binding = state.runtimeBinding;
  if (!binding) return; // Legacy local bridge has no production admission claims.
  if (binding.mode === "off")
    rrsiFail("RRSI runtime is off", "CC_RRSI_RUNTIME_OFF");
  // Re-read the actual captured Registry; never accept a replayable JSON readback.
  recheckRrsiEffectiveParent(binding.parentBinding);
}

function checkHistory(state) {
  const status = state.history.inspect();
  const registered = status.preparationPlan;
  if (
    !registered ||
    registered.planDigest !== state.plan.planDigest ||
    registered.manifestDigest !== state.manifest.manifestDigest ||
    registered.trainingMappingDigest !== state.mapping.trainingMappingDigest ||
    registered.pmTrainingPartitionDigest !==
      state.mapping.pmTrainingPartitionDigest ||
    registered.trainingPartitionDigest !==
      state.mapping.rrsiTrainingPartitionDigest ||
    registered.trainingSourcesDigest !==
      rrsiTrainingSourcesDigest(state.campaign) ||
    registered.executionDigest !==
      rrsiHash(
        "chainlesschain.rrsi-execution-bindings/v1",
        state.campaign.execution,
      )
  )
    rrsiFail(
      "PM bridge differs from frozen preparation plan",
      "CC_RRSI_HISTORY_HOLD",
    );
  return status;
}

export function createRrsiPmExplorationBridge(input) {
  const options = composition(input);
  const history = captureRrsiHistoryLedgerAdapter(options.history);
  const hostProjection = inspectPmExplorationExecutionHost(options.host);
  const campaign = verifyRrsiCampaign(options.campaign);
  const plan = freezeRrsiData(snapshotRrsiData(options.plan));
  const manifest = freezeRrsiData(snapshotRrsiData(options.manifest));
  verifyPmExplorationPlan(plan);
  verifyPmExplorationExecutionManifest(manifest);
  if (Object.hasOwn(manifest, "curriculum"))
    rrsiFail("RRSI bridge currently requires a host without curriculum");
  if (
    history.descriptor.tenantId !== campaign.tenantId ||
    history.descriptor.goalId !== campaign.goalId
  )
    rrsiFail("PM bridge history scope differs from campaign");
  if (
    hostProjection.planDigest !== plan.planDigest ||
    hostProjection.manifestDigest !== manifest.manifestDigest ||
    hostProjection.environmentDigest !== campaign.execution.environmentDigest ||
    manifest.planDigest !== plan.planDigest ||
    manifest.environmentDigest !== plan.environmentDigest
  )
    rrsiFail("PM host differs from campaign, plan or manifest");
  const mapping = verifyRrsiPmTrainingMapping(options.mapping, {
    campaign,
    suite: options.suite,
    plan,
  });
  const state = {
    history,
    host: options.host,
    campaign,
    plan,
    manifest,
    mapping,
  };
  checkHistory(state);
  const descriptor = rrsiEnvelope(RRSI_PM_BRIDGE_SCHEMA, "bridgeDigest", {
    scopeId: history.descriptor.scopeId,
    campaignDigest: campaign.campaignDigest,
    planDigest: plan.planDigest,
    manifestDigest: manifest.manifestDigest,
    trainingMappingDigest: mapping.trainingMappingDigest,
    parentReleaseDigest: campaign.parentReleaseDigest,
    initialMemoryDigest: plan.initialMemoryDigest,
    executionDigest: rrsiHash(
      "chainlesschain.rrsi-execution-bindings/v1",
      campaign.execution,
    ),
    supportedOperation: "broad-round-without-curriculum",
    plannedExecutionUnits: ["pm-runner", "pm-grader"],
    pmEnforcedResourceFields: ["maxTokens", "maxToolCalls", "maxWallClockMs"],
    monetaryBudgetEnforced: false,
    executionCountBudgetEnforced: false,
    mappingAuthenticated: false,
    parentProvenanceVerified: false,
    modelPricingAdmissionVerified: false,
    productionIsolationVerified: false,
  });
  const owner = HOST_OWNERS.get(options.host);
  if (owner) {
    const previous = stateFor(owner);
    if (
      previous.history === history &&
      owner.descriptor.bridgeDigest === descriptor.bridgeDigest
    )
      return owner;
    rrsiFail("PM host is already bound to another RRSI bridge");
  }
  const bridge = Object.freeze({ descriptor });
  BRIDGES.set(bridge, state);
  HOST_OWNERS.set(options.host, bridge);
  return bridge;
}

function assertJournal(bridge, state, journal, round) {
  const projection = inspectPmExplorationJournal(journal);
  const owner = JOURNAL_OWNERS.get(journal);
  if (owner && owner !== bridge)
    rrsiFail("PM journal belongs to another bridge");
  if (projection.planDigest !== state.plan.planDigest)
    rrsiFail("PM journal plan differs from bridge");
  if (round.stage !== "broad")
    rrsiFail("RRSI bridge currently supports broad rounds only");
  if (
    projection.stage !== "broad" ||
    projection.stopReason !== null ||
    projection.frozenMemoryDigest !== null ||
    projection.activeRoundCount !== 0
  )
    rrsiFail(
      "PM journal is stopped, frozen or already running",
      "CC_RRSI_HISTORY_HOLD",
    );
  const head = projection.branchHeads.find(
    (entry) => entry.branchId === round.branchId,
  );
  if (!head || head.memoryDigest !== round.inputMemoryDigest)
    rrsiFail("PM input memory differs from current branch head");
  if (!state.mapping.mappings.some((row) => row.pmTaskId === round.taskId))
    rrsiFail("PM task is outside frozen training mapping");
  return projection;
}

/** Reserve all host-accessible training sources and the complete PM plan caps. */
export function reserveRrsiPmBroadRound(bridge, journal, input) {
  const state = stateFor(bridge);
  checkRuntime(state);
  const value = snapshotRrsiData(input);
  rrsiExact(
    value,
    [
      "roundId",
      "stage",
      "branchId",
      "taskId",
      "inputMemoryDigest",
      "slotId",
      "executionId",
      "budget",
    ],
    "RRSI PM round request",
  );
  for (const key of ["roundId", "branchId", "taskId", "slotId", "executionId"])
    rrsiId(value[key], key);
  if (IN_FLIGHT.has(state.host))
    rrsiFail("PM host is already running", "CC_RRSI_HISTORY_HOLD");
  checkHistory(state);
  const round = freezeRrsiData(
    Object.fromEntries(
      ["roundId", "stage", "branchId", "taskId", "inputMemoryDigest"].map(
        (key) => [key, value[key]],
      ),
    ),
  );
  const before = assertJournal(bridge, state, journal, round);
  rrsiExact(value.budget, RRSI_BUDGET_FIELDS, "PM preparation budget");
  for (const field of RRSI_BUDGET_FIELDS)
    rrsiInteger(value.budget[field], field);
  for (const field of ["maxTokens", "maxToolCalls", "maxWallClockMs"])
    if (value.budget[field] < state.plan[field])
      rrsiFail("reservation must cover the complete PM plan resource caps");
  if (value.budget.maxExecutions < 2)
    rrsiFail("PM round requires runner and grader execution reservations");
  const task = state.mapping.mappings.find(
    (row) => row.pmTaskId === round.taskId,
  );
  checkRuntime(state);
  const response = state.history.reservePreparation({
    campaignDigest: state.campaign.campaignDigest,
    phase: "exploration",
    sourceTaskIds: state.mapping.mappings.map((row) => row.rrsiTaskId).sort(),
    inputs: {
      instructionDigest: rrsiHash(
        "chainlesschain.rrsi-pm-broad-instruction/v1",
        {
          operation: "run-and-grade",
          stage: "broad",
          taskContentDigest: task.contentDigest,
          planDigest: state.plan.planDigest,
          manifestDigest: state.manifest.manifestDigest,
          trainingMappingDigest: state.mapping.trainingMappingDigest,
        },
      ),
      memoryDigest: round.inputMemoryDigest,
      artifactDigests: [
        state.mapping.trainingMappingDigest,
        state.plan.planDigest,
        state.manifest.manifestDigest,
      ].sort(),
    },
    roundId: round.roundId,
    branchId: round.branchId,
    slotId: value.slotId,
    executionId: value.executionId,
    budget: value.budget,
    plannedExecutions: 2,
  });
  JOURNAL_OWNERS.set(journal, bridge);
  if (response.newlyCommitted)
    PENDING.set(response, { bridge, journal, round, before });
  return response;
}

function journalDrift(before, after, round, result) {
  const checkpoint = result.checkpoint;
  if (
    checkpoint.roundId !== round.roundId ||
    checkpoint.stage !== round.stage ||
    checkpoint.branchId !== round.branchId ||
    checkpoint.taskId !== round.taskId ||
    checkpoint.inputMemoryDigest !== round.inputMemoryDigest ||
    after.planDigest !== before.planDigest ||
    after.stage !== before.stage ||
    after.activeRoundCount !== 0 ||
    after.mergeDigest !== before.mergeDigest ||
    after.deepHead !== before.deepHead ||
    after.frozenMemoryDigest !== before.frozenMemoryDigest ||
    rrsiCanonical(after.checkpointDigests) !==
      rrsiCanonical([
        ...before.checkpointDigests,
        checkpoint.checkpointDigest,
      ]) ||
    rrsiCanonical(after.aggregateMetrics) !==
      rrsiCanonical(checkpoint.aggregateMetrics)
  )
    return true;
  const expectedHeads = before.branchHeads.map((head) =>
    head.branchId === round.branchId
      ? {
          branchId: head.branchId,
          memoryDigest: checkpoint.effectiveMemoryDigest,
          checkpointCount: head.checkpointCount + 1,
          checkpointDigest: checkpoint.checkpointDigest,
        }
      : head,
  );
  return (
    rrsiCanonical(after.branchHeads) !== rrsiCanonical(expectedHeads) ||
    ["tokens", "toolCalls", "wallClockMs"].some(
      (key) =>
        after.aggregateMetrics[key] !==
        before.aggregateMetrics[key] + checkpoint.metrics[key],
    )
  );
}

/** Consume the fresh history/bridge capability synchronously before the await. */
export async function executeRrsiPmBroadRound(bridge, response) {
  const state = stateFor(bridge);
  const pending = PENDING.get(response);
  if (!pending || pending.bridge !== bridge)
    rrsiFail(
      "PM dispatch requires this bridge's fresh round reservation",
      "CC_RRSI_REPLAY_FORBIDDEN",
    );
  PENDING.delete(response);
  if (IN_FLIGHT.has(state.host))
    rrsiFail("PM host is already running", "CC_RRSI_HISTORY_HOLD");
  IN_FLIGHT.add(state.host);
  let dispatchPersistence = "not-attempted";
  let hostInvoked = false;
  let result = null;
  let driftDetected = false;
  let failureCode = null;
  let observationPersistence = "not-recorded";
  const binding = {
    executionId: response.reservation.bindings.executionId,
    reservationDigest: response.reservation.reservationDigest,
  };
  try {
    try {
      checkRuntime(state);
      checkHistory(state);
      const before = assertJournal(
        bridge,
        state,
        pending.journal,
        pending.round,
      );
      if (rrsiCanonical(before) !== rrsiCanonical(pending.before)) {
        driftDetected = true;
        rrsiFail(
          "PM journal changed after reservation",
          "CC_RRSI_HISTORY_HOLD",
        );
      }
      if (
        response.reservation.schema !==
          RRSI_PREPARATION_RESERVATION_SCHEMA_V2 ||
        response.reservation.plannedExecutions < 2
      )
        rrsiFail("PM execution requires a v2 runner and grader reservation");
      dispatchPersistence = "unknown";
      const dispatch = state.history.recordDispatch(response);
      dispatchPersistence = "persisted";
      if (!dispatch.newlyCommitted)
        rrsiFail(
          "PM dispatch was already recorded",
          "CC_RRSI_REPLAY_FORBIDDEN",
        );
      // Ledger I/O can outlast the earlier parent read. Recheck after durable
      // dispatch, before entering the host; failure retains unknown accounting.
      checkRuntime(state);
      hostInvoked = true;
      result = await executePmExplorationRound(
        state.host,
        pending.journal,
        pending.round,
      );
      driftDetected = journalDrift(
        pending.before,
        inspectPmExplorationJournal(pending.journal),
        pending.round,
        result,
      );
      if (driftDetected) failureCode = "rrsi-pm-journal-drift";
    } catch (error) {
      const known = [
        "CC_RRSI_COMMIT_UNKNOWN",
        "CC_RRSI_HISTORY_HOLD",
        "CC_RRSI_BUDGET_EXCEEDED",
        "CC_RRSI_REPLAY_FORBIDDEN",
        "CC_RRSI_PARENT_DRIFT",
        "CC_RRSI_RUNTIME_OFF",
      ];
      failureCode = known.includes(error?.code)
        ? error.code.toLowerCase()
        : "rrsi-pm-execution-unresolved";
    }
    try {
      if (dispatchPersistence === "persisted") {
        state.history.recordPreparationObservation({
          ...binding,
          observation: { result, failureCode, driftDetected },
        });
        observationPersistence = "persisted";
      } else if (dispatchPersistence === "not-attempted") {
        state.history.markUnknown(binding);
      }
    } catch {
      // The event may have committed. Keep the result; readback, never execute again.
      observationPersistence = "unknown";
      failureCode ??= "rrsi-pm-observation-unknown";
    }
    return rrsiEnvelope(RRSI_PM_BRIDGE_RESULT_SCHEMA, "resultDigest", {
      bridgeDigest: bridge.descriptor.bridgeDigest,
      reservationDigest: binding.reservationDigest,
      dispatchCommitted:
        dispatchPersistence === "unknown"
          ? null
          : dispatchPersistence === "persisted",
      dispatchPersistence,
      hostInvoked,
      pmResult: result,
      pmReceiptsVerified: result?.receiptsAuthenticated === true,
      journalDriftDetected: driftDetected,
      failureCode,
      observationPersistence,
      readbackRequired:
        observationPersistence === "unknown" ||
        dispatchPersistence === "unknown",
      independentSettlementRequired: true,
      cleanupConfirmed: null,
      monetaryBudgetEnforced: false,
      executionEvidenceVerified: false,
      costEvidenceVerified: false,
      qualityVerdictVerified: false,
    });
  } finally {
    IN_FLIGHT.delete(state.host);
  }
}
