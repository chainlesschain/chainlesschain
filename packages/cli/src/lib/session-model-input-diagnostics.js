import { projectSourceMapping } from "./model-input-source-mapping.js";
import { isProxy } from "node:util/types";
import { markRuntimeLedgerPersistenceError } from "./runtime-usage-ledger.js";
import { readVerifiedProjection } from "../harness/jsonl-session-store.js";

export const MODEL_INPUT_DIAGNOSTIC_EVENT = "model_input_diagnostic";
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const hex = /^(?:sha256:)?[a-f0-9]{64}$/u;
const roles = new Set([
  "system",
  "developer",
  "user",
  "assistant",
  "tool",
  "unknown",
]);
const reasons = [
  "expired",
  "scope_denied",
  "sink_denied",
  "untrusted_system_policy",
  "input_budget",
  "partition_ceiling",
  "unknown",
];
function requireValue(ok) {
  if (!ok) throw new TypeError("Invalid model input diagnostic");
}
function count(value, nullable = false) {
  if (nullable && value === null) return null;
  requireValue(Number.isSafeInteger(value) && value >= 0);
  return value;
}
function digest(value) {
  requireValue(
    value === null || (typeof value === "string" && hex.test(value)),
  );
  return value;
}

// Persist and return a fresh allowlisted projection, never arbitrary callback
// fields or a raw request supplied by a custom adapter.
export function projectStoredModelInputDiagnostic(event) {
  let nodes = 0;
  const plain = (value, depth = 0) => {
    requireValue(++nodes <= 262144 && depth <= 8);
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      return;
    requireValue(typeof value === "object" && !isProxy(value));
    requireValue(
      Array.isArray(value)
        ? Object.getPrototypeOf(value) === Array.prototype
        : Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null,
    );
    for (const descriptor of Object.values(
      Object.getOwnPropertyDescriptors(value),
    )) {
      requireValue(Object.hasOwn(descriptor, "value"));
      plain(descriptor.value, depth + 1);
    }
  };
  plain(event);
  requireValue(typeof event.requestId === "string");
  requireValue(
    event.usageCallId === null || typeof event.usageCallId === "string",
  );
  requireValue(
    event?.schema === "chainlesschain.model-input-diagnostic/v1" &&
      uuid.test(event.requestId),
  );
  requireValue(
    event.usageCallId === null ||
      /^(?:mdl|cmp|sub)-[a-f0-9-]{36}$/u.test(event.usageCallId),
  );
  const base = {
    schema: event.schema,
    requestId: event.requestId,
    usageCallId: event.usageCallId,
    billingVerified: false,
    phase: event.phase,
  };
  if (event.phase === "body-prepared") {
    requireValue(
      ["adapter-body", "fetch-body", "governed-fetch-body"].includes(
        event.stage,
      ),
    );
    requireValue(typeof event.bodyCovered === "boolean");
    return {
      ...base,
      attempt: count(event.attempt, true),
      stage: event.stage,
      bodyCovered: event.bodyCovered,
      bodyDigest: digest(event.bodyDigest),
      bytes: count(event.bytes, true),
      providerAcceptanceVerified: false,
      ...(event.sourceMapping === undefined
        ? {}
        : {
            sourceMapping: projectSourceMapping(
              event.sourceMapping,
              "body-prepared",
            ),
          }),
    };
  }
  requireValue(
    event.phase === "logical-input" &&
      Array.isArray(event.messages) &&
      event.messages.length <= 4096,
  );
  const planning = event.planning,
    projection = event.projection;
  requireValue(
    typeof planning?.covered === "boolean" &&
      typeof projection?.covered === "boolean",
  );
  return {
    ...base,
    logicalDigest: digest(event.logicalDigest),
    ...(event.sourceMapping === undefined
      ? {}
      : {
          sourceMapping: projectSourceMapping(
            event.sourceMapping,
            "logical-input",
          ),
        }),
    bytes: count(event.bytes),
    messageCount: count(event.messageCount),
    toolCount: count(event.toolCount),
    messages: event.messages.map((message) => {
      requireValue(roles.has(message.role));
      return {
        role: message.role,
        digest: digest(message.digest),
        bytes: count(message.bytes),
      };
    }),
    planning: {
      covered: planning.covered,
      digest: digest(planning.digest),
      selectedCount: count(planning.selectedCount, true),
      dropped: Object.fromEntries(
        reasons
          .filter((key) => Object.hasOwn(planning.dropped || {}, key))
          .map((key) => [key, count(planning.dropped[key])]),
      ),
      ...(planning.sources === undefined ? {} : projectSources(planning)),
    },
    projection: {
      covered: projection.covered,
      manifestDigest: digest(projection.manifestDigest),
      projectionDigest: digest(projection.projectionDigest),
      rulesetDigest: digest(projection.rulesetDigest),
      ...(projection.redactionCount === undefined
        ? {}
        : { redactionCount: count(projection.redactionCount, true) }),
      ...(projection.injectionCount === undefined
        ? {}
        : { injectionCount: count(projection.injectionCount, true) }),
    },
  };
}

function projectSources(planning) {
  requireValue(typeof planning.sourceDetailsCovered === "boolean");
  requireValue(
    Array.isArray(planning.sources) && planning.sources.length <= 512,
  );
  const total = count(planning.sourceCount);
  requireValue(
    total >= planning.sources.length &&
      planning.sourcesTruncated === total > planning.sources.length,
  );
  const kinds = new Set([
    "system-policy",
    "tool-schema",
    "skill",
    "task-state",
    "message",
    "tool-evidence",
    "memory",
    "project-rule",
    "artifact-ref",
    "unknown",
  ]);
  const sources = planning.sources.map((source, index) => {
    requireValue(source.ordinal === index && kinds.has(source.kind));
    requireValue(
      source.disposition === "selected" || source.disposition === "excluded",
    );
    requireValue(
      source.disposition === "selected"
        ? source.reason === null
        : reasons.includes(source.reason),
    );
    return {
      ordinal: index,
      digest: digest(source.digest),
      kind: source.kind,
      disposition: source.disposition,
      reason: source.reason,
    };
  });
  return {
    sourceDetailsCovered: planning.sourceDetailsCovered,
    sourceCount: total,
    sourcesTruncated: planning.sourcesTruncated,
    sources,
  };
}

export function createPersistedModelInputObserver({ append, observe }) {
  return async (event) => {
    const projected = projectStoredModelInputDiagnostic(event);
    try {
      await append(MODEL_INPUT_DIAGNOSTIC_EVENT, projected);
    } catch (error) {
      throw markRuntimeLedgerPersistenceError(error);
    }
    await observe?.(projected);
  };
}

export function readSessionModelInputDiagnostics(
  sessionId,
  { limit = 50 } = {},
) {
  requireValue(Number.isSafeInteger(limit) && limit >= 1 && limit <= 200);
  return readVerifiedProjection(sessionId, () => {
    const records = [];
    let total = 0;
    return {
      accept(event) {
        if (event.type !== MODEL_INPUT_DIAGNOSTIC_EVENT) return;
        total++;
        records.push({
          eventHash: event.hash,
          diagnostic: projectStoredModelInputDiagnostic(event.data),
        });
        if (records.length > limit) records.shift();
      },
      finish() {
        return {
          schema: "chainlesschain.session-model-inputs/v1",
          sessionId,
          total,
          truncated: total > limit,
          records,
          billingVerified: false,
        };
      },
    };
  });
}
