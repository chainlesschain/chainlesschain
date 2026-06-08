"use strict";

import { describe, it, expect } from "vitest";

const { AppleHealthAdapter } = require("../../lib/adapters/apple-health");
const { partitionBatch } = require("../../lib/batch");

const XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<HealthData locale="zh_CN">',
  ' <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" creationDate="2024-01-15 08:36:00 +0800" startDate="2024-01-15 08:30:00 +0800" endDate="2024-01-15 08:35:00 +0800" value="123"/>',
  ' <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2024-01-15 23:00:00 +0800" endDate="2024-01-16 07:00:00 +0800" value="HKCategoryValueSleepAnalysisAsleep"/>',
  ' <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" totalDistance="5" totalDistanceUnit="km" startDate="2024-01-15 18:00:00 +0800" endDate="2024-01-15 18:30:00 +0800"/>',
  ' <SomethingElse foo="bar"/>',
  "</HealthData>",
].join("\n");

function adapter(xml = XML, { exists = true } = {}) {
  const a = new AppleHealthAdapter();
  a._deps.fs = {
    existsSync: () => exists,
    readFileSync: () => xml,
    accessSync: () => {},
    constants: { R_OK: 4 },
  };
  return a;
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("AppleHealthAdapter", () => {
  it("readinessOnly → NO_FILE (file-import, not 手机采集)", async () => {
    const a = new AppleHealthAdapter();
    const r = await a.authenticate({ readinessOnly: true });
    expect(r.reason).toBe("NO_FILE");
    expect(a.extractMode).toBe("file-import");
  });

  it("parses Record + Workout lines, ignores other elements", async () => {
    const raws = await collect(adapter().sync({ inputPath: "/fake/export.xml" }));
    expect(raws.map((r) => r.kind)).toEqual(["record", "record", "workout"]);
  });

  it("normalizes to valid events (metrics → other, workout → trip)", async () => {
    const a = adapter();
    const raws = await collect(a.sync({ inputPath: "/fake/export.xml" }));
    const merged = { events: [], persons: [], places: [], items: [], topics: [] };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged)) merged[k].push(...n[k]);
    }
    const { valid, invalidReasons } = partitionBatch(merged);
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(3);
    const subtypes = valid.events.map((e) => e.subtype).sort();
    expect(subtypes).toEqual(["other", "other", "trip"]);
    const steps = valid.events.find((e) => e.extra.metric === "HKQuantityTypeIdentifierStepCount");
    expect(steps.content.title).toContain("步数");
    expect(steps.content.title).toContain("123");
    const workout = valid.events.find((e) => e.subtype === "trip");
    expect(workout.extra.activityType).toBe("Running");
    expect(workout.content.title).toContain("5km");
  });

  it("parses the +0800 timezone offset correctly", async () => {
    const a = adapter();
    const raws = await collect(a.sync({ inputPath: "/fake/export.xml" }));
    // 2024-01-15 08:30:00 +0800 == 2024-01-15T00:30:00Z
    expect(raws[0].capturedAt).toBe(Date.parse("2024-01-15T00:30:00Z"));
  });

  it("respects limit + include", async () => {
    const a = adapter();
    const capped = await collect(a.sync({ inputPath: "/x", limit: 1 }));
    expect(capped).toHaveLength(1);
    const noWorkout = await collect(a.sync({ inputPath: "/x", include: { workout: false } }));
    expect(noWorkout.every((r) => r.kind === "record")).toBe(true);
  });

  it("emits truncated progress when maxRecords exceeded", async () => {
    const a = adapter();
    const events = [];
    await collect(a.sync({ inputPath: "/x", maxRecords: 1, onProgress: (e) => events.push(e) }));
    expect(events.find((e) => e.phase === "truncated")).toBeTruthy();
  });

  it("missing file yields nothing", async () => {
    const raws = await collect(adapter(XML, { exists: false }).sync({ inputPath: "/x" }));
    expect(raws).toHaveLength(0);
  });
});
