import {
  RUNTIME_CONTROL_SAFE_POINTS,
  RUNTIME_CONTROL_SCHEMA_VERSION,
  RUNTIME_PAUSE_RESUME,
  normalizeRuntimeControlCapability,
} from "./contract.js";
import { RUNTIME_CONTROL_JOB_KINDS } from "./store.js";

/** Canonical cooperative pause/resume declaration for production adapters. */
export const CHECKPOINT_V1_RUNTIME_CONTROL = normalizeRuntimeControlCapability({
  schemaVersion: RUNTIME_CONTROL_SCHEMA_VERSION,
  pauseResume: RUNTIME_PAUSE_RESUME.CHECKPOINT_V1,
  safePoints: [
    RUNTIME_CONTROL_SAFE_POINTS.BEFORE_EXECUTE,
    RUNTIME_CONTROL_SAFE_POINTS.ADAPTER_CHECKPOINT,
  ],
});

export const NO_RUNTIME_CONTROL = normalizeRuntimeControlCapability();

const automationCenterJobKinds = new Set(RUNTIME_CONTROL_JOB_KINDS);

/**
 * Resolve Automation Center capabilities without trusting a caller-supplied
 * adapter. Unknown kinds deliberately remain unsupported.
 */
export function resolveAutomationCenterRuntimeControl(jobKind) {
  return automationCenterJobKinds.has(jobKind)
    ? CHECKPOINT_V1_RUNTIME_CONTROL
    : NO_RUNTIME_CONTROL;
}
