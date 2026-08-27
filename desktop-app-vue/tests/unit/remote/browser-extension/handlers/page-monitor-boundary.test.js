import { describe, expect, it } from "vitest";

import {
  ActivePageMonitorRegistry,
  DEFAULT_ACTIVE_PAGE_MONITOR_LIMITS,
  HARD_ACTIVE_PAGE_MONITOR_LIMITS,
  PAGE_MONITOR_INPUT_LIMITS,
  validateEventMonitorTypes,
  validateMutationMonitorOptions,
  validatePageMonitorSelector,
} from "../../../../../src/main/remote/browser-extension/handlers/page-monitor-boundary.js";

describe("ActivePageMonitorRegistry", () => {
  it("uses finite defaults and clamps admission to the hard ceiling", () => {
    expect(new ActivePageMonitorRegistry().getStats().limits).toEqual(
      DEFAULT_ACTIVE_PAGE_MONITOR_LIMITS,
    );
    expect(
      new ActivePageMonitorRegistry({
        maxActiveMonitors: Number.MAX_SAFE_INTEGER,
      }).getStats().limits,
    ).toEqual(HARD_ACTIVE_PAGE_MONITOR_LIMITS);
  });

  it("serializes each tab and bounds global active monitor state", () => {
    const registry = new ActivePageMonitorRegistry({
      kind: "event",
      maxActiveMonitors: 1,
    });
    const first = registry.admit(1);
    expect(first.accepted).toBe(true);
    expect(registry.admit(1)).toMatchObject({
      code: "OVERLOADED",
      scope: "event_monitor_tab",
    });
    expect(registry.admit(2)).toMatchObject({
      code: "OVERLOADED",
      scope: "event_monitors",
    });
    expect(registry.beginStop(1)).toMatchObject({
      code: "PAGE_MONITOR_BUSY",
    });
    registry.markActive(first.lease);
    const stop = registry.beginStop(1);
    expect(stop.accepted).toBe(true);
    expect(registry.cancelStop(stop.lease)).toBe(true);
    expect(registry.beginStop(1).accepted).toBe(true);
    expect(registry.complete(first.lease)).toBe(true);
    expect(registry.getStats().activeMonitors).toBe(0);
  });

  it("releases a tab while startup or active work is retained", () => {
    const registry = new ActivePageMonitorRegistry();
    const first = registry.admit(3);
    expect(registry.clearTab(3)).toBe(true);
    expect(registry.markActive(first.lease)).toBe(false);
    expect(registry.admit(3).accepted).toBe(true);
  });
});

describe("page monitor input boundaries", () => {
  it("bounds selectors and normalizes event types", () => {
    expect(validatePageMonitorSelector(null)).toEqual({
      accepted: true,
      selector: "",
    });
    expect(
      validatePageMonitorSelector(
        "x".repeat(PAGE_MONITOR_INPUT_LIMITS.maxSelectorChars + 1),
      ),
    ).toMatchObject({ code: "OVERLOADED", scope: "monitor_selector" });
    expect(validateEventMonitorTypes(["click", "click", "input"])).toEqual({
      accepted: true,
      eventTypes: ["click", "input"],
    });
    expect(
      validateEventMonitorTypes(
        Array.from(
          { length: PAGE_MONITOR_INPUT_LIMITS.maxEventTypes + 1 },
          (_, index) => `event-${index}`,
        ),
      ),
    ).toMatchObject({ code: "OVERLOADED", scope: "event_monitor_types" });
  });

  it("normalizes mutation flags and rejects non-object options", () => {
    expect(validateMutationMonitorOptions([])).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(
      validateMutationMonitorOptions({
        attributes: false,
        childList: true,
        characterData: 1,
      }),
    ).toEqual({
      accepted: true,
      options: {
        attributes: false,
        childList: true,
        subtree: true,
        characterData: false,
        attributeOldValue: false,
        characterDataOldValue: false,
      },
    });
  });
});
