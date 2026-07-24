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

describe("runtime collection input health gate", () => {
  let tempDir;
  let inputPath;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-health-input-"));
    inputPath = path.join(tempDir, "snapshot.json");
    fs.writeFileSync(inputPath, "{}", "utf8");
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
});
