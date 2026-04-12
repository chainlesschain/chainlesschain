/**
 * CLI Context Engineering — lightweight adapter for agent-repl.
 *
 * Integrates 5 context injectors (Instinct / Memory / BM25 Notes / Task Reminder / Permanent Memory)
 * with KV-Cache-friendly system prompt cleaning, importance-based compaction,
 * resumable compaction summaries, and stable prefix caching.
 *
 * Graceful degradation: works without DB (static prompt fallback).
 */

import { generateInstinctPrompt } from "./instinct-manager.js";
import { recallMemory } from "./hierarchical-memory.js";
import { BM25Search } from "./bm25-search.js";
import { createHash } from "crypto";
import { readUserProfile } from "./user-profile.js";

// Exported for test injection
export const _deps = {
  generateInstinctPrompt,
  recallMemory,
  BM25Search,
  createHash,
  readUserProfile,
};

// ─── System prompt cleaning regexes (match desktop KV-Cache optimization) ───
const CLEAN_PATTERNS = [
  {
    pattern: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ+-]*/g,
    replacement: "[DATE]",
  },
  {
    pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    replacement: "[UUID]",
  },
  { pattern: /session[-_]?[0-9a-f]{6,}/gi, replacement: "[SESSION]" },
  { pattern: /\b\d{10,13}\b/g, replacement: "[TIMESTAMP]" },
];

export class CLIContextEngineering {
  /**
   * @param {object} options
   * @param {object|null} options.db - Database instance (null for graceful degradation)
   * @param {object|null} options.permanentMemory - CLIPermanentMemory instance (optional)
   * @param {object|null} options.scope - Scoping options for sub-agent isolation
   * @param {string} [options.scope.taskId] - Task/sub-agent ID
   * @param {string} [options.scope.role] - Sub-agent role
   * @param {string} [options.scope.parentObjective] - Parent task objective
   */
  constructor({ db, permanentMemory, scope } = {}) {
    this.db = db || null;
    this.permanentMemory = permanentMemory || null;
    this.scope = scope || null;
    this.errorHistory = [];
    this.taskContext = null;
    this._bm25 = null;
    this._notesIndexed = false;
    // Resumable compaction: summaries of discarded message pairs
    this._compactionSummaries = [];
    // Stable prefix cache: { hash, cleanedPrefix }
    this._prefixCache = null;

    // When scoped, auto-set task context from scope
    if (this.scope && this.scope.parentObjective) {
      this.taskContext = {
        objective: this.scope.parentObjective,
        steps: [],
        currentStep: 0,
      };
    }
  }

  /**
   * Build optimized messages for LLM consumption.
   * Returns a new array (does not modify input).
   *
   * @param {Array} rawMessages - Original messages array
   * @param {object} options
   * @param {string} [options.userQuery] - Latest user query for relevance matching
   * @returns {Array} Optimized messages
   */
  buildOptimizedMessages(rawMessages, { userQuery } = {}) {
    const result = [];

    // 1. System prompt — clean dynamic content for KV-Cache stability
    let historyStart = 0;
    if (rawMessages.length > 0 && rawMessages[0].role === "system") {
      result.push({
        role: "system",
        content: this._cleanSystemPrompt(rawMessages[0].content),
      });
      historyStart = 1;
    }

    // 2. Instinct injection
    if (this.db) {
      try {
        const instinctPrompt = _deps.generateInstinctPrompt(this.db);
        if (instinctPrompt) {
          result.push({
            role: "system",
            content: `## Learned Preferences\n${instinctPrompt}`,
          });
        }
      } catch (_err) {
        // Instinct injection failed — skip silently
      }
    }

    // 2b. User profile injection (USER.md)
    try {
      const profile = _deps.readUserProfile();
      if (profile) {
        result.push({
          role: "system",
          content: `## User Profile\n${profile}`,
        });
      }
    } catch (_err) {
      // User profile injection failed — skip silently
    }

    // 3. Memory injection (scoped: higher threshold, namespace-aware)
    if (this.db && userQuery) {
      try {
        const memoryQuery = this.scope
          ? `[${this.scope.role}] ${userQuery}`
          : userQuery;
        const memoryOpts = { limit: 5 };
        if (this.scope) {
          memoryOpts.namespace = this.scope.taskId;
        }
        const memories = _deps.recallMemory(this.db, memoryQuery, memoryOpts);
        if (memories && memories.length > 0) {
          // When scoped, apply higher relevance threshold to reduce noise
          const threshold = this.scope ? 0.6 : 0.3;
          const filtered = memories.filter((m) => m.retention >= threshold);
          if (filtered.length > 0) {
            const lines = filtered.map(
              (m) =>
                `- [${m.layer}] ${m.content} (retention: ${(m.retention * 100).toFixed(0)}%)`,
            );
            result.push({
              role: "system",
              content: `## Relevant Memories\n${lines.join("\n")}`,
            });
          }
        }
      } catch (_err) {
        // Memory injection failed — skip silently
      }
    }

    // 4. Notes injection (BM25 search — scoped: role-prefixed query)
    if (this.db && userQuery) {
      try {
        this._ensureNotesIndex();
        if (this._bm25 && this._bm25.totalDocs > 0) {
          const notesQuery = this.scope
            ? `[${this.scope.role}] ${userQuery}`
            : userQuery;
          const hits = this._bm25.search(notesQuery, {
            topK: 3,
            threshold: 0.5,
          });
          if (hits.length > 0) {
            const lines = hits.map(
              (h) =>
                `- **${h.doc.title || "Untitled"}**: ${(h.doc.content || "").substring(0, 200)}`,
            );
            result.push({
              role: "system",
              content: `## Relevant Notes\n${lines.join("\n")}`,
            });
          }
        }
      } catch (_err) {
        // Notes injection failed — skip silently
      }
    }

    // 5. Permanent memory injection (scoped: reduced results)
    if (this.permanentMemory && userQuery) {
      try {
        const pmLimit = this.scope ? 2 : 3;
        const pmResults = this.permanentMemory.getRelevantContext(
          userQuery,
          pmLimit,
        );
        if (pmResults && pmResults.length > 0) {
          const lines = pmResults.map(
            (r) => `- [${r.source || "memory"}] ${r.content}`,
          );
          result.push({
            role: "system",
            content: `## Permanent Memory\n${lines.join("\n")}`,
          });
        }
      } catch (_err) {
        // Permanent memory injection failed — skip silently
      }
    }

    // 5b. Compaction summaries (resumable context from discarded messages)
    if (this._compactionSummaries.length > 0) {
      result.push({
        role: "system",
        content: `## Compacted Context Summary\n${this._compactionSummaries.join("\n")}`,
      });
    }

    // 6. Conversation history — clean metadata
    for (let i = historyStart; i < rawMessages.length; i++) {
      const msg = rawMessages[i];
      const cleaned = { role: msg.role };
      if (msg.content !== undefined) cleaned.content = msg.content;
      if (msg.tool_calls) cleaned.tool_calls = msg.tool_calls;
      if (msg.name) cleaned.name = msg.name;
      if (msg.tool_call_id) cleaned.tool_call_id = msg.tool_call_id;
      result.push(cleaned);
    }

    // 7. Error context
    if (this.errorHistory.length > 0) {
      const recent = this.errorHistory.slice(-5);
      const lines = recent.map(
        (e) =>
          `- [${e.step}] ${e.message}${e.resolution ? ` → Fixed: ${e.resolution}` : ""}`,
      );
      result.push({
        role: "system",
        content: `## Recent Errors\n${lines.join("\n")}\nAvoid repeating these mistakes.`,
      });
    }

    // 8. Task reminder
    if (this.taskContext) {
      const tc = this.taskContext;
      const stepLines = tc.steps
        ? tc.steps.map((s, i) => {
            const status =
              i < tc.currentStep
                ? "done"
                : i === tc.currentStep
                  ? "current"
                  : "pending";
            return `  ${status === "done" ? "✓" : status === "current" ? "→" : "○"} ${s}`;
          })
        : [];
      result.push({
        role: "system",
        content: [
          "## Current Task Status",
          `**Objective**: ${tc.objective}`,
          ...(stepLines.length > 0 ? ["**Progress**:", ...stepLines] : []),
          "Stay focused on this objective.",
        ].join("\n"),
      });
    }

    return result;
  }

  /**
   * Record an error for context injection.
   */
  recordError({ step, message, resolution }) {
    this.errorHistory.push({ step, message, resolution, time: Date.now() });
    if (this.errorHistory.length > 10) {
      this.errorHistory.shift();
    }
  }

  /**
   * Set current task objective and steps.
   */
  setTask(objective, steps = []) {
    this.taskContext = {
      objective,
      steps,
      currentStep: 0,
    };
  }

  /**
   * Update task progress.
   */
  updateTaskProgress(step, _status) {
    if (!this.taskContext) return;
    if (typeof step === "number") {
      this.taskContext.currentStep = step;
    } else {
      // Find step by name
      const idx = this.taskContext.steps.indexOf(step);
      if (idx >= 0) this.taskContext.currentStep = idx;
    }
  }

  /**
   * Clear current task.
   */
  clearTask() {
    this.taskContext = null;
  }

  /**
   * Importance-based smart compaction.
   * Keeps system prompt + top-scoring message pairs.
   *
   * @param {Array} messages - Full messages array
   * @param {object} options
   * @param {number} [options.keepPairs=6] - Number of user+assistant pairs to keep
   * @returns {Array} Compacted messages
   */
  smartCompact(messages, { keepPairs = 6 } = {}) {
    if (messages.length <= 3) return [...messages];

    // Always keep messages[0] (system prompt)
    const systemMsg = messages[0];
    const rest = messages.slice(1);

    // Group into user+assistant pairs (+ tool messages attached to assistant)
    const pairs = [];
    let currentPair = [];

    for (const msg of rest) {
      if (msg.role === "user" && currentPair.length > 0) {
        pairs.push(currentPair);
        currentPair = [];
      }
      currentPair.push(msg);
    }
    if (currentPair.length > 0) {
      pairs.push(currentPair);
    }

    if (pairs.length <= keepPairs) return [...messages];

    // Score each pair
    const scored = pairs.map((pair, idx) => {
      let score = 0;

      // Recency bonus (higher index = more recent)
      score += (idx / pairs.length) * 5;

      // Tool calls bonus
      if (pair.some((m) => m.tool_calls || m.role === "tool")) {
        score += 2;
      }

      // Task relevance bonus
      if (this.taskContext) {
        const objective = this.taskContext.objective.toLowerCase();
        if (
          pair.some(
            (m) => m.content && m.content.toLowerCase().includes(objective),
          )
        ) {
          score += 3;
        }
      }

      // Error context bonus
      if (pair.some((m) => m.content && m.content.includes("Error"))) {
        score += 1;
      }

      return { pair, score };
    });

    // Sort by score descending, keep top pairs
    scored.sort((a, b) => b.score - a.score);
    const kept = scored.slice(0, keepPairs);
    const discarded = scored.slice(keepPairs);

    // Generate one-line summaries for discarded pairs (resumable compaction)
    for (const { pair } of discarded) {
      const userMsg = pair.find((m) => m.role === "user");
      const assistantMsg = pair.find((m) => m.role === "assistant");
      if (userMsg && userMsg.content) {
        const topic = userMsg.content.substring(0, 80).replace(/\n/g, " ");
        const hadTools = pair.some((m) => m.tool_calls || m.role === "tool");
        const summary = hadTools
          ? `- Q: "${topic}" → [used tools] ${(assistantMsg?.content || "").substring(0, 60).replace(/\n/g, " ")}`
          : `- Q: "${topic}" → ${(assistantMsg?.content || "").substring(0, 80).replace(/\n/g, " ")}`;
        this._compactionSummaries.push(summary);
      }
    }
    // Cap summaries at 20
    if (this._compactionSummaries.length > 20) {
      this._compactionSummaries = this._compactionSummaries.slice(-20);
    }

    // Restore chronological order
    kept.sort((a, b) => pairs.indexOf(a.pair) - pairs.indexOf(b.pair));

    const result = [systemMsg];
    for (const { pair } of kept) {
      result.push(...pair);
    }

    return result;
  }

  /**
   * Get engine statistics.
   */
  getStats() {
    return {
      hasDb: !!this.db,
      hasPermanentMemory: !!this.permanentMemory,
      errorCount: this.errorHistory.length,
      hasTask: !!this.taskContext,
      notesIndexed: this._bm25 ? this._bm25.totalDocs : 0,
      compactionSummaries: this._compactionSummaries.length,
      prefixCached: !!this._prefixCache,
    };
  }

  /**
   * Clear compaction summaries.
   */
  clearCompactionSummaries() {
    this._compactionSummaries = [];
  }

  /**
   * Force reindex notes from DB.
   */
  reindexNotes() {
    this._notesIndexed = false;
    this._bm25 = null;
    this._ensureNotesIndex();
  }

  // ─── Internal ───────────────────────────────────────────────────

  _cleanSystemPrompt(content) {
    // Use stable prefix cache if available
    const prefix = this._computeStablePrefix(content);
    if (prefix) {
      // Only clean the dynamic suffix
      const suffix = content.slice(prefix.originalLength);
      let cleanedSuffix = suffix;
      for (const { pattern, replacement } of CLEAN_PATTERNS) {
        cleanedSuffix = cleanedSuffix.replace(pattern, replacement);
      }
      return prefix.cleaned + cleanedSuffix;
    }

    let cleaned = content;
    for (const { pattern, replacement } of CLEAN_PATTERNS) {
      cleaned = cleaned.replace(pattern, replacement);
    }
    return cleaned;
  }

  /**
   * Compute stable prefix — the portion of system prompt that doesn't change.
   * Caches the cleaned prefix so subsequent calls only re-clean the dynamic tail.
   */
  _computeStablePrefix(content) {
    if (!content || content.length < 100) return null;

    // Find the stable portion (before first dynamic pattern match)
    let firstMatchIdx = content.length;
    for (const { pattern } of CLEAN_PATTERNS) {
      // Use non-global copy to get .index
      const nonGlobal = new RegExp(
        pattern.source,
        pattern.flags.replace("g", ""),
      );
      const match = nonGlobal.exec(content);
      if (match && match.index < firstMatchIdx) {
        firstMatchIdx = match.index;
      }
    }

    // If no dynamic content found, or prefix too short, skip caching
    if (firstMatchIdx === content.length || firstMatchIdx < 50) return null;

    const rawPrefix = content.slice(0, firstMatchIdx);
    const hash = _deps
      .createHash("sha256")
      .update(rawPrefix)
      .digest("hex")
      .slice(0, 16);

    if (this._prefixCache && this._prefixCache.hash === hash) {
      return this._prefixCache;
    }

    // Clean and cache the prefix (should be stable, no dynamic patterns)
    let cleaned = rawPrefix;
    for (const { pattern, replacement } of CLEAN_PATTERNS) {
      cleaned = cleaned.replace(pattern, replacement);
    }

    this._prefixCache = { hash, cleaned, originalLength: firstMatchIdx };
    return this._prefixCache;
  }

  _ensureNotesIndex() {
    if (this._notesIndexed || !this.db) return;
    this._notesIndexed = true;

    try {
      const notes = this.db
        .prepare("SELECT id, title, content FROM notes LIMIT 500")
        .all();

      if (notes && notes.length > 0) {
        this._bm25 = new _deps.BM25Search();
        this._bm25.indexDocuments(notes);
      }
    } catch (_err) {
      // Notes table may not exist — skip
    }
  }
}
