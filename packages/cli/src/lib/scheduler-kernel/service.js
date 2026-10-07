// Compatibility entry: both hosts share the same implementation and error type.
import schedulerService from "@chainlesschain/session-core/scheduler-service";

export const {
  DEFAULT_SERVICE_INTERVAL_MS,
  MIN_SERVICE_INTERVAL_MS,
  MAX_SERVICE_INTERVAL_MS,
  MAX_SERVICE_SUMMARIES,
  SchedulerService,
  createSchedulerService,
} = schedulerService;
