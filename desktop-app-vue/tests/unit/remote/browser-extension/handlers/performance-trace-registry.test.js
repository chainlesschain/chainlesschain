import { describe, expect, it } from "vitest";

import {
  DEFAULT_PERFORMANCE_TRACE_LIMITS,
  HARD_PERFORMANCE_TRACE_LIMITS,
  PerformanceTraceRegistry,
} from "../../../../../src/main/remote/browser-extension/handlers/performance-trace-registry.js";

describe("PerformanceTraceRegistry", () => {
  it("uses a finite default and clamps configuration to the hard limit", () => {
    expect(new PerformanceTraceRegistry().getStats().limits).toEqual(
      DEFAULT_PERFORMANCE_TRACE_LIMITS,
    );
    expect(
      new PerformanceTraceRegistry({
        maxActiveTraces: Number.MAX_SAFE_INTEGER,
      }).getStats().limits,
    ).toEqual(HARD_PERFORMANCE_TRACE_LIMITS);
    expect(
      new PerformanceTraceRegistry({
        maxActiveTraces: Symbol("invalid"),
      }).getStats().limits,
    ).toEqual(DEFAULT_PERFORMANCE_TRACE_LIMITS);
  });

  it("holds per-tab and global admission until the trace lease is released", () => {
    const registry = new PerformanceTraceRegistry({ maxActiveTraces: 1 });
    const first = registry.admit(1);
    expect(first.accepted).toBe(true);
    expect(registry.admit(1)).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "performance_trace_tab",
      retryAfterMs: 1000,
    });
    expect(registry.admit(2)).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "performance_traces",
    });

    expect(registry.release(first.lease)).toMatchObject({ tabId: 1 });
    expect(registry.release(first.lease)).toBeNull();
    const replacement = registry.admit(2);
    expect(replacement.accepted).toBe(true);
    registry.release(replacement.lease);
  });

  it("retains only an aggregate event count and saturates safely", () => {
    const registry = new PerformanceTraceRegistry();
    const admission = registry.admit(3);
    expect(admission.accepted).toBe(true);

    expect(
      registry.recordEventBatch(admission.lease, Number.MAX_SAFE_INTEGER),
    ).toBe(true);
    expect(registry.recordEventBatch(admission.lease, 1)).toBe(true);
    expect(registry.getByTab(3)).toMatchObject({
      eventCount: Number.MAX_SAFE_INTEGER,
      eventCountExact: false,
    });
    expect(registry.recordEventBatch(admission.lease, 0)).toBe(false);

    const settled = registry.release(admission.lease);
    expect(settled).toMatchObject({
      eventCount: Number.MAX_SAFE_INTEGER,
      eventCountExact: false,
    });
    expect(registry.recordEventBatch(admission.lease, 1)).toBe(false);
  });

  it("binds one removable listener to the active trace", () => {
    const registry = new PerformanceTraceRegistry({ now: () => 123 });
    const admission = registry.admit(undefined);
    const listener = () => undefined;

    expect(registry.bindListener(admission.lease, listener)).toBe(true);
    expect(registry.getByTab(undefined)).toMatchObject({
      startedAt: 123,
      listener,
    });
    registry.release(admission.lease);
    expect(registry.bindListener(admission.lease, listener)).toBe(false);
  });

  it("serializes start and stop transitions without releasing early", () => {
    const registry = new PerformanceTraceRegistry();
    const admission = registry.admit(4);

    expect(registry.beginStop(4)).toMatchObject({
      accepted: false,
      code: "TRACE_STARTING",
    });
    expect(registry.markActive(admission.lease)).toBe(true);
    expect(registry.markActive(admission.lease)).toBe(false);
    expect(registry.beginStop(4)).toMatchObject({
      accepted: true,
      trace: { phase: "stopping" },
    });
    expect(registry.beginStop(4)).toMatchObject({
      accepted: false,
      code: "TRACE_STOPPING",
    });
    expect(registry.getStats().activeTraces).toBe(1);
    registry.release(admission.lease);
  });
});
