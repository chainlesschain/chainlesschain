import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let TokenLedger, getTokenLedger;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
  const mod = await import("../../../src/main/marketplace/token-ledger.js");
  TokenLedger = mod.TokenLedger;
  getTokenLedger = mod.getTokenLedger;
});

describe("TokenLedger", () => {
  let ledger;
  beforeEach(() => {
    ledger = new TokenLedger({ db: mockDb });
  });

  it("should initialize", async () => {
    await ledger.initialize();
    expect(ledger.initialized).toBe(true);
  });
  it("should create tables", () => {
    ledger._ensureTables();
    expect(mockDb.exec.mock.calls[0][0]).toContain("token_transactions");
  });
  it("should get balance", async () => {
    const b = await ledger.getBalance();
    expect(b.currency).toBe("CCT");
  });
  it("should throw on contribution without type", async () => {
    await expect(ledger.submitContribution({})).rejects.toThrow(
      "Contribution type is required",
    );
  });
  it("should submit contribution", async () => {
    const c = await ledger.submitContribution({ type: "skill" });
    expect(c.tokens_earned).toBeGreaterThan(0);
  });
  it("should get pricing", async () => {
    const p = await ledger.getPricing({});
    expect(p.currency).toBe("CCT");
  });
  it("should get rewards summary", async () => {
    const s = await ledger.getRewardsSummary();
    expect(s).toBeDefined();
  });
  it("should close", async () => {
    await ledger.close();
    expect(ledger.initialized).toBe(false);
  });
});
