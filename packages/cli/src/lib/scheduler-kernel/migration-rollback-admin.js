import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { canonicalJson } from "./contract.js";
import {
  schedulerMigrationScopeDigest,
  schedulerMigrationSourceDigest,
} from "./store.js";
import { showSchedulerMigration } from "./migration-admin.js";
import { canonicalSchedulerSourcePath } from "./source-locator-path.js";

const requireCjs = createRequire(import.meta.url);
const AUTOMATION_NATIVE_DRIVERS = Object.freeze([
  "better-sqlite3-multiple-ciphers",
  "better-sqlite3",
]);

function rollbackAdminError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function automationSourceOpenError(code) {
  if (code === "SCHEDULER_MIGRATION_ROLLBACK_DURABILITY_UNAVAILABLE") {
    return rollbackAdminError(
      code,
      "Automation rollback requires an available native SQLite driver",
    );
  }
  return rollbackAdminError(
    "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_OPEN_FAILED",
    "Automation rollback could not open the recorded source database",
  );
}

function sanitizeAutomationSourceError(error) {
  if (
    typeof error?.code === "string" &&
    (error.code.startsWith("SCHEDULER_MIGRATION_") ||
      error.code.startsWith("AUTOMATION_SCHEDULER_MIGRATION_"))
  ) {
    return error;
  }
  return rollbackAdminError(
    "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_INSPECTION_FAILED",
    "Automation rollback could not inspect the recorded source database",
  );
}

function sanitizeSchedulerSourceError(error, domain, operation) {
  if (
    typeof error?.code === "string" &&
    error.code.startsWith("SCHEDULER_MIGRATION_ROLLBACK_")
  ) {
    return error;
  }
  const stableMigrationCode =
    typeof error?.code === "string" &&
    (error.code.startsWith("SCHEDULER_MIGRATION_") ||
      error.code.includes("_SCHEDULER_MIGRATION_"))
      ? error.code
      : null;
  return rollbackAdminError(
    stableMigrationCode ||
      `SCHEDULER_MIGRATION_ROLLBACK_SOURCE_${operation.toUpperCase()}_FAILED`,
    `Scheduler rollback could not ${operation} the recorded ${domain} source`,
  );
}

async function openAutomationSourceDatabase(database, dependencies) {
  if (typeof dependencies.openAutomationDatabase === "function") {
    try {
      const opened = await dependencies.openAutomationDatabase(database, {
        fileMustExist: true,
      });
      const db = opened?.db || opened;
      if (!db || typeof db.prepare !== "function") {
        throw new Error("invalid Automation database handle");
      }
      const close =
        typeof opened?.close === "function"
          ? () => opened.close()
          : typeof db.close === "function"
            ? () => db.close()
            : async () => {};
      return { db, close };
    } catch {
      throw automationSourceOpenError();
    }
  }

  // Check before driver loading for a stable, path-free missing-source error.
  // The native constructor repeats this check atomically with open, preventing
  // a delete race from turning a stale locator into a fresh empty database.
  if (!existsSync(database)) throw automationSourceOpenError();
  let nativeDriverAvailable = false;
  for (const packageName of AUTOMATION_NATIVE_DRIVERS) {
    try {
      const Database = requireCjs(packageName);
      nativeDriverAvailable = true;
      const db = new Database(database, { fileMustExist: true });
      return { db, close: () => db.close() };
    } catch {
      // Do not expose module locations, database paths, or SQLite diagnostics.
      // A second native candidate may still be able to open the source.
    }
  }
  throw automationSourceOpenError(
    nativeDriverAvailable
      ? "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_OPEN_FAILED"
      : "SCHEDULER_MIGRATION_ROLLBACK_DURABILITY_UNAVAILABLE",
  );
}

function normalizedPath(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_CONTEXT_INVALID",
      `${field} is required`,
    );
  }
  if (value !== value.trim()) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_CONTEXT_INVALID",
      `${field} must not contain leading or trailing whitespace`,
    );
  }
  try {
    return canonicalSchedulerSourcePath(value);
  } catch {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_CONTEXT_INVALID",
      `${field} must be a canonical source path`,
    );
  }
}

function exactContext(explicit, located, field, { path = false } = {}) {
  const expected = path ? normalizedPath(located, field) : located;
  if (explicit === undefined || explicit === null || explicit === "") {
    return located;
  }
  const actual = path ? normalizedPath(explicit, field) : String(explicit);
  if (actual !== expected) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_CONTEXT_MISMATCH",
      `${field} does not match the migration source locator`,
      { field },
    );
  }
  // The journal locator remains the authority. An explicit equivalent path is
  // only a binding assertion; it must not rewrite the scope used for digesting.
  return located;
}

function rollbackEvidencePayload(status) {
  return {
    schemaVersion: 1,
    migrationId: status.id,
    migrationState: status.state,
    manifestDigest: status.manifestDigest,
    entries: status.journal.entries.map((entry) => ({
      entryId: entry.entryId,
      domain: entry.domain,
      sourceId: entry.sourceId,
      sourceScopeDigest: entry.sourceScopeDigest,
      sourceLocatorAvailable: entry.sourceLocatorAvailable,
      sourceLocatorDigest: entry.sourceLocatorDigest,
      sourceDigest: entry.sourceDigest,
      targetJobId: entry.targetJobId,
      targetJobDigest: entry.targetJobDigest,
      rollbackStrategy: entry.rollbackStrategy,
      state: entry.state,
      targetAction: entry.targetAction,
      targetAppliedRevision: entry.targetAppliedRevision,
      targetOccurrenceCountBefore: entry.targetOccurrenceCountBefore,
      targetExecutionEventCountBefore: entry.targetExecutionEventCountBefore,
      targetRollbackRevision: entry.targetRollbackRevision,
      sourceRetirementDigest: entry.sourceRetirementDigest,
      sourceRestoredDigest: entry.sourceRestoredDigest,
    })),
    targets: status.targets.map((target) => ({
      jobId: target.jobId,
      exists: target.exists,
      revision: target.revision,
      enabled: target.enabled,
      definitionDigest: target.definitionDigest ?? null,
      occurrenceCount: target.occurrenceCount,
      eventCount: target.eventCount,
      executionEventCount: target.executionEventCount,
    })),
    blockers: status.rollback.blockers,
  };
}

export function schedulerMigrationRollbackEvidenceDigest(status) {
  return `sha256:${createHash("sha256")
    .update("chainlesschain.scheduler-migration.rollback-evidence.v1\0", "utf8")
    .update(canonicalJson(rollbackEvidencePayload(status)), "utf8")
    .digest("hex")}`;
}

export function showSchedulerMigrationRollback(repository, migrationId) {
  const status = showSchedulerMigration(repository, migrationId);
  return {
    ...status,
    rollback: {
      ...status.rollback,
      evidenceDigest: schedulerMigrationRollbackEvidenceDigest(status),
    },
  };
}

export function buildSchedulerMigrationRollbackChallenge({
  migrationId,
  evidenceDigest,
  sourceScopeDigest,
} = {}) {
  if (
    typeof migrationId !== "string" ||
    migrationId.length === 0 ||
    !/^sha256:[a-f0-9]{64}$/.test(evidenceDigest || "") ||
    !/^sha256:[a-f0-9]{64}$/.test(sourceScopeDigest || "")
  ) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_INVALID_ARGUMENT",
      "Scheduler migration rollback challenge input is invalid",
    );
  }
  return (
    `ROLL BACK SCHEDULER MIGRATION ${migrationId} ${evidenceDigest} ` +
    `SOURCE ${sourceScopeDigest}`
  );
}

async function requireRollbackTTY(request, dependencies) {
  const stdin = dependencies.stdin || process.stdin;
  const stdout = dependencies.stdout || process.stdout;
  if (stdin?.isTTY !== true || stdout?.isTTY !== true) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_NON_INTERACTIVE",
      "Scheduler migration rollback requires an interactive TTY",
    );
  }
  const challenge = buildSchedulerMigrationRollbackChallenge(request);
  const readChallenge =
    dependencies.readChallenge ||
    (async (expected) => {
      const { input } = await import("@inquirer/prompts");
      return input({
        message:
          "Stop legacy and scheduler workers for this source. " +
          `Type this authorization exactly:\n${expected}`,
      });
    });
  if ((await readChallenge(challenge)) !== challenge) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_CHALLENGE_FAILED",
      "Scheduler migration rollback challenge did not match; no change was made",
    );
  }
  return challenge;
}

function requireLocator(entry, type, key) {
  const locator = entry.sourceLocator;
  if (
    locator?.schemaVersion !== 1 ||
    locator.type !== type ||
    typeof locator[key] !== "string" ||
    locator[key].length === 0
  ) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_UNBOUND",
      `Migration source locator is unavailable for ${entry.domain}:${entry.sourceId}`,
    );
  }
  return locator;
}

function allowedSourceMarkerStates(entry) {
  const loop = entry.domain === "loop-iteration";
  switch (entry.state) {
    case "prepared":
    case "applied":
    case "verified":
      return loop ? [] : ["prepared"];
    case "retiring":
      return loop ? ["retired"] : ["prepared", "retired"];
    case "retired":
      return ["retired"];
    case "rollback_target_disabled":
      // A rollback can begin after the retirement token was allocated but
      // before the legacy source was fenced and confirmed. Both states are
      // therefore valid when resuming this durable intermediate state.
      return loop ? ["retired"] : ["prepared", "retired"];
    case "source_restored":
    case "rolled_back":
    default:
      return [];
  }
}

function sourceMarkerRequired(entry) {
  if (entry.domain === "loop-iteration") {
    return entry.sourceRetirementDigest != null;
  }
  return [
    "applied",
    "verified",
    "retiring",
    "retired",
    "rollback_target_disabled",
  ].includes(entry.state);
}

function sourceAlreadyRestored(migration, entry, evidence) {
  if (
    migration.state !== "rolling_back" ||
    !["prepared", "rollback_target_disabled", "source_restored"].includes(
      entry.state,
    )
  ) {
    return false;
  }
  if (evidence.hasRetirementFence === true) return false;
  if (entry.domain === "loop-iteration") {
    const marker = evidence.marker;
    return (
      evidence.hasRetirementFence === false &&
      (!marker ||
        (marker.schemaVersion === 1 &&
          ["retired", "rolled_back"].includes(marker.state) &&
          marker.migrationId === migration.id &&
          marker.targetJobId === entry.targetJobId &&
          marker.retirementToken === entry.retirementToken))
    );
  }
  return evidence.marker == null;
}

function assertSourceEvidence(migration, entry, evidence) {
  if (!evidence || typeof evidence.rollback !== "function") {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_UNBOUND",
      `Migration source cannot be opened for ${entry.domain}:${entry.sourceId}`,
    );
  }
  const actualScopeDigest = schedulerMigrationScopeDigest(evidence.scope);
  const legacyAutomationCurrentScope =
    entry.domain === "automation" &&
    schedulerMigrationScopeDigest({
      store: "automation-engine",
      database: "current",
    }) === entry.sourceScopeDigest;
  if (
    actualScopeDigest !== entry.sourceScopeDigest &&
    !legacyAutomationCurrentScope
  ) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_CONTEXT_MISMATCH",
      `Opened source scope does not match ${entry.domain}:${entry.sourceId}`,
    );
  }
  if (
    schedulerMigrationSourceDigest(evidence.snapshot) !== entry.sourceDigest
  ) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_CHANGED",
      `Migration source digest changed for ${entry.domain}:${entry.sourceId}`,
    );
  }
  const marker = evidence.marker;
  const alreadyRestored = sourceAlreadyRestored(migration, entry, evidence);
  if (!marker && sourceMarkerRequired(entry) && !alreadyRestored) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_MARKER_MISSING",
      `Migration source marker is missing for ${entry.domain}:${entry.sourceId}`,
    );
  }
  if (marker && !alreadyRestored) {
    if (
      marker.schemaVersion !== 1 ||
      !["prepared", "retired"].includes(marker.state) ||
      marker.migrationId !== migration.id ||
      marker.targetJobId !== entry.targetJobId ||
      (marker.sourceDigest !== undefined &&
        marker.sourceDigest !== evidence.nativeSourceDigest) ||
      (entry.retirementToken &&
        marker.state === "retired" &&
        marker.retirementToken !== entry.retirementToken)
    ) {
      throw rollbackAdminError(
        "SCHEDULER_MIGRATION_ROLLBACK_MARKER_MISMATCH",
        `Migration source marker does not match ${entry.domain}:${entry.sourceId}`,
      );
    }
    if (!allowedSourceMarkerStates(entry).includes(marker.state)) {
      throw rollbackAdminError(
        "SCHEDULER_MIGRATION_ROLLBACK_MARKER_MISMATCH",
        `Migration source marker state does not match ${entry.domain}:${entry.sourceId}`,
      );
    }
  }
  if (
    entry.sourceRetirementDigest != null &&
    !["source_restored", "rolled_back"].includes(entry.state) &&
    !alreadyRestored
  ) {
    const actualRetirementDigest =
      evidence.retirementSource == null
        ? null
        : schedulerMigrationSourceDigest(evidence.retirementSource);
    if (
      marker?.state !== "retired" ||
      actualRetirementDigest !== entry.sourceRetirementDigest
    ) {
      throw rollbackAdminError(
        "SCHEDULER_MIGRATION_ROLLBACK_RETIREMENT_EVIDENCE_CHANGED",
        `Retired source evidence changed for ${entry.domain}:${entry.sourceId}`,
      );
    }
  }
  if (!alreadyRestored && typeof evidence.assertRollbackSafe === "function") {
    evidence.assertRollbackSafe({ migration, entry });
  }
}

async function resolveAgendaSource(migration, entry, options) {
  const locator = requireLocator(entry, "agenda-store", "directory");
  const directory = exactContext(
    options.sourceDirectory,
    locator.directory,
    "sourceDirectory",
    { path: true },
  );
  const {
    AgentScheduleStore,
    agendaMigrationSourceDigest,
    agendaMigrationSourceSnapshot,
  } = await import("../agent-schedule-store.js");
  const { rollbackAgendaSchedulerMigration } =
    await import("./agenda-adapter.js");
  const agendaStore = new AgentScheduleStore({ dir: directory });
  const source = agendaStore.get(entry.sourceId);
  if (!source) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_NOT_FOUND",
      `Agenda source does not exist: ${entry.sourceId}`,
    );
  }
  return {
    scope: { store: "agent-schedule", directory: locator.directory },
    snapshot: agendaMigrationSourceSnapshot(source),
    nativeSourceDigest: agendaMigrationSourceDigest(source),
    marker: source.schedulerMigration || null,
    hasRetirementFence: String(source.executionLease?.owner || "").startsWith(
      "scheduler-migration:",
    ),
    retirementSource: source,
    assertRollbackSafe: ({ entry: expected }) => {
      const marker = source.schedulerMigration;
      if (marker?.state === "retired") {
        if (
          source.executionLease?.owner !==
            `scheduler-migration:${expected.retirementToken}` ||
          Number(source.executionLease?.expiresAt) <= Date.now()
        ) {
          throw rollbackAdminError(
            "SCHEDULER_MIGRATION_ROLLBACK_FENCE_MISMATCH",
            `Agenda retirement fence changed for ${expected.sourceId}`,
          );
        }
      } else if (
        String(source.executionLease?.owner || "").startsWith(
          "scheduler-migration:",
        )
      ) {
        throw rollbackAdminError(
          "SCHEDULER_MIGRATION_ROLLBACK_FENCE_MISMATCH",
          `Agenda rollback observed an orphan scheduler fence for ${expected.sourceId}`,
        );
      }
    },
    rollback: (schedulerStore) =>
      rollbackAgendaSchedulerMigration({
        agendaStore,
        schedulerStore,
        migrationId: migration.id,
      }),
  };
}

async function resolveRoutineSource(migration, entry, options) {
  const locator = requireLocator(entry, "routine-store", "directory");
  const directory = exactContext(
    options.sourceDirectory,
    locator.directory,
    "sourceDirectory",
    { path: true },
  );
  const {
    RoutineStore,
    routineMigrationSourceDigest,
    routineMigrationSourceSnapshot,
  } = await import("../routine-store.js");
  const { rollbackRoutineMigration } = await import("./routine-adapter.js");
  const routineStore = new RoutineStore({ dir: directory });
  const source = routineStore.get(entry.sourceId);
  if (!source) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_NOT_FOUND",
      `Routine source does not exist: ${entry.sourceId}`,
    );
  }
  return {
    scope: { store: "routines", directory: locator.directory },
    snapshot: routineMigrationSourceSnapshot(source),
    nativeSourceDigest: routineMigrationSourceDigest(source),
    marker: source.schedulerMigration || null,
    hasRetirementFence:
      source.enabled === false && source.trigger?.kind === "webhook",
    retirementSource: source,
    assertRollbackSafe: ({ entry: expected }) => {
      const marker = source.schedulerMigration;
      if (marker?.state === "retired") {
        if (
          source.enabled !== false ||
          source.trigger?.kind !== "webhook" ||
          marker.retirementToken !== expected.retirementToken
        ) {
          throw rollbackAdminError(
            "SCHEDULER_MIGRATION_ROLLBACK_FENCE_MISMATCH",
            `Routine retirement fence changed for ${expected.sourceId}`,
          );
        }
      }
    },
    rollback: (schedulerStore) =>
      rollbackRoutineMigration({
        routineStore,
        schedulerStore,
        migrationId: migration.id,
      }),
  };
}

async function resolveCoworkSource(migration, entry, options) {
  const locator = requireLocator(entry, "cowork-workspace", "workspace");
  const workspace = exactContext(
    options.workspace,
    locator.workspace,
    "workspace",
    { path: true },
  );
  const {
    coworkCronMigrationSourceDigest,
    coworkCronMigrationSourceSnapshot,
    getSchedule,
  } = await import("../cowork-cron.js");
  const { rollbackCoworkCronMigration } =
    await import("./cowork-cron-adapter.js");
  const source = getSchedule(workspace, entry.sourceId);
  if (!source) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_NOT_FOUND",
      `Cowork source does not exist: ${entry.sourceId}`,
    );
  }
  return {
    scope: { store: "cowork-schedules", workspace: locator.workspace },
    snapshot: coworkCronMigrationSourceSnapshot(source),
    nativeSourceDigest: coworkCronMigrationSourceDigest(source),
    marker: source.schedulerMigration || null,
    hasRetirementFence: String(source.activeDelivery?.ownerId || "").startsWith(
      "scheduler-migration:",
    ),
    retirementSource: source,
    assertRollbackSafe: ({ entry: expected }) => {
      const marker = source.schedulerMigration;
      if (marker?.state === "retired") {
        const leaseExpiresAt = Date.parse(
          source.activeDelivery?.leaseExpiresAt || "",
        );
        if (
          source.activeDelivery?.ownerId !==
            `scheduler-migration:${expected.retirementToken}` ||
          marker.retirementToken !== expected.retirementToken ||
          !Number.isFinite(leaseExpiresAt) ||
          leaseExpiresAt <= Date.now()
        ) {
          throw rollbackAdminError(
            "SCHEDULER_MIGRATION_ROLLBACK_FENCE_MISMATCH",
            `Cowork retirement fence changed for ${expected.sourceId}`,
          );
        }
      } else if (
        String(source.activeDelivery?.ownerId || "").startsWith(
          "scheduler-migration:",
        )
      ) {
        throw rollbackAdminError(
          "SCHEDULER_MIGRATION_ROLLBACK_FENCE_MISMATCH",
          `Cowork rollback observed an orphan scheduler fence for ${expected.sourceId}`,
        );
      }
    },
    rollback: (schedulerStore) =>
      rollbackCoworkCronMigration({
        cwd: workspace,
        schedulerStore,
        migrationId: migration.id,
      }),
  };
}

async function resolveAutomationSource(
  migration,
  entry,
  options,
  dependencies,
) {
  const locator = requireLocator(entry, "automation-database", "database");
  exactContext(
    options.automationDatabase,
    locator.database,
    "automationDatabase",
    { path: !String(locator.database).startsWith("memory:") },
  );
  let automationDb = dependencies.automationDb;
  let closeAutomationDb = async () => {};
  if (!automationDb) {
    if (String(locator.database).startsWith("memory:")) {
      throw rollbackAdminError(
        "SCHEDULER_MIGRATION_ROLLBACK_AUTOMATION_DB_REQUIRED",
        "In-memory Automation rollback requires the owning database handle",
      );
    }
    const opened = await openAutomationSourceDatabase(
      locator.database,
      dependencies,
    );
    automationDb = opened.db;
    let open = true;
    closeAutomationDb = async () => {
      if (!open) return;
      open = false;
      await opened.close();
    };
  }
  if (automationDb?.__isSqlJsCompat === true) {
    await closeAutomationDb();
    throw automationSourceOpenError(
      "SCHEDULER_MIGRATION_ROLLBACK_DURABILITY_UNAVAILABLE",
    );
  }
  try {
    const {
      automationEffectiveSchedulerFlow,
      automationMigrationSourceDigest,
      automationMigrationSourceSnapshot,
      FLOW_STATUS,
      getAutomationSchedulerMigration,
      getFlow,
    } = await import("../automation-engine.js");
    const { automationDatabaseIdentity, rollbackAutomationMigration } =
      await import("./automation-adapter.js");
    const database = automationDatabaseIdentity(automationDb);
    if (database !== locator.database) {
      throw rollbackAdminError(
        "SCHEDULER_MIGRATION_ROLLBACK_CONTEXT_MISMATCH",
        "Automation database handle does not match the migration source locator",
      );
    }
    const source = getFlow(automationDb, entry.sourceId);
    if (!source) {
      throw rollbackAdminError(
        "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_NOT_FOUND",
        `Automation source does not exist: ${entry.sourceId}`,
      );
    }
    const effective = automationEffectiveSchedulerFlow(automationDb, source);
    const evidence = {
      scope: { store: "automation-engine", database: locator.database },
      snapshot: automationMigrationSourceSnapshot(effective),
      nativeSourceDigest: automationMigrationSourceDigest(effective),
      marker:
        getAutomationSchedulerMigration(automationDb, entry.sourceId) || null,
      hasRetirementFence:
        effective?.schedulerMigration?.state === "retired" &&
        getFlow(automationDb, entry.sourceId)?.schedule === null,
      retirementSource: effective,
      assertRollbackSafe: ({ entry: expected }) => {
        const marker = getAutomationSchedulerMigration(
          automationDb,
          expected.sourceId,
        );
        const current = getFlow(automationDb, expected.sourceId);
        if (marker?.state === "retired") {
          if (
            marker.retirementToken !== expected.retirementToken ||
            current?.schedule !== null ||
            ![FLOW_STATUS.PAUSED, FLOW_STATUS.ACTIVE].includes(current?.status)
          ) {
            throw rollbackAdminError(
              "SCHEDULER_MIGRATION_ROLLBACK_FENCE_MISMATCH",
              `Automation retirement fence changed for ${expected.sourceId}`,
            );
          }
        }
      },
      rollback: (schedulerStore) => {
        return rollbackAutomationMigration({
          db: automationDb,
          schedulerStore,
          migrationId: migration.id,
        });
      },
      close: async () => {
        try {
          await closeAutomationDb();
        } catch {
          throw rollbackAdminError(
            "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_CLOSE_FAILED",
            "Automation rollback could not close the recorded source database",
          );
        }
      },
    };
    return evidence;
  } catch (error) {
    try {
      await closeAutomationDb();
    } catch {
      // Preserve the inspection failure while keeping driver/path details out
      // of the operator-facing error channel.
    }
    throw sanitizeAutomationSourceError(error);
  }
}

async function resolveLoopSource(migration, entry, options, dependencies) {
  const locator = requireLocator(entry, "jsonl-session", "sessionId");
  const sessionId = exactContext(
    options.sessionId,
    locator.sessionId,
    "sessionId",
  );
  const sessionStore = await import("../../harness/jsonl-session-store.js");
  const resolveSessionPath =
    dependencies.sessionPath || sessionStore.sessionPath;
  const directory = normalizedPath(locator.directory, "sessionDirectory");
  const actualDirectory = normalizedPath(
    dirname(resolveSessionPath(sessionId)),
    "sessionDirectory",
  );
  if (directory !== actualDirectory) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_CONTEXT_MISMATCH",
      "Saved loop session directory does not match the migration source locator",
    );
  }
  const { summarizeLoopEvents } = await import("../loop.js");
  const { loopMigrationSourceSnapshot, rollbackSavedLoopMigration } =
    await import("./loop-adapter.js");
  const readEvents = dependencies.readEvents || sessionStore.readEvents;
  const appendEventIfHead =
    dependencies.appendEventIfHead || sessionStore.appendEventIfHead;
  const events = readEvents(sessionId);
  const summary = summarizeLoopEvents(events);
  const latestConfig = events
    .filter((event) => event?.type === "loop_config")
    .at(-1)?.data;
  if (!summary.config) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_NOT_FOUND",
      `Saved loop source does not exist: ${sessionId}`,
    );
  }
  return {
    scope: { store: "jsonl-session", sessionId: locator.sessionId },
    snapshot: loopMigrationSourceSnapshot({
      sessionId,
      config: summary.config,
    }),
    nativeSourceDigest: undefined,
    marker: summary.schedulerMigration || null,
    hasRetirementFence: Boolean(latestConfig?.schedulerMigrationFence),
    retirementSource: summary.schedulerMigration || null,
    assertRollbackSafe: ({ entry: expected }) => {
      const marker = summary.schedulerMigration;
      const fence = events
        .filter((event) => event?.type === "loop_config")
        .at(-1)?.data?.schedulerMigrationFence;
      if (marker?.state === "retired") {
        if (
          fence?.schemaVersion !== 1 ||
          fence.state !== "retired" ||
          fence.migrationId !== migration.id ||
          fence.targetJobId !== expected.targetJobId ||
          fence.retirementToken !== expected.retirementToken
        ) {
          throw rollbackAdminError(
            "SCHEDULER_MIGRATION_ROLLBACK_FENCE_MISMATCH",
            `Saved loop retirement fence changed for ${expected.sourceId}`,
          );
        }
      }
    },
    rollback: (schedulerStore) =>
      rollbackSavedLoopMigration({
        schedulerStore,
        sessionId,
        config: summary.config,
        migrationId: migration.id,
        readEvents,
        appendEventIfHead,
      }),
  };
}

async function resolveSource(migration, entry, options, dependencies) {
  try {
    if (typeof dependencies.resolveSource === "function") {
      return await dependencies.resolveSource({ migration, entry, options });
    }
    switch (entry.domain) {
      case "agenda":
        return await resolveAgendaSource(migration, entry, options);
      case "cowork-cron":
        return await resolveCoworkSource(migration, entry, options);
      case "routine":
        return await resolveRoutineSource(migration, entry, options);
      case "automation":
        return await resolveAutomationSource(
          migration,
          entry,
          options,
          dependencies,
        );
      case "loop-iteration":
        return await resolveLoopSource(migration, entry, options, dependencies);
      default:
        throw rollbackAdminError(
          "SCHEDULER_MIGRATION_ROLLBACK_DOMAIN_UNSUPPORTED",
          `Unsupported scheduler migration domain: ${entry.domain}`,
        );
    }
  } catch (error) {
    throw sanitizeSchedulerSourceError(error, entry.domain, "inspect");
  }
}

export async function rollbackSchedulerMigration({
  schedulerStore,
  repository,
  migrationId,
  options = {},
  dependencies = {},
}) {
  const initial = showSchedulerMigrationRollback(repository, migrationId);
  if (initial.journal.entries.length !== 1) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_MULTI_ENTRY_UNSUPPORTED",
      "Operator rollback currently supports single-entry migrations only",
    );
  }
  if (!initial.rollback.eligible) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_BLOCKED",
      "Scheduler migration rollback is blocked by current journal or target evidence",
      { blockers: initial.rollback.blockers },
    );
  }
  if (options.expectedEvidenceDigest !== initial.rollback.evidenceDigest) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_EVIDENCE_MISMATCH",
      "Expected rollback evidence digest does not match the latest migration show",
    );
  }
  const migration = repository.get(migrationId);
  const entry = migration.entries[0];
  let source = await resolveSource(migration, entry, options, dependencies);
  try {
    assertSourceEvidence(migration, entry, source);
    await requireRollbackTTY(
      {
        migrationId,
        evidenceDigest: initial.rollback.evidenceDigest,
        sourceScopeDigest: entry.sourceScopeDigest,
      },
      dependencies,
    );
  } finally {
    await source.close?.();
  }

  // CAS both sides again after the operator has spent time at the prompt. No
  // migration/target mutation has happened before these exact re-checks.
  const latest = showSchedulerMigrationRollback(repository, migrationId);
  if (latest.rollback.evidenceDigest !== initial.rollback.evidenceDigest) {
    throw rollbackAdminError(
      "SCHEDULER_MIGRATION_ROLLBACK_EVIDENCE_STALE",
      "Scheduler migration evidence changed during rollback authorization",
    );
  }
  const latestMigration = repository.get(migrationId);
  source = await resolveSource(
    latestMigration,
    latestMigration.entries[0],
    options,
    dependencies,
  );
  try {
    assertSourceEvidence(latestMigration, latestMigration.entries[0], source);
    try {
      await source.rollback(schedulerStore);
    } catch (error) {
      throw sanitizeSchedulerSourceError(
        error,
        latestMigration.entries[0].domain,
        "restore",
      );
    }
  } finally {
    await source.close?.();
  }
  return showSchedulerMigrationRollback(repository, migrationId);
}
