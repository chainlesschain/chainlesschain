// Shared policy reservations; the CLI retains its public ESM entry.
import authority from "@chainlesschain/session-core/scheduler-authority-resolver";
export const {
  DEFAULT_SCHEDULER_AUTHORITY_WINDOW_MS,
  DEFAULT_SCHEDULER_AUTHORITY_MAX_RUNS,
  DEFAULT_SCHEDULER_AUTHORITY_MAX_UNITS,
  schedulerAuthorityPolicyReference,
  parseSchedulerAuthorityPolicyReference,
  bindSchedulerAuthorityPolicy,
  checkSchedulerAuthorityPolicy,
  createSchedulerAuthorityResolver,
} = authority;
