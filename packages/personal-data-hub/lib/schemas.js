/**
 * UnifiedSchema entity validators
 *
 * Mirrors §5 of docs/design/Personal_Data_Hub_Architecture.md exactly.
 *
 * Design choices:
 *   - Pure JS (no zod / ajv) — keep prototype lean. Validators are ~150 LOC total.
 *   - Validators return { valid: boolean, errors: string[] } rather than throwing,
 *     so adapter pipelines can collect & report many bad rows in one pass.
 *   - "extra" is intentionally schemaless (per design doc §5.2 "schemaless 兜底").
 *   - Required fields are strict; optional fields are tolerated when undefined
 *     but rejected when present with wrong type.
 */

"use strict";

const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
  AMOUNT_DIRECTIONS,
} = require("./constants");

// ─── Helpers ─────────────────────────────────────────────────────────────

function isString(v) {
  return typeof v === "string";
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isInt(v) {
  return Number.isInteger(v);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isStringArray(v) {
  return Array.isArray(v) && v.every(isString);
}

function isEnum(v, enumObj) {
  return Object.values(enumObj).includes(v);
}

function pushIf(errors, cond, msg) {
  if (!cond) errors.push(msg);
}

// ─── BaseEntity validation (shared) ──────────────────────────────────────

function validateBase(entity, errors, ctx = "") {
  const p = ctx ? ctx + "." : "";

  pushIf(
    errors,
    isNonEmptyString(entity.id),
    `${p}id must be a non-empty string`,
  );

  // ingestedAt: ms timestamp (int)
  pushIf(
    errors,
    isInt(entity.ingestedAt) && entity.ingestedAt > 0,
    `${p}ingestedAt must be a positive integer (ms timestamp)`,
  );

  // confidence: optional but if present 0..1
  if (entity.confidence !== undefined) {
    pushIf(
      errors,
      isFiniteNumber(entity.confidence) &&
        entity.confidence >= 0 &&
        entity.confidence <= 1,
      `${p}confidence must be a number in [0,1] when present`,
    );
  }

  // source: required object
  if (!isPlainObject(entity.source)) {
    errors.push(`${p}source must be a plain object`);
    return;
  }
  const s = entity.source;
  pushIf(
    errors,
    isNonEmptyString(s.adapter),
    `${p}source.adapter must be a non-empty string`,
  );
  pushIf(
    errors,
    isNonEmptyString(s.adapterVersion),
    `${p}source.adapterVersion must be a non-empty string`,
  );
  pushIf(
    errors,
    isInt(s.capturedAt) && s.capturedAt > 0,
    `${p}source.capturedAt must be a positive integer ms timestamp`,
  );
  pushIf(
    errors,
    isEnum(s.capturedBy, CAPTURED_BY),
    `${p}source.capturedBy must be one of ${Object.values(CAPTURED_BY).join("|")}`,
  );
  if (s.originalId !== undefined) {
    pushIf(
      errors,
      isString(s.originalId),
      `${p}source.originalId must be a string when present`,
    );
  }
  if (s.scope !== undefined) {
    pushIf(
      errors,
      isNonEmptyString(s.scope),
      `${p}source.scope must be a non-empty string when present`,
    );
  }

  // extra: optional object
  if (entity.extra !== undefined) {
    pushIf(
      errors,
      isPlainObject(entity.extra),
      `${p}extra must be a plain object when present`,
    );
  }
}

// ─── Person ──────────────────────────────────────────────────────────────

function validatePerson(p) {
  const errors = [];
  if (!isPlainObject(p))
    return { valid: false, errors: ["entity must be a plain object"] };

  pushIf(errors, p.type === ENTITY_TYPES.PERSON, 'type must be "person"');
  pushIf(
    errors,
    isEnum(p.subtype, PERSON_SUBTYPES),
    `subtype must be one of ${Object.values(PERSON_SUBTYPES).join("|")}`,
  );
  pushIf(
    errors,
    Array.isArray(p.names) &&
      p.names.length > 0 &&
      p.names.every(isNonEmptyString),
    "names must be a non-empty array of non-empty strings",
  );

  if (p.identifiers !== undefined) {
    if (!isPlainObject(p.identifiers)) {
      errors.push("identifiers must be a plain object when present");
    } else {
      for (const [k, v] of Object.entries(p.identifiers)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          if (!v.every(isString))
            errors.push(`identifiers.${k} must be string[] when array`);
        } else if (!isString(v)) {
          errors.push(`identifiers.${k} must be string or string[]`);
        }
      }
    }
  }

  if (p.relation !== undefined) {
    pushIf(
      errors,
      isString(p.relation),
      "relation must be a string when present",
    );
  }
  if (p.notes !== undefined) {
    pushIf(errors, isString(p.notes), "notes must be a string when present");
  }

  validateBase(p, errors);
  return { valid: errors.length === 0, errors };
}

// ─── Event ───────────────────────────────────────────────────────────────

function validateEvent(e) {
  const errors = [];
  if (!isPlainObject(e))
    return { valid: false, errors: ["entity must be a plain object"] };

  pushIf(errors, e.type === ENTITY_TYPES.EVENT, 'type must be "event"');
  pushIf(
    errors,
    isEnum(e.subtype, EVENT_SUBTYPES),
    `subtype must be one of ${Object.values(EVENT_SUBTYPES).join("|")}`,
  );
  pushIf(
    errors,
    isInt(e.occurredAt) && e.occurredAt > 0,
    "occurredAt must be a positive integer ms timestamp",
  );

  if (e.durationMs !== undefined) {
    pushIf(
      errors,
      isInt(e.durationMs) && e.durationMs >= 0,
      "durationMs must be a non-negative integer when present",
    );
  }
  if (e.actor !== undefined) {
    pushIf(errors, isString(e.actor), "actor must be a string when present");
  }
  if (e.participants !== undefined) {
    pushIf(
      errors,
      isStringArray(e.participants),
      "participants must be string[] when present",
    );
  }
  if (e.place !== undefined) {
    pushIf(errors, isString(e.place), "place must be a string when present");
  }
  if (e.items !== undefined) {
    pushIf(
      errors,
      isStringArray(e.items),
      "items must be string[] when present",
    );
  }
  if (e.topics !== undefined) {
    pushIf(
      errors,
      isStringArray(e.topics),
      "topics must be string[] when present",
    );
  }

  if (!isPlainObject(e.content)) {
    errors.push("content must be a plain object");
  } else {
    const c = e.content;
    if (c.text !== undefined)
      pushIf(errors, isString(c.text), "content.text must be string");
    if (c.title !== undefined)
      pushIf(errors, isString(c.title), "content.title must be string");
    if (c.mediaRefs !== undefined) {
      pushIf(
        errors,
        isStringArray(c.mediaRefs),
        "content.mediaRefs must be string[]",
      );
    }
    if (c.amount !== undefined) {
      if (!isPlainObject(c.amount)) {
        errors.push("content.amount must be a plain object when present");
      } else {
        pushIf(
          errors,
          isFiniteNumber(c.amount.value),
          "content.amount.value must be a finite number",
        );
        pushIf(
          errors,
          isNonEmptyString(c.amount.currency),
          "content.amount.currency must be a non-empty string",
        );
        pushIf(
          errors,
          isEnum(c.amount.direction, AMOUNT_DIRECTIONS),
          `content.amount.direction must be one of ${Object.values(AMOUNT_DIRECTIONS).join("|")}`,
        );
      }
    }
  }

  validateBase(e, errors);
  return { valid: errors.length === 0, errors };
}

// ─── Place ───────────────────────────────────────────────────────────────

function validatePlace(p) {
  const errors = [];
  if (!isPlainObject(p))
    return { valid: false, errors: ["entity must be a plain object"] };

  pushIf(errors, p.type === ENTITY_TYPES.PLACE, 'type must be "place"');
  pushIf(errors, isNonEmptyString(p.name), "name must be a non-empty string");

  if (p.coordinates !== undefined) {
    if (!isPlainObject(p.coordinates)) {
      errors.push("coordinates must be a plain object when present");
    } else {
      pushIf(
        errors,
        isFiniteNumber(p.coordinates.lat) &&
          p.coordinates.lat >= -90 &&
          p.coordinates.lat <= 90,
        "coordinates.lat must be a number in [-90,90]",
      );
      pushIf(
        errors,
        isFiniteNumber(p.coordinates.lng) &&
          p.coordinates.lng >= -180 &&
          p.coordinates.lng <= 180,
        "coordinates.lng must be a number in [-180,180]",
      );
    }
  }

  if (p.address !== undefined) {
    pushIf(
      errors,
      isString(p.address),
      "address must be a string when present",
    );
  }
  if (p.category !== undefined) {
    pushIf(
      errors,
      isString(p.category),
      "category must be a string when present",
    );
  }

  // aliases: per design doc, present (possibly empty) array
  pushIf(
    errors,
    Array.isArray(p.aliases) && p.aliases.every(isString),
    "aliases must be a (possibly empty) array of strings",
  );

  validateBase(p, errors);
  return { valid: errors.length === 0, errors };
}

// ─── Item ────────────────────────────────────────────────────────────────

function validateItem(i) {
  const errors = [];
  if (!isPlainObject(i))
    return { valid: false, errors: ["entity must be a plain object"] };

  pushIf(errors, i.type === ENTITY_TYPES.ITEM, 'type must be "item"');
  pushIf(
    errors,
    isEnum(i.subtype, ITEM_SUBTYPES),
    `subtype must be one of ${Object.values(ITEM_SUBTYPES).join("|")}`,
  );
  pushIf(errors, isNonEmptyString(i.name), "name must be a non-empty string");

  if (i.category !== undefined) {
    pushIf(
      errors,
      isString(i.category),
      "category must be a string when present",
    );
  }
  if (i.price !== undefined) {
    if (!isPlainObject(i.price)) {
      errors.push("price must be a plain object when present");
    } else {
      pushIf(
        errors,
        isFiniteNumber(i.price.value),
        "price.value must be a finite number",
      );
      pushIf(
        errors,
        isNonEmptyString(i.price.currency),
        "price.currency must be a non-empty string",
      );
    }
  }
  if (i.merchant !== undefined) {
    pushIf(
      errors,
      isString(i.merchant),
      "merchant must be a string when present",
    );
  }
  if (i.externalUrl !== undefined) {
    pushIf(
      errors,
      isString(i.externalUrl),
      "externalUrl must be a string when present",
    );
  }
  if (i.thumbnailLocalPath !== undefined) {
    pushIf(
      errors,
      isString(i.thumbnailLocalPath),
      "thumbnailLocalPath must be a string when present",
    );
  }

  validateBase(i, errors);
  return { valid: errors.length === 0, errors };
}

// ─── Topic ───────────────────────────────────────────────────────────────

function validateTopic(t) {
  const errors = [];
  if (!isPlainObject(t))
    return { valid: false, errors: ["entity must be a plain object"] };

  pushIf(errors, t.type === ENTITY_TYPES.TOPIC, 'type must be "topic"');
  pushIf(errors, isNonEmptyString(t.name), "name must be a non-empty string");

  if (t.parentTopic !== undefined) {
    pushIf(
      errors,
      isString(t.parentTopic),
      "parentTopic must be a string when present",
    );
  }
  if (t.derivedFromEvents !== undefined) {
    pushIf(
      errors,
      isStringArray(t.derivedFromEvents),
      "derivedFromEvents must be string[] when present",
    );
  }

  validateBase(t, errors);
  return { valid: errors.length === 0, errors };
}

// ─── Generic dispatch ────────────────────────────────────────────────────

function validate(entity) {
  if (!isPlainObject(entity)) {
    return { valid: false, errors: ["entity must be a plain object"] };
  }
  switch (entity.type) {
    case ENTITY_TYPES.PERSON:
      return validatePerson(entity);
    case ENTITY_TYPES.EVENT:
      return validateEvent(entity);
    case ENTITY_TYPES.PLACE:
      return validatePlace(entity);
    case ENTITY_TYPES.ITEM:
      return validateItem(entity);
    case ENTITY_TYPES.TOPIC:
      return validateTopic(entity);
    default:
      return {
        valid: false,
        errors: [
          `unknown entity type: ${entity.type} (expected one of ${Object.values(ENTITY_TYPES).join("|")})`,
        ],
      };
  }
}

module.exports = {
  validate,
  validatePerson,
  validateEvent,
  validatePlace,
  validateItem,
  validateTopic,
};
