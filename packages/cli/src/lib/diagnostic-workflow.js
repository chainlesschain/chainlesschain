// Shared across ordinary debugging and recovery. Tool observations establish
// process outcomes; the model still has to validate the causal hypothesis.
export const DIAGNOSTIC_WORKFLOW_GUIDANCE =
  "For debugging, retain the original failure signature (error, source location, stack, command, environment and revision when verified). " +
  "Label each observation by its source and reproduction scope. A passing subset is not a successful full reproduction; a different error is a separate finding until evidence connects it to the original failure. " +
  "Expected negative-test output, dependency/setup failures, failed assertions and runner/infrastructure failures are different possibilities. Inspect surrounding output and process outcomes before selecting one. Timing alone does not identify the cause, and argument order is not execution order. " +
  "State one hypothesis and the smallest check that can disprove it; after that check, update the hypothesis from the observed result instead of restarting discovery. " +
  "Do not change dependencies while a reproduction using them is running. Poll background tasks by task_id and drain has_more_output after exit. " +
  "Bind reports to verified paths, runs and attempts; do not substitute a local or stale report for the target run. A green report alone does not override a nonzero exit, unhandled errors or incomplete output. " +
  "A fix requires validation against the original failure and relevant regression checks. Otherwise report what was reproduced, what differs and the specific missing evidence; do not claim the original issue is fixed.";
