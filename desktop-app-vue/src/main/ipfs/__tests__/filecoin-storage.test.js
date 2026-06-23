import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { FilecoinStorage } from "../filecoin-storage.js";

// No DB needed: getStorageStats reads the in-memory _deals Map, and
// verifyStorageProof only touches the DB on the (guarded) save path.
const newStore = () => new FilecoinStorage(null);

describe("FilecoinStorage.getStorageStats (single pass)", () => {
  it("aggregates count, active count, size and cost in one pass", async () => {
    const store = newStore();
    store._deals.set("a", { status: "active", size_bytes: 100, price_fil: 1 });
    store._deals.set("b", { status: "active", size_bytes: 50, price_fil: 2 });
    store._deals.set("c", { status: "expired", size_bytes: 25 }); // no price
    const stats = await store.getStorageStats();
    expect(stats).toEqual({
      totalDeals: 3,
      activeDeals: 2,
      totalSizeBytes: 175,
      totalCostFil: 3,
    });
  });

  it("returns zeroes for an empty store", async () => {
    expect(await newStore().getStorageStats()).toEqual({
      totalDeals: 0,
      activeDeals: 0,
      totalSizeBytes: 0,
      totalCostFil: 0,
    });
  });
});

describe("FilecoinStorage.verifyStorageProof (top-level crypto import)", () => {
  const commitmentFor = (cid, proofType, sectorId = "0") =>
    crypto
      .createHash("sha256")
      .update(`${cid}:${proofType}:${sectorId}`)
      .digest("hex");

  it("accepts a proof whose data matches the CID commitment", async () => {
    const store = newStore();
    store._deals.set("d1", { id: "d1", cid: "bafyCID" });
    const proofData = commitmentFor("bafyCID", "porep");
    const r = await store.verifyStorageProof("d1", {
      proofType: "porep",
      proofData,
    });
    expect(r.valid).toBe(true);
    expect(r.proofType).toBe("porep");
    expect(r.verifiedAt).toBeTruthy();
    expect(store._deals.get("d1").verified).toBe(1);
  });

  it("rejects empty proof data", async () => {
    const store = newStore();
    store._deals.set("d1", { id: "d1", cid: "bafyCID" });
    const r = await store.verifyStorageProof("d1", { proofData: "" });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("empty proof data");
  });

  it("throws on an unknown proof type", async () => {
    const store = newStore();
    store._deals.set("d1", { id: "d1", cid: "bafyCID" });
    await expect(
      store.verifyStorageProof("d1", { proofType: "bogus", proofData: "x" }),
    ).rejects.toThrow(/Unknown proof type/);
  });

  it("throws when the deal does not exist", async () => {
    await expect(
      newStore().verifyStorageProof("missing", { proofData: "x".repeat(40) }),
    ).rejects.toThrow(/not found/);
  });

  it("is stable across repeated calls (shared module crypto)", async () => {
    const store = newStore();
    store._deals.set("d1", { id: "d1", cid: "bafyCID" });
    const proofData = commitmentFor("bafyCID", "post", "0");
    const first = await store.verifyStorageProof("d1", {
      proofType: "post",
      proofData,
    });
    const second = await store.verifyStorageProof("d1", {
      proofType: "post",
      proofData,
    });
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
  });
});
