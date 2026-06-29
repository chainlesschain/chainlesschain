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

describe("FilecoinStorage proof timestamp persistence", () => {
  const commitmentFor = (cid, proofType, sectorId = "0") =>
    crypto
      .createHash("sha256")
      .update(`${cid}:${proofType}:${sectorId}`)
      .digest("hex");

  function storeWithDb() {
    const runCalls = [];
    const db = {
      db: {
        exec: vi.fn(),
        prepare: vi.fn((sql) => ({
          run: vi.fn((...args) => {
            runCalls.push({ sql, args });
            return { changes: 1 };
          }),
          all: vi.fn(() => []),
          get: vi.fn(() => null),
        })),
      },
    };
    return { store: new FilecoinStorage(db), runCalls };
  }

  it("persists last_proof_at in the UPDATE, not just verified", async () => {
    const { store, runCalls } = storeWithDb();
    store._deals.set("d1", { id: "d1", cid: "bafyCID" });
    const r = await store.verifyStorageProof("d1", {
      proofType: "porep",
      proofData: commitmentFor("bafyCID", "porep"),
    });
    expect(r.valid).toBe(true);
    expect(r.verifiedAt).toBeTruthy();
    const upd = runCalls.find((c) => /UPDATE filecoin_deals/i.test(c.sql));
    expect(upd).toBeTruthy();
    expect(/last_proof_at/.test(upd.sql)).toBe(true);
    expect(upd.args[1]).toBe("d1");
    expect(typeof upd.args[0]).toBe("number");
    // in-memory deal uses snake_case so it matches a deal reloaded from disk
    expect(store._deals.get("d1").last_proof_at).toBe(upd.args[0]);
  });

  it("exposes last_proof_at after a reload from the DB (survives restart)", async () => {
    const reloaded = new FilecoinStorage({
      db: {
        exec: vi.fn(),
        prepare: vi.fn((sql) => ({
          all: () =>
            /SELECT \* FROM filecoin_deals/i.test(sql)
              ? [
                  {
                    id: "d1",
                    cid: "c",
                    status: "active",
                    verified: 1,
                    last_proof_at: 1234,
                  },
                ]
              : [],
          run: vi.fn(),
          get: () => null,
        })),
      },
    });
    await reloaded.initialize();
    const deal = await reloaded.getDealStatus("d1");
    expect(deal.last_proof_at).toBe(1234);
  });
});
