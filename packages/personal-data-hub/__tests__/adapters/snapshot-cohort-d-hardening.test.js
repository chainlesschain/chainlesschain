"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  HuaweiLearningAdapter,
} = require("../../lib/adapters/edu-huawei-learning");
const { ZuoyebangAdapter } = require("../../lib/adapters/edu-zuoyebang");
const { AlipayAdapter } = require("../../lib/adapters/finance-alipay");
const { JoyrunAdapter } = require("../../lib/adapters/fitness-joyrun");
const { KeepAdapter } = require("../../lib/adapters/fitness-keep");
const { GenshinAdapter } = require("../../lib/adapters/game-genshin");
const {
  HonorOfKingsAdapter,
} = require("../../lib/adapters/game-honor-of-kings");
const { Tmri12123Adapter } = require("../../lib/adapters/gov-12123");
const { IXiamenAdapter } = require("../../lib/adapters/gov-ixiamen");
const { TaxAdapter } = require("../../lib/adapters/gov-tax");
const { MeiyouAdapter } = require("../../lib/adapters/health-meiyou");
const { QQAdapter } = require("../../lib/adapters/messaging-qq");

const COHORT = [
  {
    name: "edu-huawei-learning",
    Adapter: HuaweiLearningAdapter,
    idlessEvent: { kind: "study", uid: "account-1" },
  },
  {
    name: "edu-zuoyebang",
    Adapter: ZuoyebangAdapter,
    idlessEvent: { kind: "study", uid: "account-1" },
  },
  {
    name: "finance-alipay",
    Adapter: AlipayAdapter,
    idlessEvent: { kind: "order", uid: "account-1" },
  },
  {
    name: "fitness-joyrun",
    Adapter: JoyrunAdapter,
    idlessEvent: { kind: "run" },
  },
  {
    name: "fitness-keep",
    Adapter: KeepAdapter,
    idlessEvent: { kind: "workout" },
  },
  {
    name: "game-genshin",
    Adapter: GenshinAdapter,
    idlessEvent: { kind: "play", uid: "account-1" },
  },
  {
    name: "game-honor-of-kings",
    Adapter: HonorOfKingsAdapter,
    idlessEvent: { kind: "play", uid: "account-1" },
  },
  {
    name: "gov-12123",
    Adapter: Tmri12123Adapter,
    idlessEvent: { kind: "violation" },
  },
  {
    name: "gov-ixiamen",
    Adapter: IXiamenAdapter,
    idlessEvent: { kind: "service" },
  },
  {
    name: "gov-tax",
    Adapter: TaxAdapter,
    idlessEvent: { kind: "income" },
  },
  {
    name: "health-meiyou",
    Adapter: MeiyouAdapter,
    idlessEvent: { kind: "record" },
  },
  {
    name: "messaging-qq",
    Adapter: QQAdapter,
    idlessEvent: {
      kind: "message",
      uin: "contact-1",
      troopUin: "group-1",
    },
  },
];

async function collect(iterable) {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe.each(COHORT)(
  "$name snapshot hardening",
  ({ Adapter, name, idlessEvent }) => {
    let tmpDir;
    let sequence;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-cohort-d-"));
      sequence = 0;
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeRaw(raw) {
      const filePath = path.join(tmpDir, `${name}-${sequence++}.json`);
      fs.writeFileSync(filePath, raw, "utf8");
      return filePath;
    }

    function writeSnapshot(snapshot) {
      return writeRaw(JSON.stringify(snapshot));
    }

    it("accepts a valid bounded events snapshot", async () => {
      const inputPath = writeSnapshot({ schemaVersion: 1, events: [] });
      const adapter = new Adapter();

      await expect(adapter.authenticate({ inputPath })).resolves.toMatchObject({
        ok: true,
        mode: "snapshot-file",
      });
      await expect(collect(adapter.sync({ inputPath }))).resolves.toEqual([]);
    });

    it("rejects malformed, invalid-shape, unknown-kind and oversized snapshots", async () => {
      const adapter = new Adapter();
      const malformedPath = writeRaw("{");
      const invalidShapePath = writeSnapshot({
        schemaVersion: 1,
        events: {},
      });
      const unknownKindPath = writeSnapshot({
        schemaVersion: 1,
        events: [{ kind: "future-kind", id: "future-1" }],
      });
      const oversizedPath = writeSnapshot({ schemaVersion: 1, events: [] });

      await expect(
        adapter.authenticate({ inputPath: malformedPath }),
      ).resolves.toMatchObject({
        ok: false,
        reason: "SNAPSHOT_JSON_INVALID",
      });
      await expect(
        collect(adapter.sync({ inputPath: malformedPath })),
      ).rejects.toMatchObject({ code: "SNAPSHOT_JSON_INVALID" });

      await expect(
        adapter.authenticate({ inputPath: invalidShapePath }),
      ).resolves.toMatchObject({
        ok: false,
        reason: "SNAPSHOT_SHAPE_INVALID",
      });
      await expect(
        collect(adapter.sync({ inputPath: invalidShapePath })),
      ).rejects.toMatchObject({ code: "SNAPSHOT_SHAPE_INVALID" });

      await expect(
        adapter.authenticate({ inputPath: unknownKindPath }),
      ).resolves.toMatchObject({
        ok: false,
        reason: "SNAPSHOT_SHAPE_INVALID",
      });
      await expect(
        collect(adapter.sync({ inputPath: unknownKindPath })),
      ).rejects.toMatchObject({ code: "SNAPSHOT_SHAPE_INVALID" });

      await expect(
        adapter.authenticate({
          inputPath: oversizedPath,
          maxSnapshotBytes: 8,
        }),
      ).resolves.toMatchObject({
        ok: false,
        reason: "SNAPSHOT_TOO_LARGE",
      });
      await expect(
        collect(
          adapter.sync({
            inputPath: oversizedPath,
            maxSnapshotBytes: 8,
          }),
        ),
      ).rejects.toMatchObject({ code: "SNAPSHOT_TOO_LARGE" });
    });

    it("rejects records that do not expose a stable source id", async () => {
      const inputPath = writeSnapshot({
        schemaVersion: 1,
        events: [idlessEvent],
      });
      const adapter = new Adapter();

      await expect(collect(adapter.sync({ inputPath }))).rejects.toThrow(
        /requires a stable id/u,
      );
    });
  },
);
