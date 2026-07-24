"use strict";

import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { CmbcBankAdapter } = require("../lib/adapters/bank-cmbc");
const { CamScannerDocAdapter } = require("../lib/adapters/doc-camscanner");
const { FanqieReadingAdapter } = require("../lib/adapters/reading-fanqie");
const { IqiyiVideoAdapter } = require("../lib/adapters/video-iqiyi");

function writeSnapshot(snapshot) {
  const file = path.join(
    os.tmpdir(),
    `pdh-snapshot-contract-${crypto.randomUUID()}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(snapshot), "utf8");
  return file;
}

async function collect(iterable) {
  const rows = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

describe("shared snapshot import contract", () => {
  it.each([
    ["bank", CmbcBankAdapter],
    ["document", CamScannerDocAdapter],
    ["reading", FanqieReadingAdapter],
    ["video", IqiyiVideoAdapter],
  ])(
    "%s adapters reject a readable file whose events field is not an array",
    async (_family, Adapter) => {
      const file = writeSnapshot({ schemaVersion: 1, events: {} });
      try {
        await expect(
          new Adapter().authenticate({ inputPath: file }),
        ).resolves.toMatchObject({
          ok: false,
          reason: "SNAPSHOT_SHAPE_INVALID",
        });
      } finally {
        fs.unlinkSync(file);
      }
    },
  );

  it.each([
    ["bank", CmbcBankAdapter],
    ["document", CamScannerDocAdapter],
    ["reading", FanqieReadingAdapter],
    ["video", IqiyiVideoAdapter],
  ])(
    "%s adapters reject non-object and unknown snapshot events",
    async (_family, Adapter) => {
      for (const event of [null, {}, { kind: "unknown" }]) {
        const file = writeSnapshot({ schemaVersion: 1, events: [event] });
        try {
          await expect(
            new Adapter().authenticate({ inputPath: file }),
          ).resolves.toMatchObject({
            ok: false,
            reason: "SNAPSHOT_SHAPE_INVALID",
          });
        } finally {
          fs.unlinkSync(file);
        }
      }
    },
  );

  it("applies the byte limit during authentication and sync", async () => {
    const file = writeSnapshot({
      schemaVersion: 1,
      events: [],
      padding: "x".repeat(128),
    });
    const adapter = new FanqieReadingAdapter();
    try {
      await expect(
        adapter.authenticate({ inputPath: file, maxSnapshotBytes: 32 }),
      ).resolves.toMatchObject({
        ok: false,
        reason: "SNAPSHOT_TOO_LARGE",
      });
      await expect(
        collect(adapter.sync({ inputPath: file, maxSnapshotBytes: 32 })),
      ).rejects.toMatchObject({ code: "SNAPSHOT_TOO_LARGE" });
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("fails closed when a snapshot record has no stable source id", async () => {
    const file = writeSnapshot({
      schemaVersion: 1,
      snapshottedAt: 1_716_383_000_000,
      events: [{ kind: "read", title: "missing-id" }],
    });
    const adapter = new FanqieReadingAdapter();
    try {
      await expect(collect(adapter.sync({ inputPath: file }))).rejects.toThrow(
        /requires a stable id/u,
      );
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("fails closed when a bank snapshot record has no stable source id", async () => {
    const file = writeSnapshot({
      schemaVersion: 1,
      snapshottedAt: 1_716_383_000_000,
      events: [{ kind: "transaction", summary: "missing-id" }],
    });
    const adapter = new CmbcBankAdapter();
    try {
      await expect(collect(adapter.sync({ inputPath: file }))).rejects.toThrow(
        /requires a stable id/u,
      );
    } finally {
      fs.unlinkSync(file);
    }
  });
});
