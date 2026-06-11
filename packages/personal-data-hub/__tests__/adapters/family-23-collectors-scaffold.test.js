/**
 * FAMILY-23 v0.1 — 王者荣耀 / 作业帮 / 支付宝 / 华为学习中心 collector scaffold 测试。
 * 各平台: 契约 + extractUid + sync NO_INPUT throw + snapshot sync + normalize → 合法 batch。
 */
import { describe, it, expect } from "vitest";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lib = require("../../lib");
const { assertAdapter } = require("../../lib/adapter-spec");
const { validateBatch } = require("../../lib/batch");

const {
  HonorOfKingsApiClient,
} = require("../../lib/adapters/game-honor-of-kings/api-client");
const {
  ZuoyebangApiClient,
} = require("../../lib/adapters/edu-zuoyebang/api-client");
const { AlipayApiClient } = require("../../lib/adapters/finance-alipay/api-client");
const {
  HuaweiLearningApiClient,
} = require("../../lib/adapters/edu-huawei-learning/api-client");

function writeSnapshot(obj) {
  const p = path.join(
    os.tmpdir(),
    `fam23-snap-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(p, JSON.stringify(obj), "utf-8");
  return p;
}

// platform → { Adapter, name, sensitivity, eventKind, eventSubtype, idKey }
const PLATFORMS = [
  {
    label: "王者荣耀",
    Adapter: lib.HonorOfKingsAdapter,
    name: "game-honor-of-kings",
    version: "0.2.0", // live 营地 fetcher landed (see game-honor-of-kings-live.test.js)
    sensitivity: "medium",
    eventKind: "play",
    eventSubtype: "media",
    idKey: "hok-uid",
    sample: { kind: "play", id: "p1", durationMs: 1800000, mode: "rank", startAt: 1700000000000 },
  },
  {
    label: "作业帮",
    Adapter: lib.ZuoyebangAdapter,
    name: "edu-zuoyebang",
    sensitivity: "medium",
    eventKind: "study",
    eventSubtype: "other",
    idKey: "zuoyebang-uid",
    sample: { kind: "study", id: "s1", subject: "math", durationMs: 1200000, startAt: 1700000000000 },
  },
  {
    label: "支付宝",
    Adapter: lib.AlipayAdapter,
    name: "finance-alipay",
    sensitivity: "high",
    eventKind: "order",
    eventSubtype: "payment",
    idKey: "alipay-uid",
    sample: { kind: "order", id: "o1", merchant: "便利店", amountFen: 350, direction: "out", startAt: 1700000000000 },
  },
  {
    label: "华为学习中心",
    Adapter: lib.HuaweiLearningAdapter,
    name: "edu-huawei-learning",
    sensitivity: "medium",
    eventKind: "study",
    eventSubtype: "other",
    idKey: "huawei-learning-uid",
    sample: { kind: "study", id: "h1", course: "物理", durationMs: 900000, startAt: 1700000000000 },
  },
];

for (const P of PLATFORMS) {
  describe(`${P.label} (${P.name}) — FAMILY-23 v0.1`, () => {
    it("contract conformance + sensitivity", () => {
      const a = new P.Adapter();
      expect(assertAdapter(a).ok).toBe(true);
      expect(a.name).toBe(P.name);
      expect(a.version).toBe(P.version || "0.1.0");
      expect(a.dataDisclosure.sensitivity).toBe(P.sensitivity);
      expect(a.capabilities).toContain("sync:snapshot");
    });

    it("sync throws NO_INPUT without inputPath", async () => {
      const a = new P.Adapter();
      await expect(async () => {
        for await (const _ of a.sync({})) void _;
      }).rejects.toThrow(/inputPath/);
    });

    it("sync via snapshot yields profile + platform event", async () => {
      const snapPath = writeSnapshot({
        schemaVersion: 1,
        snapshottedAt: 1700000000000,
        account: { uid: "12345", displayName: "kid" },
        events: [
          { kind: "profile", id: "profile-12345", uid: "12345", nickname: "kid" },
          P.sample,
        ],
      });
      try {
        const a = new P.Adapter();
        const raws = [];
        for await (const r of a.sync({ inputPath: snapPath })) raws.push(r);
        expect(raws).toHaveLength(2);
        expect(raws[0].kind).toBe("profile");
        expect(raws[1].kind).toBe(P.eventKind);
      } finally {
        fs.unlinkSync(snapPath);
      }
    });

    it("normalize profile → person-self with platform uid; event → valid subtype", () => {
      const a = new P.Adapter();
      const profileBatch = a.normalize({
        adapter: P.name,
        kind: "profile",
        originalId: `${P.name}:profile:12345`,
        capturedAt: 1700000000000,
        payload: { kind: "profile", uid: "12345", nickname: "kid" },
      });
      expect(validateBatch(profileBatch).valid).toBe(true);
      expect(profileBatch.persons[0].subtype).toBe("self");
      expect(profileBatch.persons[0].identifiers[P.idKey]).toEqual(["12345"]);

      const eventBatch = a.normalize({
        adapter: P.name,
        kind: P.eventKind,
        originalId: `${P.name}:${P.eventKind}:1`,
        capturedAt: 1700000000000,
        payload: P.sample,
      });
      expect(validateBatch(eventBatch).valid).toBe(true);
      expect(eventBatch.events[0].subtype).toBe(P.eventSubtype);
    });

    it("normalize throws on missing payload", () => {
      const a = new P.Adapter();
      expect(() => a.normalize({})).toThrow(/payload missing/);
    });
  });
}

describe("FAMILY-23 extractUid cookie scrape", () => {
  it("王者荣耀: openid > uin > tencent_uid", () => {
    const c = new HonorOfKingsApiClient();
    expect(c.extractUid("openid=oABC1234XYZ; foo=bar")).toBe("oABC1234XYZ");
    expect(c.extractUid("uin=o0012345; x=y")).toBe("12345");
    expect(c.extractUid("tencent_uid=678; z=1")).toBe("678");
    expect(c.extractUid("foo=bar")).toBeNull();
    expect(c.lastError.code).toBe(-7);
  });

  it("作业帮: uid / student_id / passport_uid (opaque ZYBUSS → null)", () => {
    const c = new ZuoyebangApiClient();
    expect(c.extractUid("uid=111; ZYBUSS=opaque")).toBe("111");
    expect(c.extractUid("student_id=222")).toBe("222");
    expect(c.extractUid("ZYBUSS=onlyopaquetoken")).toBeNull();
  });

  it("支付宝: alipay_uid / userId / loginUserId", () => {
    const c = new AlipayApiClient();
    expect(c.extractUid("alipay_uid=2088123; t=x")).toBe("2088123");
    expect(c.extractUid("userId=999")).toBe("999");
    expect(c.extractUid("ALIPAYJSESSIONID=abc")).toBeNull();
  });

  it("华为学习中心: accountId / userId / huaweiUid", () => {
    const c = new HuaweiLearningApiClient();
    expect(c.extractUid("accountId=555; deviceId=abc")).toBe("555");
    expect(c.extractUid("huaweiUid=777")).toBe("777");
    expect(c.extractUid("deviceId=nonnumeric")).toBeNull();
  });
});
