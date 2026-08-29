import { randomUUID } from "node:crypto";
import {
  canonicalDigest,
  createMemoryCandidate,
  normalizeMemoryRecord,
} from "@chainlesschain/context-memory-kernel";
import { createCliContextMemoryRuntime } from "./runtime.js";

function safeIdentifier(value, fallback = "general") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._:/-]+/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, 160);
  return /^[A-Za-z0-9]/u.test(normalized) ? normalized : fallback;
}

function normalizedImportance(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.6;
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 5 : parsed));
}

function validTimestamp(value, fallback) {
  const epoch =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : fallback;
}

const VALID_SCOPES = new Set([
  "turn",
  "session",
  "agent",
  "project",
  "user",
  "global",
]);

function normalizedScope(scope, scopeId) {
  const value = String(scope || "").trim();
  if (!VALID_SCOPES.has(value)) {
    throw new TypeError(`invalid memory scope: ${value || "missing"}`);
  }
  if (value === "global") {
    if (scopeId != null && String(scopeId).trim()) {
      throw new TypeError("global memory scope must not include scopeId");
    }
    return { scope: value };
  }
  const normalizedId = safeIdentifier(scopeId, "");
  if (!normalizedId) throw new TypeError(`scopeId is required for ${value} scope`);
  return { scope: value, scopeId: normalizedId };
}

function normalizedTags(tags) {
  const values = Array.isArray(tags) ? tags : [];
  return [...new Set(values.map((tag) => String(tag).trim()).filter(Boolean))]
    .slice(0, 128)
    .map((tag) => tag.slice(0, 128));
}

function legacyMemoryId(entry) {
  const digest = canonicalDigest(
    { id: String(entry?.id || ""), content: String(entry?.content || "") },
    "chainlesschain.cli-legacy-memory/v1",
  );
  return `legacy-${digest.slice(7, 39)}`;
}

function legacyProposal(entry, now) {
  const memoryId = legacyMemoryId(entry);
  const observedAt = validTimestamp(entry?.created_at, now);
  return {
    memoryId,
    scope: "user",
    scopeId: "local-user",
    category: safeIdentifier(entry?.category, "general"),
    content: String(entry?.content || "").trim(),
    provenance: {
      source: "cli-sqlite-memory",
      actor: "legacy-cli",
      observedAt,
    },
    evidenceRefs: [
      {
        store: "cli-sqlite-memory-entries",
        id: safeIdentifier(entry?.id, memoryId),
        digest: canonicalDigest(entry, "chainlesschain.cli-legacy-memory-row/v1"),
      },
    ],
    confidence: 0.7,
    importance: normalizedImportance(entry?.importance),
    tags: ["migrated", "legacy-cli"],
    sensitivity: "personal",
    allowedSinks: ["*"],
    retentionPolicy: { mode: "durable" },
    activate: true,
    createdAt: observedAt,
  };
}

function publicEntry(record, relevance) {
  return {
    id: record.memoryId,
    content: record.content,
    category: record.category,
    importance: Math.max(1, Math.min(5, Math.round(record.importance * 5))),
    source: record.provenance.source,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    scope: record.scope,
    ...(record.scopeId ? { scope_id: record.scopeId } : {}),
    state: record.state,
    revision: record.revision,
    digest: record.digest,
    ...(relevance === undefined ? {} : { relevance }),
  };
}

function publicScopedEntry(record, relevance) {
  return {
    id: record.memoryId,
    scope: record.scope,
    scopeId: record.scopeId || null,
    category: record.category,
    content: record.content,
    tags: [...record.tags],
    score: record.importance,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    accessedAt: record.lastAccessedAt || record.updatedAt,
    state: record.state,
    revision: record.revision,
    digest: record.digest,
    ...(relevance === undefined ? {} : { relevance }),
  };
}

function legacyScopedProposal(entry, now) {
  const scope = normalizedScope(entry?.scope, entry?.scopeId);
  const memoryId = `legacy-scoped-${canonicalDigest(
    {
      id: String(entry?.id || ""),
      scope,
      content: String(entry?.content || ""),
    },
    "chainlesschain.cli-legacy-scoped-memory/v1",
  ).slice(7, 39)}`;
  const observedAt = validTimestamp(entry?.createdAt, now);
  return {
    memoryId,
    ...scope,
    category: safeIdentifier(entry?.category, "general"),
    content: String(entry?.content || "").trim(),
    provenance: {
      source: "cli-session-core-memory",
      actor: "legacy-cli",
      observedAt,
    },
    evidenceRefs: [
      {
        store: "cli-session-core-memory-store",
        id: safeIdentifier(entry?.id, memoryId),
        digest: canonicalDigest(
          entry,
          "chainlesschain.cli-legacy-scoped-memory-row/v1",
        ),
      },
    ],
    confidence: 0.7,
    importance: normalizedImportance(entry?.score),
    tags: normalizedTags([
      ...(Array.isArray(entry?.tags) ? entry.tags : []),
      "migrated",
      "legacy-session-core",
    ]),
    sensitivity: "personal",
    allowedSinks: ["*"],
    retentionPolicy: { mode: "durable" },
    activate: true,
    createdAt: observedAt,
  };
}

export class CliCanonicalMemoryService {
  constructor(options = {}) {
    this.runtime = options.runtime || createCliContextMemoryRuntime(options);
    this.now = options.clock || Date.now;
  }

  get decision() {
    return this.runtime.decision;
  }

  validateLegacyProposal(content, options = {}) {
    const now = new Date(Number(this.now())).toISOString();
    return createMemoryCandidate(
      {
        memoryId: `shadow-${canonicalDigest(
          { content, category: options.category || "general" },
          "chainlesschain.cli-shadow-memory/v1",
        ).slice(7, 39)}`,
        scope: "user",
        scopeId: "local-user",
        category: safeIdentifier(options.category, "general"),
        content,
        provenance: { source: "cli-shadow", actor: "local-user", observedAt: now },
        evidenceRefs: [{ store: "cli-command", id: "shadow-memory-add" }],
        confidence: 0.7,
        importance: normalizedImportance(options.importance),
        tags: ["shadow"],
        sensitivity: "personal",
        allowedSinks: ["*"],
        retentionPolicy: { mode: "durable" },
        activate: true,
        createdAt: now,
      },
      { clock: this.now },
    );
  }

  async dryRunLegacyMigration({ entries = [], scopedEntries = [] } = {}) {
    const before = await this.runtime.memoryPort.getRevision();
    const now = new Date(Number(this.now())).toISOString();
    const sources = [
      ...(Array.isArray(entries) ? entries : []).map((entry) => ({
        kind: "cli-sqlite-memory",
        sourceId: safeIdentifier(entry?.id, "unknown"),
        proposal: () => legacyProposal(entry, now),
      })),
      ...(Array.isArray(scopedEntries) ? scopedEntries : []).map((entry) => ({
        kind: "cli-session-core-memory",
        sourceId: safeIdentifier(entry?.id, "unknown"),
        proposal: () => legacyScopedProposal(entry, now),
      })),
    ];
    const report = {
      schema: "chainlesschain.cli-context-memory-migration-dry-run/v1",
      schemaVersion: 1,
      status: "ready",
      scanned: sources.length,
      wouldMigrate: 0,
      existing: 0,
      conflicts: 0,
      invalid: 0,
      findings: [],
      authorityRevisionBefore: before,
      authorityRevisionAfter: before,
    };
    const bindings = [];
    for (const source of sources) {
      try {
        const proposal = source.proposal();
        const candidate = createMemoryCandidate(proposal, { clock: this.now });
        const existing = await this.runtime.memoryPort.read(candidate.memoryId);
        const disposition = !existing
          ? "would_migrate"
          : existing.digest === candidate.digest
            ? "existing"
            : "conflict";
        if (disposition === "would_migrate") report.wouldMigrate += 1;
        else if (disposition === "existing") report.existing += 1;
        else report.conflicts += 1;
        report.findings.push({
          kind: source.kind,
          sourceId: source.sourceId,
          memoryId: candidate.memoryId,
          disposition,
          recordDigest: candidate.digest,
        });
        bindings.push({
          kind: source.kind,
          sourceId: source.sourceId,
          memoryId: candidate.memoryId,
          recordDigest: candidate.digest,
        });
      } catch (error) {
        report.invalid += 1;
        report.findings.push({
          kind: source.kind,
          sourceId: source.sourceId,
          disposition: "invalid",
          code: error?.code || "invalid_argument",
        });
      }
    }
    const after = await this.runtime.memoryPort.getRevision();
    report.authorityRevisionAfter = after;
    if (after !== before) {
      const error = new Error("migration dry-run mutated canonical authority");
      error.code = "CONTEXT_MEMORY_MIGRATION_DRY_RUN_MUTATED";
      throw error;
    }
    if (report.conflicts > 0 || report.invalid > 0) report.status = "blocked";
    report.inputDigest = canonicalDigest(
      bindings,
      "chainlesschain.cli-context-memory-migration-input/v1",
    );
    report.digest = canonicalDigest(
      report,
      "chainlesschain.cli-context-memory-migration-dry-run/v1",
    );
    return report;
  }

  async migrateLegacyEntries(entries) {
    if (!this.decision.canonical) {
      return { migrated: 0, existing: 0, failed: 0, failures: [] };
    }
    const result = { migrated: 0, existing: 0, failed: 0, failures: [] };
    const now = new Date(Number(this.now())).toISOString();
    for (const entry of Array.isArray(entries) ? entries : []) {
      try {
        const proposal = legacyProposal(entry, now);
        const existing = await this.runtime.memoryPort.read(proposal.memoryId);
        if (existing) {
          const projected = createMemoryCandidate(proposal, { clock: this.now });
          if (existing.digest !== projected.digest) {
            const error = new Error(
              `legacy memory ${entry?.id || "unknown"} conflicts with canonical authority`,
            );
            error.code = "CONTEXT_MEMORY_MIGRATION_CONFLICT";
            throw error;
          }
          result.existing += 1;
          continue;
        }
        await this.runtime.kernel.proposeMemory(proposal);
        result.migrated += 1;
      } catch (error) {
        result.failed += 1;
        result.failures.push({
          id: String(entry?.id || "unknown").slice(0, 160),
          code: error?.code || "migration_failed",
          message: error?.message || String(error),
        });
      }
    }
    if (result.failed > 0) {
      const error = new Error("legacy memory migration did not fully converge");
      error.code = "CONTEXT_MEMORY_MIGRATION_INCOMPLETE";
      error.result = result;
      throw error;
    }
    return result;
  }

  async migrateLegacyScopedEntries(entries) {
    if (!this.decision.canonical) {
      return { migrated: 0, existing: 0, failed: 0, failures: [] };
    }
    const result = { migrated: 0, existing: 0, failed: 0, failures: [] };
    const now = new Date(Number(this.now())).toISOString();
    for (const entry of Array.isArray(entries) ? entries : []) {
      try {
        const proposal = legacyScopedProposal(entry, now);
        const existing = await this.runtime.memoryPort.read(proposal.memoryId);
        if (existing) {
          const projected = createMemoryCandidate(proposal, { clock: this.now });
          if (existing.digest !== projected.digest) {
            const error = new Error(
              `legacy scoped memory ${entry?.id || "unknown"} conflicts with canonical authority`,
            );
            error.code = "CONTEXT_MEMORY_MIGRATION_CONFLICT";
            throw error;
          }
          result.existing += 1;
          continue;
        }
        await this.runtime.kernel.proposeMemory(proposal);
        result.migrated += 1;
      } catch (error) {
        result.failed += 1;
        result.failures.push({
          id: String(entry?.id || "unknown").slice(0, 160),
          code: error?.code || "migration_failed",
          message: error?.message || String(error),
        });
      }
    }
    if (result.failed > 0) {
      const error = new Error(
        "legacy scoped memory migration did not fully converge",
      );
      error.code = "CONTEXT_MEMORY_MIGRATION_INCOMPLETE";
      error.result = result;
      throw error;
    }
    return result;
  }

  async list({ limit = 20, category } = {}) {
    const records = await this.runtime.memoryPort.listRecords();
    return records
      .filter((record) => !category || record.category === category)
      .slice(0, Math.max(1, Number(limit) || 20))
      .map((record) => publicEntry(record));
  }

  async add(content, options = {}) {
    const now = new Date(Number(this.now())).toISOString();
    const evidenceId = `add-${canonicalDigest(
      { content, category: options.category || "general", now },
      "chainlesschain.cli-memory-add/v1",
    ).slice(7, 39)}`;
    const mutation = await this.runtime.kernel.proposeMemory({
      scope: "user",
      scopeId: "local-user",
      category: safeIdentifier(options.category, "general"),
      content,
      provenance: { source: "cli", actor: "local-user", observedAt: now },
      evidenceRefs: [{ store: "cli-command", id: evidenceId }],
      confidence: 0.8,
      importance: normalizedImportance(options.importance),
      tags: ["cli"],
      sensitivity: "personal",
      allowedSinks: ["*"],
      retentionPolicy: { mode: "durable" },
      activate: true,
      createdAt: now,
    });
    return { ...publicEntry(mutation.record), receipt: mutation.receipt };
  }

  validateLegacyScopedProposal(content, options = {}) {
    return createMemoryCandidate(
      this._scopedProposal(content, { ...options, source: "cli-shadow" }),
      { clock: this.now },
    );
  }

  _scopedProposal(content, options = {}) {
    const now = validTimestamp(
      options.createdAt || options.observedAt,
      new Date(Number(this.now())).toISOString(),
    );
    const scope = normalizedScope(options.scope, options.scopeId);
    const evidenceId = `scoped-${canonicalDigest(
      { content, scope, category: options.category || "general", now },
      "chainlesschain.cli-scoped-memory-add/v1",
    ).slice(7, 39)}`;
    return {
      ...(options.memoryId
        ? { memoryId: safeIdentifier(options.memoryId, "") }
        : {}),
      ...scope,
      category: safeIdentifier(options.category, "general"),
      content,
      provenance: {
        source: safeIdentifier(options.source, "cli-scoped-memory"),
        actor: safeIdentifier(options.actor, "local-user"),
        observedAt: now,
      },
      evidenceRefs: [
        {
          store: safeIdentifier(options.evidenceStore, "cli-command"),
          id: safeIdentifier(options.evidenceId, evidenceId),
        },
      ],
      confidence: 0.8,
      importance: normalizedImportance(options.importance ?? options.score),
      tags: normalizedTags(options.tags),
      sensitivity: options.sensitivity || "personal",
      allowedSinks: options.allowedSinks || ["*"],
      retentionPolicy: options.retentionPolicy || { mode: "durable" },
      activate: options.activate !== false,
      createdAt: now,
    };
  }

  async addScoped(content, options = {}) {
    const mutation = await this.runtime.kernel.proposeMemory(
      this._scopedProposal(content, options),
    );
    return { ...publicScopedEntry(mutation.record), receipt: mutation.receipt };
  }

  async ensureScoped(content, options = {}) {
    if (!options.memoryId) {
      throw new TypeError("memoryId is required for an idempotent scoped seed");
    }
    const proposal = this._scopedProposal(content, options);
    const verifyExisting = (existing) => {
      const fields = ["memoryId", "scope", "scopeId", "category", "content"];
      const mismatch = fields.find(
        (field) => (existing?.[field] ?? null) !== (proposal[field] ?? null),
      );
      if (mismatch) {
        const error = new Error(
          `canonical seed ${proposal.memoryId} conflicts on ${mismatch}`,
        );
        error.code = "CONTEXT_MEMORY_SEED_CONFLICT";
        throw error;
      }
      return {
        ...publicScopedEntry(existing),
        created: false,
      };
    };

    const existing = await this.runtime.memoryPort.read(proposal.memoryId);
    if (existing) return verifyExisting(existing);

    try {
      const mutation = await this.runtime.kernel.proposeMemory(proposal);
      return {
        ...publicScopedEntry(mutation.record),
        receipt: mutation.receipt,
        created: true,
      };
    } catch (error) {
      if (error?.code !== "revision_conflict") throw error;
      const raced = await this.runtime.memoryPort.read(proposal.memoryId);
      if (!raced) throw error;
      return verifyExisting(raced);
    }
  }

  async recallScoped(query, options = {}) {
    const scope = normalizedScope(options.scope, options.scopeId);
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 10));
    const recalled = await this.runtime.kernel.recallMemory({
      query: String(query || "").trim() || "*",
      sink: options.sink || "cli.display",
      scopeAdmissions: [scope],
      limit: 1000,
      tokenBudget: 1_048_576,
    });
    const tags = normalizedTags(options.tags);
    const entries = recalled.results
      .filter(
        ({ record }) =>
          (!options.category || record.category === options.category) &&
          (tags.length === 0 ||
            record.tags.some((tag) => tags.includes(tag))),
      )
      .slice(0, limit)
      .map(({ record, relevance }) => publicScopedEntry(record, relevance));
    return { ...recalled, results: entries };
  }

  async search(query, { limit = 20, sink = "cli.display" } = {}) {
    const recalled = await this.runtime.kernel.recallMemory({
      query,
      sink,
      scopeAdmissions: [{ scope: "user", scopeId: "local-user" }],
      limit: Math.max(1, Number(limit) || 20),
      tokenBudget: 32_768,
    });
    return {
      ...recalled,
      entries: recalled.results.map((result) =>
        publicEntry(result.record, result.relevance),
      ),
    };
  }

  async delete(idOrPrefix) {
    const records = await this.runtime.memoryPort.listRecords();
    const exact = records.find((record) => record.memoryId === idOrPrefix);
    const candidates = exact
      ? [exact]
      : records.filter((record) => record.memoryId.startsWith(idOrPrefix));
    if (candidates.length === 0) return null;
    if (candidates.length > 1) {
      const error = new Error(`memory prefix is ambiguous: ${idOrPrefix}`);
      error.code = "CONTEXT_MEMORY_ID_AMBIGUOUS";
      throw error;
    }
    const record = candidates[0];
    const nonce = randomUUID();
    return this.runtime.kernel.deleteMemory({
      requestId: `delete-${nonce}`,
      subject: "local-user",
      scope: record.scope,
      ...(record.scopeId ? { scopeId: record.scopeId } : {}),
      selector: `memory:${record.memoryId}`,
      memoryId: record.memoryId,
      expectedRevision: record.revision,
      fence: `fence-${nonce}`,
      authority: "cli-user-request",
    });
  }

  async reconcile(operationId) {
    return this.runtime.kernel.reconcile(operationId);
  }

  async export() {
    return this.runtime.memoryPort.listRecords({ includeTombstones: true });
  }

  async import(entries) {
    const result = { imported: 0, existing: 0, failed: 0, failures: [] };
    for (const entry of entries) {
      try {
        if (entry?.schemaVersion === 1 && entry?.memoryId) {
          const record = normalizeMemoryRecord(entry);
          const existing = await this.runtime.memoryPort.read(record.memoryId);
          if (existing) {
            if (existing.digest !== record.digest) {
              const error = new Error(`canonical memory conflict: ${record.memoryId}`);
              error.code = "CONTEXT_MEMORY_IMPORT_CONFLICT";
              throw error;
            }
            result.existing += 1;
            continue;
          }
          const event = {
            schema: "chainlesschain.memory-event/v1",
            eventId: `memory-import-${randomUUID()}`,
            type: "memory.imported",
            memoryId: record.memoryId,
            fromState: null,
            toState: record.state,
            previousRevision: 0,
            revision: record.revision,
            recordDigest: record.digest,
            at: new Date(Number(this.now())).toISOString(),
          };
          event.digest = canonicalDigest(event, "chainlesschain.memory-event/v1");
          const committed = await this.runtime.memoryPort.commit(
            { record, event },
            0,
          );
          if (!committed.ok) throw new Error(`memory import raced: ${record.memoryId}`);
        } else {
          const proposal = legacyProposal(
            entry,
            new Date(Number(this.now())).toISOString(),
          );
          const existing = await this.runtime.memoryPort.read(proposal.memoryId);
          if (existing) {
            result.existing += 1;
            continue;
          }
          await this.runtime.kernel.proposeMemory(proposal);
        }
        result.imported += 1;
      } catch (error) {
        result.failed += 1;
        result.failures.push({
          id: String(entry?.memoryId || entry?.id || "unknown").slice(0, 160),
          code: error?.code || "import_failed",
          message: error?.message || String(error),
        });
      }
    }
    return { ...result, ok: result.failed === 0 };
  }
}

export function createCliCanonicalMemoryService(options = {}) {
  return new CliCanonicalMemoryService(options);
}

export {
  legacyMemoryId,
  legacyProposal,
  legacyScopedProposal,
  normalizedScope,
  publicEntry,
  publicScopedEntry,
  safeIdentifier,
};
