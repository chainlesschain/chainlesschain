import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONSOLE_CAPTURE_LIMITS,
  HARD_CONSOLE_CAPTURE_LIMITS,
  ConsoleCaptureRegistry,
} from "../../../../../src/main/remote/browser-extension/handlers/console-capture-registry.js";

describe("ConsoleCaptureRegistry", () => {
  it("uses finite defaults and clamps configuration to hard limits", () => {
    expect(new ConsoleCaptureRegistry().getStats().limits).toEqual(
      DEFAULT_CONSOLE_CAPTURE_LIMITS,
    );
    const hard = new ConsoleCaptureRegistry({
      maxActiveCaptures: Number.MAX_SAFE_INTEGER,
      maxRetainedCaptures: Number.MAX_SAFE_INTEGER,
      maxLogsPerCapture: Number.MAX_SAFE_INTEGER,
      maxBytesPerCapture: Number.MAX_SAFE_INTEGER,
      maxTotalBytes: Number.MAX_SAFE_INTEGER,
      maxEntryBytes: Number.MAX_SAFE_INTEGER,
    });
    expect(hard.getStats().limits).toEqual(HARD_CONSOLE_CAPTURE_LIMITS);
  });

  it("holds per-tab and global admission through start and stop phases", () => {
    const registry = new ConsoleCaptureRegistry({ maxActiveCaptures: 1 });
    const first = registry.admit(1);
    expect(first.accepted).toBe(true);
    expect(registry.admit(1)).toMatchObject({
      code: "OVERLOADED",
      scope: "console_capture_tab",
    });
    expect(registry.admit(2)).toMatchObject({
      code: "OVERLOADED",
      scope: "console_captures",
    });
    expect(registry.beginStop(1)).toMatchObject({
      code: "CONSOLE_CAPTURE_STARTING",
    });

    expect(registry.markActive(first.lease)).toBe(true);
    const stopping = registry.beginStop(1);
    expect(stopping).toMatchObject({
      accepted: true,
      capture: { status: "stopping" },
    });
    expect(registry.beginStop(1)).toMatchObject({
      code: "CONSOLE_CAPTURE_STOPPING",
    });
    registry.complete(first.lease);
    expect(registry.getStats().activeCaptures).toBe(0);
  });

  it("keeps the newest bounded log ring and reports evictions", () => {
    const registry = new ConsoleCaptureRegistry({
      maxLogsPerCapture: 2,
      maxBytesPerCapture: 1000,
      maxTotalBytes: 1000,
    });
    const admission = registry.admit(3);
    registry.markActive(admission.lease);

    registry.append(admission.lease, { text: "first" });
    registry.append(admission.lease, { text: "second" });
    registry.append(admission.lease, { text: "third" });

    expect(registry.getLogs(3)).toMatchObject({
      logs: [{ text: "second" }, { text: "third" }],
      droppedLogs: 1,
      status: "active",
    });
    expect(registry.getStats().totalBytes).toBeGreaterThan(0);
    registry.clear(3);
    expect(registry.getLogs(3)).toMatchObject({
      logs: [],
      droppedLogs: 0,
      retainedBytes: 0,
    });
  });

  it("evicts inactive captures before crossing the global byte cap", () => {
    const registry = new ConsoleCaptureRegistry({
      maxActiveCaptures: 2,
      maxRetainedCaptures: 3,
      maxBytesPerCapture: 40,
      maxTotalBytes: 40,
      maxEntryBytes: 40,
    });
    const first = registry.admit(4);
    registry.markActive(first.lease);
    registry.append(first.lease, { text: "x".repeat(20) });
    registry.complete(first.lease);

    const second = registry.admit(5);
    registry.markActive(second.lease);
    registry.append(second.lease, { text: "y".repeat(20) });

    expect(registry.getLogs(4).logs).toEqual([]);
    expect(registry.getLogs(5).logs).toHaveLength(1);
    expect(registry.getStats().totalBytes).toBeLessThanOrEqual(40);
  });

  it("rejects stale leases and removes failed start state", () => {
    const registry = new ConsoleCaptureRegistry();
    const admission = registry.admit(undefined);
    registry.bindResources(admission.lease, { listener: true });
    expect(registry.failStart(admission.lease)).toBe(true);
    expect(registry.failStart(admission.lease)).toBe(false);
    expect(registry.append(admission.lease, { text: "late" })).toBe(false);
    expect(registry.getStats()).toMatchObject({
      activeCaptures: 0,
      retainedCaptures: 0,
      totalBytes: 0,
    });
  });
});
