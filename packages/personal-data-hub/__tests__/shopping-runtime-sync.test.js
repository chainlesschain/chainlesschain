"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { JdAdapter } = require("../lib/adapters/shopping-jd");
const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");

let tmpDir;
let vault;

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch (_error) {
      // Best-effort test cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

describe("shopping runtime-cookie registry integration", () => {
  it("uses the secret only for the source request and persists a hashed account scope", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-shopping-runtime-"));
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
    });
    vault.open();

    const sourceRequests = [];
    const adapter = new JdAdapter({
      fetchFn: async (request) => {
        sourceRequests.push(request);
        return {
          orders: [
            {
              orderId: "runtime-order-1",
              merchantName: "Runtime merchant",
              createTime: Date.now(),
              totalPrice: 18.5,
            },
          ],
        };
      },
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter("shopping-jd", {
      cookie: "sid=runtime-secret",
      accountId: "JD-Runtime-User",
      maxPages: 1,
    });

    expect(report.status).toBe("ok");
    expect(report.rawCount).toBe(1);
    expect(report.scope).toMatch(/^account:shopping-jd:[a-f0-9]{32}$/u);
    expect(sourceRequests).toHaveLength(1);
    expect(sourceRequests[0].cookies).toBe("sid=runtime-secret");
    expect(adapter.account).toBe(null);
    expect(adapter._cookieAuth).toBe(null);

    const raw = vault.queryRawEvents({
      adapter: "shopping-jd",
      scope: report.scope,
    });
    const watermark = vault.getWatermark("shopping-jd", report.scope);
    const persisted = JSON.stringify({
      report,
      raw,
      watermark,
      audit: vault.queryAudit({ limit: 100 }),
    });
    expect(raw).toHaveLength(1);
    expect(watermark).toBeTruthy();
    expect(persisted).not.toContain("runtime-secret");
    expect(persisted.toLowerCase()).not.toContain("jd-runtime-user");
  });
});
