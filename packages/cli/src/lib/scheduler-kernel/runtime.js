// CLI composition retains the existing Graph mode and authority defaults.
// The host-neutral runtime never imports CLI Graph or rollout-store modules.
import schedulerRuntime from "@chainlesschain/session-core/scheduler-runtime";
import {
  SchedulerOccurrenceGraphAuthority,
  schedulerGraphAuthorityMode,
} from "./graph-authority-adapter.js";

export const {
  DEFAULT_RUNTIME_LEASE_MS,
  MIN_RUNTIME_LEASE_MS,
  DEFAULT_RUN_LIMIT,
  MAX_RUN_LIMIT,
} = schedulerRuntime;

export class SchedulerRuntime extends schedulerRuntime.SchedulerRuntime {
  constructor(options = {}) {
    const mode = options.graphAuthorityMode || schedulerGraphAuthorityMode();
    const authority =
      options.graphAuthority === undefined
        ? new SchedulerOccurrenceGraphAuthority({ mode })
        : options.graphAuthority;
    super({
      ...options,
      graphAuthority: authority,
      graphAuthorityMode: authority?.mode ?? mode,
    });
  }
}

export function createSchedulerRuntime(options) {
  return new SchedulerRuntime(options);
}
