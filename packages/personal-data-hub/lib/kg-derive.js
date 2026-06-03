/**
 * UnifiedSchema → Knowledge Graph triples.
 *
 * Mirrors §5.3 of docs/design/Personal_Data_Hub_Architecture.md:
 *   Event(<id>) --occurred-at--> Time(<ts>)
 *   Event(<id>) --happened-at--> Place(<id>)
 *   Event(<id>) --involves--> Person(<id>)   (one per participant)
 *   Event(<id>) --by--> Person(<actor>)
 *   Event(<id>) --about--> Item(<id>)
 *   Event(<id>) --topic--> Topic(<id>)
 *   Event(<id>) --type--> "<subtype>"
 *   Event(<id>) --source--> "<adapter>"
 *
 * Plus for entities themselves so the KG knows they exist:
 *   Person(<id>) --rdf:type--> "person"
 *   Person(<id>) --has-name--> "<name>" (one per name)
 *   Place(<id>) --located-at--> "lat,lng" (if coordinates)
 *   Item(<id>)  --priced-at--> "<value> <currency>" (if priced)
 *   Topic(<id>) --parent--> Topic(<parentId>) (if parented)
 *
 * The hub does NOT depend on a specific KG engine. The registry pipes
 * these triples to a pluggable `kgSink({ subject, predicate, object,
 * literal })` callback that the desktop wiring binds to ChainlessChain's
 * existing KG layer (or to /dev/null in tests).
 *
 * Triples are plain JS objects so they can serialize to JSON for IPC, KG
 * persistence, or human inspection.
 */

"use strict";

/**
 * @typedef {object} Triple
 * @property {string} subject   entity id (typed by namespace prefix unless raw)
 * @property {string} predicate
 * @property {string} [object]  another entity id (for entity-to-entity edges)
 * @property {string|number|null} [literal]  primitive value (for leaf edges)
 */

function triple(subject, predicate, opts) {
  // opts: { object: "<id>" } or { literal: ... }
  const out = { subject, predicate };
  if (opts && opts.object !== undefined && opts.object !== null) {
    out.object = String(opts.object);
  } else if (opts && opts.literal !== undefined && opts.literal !== null) {
    out.literal = opts.literal;
  }
  return out;
}

// ─── Per-entity derivers ────────────────────────────────────────────────

function deriveEventTriples(event) {
  const out = [];
  out.push(triple(event.id, "rdf:type", { literal: "event" }));
  out.push(triple(event.id, "subtype", { literal: event.subtype }));
  out.push(triple(event.id, "occurred-at", { literal: event.occurredAt }));
  if (event.source && event.source.adapter) {
    out.push(triple(event.id, "source", { literal: event.source.adapter }));
  }
  if (event.actor) {
    out.push(triple(event.id, "by", { object: event.actor }));
  }
  if (Array.isArray(event.participants)) {
    for (const p of event.participants) {
      out.push(triple(event.id, "involves", { object: p }));
    }
  }
  if (event.place) {
    out.push(triple(event.id, "happened-at", { object: event.place }));
  }
  if (Array.isArray(event.items)) {
    for (const i of event.items) {
      out.push(triple(event.id, "about", { object: i }));
    }
  }
  if (Array.isArray(event.topics)) {
    for (const t of event.topics) {
      out.push(triple(event.id, "topic", { object: t }));
    }
  }
  if (event.content && event.content.amount) {
    const a = event.content.amount;
    out.push(triple(event.id, "amount-value", { literal: a.value }));
    out.push(triple(event.id, "amount-currency", { literal: a.currency }));
    out.push(triple(event.id, "amount-direction", { literal: a.direction }));
  }
  return out;
}

function derivePersonTriples(person) {
  const out = [];
  out.push(triple(person.id, "rdf:type", { literal: "person" }));
  out.push(triple(person.id, "subtype", { literal: person.subtype }));
  for (const n of person.names) {
    out.push(triple(person.id, "has-name", { literal: n }));
  }
  if (person.identifiers) {
    for (const [kind, val] of Object.entries(person.identifiers)) {
      if (val == null) continue;
      if (Array.isArray(val)) {
        for (const v of val) {
          out.push(triple(person.id, `id:${kind}`, { literal: v }));
        }
      } else {
        out.push(triple(person.id, `id:${kind}`, { literal: val }));
      }
    }
  }
  if (person.relation) {
    out.push(triple(person.id, "relation", { literal: person.relation }));
  }
  return out;
}

function derivePlaceTriples(place) {
  const out = [];
  out.push(triple(place.id, "rdf:type", { literal: "place" }));
  out.push(triple(place.id, "has-name", { literal: place.name }));
  for (const a of place.aliases) {
    if (a !== place.name) out.push(triple(place.id, "has-alias", { literal: a }));
  }
  if (place.coordinates) {
    out.push(triple(place.id, "located-at", { literal: `${place.coordinates.lat},${place.coordinates.lng}` }));
  }
  if (place.address) {
    out.push(triple(place.id, "address", { literal: place.address }));
  }
  if (place.category) {
    out.push(triple(place.id, "category", { literal: place.category }));
  }
  return out;
}

function deriveItemTriples(item) {
  const out = [];
  out.push(triple(item.id, "rdf:type", { literal: "item" }));
  out.push(triple(item.id, "subtype", { literal: item.subtype }));
  out.push(triple(item.id, "has-name", { literal: item.name }));
  if (item.category) out.push(triple(item.id, "category", { literal: item.category }));
  if (item.price) {
    out.push(triple(item.id, "priced-at", { literal: `${item.price.value} ${item.price.currency}` }));
  }
  if (item.merchant) {
    out.push(triple(item.id, "sold-by", { object: item.merchant }));
  }
  return out;
}

function deriveTopicTriples(topic) {
  const out = [];
  out.push(triple(topic.id, "rdf:type", { literal: "topic" }));
  out.push(triple(topic.id, "has-name", { literal: topic.name }));
  if (topic.parentTopic) {
    out.push(triple(topic.id, "parent", { object: topic.parentTopic }));
  }
  if (Array.isArray(topic.derivedFromEvents)) {
    for (const ev of topic.derivedFromEvents) {
      out.push(triple(topic.id, "derived-from", { object: ev }));
    }
  }
  return out;
}

/**
 * Derive all KG triples for a NormalizedBatch in one call.
 * Returns a flat array of triples in the order entities appear in the batch.
 */
function deriveBatchTriples(batch) {
  const triples = [];
  if (!batch || typeof batch !== "object") return triples;

  for (const e of batch.events || []) triples.push(...deriveEventTriples(e));
  for (const p of batch.persons || []) triples.push(...derivePersonTriples(p));
  for (const pl of batch.places || []) triples.push(...derivePlaceTriples(pl));
  for (const i of batch.items || []) triples.push(...deriveItemTriples(i));
  for (const t of batch.topics || []) triples.push(...deriveTopicTriples(t));

  return triples;
}

/**
 * Dispatch a single entity to its appropriate deriver based on .type.
 * Returns [] for unknown types rather than throwing — the registry uses
 * this in hot loops where one weird row shouldn't kill the whole batch.
 */
function deriveEntityTriples(entity) {
  if (!entity || typeof entity !== "object") return [];
  switch (entity.type) {
    case "event":
      return deriveEventTriples(entity);
    case "person":
      return derivePersonTriples(entity);
    case "place":
      return derivePlaceTriples(entity);
    case "item":
      return deriveItemTriples(entity);
    case "topic":
      return deriveTopicTriples(entity);
    default:
      return [];
  }
}

module.exports = {
  triple,
  deriveEventTriples,
  derivePersonTriples,
  derivePlaceTriples,
  deriveItemTriples,
  deriveTopicTriples,
  deriveBatchTriples,
  deriveEntityTriples,
};
