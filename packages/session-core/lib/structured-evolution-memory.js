"use strict";

const crypto = require("node:crypto");

const STRUCTURED_MEMORY_EVENT_SCHEMA =
  "chainlesschain.structured-memory-event/v1";
const STRUCTURED_MEMORY_PROJECTION_SCHEMA =
  "chainlesschain.structured-memory-projection/v1";
const STRUCTURED_MEMORY_SNAPSHOT_SCHEMA =
  "chainlesschain.structured-memory-snapshot/v1";
const STRUCTURED_MEMORY_RECEIPT_SCHEMA =
  "chainlesschain.structured-memory-authority-receipt/v1";
const STRUCTURED_MEMORY_RECEIPT_RESOLUTION_SCHEMA =
  "chainlesschain.structured-memory-receipt-resolution/v1";
const STRUCTURED_MEMORY_POST_COMPACT_VERIFICATION_SCHEMA =
  "chainlesschain.structured-memory-post-compact-verification/v1";

const MEMORY_LAYER = Object.freeze({
  EPISODIC: "episodic",
  SEMANTIC: "semantic",
  PROCEDURAL: "procedural",
  POLICY: "policy",
});
const MEMORY_ACTION = Object.freeze({
  APPEND: "append",
  PROPOSE: "propose",
  ACCEPT: "accept",
  QUARANTINE: "quarantine",
  TOMBSTONE: "tombstone",
});
const LAYERS = new Set(Object.values(MEMORY_LAYER));
const ACTIONS = new Set(Object.values(MEMORY_ACTION));
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const FORBIDDEN_KEYS = new Set([
  "content",
  "payload",
  "prompt",
  "output",
  "secret",
]);
const COMPACTION_FIELDS = [
  "requirements",
  "decisions",
  "openRisks",
  "failedAttempts",
  "tests",
  "goalState",
  "delegatedTasks",
  "memoryLineage",
];
const MEMORY_AUTHORITIES = new WeakSet();
const MEMORY_RECEIPT_PROVIDERS = new WeakSet();
const MEMORY_POST_COMPACT_VERIFIERS = new WeakSet();
const RECEIPT_KINDS = Object.freeze([
  "critic",
  "evaluator",
  "promotion",
  "revocation",
  "policy",
]);
const STRUCTURED_MEMORY_RECEIPT_DIGEST_DOMAIN =
  "chainlesschain.structured-memory-authority-receipt/v1";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} is required`);
  return value;
}

function digest(value, name, nullable = false) {
  if (nullable && value == null) return null;
  if (!DIGEST.test(value || ""))
    throw new TypeError(`${name} must be sha256-bound`);
  return value;
}

function strings(value, name, { allowEmpty = true } = {}) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > 256 ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new TypeError(`${name} must be a bounded string list`);
  }
  return [...new Set(value)].sort();
}

function assertMetadataOnly(value, path = "metadata") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase()))
      throw new Error(`${path}.${key} contains forbidden raw material`);
    assertMetadataOnly(child, `${path}.${key}`);
  }
}

function normalizeActor(input) {
  const actor = {
    actorId: requiredString(input?.actorId, "actor.actorId"),
    actorType: requiredString(input?.actorType, "actor.actorType"),
    role: requiredString(input?.role, "actor.role"),
  };
  if (!["agent", "human", "service"].includes(actor.actorType))
    throw new TypeError("actor.actorType is invalid");
  return actor;
}

function createStructuredMemoryAuthority(input) {
  const authority = freeze({
    tenantId: requiredString(input?.tenantId, "authority.tenantId"),
    actor: normalizeActor(input),
    authorityDigest: digest(
      input?.authorityDigest,
      "authority.authorityDigest",
    ),
  });
  MEMORY_AUTHORITIES.add(authority);
  return authority;
}

function consumeAuthority(value, tenantId) {
  if (!MEMORY_AUTHORITIES.has(value) || value.tenantId !== tenantId) {
    throw new Error("a branded tenant-scoped memory authority is required");
  }
  return value.actor;
}

function captureStructuredMemoryAuthority(
  value,
  { tenantId, role, actorType } = {},
) {
  const actor = consumeAuthority(value, requiredString(tenantId, "tenantId"));
  if (
    (role !== undefined && actor.role !== role) ||
    (actorType !== undefined && actor.actorType !== actorType)
  ) {
    throw new Error("structured memory authority has the wrong actor scope");
  }
  return value;
}

function capture(owner, name) {
  if (typeof owner?.[name] !== "function")
    throw new TypeError(`${name} port is required`);
  return (...args) => Reflect.apply(owner[name], owner, args);
}

function normalizeReceiptProviderDescriptor(input) {
  if (
    !Number.isSafeInteger(input?.authorityRevision) ||
    input.authorityRevision <= 0
  ) {
    throw new TypeError("receipt authorityRevision must be a positive integer");
  }
  return freeze({
    tenantId: requiredString(input.tenantId, "receiptProvider.tenantId"),
    authorityId: requiredString(
      input.authorityId,
      "receiptProvider.authorityId",
    ),
    authorityRevision: input.authorityRevision,
    handlerDigest: digest(input.handlerDigest, "receiptProvider.handlerDigest"),
  });
}

function normalizeStructuredMemoryAuthorityReceipt(
  input,
  { requireDigest = true } = {},
) {
  if (!RECEIPT_KINDS.includes(input?.kind))
    throw new TypeError("structured memory receipt kind is invalid");
  if (
    !Number.isSafeInteger(input?.issuerRevision) ||
    input.issuerRevision <= 0
  ) {
    throw new TypeError(
      "structured memory receipt issuerRevision must be a positive integer",
    );
  }
  const receipt = {
    schema: STRUCTURED_MEMORY_RECEIPT_SCHEMA,
    tenantId: requiredString(input.tenantId, "receipt.tenantId"),
    kind: input.kind,
    decision: input.decision,
    memoryId: requiredString(input.memoryId, "receipt.memoryId"),
    layer: input.layer,
    action: input.action,
    contentDigest: digest(input.contentDigest, "receipt.contentDigest"),
    artifactRef: requiredString(input.artifactRef, "receipt.artifactRef"),
    evidenceRefs: strings(input.evidenceRefs || [], "receipt.evidenceRefs"),
    issuerId: requiredString(input.issuerId, "receipt.issuerId"),
    issuerRevision: input.issuerRevision,
    issuerHandlerDigest: digest(
      input.issuerHandlerDigest,
      "receipt.issuerHandlerDigest",
    ),
    issuedAt: requiredString(input.issuedAt, "receipt.issuedAt"),
  };
  if (
    receipt.decision !== "accepted" ||
    !LAYERS.has(receipt.layer) ||
    !ACTIONS.has(receipt.action) ||
    !Number.isFinite(Date.parse(receipt.issuedAt))
  )
    throw new TypeError(
      "structured memory receipt decision or transition is invalid",
    );
  const receiptDigest = hash({
    domain: STRUCTURED_MEMORY_RECEIPT_DIGEST_DOMAIN,
    receipt,
  });
  if (requireDigest && input.receiptDigest !== receiptDigest) {
    throw new Error(
      "structured memory receipt digest does not bind its canonical content",
    );
  }
  return freeze({ ...receipt, receiptDigest });
}

function createStructuredMemoryAuthorityReceipt(input) {
  return normalizeStructuredMemoryAuthorityReceipt(input, {
    requireDigest: false,
  });
}

function requiredReceiptKinds(event) {
  if (
    event.layer === MEMORY_LAYER.SEMANTIC &&
    event.action === MEMORY_ACTION.ACCEPT
  )
    return ["critic", "evaluator"];
  if (
    event.layer === MEMORY_LAYER.PROCEDURAL &&
    event.action === MEMORY_ACTION.ACCEPT
  )
    return ["promotion"];
  if (
    event.layer === MEMORY_LAYER.PROCEDURAL &&
    event.action === MEMORY_ACTION.QUARANTINE
  )
    return ["revocation"];
  if (
    event.layer === MEMORY_LAYER.POLICY &&
    event.action === MEMORY_ACTION.ACCEPT
  )
    return ["policy"];
  return [];
}

function normalizeReceiptRefs(input = {}, requiredKinds = []) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("receiptRefs must be an object");
  const keys = Object.keys(input);
  const supplied = keys.filter((key) => input[key] != null);
  if (
    keys.some((key) => !RECEIPT_KINDS.includes(key)) ||
    canonical(supplied.sort()) !== canonical([...requiredKinds].sort())
  ) {
    throw new Error(
      "runtime receipt refs must exactly match the authorized transition",
    );
  }
  return Object.fromEntries(
    requiredKinds.map((kind) => [
      kind,
      digest(input[kind], `receiptRefs.${kind}`),
    ]),
  );
}

async function validateResolvedReceipt(
  resolution,
  descriptor,
  request,
  verify,
) {
  if (
    resolution?.schema !== STRUCTURED_MEMORY_RECEIPT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.tenantId !== descriptor.tenantId ||
    resolution.authorityId !== descriptor.authorityId ||
    resolution.authorityRevision !== descriptor.authorityRevision ||
    resolution.handlerDigest !== descriptor.handlerDigest ||
    resolution.kind !== request.kind ||
    resolution.receiptDigest !== request.receiptDigest ||
    !DIGEST.test(resolution.resolutionReceiptDigest || "")
  ) {
    throw new Error(
      "structured memory receipt resolution authority is invalid",
    );
  }
  const receipt = normalizeStructuredMemoryAuthorityReceipt(resolution.receipt);
  if (
    receipt.tenantId !== descriptor.tenantId ||
    receipt.kind !== request.kind ||
    receipt.receiptDigest !== request.receiptDigest ||
    receipt.decision !== "accepted" ||
    receipt.memoryId !== request.memoryId ||
    receipt.layer !== request.layer ||
    receipt.action !== request.action ||
    receipt.contentDigest !== request.contentDigest ||
    receipt.artifactRef !== request.artifactRef ||
    canonical(strings(receipt.evidenceRefs || [], "receipt.evidenceRefs")) !==
      canonical(request.evidenceRefs) ||
    !Number.isFinite(Date.parse(receipt.issuedAt || ""))
  ) {
    throw new Error(
      "structured memory receipt is not bound to the requested transition",
    );
  }
  if (
    (await verify(
      freeze({
        descriptor,
        request: freeze(clone(request)),
        resolution: freeze(clone(resolution)),
      }),
    )) !== true
  ) {
    throw new Error("structured memory receipt authentication failed");
  }
  return receipt.receiptDigest;
}

function createStructuredMemoryReceiptProvider({
  descriptor: input,
  resolver,
  verifier,
} = {}) {
  const descriptor = normalizeReceiptProviderDescriptor(input);
  const resolve = capture(resolver, "resolve");
  const verify = capture(verifier, "verify");
  const provider = freeze({
    identity: descriptor,
    async resolveForEvent(event, refs = {}) {
      if (event?.tenantId !== descriptor.tenantId)
        throw new Error(
          "cross-tenant structured memory receipt request rejected",
        );
      const requiredKinds = requiredReceiptKinds(event);
      const normalizedRefs = normalizeReceiptRefs(refs, requiredKinds);
      const receipts = {
        critic: null,
        evaluator: null,
        promotion: null,
        revocation: null,
        policy: null,
      };
      for (const kind of requiredKinds) {
        const request = freeze({
          tenantId: descriptor.tenantId,
          kind,
          receiptDigest: normalizedRefs[kind],
          memoryId: event.memoryId,
          layer: event.layer,
          action: event.action,
          contentDigest: event.contentDigest,
          artifactRef: event.artifactRef,
          evidenceRefs: strings(event.evidenceRefs || [], "evidenceRefs"),
        });
        const resolution = await resolve(request);
        receipts[kind] = await validateResolvedReceipt(
          resolution,
          descriptor,
          request,
          verify,
        );
      }
      return freeze(receipts);
    },
  });
  MEMORY_RECEIPT_PROVIDERS.add(provider);
  return provider;
}

function consumeReceiptProvider(value, tenantId) {
  if (
    !isStructuredMemoryReceiptProvider(value) ||
    value.identity.tenantId !== tenantId
  ) {
    throw new Error(
      "a branded tenant-scoped memory receipt provider is required",
    );
  }
  return value;
}

function isStructuredMemoryReceiptProvider(value) {
  return MEMORY_RECEIPT_PROVIDERS.has(value);
}

function normalizePostCompactDescriptor(input) {
  if (
    !Number.isSafeInteger(input?.authorityRevision) ||
    input.authorityRevision <= 0
  ) {
    throw new TypeError(
      "PostCompact authorityRevision must be a positive integer",
    );
  }
  return freeze({
    tenantId: requiredString(input.tenantId, "postCompact.tenantId"),
    authorityId: requiredString(input.authorityId, "postCompact.authorityId"),
    authorityRevision: input.authorityRevision,
    handlerDigest: digest(input.handlerDigest, "postCompact.handlerDigest"),
  });
}

function createStructuredMemoryPostCompactVerifier({
  descriptor: input,
  hook,
  verifier,
} = {}) {
  const descriptor = normalizePostCompactDescriptor(input);
  const run = capture(hook, "run");
  const verify = capture(verifier, "verify");
  const postCompact = async (context) => {
    if (
      context?.candidate?.tenantId !== descriptor.tenantId ||
      context.projection?.tenantId !== descriptor.tenantId ||
      context.snapshotDigest !== hash(context.candidate)
    ) {
      throw new Error(
        "PostCompact request is not bound to the tenant snapshot",
      );
    }
    const request = freeze({
      tenantId: descriptor.tenantId,
      snapshotDigest: context.snapshotDigest,
      projectionDigest: context.projection.projectionDigest,
      previousSnapshotDigest: context.previous?.snapshotDigest ?? null,
      candidate: freeze(clone(context.candidate)),
      projection: context.projection,
    });
    const result = await run(request);
    if (
      result?.schema !== STRUCTURED_MEMORY_POST_COMPACT_VERIFICATION_SCHEMA ||
      result.authenticated !== true ||
      result.tenantId !== descriptor.tenantId ||
      result.authorityId !== descriptor.authorityId ||
      result.authorityRevision !== descriptor.authorityRevision ||
      result.handlerDigest !== descriptor.handlerDigest ||
      result.snapshotDigest !== request.snapshotDigest ||
      result.projectionDigest !== request.projectionDigest ||
      result.previousSnapshotDigest !== request.previousSnapshotDigest ||
      !["accepted", "rejected"].includes(result.decision) ||
      !Number.isFinite(Date.parse(result.checkedAt || "")) ||
      !DIGEST.test(result.receiptDigest || "")
    ) {
      throw new Error(
        "PostCompact verification result is unauthenticated or substituted",
      );
    }
    if (
      (await verify(
        freeze({ descriptor, request, result: freeze(clone(result)) }),
      )) !== true
    ) {
      throw new Error("PostCompact verification attestation failed");
    }
    return result.decision === "accepted";
  };
  Object.defineProperty(postCompact, "identity", {
    value: descriptor,
    enumerable: true,
  });
  freeze(postCompact);
  MEMORY_POST_COMPACT_VERIFIERS.add(postCompact);
  return postCompact;
}

function consumePostCompactVerifier(value, tenantId) {
  if (
    !isStructuredMemoryPostCompactVerifier(value) ||
    value.identity.tenantId !== tenantId
  ) {
    throw new Error("a branded tenant-scoped PostCompact verifier is required");
  }
  return value;
}

function isStructuredMemoryPostCompactVerifier(value) {
  return MEMORY_POST_COMPACT_VERIFIERS.has(value);
}

function normalizeReceipts(input = {}) {
  return {
    critic: digest(input.critic, "receipts.critic", true),
    evaluator: digest(input.evaluator, "receipts.evaluator", true),
    promotion: digest(input.promotion, "receipts.promotion", true),
    revocation: digest(input.revocation, "receipts.revocation", true),
    policy: digest(input.policy, "receipts.policy", true),
  };
}

function normalizeEvent(input) {
  if (input?.schema !== STRUCTURED_MEMORY_EVENT_SCHEMA)
    throw new TypeError("structured memory event schema is invalid");
  if (!LAYERS.has(input.layer) || !ACTIONS.has(input.action))
    throw new TypeError("memory layer or action is invalid");
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0)
    throw new TypeError("event sequence is invalid");
  if (typeof input.automatic !== "boolean")
    throw new TypeError("automatic must be explicit");
  const event = {
    schema: STRUCTURED_MEMORY_EVENT_SCHEMA,
    tenantId: requiredString(input.tenantId, "tenantId"),
    eventId: requiredString(input.eventId, "eventId"),
    sequence: input.sequence,
    memoryId: requiredString(input.memoryId, "memoryId"),
    layer: input.layer,
    action: input.action,
    actor: normalizeActor(input.actor),
    automatic: input.automatic,
    contentDigest: digest(input.contentDigest, "contentDigest"),
    artifactRef: requiredString(input.artifactRef, "artifactRef"),
    evidenceRefs: strings(input.evidenceRefs || [], "evidenceRefs"),
    supersedes: strings(input.supersedes || [], "supersedes"),
    receipts: normalizeReceipts(input.receipts),
    timestamp: requiredString(input.timestamp, "timestamp"),
    metadata: clone(input.metadata || {}),
  };
  if (!Number.isFinite(Date.parse(event.timestamp)))
    throw new TypeError("timestamp must be an ISO timestamp");
  assertMetadataOnly(event.metadata);
  return freeze(event);
}

function authorize(event, current) {
  const { layer, action, actor, automatic, receipts } = event;
  if (current && current.layer !== layer)
    throw new Error("memoryId cannot cross memory layers");
  if (
    action === MEMORY_ACTION.TOMBSTONE &&
    current &&
    event.contentDigest !== current.contentDigest
  ) {
    throw new Error("memory tombstone must bind the current content digest");
  }
  if (layer === MEMORY_LAYER.EPISODIC) {
    if (![MEMORY_ACTION.APPEND, MEMORY_ACTION.TOMBSTONE].includes(action))
      throw new Error("episodic memory is append-only");
    if (action === MEMORY_ACTION.APPEND && current)
      throw new Error(
        "episodic memory cannot silently overwrite an existing record",
      );
    if (action === MEMORY_ACTION.TOMBSTONE && actor.role !== "governor")
      throw new Error("episodic deletion requires governor authority");
    return;
  }
  if (layer === MEMORY_LAYER.SEMANTIC) {
    if (action === MEMORY_ACTION.PROPOSE) {
      if (
        !["proposer", "child-agent"].includes(actor.role) ||
        event.evidenceRefs.length === 0
      ) {
        throw new Error(
          "semantic proposals require scoped evidence and proposer authority",
        );
      }
      if (current)
        throw new Error(
          "semantic proposal cannot replace an existing memoryId",
        );
      return;
    }
    if (action === MEMORY_ACTION.ACCEPT) {
      if (
        !current ||
        current.status !== "proposed" ||
        actor.role !== "governor" ||
        receipts.critic == null ||
        receipts.evaluator == null ||
        event.contentDigest !== current.contentDigest ||
        event.artifactRef !== current.artifactRef ||
        canonical(event.evidenceRefs) !== canonical(current.evidenceRefs)
      ) {
        throw new Error(
          "semantic acceptance requires proposed state, critic, evaluator, and governor",
        );
      }
      return;
    }
    if (action === MEMORY_ACTION.TOMBSTONE && actor.role === "governor") return;
    throw new Error("semantic memory transition is unauthorized");
  }
  if (layer === MEMORY_LAYER.PROCEDURAL) {
    if (
      action === MEMORY_ACTION.ACCEPT &&
      actor.role === "promotion-controller" &&
      receipts.promotion != null
    )
      return;
    if (
      action === MEMORY_ACTION.QUARANTINE &&
      current?.status === "active" &&
      actor.role === "promotion-controller" &&
      receipts.revocation != null
    )
      return;
    throw new Error(
      "procedural memory can only change through the promotion controller",
    );
  }
  if (action === MEMORY_ACTION.ACCEPT) {
    if (
      automatic ||
      actor.actorType !== "human" ||
      actor.role !== "governor" ||
      receipts.policy == null
    ) {
      throw new Error(
        "policy memory requires explicit human governor authority",
      );
    }
    return;
  }
  if (
    action === MEMORY_ACTION.TOMBSTONE &&
    !automatic &&
    actor.actorType === "human" &&
    actor.role === "governor"
  )
    return;
  throw new Error("automatic experience cannot modify policy memory");
}

function initialProjection(tenantId) {
  return {
    schema: STRUCTURED_MEMORY_PROJECTION_SCHEMA,
    tenantId,
    sequence: 0,
    eventRoot: hash({ tenantId, genesis: true }),
    memories: {},
    queue: [],
    quarantines: {},
    tombstones: {},
    seenEvents: {},
  };
}

function applyEvent(state, event) {
  const current = state.memories[event.memoryId];
  authorize(event, current);
  if (event.action === MEMORY_ACTION.TOMBSTONE) {
    state.tombstones[event.memoryId] = {
      eventId: event.eventId,
      contentDigest: event.contentDigest,
      timestamp: event.timestamp,
      layer: event.layer,
    };
    delete state.memories[event.memoryId];
    state.queue = state.queue.filter((id) => id !== event.memoryId);
  } else if (event.action === MEMORY_ACTION.QUARANTINE) {
    state.quarantines[event.memoryId] = {
      eventId: event.eventId,
      contentDigest: event.contentDigest,
      artifactRef: event.artifactRef,
      timestamp: event.timestamp,
      layer: event.layer,
      evidenceRefs: event.evidenceRefs,
      receipts: event.receipts,
      metadata: event.metadata,
    };
    delete state.memories[event.memoryId];
    state.queue = state.queue.filter((id) => id !== event.memoryId);
  } else {
    const status =
      event.action === MEMORY_ACTION.PROPOSE ? "proposed" : "active";
    state.memories[event.memoryId] = {
      memoryId: event.memoryId,
      layer: event.layer,
      status,
      contentDigest: event.contentDigest,
      artifactRef: event.artifactRef,
      evidenceRefs: event.evidenceRefs,
      supersedes: event.supersedes,
      receipts: event.receipts,
      actor: event.actor,
      automatic: event.automatic,
      updatedAt: event.timestamp,
    };
    if (status === "proposed" && !state.queue.includes(event.memoryId))
      state.queue.push(event.memoryId);
    if (status === "active")
      state.queue = state.queue.filter((id) => id !== event.memoryId);
  }
  const eventDigest = hash(event);
  state.eventRoot = hash({ previous: state.eventRoot, eventDigest });
  state.seenEvents[event.eventId] = eventDigest;
  state.sequence = event.sequence;
}

function projectStructuredMemory(inputs, options = {}) {
  if (!Array.isArray(inputs)) throw new TypeError("events must be an array");
  const normalized = inputs.map(normalizeEvent);
  const tenantId = options.tenantId || normalized[0]?.tenantId;
  requiredString(tenantId, "tenantId");
  const unique = new Map();
  for (const event of normalized) {
    if (event.tenantId !== tenantId)
      throw new Error("cross-tenant memory event rejected");
    const prior = unique.get(event.eventId);
    if (prior && canonical(prior) !== canonical(event))
      throw new Error("conflicting memory eventId rejected");
    unique.set(event.eventId, event);
  }
  const events = [...unique.values()].sort(
    (a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId),
  );
  if (
    options.state &&
    (options.state.schema !== STRUCTURED_MEMORY_PROJECTION_SCHEMA ||
      options.state.tenantId !== tenantId ||
      options.stateDigest !== hash(options.state))
  ) {
    throw new Error("continued memory projection state is not digest-bound");
  }
  const state = options.state
    ? clone(options.state)
    : initialProjection(tenantId);
  const sequenceSet = new Set();
  for (const event of events) {
    if (sequenceSet.has(event.sequence))
      throw new Error("memory event sequence must be unique");
    sequenceSet.add(event.sequence);
    const eventDigest = hash(event);
    if (state.seenEvents[event.eventId]) {
      if (state.seenEvents[event.eventId] !== eventDigest)
        throw new Error("conflicting memory eventId rejected");
      continue;
    }
    if (event.sequence !== state.sequence + 1)
      throw new Error("memory event sequence must be contiguous");
    applyEvent(state, event);
  }
  const projectionDigest = hash(state);
  return freeze({ ...state, projectionDigest });
}

function normalizeCompaction(input, projection) {
  const body = {};
  for (const field of COMPACTION_FIELDS) {
    if (field === "goalState") {
      if (
        !input?.goalState ||
        typeof input.goalState !== "object" ||
        Array.isArray(input.goalState)
      ) {
        throw new TypeError("compaction.goalState is required");
      }
      body.goalState = clone(input.goalState);
      assertMetadataOnly(body.goalState, "goalState");
    } else body[field] = strings(input?.[field], `compaction.${field}`);
  }
  if (body.memoryLineage.length === 0)
    throw new TypeError("compaction.memoryLineage cannot be empty");
  return {
    schema: STRUCTURED_MEMORY_SNAPSHOT_SCHEMA,
    tenantId: projection.tenantId,
    throughSequence: projection.sequence,
    eventRoot: projection.eventRoot,
    projectionDigest: projection.projectionDigest,
    ...body,
  };
}

function verifyPersistedSnapshot(snapshot, events, tenantId) {
  if (snapshot == null) return null;
  const core = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== "snapshotDigest"),
  );
  if (
    snapshot.schema !== STRUCTURED_MEMORY_SNAPSHOT_SCHEMA ||
    snapshot.tenantId !== tenantId ||
    !DIGEST.test(snapshot.snapshotDigest || "") ||
    snapshot.snapshotDigest !== hash(core) ||
    !Number.isSafeInteger(snapshot.throughSequence) ||
    snapshot.throughSequence < 0
  ) {
    throw new Error("persisted structured memory snapshot is invalid");
  }
  const boundaryEvents = events.filter(
    (event) => event.sequence <= snapshot.throughSequence,
  );
  const boundary = projectStructuredMemory(boundaryEvents, { tenantId });
  if (
    boundary.sequence !== snapshot.throughSequence ||
    boundary.eventRoot !== snapshot.eventRoot ||
    boundary.projectionDigest !== snapshot.projectionDigest
  ) {
    throw new Error(
      "persisted structured memory snapshot does not match event lineage",
    );
  }
  for (const field of COMPACTION_FIELDS) {
    if (field === "goalState") {
      if (
        !snapshot.goalState ||
        typeof snapshot.goalState !== "object" ||
        Array.isArray(snapshot.goalState)
      ) {
        throw new Error(
          "persisted structured memory snapshot omitted goal state",
        );
      }
      assertMetadataOnly(snapshot.goalState, "goalState");
    } else strings(snapshot[field], `snapshot.${field}`);
  }
  if (snapshot.memoryLineage.length === 0)
    throw new Error("persisted snapshot omitted memory lineage");
  return freeze(clone(snapshot));
}

class StructuredEvolutionMemory {
  constructor({
    tenantId,
    persistEvent,
    persistSnapshot,
    postCompactVerifier,
    receiptProvider,
    initialEvents = [],
    initialSnapshot = null,
  } = {}) {
    this.tenantId = requiredString(tenantId, "tenantId");
    if (
      typeof persistEvent !== "function" ||
      typeof persistSnapshot !== "function"
    ) {
      throw new TypeError(
        "persistent event/snapshot ports and PostCompact verifier are required",
      );
    }
    this._persistEvent = persistEvent;
    this._persistSnapshot = persistSnapshot;
    this._postCompactVerifier = consumePostCompactVerifier(
      postCompactVerifier,
      this.tenantId,
    );
    this._receiptProvider = consumeReceiptProvider(
      receiptProvider,
      this.tenantId,
    );
    if (!Array.isArray(initialEvents))
      throw new TypeError("initialEvents must be an array");
    this._events = initialEvents.map(normalizeEvent);
    this._projection = projectStructuredMemory(this._events, {
      tenantId: this.tenantId,
    });
    this._snapshot = verifyPersistedSnapshot(
      initialSnapshot,
      this._events,
      this.tenantId,
    );
  }

  async append(input) {
    const actor = consumeAuthority(input?.authority, this.tenantId);
    const eventInput = { ...input };
    delete eventInput.authority;
    const receiptRefs = eventInput.receiptRefs || {};
    delete eventInput.receiptRefs;
    if (eventInput.receipts != null) {
      if (
        typeof eventInput.receipts !== "object" ||
        Array.isArray(eventInput.receipts) ||
        canonical(normalizeReceipts(eventInput.receipts)) !==
          canonical(normalizeReceipts())
      ) {
        throw new Error(
          "runtime receipt digests must be resolved by the configured provider",
        );
      }
    }
    delete eventInput.receipts;
    const candidate = {
      ...eventInput,
      actor,
      schema: STRUCTURED_MEMORY_EVENT_SCHEMA,
      tenantId: this.tenantId,
      sequence: this._projection.sequence + 1,
    };
    const receipts = await this._receiptProvider.resolveForEvent(
      candidate,
      receiptRefs,
    );
    const event = normalizeEvent({ ...candidate, receipts });
    const next = projectStructuredMemory([event], {
      tenantId: this.tenantId,
      state: Object.fromEntries(
        Object.entries(this._projection).filter(
          ([key]) => key !== "projectionDigest",
        ),
      ),
      stateDigest: this._projection.projectionDigest,
    });
    const acknowledgement = await this._persistEvent(event);
    if (
      acknowledgement?.persisted !== true ||
      acknowledgement.eventId !== event.eventId ||
      acknowledgement.eventDigest !== hash(event)
    ) {
      throw new Error("structured memory event persistence was not confirmed");
    }
    this._events.push(event);
    this._projection = next;
    return freeze({ event, projection: next });
  }

  projection() {
    return this._projection;
  }

  snapshot() {
    return this._snapshot;
  }

  async compact(input) {
    const previous = this._snapshot;
    const candidate = normalizeCompaction(input, this._projection);
    const snapshotDigest = hash(candidate);
    let verified = false;
    try {
      verified = await this._postCompactVerifier(
        freeze({
          previous,
          candidate: freeze(clone(candidate)),
          snapshotDigest,
          projection: this._projection,
        }),
      );
    } catch {
      verified = false;
    }
    if (verified !== true)
      return freeze({
        status: "restored",
        snapshot: previous,
        reason: "post-compact verification failed",
      });
    let acknowledgement;
    try {
      acknowledgement = await this._persistSnapshot(
        freeze({ ...candidate, snapshotDigest }),
      );
    } catch {
      acknowledgement = null;
    }
    if (
      acknowledgement?.persisted !== true ||
      acknowledgement.snapshotDigest !== snapshotDigest
    ) {
      return freeze({
        status: "restored",
        snapshot: previous,
        reason: "snapshot persistence was not confirmed",
      });
    }
    this._snapshot = freeze({ ...candidate, snapshotDigest });
    return freeze({ status: "compacted", snapshot: this._snapshot });
  }
}

module.exports = {
  STRUCTURED_MEMORY_EVENT_SCHEMA,
  STRUCTURED_MEMORY_PROJECTION_SCHEMA,
  STRUCTURED_MEMORY_SNAPSHOT_SCHEMA,
  MEMORY_LAYER,
  MEMORY_ACTION,
  StructuredEvolutionMemory,
  projectStructuredMemory,
  createStructuredMemoryAuthority,
  captureStructuredMemoryAuthority,
  STRUCTURED_MEMORY_RECEIPT_SCHEMA,
  STRUCTURED_MEMORY_RECEIPT_RESOLUTION_SCHEMA,
  createStructuredMemoryReceiptProvider,
  isStructuredMemoryReceiptProvider,
  createStructuredMemoryAuthorityReceipt,
  STRUCTURED_MEMORY_POST_COMPACT_VERIFICATION_SCHEMA,
  createStructuredMemoryPostCompactVerifier,
  isStructuredMemoryPostCompactVerifier,
};
