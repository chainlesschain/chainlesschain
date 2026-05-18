import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { AgentEconomy } = require("../agent-economy");

describe("AgentEconomy", () => {
  let economy;
  let db;

  beforeEach(() => {
    economy = new AgentEconomy();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // --- Initialization ---

  it("should start uninitialized", () => {
    expect(economy.initialized).toBe(false);
    expect(economy._balances.size).toBe(0);
  });

  it("should initialize with database", async () => {
    await economy.initialize(db);
    expect(economy.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalled();
  });

  it("should skip double initialization", async () => {
    await economy.initialize(db);
    const callCount = db.exec.mock.calls.length;
    await economy.initialize(db);
    expect(db.exec.mock.calls.length).toBe(callCount);
  });

  // --- Price Service ---

  it("should set a service price", async () => {
    await economy.initialize(db);
    const result = economy.priceService("code-review", 5.0, { model: "gpt-4" });
    expect(result.serviceId).toBe("code-review");
    expect(result.price).toBe(5.0);
    expect(economy._priceList.has("code-review")).toBe(true);
  });

  it("should get a service price", async () => {
    await economy.initialize(db);
    economy.priceService("translate", 2.0);
    const price = economy.getServicePrice("translate");
    expect(price.price).toBe(2.0);
  });

  it("should return null for unknown service price", async () => {
    await economy.initialize(db);
    expect(economy.getServicePrice("no-service")).toBeNull();
  });

  // --- Payments ---

  it("should pay from one agent to another", async () => {
    await economy.initialize(db);
    economy._balances.set("alice", { balance: 100, locked: 0 });
    const result = await economy.pay("alice", "bob", 30, "task payment");
    expect(result.amount).toBe(30);
    expect(result.balance).toBe(70);
    expect(economy.getBalance("bob").balance).toBe(30);
  });

  it("should throw on insufficient balance", async () => {
    await economy.initialize(db);
    economy._balances.set("alice", { balance: 10, locked: 0 });
    await expect(economy.pay("alice", "bob", 50)).rejects.toThrow(
      "Insufficient balance",
    );
  });

  it("should get balance for unknown agent as zero", async () => {
    await economy.initialize(db);
    const bal = economy.getBalance("nobody");
    expect(bal.balance).toBe(0);
    expect(bal.locked).toBe(0);
  });

  // --- State Channels ---

  it("should open a payment channel", async () => {
    await economy.initialize(db);
    const ch = economy.openChannel("alice", "bob", 50);
    expect(ch.id).toMatch(/^ch-/);
    expect(ch.party_a).toBe("alice");
    expect(ch.party_b).toBe("bob");
    expect(ch.balance_a).toBe(50);
    expect(ch.status).toBe("open");
  });

  it("should close a channel and settle balances", async () => {
    await economy.initialize(db);
    const ch = economy.openChannel("alice", "bob", 50);
    const channel = economy._channels.get(ch.id);
    channel.balance_a = 30;
    channel.balance_b = 20;
    const result = economy.closeChannel(ch.id);
    expect(result.settled).toBe(true);
    expect(result.balanceA).toBe(30);
    expect(result.balanceB).toBe(20);
    expect(economy.getBalance("alice").balance).toBe(30);
    expect(economy.getBalance("bob").balance).toBe(20);
  });

  it("should return null when closing unknown channel", async () => {
    await economy.initialize(db);
    expect(economy.closeChannel("no-channel")).toBeNull();
  });

  // --- Resource Market ---

  it("should list a resource on the market", async () => {
    await economy.initialize(db);
    const listing = economy.listResource(
      "gpu-compute",
      "provider-1",
      10.0,
      100,
      "hour",
    );
    expect(listing.id).toMatch(/^res-/);
    expect(listing.resource_type).toBe("gpu-compute");
    expect(listing.price).toBe(10.0);
    expect(listing.available).toBe(100);
  });

  it("should trade a resource", async () => {
    await economy.initialize(db);
    const listing = economy.listResource("storage", "p1", 1.0, 50);
    const result = economy.tradeResource(listing.id, "buyer-1", 10);
    expect(result.cost).toBe(10);
    expect(result.remaining).toBe(40);
  });

  it("should throw when trading more than available", async () => {
    await economy.initialize(db);
    const listing = economy.listResource("storage", "p1", 1.0, 5);
    expect(() => economy.tradeResource(listing.id, "buyer", 10)).toThrow(
      "Insufficient availability",
    );
  });

  it("should throw for unknown listing", async () => {
    await economy.initialize(db);
    expect(() => economy.tradeResource("no-listing", "buyer", 1)).toThrow(
      "Listing not found",
    );
  });

  // --- NFT ---

  it("should mint an NFT", async () => {
    await economy.initialize(db);
    const nft = economy.mintNFT("agent-1", "contribution-badge", {
      level: "gold",
    });
    expect(nft.id).toMatch(/^nft-/);
    expect(nft.owner).toBe("agent-1");
    expect(nft.type).toBe("contribution-badge");
    expect(nft.metadata.level).toBe("gold");
  });

  // --- Contributions ---

  it("should record a contribution", async () => {
    await economy.initialize(db);
    const contrib = economy.recordContribution(
      "agent-1",
      "code-review",
      10,
      "proof-hash",
    );
    expect(contrib.agent_id).toBe("agent-1");
    expect(contrib.value).toBe(10);
    expect(contrib.proof).toBe("proof-hash");
  });

  it("should accumulate contributions for an agent", async () => {
    await economy.initialize(db);
    economy.recordContribution("agent-1", "review", 5);
    economy.recordContribution("agent-1", "fix", 10);
    const contribs = economy.getContributions("agent-1");
    expect(contribs).toHaveLength(2);
  });

  it("should return empty for unknown agent contributions", async () => {
    await economy.initialize(db);
    expect(economy.getContributions("nobody")).toHaveLength(0);
  });

  // --- Revenue Distribution ---

  it("should distribute revenue equally", async () => {
    await economy.initialize(db);
    const results = economy.distributeRevenue(100, ["a1", "a2", "a3"]);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.share).toBeCloseTo(100 / 3);
      expect(r.newBalance).toBeCloseTo(100 / 3);
    }
  });

  it("should return empty array for no recipients", async () => {
    await economy.initialize(db);
    expect(economy.distributeRevenue(100, [])).toHaveLength(0);
  });
});
