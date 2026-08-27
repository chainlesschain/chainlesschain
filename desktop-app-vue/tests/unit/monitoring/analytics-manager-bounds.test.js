import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  AnalyticsManager,
  HARD_ANALYTICS_LIMITS,
  createAnalyticsLimits,
} = require("../../../src/main/monitoring/analytics-manager.js");

let testDirectory;
let testApp;

function createManager(limits = {}, filename = "analytics.json") {
  return new AnalyticsManager({
    app: testApp,
    dataPath: path.join(testDirectory, filename),
    limits,
  });
}

beforeEach(() => {
  testApp = {
    getPath: vi.fn(() => os.tmpdir()),
    getVersion: vi.fn(() => "1.0.0-test"),
    on: vi.fn(),
  };
  testDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "chainless-analytics-bounds-"),
  );
});

afterEach(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

describe("AnalyticsManager resource bounds", () => {
  it("clamps caller supplied limits to hard ceilings", () => {
    const limits = createAnalyticsLimits(
      Object.fromEntries(
        Object.keys(HARD_ANALYTICS_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );

    expect(limits).toEqual(HARD_ANALYTICS_LIMITS);
  });

  it("retains only the newest bounded session events and archives once", () => {
    const manager = createManager({
      maxSessionEvents: 3,
      maxSessionEventBytes: 1024,
      maxTextChars: 4,
    });

    for (let index = 0; index < 5; index += 1) {
      manager.trackEvent("category", `action-${index}`, `label-${index}`);
    }

    expect(manager.currentSession.events).toHaveLength(3);
    expect(manager.currentSession.events.map((event) => event.action)).toEqual([
      "acti",
      "acti",
      "acti",
    ]);
    expect(manager.currentSession.events[0].label).toBe("labe");
    expect(manager.currentSession.droppedEvents).toBe(2);

    manager.endSession();
    manager.endSession();
    const sessions = manager.getSessions(10);
    expect(sessions).toHaveLength(1);
    expect(manager.getSessions(0)).toEqual([]);

    sessions[0].events[0].label = "changed";
    expect(manager.getSessions(1)[0].events[0].label).toBe("labe");
  });

  it("keeps the current session within its retained event-byte budget", () => {
    const manager = createManager({
      maxSessionEvents: 10,
      maxSessionEventBytes: 200,
      maxTextChars: 64,
    });

    for (let index = 0; index < 5; index += 1) {
      manager.trackEvent("category", `action-${index}`, "x".repeat(64));
    }

    const retainedBytes = manager.currentSession.events.reduce(
      (sum, event) => sum + Buffer.byteLength(JSON.stringify(event), "utf8"),
      0,
    );
    expect(retainedBytes).toBeLessThanOrEqual(200);
    expect(manager.currentSession.events.length).toBeLessThan(5);
    expect(manager.currentSession.droppedEvents).toBeGreaterThan(0);
  });

  it("rejects new feature dimensions after capacity and keeps existing ones", () => {
    const manager = createManager({ maxFeatures: 2, maxTextChars: 9 });

    expect(manager.trackFeature("feature-a")).toMatchObject({ accepted: true });
    expect(manager.trackFeature("feature-b")).toMatchObject({ accepted: true });
    expect(manager.trackFeature("feature-a")).toMatchObject({ accepted: true });
    expect(manager.trackFeature("feature-c")).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "analytics_features",
    });
    expect(manager.getFeatureUsage()).toEqual([
      expect.objectContaining({ name: "feature-a", count: 2 }),
      expect.objectContaining({ name: "feature-b", count: 1 }),
    ]);
  });

  it("bounds error text and drops oversized or circular contexts", () => {
    const manager = createManager({
      maxErrors: 2,
      maxTextChars: 5,
      maxContextBytes: 32,
    });
    const circular = {};
    circular.self = circular;

    manager.trackError(new Error("message-too-long"), {
      payload: "x".repeat(100),
    });
    manager.trackError(new Error("cycle-too-long"), circular);
    manager.trackError(null, { ok: true });

    const errors = manager.getErrors(10);
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toBe("");
    expect(errors[1]).toMatchObject({
      message: "cycle",
      context: { dropped: true, reason: "PAYLOAD_NOT_SERIALIZABLE" },
    });
  });

  it("normalizes persisted collections and ignores oversized history files", () => {
    const dataPath = path.join(testDirectory, "loaded.json");
    fs.writeFileSync(
      dataPath,
      JSON.stringify({
        sessions: [
          {
            id: "session-long",
            events: Array.from({ length: 5 }, (_, index) => ({
              category: "category",
              action: `action-${index}`,
            })),
          },
        ],
        features: {
          first: { count: 1 },
          second: { count: 2 },
          third: { count: 3 },
        },
        errors: [{ message: "one" }, { message: "two" }, { message: "three" }],
        performance: [
          { metric: "one", value: 1 },
          { metric: "two", value: 2 },
          { metric: "three", value: 3 },
        ],
      }),
    );

    const manager = createManager(
      {
        maxSessionEvents: 2,
        maxSessionEventBytes: 1024,
        maxFeatures: 2,
        maxErrors: 2,
        maxPerformanceEntries: 2,
        maxTextChars: 6,
      },
      "loaded.json",
    );
    expect(manager.data.sessions[0].events).toHaveLength(2);
    expect(Object.keys(manager.data.features)).toEqual(["first", "second"]);
    expect(manager.data.errors).toHaveLength(2);
    expect(manager.data.performance).toHaveLength(2);

    const oversizedPath = path.join(testDirectory, "oversized.json");
    fs.writeFileSync(
      oversizedPath,
      JSON.stringify({ padding: "x".repeat(256) }),
    );
    const oversized = createManager(
      { maxPersistenceBytes: 64 },
      "oversized.json",
    );
    expect(oversized.data).toEqual({
      sessions: [],
      features: {},
      errors: [],
      performance: [],
    });
  });
});
