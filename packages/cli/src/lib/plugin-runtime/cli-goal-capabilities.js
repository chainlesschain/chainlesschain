/** Implemented CLI surfaces; source leases and per-call activation still gate use. */
import { VERSION } from "../../constants.js";

export const CLI_GOAL_CAPABILITIES = Object.freeze([
  "event:goal.status.changed",
  "event:risk.review.completed",
  "event:action.receipt.updated",
  "panel:goal.summary",
  "panel:goal.evidence",
  "proposal:task.description.update",
]);

export function cliGoalExtensionHost(activeCapabilities) {
  if (
    !Array.isArray(activeCapabilities) ||
    activeCapabilities.some(
      (value) => !CLI_GOAL_CAPABILITIES.includes(value),
    ) ||
    new Set(activeCapabilities).size !== activeCapabilities.length
  )
    throw new Error("CLI_GOAL_HOST_CAPABILITIES_INVALID");
  return Object.freeze({
    id: "cli",
    version: VERSION,
    capabilities: CLI_GOAL_CAPABILITIES,
    activeCapabilities: Object.freeze([...activeCapabilities]),
  });
}
