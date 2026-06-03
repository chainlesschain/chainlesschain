/**
 * Phase 8 — EntityResolver orchestrator.
 *
 * Per docs/design/Personal_Data_Hub_EntityResolver.md §3. Lifecycle:
 *
 *   adapter ingest → resolveOnIngest(batch)
 *     1. Sync rule stage on each new Person × all existing Persons in
 *        the same type bucket — same-identifier hits → mergePair immediately.
 *     2. Anything not "same" goes to resolve_queue for async processing.
 *
 *   Async worker (Phase 8.5) → drain()
 *     For each pending row: re-run rule stage (cheap), then call
 *     embeddingStage + llmStage if still uncertain.
 *
 * v0.1 ships only stage 1 (rule) wired up. embedding + LLM stages have
 * pluggable interfaces but throw "not configured" if you call drain()
 * without supplying them — that's the seam Phase 8.3 + 8.4 will fill.
 */

"use strict";

const { ruleStage } = require("./rule-stage");

class EntityResolver {
  constructor(opts = {}) {
    if (!opts || typeof opts !== "object") {
      throw new Error("EntityResolver: opts required");
    }
    if (!opts.vault) throw new Error("EntityResolver: opts.vault required");
    this.vault = opts.vault;

    // Pluggable stages — Phase 8.3 + 8.4 will fill these.
    this._embeddingStage = typeof opts.embeddingStage === "function" ? opts.embeddingStage : null;
    this._llmStage = typeof opts.llmStage === "function" ? opts.llmStage : null;

    // Tuning
    this._candidateLimit = Number.isFinite(opts.candidateLimit) ? opts.candidateLimit : 50;
    this._embeddingHighThreshold = Number.isFinite(opts.embeddingHighThreshold)
      ? opts.embeddingHighThreshold
      : 0.85;
    this._embeddingLowThreshold = Number.isFinite(opts.embeddingLowThreshold)
      ? opts.embeddingLowThreshold
      : 0.55;
  }

  /**
   * Phase 8.6 entry — called by AdapterRegistry after vault.putBatch.
   * Runs the synchronous rule stage against existing Persons in the
   * same type, immediately writes any "same" verdicts to merge_groups,
   * and enqueues the rest for async processing.
   *
   * Returns a summary { newPersons, sameImmediate, enqueued, errored }
   * for callers / audit.
   */
  resolveOnIngest(persons) {
    const summary = {
      newPersons: 0,
      sameImmediate: 0,
      differentImmediate: 0,
      enqueued: 0,
      errored: 0,
    };
    if (!Array.isArray(persons) || persons.length === 0) return summary;
    for (const p of persons) {
      summary.newPersons += 1;
      try {
        if (!p || typeof p !== "object" || !p.id) {
          throw new Error("invalid person object");
        }
        this._resolveSingle(p, summary);
      } catch (err) {
        summary.errored += 1;
        // Best-effort audit but don't break ingest
        try {
          this.vault.audit("entity-resolver.error", p.id || "?", {
            message: err && err.message ? err.message : String(err),
          });
        } catch (_e) {}
      }
    }
    return summary;
  }

  _resolveSingle(person, summary) {
    if (!person || !person.id) return;
    const candidates = this._findCandidates(person);
    if (candidates.length === 0) {
      // No candidates → still enqueue so future ingest of related rows
      // gets paired (the worker will skip when candidates list is empty)
      this.vault.enqueueResolve(person.id);
      summary.enqueued += 1;
      return;
    }

    let resolved = false;
    for (const cand of candidates) {
      // Skip if we already have a decision for this pair
      const existing = this.vault.getResolveDecision(person.id, cand.id);
      if (existing && existing.verdict === "same") {
        this.vault.mergePair({ aId: person.id, bId: cand.id, joinedBy: existing.decided_by });
        resolved = true;
        summary.sameImmediate += 1;
        continue;
      }
      if (existing && existing.verdict === "different") {
        summary.differentImmediate += 1;
        continue;
      }
      const r = ruleStage(person, cand);
      if (r.verdict === "same") {
        this.vault.recordResolveDecision({
          aId: person.id, bId: cand.id,
          verdict: "same", confidence: 1.0,
          decidedBy: "rule", reason: r.reason,
        });
        this.vault.mergePair({ aId: person.id, bId: cand.id, joinedBy: "rule" });
        summary.sameImmediate += 1;
        resolved = true;
      } else if (r.verdict === "different") {
        this.vault.recordResolveDecision({
          aId: person.id, bId: cand.id,
          verdict: "different", confidence: 1.0,
          decidedBy: "rule", reason: r.reason,
        });
        summary.differentImmediate += 1;
      }
      // "uncertain" → leave for the async pipeline
    }

    if (!resolved) {
      // We may still benefit from running embedding+LLM stages async
      this.vault.enqueueResolve(person.id);
      summary.enqueued += 1;
    }
  }

  /**
   * Find candidate Person rows that share at least one field with the
   * given person — used as the rule-stage candidate set. Returns up to
   * `_candidateLimit` rows, NOT including the person itself.
   *
   * Implementation: pulls all Persons (small for v0 — < 10k in target
   * vaults) and filters in memory. If vaults grow beyond 50k Persons,
   * switch to indexed-table queries (Phase 9+).
   */
  _findCandidates(person) {
    if (!this.vault || !person) return [];
    const allPersonsQ = this.vault._requireOpen().prepare(
      "SELECT id FROM persons WHERE id != ? LIMIT ?"
    );
    const rows = allPersonsQ.all(person.id, this._candidateLimit * 10);
    const fullPersons = rows
      .map((r) => this.vault.getPerson(r.id))
      .filter((p) => p && p.type === "person");

    // Quick filter — keep only Persons that share at least one
    // potentially-matching field (otherwise rule stage will return
    // "different" immediately and we waste a call).
    const persIds = new Set(toIdentifiers(person));
    const names = new Set((person.names || []).map((n) => String(n).toLowerCase()));
    const candidates = [];
    for (const cand of fullPersons) {
      const candIds = new Set(toIdentifiers(cand));
      const candNames = new Set((cand.names || []).map((n) => String(n).toLowerCase()));
      // Identifier overlap?
      let overlap = false;
      for (const v of candIds) {
        if (persIds.has(v)) { overlap = true; break; }
      }
      if (!overlap) {
        for (const n of candNames) {
          if (names.has(n)) { overlap = true; break; }
        }
      }
      if (overlap) candidates.push(cand);
      if (candidates.length >= this._candidateLimit) break;
    }
    return candidates;
  }

  /**
   * Phase 8.5 — async drain loop. Returns counts.
   * No-op when embeddingStage / llmStage aren't configured (Phase 8.2 ships
   * the seam only; later sub-phases fill the implementations).
   */
  async drain({ limit = 50 } = {}) {
    const out = { processed: 0, same: 0, different: 0, review: 0, error: 0, skipped: 0 };
    const batch = this.vault.claimResolveBatch(limit);
    if (batch.length === 0) return out;

    for (const queueRow of batch) {
      const personId = queueRow.person_id;
      try {
        const person = this.vault.getPerson(personId);
        if (!person) {
          // Person was deleted while in queue
          this.vault.completeResolve(queueRow.id);
          out.skipped += 1;
          continue;
        }
        const candidates = this._findCandidates(person);
        let anyDecision = false;
        for (const cand of candidates) {
          // Skip if rule stage already decided this pair (covered by
          // resolveOnIngest path) — listed here for defensive idempotence.
          const existing = this.vault.getResolveDecision(person.id, cand.id);
          if (existing) continue;
          const r = ruleStage(person, cand);
          if (r.verdict === "same") {
            this.vault.recordResolveDecision({
              aId: person.id, bId: cand.id,
              verdict: "same", confidence: 1.0,
              decidedBy: "rule", reason: r.reason,
            });
            this.vault.mergePair({ aId: person.id, bId: cand.id, joinedBy: "rule" });
            out.same += 1;
            anyDecision = true;
            continue;
          }
          if (r.verdict === "different") {
            this.vault.recordResolveDecision({
              aId: person.id, bId: cand.id,
              verdict: "different", confidence: 1.0,
              decidedBy: "rule", reason: r.reason,
            });
            out.different += 1;
            anyDecision = true;
            continue;
          }
          // "uncertain" — embedding stage
          if (this._embeddingStage) {
            const e = await this._embeddingStage(person, cand);
            if (e.sim >= this._embeddingHighThreshold) {
              this.vault.recordResolveDecision({
                aId: person.id, bId: cand.id,
                verdict: "same", confidence: e.sim,
                decidedBy: "embedding", reason: `cosine=${e.sim.toFixed(3)}`,
              });
              this.vault.mergePair({ aId: person.id, bId: cand.id, joinedBy: "embedding" });
              out.same += 1;
              anyDecision = true;
              continue;
            }
            if (e.sim < this._embeddingLowThreshold) {
              this.vault.recordResolveDecision({
                aId: person.id, bId: cand.id,
                verdict: "different", confidence: 1 - e.sim,
                decidedBy: "embedding", reason: `cosine=${e.sim.toFixed(3)}`,
              });
              out.different += 1;
              anyDecision = true;
              continue;
            }
            // Mid-range — LLM stage
            if (this._llmStage) {
              const v = await this._llmStage(person, cand);
              if (v.verdict === "yes" && v.confidence >= 0.7) {
                this.vault.recordResolveDecision({
                  aId: person.id, bId: cand.id,
                  verdict: "same", confidence: v.confidence,
                  decidedBy: "llm", reason: v.reason || "",
                });
                this.vault.mergePair({ aId: person.id, bId: cand.id, joinedBy: "llm" });
                out.same += 1;
                anyDecision = true;
              } else if (v.verdict === "no" && v.confidence >= 0.7) {
                this.vault.recordResolveDecision({
                  aId: person.id, bId: cand.id,
                  verdict: "different", confidence: v.confidence,
                  decidedBy: "llm", reason: v.reason || "",
                });
                out.different += 1;
                anyDecision = true;
              } else {
                this.vault.enqueueReview({
                  aId: person.id, bId: cand.id,
                  embedSim: e.sim,
                  llmVerdict: v.verdict || "maybe",
                  llmReason: v.reason || "",
                  llmConfidence: v.confidence || null,
                });
                out.review += 1;
                anyDecision = true;
              }
            } else {
              // No LLM stage configured — push to review for manual
              this.vault.enqueueReview({
                aId: person.id, bId: cand.id,
                embedSim: e.sim,
                llmVerdict: null,
                llmReason: "no LLM stage configured",
                llmConfidence: null,
              });
              out.review += 1;
              anyDecision = true;
            }
          }
          // No embedding stage configured at all → leave row pending for
          // a later worker run with stages wired
        }
        this.vault.completeResolve(queueRow.id);
        out.processed += 1;
        if (!anyDecision) out.skipped += 1;
      } catch (err) {
        this.vault.errorResolve(queueRow.id, err && err.message ? err.message : String(err));
        out.error += 1;
      }
    }
    return out;
  }

  /**
   * Record an explicit user decision from the UI review queue.
   */
  applyUserDecision({ reviewId, decision }) {
    const row = this.vault.recordReviewDecision({ reviewId, decision });
    if (decision === "same") {
      this.vault.recordResolveDecision({
        aId: row.a_person_id, bId: row.b_person_id,
        verdict: "same", confidence: 1.0,
        decidedBy: "user", reason: "user review queue",
      });
      this.vault.mergePair({
        aId: row.a_person_id, bId: row.b_person_id,
        joinedBy: "user",
      });
    } else if (decision === "different") {
      this.vault.recordResolveDecision({
        aId: row.a_person_id, bId: row.b_person_id,
        verdict: "different", confidence: 1.0,
        decidedBy: "user", reason: "user review queue",
      });
    }
    // "skip" leaves both tables untouched (just marks reviewed_at).
    return row;
  }

  /**
   * Manual merge (UI "mark same person" button) — bypasses pipeline.
   */
  manualMerge({ aId, bId }) {
    this.vault.recordResolveDecision({
      aId, bId, verdict: "same", confidence: 1.0,
      decidedBy: "user", reason: "manual merge",
    });
    return this.vault.mergePair({ aId, bId, joinedBy: "user" });
  }

  /**
   * Manual unmerge (UI "this person was added wrong") — also records a
   * "different" decision so the auto pipeline doesn't re-merge.
   */
  manualUnmerge(personId) {
    const members = this.vault.getMergeGroupMembers(personId);
    const r = this.vault.unmergePerson(personId);
    if (r.ok) {
      for (const otherId of members) {
        if (otherId === personId) continue;
        this.vault.recordResolveDecision({
          aId: personId, bId: otherId,
          verdict: "different", confidence: 1.0,
          decidedBy: "user", reason: "manual unmerge",
        });
      }
    }
    return r;
  }
}

function toIdentifiers(person) {
  const out = [];
  const ids = person.identifiers || {};
  for (const k of Object.keys(ids)) {
    const v = ids[k];
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === "string") out.push(x.toLowerCase().trim());
    } else if (typeof v === "string") {
      out.push(v.toLowerCase().trim());
    }
  }
  return out;
}

module.exports = { EntityResolver };
