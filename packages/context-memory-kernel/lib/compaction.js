"use strict";

const { randomUUID } = require("node:crypto");
const {
  COMPACTION_EVENT_SCHEMA,
  CONTEXT_ERROR_CODES,
  CONTEXT_TRUST,
  SENSITIVITY,
} = require("./constants.js");
const { canonicalDigest, cloneCanonical } = require("./canonical.js");
const {
  normalizeContextItem,
  boundedString,
  identifier,
  objectValue,
  assertKnownFields,
  jsonByteLength,
} = require("./contracts.js");
const { planContext, isProtected, stableItemCompare } = require("./planner.js");
const { invalidArgument, kernelError } = require("./errors.js");

const REQUEST_FIELDS = new Set([
  "operationId",
  "sessionId",
  "modelWindowTokens",
  "reservedOutputTokens",
  "safetyMarginTokens",
  "recoveryReserveTokens",
  "sink",
  "scopeAdmissions",
  "partitionCeilings",
  "partitionMinimums",
  "policyVersion",
  "modelProfile",
  "memoryRevision",
  "summarizer",
  "allowFallback",
  "now",
  "metadata",
]);
const SUMMARY_KINDS = new Set(["message", "memory", "project-rule", "artifact-ref"]);

function nowIso(options) {
  const epoch = Number((options.clock || Date.now)());
  if (!Number.isFinite(epoch)) throw invalidArgument("clock returned an invalid timestamp");
  return new Date(epoch).toISOString();
}

function itemMap(items) {
  return new Map(items.map((item) => [item.itemId, item]));
}

function validateCompactionInvariants(originalInput, compactedInput) {
  const original = originalInput.map(normalizeContextItem);
  const compacted = compactedInput.map(normalizeContextItem);
  const before = itemMap(original);
  const after = itemMap(compacted);
  const violations = [];
  for (const item of original) {
    if (
      (isProtected(item) ||
        (item.kind === "system-policy" && ["host", "verified"].includes(item.trust))) &&
      after.get(item.itemId)?.digest !== item.digest
    ) {
      violations.push({ code: "protected_item_changed", itemId: item.itemId });
    }
  }
  const toolGroups = new Map();
  for (const item of original) {
    const callId = item.binding?.toolCallId;
    if (!callId) continue;
    if (!toolGroups.has(callId)) toolGroups.set(callId, []);
    toolGroups.get(callId).push(item);
  }
  for (const [toolCallId, group] of toolGroups) {
    const retained = group.filter((item) => after.has(item.itemId));
    if (retained.length > 0 && retained.length !== group.length) {
      violations.push({
        code: "tool_pair_split",
        toolCallId,
        retained: retained.map((item) => item.itemId),
      });
    }
  }
  const seen = new Set();
  for (const item of compacted) {
    if (seen.has(item.itemId)) violations.push({ code: "duplicate_output_item", itemId: item.itemId });
    seen.add(item.itemId);
    const previous = before.get(item.itemId);
    if (previous && previous.digest !== item.digest) {
      violations.push({ code: "identity_reused_with_new_digest", itemId: item.itemId });
    }
  }
  return { ok: violations.length === 0, violations };
}

function normalizeUsageReceipt(input) {
  const value = objectValue(input, "usageReceipt");
  assertKnownFields(
    value,
    new Set([
      "outcome",
      "callId",
      "provider",
      "model",
      "inputTokens",
      "outputTokens",
      "costUsd",
      "ledgerDigest",
    ]),
    "usageReceipt",
  );
  if (!["settled", "not_metered"].includes(value.outcome)) {
    throw kernelError(
      CONTEXT_ERROR_CODES.PROVIDER_USAGE_UNSETTLED,
      "provider-backed compaction usage must be settled or explicitly not metered",
    );
  }
  jsonByteLength(value, "usageReceipt", 16 * 1024);
  return cloneCanonical(value);
}

function validateDerivedSummaryItem(itemInput, parentItems, allOriginalIds) {
  const item = normalizeContextItem(itemInput);
  if (allOriginalIds.has(item.itemId)) {
    throw kernelError(
      CONTEXT_ERROR_CODES.DERIVATION_POLICY_VIOLATION,
      "summary item cannot reuse an original ContextItem identity",
      { itemId: item.itemId },
    );
  }
  if (!SUMMARY_KINDS.has(item.kind) || item.binding || item.pinned) {
    throw kernelError(
      CONTEXT_ERROR_CODES.DERIVATION_POLICY_VIOLATION,
      "summary cannot create control, pending, pinned, tool, or system state",
      { itemId: item.itemId, kind: item.kind },
    );
  }
  const parentDigests = item.provenance.parentDigests || [];
  if (parentDigests.length === 0) {
    throw kernelError(
      CONTEXT_ERROR_CODES.DERIVATION_POLICY_VIOLATION,
      "summary provenance must bind parent digests",
      { itemId: item.itemId },
    );
  }
  const parentsByDigest = new Map(parentItems.map((parent) => [parent.digest, parent]));
  const parents = parentDigests.map((digest) => parentsByDigest.get(digest));
  if (parents.some((parent) => !parent)) {
    throw kernelError(
      CONTEXT_ERROR_CODES.DERIVATION_POLICY_VIOLATION,
      "summary provenance references content outside the dropped input",
      { itemId: item.itemId },
    );
  }
  if (parents.some((parent) => parent.scope !== item.scope || parent.scopeId !== item.scopeId)) {
    throw kernelError(CONTEXT_ERROR_CODES.SCOPE_DENIED, "summary cannot widen or combine scopes", {
      itemId: item.itemId,
    });
  }
  const leastTrusted = Math.max(...parents.map((parent) => CONTEXT_TRUST.indexOf(parent.trust)));
  if (CONTEXT_TRUST.indexOf(item.trust) < leastTrusted) {
    throw kernelError(
      CONTEXT_ERROR_CODES.DERIVATION_POLICY_VIOLATION,
      "summary cannot increase source trust",
      { itemId: item.itemId },
    );
  }
  const mostSensitive = Math.max(
    ...parents.map((parent) => SENSITIVITY.indexOf(parent.sensitivity)),
  );
  if (SENSITIVITY.indexOf(item.sensitivity) < mostSensitive) {
    throw kernelError(
      CONTEXT_ERROR_CODES.DERIVATION_POLICY_VIOLATION,
      "summary cannot lower sensitivity",
      { itemId: item.itemId },
    );
  }
  const allowedIntersection = parents
    .map((parent) => new Set(parent.allowedSinks))
    .reduce((intersection, current) => {
      if (intersection.has("*")) return current;
      if (current.has("*")) return intersection;
      return new Set([...intersection].filter((sink) => current.has(sink)));
    });
  if (
    item.allowedSinks.some(
      (sink) =>
        (sink === "*" && !allowedIntersection.has("*")) ||
        (sink !== "*" &&
          !allowedIntersection.has("*") &&
          !allowedIntersection.has(sink)),
    )
  ) {
    throw kernelError(CONTEXT_ERROR_CODES.SINK_DENIED, "summary cannot expand allowed sinks", {
      itemId: item.itemId,
    });
  }
  return item;
}

function normalizeSummaryOutput(output, parentItems, allOriginalIds) {
  const value = objectValue(output, "summarizer output");
  assertKnownFields(
    value,
    new Set(["items", "usageReceipt", "degraded", "degradedReason"]),
    "summarizer output",
  );
  if (!Array.isArray(value.items) || value.items.length > 1000) {
    throw invalidArgument("summarizer output.items must be an array with at most 1000 items");
  }
  if (value.degraded !== undefined && typeof value.degraded !== "boolean") {
    throw invalidArgument("summarizer output.degraded must be boolean");
  }
  return {
    items: value.items.map((item) =>
      validateDerivedSummaryItem(item, parentItems, allOriginalIds),
    ),
    usageReceipt: normalizeUsageReceipt(value.usageReceipt),
    degraded: value.degraded === true,
    ...(value.degradedReason === undefined
      ? {}
      : {
          degradedReason: boundedString(
            value.degradedReason,
            "summarizer output.degradedReason",
            { min: 1, max: 160 },
          ),
        }),
  };
}

function lifecycleEntry(state, at, details) {
  return { state, at, ...(details === undefined ? {} : { details: cloneCanonical(details) }) };
}

async function persistReconciliation(ports, receipt, expectedHead) {
  if (typeof ports.session.appendReconciliation !== "function") return null;
  return ports.session.appendReconciliation(receipt, expectedHead);
}

function planRequest(request, snapshot, items, startedAt) {
  return {
    modelWindowTokens: request.modelWindowTokens,
    reservedOutputTokens: request.reservedOutputTokens,
    safetyMarginTokens: request.safetyMarginTokens,
    recoveryReserveTokens: request.recoveryReserveTokens,
    items,
    sink: request.sink,
    scopeAdmissions: request.scopeAdmissions,
    partitionCeilings: request.partitionCeilings,
    partitionMinimums: request.partitionMinimums,
    policyVersion: request.policyVersion,
    modelProfile: request.modelProfile,
    sessionHead: snapshot.head,
    memoryRevision: request.memoryRevision ?? snapshot.memoryRevision ?? 0,
    now: startedAt,
  };
}

async function compactContextWithPorts(input, ports, options = {}) {
  const request = objectValue(input, "CompactionRequest");
  assertKnownFields(request, REQUEST_FIELDS, "CompactionRequest");
  if (
    !ports ||
    typeof ports.session?.readSnapshot !== "function" ||
    typeof ports.session?.appendCompaction !== "function"
  ) {
    throw invalidArgument("SessionContextPort must provide readSnapshot and appendCompaction");
  }
  const operationId = identifier(
    request.operationId || `compact-${(options.randomUUID || randomUUID)()}`,
    "operationId",
  );
  const sessionId = boundedString(request.sessionId, "sessionId", { min: 1, max: 160 });
  if (typeof ports.session.readCompactionOperation === "function") {
    const existing = await ports.session.readCompactionOperation(operationId);
    if (existing) return cloneCanonical(existing);
  }
  const startedAt =
    request.now === undefined
      ? nowIso(options)
      : (() => {
          try {
            return new Date(request.now).toISOString();
          } catch {
            throw invalidArgument("now must be a valid timestamp", { field: "now" });
          }
        })();
  if (request.metadata !== undefined) jsonByteLength(request.metadata, "metadata", 64 * 1024);
  const lifecycle = [lifecycleEntry("evaluating", startedAt)];
  const snapshot = await ports.session.readSnapshot(sessionId);
  if (!snapshot || !Array.isArray(snapshot.items) || !snapshot.head) {
    throw invalidArgument("SessionContextPort returned an invalid snapshot", { sessionId });
  }
  const originalItems = snapshot.items.map(normalizeContextItem);
  const inputDigest = canonicalDigest(
    { sessionId, head: snapshot.head, items: originalItems.map((item) => item.digest) },
    "chainlesschain.compaction-input/v1",
  );
  lifecycle.push(lifecycleEntry("preparing", nowIso(options), { inputDigest }));

  let plan;
  try {
    plan = planContext(planRequest(request, snapshot, originalItems, startedAt));
  } catch (error) {
    error.compactionLifecycle = [
      ...lifecycle,
      lifecycleEntry("aborted", nowIso(options), { code: error.code || "planning_failed" }),
    ];
    throw error;
  }

  let outputItems = [...plan.selected];
  let contextPlanDigest = plan.digest;
  let usageReceipt = null;
  let degraded = false;
  let strategy = "deterministic-selection";
  let summaryDropped = [];
  if (typeof request.summarizer === "function" && plan.dropped.length > 0) {
    lifecycle.push(lifecycleEntry("summarizing", nowIso(options)));
    const droppedIds = new Set(plan.dropped.map((entry) => entry.itemId));
    const droppedItems = originalItems.filter((item) => droppedIds.has(item.itemId));
    try {
      const summary = normalizeSummaryOutput(
        await request.summarizer(droppedItems, {
          operationId,
          sessionId,
          inputHead: snapshot.head,
          inputDigest,
          contextPlanDigest,
          memoryRevision: plan.memoryRevision,
          policyVersion: request.policyVersion,
          modelProfile: request.modelProfile,
        }),
        droppedItems,
        new Set(originalItems.map((item) => item.itemId)),
      );
      usageReceipt = summary.usageReceipt;
      if (summary.degraded) {
        degraded = true;
        strategy = "deterministic-fallback";
        lifecycle.push(
          lifecycleEntry("degraded", nowIso(options), {
            code: summary.degradedReason || "summarizer_degraded",
          }),
        );
      } else {
        strategy = "provider-backed";
      }
      const finalPlan = planContext(
        planRequest(request, snapshot, [...plan.selected, ...summary.items], startedAt),
      );
      contextPlanDigest = finalPlan.digest;
      outputItems = finalPlan.selected;
      const summaryIds = new Set(summary.items.map((item) => item.itemId));
      summaryDropped = finalPlan.dropped.filter((entry) => summaryIds.has(entry.itemId));
    } catch (error) {
      if (
        error?.outcomeUnknown ||
        error?.code === CONTEXT_ERROR_CODES.RECONCILIATION_REQUIRED ||
        error?.code === CONTEXT_ERROR_CODES.PROVIDER_USAGE_UNSETTLED
      ) {
        const receipt = {
          schema: COMPACTION_EVENT_SCHEMA,
          schemaVersion: 1,
          operationId,
          sessionId,
          status: "reconciliation_required",
          inputHead: snapshot.head,
          inputDigest,
          policyVersion: request.policyVersion,
          modelProfile: request.modelProfile,
          startedAt,
          lifecycle: [
            ...lifecycle,
            lifecycleEntry("reconciliation_required", nowIso(options), {
              code: error.code || "provider_outcome_unknown",
            }),
          ],
        };
        receipt.digest = canonicalDigest(receipt, "chainlesschain.compaction-receipt/v1");
        const persisted = await persistReconciliation(ports, receipt, snapshot.head);
        if (persisted && persisted.ok === false) {
          receipt.status = "stale";
          receipt.currentHead = persisted.currentHead || null;
          delete receipt.digest;
          receipt.digest = canonicalDigest(receipt, "chainlesschain.compaction-receipt/v1");
        }
        return receipt;
      }
      if (request.allowFallback !== true) {
        error.compactionLifecycle = [
          ...lifecycle,
          lifecycleEntry("aborted", nowIso(options), { code: error.code || "summarizer_failed" }),
        ];
        throw error;
      }
      degraded = true;
      strategy = "deterministic-fallback";
    }
  }

  outputItems = outputItems.map(normalizeContextItem).sort(stableItemCompare);
  lifecycle.push(lifecycleEntry("verifying", nowIso(options)));
  const verification = validateCompactionInvariants(originalItems, outputItems);
  if (!verification.ok) {
    throw kernelError(
      CONTEXT_ERROR_CODES.INVALID_ARGUMENT,
      "compaction candidate violates recovery invariants",
      verification,
    );
  }
  const outputDigest = canonicalDigest(
    outputItems.map((item) => item.digest),
    "chainlesschain.compaction-output/v1",
  );
  const committedAt = nowIso(options);
  lifecycle.push(lifecycleEntry("committing", committedAt));
  const receiptTemplate = {
    schema: COMPACTION_EVENT_SCHEMA,
    schemaVersion: 1,
    operationId,
    sessionId,
    status: degraded ? "degraded" : "committed",
    inputHead: snapshot.head,
    inputDigest,
    outputDigest,
    contextPlanDigest,
    memoryRevision: plan.memoryRevision,
    selectedItemIds: outputItems.map((item) => item.itemId),
    lifecycle: [...lifecycle, lifecycleEntry("committed", committedAt)],
  };
  const event = {
    schema: COMPACTION_EVENT_SCHEMA,
    schemaVersion: 1,
    eventId: `compaction-event-${(options.randomUUID || randomUUID)()}`,
    operationId,
    sessionId,
    inputHead: snapshot.head,
    inputDigest,
    policyVersion: request.policyVersion,
    modelProfile: request.modelProfile,
    contextPlanDigest,
    memoryRevision: plan.memoryRevision,
    strategy,
    status: degraded ? "degraded" : "committed",
    outputDigest,
    outputItems,
    retainedItemIds: outputItems.map((item) => item.itemId),
    dropped: [...plan.dropped, ...summaryDropped],
    artifactRefs: outputItems.filter((item) => item.contentRef).map((item) => item.contentRef),
    usageReceipt,
    startedAt,
    committedAt,
    receiptTemplate,
    ...(request.metadata === undefined ? {} : { metadata: cloneCanonical(request.metadata) }),
  };
  event.digest = canonicalDigest(event, "chainlesschain.compaction-event/v1");
  const cas = await ports.session.appendCompaction(event, snapshot.head);
  if (!cas?.ok) {
    const receipt = {
      schema: COMPACTION_EVENT_SCHEMA,
      schemaVersion: 1,
      operationId,
      sessionId,
      status: "stale",
      inputHead: snapshot.head,
      currentHead: cas?.currentHead || null,
      inputDigest,
      outputDigest,
      contextPlanDigest,
      memoryRevision: plan.memoryRevision,
      lifecycle: [...lifecycle, lifecycleEntry("stale", nowIso(options))],
    };
    receipt.digest = canonicalDigest(receipt, "chainlesschain.compaction-receipt/v1");
    return receipt;
  }
  const receipt = {
    ...receiptTemplate,
    newHead: cas.newHead,
    eventDigest: event.digest,
  };
  receipt.digest = canonicalDigest(receipt, "chainlesschain.compaction-receipt/v1");
  return receipt;
}

module.exports = {
  validateCompactionInvariants,
  validateDerivedSummaryItem,
  compactContextWithPorts,
};
