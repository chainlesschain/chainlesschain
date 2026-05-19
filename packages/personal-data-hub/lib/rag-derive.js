/**
 * UnifiedSchema → RAG documents.
 *
 * Mirrors §8.3 of docs/design/Personal_Data_Hub_Architecture.md. The RAG
 * layer needs (text, metadata) pairs to embed + index. Different entity
 * types contribute different text:
 *
 *   - Event   text = content.title + content.text + "(amount/place/type prose)"
 *   - Person  text = names + relation + notes
 *   - Place   text = name + aliases + address
 *   - Item    text = name + category
 *   - Topic   text = name
 *
 * Metadata always includes (id, type, subtype, occurredAt where applicable,
 * source.adapter). The RAG sink can then filter by adapter / time-window /
 * subtype when retrieving — critical for "上个月的消费 Q&A" style queries.
 *
 * Like kg-derive, this module is engine-agnostic. The registry pipes
 * {text, metadata} pairs to a `ragSink(doc)` callback wired up by the
 * desktop main process to ChainlessChain's existing RAG pipeline (BM25 +
 * Qdrant vector). In tests it just collects into an array.
 */

"use strict";

/**
 * @typedef {object} RagDoc
 * @property {string} id         entity id (also serves as doc key in RAG)
 * @property {string} type
 * @property {string} text       embedding input
 * @property {object} metadata   filter fields for retrieval
 */

function joinNonEmpty(parts, sep = "\n") {
  return parts.filter((p) => p != null && p !== "").join(sep);
}

function eventToRagDoc(event) {
  const parts = [];
  if (event.content) {
    if (event.content.title) parts.push(event.content.title);
    if (event.content.text) parts.push(event.content.text);
    if (event.content.amount) {
      const a = event.content.amount;
      const sign = a.direction === "in" ? "+" : "-";
      parts.push(`${sign}${a.value} ${a.currency}`);
    }
  }
  // Add structural prose so embedding picks up type/category context.
  if (event.subtype) parts.push(`type: ${event.subtype}`);
  if (event.source && event.source.adapter) parts.push(`from: ${event.source.adapter}`);

  const text = joinNonEmpty(parts);
  return {
    id: event.id,
    type: "event",
    text,
    metadata: {
      subtype: event.subtype,
      occurredAt: event.occurredAt,
      actor: event.actor || null,
      place: event.place || null,
      adapter: event.source && event.source.adapter,
      originalId: event.source && event.source.originalId,
      ...(event.topics ? { topics: event.topics } : {}),
    },
  };
}

function personToRagDoc(person) {
  const parts = [...person.names];
  if (person.relation) parts.push(`relation: ${person.relation}`);
  if (person.notes) parts.push(person.notes);
  if (person.identifiers) {
    for (const [k, v] of Object.entries(person.identifiers)) {
      if (v == null) continue;
      const display = Array.isArray(v) ? v.join(", ") : v;
      parts.push(`${k}: ${display}`);
    }
  }
  return {
    id: person.id,
    type: "person",
    text: joinNonEmpty(parts),
    metadata: {
      subtype: person.subtype,
      adapter: person.source && person.source.adapter,
      originalId: person.source && person.source.originalId,
    },
  };
}

function placeToRagDoc(place) {
  const parts = [place.name];
  for (const a of place.aliases) {
    if (a !== place.name) parts.push(a);
  }
  if (place.address) parts.push(place.address);
  if (place.category) parts.push(`category: ${place.category}`);
  return {
    id: place.id,
    type: "place",
    text: joinNonEmpty(parts),
    metadata: {
      adapter: place.source && place.source.adapter,
      originalId: place.source && place.source.originalId,
      ...(place.coordinates ? { coordinates: place.coordinates } : {}),
    },
  };
}

function itemToRagDoc(item) {
  const parts = [item.name];
  if (item.category) parts.push(`category: ${item.category}`);
  if (item.price) parts.push(`${item.price.value} ${item.price.currency}`);
  return {
    id: item.id,
    type: "item",
    text: joinNonEmpty(parts),
    metadata: {
      subtype: item.subtype,
      adapter: item.source && item.source.adapter,
      originalId: item.source && item.source.originalId,
      merchant: item.merchant || null,
    },
  };
}

function topicToRagDoc(topic) {
  return {
    id: topic.id,
    type: "topic",
    text: topic.name,
    metadata: {
      adapter: topic.source && topic.source.adapter,
      parentTopic: topic.parentTopic || null,
    },
  };
}

function entityToRagDoc(entity) {
  if (!entity || typeof entity !== "object") return null;
  switch (entity.type) {
    case "event":
      return eventToRagDoc(entity);
    case "person":
      return personToRagDoc(entity);
    case "place":
      return placeToRagDoc(entity);
    case "item":
      return itemToRagDoc(entity);
    case "topic":
      return topicToRagDoc(entity);
    default:
      return null;
  }
}

/**
 * Derive RAG docs for an entire NormalizedBatch.
 * Empty-text entities are filtered out — no point embedding "" into Qdrant.
 */
function deriveBatchDocs(batch) {
  const out = [];
  if (!batch || typeof batch !== "object") return out;
  const push = (entity, fn) => {
    const doc = fn(entity);
    if (doc && doc.text && doc.text.length > 0) out.push(doc);
  };
  for (const e of batch.events || []) push(e, eventToRagDoc);
  for (const p of batch.persons || []) push(p, personToRagDoc);
  for (const pl of batch.places || []) push(pl, placeToRagDoc);
  for (const i of batch.items || []) push(i, itemToRagDoc);
  for (const t of batch.topics || []) push(t, topicToRagDoc);
  return out;
}

module.exports = {
  eventToRagDoc,
  personToRagDoc,
  placeToRagDoc,
  itemToRagDoc,
  topicToRagDoc,
  entityToRagDoc,
  deriveBatchDocs,
};
