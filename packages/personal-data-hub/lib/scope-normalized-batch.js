"use strict";

const { createHash } = require("node:crypto");

const ENTITY_COLLECTIONS = Object.freeze({
  events: "event",
  persons: "person",
  places: "place",
  items: "item",
  topics: "topic",
});

function scopedId(scope, type, seed, originalId = seed) {
  const digest = createHash("sha256")
    .update(String(scope))
    .update("\0")
    .update(String(type))
    .update("\0")
    .update(String(seed))
    .digest("hex")
    .slice(0, 32);
  const selfSuffix =
    typeof originalId === "string" &&
    (originalId === "self" || originalId.endsWith("-self"))
      ? "-self"
      : "";
  return `pdh-${type}-${digest}${selfSuffix}`;
}

function entitySeed(entity) {
  const source = entity && entity.source;
  if (
    source &&
    typeof source.adapter === "string" &&
    typeof source.originalId === "string" &&
    source.originalId.length > 0
  ) {
    return `${source.adapter}\0${source.originalId}`;
  }
  return entity && typeof entity.id === "string" ? entity.id : "";
}

function mapReference(idMaps, type, scope, value) {
  if (typeof value !== "string" || value.length === 0) return value;
  const known = idMaps[type].get(value);
  return known || scopedId(scope, type, value, value);
}

function mapReferenceArray(idMaps, type, scope, values) {
  return Array.isArray(values)
    ? values.map((value) => mapReference(idMaps, type, scope, value))
    : values;
}

/**
 * Attach a privacy-safe account scope to normalized entities and make their
 * IDs account-specific before they enter the vault/KG/RAG sinks.
 *
 * Empty scope is a strict compatibility no-op. For account-backed syncs,
 * IDs are deterministic from (scope, entity type, source adapter,
 * source.originalId), which prevents both cross-account primary-key clashes
 * and dangling references when an adapter emits random IDs on each re-sync.
 */
function scopeNormalizedBatch(batch, scope) {
  if (typeof scope !== "string" || scope.length === 0) return batch;

  const idMaps = {
    event: new Map(),
    person: new Map(),
    place: new Map(),
    item: new Map(),
    topic: new Map(),
  };

  for (const [collection, type] of Object.entries(ENTITY_COLLECTIONS)) {
    for (const entity of batch[collection] || []) {
      if (!entity || typeof entity.id !== "string") continue;
      idMaps[type].set(
        entity.id,
        scopedId(scope, type, entitySeed(entity), entity.id),
      );
    }
  }

  const result = {};
  for (const [collection, type] of Object.entries(ENTITY_COLLECTIONS)) {
    result[collection] = (batch[collection] || []).map((entity) => {
      const scoped = {
        ...entity,
        id:
          idMaps[type].get(entity.id) ||
          scopedId(scope, type, entitySeed(entity), entity.id),
        source: {
          ...entity.source,
          scope,
        },
      };

      if (type === "event") {
        if (entity.actor !== undefined) {
          scoped.actor = mapReference(idMaps, "person", scope, entity.actor);
        }
        if (entity.participants !== undefined) {
          scoped.participants = mapReferenceArray(
            idMaps,
            "person",
            scope,
            entity.participants,
          );
        }
        if (entity.place !== undefined) {
          scoped.place = mapReference(idMaps, "place", scope, entity.place);
        }
        if (entity.items !== undefined) {
          scoped.items = mapReferenceArray(idMaps, "item", scope, entity.items);
        }
        if (entity.topics !== undefined) {
          scoped.topics = mapReferenceArray(
            idMaps,
            "topic",
            scope,
            entity.topics,
          );
        }
      } else if (type === "item" && entity.merchant !== undefined) {
        // `merchant` may be display text. Rewrite it only when it is an
        // actual Person id emitted in this normalized batch.
        scoped.merchant = idMaps.person.get(entity.merchant) || entity.merchant;
      } else if (type === "topic") {
        if (entity.parentTopic !== undefined) {
          scoped.parentTopic = mapReference(
            idMaps,
            "topic",
            scope,
            entity.parentTopic,
          );
        }
        if (entity.derivedFromEvents !== undefined) {
          scoped.derivedFromEvents = mapReferenceArray(
            idMaps,
            "event",
            scope,
            entity.derivedFromEvents,
          );
        }
      }

      return scoped;
    });
  }

  return result;
}

module.exports = {
  scopeNormalizedBatch,
  scopedId,
};
