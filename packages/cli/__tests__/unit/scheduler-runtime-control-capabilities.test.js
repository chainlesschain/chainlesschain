import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_V1_RUNTIME_CONTROL,
  NO_RUNTIME_CONTROL,
  resolveAutomationCenterRuntimeControl,
} from "../../src/lib/scheduler-kernel/runtime-control-capabilities.js";

describe("scheduler runtime-control capabilities", () => {
  it("shares one immutable checkpoint capability across known Automation Center kinds", () => {
    expect(CHECKPOINT_V1_RUNTIME_CONTROL).toEqual({
      schemaVersion: 1,
      pauseResume: "checkpoint_v1",
      safePoints: ["adapter_checkpoint", "before_execute"],
    });
    expect(Object.isFrozen(CHECKPOINT_V1_RUNTIME_CONTROL)).toBe(true);
    expect(Object.isFrozen(CHECKPOINT_V1_RUNTIME_CONTROL.safePoints)).toBe(
      true,
    );

    for (const kind of [
      "agenda",
      "automation",
      "automation-event",
      "cowork-cron",
      "loop-iteration",
      "routine",
    ]) {
      expect(resolveAutomationCenterRuntimeControl(kind)).toBe(
        CHECKPOINT_V1_RUNTIME_CONTROL,
      );
    }
  });

  it("fails closed for an unknown job kind", () => {
    expect(resolveAutomationCenterRuntimeControl("unknown-kind")).toBe(
      NO_RUNTIME_CONTROL,
    );
    expect(resolveAutomationCenterRuntimeControl("unknown-kind")).toEqual({
      schemaVersion: 1,
      pauseResume: "none",
      safePoints: [],
    });
  });
});
