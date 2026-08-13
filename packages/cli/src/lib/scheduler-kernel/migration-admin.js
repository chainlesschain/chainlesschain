import {
  SCHEDULER_MIGRATION_DOMAINS,
  SCHEDULER_MIGRATION_STATES,
  schedulerJobDefinitionDigest,
} from "./store.js";

const DEFAULT_MIGRATION_LIST_LIMIT = 50;
const MAX_MIGRATION_LIST_LIMIT = 200;
const ROLLBACKABLE_MIGRATION_STATES = new Set([
  SCHEDULER_MIGRATION_STATES.PREPARED,
  SCHEDULER_MIGRATION_STATES.APPLIED,
  SCHEDULER_MIGRATION_STATES.VERIFIED,
  SCHEDULER_MIGRATION_STATES.RETIRING,
  SCHEDULER_MIGRATION_STATES.RETIRED,
  SCHEDULER_MIGRATION_STATES.ROLLING_BACK,
]);
const ROLLBACKABLE_ENTRY_STATES = new Set([
  "prepared",
  "applied",
  "verified",
  "retiring",
  "retired",
  "source_restored",
  "rollback_target_disabled",
  "rolled_back",
]);
const TARGET_ROLLBACK_ALREADY_COMPLETE = new Set(["prepared", "rolled_back"]);

function expectedRollbackTargetDigest(migration, entry) {
  if (entry.state !== "rollback_target_disabled") return null;
  if (
    entry.targetAction !== "created" &&
    entry.rollbackStrategy !== "disable"
  ) {
    return entry.targetBefore == null
      ? null
      : schedulerJobDefinitionDigest(entry.targetBefore);
  }
  const manifestEntry = migration.manifest?.entries?.find(
    (candidate) => candidate.entryId === entry.entryId,
  );
  return manifestEntry?.targetJob
    ? schedulerJobDefinitionDigest({
        ...manifestEntry.targetJob,
        enabled: false,
      })
    : null;
}

function migrationAdminError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeOptionalFilter(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw migrationAdminError(
      "SCHEDULER_MIGRATION_ADMIN_INVALID_ARGUMENT",
      `${field} must be a string`,
    );
  }
  return value.trim().toLowerCase();
}

export function normalizeSchedulerMigrationListOptions(options = {}) {
  const state = normalizeOptionalFilter(options.state, "state");
  if (
    state !== undefined &&
    !Object.values(SCHEDULER_MIGRATION_STATES).includes(state)
  ) {
    throw migrationAdminError(
      "SCHEDULER_MIGRATION_ADMIN_INVALID_ARGUMENT",
      `state must be selected from: ${Object.values(SCHEDULER_MIGRATION_STATES).join(", ")}`,
    );
  }
  const domain = normalizeOptionalFilter(options.domain, "domain");
  if (domain !== undefined && !SCHEDULER_MIGRATION_DOMAINS.includes(domain)) {
    throw migrationAdminError(
      "SCHEDULER_MIGRATION_ADMIN_INVALID_ARGUMENT",
      `domain must be selected from: ${SCHEDULER_MIGRATION_DOMAINS.join(", ")}`,
    );
  }
  const limit = Number(options.limit ?? DEFAULT_MIGRATION_LIST_LIMIT);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_MIGRATION_LIST_LIMIT
  ) {
    throw migrationAdminError(
      "SCHEDULER_MIGRATION_ADMIN_INVALID_ARGUMENT",
      `limit must be an integer between 1 and ${MAX_MIGRATION_LIST_LIMIT}`,
    );
  }
  return { state, domain, limit };
}

function migrationDomains(migration) {
  return [
    ...new Set((migration.entries || []).map((entry) => entry.domain)),
  ].sort();
}

function migrationSummary(migration) {
  return {
    id: migration.id,
    state: migration.state,
    domains: migrationDomains(migration),
    entryCount: migration.entryCount,
    manifestDigest: migration.manifestDigest,
    createdAt: migration.createdAt,
    updatedAt: migration.updatedAt,
    completedAt: migration.completedAt,
  };
}

function safeJournalEntry(entry) {
  return {
    entryId: entry.entryId,
    domain: entry.domain,
    sourceId: entry.sourceId,
    sourceScopeDigest: entry.sourceScopeDigest,
    sourceLocatorAvailable: entry.sourceLocator != null,
    sourceLocatorDigest: entry.sourceLocatorDigest ?? null,
    sourceDigest: entry.sourceDigest,
    targetJobId: entry.targetJobId,
    targetJobDigest: entry.targetJobDigest,
    rollbackStrategy: entry.rollbackStrategy,
    state: entry.state,
    targetAction: entry.targetAction,
    targetAppliedRevision: entry.targetAppliedRevision,
    targetAppliedAt: entry.targetAppliedAt,
    targetOccurrenceCountBefore: entry.targetOccurrenceCountBefore,
    targetExecutionEventCountBefore: entry.targetExecutionEventCountBefore,
    targetRollbackRevision: entry.targetRollbackRevision,
    sourceRetirementDigest: entry.sourceRetirementDigest,
    sourceRestoredDigest: entry.sourceRestoredDigest,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function safeLastError(lastError) {
  if (!lastError || typeof lastError !== "object") return null;
  return {
    code:
      typeof lastError.code === "string"
        ? lastError.code
        : "SCHEDULER_MIGRATION_ERROR",
  };
}

function rollbackBlockers(migration, targetByJobId) {
  const blockers = [];
  if ((migration.entries || []).length !== 1) {
    blockers.push({
      code: "MULTI_ENTRY_UNSUPPORTED",
      entryCount: (migration.entries || []).length,
    });
  }
  if (!ROLLBACKABLE_MIGRATION_STATES.has(migration.state)) {
    blockers.push({
      code:
        migration.state === SCHEDULER_MIGRATION_STATES.ROLLED_BACK
          ? "MIGRATION_ALREADY_ROLLED_BACK"
          : "MIGRATION_STATE_NOT_ROLLBACKABLE",
      state: migration.state,
    });
  }
  for (const entry of migration.entries || []) {
    if (entry.sourceLocator == null) {
      blockers.push({
        code: "SOURCE_LOCATOR_UNAVAILABLE",
        entryId: entry.entryId,
        domain: entry.domain,
      });
    }
    if (!ROLLBACKABLE_ENTRY_STATES.has(entry.state)) {
      blockers.push({
        code: "ENTRY_STATE_NOT_ROLLBACKABLE",
        entryId: entry.entryId,
        state: entry.state,
      });
      continue;
    }
    if (TARGET_ROLLBACK_ALREADY_COMPLETE.has(entry.state)) continue;
    const target = targetByJobId.get(entry.targetJobId);
    if (!target?.exists) {
      blockers.push({
        code: "TARGET_NOT_FOUND",
        entryId: entry.entryId,
        targetJobId: entry.targetJobId,
      });
      continue;
    }
    const rollbackDisabled = entry.state === "rollback_target_disabled";
    const expectedRevision = rollbackDisabled
      ? entry.targetRollbackRevision
      : entry.targetAppliedRevision;
    if (target.revision !== expectedRevision) {
      blockers.push({
        code: "TARGET_REVISION_CHANGED",
        entryId: entry.entryId,
        targetJobId: entry.targetJobId,
        expectedRevision,
        actualRevision: target.revision,
      });
    }
    if (rollbackDisabled) {
      const expectedDefinitionDigest = expectedRollbackTargetDigest(
        migration,
        entry,
      );
      if (
        expectedDefinitionDigest === null ||
        (target.definitionDigest ?? null) !== expectedDefinitionDigest
      ) {
        blockers.push({
          code: "TARGET_DEFINITION_CHANGED",
          entryId: entry.entryId,
          targetJobId: entry.targetJobId,
          expectedDefinitionDigest,
          actualDefinitionDigest: target.definitionDigest ?? null,
        });
      }
    }
    if (target.occurrenceCount !== entry.targetOccurrenceCountBefore) {
      blockers.push({
        code: "TARGET_OCCURRENCES_OBSERVED",
        entryId: entry.entryId,
        targetJobId: entry.targetJobId,
        countBefore: entry.targetOccurrenceCountBefore,
        countNow: target.occurrenceCount,
      });
    }
    if (target.executionEventCount !== entry.targetExecutionEventCountBefore) {
      blockers.push({
        code: "TARGET_EXECUTION_EVENTS_OBSERVED",
        entryId: entry.entryId,
        targetJobId: entry.targetJobId,
        countBefore: entry.targetExecutionEventCountBefore,
        countNow: target.executionEventCount,
      });
    }
  }
  return blockers;
}

export function createSchedulerMigrationAdminRepository(store) {
  if (!store?.db || typeof store.getDomainMigration !== "function") {
    throw migrationAdminError(
      "SCHEDULER_MIGRATION_ADMIN_INVALID_ARGUMENT",
      "A scheduler store is required",
    );
  }
  return {
    list(options) {
      let sql =
        "SELECT m.migration_id FROM scheduler_domain_migrations m WHERE 1 = 1";
      const parameters = { limit: options.limit };
      if (options.state !== undefined) {
        sql += " AND m.state = @state";
        parameters.state = options.state;
      }
      if (options.domain !== undefined) {
        sql +=
          " AND EXISTS (SELECT 1 FROM scheduler_domain_migration_entries e" +
          " WHERE e.migration_id = m.migration_id AND e.domain = @domain)";
        parameters.domain = options.domain;
      }
      sql += " ORDER BY m.updated_at DESC, m.migration_id LIMIT @limit";
      return store.db
        .prepare(sql)
        .all(parameters)
        .map((row) => store.getDomainMigration(row.migration_id));
    },
    get(migrationId) {
      return store.getDomainMigration(migrationId);
    },
    getTarget(targetJobId) {
      const job = store.getJob(targetJobId);
      const counts = store.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM occurrences WHERE job_id = ?) AS occurrence_count,
             (SELECT COUNT(*) FROM events WHERE job_id = ?) AS event_count,
             (SELECT COUNT(*) FROM events
                WHERE job_id = ? AND occurrence_id IS NOT NULL) AS execution_event_count`,
        )
        .get(targetJobId, targetJobId, targetJobId);
      return {
        jobId: targetJobId,
        exists: job !== null,
        revision: job?.revision ?? null,
        enabled: job?.enabled ?? null,
        definitionDigest:
          job == null ? null : schedulerJobDefinitionDigest(job),
        occurrenceCount: counts.occurrence_count,
        eventCount: counts.event_count,
        executionEventCount: counts.execution_event_count,
      };
    },
  };
}

export function listSchedulerMigrations(repository, options = {}) {
  const normalized = normalizeSchedulerMigrationListOptions(options);
  return repository.list(normalized).map(migrationSummary);
}

export function showSchedulerMigration(repository, migrationId) {
  const migration = repository.get(migrationId);
  if (!migration) {
    throw migrationAdminError(
      "SCHEDULER_MIGRATION_NOT_FOUND",
      `Scheduler domain migration does not exist: ${migrationId}`,
    );
  }
  const targets = (migration.entries || []).map((entry) =>
    repository.getTarget(entry.targetJobId),
  );
  const targetByJobId = new Map(
    targets.map((target) => [target.jobId, target]),
  );
  const blockers = rollbackBlockers(migration, targetByJobId);
  return {
    ...migrationSummary(migration),
    journal: {
      state: migration.state,
      manifestDigest: migration.manifestDigest,
      entryCount: migration.entryCount,
      createdAt: migration.createdAt,
      updatedAt: migration.updatedAt,
      completedAt: migration.completedAt,
      lastError: safeLastError(migration.lastError),
      entries: (migration.entries || []).map(safeJournalEntry),
    },
    targets,
    rollback: {
      eligible: blockers.length === 0,
      blockers,
    },
  };
}
