import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  normalizeGoalNotificationPolicy,
  isGoalNotificationQuiet,
  nextGoalNotificationDelivery,
} = require("../../../session-core/lib/goal-notification-policy.js");
const {
  createGoalRecord,
  reviseGoalRecord,
} = require("../../../session-core/lib/goal-contract.js");
const policy = (timeZone, startMinute, endMinute) => ({
  channel: "in-app",
  mode: "changes-only",
  quietHours: { timeZone, startMinute, endMinute },
});

describe("in-app notification quiet periods with explicit timezone", () => {
  it("retains the legacy default shape and permits explicit disabling", () => {
    expect(
      normalizeGoalNotificationPolicy({
        channel: "in-app",
        mode: "changes-only",
      }),
    ).toEqual({ channel: "in-app", mode: "changes-only" });
    expect(
      normalizeGoalNotificationPolicy({
        channel: "in-app",
        mode: "silent",
        quietHours: null,
      }),
    ).toEqual({ channel: "in-app", mode: "silent", quietHours: null });
  });
  it("round-trips quiet settings through a goal revision without starting any work", () => {
    const record = createGoalRecord({
      storeId: "store",
      objective: "Follow delivery",
      createdAt: "2026-10-07T00:00:00.000Z",
    });
    const revised = reviseGoalRecord(
      record,
      { notificationPolicy: policy("Asia/Shanghai", 1320, 480) },
      "2026-10-07T00:01:00.000Z",
    );
    expect(revised.notificationPolicy).toEqual(
      policy("Asia/Shanghai", 1320, 480),
    );
    expect(revised.controlGeneration).toBe(1);
    expect(revised.executionState).toBe("idle");
    expect(revised.completion).toBeNull();
  });
  it("finds the next local morning for an overnight quiet period", () => {
    const rule = policy("Asia/Shanghai", 1320, 480);
    const at = Date.parse("2026-10-07T15:30:42.000Z");
    expect(isGoalNotificationQuiet(rule, at)).toBe(true);
    expect(nextGoalNotificationDelivery(rule, at)).toBe(
      Date.parse("2026-10-08T00:00:00.000Z"),
    );
    expect(
      isGoalNotificationQuiet(rule, Date.parse("2026-10-07T14:00:00.000Z")),
    ).toBe(true);
    expect(
      isGoalNotificationQuiet(rule, Date.parse("2026-10-08T00:00:00.000Z")),
    ).toBe(false);
  });
  it("leaves a non-quiet observation eligible immediately and observes same-day boundaries", () => {
    const rule = policy("UTC", 540, 660);
    expect(
      isGoalNotificationQuiet(rule, Date.parse("2026-10-07T08:59:59.000Z")),
    ).toBe(false);
    expect(
      nextGoalNotificationDelivery(
        rule,
        Date.parse("2026-10-07T08:00:00.000Z"),
      ),
    ).toBe(Date.parse("2026-10-07T08:00:00.000Z"));
    expect(
      nextGoalNotificationDelivery(
        rule,
        Date.parse("2026-10-07T09:00:00.000Z"),
      ),
    ).toBe(Date.parse("2026-10-07T11:00:00.000Z"));
  });
  it("does not add a fixed offset across the spring-forward gap", () => {
    const rule = policy("America/New_York", 60, 150);
    expect(
      nextGoalNotificationDelivery(
        rule,
        Date.parse("2026-03-08T06:59:00.000Z"),
      ),
    ).toBe(Date.parse("2026-03-08T07:00:00.000Z"));
  });
  it("waits through both repeated hours during the fall-back transition", () => {
    const rule = policy("America/New_York", 60, 120);
    expect(
      nextGoalNotificationDelivery(
        rule,
        Date.parse("2026-11-01T05:10:00.000Z"),
      ),
    ).toBe(Date.parse("2026-11-01T07:00:00.000Z"));
    expect(
      isGoalNotificationQuiet(rule, Date.parse("2026-11-01T06:10:00.000Z")),
    ).toBe(true);
  });
  it.each([
    { channel: "os", mode: "changes-only" },
    { channel: "in-app", mode: "every-check" },
    { ...policy("Not/AZone", 100, 200) },
    { ...policy("UTC", 10, 10) },
    { ...policy("UTC", -1, 20) },
    { ...policy("UTC", 0, 1440) },
    { ...policy("UTC", 1.5, 100) },
    { ...policy("UTC", 1, 100), actorDid: "forged" },
  ])("rejects invalid or authority-expanding settings %j", (value) => {
    expect(() => normalizeGoalNotificationPolicy(value)).toThrow(
      "GOAL_INVALID_NOTIFICATION",
    );
  });
});
