"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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

let tmpDir;

function adapter(fsImpl = fs) {
  const a = new AppleHealthAdapter();
  a._deps.fs = fsImpl;
  return a;
}

function writeExport(xml = XML) {
  const inputPath = path.join(tmpDir, "export.xml");
  fs.writeFileSync(inputPath, xml, "utf8");
  return inputPath;
}

async function collect(iter) {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe("AppleHealthAdapter", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apple-health-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("readinessOnly → NO_FILE (file-import, not 手机采集)", async () => {
    const a = new AppleHealthAdapter();
    const r = await a.authenticate({ readinessOnly: true });
    expect(r.reason).toBe("NO_FILE");
    expect(a.extractMode).toBe("file-import");
  });

  it("authenticates a bounded regular export file", async () => {
    const inputPath = writeExport();
    expect(await adapter().authenticate({ inputPath })).toEqual({
      ok: true,
      mode: "file-import",
    });
  });

  it("parses Record + Workout lines, ignores other elements", async () => {
    const inputPath = writeExport();
    const raws = await collect(adapter().sync({ inputPath }));
    expect(raws.map((r) => r.kind)).toEqual(["record", "record", "workout"]);
  });

  it("normalizes to valid events (metrics → other, workout → trip)", async () => {
    const inputPath = writeExport();
    const a = adapter();
    const raws = await collect(a.sync({ inputPath }));
    const merged = {
      events: [],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
    for (const r of raws) {
      const n = a.normalize(r);
      for (const k of Object.keys(merged)) merged[k].push(...n[k]);
    }
    const { valid, invalidReasons } = partitionBatch(merged);
    expect(invalidReasons).toHaveLength(0);
    expect(valid.events).toHaveLength(3);
    const subtypes = valid.events.map((e) => e.subtype).sort();
    expect(subtypes).toEqual(["other", "other", "trip"]);
    const steps = valid.events.find(
      (e) => e.extra.metric === "HKQuantityTypeIdentifierStepCount",
    );
    expect(steps.content.title).toContain("步数");
    expect(steps.content.title).toContain("123");
    const workout = valid.events.find((e) => e.subtype === "trip");
    expect(workout.extra.activityType).toBe("Running");
    expect(workout.content.title).toContain("5km");
  });

  it("parses the +0800 timezone offset correctly", async () => {
    const inputPath = writeExport();
    const a = adapter();
    const raws = await collect(a.sync({ inputPath }));
    // 2024-01-15 08:30:00 +0800 == 2024-01-15T00:30:00Z
    expect(raws[0].capturedAt).toBe(Date.parse("2024-01-15T00:30:00Z"));
  });

  it("respects limit + include", async () => {
    const inputPath = writeExport();
    const a = adapter();
    const capped = await collect(a.sync({ inputPath, limit: 1 }));
    expect(capped).toHaveLength(1);
    const noWorkout = await collect(
      a.sync({ inputPath, include: { workout: false } }),
    );
    expect(noWorkout.every((r) => r.kind === "record")).toBe(true);
  });

  it("emits truncated progress when maxRecords exceeded", async () => {
    const inputPath = writeExport();
    const a = adapter();
    const events = [];
    await collect(
      a.sync({
        inputPath,
        maxRecords: 1,
        onProgress: (e) => events.push(e),
      }),
    );
    expect(events.find((e) => e.phase === "truncated")).toBeTruthy();
  });

  it("enforces maxSnapshotBytes during authentication and sync", async () => {
    const inputPath = writeExport();
    const a = adapter();
    expect(
      await a.authenticate({ inputPath, maxSnapshotBytes: 32 }),
    ).toMatchObject({
      ok: false,
      reason: "SNAPSHOT_TOO_LARGE",
    });
    await expect(
      collect(a.sync({ inputPath, maxSnapshotBytes: 32 })),
    ).rejects.toMatchObject({ code: "SNAPSHOT_TOO_LARGE" });
  });

  it("rejects non-regular files during authentication and sync", async () => {
    const a = adapter();
    expect(await a.authenticate({ inputPath: tmpDir })).toMatchObject({
      ok: false,
      reason: "SNAPSHOT_NOT_REGULAR_FILE",
    });
    await expect(collect(a.sync({ inputPath: tmpDir }))).rejects.toMatchObject({
      code: "SNAPSHOT_NOT_REGULAR_FILE",
    });
  });

  it("rejects symbolic links without following them", async () => {
    const symbolicFs = {
      lstatSync: () => ({ isSymbolicLink: () => true }),
    };
    const a = adapter(symbolicFs);
    expect(
      await a.authenticate({ inputPath: "/private/export.xml" }),
    ).toMatchObject({
      ok: false,
      reason: "SNAPSHOT_SYMBOLIC_LINK",
    });
    await expect(
      collect(a.sync({ inputPath: "/private/export.xml" })),
    ).rejects.toMatchObject({
      code: "SNAPSHOT_SYMBOLIC_LINK",
    });
  });

  it("fails closed when the export changes during the read", async () => {
    const inputPath = writeExport();
    const changingFs = Object.create(fs);
    let fstatCalls = 0;
    changingFs.fstatSync = (descriptor, options) => {
      const stat = fs.fstatSync(descriptor, options);
      fstatCalls += 1;
      if (fstatCalls === 1) return stat;
      return {
        ...stat,
        size: stat.size + (typeof stat.size === "bigint" ? 1n : 1),
        isFile: () => true,
      };
    };

    await expect(
      collect(adapter(changingFs).sync({ inputPath })),
    ).rejects.toMatchObject({
      code: "SNAPSHOT_CHANGED",
    });
  });

  it("fails closed when the selected file is missing", async () => {
    const inputPath = path.join(tmpDir, "missing.xml");
    expect(await adapter().authenticate({ inputPath })).toMatchObject({
      ok: false,
      reason: "INPUT_PATH_UNREADABLE",
    });
    await expect(collect(adapter().sync({ inputPath }))).rejects.toMatchObject({
      code: "INPUT_PATH_UNREADABLE",
    });
  });
});
