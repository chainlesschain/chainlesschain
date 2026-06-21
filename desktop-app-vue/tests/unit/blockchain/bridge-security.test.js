/**
 * BridgeSecurityManager unit tests — src/main/blockchain/bridge-security.js
 *
 * Security-critical cross-chain bridge guard (rate limiting, daily-volume caps,
 * fraud heuristics, blacklist, multi-sig) that previously had NO test coverage.
 *
 * Locks in the multi-sig dedup fix: addSignature now rejects a second signature
 * from the same signer, so one signer can't reach M-of-N alone (quorum bypass).
 *
 * Pure validation methods need no DB; addSignature uses a mock db + real ethers
 * signing. ethers is only used for message hashing/recovery, not network.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ethers } from "ethers";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import BridgeSecurityManager from "../../../src/main/blockchain/bridge-security.js";

const mockDb = () => ({
  db: { prepare: () => ({ run: () => {} }), exec: () => {} },
});

describe("BridgeSecurityManager rate limiting / volume / fraud", () => {
  let sec;
  beforeEach(() => {
    sec = new BridgeSecurityManager(mockDb());
  });

  it("allows a normal transfer and blocks over-max single amount", () => {
    expect(sec.checkRateLimit("0xAbc", ethers.parseEther("500")).valid).toBe(
      true,
    );
    const over = sec.checkRateLimit("0xAbc", ethers.parseEther("1001"));
    expect(over.valid).toBe(false);
    expect(over.reason).toBe("AMOUNT_LIMIT");
  });

  it("blocks once MAX_TRANSFERS_PER_HOUR is reached", () => {
    const a = "0xRate";
    for (let i = 0; i < 10; i++) {
      sec.recordTransfer(a, ethers.parseEther("1"));
    }
    const r = sec.checkRateLimit(a, ethers.parseEther("1"));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("RATE_LIMIT");
  });

  it("enforces the daily volume cap (BigInt accumulation)", () => {
    const a = "0xVol";
    sec.recordTransfer(a, ethers.parseEther("9000"));
    expect(sec.checkDailyVolume(a, ethers.parseEther("500")).valid).toBe(true);
    const r = sec.checkDailyVolume(a, ethers.parseEther("2000")); // 9000+2000 > 10000
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("DAILY_VOLUME_LIMIT");
  });

  it("flags large and rapid transfers as suspicious", () => {
    expect(
      sec.checkSuspiciousActivity("0xS1", ethers.parseEther("100")).suspicious,
    ).toBe(true);
    const a = "0xS2";
    for (let i = 0; i < 3; i++) {
      sec.recordTransfer(a, ethers.parseEther("1"));
    }
    expect(
      sec.checkSuspiciousActivity(a, ethers.parseEther("1")).suspicious,
    ).toBe(true);
    expect(
      sec.checkSuspiciousActivity("0xClean", ethers.parseEther("1")).suspicious,
    ).toBe(false);
  });

  it("blacklist check is case-insensitive", () => {
    sec.blacklistedAddresses.add("0xdeadbeef00000000000000000000000000000001");
    expect(
      sec.isBlacklisted("0xDEADBEEF00000000000000000000000000000001"),
    ).toBe(true);
    expect(sec.isBlacklisted("0xother")).toBe(false);
  });
});

describe("BridgeSecurityManager multi-sig addSignature", () => {
  let sec;
  let txId;
  let txData;

  const sign = async (wallet) => {
    const message = ethers.solidityPackedKeccak256(
      ["address", "address", "uint256"],
      [txData.from, txData.to, txData.amount],
    );
    return wallet.signMessage(ethers.getBytes(message));
  };

  beforeEach(async () => {
    sec = new BridgeSecurityManager(mockDb());
    // amount as a string so JSON.stringify(txData) in createMultiSigTransaction
    // doesn't choke on a BigInt.
    txData = {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      amount: ethers.parseEther("1").toString(),
    };
    const res = await sec.createMultiSigTransaction(txData);
    txId = res.txId;
    expect(res.requiredSignatures).toBe(2);
  });

  it("accepts a valid signature (not yet approved at 1 of 2)", async () => {
    const w = new ethers.Wallet("0x" + "1".repeat(64));
    const r = await sec.addSignature(txId, await sign(w), w.address);
    expect(r.approved).toBe(false);
    expect(r.signaturesCount).toBe(1);
  });

  it("REJECTS a duplicate signature from the same signer (quorum bypass)", async () => {
    const w = new ethers.Wallet("0x" + "1".repeat(64));
    const sig = await sign(w);
    await sec.addSignature(txId, sig, w.address);
    await expect(sec.addSignature(txId, sig, w.address)).rejects.toThrow(
      /already signed/,
    );
    // count must not have advanced toward the 2-of-N threshold
    expect(sec.pendingMultiSig.get(txId).signatures.length).toBe(1);
  });

  it("approves only with two DISTINCT signers", async () => {
    const w1 = new ethers.Wallet("0x" + "1".repeat(64));
    const w2 = new ethers.Wallet("0x" + "2".repeat(64));
    await sec.addSignature(txId, await sign(w1), w1.address);
    const r = await sec.addSignature(txId, await sign(w2), w2.address);
    expect(r.approved).toBe(true);
  });

  it("rejects a signature that doesn't match the claimed signer", async () => {
    const w = new ethers.Wallet("0x" + "1".repeat(64));
    const other = new ethers.Wallet("0x" + "2".repeat(64));
    await expect(
      sec.addSignature(txId, await sign(w), other.address),
    ).rejects.toThrow(/Invalid signature/);
  });
});
