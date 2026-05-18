/**
 * ContractSigner unit tests
 *
 * Instance-property injection is used for _simulator (TxSimulator) and
 * _chainAdapter (ChainAdapter) because server.deps.inline bundles all src/main
 * modules, preventing vi.mock() from intercepting top-level CJS require() calls.
 *
 * parseTx (tx-parser) and RiskAnalyzer run for real — no chain calls needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { ContractSigner } = require("../contract-signer");

// ERC-20 transfer calldata: transfer(address, uint256)
const TRANSFER_DATA =
  "0xa9059cbb" +
  "000000000000000000000000a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" +
  "0000000000000000000000000000000000000000000000000002386f26fc10000";

const MOCK_TX_HASH = "0x" + "ab".repeat(32);
const MOCK_EXPLORER = "https://etherscan.io/tx/" + MOCK_TX_HASH;

let signer;

beforeEach(() => {
  signer = new ContractSigner(null);
  // Inject mock simulator and chain adapter via instance properties
  signer._simulator = {
    simulate: vi.fn().mockResolvedValue({
      success: true,
      gasUsed: 46000,
      assetChanges: [],
      stateChanges: [],
      revertReason: null,
    }),
  };
  signer._chainAdapter = {
    getGasPrice: vi.fn().mockResolvedValue({
      gasPrice: "20000000000",
      maxFeePerGas: "25000000000",
      maxPriorityFeePerGas: "2000000000",
    }),
    broadcastTx: vi
      .fn()
      .mockResolvedValue({ txHash: MOCK_TX_HASH, explorer: MOCK_EXPLORER }),
  };
});

// ── prepareSign ───────────────────────────────────────────────────────────────

describe("ContractSigner.prepareSign", () => {
  it("returns signing request with id, txInfo, riskReport, gasPrice, isWhitelisted", async () => {
    const req = await signer.prepareSign({
      to: "0xTokenAddr",
      data: TRANSFER_DATA,
      value: "0",
      chain: "ethereum",
    });
    expect(typeof req.id).toBe("string");
    expect(req).toHaveProperty("txInfo");
    expect(req).toHaveProperty("riskReport");
    expect(req).toHaveProperty("gasPrice");
    expect(req).toHaveProperty("isWhitelisted");
  });

  it('ERC-20 transfer calldata → txInfo.methodName = "transfer"', async () => {
    const req = await signer.prepareSign({
      to: "0xTokenAddr",
      data: TRANSFER_DATA,
      value: "0",
      chain: "ethereum",
    });
    expect(req.txInfo.methodName).toBe("transfer");
    expect(req.txInfo.methodId).toBe("0xa9059cbb");
  });

  it("riskReport has level, score, warnings, requireBiometric", async () => {
    const req = await signer.prepareSign({
      to: "0xAddr",
      data: "0x",
      value: "0",
      chain: "ethereum",
    });
    expect(req.riskReport).toHaveProperty("level");
    expect(req.riskReport).toHaveProperty("score");
    expect(req.riskReport).toHaveProperty("warnings");
    expect(req.riskReport).toHaveProperty("requireBiometric");
  });

  it('ERC-20 transfer with zero ETH value → riskReport.level = "low"', async () => {
    const req = await signer.prepareSign({
      to: "0xTokenContract",
      data: TRANSFER_DATA,
      value: "0",
      chain: "ethereum",
    });
    expect(req.riskReport.level).toBe("low");
  });

  it("emits step events: parsed, simulated, analyzed", async () => {
    const steps = [];
    signer.on("step", (s) => steps.push(s.step));
    await signer.prepareSign({ to: "0xAddr", data: "0x", value: "0" });
    expect(steps).toContain("parsed");
    expect(steps).toContain("simulated");
    expect(steps).toContain("analyzed");
  });

  it("handles simulation error gracefully (simulationResult = null, analysis still runs)", async () => {
    signer._simulator = {
      simulate: vi.fn().mockRejectedValue(new Error("network timeout")),
    };
    const req = await signer.prepareSign({
      to: "0xAddr",
      data: "0x",
      value: "0",
    });
    expect(req.simulationResult).toBeNull();
    expect(req.riskReport).toBeDefined();
  });
});

// ── sign ──────────────────────────────────────────────────────────────────────

describe("ContractSigner.sign", () => {
  function makeRequest(riskLevel) {
    return {
      id: "test-request-id",
      createdAt: Date.now(),
      txInfo: {
        to: "0xAddr",
        chain: "ethereum",
        value: "0",
        methodId: null,
        methodName: null,
      },
      riskReport: {
        level: riskLevel,
        score: 20,
        requireBiometric: riskLevel === "critical",
      },
      gasPrice: { gasPrice: "20000000000" },
      isWhitelisted: false,
    };
  }

  it("low risk + pin → returns { txHash, explorer }", async () => {
    const result = await signer.sign(makeRequest("low"), "123456");
    expect(result.txHash).toMatch(/^0x[0-9a-f]+/);
    expect(result.explorer).toBeTruthy();
  });

  it("low risk + no pin → succeeds (PIN not required for low risk)", async () => {
    const result = await signer.sign(makeRequest("low"), null);
    expect(result.txHash).toBeTruthy();
  });

  it('high risk + no pin → throws containing "requires PIN"', async () => {
    await expect(signer.sign(makeRequest("high"), null)).rejects.toThrow(
      /requires PIN/,
    );
  });

  it('critical risk + pin + biometricVerified=false → throws "requires biometric"', async () => {
    await expect(
      signer.sign(makeRequest("critical"), "123456", false),
    ).rejects.toThrow(/requires biometric/);
  });

  it("critical risk + biometricVerified=true → succeeds", async () => {
    const result = await signer.sign(makeRequest("critical"), "123456", true);
    expect(result.txHash).toBeTruthy();
  });

  it("emits step events: signing, signed, broadcast", async () => {
    const steps = [];
    signer.on("step", (s) => steps.push(s.step));
    await signer.sign(makeRequest("low"), "000000");
    expect(steps).toContain("signing");
    expect(steps).toContain("signed");
    expect(steps).toContain("broadcast");
  });
});

// ── reject ────────────────────────────────────────────────────────────────────

describe("ContractSigner.reject", () => {
  it('emits "rejected" event with the request id', () => {
    const events = [];
    signer.on("rejected", (e) => events.push(e));
    signer.reject({ id: "reject-me-123" });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("reject-me-123");
  });
});

// ── whitelist / blacklist delegation ──────────────────────────────────────────

describe("ContractSigner whitelist/blacklist", () => {
  it("addToWhitelist delegates to riskAnalyzer", () => {
    const addr = "0xdelegatetest000000000000000000000000001";
    signer.addToWhitelist(addr, "ethereum", "Test");
    expect(signer._riskAnalyzer.isWhitelisted(addr, "ethereum")).toBe(true);
  });

  it("isBlacklisted delegates to riskAnalyzer", () => {
    expect(
      signer.isBlacklisted("0x0000000000000000000000000000000000000000"),
    ).toBe(true);
    expect(
      signer.isBlacklisted("0xlegitimatecontract00000000000000000000a"),
    ).toBe(false);
  });
});
