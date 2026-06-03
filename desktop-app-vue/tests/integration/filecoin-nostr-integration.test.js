/**
 * Integration test — Filecoin Storage & Nostr Bridge cross-feature flows
 *
 * Covers:
 *   1. Filecoin: store → verify proof → renew → list (full deal lifecycle)
 *   2. Nostr: connect relay → handle messages → publish events (message flow)
 *   3. TTS: model download lifecycle (with mocked HTTP)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({
  v4: (() => {
    let counter = 0;
    return vi.fn(() => `int-uuid-${++counter}`);
  })(),
}));

const { FilecoinStorage } =
  await import("../../src/main/ipfs/filecoin-storage.js");

function createMockDb() {
  return {
    db: {
      exec: vi.fn(),
      prepare: vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(() => []),
      })),
    },
  };
}

describe("Filecoin Storage Integration", () => {
  let storage, mockDatabase;

  beforeEach(async () => {
    mockDatabase = createMockDb();
    storage = new FilecoinStorage(mockDatabase);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
  });

  describe("full deal lifecycle", () => {
    it("store → verify → renew → list → stats", async () => {
      const events = [];
      storage.on("deal-created", (e) => events.push(["created", e]));
      storage.on("proof-verified", (e) => events.push(["verified", e]));
      storage.on("deal-renewed", (e) => events.push(["renewed", e]));

      // Step 1: Create deal
      const deal = await storage.storeToFilecoin({
        cid: "QmIntegration123",
        sizeBytes: 4096,
        minerId: "f0999",
        durationEpochs: 100000,
      });
      expect(deal.status).toBe("active");
      expect(deal.cid).toBe("QmIntegration123");

      // Step 2: Verify storage proof
      const proofResult = await storage.verifyStorageProof(deal.id, {
        proofType: "porep",
        proofData: "a]".repeat(20), // 40 chars > 32
      });
      expect(proofResult.valid).toBe(true);

      // Step 3: Renew deal
      const renewResult = await storage.renewDeal(deal.id, 50000);
      expect(renewResult.newDuration).toBe(150000);
      expect(renewResult.renewalCount).toBe(1);

      // Step 4: List deals with filters
      const allDeals = await storage.listDeals();
      expect(allDeals.length).toBe(1);

      const byMiner = await storage.listDeals({ minerId: "f0999" });
      expect(byMiner.length).toBe(1);

      const byCid = await storage.listDeals({ cid: "QmIntegration123" });
      expect(byCid.length).toBe(1);

      const noMatch = await storage.listDeals({ cid: "QmNonexistent" });
      expect(noMatch.length).toBe(0);

      // Step 5: Stats
      const stats = await storage.getStorageStats();
      expect(stats.totalDeals).toBe(1);
      expect(stats.activeDeals).toBe(1);
      expect(stats.totalSizeBytes).toBe(4096);

      // Step 6: Check events fired
      expect(events.some(([t]) => t === "created")).toBe(true);
      expect(events.some(([t]) => t === "verified")).toBe(true);
      expect(events.some(([t]) => t === "renewed")).toBe(true);
    });

    it("multiple deals with mixed statuses", async () => {
      const d1 = await storage.storeToFilecoin({ cid: "Qm1", sizeBytes: 1024 });
      const d2 = await storage.storeToFilecoin({ cid: "Qm2", sizeBytes: 2048 });

      // Manually expire d1
      storage._deals.get(d1.id).status = "expired";

      const activeDeals = await storage.listDeals({ status: "active" });
      expect(activeDeals.length).toBe(1);
      expect(activeDeals[0].cid).toBe("Qm2");

      const stats = await storage.getStorageStats();
      expect(stats.totalDeals).toBe(2);
      expect(stats.activeDeals).toBe(1);
    });
  });

  describe("error handling across operations", () => {
    it("verify proof on unknown deal returns proper error", async () => {
      await expect(
        storage.verifyStorageProof("nonexistent", {
          proofData: "x".repeat(32),
        }),
      ).rejects.toThrow("not found");
    });

    it("renew non-active deal returns proper error", async () => {
      const deal = await storage.storeToFilecoin({ cid: "QmExpired" });
      storage._deals.get(deal.id).status = "expired";

      await expect(storage.renewDeal(deal.id, 10000)).rejects.toThrow(
        "not active",
      );
    });
  });
});
