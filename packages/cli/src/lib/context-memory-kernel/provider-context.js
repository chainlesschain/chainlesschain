import {
  canonicalDigest,
  canonicalJson,
  isProtected,
  normalizeContextItem,
} from "@chainlesschain/context-memory-kernel";
import { resolveModelCapabilityProfile } from "../model-capabilities.js";
import { createCliContextMemoryRuntime } from "./runtime.js";
import {
  contextItemsToMessages,
  memoryRecordsToContextItems,
  messagesToContextItems,
} from "./message-adapter.js";

function defaultAdmissions(sessionId, options) {
  const candidates = [
    { scope: "session", scopeId: sessionId },
    { scope: "agent", scopeId: options.agentId || sessionId },
    { scope: "user", scopeId: options.userId || "local-user" },
  ];
  const configured = options.contextMemoryScopeAdmissions;
  const admissions =
    Array.isArray(configured) && configured.length > 0
      ? configured
      : candidates;
  const seen = new Set();
  return admissions.filter((entry) => {
    const key = `${entry.scope}\0${entry.scopeId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toolDefinitionsToContextItems(definitionsInput, { sessionId, sink }) {
  const definitions = Array.isArray(definitionsInput) ? definitionsInput : [];
  return definitions.map((definition, index) => {
    const content = canonicalJson(definition);
    const name = String(
      definition?.function?.name || definition?.name || `tool-${index}`,
    );
    const sourceDigest = canonicalDigest(
      definition,
      "chainlesschain.cli-tool-schema/v1",
    );
    return normalizeContextItem({
      schemaVersion: 1,
      itemId: `cli-tool-${sourceDigest.slice(7, 39)}`,
      kind: "tool-schema",
      scope: "session",
      scopeId: sessionId,
      sourceRef: {
        store: "cli-tool-registry",
        id: name,
        digest: sourceDigest,
      },
      provenance: {
        source: "cli-tool-registry",
        observedAt: "1970-01-01T00:00:00.000Z",
      },
      trust: "host",
      sensitivity: "internal",
      allowedSinks: [sink],
      tokenEstimate: Math.max(
        1,
        Math.ceil(Buffer.byteLength(content, "utf8") / 4),
      ),
      priority: Math.max(500_000, 600_000 - index),
      pinned: false,
      createdAt: "1970-01-01T00:00:00.000Z",
      content,
    });
  });
}

/**
 * Bind every paid provider request to one canonical plan and memory revision.
 * The returned messages are ephemeral; the authoritative transcript remains
 * the JSONL/session port and recalled memories remain independently deletable.
 */
export async function prepareCanonicalProviderContext(
  messagesInput,
  options = {},
) {
  const messages = Array.isArray(messagesInput) ? messagesInput : [];
  const sessionId = String(options.sessionId || "ephemeral-cli-session");
  const planningRequested = options.contextMemorySkipPlanning !== true;
  const provider = String(options.provider || "local");
  const modelCapabilities = planningRequested
    ? resolveModelCapabilityProfile({
        provider,
        model: options.model,
        baseUrl: options.baseUrl,
        contextMemoryModelWindowTokens: options.contextMemoryModelWindowTokens,
        maxOutputTokens: options.maxOutputTokens,
      })
    : null;

  // A request cap at or above the complete model window leaves no valid input
  // allocation. Reject it before creating the memory runtime so an impossible
  // request cannot write state or reach the provider.
  if (
    modelCapabilities !== null &&
    modelCapabilities.requestMaxOutputTokens !== null &&
    modelCapabilities.requestMaxOutputTokens >=
      modelCapabilities.contextWindowTokens
  ) {
    const error = new RangeError(
      "The configured output-token cap must be smaller than the model context window",
    );
    error.code = "CC_MODEL_OUTPUT_BUDGET_EXCEEDS_WINDOW";
    throw error;
  }

  const runtime = createCliContextMemoryRuntime({
    env: options.contextMemoryEnv || process.env,
    sessionId,
    scopeKey: `cli:provider:${sessionId}`,
    ...(options.contextMemoryFilePath
      ? { memoryFilePath: options.contextMemoryFilePath }
      : {}),
  });
  if (!runtime.decision.canonical || !planningRequested) {
    return {
      messages,
      plan: null,
      recall: null,
      decision: runtime.decision,
      modelCapabilities: null,
    };
  }

  const sink = String(options.contextMemorySink || `provider.${provider}`);
  const scopeAdmissions = defaultAdmissions(sessionId, options);
  const lastUser = [...messages]
    .reverse()
    .find((message) => message?.role === "user");
  const query =
    typeof lastUser?.content === "string" && lastUser.content.trim()
      ? lastUser.content.trim().slice(0, 32 * 1024)
      : "*";
  const recall = await runtime.kernel.recallMemory({
    query,
    sink,
    scopeAdmissions,
    limit: Math.max(
      1,
      Math.min(32, Number(options.contextMemoryRecallLimit) || 12),
    ),
    tokenBudget: Math.max(
      1,
      Math.min(32_768, Number(options.contextMemoryRecallTokens) || 4096),
    ),
  });
  const messageItems = messagesToContextItems(messages, {
    sessionId,
    allowedSinks: [sink],
    trustCurrentSystemPolicy: true,
    trustedSystemIndexes: options.contextMemoryTrustedSystemIndexes,
  });
  const memoryItems = memoryRecordsToContextItems(
    recall.results.map((entry) => entry.record),
    { insertionSequence: Math.max(0, messages.length - 1) },
  );
  const toolItems = toolDefinitionsToContextItems(
    options.contextMemoryToolDefinitions,
    { sessionId, sink },
  );
  const items = [...messageItems, ...memoryItems, ...toolItems];
  const modelWindowTokens = modelCapabilities.contextWindowTokens;
  const reservedOutputTokens = Math.min(
    modelWindowTokens - 1,
    Math.max(256, modelCapabilities.plannedOutputReserveTokens),
  );
  const safetyMarginTokens = Math.min(
    modelWindowTokens - reservedOutputTokens - 1,
    Math.max(64, Math.floor(modelWindowTokens * 0.05)),
  );
  const inputBudget =
    modelWindowTokens - reservedOutputTokens - safetyMarginTokens;
  const desiredRecoveryReserveTokens = Math.min(
    Math.max(32, Math.floor(inputBudget * 0.05)),
    Math.max(0, inputBudget - 1),
  );
  // The recovery reserve is a soft allocation. It must yield to protected
  // current-turn state, which is already part of this provider request.
  const protectedTokens = items.reduce(
    (total, item) => total + (isProtected(item) ? item.tokenEstimate : 0),
    0,
  );
  const recoveryReserveTokens = Math.min(
    desiredRecoveryReserveTokens,
    Math.max(0, inputBudget - protectedTokens),
  );
  const sessionHead =
    options.contextMemorySessionHead ||
    canonicalDigest(
      messageItems.map((item) => item.digest),
      "chainlesschain.cli-provider-context-head/v1",
    );
  const plan = await runtime.kernel.planContext({
    modelWindowTokens,
    reservedOutputTokens,
    safetyMarginTokens,
    recoveryReserveTokens,
    items,
    sink,
    scopeAdmissions,
    partitionCeilings: {
      "trusted-system": inputBudget,
      "working-state": inputBudget,
      "tools-and-skills": inputBudget,
      conversation: inputBudget,
      "tool-evidence": inputBudget,
      "memory-and-rules": Math.max(1, Math.floor(inputBudget * 0.12)),
    },
    policyVersion: String(
      options.contextMemoryPolicyVersion || "cli-provider-v1",
    ),
    modelProfile:
      `${modelCapabilities.profileId}:${modelCapabilities.digest}`.slice(
        0,
        256,
      ),
    sessionHead,
    memoryRevision: recall.memoryRevision,
  });
  return {
    messages: contextItemsToMessages(
      plan.selected.filter((item) => item.kind !== "tool-schema"),
    ),
    selectedToolNames: toolItems
      .filter((item) => plan.selectedItemIds.includes(item.itemId))
      .map((item) => item.sourceRef.id),
    plan,
    recall,
    decision: runtime.decision,
    modelCapabilities,
  };
}

export { defaultAdmissions, toolDefinitionsToContextItems };
