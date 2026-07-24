"use strict";

import { describe, expect, it } from "vitest";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bilibili = require("../lib/adapters/social-bilibili");
const csdn = require("../lib/adapters/social-csdn");
const dongchedi = require("../lib/adapters/social-dongchedi");
const douban = require("../lib/adapters/social-douban");
const douyin = require("../lib/adapters/social-douyin");
const kuaishou = require("../lib/adapters/social-kuaishou");
const toutiao = require("../lib/adapters/social-toutiao");
const weibo = require("../lib/adapters/social-weibo");
const xiaohongshu = require("../lib/adapters/social-xiaohongshu");
const zhihu = require("../lib/adapters/social-zhihu");
const tianyancha = require("../lib/adapters/biz-tianyancha");
const boss = require("../lib/adapters/recruit-boss");

const CASES = [
  ["social-bilibili", bilibili.BilibiliAdapter, bilibili.VALID_KINDS],
  ["social-csdn", csdn.CsdnAdapter, csdn.VALID_SNAPSHOT_KINDS],
  [
    "social-dongchedi",
    dongchedi.DongchediAdapter,
    dongchedi.VALID_SNAPSHOT_KINDS,
  ],
  ["social-douban", douban.DoubanAdapter, douban.VALID_SNAPSHOT_KINDS],
  ["social-douyin", douyin.DouyinAdapter, douyin.VALID_SNAPSHOT_KINDS],
  ["social-kuaishou", kuaishou.KuaishouAdapter, kuaishou.VALID_SNAPSHOT_KINDS],
  ["social-toutiao", toutiao.ToutiaoAdapter, toutiao.VALID_SNAPSHOT_KINDS],
  ["social-weibo", weibo.WeiboAdapter, weibo.VALID_SNAPSHOT_KINDS],
  [
    "social-xiaohongshu",
    xiaohongshu.XiaohongshuAdapter,
    xiaohongshu.VALID_SNAPSHOT_KINDS,
  ],
  ["social-zhihu", zhihu.ZhihuAdapter, zhihu.VALID_SNAPSHOT_KINDS],
  [
    "biz-tianyancha",
    tianyancha.TianyanchaAdapter,
    tianyancha.VALID_SNAPSHOT_KINDS,
  ],
  ["recruit-boss", boss.BossZhipinAdapter, boss.VALID_SNAPSHOT_KINDS],
];

function writeSnapshot(snapshot) {
  const file = path.join(
    os.tmpdir(),
    `pdh-snapshot-cohort-c-${crypto.randomUUID()}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(snapshot), "utf8");
  return file;
}

async function collect(iterable) {
  const rows = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

describe("snapshot import cohort C contract", () => {
  it.each(CASES)(
    "%s validates schema, required events[], and allowed kinds in both entry points",
    async (_name, Adapter, kinds) => {
      const invalidSnapshots = [
        [{ schemaVersion: 2, events: [] }, "SNAPSHOT_SCHEMA_MISMATCH"],
        [{ schemaVersion: 1 }, "SNAPSHOT_SHAPE_INVALID"],
        [
          { schemaVersion: 1, events: [{ kind: "not-allowed" }] },
          "SNAPSHOT_SHAPE_INVALID",
        ],
      ];

      expect(kinds.length).toBeGreaterThan(0);
      for (const [snapshot, expectedCode] of invalidSnapshots) {
        const file = writeSnapshot(snapshot);
        const adapter = new Adapter();
        try {
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

  it.each(CASES)(
    "%s passes maxSnapshotBytes through authenticate and sync",
    async (_name, Adapter) => {
      const file = writeSnapshot({
        schemaVersion: 1,
        events: [],
        padding: "x".repeat(256),
      });
      const adapter = new Adapter();
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
    },
  );

  it.each(CASES)(
    "%s fails closed when an event has no stable source id",
    async (_name, Adapter, kinds) => {
      const file = writeSnapshot({
        schemaVersion: 1,
        snapshottedAt: 1_716_383_000_000,
        events: [{ kind: kinds[0] }],
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
