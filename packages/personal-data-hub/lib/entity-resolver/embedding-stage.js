/**
 * Phase 8.3 — embedding stage.
 *
 * Pluggable function that takes two Person rows + returns
 * `{ sim, profileA, profileB }` where `sim` is a cosine similarity in
 * [0, 1]. Caller (EntityResolver.drain) uses thresholds to decide
 * auto-same / auto-different / "send to LLM stage".
 *
 * Profile encoding (per design doc §4.2):
 *   "{type}: {primary_name} | aliases: {a1, a2} | identifiers: {phone,
 *    email} | recent: {top-3 event titles}"
 *
 * Embedding backend: Ollama HTTP API by default (compatible with
 * `nomic-embed-text` / `bge-m3` / `bge-large-zh`). Caller can inject any
 * `embedFn: async (text) => Float32Array | number[]` via opts.
 *
 * Privacy: same gate as AnalysisEngine — local Ollama default, accept-
 * NonLocal flag required for hosted. Phase 8.4 LLM stage carries the
 * same invariant; this module is dumb to that and trusts caller.
 */

"use strict";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_MODEL = "nomic-embed-text";

class EmbeddingStage {
  constructor(opts = {}) {
    if (!opts || typeof opts !== "object") {
      throw new Error("EmbeddingStage: opts required");
    }
    this._embedFn = typeof opts.embedFn === "function" ? opts.embedFn : null;
    this._ollamaUrl = typeof opts.ollamaUrl === "string" && opts.ollamaUrl.length > 0
      ? opts.ollamaUrl
      : DEFAULT_OLLAMA_URL;
    this._model = typeof opts.model === "string" && opts.model.length > 0
      ? opts.model
      : DEFAULT_MODEL;
    // Caller-supplied vault lets us pull recent events for richer profiles
    // (per design doc §4.2 — "recent: top-3 event titles"). Optional.
    this._vault = opts.vault || null;
    // LRU-ish in-memory cache: personId → embedding. Cheap perf win for
    // re-using the same person across many pair comparisons in one drain.
    this._cache = new Map();
    this._cacheMaxSize = Number.isFinite(opts.cacheMaxSize) ? opts.cacheMaxSize : 1000;
  }

  /**
   * The function EntityResolver.drain expects.
   * Signature: `async (a, b) => { sim, profileA, profileB }`
   */
  async compare(a, b) {
    const [vecA, profileA] = await this._embedPerson(a);
    const [vecB, profileB] = await this._embedPerson(b);
    const sim = cosineSimilarity(vecA, vecB);
    return { sim, profileA, profileB };
  }

  /**
   * Returns a stage function bound to this instance, suitable for passing
   * as `opts.embeddingStage` to EntityResolver.
   */
  asStageFn() {
    return (a, b) => this.compare(a, b);
  }

  async _embedPerson(person) {
    if (!person || !person.id) throw new Error("EmbeddingStage: person required");
    const profile = this.buildProfile(person);
    if (this._cache.has(person.id)) {
      return [this._cache.get(person.id), profile];
    }
    const vec = await this._embed(profile);
    if (!Array.isArray(vec) && !(vec instanceof Float32Array)) {
      throw new Error("EmbeddingStage: embedFn must return Array<number> or Float32Array");
    }
    if (this._cache.size >= this._cacheMaxSize) {
      // FIFO eviction
      const first = this._cache.keys().next().value;
      if (first !== undefined) this._cache.delete(first);
    }
    this._cache.set(person.id, vec);
    return [vec, profile];
  }

  /**
   * Build the textual profile that gets embedded. Public for tests +
   * for callers that want to feed the same string to LLM stage.
   */
  buildProfile(person) {
    const parts = [];
    parts.push(`${person.type || "person"}: ${(person.names && person.names[0]) || "(unknown)"}`);
    if (person.names && person.names.length > 1) {
      parts.push(`aliases: ${person.names.slice(1).join(", ")}`);
    }
    const ids = person.identifiers || {};
    const idStrs = [];
    for (const key of Object.keys(ids)) {
      const v = ids[key];
      if (Array.isArray(v)) {
        for (const x of v) idStrs.push(`${key}:${x}`);
      } else if (typeof v === "string") {
        idStrs.push(`${key}:${v}`);
      }
    }
    if (idStrs.length > 0) {
      parts.push(`identifiers: ${idStrs.join(", ")}`);
    }
    if (this._vault) {
      try {
        const recent = this._recentEvents(person.id, 3);
        if (recent.length > 0) {
          parts.push(`recent: ${recent.map((e) => e.content?.title || "(no title)").join("; ")}`);
        }
      } catch (_e) {
        // Vault read failure is non-fatal — embedding still works without events
      }
    }
    return parts.join(" | ");
  }

  _recentEvents(personId, limit) {
    if (!this._vault || typeof this._vault.queryEvents !== "function") return [];
    // Pull events where this person is actor or participant
    const events = this._vault.queryEvents({ actor: personId, limit });
    return Array.isArray(events) ? events : [];
  }

  async _embed(text) {
    if (this._embedFn) return this._embedFn(text);
    // Default backend: Ollama HTTP API
    return await ollamaEmbed(this._ollamaUrl, this._model, text);
  }

  /** Clear the embedding cache (e.g. after batch). */
  clearCache() {
    this._cache.clear();
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

/**
 * Cosine similarity ∈ [-1, 1], clamped to [0, 1] for embeddings (they
 * tend to live in non-negative space but we don't trust that).
 */
function cosineSimilarity(a, b) {
  if (!a || !b) return 0;
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  // Clamp to [0, 1] for the threshold-comparison call site
  return Math.max(0, Math.min(1, sim));
}

/**
 * Call Ollama's /api/embeddings endpoint. Throws on failure; caller
 * (EntityResolver.drain → errorResolve) handles retry-vs-fatal.
 */
async function ollamaEmbed(baseUrl, model, text) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/embeddings`;
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
  } catch (err) {
    throw new Error(`Ollama embed call failed (${url}): ${err && err.message ? err.message : err}`);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Ollama embed returned ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  if (!data || !Array.isArray(data.embedding)) {
    throw new Error(`Ollama embed response missing 'embedding' array`);
  }
  return data.embedding;
}

module.exports = {
  EmbeddingStage,
  cosineSimilarity,
  ollamaEmbed,
};
