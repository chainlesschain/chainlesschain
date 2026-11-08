"use strict";

/** Main-process trial boundary. Enabling is startup-only; disabling is latched
 * for the lifetime of this process. No renderer request can change this policy. */
function createProjectGoalFeaturePolicy({
  enabled = process.env.CHAINLESSCHAIN_PROJECT_GOALS === "1",
} = {}) {
  if (typeof enabled !== "boolean") {
    throw new TypeError("Invalid goal trial policy");
  }
  let active = enabled,
    closing = null;
  const listeners = new Set();
  function assertEnabled() {
    if (!active) {
      throw Object.assign(new Error("GOAL_FEATURE_DISABLED"), {
        code: "GOAL_FEATURE_DISABLED",
      });
    }
  }
  function disable() {
    if (closing) {
      return closing;
    }
    active = false; // Fence synchronous and in-flight work before draining.
    closing = Promise.allSettled(
      [...listeners].map((fn) => Promise.resolve().then(fn)),
    ).then((results) => {
      const errors = results.filter((item) => item.status === "rejected");
      if (errors.length) {
        throw new AggregateError(
          errors.map((item) => item.reason),
          "GOAL_FEATURE_DRAIN_FAILED",
        );
      }
      return { enabled: false, drained: true };
    });
    return closing;
  }
  return Object.freeze({
    isEnabled: () => active,
    status: () => ({ enabled: active, startupOptInRequired: true }),
    assertEnabled,
    capture() {
      assertEnabled();
      return assertEnabled;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    disable,
  });
}

const projectGoalFeaturePolicy = createProjectGoalFeaturePolicy();
module.exports = { createProjectGoalFeaturePolicy, projectGoalFeaturePolicy };
