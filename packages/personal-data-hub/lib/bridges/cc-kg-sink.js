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
 *     b. addEntity(db, { id, name, type, properties }) — caller's addEntity
 *        must be idempotent on duplicate id (the cc impl throws "already
 *        exists"; we catch that and treat as upsert)
 *
 *   Pass 2 — for every object triple, addRelation. Skip if either endpoint
 *     wasn't seen in pass 1 (avoids dangling-relation errors from cc KG).
 *
 * Returns { entitiesUpserted, relationsAdded, errors[] } so the registry
 * can audit ingest stats.
 */

"use strict";

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
    this._db = deps.db || null;
    this._log = typeof deps.logger === "function" ? deps.logger : null;
    this._seenEntities = new Set(); // de-dup across calls within process lifetime
  }

  /**
   * Bound method used as the registry kgSink callback:
   *   const sink = new CcKgSink({ ... });
   *   new AdapterRegistry({ vault, kgSink: sink.write.bind(sink) });
   */
  async write(triples) {
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
        this._addEntity(this._db, {
          id: subject,
          name,
          type: ccType,
          properties,
        });
        entitiesUpserted += 1;
        this._seenEntities.add(subject);
        subjectsCreated.add(subject);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        // cc throws "Entity already exists" — treat as success (upsert semantics).
        if (/already exists/i.test(msg)) {
          this._seenEntities.add(subject);
          subjectsCreated.add(subject);
          continue;
        }
        errors.push({ kind: "entity", subject, error: msg });
        if (this._log) this._log("CcKgSink.addEntity failed", subject, msg);
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
      if (!this._seenEntities.has(t.subject) || !this._seenEntities.has(t.object)) {
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
        this._addRelation(this._db, {
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
        if (this._log) this._log("CcKgSink.addRelation failed", t.subject, t.object, msg);
      }
    }

    return { entitiesUpserted, relationsAdded, errors };
  }
}

module.exports = { CcKgSink, HUB_TO_CC_TYPE };
