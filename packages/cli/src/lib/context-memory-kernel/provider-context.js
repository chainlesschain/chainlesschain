import { isDeepStrictEqual } from "node:util";
import {
  canonicalDigest,
  canonicalJson,
  isProtected,
  normalizeContextItem,
} from "@chainlesschain/context-memory-kernel";
import { resolveModelCapabilityProfile } from "../model-capabilities.js";
import { raceWithAbort } from "../abort-utils.js";
import { createCliContextMemoryRuntime } from "./runtime.js";
import {
  contextItemsToMessages,
  memoryRecordsToContextItems,
  messagesToContextItems,
} from "./message-adapter.js";
import {
  adjustContextImageTokenEstimates,
  captureContextImageTransport,
  restoreContextImageTransport,
} from "./context-image-transport.js";

export const SEMANTIC_CANDIDATE_REQUEST_SCHEMA =
  "chainlesschain.context-memory-semantic-candidate-request/v1";

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

function semanticCandidateProvider(options) {
  const provider = options.contextMemorySemanticCandidateProvider;
  if (provider == null) return null;
  if (typeof provider !== "function") {
    throw new TypeError(
      "contextMemorySemanticCandidateProvider must be a function",
    );
  }
  return provider;
}

/**
 * Ask a host-owned semantic index for opaque record identifiers. The host sees
 * the query and admission boundary but never receives canonical record content;
 * the kernel later validates every returned revision/digest and applies its
 * lifecycle, scope, expiry, and sink filters before ranking.
 */
async function resolveSemanticCandidates({
  provider,
  sessionId,
  query,
  sink,
  scopeAdmissions,
  limit,
  signal,
}) {
  if (!provider) return undefined;
  signal?.throwIfAborted();
  const request = Object.freeze({
    schema: SEMANTIC_CANDIDATE_REQUEST_SCHEMA,
    sessionId,
    query,
    sink,
    scopeAdmissions: Object.freeze(
      scopeAdmissions.map((entry) => Object.freeze({ ...entry })),
    ),
    limit,
    maxCandidates: 1000,
  });
  // Attach cancellation observers before invoking host code. A source may
  // ignore Stop, or abort synchronously and then reject; neither can revive
  // this request or produce an unhandled late rejection. The live signal is
  // a host control, never part of the serialized semantic request contract.
  const candidates = await raceWithAbort(
    Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return provider(request, Object.freeze({ signal }));
    }),
    signal,
    "Semantic Memory recall interrupted",
  );
  if (!Array.isArray(candidates)) {
    throw new TypeError(
      "contextMemorySemanticCandidateProvider must resolve to an array",
    );
  }
  return candidates.map((candidate) =>
    candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? Object.freeze({ ...candidate })
      : candidate,
  );
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
  options.signal?.throwIfAborted();
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

  // Resolve against the final provider projection, never a pre-projection index.
  // Exact role/content/metadata matching prevents a transformed tool result or
  // an ambiguous duplicate from taking the original user's task-state binding.
  const taskBinding = options.contextMemoryRequiredUserBinding;
  const requiredUserMessage = taskBinding?.message;
  function resolveRequiredUserIndex() {
    if (requiredUserMessage == null) return null;
    const identities = messages.flatMap((message, index) =>
      message === taskBinding.original ? [index] : [],
    );
    const candidates = identities.length
      ? identities
      : taskBinding.allowContentRelocation === true
        ? messages.map((_, index) => index)
        : [];
    const matches = candidates.filter((index) => {
      const message = messages[index];
      return (
        message?.role === "user" &&
        requiredUserMessage.role === "user" &&
        isDeepStrictEqual(message, requiredUserMessage)
      );
    });
    if (matches.length !== 1 || identities.length > 1) {
      const error = new Error(
        "The current user task was lost, changed or duplicated in provider context",
      );
      error.code = "CC_AGENT_TASK_CONTEXT_LOST";
      throw error;
    }
    return matches[0];
  }
  let requiredUserIndex = resolveRequiredUserIndex();

  // Review can exclude recalled author/session data while retaining the exact
  // canonical context, tool and output-token planning boundary.
  const recallEnabled = options.contextMemoryRecall !== false;
  const candidateProvider = recallEnabled
    ? semanticCandidateProvider(options)
    : null;
  const sink = String(options.contextMemorySink || `provider.${provider}`);
  const scopeAdmissions = defaultAdmissions(sessionId, options);
  const lastUser =
    requiredUserMessage ||
    [...messages].reverse().find((message) => message?.role === "user");
  const query =
    typeof lastUser?.content === "string" && lastUser.content.trim()
      ? lastUser.content.trim().slice(0, 32 * 1024)
      : "*";
  const recallLimit = Math.max(
    1,
    Math.min(32, Number(options.contextMemoryRecallLimit) || 12),
  );
  const semanticCandidates = await resolveSemanticCandidates({
    provider: candidateProvider,
    sessionId,
    query,
    sink,
    scopeAdmissions,
    limit: recallLimit,
    signal: options.signal,
  });
  options.signal?.throwIfAborted();
  const recall = recallEnabled
    ? await runtime.kernel.recallMemory(
        {
          query,
          sink,
          scopeAdmissions,
          limit: recallLimit,
          tokenBudget: Math.max(
            1,
            Math.min(32_768, Number(options.contextMemoryRecallTokens) || 4096),
          ),
          ...(semanticCandidates === undefined ? {} : { semanticCandidates }),
        },
        { signal: options.signal },
      )
    : {
        results: [],
        memoryRevision: await runtime.memoryPort.getRevision({
          signal: options.signal,
        }),
      };
  options.signal?.throwIfAborted();
  // Recall awaits host and storage work. Revalidate the captured task and its
  // current position before image transformation and immutable item creation.
  requiredUserIndex = resolveRequiredUserIndex();
  const imageTransport = captureContextImageTransport(messages);
  const messageItems = adjustContextImageTokenEstimates(
    messagesToContextItems(imageTransport.messages, {
      sessionId,
      allowedSinks: [sink],
      trustCurrentSystemPolicy: true,
      trustedSystemIndexes: options.contextMemoryTrustedSystemIndexes,
      requiredUserMessage:
        requiredUserIndex === null
          ? null
          : {
              index: requiredUserIndex,
              message: imageTransport.messages[requiredUserIndex],
            },
      allowExternalization: false,
    }),
    imageTransport.captures,
  );
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
    Math.max(
      64,
      Math.floor(modelWindowTokens * 0.05),
      // Some models cap input independently of the shared context window.
      // Reserve that unavailable headroom before selecting any context items.
      modelWindowTokens -
        reservedOutputTokens -
        (modelCapabilities.advertisedMaxInputTokens ?? modelWindowTokens),
    ),
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
  options.signal?.throwIfAborted();
  const selectedMessages = contextItemsToMessages(
    plan.selected.filter((item) => item.kind !== "tool-schema"),
    { sessionId },
  );
  return {
    messages: restoreContextImageTransport(
      selectedMessages,
      imageTransport.captures,
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
