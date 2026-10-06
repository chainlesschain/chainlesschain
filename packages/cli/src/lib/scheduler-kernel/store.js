// Host assembly retains the CLI's original paths, native driver and storage protection.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getHomeDir } from "../paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import schedulerStore from "@chainlesschain/session-core/scheduler-store";
import { SchedulerKernelError } from "./contract.js";
const requireCjs = createRequire(import.meta.url);
export const {
  SCHEDULER_APPLICATION_ID,
  SCHEDULER_STORE_SCHEMA_VERSION,
  DEFAULT_BUSY_TIMEOUT_MS,
  MAX_LEASE_MS,
  MIN_AUTHORITY_WINDOW_MS,
  MAX_AUTHORITY_WINDOW_MS,
  MAX_AUTHORITY_BUDGET,
  MAX_RUNTIME_CHECKPOINT_BYTES,
  DEFAULT_AUTHORITY_WINDOW_MS,
  DEFAULT_AUTHORITY_MAX_RUNS,
  DEFAULT_AUTHORITY_MAX_UNITS,
  MAX_RUNTIME_CONTROL_OCCURRENCES,
  RUNTIME_CONTROL_OCCURRENCE_STATUSES,
  RUNTIME_CONTROL_JOB_KINDS,
  SCHEDULER_ADJUDICATION_AUTHORITY,
  SCHEDULER_ADJUDICATION_DECISIONS,
  SCHEDULER_MIGRATION_DOMAINS,
  SCHEDULER_MIGRATION_STATES,
  MIGRATION_V1_SQL,
  MIGRATION_V1_CHECKSUM,
  MIGRATION_V2_SQL,
  MIGRATION_V2_CHECKSUM,
  MIGRATION_V3_SQL,
  MIGRATION_V3_CHECKSUM,
  MIGRATION_V4_SQL,
  MIGRATION_V4_CHECKSUM,
  MIGRATION_V5_SQL,
  MIGRATION_V5_CHECKSUM,
  MIGRATION_V6_SQL,
  MIGRATION_V6_CHECKSUM,
  SCHEMA_V1_FINGERPRINT,
  SCHEMA_V2_FINGERPRINT,
  SCHEMA_V3_FINGERPRINT,
  SCHEMA_V4_FINGERPRINT,
  SCHEMA_V5_FINGERPRINT,
  SCHEMA_V6_FINGERPRINT,
  schedulerRuntimeControlCapabilityDigest,
  schedulerJobDefinitionDigest,
  schedulerMigrationSourceDigest,
  schedulerMigrationScopeDigest,
  schedulerAdjudicationReasonDigest,
  schedulerAdjudicationOperatorDigest,
  SchedulerStore,
} = schedulerStore;
export function openSchedulerStore(options = {}) {
  let Database = options.Database;
  if (!Database) {
    try {
      Database = requireCjs("better-sqlite3");
    } catch (cause) {
      throw new SchedulerKernelError(
        "SCHEDULER_SQLITE_UNAVAILABLE",
        "Scheduler kernel requires the existing optional better-sqlite3 dependency",
        undefined,
        { cause },
      );
    }
  }
  return schedulerStore.openSchedulerStore({
    ...options,
    Database,
    file: options.file || join(getHomeDir(), "scheduler", "kernel-v1.sqlite"),
    protectStorage: ({ file, files, phase }) => {
      if (phase === "before-open") ensurePrivateDirectory(dirname(file));
      for (const candidate of files)
        if (existsSync(candidate)) ensurePrivateFile(candidate);
      return true;
    },
  });
}
