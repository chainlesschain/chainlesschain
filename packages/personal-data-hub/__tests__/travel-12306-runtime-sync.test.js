"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Train12306Adapter } = require("../lib/adapters/travel-12306");
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

function completedOrder(sequenceNo) {
  return {
    sequence_no: sequenceNo,
    order_date: "20260720",
    ticket_total_price: "553.5",
    tickets: [
      {
        ticket_no: `E-${sequenceNo}`,
        passenger_name: "Test Passenger",
        train_code: "G35",
        from_station_name: "Shanghai Hongqiao",
        to_station_name: "Beijing South",
        start_train_date_page: "2026-07-20 09:00",
        arrive_train_date_page: "2026-07-20 14:00",
        seat_type_name: "Second Class",
        ticket_price: "553.5",
      },
    ],
  };
}

describe("12306 runtime-cookie registry integration", () => {
  it("persists only scoped ticket data while keeping two transient accounts isolated", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-12306-runtime-"));
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
    });
    vault.open();

    const sourceRequests = [];
    const adapter = new Train12306Adapter({
      fetchFn: async (request) => {
        sourceRequests.push(request);
        return request.url.includes("NoComplete")
          ? { data: { orderDBList: [] } }
          : {
              data: {
                OrderDTODataList: [
                  completedOrder(
                    request.cookies.includes("account-a") ? "A-1" : "B-1",
                  ),
                ],
              },
            };
      },
    });
    const registry = new AdapterRegistry({
      vault,
      sleep: async () => {},
    });
    registry.register(adapter);

    const first = await registry.syncAdapter("travel-12306", {
      cookie: "session=account-a-secret",
      accountId: "Rail-Account-A",
    });
    const second = await registry.syncAdapter("travel-12306", {
      cookie: "session=account-b-secret",
      accountId: "Rail-Account-B",
    });

    for (const report of [first, second]) {
      expect(report.status).toBe("ok");
      expect(report.rawCount).toBe(1);
      expect(report.checkpointCommitted).toBe(true);
      expect(report.sourceRequestCount).toBe(2);
      expect(report.scope).toMatch(/^account:travel-12306:[a-f0-9]{32}$/u);
      expect(
        vault.queryRawEvents({
          adapter: "travel-12306",
          scope: report.scope,
        }),
      ).toHaveLength(1);
      expect(vault.getWatermark("travel-12306", report.scope)).toBeTruthy();
    }
    expect(first.scope).not.toBe(second.scope);
    expect(sourceRequests).toHaveLength(4);
    expect(sourceRequests.every((request) => request.form)).toBe(true);
    expect(adapter.account).toBe(null);
    expect(adapter._cookieAuth).toBe(null);

    const persisted = JSON.stringify({
      first,
      second,
      raw: vault.queryRawEvents({ adapter: "travel-12306" }),
      audit: vault.queryAudit({ limit: 100 }),
    }).toLowerCase();
    for (const secret of [
      "account-a-secret",
      "account-b-secret",
      "rail-account-a",
      "rail-account-b",
    ]) {
      expect(persisted).not.toContain(secret);
    }
  });
});
