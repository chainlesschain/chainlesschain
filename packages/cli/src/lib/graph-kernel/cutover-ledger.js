import { createHash } from "node:crypto";
import { createRolloutStore } from "../app-server/rollout-store-factory.js";
import { assertGraphCutoverTransition } from "./authority.js";
import { graphDigest } from "./compiler.js";
import {
  normalizeGraphLegacyWriterObservation,
  normalizeGraphRetirementContract,
  normalizeGraphRetirementEvidence,
} from "./retirement-evidence.js";
import { graphStoreEvidenceDigest } from "./store-cutover-evidence.js";
import {
  GRAPH_CUTOVER_LEDGER_SCHEMA,
  GRAPH_CUTOVER_REQUIRED_PLATFORMS,
} from "./cutover-contract.js";

export {
  GRAPH_CUTOVER_LEDGER_SCHEMA,
  GRAPH_CUTOVER_REQUIRED_PLATFORMS,
} from "./cutover-contract.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const CUTOVER_STRATEGIES = new Set(["migrate", "retire", "disabled"]);

function cutoverError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "GraphCutoverLedgerError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function identifier(value, field) {
  const text = String(value || "").trim();
  if (!IDENTIFIER.test(text)) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_ARGUMENT_INVALID",
      `${field} is not a valid cutover identifier`,
    );
  }
  return text;
}

function digest(value, field) {
  const text = String(value || "");
  if (!DIGEST.test(text)) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_EVIDENCE_INVALID",
      `${field} must be a sha256 digest`,
    );
  }
  return text;
}

function storeInventory(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_STORE_INVENTORY_REQUIRED",
      "cutover entries require a non-empty durable store inventory",
    );
  }
  const normalized = value.map((entry) => identifier(entry, "store"));
  if (new Set(normalized).size !== normalized.length) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_STORE_INVENTORY_INVALID",
      "cutover store inventory contains duplicate stores",
    );
  }
  return normalized.sort();
}

function cutoverStrategy(value) {
  const strategy = String(value || "migrate").trim();
  if (!CUTOVER_STRATEGIES.has(strategy)) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_STRATEGY_INVALID",
      "cutoverStrategy must be migrate, retire, or disabled",
      { cutoverStrategy: value },
    );
  }
  return strategy;
}

function zero(value, field) {
  if (Number(value) !== 0) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_GATE_FAILED",
      `${field} must be zero before cutover`,
      { field, value },
    );
  }
  return 0;
}

function positive(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_GATE_FAILED",
      `${field} must be a positive safe integer`,
      { field, value },
    );
  }
  return number;
}

function percent(value, { allowZero = false } = {}) {
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number > 100 ||
    (allowZero ? number < 0 : number <= 0)
  ) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_EVIDENCE_INVALID",
      "canaryPercent must be within the allowed rollout range",
    );
  }
  return number;
}

function platformEvidence(value) {
  if (!Array.isArray(value)) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_PLATFORM_EVIDENCE_REQUIRED",
      "canonical default requires same-SHA platform evidence",
    );
  }
  const normalized = value.map((entry) => {
    const realJourney =
      entry?.schema === "chainlesschain.graph-agent-real-journey/v1" &&
      entry?.status === "passed" &&
      DIGEST.test(String(entry?.terminalEventDigest || "")) &&
      DIGEST.test(String(entry?.evidenceDigest || ""));
    return {
      platform: String(entry?.platform || "").toLowerCase(),
      commitSha: String(entry?.commitSha || "").toLowerCase(),
      passed: entry?.passed === true || realJourney,
      sourceEvidenceDigest: realJourney ? entry.evidenceDigest : null,
    };
  });
  for (const platform of GRAPH_CUTOVER_REQUIRED_PLATFORMS) {
    const matches = normalized.filter((entry) => entry.platform === platform);
    if (
      matches.length !== 1 ||
      matches[0].passed !== true ||
      !COMMIT.test(matches[0].commitSha)
    ) {
      throw cutoverError(
        "CC_GRAPH_CUTOVER_PLATFORM_EVIDENCE_REQUIRED",
        `canonical default requires one passing ${platform} result`,
      );
    }
  }
  if (
    new Set(normalized.map((entry) => entry.commitSha)).size !== 1 ||
    normalized.length !== GRAPH_CUTOVER_REQUIRED_PLATFORMS.length
  ) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_SHA_MISMATCH",
      "cutover platform evidence must bind one exact commit SHA",
    );
  }
  return normalized.sort((left, right) =>
    left.platform.localeCompare(right.platform),
  );
}

function migrationCutpoints(value, stores) {
  if (!Array.isArray(value)) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_MIGRATION_EVIDENCE_REQUIRED",
      "canonical default requires one migration cutpoint per store",
    );
  }
  const expected = storeInventory(stores);
  const normalized = value.map((entry) => ({
    store: identifier(entry?.store, "migrationCutpoints.store"),
    cutpointDigest: digest(
      entry?.cutpointDigest,
      "migrationCutpoints.cutpointDigest",
    ),
    recoveryReceiptDigest: digest(
      entry?.recoveryReceiptDigest,
      "migrationCutpoints.recoveryReceiptDigest",
    ),
    rollbackDrillDigest: digest(
      entry?.rollbackDrillDigest,
      "migrationCutpoints.rollbackDrillDigest",
    ),
    rpoLossCount: zero(entry?.rpoLossCount, "migrationCutpoints.rpoLossCount"),
    recovered: entry?.recovered === true,
  }));
  const actual = normalized.map((entry) => entry.store).sort();
  if (
    actual.length !== expected.length ||
    actual.some((store, index) => store !== expected[index]) ||
    normalized.some((entry) => !entry.recovered)
  ) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_MIGRATION_EVIDENCE_INCOMPLETE",
      "migration evidence must prove RPO=0 recovery for every declared store",
      { expectedStores: expected, actualStores: actual },
    );
  }
  return normalized.sort((left, right) =>
    left.store.localeCompare(right.store),
  );
}

function storeCoverageEvidence(value, state, commitSha) {
  if (
    !value ||
    value.schema !== "chainlesschain.graph-store-cutover-coverage/v1" ||
    !DIGEST.test(String(value.evidenceDigest || ""))
  ) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_STORE_MATRIX_REQUIRED",
      "canonical default requires the exact-SHA three-platform store matrix",
    );
  }
  const unsigned = { ...value };
  delete unsigned.evidenceDigest;
  if (graphStoreEvidenceDigest(unsigned) !== value.evidenceDigest) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_STORE_MATRIX_INVALID",
      "store cutover matrix digest does not match its contents",
    );
  }
  if (String(value.commitSha || "").toLowerCase() !== commitSha) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_SHA_MISMATCH",
      "store cutover matrix must bind the platform journey commit SHA",
    );
  }
  const requiredPlatforms = (value.requiredPlatforms || [])
    .map((platform) => String(platform).toLowerCase())
    .sort();
  if (
    JSON.stringify(requiredPlatforms) !==
    JSON.stringify([...GRAPH_CUTOVER_REQUIRED_PLATFORMS].sort())
  ) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_STORE_MATRIX_INCOMPLETE",
      "store cutover matrix does not require every supported platform",
    );
  }
  const matches = (value.entries || []).filter(
    (entry) =>
      entry?.surface === state.surface && entry?.entryId === state.entryId,
  );
  const entry = matches.length === 1 ? matches[0] : null;
  const stores = [...(entry?.stores || [])].sort();
  const expectedStores = [...state.stores].sort();
  const platformCoverage = entry?.platformCoverage || [];
  if (
    !entry ||
    entry.complete !== true ||
    JSON.stringify(stores) !== JSON.stringify(expectedStores) ||
    platformCoverage.length !== expectedStores.length ||
    platformCoverage.some(
      (store) =>
        store?.complete !== true ||
        !expectedStores.includes(store.store) ||
        JSON.stringify([...(store.coveredPlatforms || [])].sort()) !==
          JSON.stringify(requiredPlatforms) ||
        (store.missingPlatforms || []).length !== 0,
    )
  ) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_STORE_MATRIX_INCOMPLETE",
      "store cutover matrix does not prove every entry store on all platforms",
      { surface: state.surface, entryId: state.entryId },
    );
  }
  return {
    evidenceDigest: value.evidenceDigest,
    commitSha,
    requiredPlatforms,
    storeCount: expectedStores.length,
  };
}

function forwardEvidence(from, to, input, state) {
  if (from === "legacy" && to === "shadow") {
    const inventoryDigest = digest(input.inventoryDigest, "inventoryDigest");
    if (inventoryDigest !== state.manifestDigest) {
      throw cutoverError(
        "CC_GRAPH_CUTOVER_MANIFEST_EVIDENCE_MISMATCH",
        "shadow evidence does not match the manifest bound to this entry",
      );
    }
    return {
      inventoryDigest,
      unknownWriterCount: zero(input.unknownWriterCount, "unknownWriterCount"),
      shadowEffectInvocationCount: zero(
        input.shadowEffectInvocationCount,
        "shadowEffectInvocationCount",
      ),
    };
  }
  if (from === "shadow" && to === "canary") {
    return {
      shadowReportDigest: digest(
        input.shadowReportDigest,
        "shadowReportDigest",
      ),
      shadowRunCount: positive(input.shadowRunCount, "shadowRunCount"),
      divergenceCount: zero(input.divergenceCount, "divergenceCount"),
      unknownEffectCount: zero(input.unknownEffectCount, "unknownEffectCount"),
      shadowEffectInvocationCount: zero(
        input.shadowEffectInvocationCount,
        "shadowEffectInvocationCount",
      ),
      canaryPercent: percent(input.canaryPercent),
      optInOnly: input.optInOnly === true,
    };
  }
  if (from === "canary" && to === "canonical") {
    const platforms = platformEvidence(input.platformEvidence);
    const canonicalEvidence = {
      canaryReportDigest: digest(
        input.canaryReportDigest,
        "canaryReportDigest",
      ),
      canaryRunCount: positive(input.canaryRunCount, "canaryRunCount"),
      canaryFailureCount: zero(input.canaryFailureCount, "canaryFailureCount"),
      reconciliationCount: zero(
        input.reconciliationCount,
        "reconciliationCount",
      ),
      platformEvidence: platforms,
    };
    if (state.cutoverStrategy === "retire") {
      return {
        ...canonicalEvidence,
        retirementEvidence: normalizeGraphRetirementEvidence(
          input.retirementEvidence,
          {
            surface: state.surface,
            entryId: state.entryId,
            manifestDigest: state.manifestDigest,
            commitSha: platforms[0].commitSha,
            contract: state.retirementContract,
            requiredPlatforms: GRAPH_CUTOVER_REQUIRED_PLATFORMS,
          },
        ),
      };
    }
    return {
      ...canonicalEvidence,
      migrationCutpoints: migrationCutpoints(
        input.migrationCutpoints,
        state.stores,
      ),
      storeCoverageEvidence: storeCoverageEvidence(
        input.storeCoverageEvidence,
        state,
        platforms[0].commitSha,
      ),
    };
  }
  if (from === "canonical" && to === "legacy_read_only") {
    if (state.cutoverStrategy === "retire") {
      return {
        legacyWriterObservation: normalizeGraphLegacyWriterObservation(
          input.legacyWriterObservation,
          {
            surface: state.surface,
            entryId: state.entryId,
            manifestDigest: state.manifestDigest,
            commitSha: state.canonicalCommitSha,
            contract: state.retirementContract,
            notBefore: state.updatedAt,
          },
        ),
      };
    }
    return {
      writerInventoryDigest: digest(
        input.writerInventoryDigest,
        "writerInventoryDigest",
      ),
      legacyWriterProbeDigest: digest(
        input.legacyWriterProbeDigest,
        "legacyWriterProbeDigest",
      ),
      legacyWriterProbeCount: zero(
        input.legacyWriterProbeCount,
        "legacyWriterProbeCount",
      ),
    };
  }
  if (from === "legacy_read_only" && to === "canonical") {
    return {
      incidentDigest: digest(input.incidentDigest, "incidentDigest"),
      legacyWriterProbeCount: zero(
        input.legacyWriterProbeCount,
        "legacyWriterProbeCount",
      ),
    };
  }
  return null;
}

function rollbackEvidence(from, to, input) {
  if (from === "shadow" && to === "legacy") {
    return {
      incidentDigest: digest(input.incidentDigest, "incidentDigest"),
      shadowEffectInvocationCount: zero(
        input.shadowEffectInvocationCount,
        "shadowEffectInvocationCount",
      ),
      activeCanonicalWriterCount: zero(
        input.activeCanonicalWriterCount,
        "activeCanonicalWriterCount",
      ),
    };
  }
  if (
    (from === "canary" && to === "shadow") ||
    (from === "canonical" && to === "canary")
  ) {
    if (input.existingCanonicalRunsRetained !== true) {
      throw cutoverError(
        "CC_GRAPH_CUTOVER_ROLLBACK_UNSAFE",
        "rollback must retain canonical authority for existing runs",
      );
    }
    return {
      incidentDigest: digest(input.incidentDigest, "incidentDigest"),
      activeDispatchCount: zero(
        input.activeDispatchCount,
        "activeDispatchCount",
      ),
      existingCanonicalRunsRetained: true,
      canaryPercent:
        from === "canonical"
          ? percent(input.canaryPercent ?? 0, { allowZero: true })
          : 0,
    };
  }
  return null;
}

function normalizeEvidence(from, to, evidence, state) {
  const input = evidence && typeof evidence === "object" ? evidence : {};
  const normalized =
    forwardEvidence(from, to, input, state) ||
    rollbackEvidence(from, to, input);
  if (!normalized) {
    throw cutoverError(
      "CC_GRAPH_CUTOVER_TRANSITION_UNSUPPORTED",
      `no durable evidence contract exists for ${from} -> ${to}`,
    );
  }
  return normalized;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stateFrom(events) {
  return [...events]
    .reverse()
    .find(
      (event) => event.payload?.state?.schema === GRAPH_CUTOVER_LEDGER_SCHEMA,
    )?.payload?.state;
}

function projection(state, events) {
  return Object.freeze({
    ...clone(state),
    eventSeq: events.at(-1)?.event_seq || 0,
    eventHead: events.at(-1)?.hash || null,
  });
}

export class GraphCutoverLedger {
  constructor({ store = createRolloutStore(), now = Date.now } = {}) {
    this.store = store;
    this.now = now;
  }

  _thread(surface, entryId) {
    return `graph-cutover:${identifier(surface, "surface")}:${identifier(
      entryId,
      "entryId",
    )}`;
  }

  begin({
    surface,
    entryId,
    manifestDigest,
    stores,
    cutoverStrategy: strategyInput = "migrate",
    retirementContract = undefined,
  }) {
    const safeSurface = identifier(surface, "surface");
    const safeEntryId = identifier(entryId, "entryId");
    const safeManifestDigest = digest(manifestDigest, "manifestDigest");
    const safeCutoverStrategy = cutoverStrategy(strategyInput);
    const safeStores = storeInventory(stores, {
      allowEmpty: safeCutoverStrategy !== "migrate",
    });
    const safeRetirementContract =
      safeCutoverStrategy === "retire"
        ? normalizeGraphRetirementContract(retirementContract)
        : null;
    const threadId = this._thread(safeSurface, safeEntryId);
    this.store.start({
      threadId,
      title: `Graph cutover ${safeSurface}/${safeEntryId}`,
      metadata: {
        kind: "graph_cutover",
        surface: safeSurface,
        entryId: safeEntryId,
      },
    });
    let events = this.store.read(threadId);
    const existing = stateFrom(events);
    if (existing) {
      if (existing.manifestDigest !== safeManifestDigest) {
        throw cutoverError(
          "CC_GRAPH_CUTOVER_MANIFEST_CONFLICT",
          "cutover entry is already bound to a different manifest",
        );
      }
      if (JSON.stringify(existing.stores) !== JSON.stringify(safeStores)) {
        throw cutoverError(
          "CC_GRAPH_CUTOVER_STORE_INVENTORY_CONFLICT",
          "cutover entry is already bound to a different store inventory",
        );
      }
      if ((existing.cutoverStrategy || "migrate") !== safeCutoverStrategy) {
        throw cutoverError(
          "CC_GRAPH_CUTOVER_STRATEGY_CONFLICT",
          "cutover entry is already bound to a different strategy",
        );
      }
      const existingRetirementContract =
        safeCutoverStrategy === "retire"
          ? normalizeGraphRetirementContract(existing.retirementContract)
          : null;
      if (
        JSON.stringify(existingRetirementContract) !==
        JSON.stringify(safeRetirementContract)
      ) {
        throw cutoverError(
          "CC_GRAPH_CUTOVER_RETIREMENT_CONTRACT_CONFLICT",
          "cutover entry is already bound to a different retirement contract",
        );
      }
      return projection(existing, events);
    }
    const timestamp = new Date(this.now()).toISOString();
    const state = {
      schema: GRAPH_CUTOVER_LEDGER_SCHEMA,
      surface: safeSurface,
      entryId: safeEntryId,
      manifestDigest: safeManifestDigest,
      cutoverStrategy: safeCutoverStrategy,
      retirementContract: safeRetirementContract,
      stores: safeStores,
      stage: "legacy",
      canaryPercent: 0,
      optInOnly: false,
      transitionCount: 0,
      rollbackCount: 0,
      lastEvidenceDigest: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.append({
      threadId,
      eventType: "cutover.initialized",
      idempotencyKey: `cutover:${safeSurface}:${safeEntryId}:initialized`,
      payload: { state },
      expectedRevision: events.at(-1)?.event_seq,
      expectedHeadHash: events.at(-1)?.hash,
    });
    events = this.store.read(threadId);
    return projection(stateFrom(events), events);
  }

  recover(surface, entryId) {
    const events = this.store.read(this._thread(surface, entryId));
    const state = stateFrom(events);
    if (!state) {
      throw cutoverError(
        "CC_GRAPH_CUTOVER_NOT_FOUND",
        `Graph cutover was not found: ${surface}/${entryId}`,
      );
    }
    return projection(state, events);
  }

  transition(surface, entryId, to, evidence = {}, { expectedEventHead } = {}) {
    const current = this.recover(surface, entryId);
    if (
      expectedEventHead !== undefined &&
      current.eventHead !== expectedEventHead
    ) {
      throw cutoverError(
        "CC_GRAPH_CUTOVER_HEAD_CONFLICT",
        "cutover ledger changed before transition",
        { expectedEventHead, actualEventHead: current.eventHead },
      );
    }
    if (current.stage === to) return current;
    if ((current.cutoverStrategy || "migrate") === "disabled") {
      throw cutoverError(
        "CC_GRAPH_CUTOVER_ENTRY_DISABLED",
        "disabled runtime entries cannot advance through rollout stages",
        { surface, entryId, stage: current.stage, requestedStage: to },
      );
    }
    assertGraphCutoverTransition(current.stage, to);
    const normalized = normalizeEvidence(current.stage, to, evidence, current);
    const rollback = [
      "shadow:legacy",
      "canary:shadow",
      "canonical:canary",
    ].includes(`${current.stage}:${to}`);
    const next = {
      ...clone(current),
      stage: to,
      canaryPercent:
        to === "canary"
          ? normalized.canaryPercent
          : ["canonical", "legacy_read_only"].includes(to)
            ? 100
            : 0,
      optInOnly: to === "canary" ? normalized.optInOnly === true : false,
      canonicalCommitSha:
        to === "canonical"
          ? normalized.platformEvidence[0].commitSha
          : current.canonicalCommitSha || null,
      transitionCount: current.transitionCount + 1,
      rollbackCount: current.rollbackCount + (rollback ? 1 : 0),
      lastEvidenceDigest: graphDigest(
        { from: current.stage, to, evidence: normalized },
        "cc.graph.cutover-evidence/v1",
      ),
      updatedAt: new Date(this.now()).toISOString(),
    };
    delete next.eventSeq;
    delete next.eventHead;
    const threadId = this._thread(surface, entryId);
    const events = this.store.read(threadId);
    this.store.append({
      threadId,
      eventType: `cutover.${to}`,
      idempotencyKey: `cutover:${current.transitionCount + 1}:${current.stage}:${to}`,
      payload: {
        from: current.stage,
        to,
        evidence: normalized,
        state: next,
      },
      expectedRevision: events.at(-1)?.event_seq,
      expectedHeadHash: current.eventHead,
    });
    const updatedEvents = this.store.read(threadId);
    return projection(stateFrom(updatedEvents), updatedEvents);
  }

  authorityMode(surface, entryId, { runKey, optIn = false } = {}) {
    const state = this.recover(surface, entryId);
    if ((state.cutoverStrategy || "migrate") === "disabled") return "legacy";
    if (state.stage === "legacy") return "legacy";
    if (state.stage === "shadow") return "shadow";
    if (["canonical", "legacy_read_only"].includes(state.stage)) {
      return "canonical";
    }
    if (state.optInOnly) return optIn === true ? "canonical" : "shadow";
    const key = identifier(runKey, "runKey");
    const bucket =
      Number.parseInt(
        createHash("sha256")
          .update(`${state.surface}:${state.entryId}:${key}`, "utf8")
          .digest("hex")
          .slice(0, 8),
        16,
      ) % 10_000;
    return bucket < Math.round(state.canaryPercent * 100)
      ? "canonical"
      : "shadow";
  }
}
