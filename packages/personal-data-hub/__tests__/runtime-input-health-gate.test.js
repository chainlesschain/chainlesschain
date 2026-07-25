"use strict";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pdh = require("../lib");

const ACCOUNT = Object.freeze({
  cookies: "session=runtime-input-health-test",
  uid: "_health_test",
  userId: "_health_test",
  user_id: "_health_test",
  uin: "_health_test",
  pin: "_health_test",
  qq: "_health_test",
  username: "_health_test",
  deviceId: "_health_test",
  phone: "_health_test",
  email: "health-test@example.com",
});

const UNREACHABLE_LIVE_ADAPTERS = Object.freeze([
  {
    source: "reading-fanqie",
    Collector: pdh.FanqieReadingAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "reading-qimao",
    Collector: pdh.QimaoReadingAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "fitness-keep",
    Collector: pdh.KeepAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "fitness-joyrun",
    Collector: pdh.JoyrunAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "health-meiyou",
    Collector: pdh.MeiyouAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "car-mercedesme",
    Collector: pdh.MercedesMeAdapter,
    noInputReason: "NO_FILE",
  },
  {
    source: "bank-cmbc",
    Collector: pdh.CmbcBankAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "bank-boc",
    Collector: pdh.BocBankAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "bank-bankcomm",
    Collector: pdh.BankcommBankAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "bank-icbc",
    Collector: pdh.IcbcBankAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "finance-dcep",
    Collector: pdh.DcepAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "gov-12123",
    Collector: pdh.Tmri12123Adapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "gov-ixiamen",
    Collector: pdh.IXiamenAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "gov-tax",
    Collector: pdh.TaxAdapter,
    noInputReason: "NO_INPUT",
  },
  {
    source: "game-honor-of-kings",
    Collector: pdh.HonorOfKingsAdapter,
    noInputReason: "NO_INPUT",
  },
]);

describe("runtime collection input health gate", () => {
  let tempDir;
  let inputPath;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-health-input-"));
    inputPath = path.join(tempDir, "snapshot.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify({ schemaVersion: 1, events: [] }),
      "utf8",
    );
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("lets a readable snapshot override stale constructor Cookie state", async () => {
    const adapters = [];
    for (const [exportName, Collector] of Object.entries(pdh)) {
      if (
        !/Adapter$/u.test(exportName) ||
        exportName === "MockAdapter" ||
        exportName === "CcLLMAdapter" ||
        typeof Collector !== "function" ||
        typeof Collector.prototype?.sync !== "function"
      ) {
        continue;
      }

      for (const [variant, account] of [
        ["full-account", ACCOUNT],
        ["cookie-only", { cookies: ACCOUNT.cookies }],
      ]) {
        let adapter;
        try {
          adapter = new Collector({
            account,
            fetchFn: async () => ({}),
            deps: { chat: async () => ({ text: "" }) },
          });
        } catch (_error) {
          continue;
        }
        if (
          adapter._cookieAuth &&
          adapter.capabilities?.includes("sync:snapshot")
        ) {
          adapters.push({ adapter, variant });
        }
      }
    }

    expect(adapters.length).toBeGreaterThan(40);
    const failures = [];
    for (const { adapter, variant } of adapters) {
      const health = await adapter.healthCheck({ inputPath });
      if (!health?.ok) {
        failures.push({
          adapter: adapter.name,
          variant,
          reason: health?.reason || health?.error || "unknown",
        });
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(UNREACHABLE_LIVE_ADAPTERS)(
    "rejects missing runtime input for $source",
    async ({ Collector, noInputReason }) => {
      const adapter = new Collector();
      const authentication = await adapter.authenticate({});
      const health = await adapter.healthCheck({});

      expect(authentication).toMatchObject({
        ok: false,
        reason: noInputReason,
      });
      expect(health).toMatchObject({
        ok: false,
        reason: authentication.reason,
        error: authentication.message,
        lastChecked: expect.any(Number),
      });
    },
  );

  it.each(UNREACHABLE_LIVE_ADAPTERS)(
    "accepts a valid snapshot/file input for $source",
    async ({ Collector }) => {
      const adapter = new Collector();
      const authentication = await adapter.authenticate({ inputPath });
      const health = await adapter.healthCheck({ inputPath });

      expect(authentication.ok).toBe(true);
      expect(health).toMatchObject({
        ok: true,
        lastChecked: expect.any(Number),
      });
      expect(health.unverified).toBeUndefined();
    },
  );

  it("passes Honor of Kings runtime credentials through the health gate", async () => {
    const adapter = new pdh.HonorOfKingsAdapter();
    const health = await adapter.healthCheck({
      credential: {
        accessToken: "runtime-health-token",
        openid: "runtime-health-openid",
      },
    });

    expect(health).toMatchObject({
      ok: true,
      lastChecked: expect.any(Number),
    });
  });

  it("passes Mercedes me dataPath file input through the health gate", async () => {
    const adapter = new pdh.MercedesMeAdapter();
    const health = await adapter.healthCheck({ dataPath: inputPath });

    expect(health).toMatchObject({
      ok: true,
      lastChecked: expect.any(Number),
    });
  });
});
