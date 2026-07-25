"use strict";

const QQ_ADAPTERS = new Set(["qq-pc", "messaging-qq"]);
const IMMUTABLE_EVENT_EXTRA_FIELDS = Object.freeze([
  "messageId",
  "sequence",
  "peerUin",
  "peerUid",
  "senderUid",
  "senderUin",
  "senderType",
  "qqMsgType",
  "msgType",
  "subtype",
  "isGroup",
]);
const MUTABLE_EVENT_EXTRA_FIELDS = Object.freeze([
  "readState",
  "isSend",
  "isSelf",
]);
const PLACEHOLDER_TEXT =
  /^(?:\s*|[-–—]|null|undefined|\(?(?:empty|unknown|unnamed|待解析消息体|无内容|空)\)?)$/iu;
const NUMERIC_NAME = /^\d+$/u;

function qqMergeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)]),
    );
  }
  return value;
}

function stableValueKey(value) {
  if (typeof value === "string") return `s:${value}`;
  if (typeof value === "number") return `n:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  if (value === null) return "null";
  try {
    return `j:${JSON.stringify(value)}`;
  } catch {
    return `o:${String(value)}`;
  }
}

function unionValues(...arrays) {
  const result = [];
  const seen = new Set();
  for (const values of arrays) {
    for (const value of Array.isArray(values) ? values : []) {
      if (value == null || value === "") continue;
      const key = stableValueKey(value);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(cloneValue(value));
    }
  }
  return result;
}

function deepMergePopulated(existing, incoming, preferIncoming = true) {
  if (incoming == null) return cloneValue(existing);
  if (existing == null) return cloneValue(incoming);
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    return unionValues(existing, incoming);
  }
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const result = {};
    for (const key of new Set([
      ...Object.keys(existing),
      ...Object.keys(incoming),
    ])) {
      result[key] = deepMergePopulated(
        existing[key],
        incoming[key],
        preferIncoming,
      );
    }
    return result;
  }
  return cloneValue(preferIncoming ? incoming : existing);
}

function sourceIdentity(source) {
  if (
    !source ||
    typeof source.adapter !== "string" ||
    typeof source.originalId !== "string" ||
    source.originalId.length === 0
  ) {
    return null;
  }
  return {
    adapter: source.adapter,
    scope: typeof source.scope === "string" ? source.scope : "",
    originalId: source.originalId,
  };
}

function sameIdentity(left, right) {
  return (
    left &&
    right &&
    left.adapter === right.adapter &&
    left.scope === right.scope &&
    left.originalId === right.originalId
  );
}

function isQqEntity(entity) {
  return (
    entity?.extra?.platform === "qq" || QQ_ADAPTERS.has(entity?.source?.adapter)
  );
}

function isMeaningfulString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !PLACEHOLDER_TEXT.test(value.trim())
  );
}

function textScore(value, entity) {
  if (!isMeaningfulString(value)) return 0;
  let score = 100;
  const text = value.trim();
  if (entity?.extra?.textResolved === true) score += 40;
  if (text.includes("\uFFFD")) score -= 30;
  if (/^(?:[0-9a-f]{2}){8,}$/iu.test(text)) score -= 40;
  score += Math.min(40, Math.ceil(text.length / 20));
  return score;
}

function chooseText(existingValue, incomingValue, existing, incoming) {
  const existingScore = textScore(existingValue, existing);
  const incomingScore = textScore(incomingValue, incoming);
  return incomingScore > existingScore
    ? incomingValue
    : existingScore > 0
      ? existingValue
      : incomingValue || existingValue || "";
}

function nameScore(value) {
  if (!isMeaningfulString(value)) return 0;
  const name = value.trim();
  let score = 100;
  if (NUMERIC_NAME.test(name)) score -= 60;
  if (/^(?:person|group|topic)-/iu.test(name)) score -= 40;
  score += Math.min(20, name.length);
  return score;
}

function chooseName(existingValue, incomingValue) {
  const existingScore = nameScore(existingValue);
  const incomingScore = nameScore(incomingValue);
  return incomingScore > existingScore
    ? incomingValue
    : existingScore > 0
      ? existingValue
      : incomingValue || existingValue || "(unnamed)";
}

function chooseActor(existingActor, incomingActor) {
  const score = (actor) => {
    if (!isMeaningfulString(actor)) return 0;
    return /(?:^|-)self$/iu.test(actor) ? 50 : 100;
  };
  return score(incomingActor) > score(existingActor)
    ? incomingActor
    : existingActor || incomingActor;
}

function richness(value, depth = 0) {
  if (value == null || depth > 8) return 0;
  if (Buffer.isBuffer(value)) return Math.min(100, value.length);
  if (typeof value === "string") return value.length > 0 ? 1 + value.length : 0;
  if (typeof value === "number" || typeof value === "boolean") return 1;
  if (Array.isArray(value)) {
    return value.reduce((sum, child) => sum + richness(child, depth + 1), 0);
  }
  if (isPlainObject(value)) {
    return Object.values(value).reduce(
      (sum, child) => sum + richness(child, depth + 1),
      0,
    );
  }
  return 0;
}

function chooseRicher(existing, incoming) {
  return richness(incoming) > richness(existing)
    ? cloneValue(incoming)
    : cloneValue(existing);
}

function normalizeIdentifierValues(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value])
    .filter((entry) => typeof entry === "string")
    .filter((entry) => entry.length > 0);
}

function mergeIdentifiers(existing, incoming) {
  const result = {};
  for (const key of new Set([
    ...Object.keys(existing || {}),
    ...Object.keys(incoming || {}),
  ])) {
    const values = unionValues(
      normalizeIdentifierValues(existing?.[key]),
      normalizeIdentifierValues(incoming?.[key]),
    );
    if (values.length > 0) result[key] = values;
  }
  return result;
}

function mergeSource(existing, incoming, canonicalIdentity, incomingIsNewer) {
  const result = deepMergePopulated(existing, incoming, incomingIsNewer);
  const captured = [existing?.capturedAt, incoming?.capturedAt].filter(
    (value) => Number.isSafeInteger(value) && value > 0,
  );
  if (captured.length > 0) result.capturedAt = Math.max(...captured);
  if (canonicalIdentity) {
    result.adapter = canonicalIdentity.adapter;
    result.originalId = canonicalIdentity.originalId;
    if (canonicalIdentity.scope) result.scope = canonicalIdentity.scope;
    else delete result.scope;
  }
  return result;
}

function mergeBase(existing, incoming, canonicalIdentity) {
  const incomingIsNewer =
    Number.isSafeInteger(incoming.ingestedAt) &&
    (!Number.isSafeInteger(existing.ingestedAt) ||
      incoming.ingestedAt >= existing.ingestedAt);
  const result = deepMergePopulated(existing, incoming, incomingIsNewer);
  result.id = existing.id;
  result.type = existing.type;
  result.ingestedAt = Math.max(existing.ingestedAt || 0, incoming.ingestedAt);
  result.source = mergeSource(
    existing.source,
    incoming.source,
    canonicalIdentity,
    incomingIsNewer,
  );
  if (existing.confidence != null || incoming.confidence != null) {
    result.confidence = Math.max(
      Number(existing.confidence) || 0,
      Number(incoming.confidence) || 0,
    );
  }
  return { result, incomingIsNewer };
}

function mergeEvent(existing, incoming, canonicalIdentity) {
  const { result, incomingIsNewer } = mergeBase(
    existing,
    incoming,
    canonicalIdentity,
  );
  const text = chooseText(
    existing.content?.text,
    incoming.content?.text,
    existing,
    incoming,
  );
  const chosenTextIsIncoming = text === incoming.content?.text;
  const baseContent = deepMergePopulated(
    existing.content,
    incoming.content,
    chosenTextIsIncoming,
  );
  baseContent.text = text;
  baseContent.title = chooseName(
    existing.content?.title,
    incoming.content?.title,
  );
  result.content = baseContent;
  result.actor = chooseActor(existing.actor, incoming.actor);
  result.participants = unionValues(
    existing.participants,
    incoming.participants,
  );
  result.items = unionValues(existing.items, incoming.items);
  result.topics = unionValues(existing.topics, incoming.topics);
  result.place = existing.place || incoming.place;

  const extra = deepMergePopulated(
    existing.extra || {},
    incoming.extra || {},
    incomingIsNewer,
  );
  for (const field of IMMUTABLE_EVENT_EXTRA_FIELDS) {
    if (existing.extra?.[field] != null) {
      extra[field] = cloneValue(existing.extra[field]);
    } else if (incoming.extra?.[field] != null) {
      extra[field] = cloneValue(incoming.extra[field]);
    }
  }
  for (const field of MUTABLE_EVENT_EXTRA_FIELDS) {
    const newerValue = incomingIsNewer
      ? incoming.extra?.[field]
      : existing.extra?.[field];
    const olderValue = incomingIsNewer
      ? existing.extra?.[field]
      : incoming.extra?.[field];
    if (newerValue != null) extra[field] = cloneValue(newerValue);
    else if (olderValue != null) extra[field] = cloneValue(olderValue);
  }
  extra.textResolved =
    existing.extra?.textResolved === true ||
    incoming.extra?.textResolved === true;
  if (existing.extra?.rawRow != null || incoming.extra?.rawRow != null) {
    extra.rawRow = chooseRicher(existing.extra?.rawRow, incoming.extra?.rawRow);
  }
  extra.observationProducers = unionValues(
    existing.extra?.observationProducers,
    incoming.extra?.observationProducers,
    existing.extra?.observationProducer
      ? [existing.extra.observationProducer]
      : [],
    incoming.extra?.observationProducer
      ? [incoming.extra.observationProducer]
      : [],
  );
  delete extra.observationProducer;
  result.extra = extra;

  const occurred = [existing.occurredAt, incoming.occurredAt].filter(
    (value) => Number.isSafeInteger(value) && value > 0,
  );
  if (occurred.length > 0) result.occurredAt = Math.min(...occurred);
  if (existing.durationMs != null || incoming.durationMs != null) {
    result.durationMs = Math.max(
      Number(existing.durationMs) || 0,
      Number(incoming.durationMs) || 0,
    );
  }
  return result;
}

function mergePerson(existing, incoming, canonicalIdentity) {
  const { result } = mergeBase(existing, incoming, canonicalIdentity);
  result.names = unionValues(existing.names, incoming.names).sort(
    (left, right) => nameScore(right) - nameScore(left),
  );
  result.identifiers = mergeIdentifiers(
    existing.identifiers,
    incoming.identifiers,
  );
  result.relation = existing.relation || incoming.relation;
  result.notes =
    textScore(incoming.notes) > textScore(existing.notes)
      ? incoming.notes
      : existing.notes || incoming.notes;
  result.extra = deepMergePopulated(
    existing.extra || {},
    incoming.extra || {},
    true,
  );
  return result;
}

function mergeTopic(existing, incoming, canonicalIdentity) {
  const { result } = mergeBase(existing, incoming, canonicalIdentity);
  result.name = chooseName(existing.name, incoming.name);
  result.parentTopic = existing.parentTopic || incoming.parentTopic;
  result.derivedFromEvents = unionValues(
    existing.derivedFromEvents,
    incoming.derivedFromEvents,
  );
  result.extra = deepMergePopulated(
    existing.extra || {},
    incoming.extra || {},
    true,
  );
  return result;
}

function mergeNamedEntity(existing, incoming, canonicalIdentity) {
  const { result } = mergeBase(existing, incoming, canonicalIdentity);
  result.name = chooseName(existing.name, incoming.name);
  if (Array.isArray(existing.aliases) || Array.isArray(incoming.aliases)) {
    result.aliases = unionValues(existing.aliases, incoming.aliases);
  }
  result.extra = deepMergePopulated(
    existing.extra || {},
    incoming.extra || {},
    true,
  );
  return result;
}

/**
 * Field-level QQ conflict resolver for LocalVault.putBatchResolved.
 *
 * This deliberately has no global "producer rank". Each field selects its
 * best available evidence: meaningful text, non-self actors, unioned
 * references and identifiers, human names, richer raw rows, and newest
 * mutable read/direction state. Null never erases populated evidence.
 */
function mergeQqEntityConflict({
  entityType,
  existing,
  incoming,
  sourceIdentity: canonicalIdentity,
}) {
  if (!isQqEntity(existing) && !isQqEntity(incoming)) {
    throw qqMergeError(
      "QQ_QUALITY_RESOLVER_NON_QQ",
      "QQ quality resolver received a non-QQ entity",
    );
  }

  const existingIdentity = sourceIdentity(existing.source);
  const incomingIdentity = sourceIdentity(incoming.source);
  if (
    existingIdentity &&
    incomingIdentity &&
    !sameIdentity(existingIdentity, incomingIdentity) &&
    (!canonicalIdentity ||
      !sameIdentity(existingIdentity, canonicalIdentity) ||
      !sameIdentity(incomingIdentity, canonicalIdentity))
  ) {
    throw qqMergeError(
      "QQ_CANONICAL_IDENTITY_CONFLICT",
      "QQ entities with different canonical source identities cannot merge",
    );
  }

  if (entityType === "event") {
    return mergeEvent(existing, incoming, canonicalIdentity);
  }
  if (entityType === "person") {
    return mergePerson(existing, incoming, canonicalIdentity);
  }
  if (entityType === "topic") {
    return mergeTopic(existing, incoming, canonicalIdentity);
  }
  if (entityType === "item" || entityType === "place") {
    return mergeNamedEntity(existing, incoming, canonicalIdentity);
  }
  throw qqMergeError(
    "QQ_QUALITY_RESOLVER_ENTITY_TYPE",
    `QQ quality resolver does not support entity type ${entityType}`,
  );
}

module.exports = {
  mergeQqEntityConflict,
  _internal: {
    chooseActor,
    chooseName,
    chooseRicher,
    chooseText,
    deepMergePopulated,
    mergeIdentifiers,
    textScore,
    unionValues,
  },
};
