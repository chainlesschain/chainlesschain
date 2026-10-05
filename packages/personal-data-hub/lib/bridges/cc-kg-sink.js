/**
 * CcKgSink — translates hub KG triples (subject/predicate/object|literal)
 * into ChainlessChain's existing knowledge-graph addEntity + addRelation API.
 *
 * Hub triples come in two shapes:
 *
 *   Object triples:   { subject: "evt-x", predicate: "by", object: "person-y" }
 *                     → addRelation(db, { sourceId, targetId, relationType })
 *
 *   Literal triples:  { subject: "evt-x", predicate: "subtype", literal: "order" }
 *                     → accumulate as entity properties at entity creation time
 *
 *   Special literal:  { subject: "evt-x", predicate: "rdf:type", literal: "event" }
 *                     → decides the cc entity type (Person / Event / Concept / ...)
 *
 * Hub's 5 entity kinds map onto cc's 7 with this convention:
 *
 *   hub      cc                  notes
 *   ─────    ────────            ──────
 *   person   Person              direct
 *   event    Event               direct
 *   place    Concept             with properties.hubKind = "place"
 *   item     Concept             with properties.hubKind = "item"
 *   topic    Concept             with properties.hubKind = "topic"
 *
 * Concept is used as a catch-all for hub kinds the cc KG doesn't natively
 * model. The original kind is preserved in properties.hubKind so future cc
 * KG schema upgrades (adding Place / Item / Topic) can re-classify.
 *
 * Like CcLLMAdapter, this bridge uses dependency injection — caller passes
 * addEntity + addRelation + db. The bridge has zero static knowledge of
 * the cc KG module path or module system.
 *
 * Two-pass algorithm:
 *
 *   Pass 1 — for every distinct subject:
 *     a. collect literal triples into a property bag + identify primary name
 *        (first `has-name` wins) + cc type from `rdf:type`
 *     b. addEntity(db, { id, name, type, properties }); an existing ID
 *        requires updateEntity. Failures remain visible for durable retry.
 *
 *   Pass 2 — for every object triple, addRelation. Skip if either endpoint
 *     wasn't seen in pass 1 (avoids dangling-relation errors from cc KG).
 *
 * Returns { entitiesUpserted, relationsAdded, errors[] } so the registry
 * can audit ingest stats.
 */

"use strict";

const { createHash } = require("node:crypto");
const RELATION_PREFIX = "pdh:";
const relationId = (triple) =>
  RELATION_PREFIX +
  createHash("sha256")
    .update(JSON.stringify([triple.subject, triple.predicate, triple.object]))
    .digest("hex");

const HUB_TO_CC_TYPE = Object.freeze({
  person: "Person",
  event: "Event",
  place: "Concept",
  item: "Concept",
  topic: "Concept",
});

const PROPERTY_TRIPLE_PREDICATES = new Set([
  "subtype",
  "occurred-at",
  "source",
  "amount-value",
  "amount-currency",
  "amount-direction",
  "address",
  "category",
  "located-at",
  "priced-at",
  "has-alias",
  "relation",
]);
// `id:<kind>` predicate is handled separately (variable suffix)

const OBJECT_TRIPLE_PREDICATES = new Set([
  "by",
  "involves",
  "happened-at",
  "about",
  "topic",
  "sold-by",
  "parent",
  "derived-from",
]);

class CcKgSink {
  /**
   * @param {object} deps
   * @param {(db: object, config: object) => object} deps.addEntity   cc addEntity
   * @param {(db: object, config: object) => object} deps.addRelation cc addRelation
   * @param {(db: object, id: string, config: object) => object} [deps.updateEntity]
   * @param {(id: string) => object|null} [deps.getEntity] cross-batch lookup
   * @param {(db: object, id: string) => boolean} [deps.removeEntity] idempotent cascade removal
   * @param {(opts: object) => object[]} [deps.listRelations] complete source-edge lookup
   * @param {(db: object, id: string) => boolean} [deps.removeRelation] idempotent removal
   * @param {object} [deps.db]                                         cc db handle (forwarded)
   * @param {(label: string, ...args: any[]) => void} [deps.logger]    optional logger for non-fatal errors
   */
  constructor(deps) {
    if (!deps || typeof deps !== "object") {
      throw new Error("CcKgSink: deps required");
    }
    if (typeof deps.addEntity !== "function") {
      throw new Error("CcKgSink: deps.addEntity(db, config) required");
    }
    if (typeof deps.addRelation !== "function") {
      throw new Error("CcKgSink: deps.addRelation(db, config) required");
    }
    this._addEntity = deps.addEntity;
    this._addRelation = deps.addRelation;
    this._updateEntity = deps.updateEntity;
    this._getEntity = deps.getEntity;
    this._removeEntity = deps.removeEntity;
    this._listRelations = deps.listRelations;
    this._removeRelation = deps.removeRelation;
    this._db = deps.db || null;
    this._log = typeof deps.logger === "function" ? deps.logger : null;
    this._seenEntities = new Set(); // de-dup across calls within process lifetime
    this._pending = Promise.resolve();
  }

  /**
   * Bound method used as the registry kgSink callback:
   *   const sink = new CcKgSink({ ... });
   *   new AdapterRegistry({ vault, kgSink: sink.write.bind(sink) });
   */
  write(triples, { referenceSubjects = [] } = {}) {
    // The registry may include referenced endpoints' full literal properties
    // so a one-entity delivery can create its edges before other jobs run.
    // Those endpoints' outgoing edges belong to their own delivery.
    const references = new Set(referenceSubjects);
    const pending = this._pending.then(() => this._write(triples, references));
    this._pending = pending.catch(() => {});
    return pending;
  }

  remove(ids) {
    const pending = this._pending.then(() => this._remove(ids));
    this._pending = pending.catch(() => {});
    return pending;
  }

  async _remove(ids) {
    const errors = [];
    let removed = 0;
    const unique = new Set(Array.isArray(ids) ? ids : []);
    for (const id of unique) {
      if (typeof id !== "string" || !id.trim()) continue;
      try {
        if (typeof this._removeEntity !== "function") {
          throw new Error(
            "KG entity removal unsupported: removeEntity required",
          );
        }
        // The adapter cascades relationships and is idempotent for absent IDs.
        await this._removeEntity(this._db, id);
        this._seenEntities.delete(id);
        removed += 1;
      } catch (err) {
        errors.push({
          kind: "entity",
          subject: id,
          error: err.message || String(err),
        });
      }
    }
    return { removed, errors };
  }

  async _write(triples, referenceSubjects = new Set()) {
    if (!Array.isArray(triples) || triples.length === 0) {
      return { entitiesUpserted: 0, relationsAdded: 0, errors: [] };
    }

    // ─── Group triples by subject ─────────────────────────────────────
    const bySubject = new Map();
    const objectTriples = [];
    for (const t of triples) {
      if (!t || !t.subject || !t.predicate) continue;
      if (typeof t.object === "string") {
        objectTriples.push(t);
        continue;
      }
      if (!bySubject.has(t.subject)) bySubject.set(t.subject, []);
      bySubject.get(t.subject).push(t);
    }

    const errors = [];
    let entitiesUpserted = 0;
    let relationsAdded = 0;
    const subjectsCreated = new Set();
    const subjectsUpdated = new Set();

    // ─── Pass 1: upsert entities ──────────────────────────────────────
    for (const [subject, subTriples] of bySubject.entries()) {
      let hubType = null;
      let primaryName = null;
      const aliases = [];
      const properties = {};

      for (const t of subTriples) {
        const pred = t.predicate;
        const lit = t.literal;
        if (pred === "rdf:type") {
          hubType = typeof lit === "string" ? lit : null;
          continue;
        }
        if (pred === "has-name") {
          if (primaryName == null) primaryName = String(lit);
          else aliases.push(String(lit));
          continue;
        }
        if (pred === "has-alias") {
          aliases.push(String(lit));
          continue;
        }
        if (pred.startsWith("id:")) {
          properties[pred] = lit;
          continue;
        }
        if (PROPERTY_TRIPLE_PREDICATES.has(pred)) {
          // Some predicates can repeat (e.g. multiple aliases via separate triples).
          // Stash as array if duplicate.
          if (properties[pred] === undefined) {
            properties[pred] = lit;
          } else if (Array.isArray(properties[pred])) {
            properties[pred].push(lit);
          } else {
            properties[pred] = [properties[pred], lit];
          }
          continue;
        }
        // Unknown predicate — preserve under a `__extra` namespace.
        if (!properties.__extra) properties.__extra = {};
        properties.__extra[pred] = lit;
      }

      const ccType = HUB_TO_CC_TYPE[hubType] || "Concept";
      properties.hubKind = hubType || "unknown";
      if (aliases.length > 0) properties.aliases = aliases;
      const name = primaryName || subject; // fallback: id as name

      try {
        const config = {
          id: subject,
          name,
          type: ccType,
          properties,
        };
        try {
          await this._addEntity(this._db, config);
        } catch (err) {
          if (!/already exists/i.test(err.message || String(err))) throw err;
          if (typeof this._updateEntity !== "function") {
            throw new Error(
              "KG entity update unsupported: updateEntity required",
            );
          }
          await this._updateEntity(this._db, subject, config);
          subjectsUpdated.add(subject);
        }
        entitiesUpserted += 1;
        this._seenEntities.add(subject);
        subjectsCreated.add(subject);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        errors.push({ kind: "entity", subject, error: msg });
        if (this._log) this._log("CcKgSink.addEntity failed", subject, msg);
      }
    }

    // Full entity snapshots replace their owned outgoing edges. Removing only
    // PDH edge IDs preserves manually authored and incoming relationships.
    for (const subject of subjectsCreated) {
      if (referenceSubjects.has(subject)) continue;
      if (!bySubject.get(subject).some((t) => t.predicate === "rdf:type"))
        continue;
      try {
        if (typeof this._listRelations !== "function") {
          if (subjectsUpdated.has(subject)) {
            throw new Error(
              "KG relation reconciliation unsupported: listRelations required",
            );
          }
          continue;
        }
        const desired = new Set(
          objectTriples.filter((t) => t.subject === subject).map(relationId),
        );
        const existing = await this._listRelations({
          sourceId: subject,
          limit: Number.MAX_SAFE_INTEGER,
        });
        for (const edge of existing) {
          if (!edge.id.startsWith(RELATION_PREFIX) || desired.has(edge.id))
            continue;
          if (typeof this._removeRelation !== "function") {
            throw new Error(
              "KG relation removal unsupported: removeRelation required",
            );
          }
          await this._removeRelation(this._db, edge.id);
        }
      } catch (err) {
        errors.push({
          kind: "relation",
          subject,
          error: err.message || String(err),
        });
      }
    }

    // ─── Pass 2: add relations ────────────────────────────────────────
    for (const t of objectTriples) {
      if (!OBJECT_TRIPLE_PREDICATES.has(t.predicate)) {
        // Unknown predicate — record for telemetry; cc KG would reject anyway.
        errors.push({
          kind: "relation",
          subject: t.subject,
          predicate: t.predicate,
          error: "unknown predicate",
        });
        continue;
      }
      // cc requires both endpoints already in the KG. Best-effort: if not
      // in this batch's subjectsCreated AND not in the long-lived _seenEntities,
      // skip with a warning. (Cross-batch references should be rare in
      // practice — KG ingest is per-batch from same sync.)
      const hasEndpoint = async (id) =>
        this._seenEntities.has(id) ||
        (typeof this._getEntity === "function" &&
          !!(await this._getEntity(id)));
      if (!(await hasEndpoint(t.subject)) || !(await hasEndpoint(t.object))) {
        errors.push({
          kind: "relation",
          subject: t.subject,
          target: t.object,
          predicate: t.predicate,
          error: "endpoint not in KG",
        });
        continue;
      }
      try {
        await this._addRelation(this._db, {
          id: relationId(t),
          sourceId: t.subject,
          targetId: t.object,
          relationType: t.predicate,
        });
        relationsAdded += 1;
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        // Tolerate "already exists" if cc throws it.
        if (/already exists|duplicate/i.test(msg)) continue;
        errors.push({
          kind: "relation",
          subject: t.subject,
          target: t.object,
          predicate: t.predicate,
          error: msg,
        });
        if (this._log)
          this._log("CcKgSink.addRelation failed", t.subject, t.object, msg);
      }
    }

    return { entitiesUpserted, relationsAdded, errors };
  }
}

module.exports = { CcKgSink, HUB_TO_CC_TYPE };
