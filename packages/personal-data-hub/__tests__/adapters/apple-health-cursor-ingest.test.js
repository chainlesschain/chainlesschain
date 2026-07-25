"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AppleHealthAdapter } = require("../../lib/adapters/apple-health");
const {
  parseCursor,
  serializeCursor,
} = require("../../lib/adapters/apple-health/scan-cursor");
const { generateKeyHex } = require("../../lib/key-providers");
const { AdapterRegistry } = require("../../lib/registry");
const { LocalVault } = require("../../lib/vault");

const SAMPLE_LINES = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<HealthData locale="zh_CN">',
  ' <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2024-01-15 08:30:00 +0800" value="123"/>',
  ' <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" startDate="2024-01-15 09:30:00 +0800" value="72"/>',
  ' <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" startDate="2024-01-15 18:00:00 +0800"/>',
  "</HealthData>",
];

async function collect(iterable) {
  const raws = [];
  for await (const raw of iterable) raws.push(raw);
  return raws;
}

let tmpDir;
let vault;

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch {
      // Best-effort test cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

function writeExport(lines = SAMPLE_LINES) {
  if (!tmpDir) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-apple-health-"));
  }
  const inputPath = path.join(tmpDir, "export.xml");
  fs.writeFileSync(inputPath, lines.join("\n"), "utf8");
  return inputPath;
}

describe("Apple Health explicit cursor", () => {
  it("lets Registry limits resume one export in a stable source scope", async () => {
    const inputPath = writeExport();
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    });
    vault.open();
    const adapter = new AppleHealthAdapter();
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      reports.push(
        await registry.syncAdapter(adapter.name, { inputPath, limit: 1 }),
      );
    }

    expect(reports.map((report) => report.status)).toEqual(["ok", "ok", "ok"]);
    expect(reports.map((report) => report.rawCount)).toEqual([1, 1, 1]);
    expect(reports[0].scope).toMatch(/^account:apple-health:[0-9a-f]{32}$/u);
    expect(new Set(reports.map((report) => report.scope)).size).toBe(1);
    expect(
      vault.queryEvents({ adapter: adapter.name, limit: 10 }),
    ).toHaveLength(3);
    expect(parseCursor(reports[2].watermark).cursor).toEqual({
      v: 1,
      source: null,
      filter: null,
      after: null,
      upper: null,
    });
  });

  it("ingests every entry beyond the former default 200000-record cap", async () => {
    const count = 200_001;
    const lines = [
      "<HealthData>",
      ...Array.from(
        { length: count },
        (_, index) =>
          `<Record type="HKQuantityTypeIdentifierStepCount" value="${index}"/>`,
      ),
      "</HealthData>",
    ];
    const inputPath = writeExport(lines);
    const adapter = new AppleHealthAdapter({ inputPath });
    let watermark;
    let emitted = 0;

    for await (const raw of adapter.sync({
      updateWatermark(value) {
        watermark = value;
      },
    })) {
      void raw;
      emitted += 1;
    }

    expect(emitted).toBe(count);
    expect(parseCursor(watermark).cursor).toEqual({
      v: 1,
      source: null,
      filter: null,
      after: null,
      upper: null,
    });
  });

  it("treats maxRecords as a resumable source-entry budget", async () => {
    const inputPath = writeExport();
    const adapter = new AppleHealthAdapter({ inputPath });
    let watermark;
    const progress = [];

    const first = await collect(
      adapter.sync({
        maxRecords: 1,
        onProgress(event) {
          progress.push(event);
        },
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    const second = await collect(
      adapter.sync({
        maxRecords: 1,
        sinceWatermark: watermark,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );
    const third = await collect(
      adapter.sync({
        maxRecords: 1,
        sinceWatermark: watermark,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    expect(first.map((raw) => raw.payload.value)).toEqual(["123"]);
    expect(second.map((raw) => raw.payload.value)).toEqual(["72"]);
    expect(third.map((raw) => raw.kind)).toEqual(["workout"]);
    expect(progress).toEqual([
      expect.objectContaining({ phase: "truncated", maxRecords: 1 }),
    ]);
    expect(parseCursor(watermark).cursor.upper).toBeNull();
  });

  it("fails closed if the export or active include filter changes", async () => {
    const inputPath = writeExport();
    const adapter = new AppleHealthAdapter({ inputPath });
    let watermark;
    await collect(
      adapter.sync({
        limit: 1,
        updateWatermark(value) {
          watermark = value;
        },
      }),
    );

    await expect(
      collect(
        adapter.sync({
          include: { workout: false },
          sinceWatermark: watermark,
        }),
      ),
    ).rejects.toMatchObject({
      code: "APPLE_HEALTH_CURSOR_FILTER_CHANGED",
      retryable: false,
    });

    fs.appendFileSync(
      inputPath,
      '\n<Record type="HKQuantityTypeIdentifierStepCount" value="999"/>',
      "utf8",
    );
    await expect(
      collect(adapter.sync({ sinceWatermark: watermark })),
    ).rejects.toMatchObject({
      code: "APPLE_HEALTH_CURSOR_SOURCE_CHANGED",
      retryable: false,
    });
  });
});

describe("Apple Health cursor validation", () => {
  it("migrates legacy counts and rejects unsupported or completed cursors", () => {
    expect(parseCursor("200000")).toMatchObject({
      kind: "legacy-reset",
      cursor: {
        v: 1,
        source: null,
        filter: null,
        after: null,
        upper: null,
      },
    });
    expect(() => parseCursor("apple-health:v2:{}")).toThrowError(
      expect.objectContaining({ code: "APPLE_HEALTH_CURSOR_UNSUPPORTED" }),
    );
    expect(() =>
      serializeCursor({
        v: 1,
        source: "a".repeat(64),
        filter: "record+workout",
        after: 3,
        upper: 3,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "APPLE_HEALTH_CURSOR_INVALID" }),
    );
  });
});
