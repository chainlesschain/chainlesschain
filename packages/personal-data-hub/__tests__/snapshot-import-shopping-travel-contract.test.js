"use strict";

import { describe, expect, it } from "vitest";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DianpingAdapter } = require("../lib/adapters/shopping-dianping");
const { ElemeAdapter } = require("../lib/adapters/shopping-eleme");
const { JdAdapter } = require("../lib/adapters/shopping-jd");
const { MeituanAdapter } = require("../lib/adapters/shopping-meituan");
const { PinduoduoAdapter } = require("../lib/adapters/shopping-pinduoduo");
const { TaobaoAdapter } = require("../lib/adapters/shopping-taobao");
const { VipshopAdapter } = require("../lib/adapters/shopping-vipshop");
const { XianyuAdapter } = require("../lib/adapters/shopping-xianyu");
const { Train12306Adapter } = require("../lib/adapters/travel-12306");
const { BaiduMapAdapter } = require("../lib/adapters/travel-baidu-map");
const { TencentMapAdapter } = require("../lib/adapters/travel-tencent-map");

const COHORT = Object.freeze([
  ["shopping-dianping", DianpingAdapter, "order"],
  ["shopping-eleme", ElemeAdapter, "order"],
  ["shopping-jd", JdAdapter, "order"],
  ["shopping-meituan", MeituanAdapter, "order"],
  ["shopping-pinduoduo", PinduoduoAdapter, "order"],
  ["shopping-taobao", TaobaoAdapter, "order"],
  ["shopping-vipshop", VipshopAdapter, "order"],
  ["shopping-xianyu", XianyuAdapter, "order"],
  ["travel-12306", Train12306Adapter, "ticket"],
  ["travel-baidu-map", BaiduMapAdapter, "favourite"],
  ["travel-tencent-map", TencentMapAdapter, "favourite"],
]);

function writeFixture(content) {
  const file = path.join(
    os.tmpdir(),
    `pdh-shopping-travel-snapshot-${crypto.randomUUID()}.json`,
  );
  fs.writeFileSync(
    file,
    typeof content === "string" ? content : JSON.stringify(content),
    "utf8",
  );
  return file;
}

async function collect(iterable) {
  const rows = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

describe("shopping and travel snapshot import contract", () => {
  it.each(COHORT)(
    "%s validates JSON, schema, events, and allowed kinds in authenticate and sync",
    async (_name, Adapter) => {
      const invalidFixtures = [
        ["{", "SNAPSHOT_JSON_INVALID"],
        [{ schemaVersion: 2, events: [] }, "SNAPSHOT_SCHEMA_MISMATCH"],
        [{ schemaVersion: 1 }, "SNAPSHOT_SHAPE_INVALID"],
        [
          { schemaVersion: 1, events: [{ kind: "unsupported" }] },
          "SNAPSHOT_SHAPE_INVALID",
        ],
      ];

      for (const [content, expectedCode] of invalidFixtures) {
        const file = writeFixture(content);
        try {
          const adapter = new Adapter();
          await expect(
            adapter.authenticate({ inputPath: file }),
          ).resolves.toMatchObject({
            ok: false,
            reason: expectedCode,
          });
          await expect(
            collect(adapter.sync({ inputPath: file })),
          ).rejects.toMatchObject({ code: expectedCode });
        } finally {
          fs.unlinkSync(file);
        }
      }
    },
  );

  it.each(COHORT)(
    "%s applies maxSnapshotBytes during authentication and sync",
    async (_name, Adapter) => {
      const file = writeFixture({
        schemaVersion: 1,
        events: [],
        padding: "x".repeat(128),
      });
      try {
        const adapter = new Adapter();
        await expect(
          adapter.authenticate({
            inputPath: file,
            maxSnapshotBytes: 32,
          }),
        ).resolves.toMatchObject({
          ok: false,
          reason: "SNAPSHOT_TOO_LARGE",
        });
        await expect(
          collect(
            adapter.sync({
              inputPath: file,
              maxSnapshotBytes: 32,
            }),
          ),
        ).rejects.toMatchObject({ code: "SNAPSHOT_TOO_LARGE" });
      } finally {
        fs.unlinkSync(file);
      }
    },
  );

  it.each(COHORT)(
    "%s fails closed when an event has no stable source id",
    async (_name, Adapter, kind) => {
      const file = writeFixture({
        schemaVersion: 1,
        snapshottedAt: 1_716_383_000_000,
        events: [{ kind }],
      });
      try {
        await expect(
          collect(new Adapter().sync({ inputPath: file })),
        ).rejects.toThrow(/requires a stable source id/u);
      } finally {
        fs.unlinkSync(file);
      }
    },
  );
});
