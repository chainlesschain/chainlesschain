"use strict";

import { describe, expect, it } from "vitest";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MercedesMeAdapter } = require("../lib/adapters/car-mercedesme");
const { Train12306Adapter } = require("../lib/adapters/travel-12306");
const { CtripAdapter } = require("../lib/adapters/travel-ctrip");
const { DidiAdapter } = require("../lib/adapters/travel-didi");
const { DidiConsumerAdapter } = require("../lib/adapters/travel-didi-consumer");
const { TongchengAdapter } = require("../lib/adapters/travel-tongcheng");

function temporaryPath(suffix = ".json") {
  return path.join(
    os.tmpdir(),
    `pdh-legacy-json-${crypto.randomUUID()}${suffix}`,
  );
}

function writeFixture(content) {
  const file = temporaryPath();
  fs.writeFileSync(file, content, "utf8");
  return file;
}

async function collect(iterable) {
  const rows = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

const COHORT = Object.freeze([
  {
    name: "travel-didi",
    create: () => new DidiAdapter(),
    options: (inputPath, extra = {}) => ({ inputPath, ...extra }),
    envelope: "orders",
    record: (id) => ({
      orderId: id,
      fromAddress: "A",
      toAddress: "B",
      departTime: 1_716_383_021_000,
    }),
  },
  {
    name: "travel-didi-consumer",
    create: () => new DidiConsumerAdapter(),
    options: (inputPath, extra = {}) => ({ inputPath, ...extra }),
    envelope: "orders",
    record: (id) => ({
      orderId: id,
      fromAddress: "A",
      toAddress: "B",
      departTime: 1_716_383_021_000,
    }),
  },
  {
    name: "travel-ctrip",
    create: () => new CtripAdapter(),
    options: (inputPath, extra = {}) => ({ inputPath, ...extra }),
    envelope: "orders",
    record: (id) => ({
      orderId: id,
      type: "flight",
      fromCity: "A",
      toCity: "B",
      departureTime: 1_716_383_021_000,
    }),
  },
  {
    name: "travel-tongcheng",
    create: () => new TongchengAdapter(),
    options: (inputPath, extra = {}) => ({ inputPath, ...extra }),
    envelope: "orders",
    record: (id) => ({
      orderId: id,
      projectType: "flight",
      departureCity: "A",
      arrivalCity: "B",
      departureDate: 1_716_383_021_000,
    }),
  },
  {
    name: "car-mercedesme",
    create: () => new MercedesMeAdapter(),
    options: (inputPath, extra = {}) => ({ inputPath, ...extra }),
    envelope: "trips",
    record: (id) => ({
      tripId: id,
      startAddress: "A",
      endAddress: "B",
      startTime: 1_716_383_021_000,
    }),
  },
  {
    name: "travel-12306:dataPath",
    create: () =>
      new Train12306Adapter({ account: { username: "boundary-test" } }),
    options: (dataPath, extra = {}) => ({ dataPath, ...extra }),
    envelope: "orders",
    record: (id) => ({
      orderId: id,
      trainNumber: "G1",
      fromStation: "A",
      toStation: "B",
      departureTime: 1_716_383_021_000,
    }),
  },
]);

describe("legacy JSON/JSONL file boundary", () => {
  it.each(COHORT)(
    "$name preserves array, object-envelope, and JSONL imports",
    async ({ create, envelope, options, record }) => {
      const shapes = [
        [JSON.stringify([record("array-1")]), ["array-1"]],
        [
          JSON.stringify({ [envelope]: [record("envelope-1")] }),
          ["envelope-1"],
        ],
        [
          `${JSON.stringify(record("jsonl-1"))}\n${JSON.stringify(record("jsonl-2"))}`,
          ["jsonl-1", "jsonl-2"],
        ],
      ];

      for (const [content, expectedIds] of shapes) {
        const file = writeFixture(content);
        try {
          const rows = await collect(create().sync(options(file)));
          expect(rows.map((row) => row.originalId)).toEqual(expectedIds);
        } finally {
          fs.unlinkSync(file);
        }
      }
    },
  );

  it.each(COHORT)(
    "$name enforces maxSnapshotBytes during authenticate and sync",
    async ({ create, options, record }) => {
      const file = writeFixture(JSON.stringify([record("oversized")]));
      try {
        const adapter = create();
        const boundedOptions = options(file, { maxSnapshotBytes: 8 });
        await expect(
          adapter.authenticate(boundedOptions),
        ).resolves.toMatchObject({
          ok: false,
          reason: "SNAPSHOT_TOO_LARGE",
        });
        await expect(
          collect(adapter.sync(boundedOptions)),
        ).rejects.toMatchObject({
          code: "SNAPSHOT_TOO_LARGE",
        });
      } finally {
        fs.unlinkSync(file);
      }
    },
  );

  it.each(COHORT)(
    "$name rejects symbolic-link imports during authenticate and sync",
    async ({ create, options, record }) => {
      const target = writeFixture(JSON.stringify([record("linked")]));
      const link = temporaryPath("-link.json");
      try {
        try {
          fs.symlinkSync(target, link, "file");
        } catch (error) {
          if (error && ["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
            return;
          }
          throw error;
        }

        const adapter = create();
        await expect(
          adapter.authenticate(options(link)),
        ).resolves.toMatchObject({
          ok: false,
          reason: "SNAPSHOT_SYMBOLIC_LINK",
        });
        await expect(
          collect(adapter.sync(options(link))),
        ).rejects.toMatchObject({
          code: "SNAPSHOT_SYMBOLIC_LINK",
        });
      } finally {
        try {
          fs.unlinkSync(link);
        } catch {
          // Link creation is not available in every Windows test environment.
        }
        fs.unlinkSync(target);
      }
    },
  );
});
