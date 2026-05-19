/**
 * NormalizedBatch — what every adapter.normalize() returns to the ingestor
 *
 * Mirrors §9.1 of docs/design/Personal_Data_Hub_Architecture.md:
 *   interface NormalizedBatch {
 *     events: Event[];
 *     persons: Person[];
 *     places: Place[];
 *     items: Item[];
 *     topics?: Topic[];
 *   }
 *
 * Helpers here let adapters build batches incrementally + ingestors validate
 * a whole batch in one call (so a single bad row doesn't kill the whole sync).
 */

"use strict";

const { validate } = require("./schemas");

function emptyBatch() {
  return { events: [], persons: [], places: [], items: [], topics: [] };
}

function mergeBatches(a, b) {
  return {
    events: [...(a.events || []), ...(b.events || [])],
    persons: [...(a.persons || []), ...(b.persons || [])],
    places: [...(a.places || []), ...(b.places || [])],
    items: [...(a.items || []), ...(b.items || [])],
    topics: [...(a.topics || []), ...(b.topics || [])],
  };
}

/**
 * Validate every entity in a batch. Returns:
 *   {
 *     valid: boolean,
 *     entityCount: number,
 *     errorCount: number,
 *     errors: Array<{ kind, index, id?, errors: string[] }>,
 *   }
 *
 * The ingestor's policy is: if errorCount > 0, log all bad rows but still
 * ingest the good ones (don't let a single corrupt row from a third-party
 * adapter abort the whole sync window).
 */
function validateBatch(batch) {
  if (batch == null || typeof batch !== "object") {
    return {
      valid: false,
      entityCount: 0,
      errorCount: 1,
      errors: [{ kind: "batch", index: -1, errors: ["batch must be a plain object"] }],
    };
  }

  const errors = [];
  let entityCount = 0;

  const kinds = ["events", "persons", "places", "items", "topics"];
  for (const kind of kinds) {
    const arr = batch[kind];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) {
      errors.push({ kind, index: -1, errors: [`${kind} must be an array when present`] });
      continue;
    }
    arr.forEach((entity, i) => {
      entityCount += 1;
      const result = validate(entity);
      if (!result.valid) {
        errors.push({
          kind,
          index: i,
          id: entity && typeof entity === "object" ? entity.id : undefined,
          errors: result.errors,
        });
      }
    });
  }

  return {
    valid: errors.length === 0,
    entityCount,
    errorCount: errors.length,
    errors,
  };
}

/**
 * Partition a batch into "valid" and "invalid" sub-batches.
 * Lets the ingestor commit valids + spool invalids to a review queue.
 */
function partitionBatch(batch) {
  const valid = emptyBatch();
  const invalid = emptyBatch();
  const invalidReasons = [];

  const kinds = ["events", "persons", "places", "items", "topics"];
  for (const kind of kinds) {
    const arr = batch[kind] || [];
    if (!Array.isArray(arr)) continue;
    arr.forEach((entity, i) => {
      const result = validate(entity);
      if (result.valid) {
        valid[kind].push(entity);
      } else {
        invalid[kind].push(entity);
        invalidReasons.push({ kind, index: i, id: entity?.id, errors: result.errors });
      }
    });
  }

  return { valid, invalid, invalidReasons };
}

module.exports = {
  emptyBatch,
  mergeBatches,
  validateBatch,
  partitionBatch,
};
