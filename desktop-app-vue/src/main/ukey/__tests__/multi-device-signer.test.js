/**
 * MultiDeviceSigner unit tests
 * ukeyManager and hwWalletBridge are injected as mock objects.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { MultiDeviceSigner, SIGN_POLICY } = require("../multi-device-signer");

const SAMPLE_TX = {
  to: "0xRecipient",
  from: "0xSender",
  value: "0.5",
  chain: "ethereum",
};
const HW_DEVICE_ID = "ledger-nano-x-001";

let mockUKey;
let mockHWWallet;
let signer;

beforeEach(() => {
  mockUKey = {
    sign: vi.fn().mockResolvedValue("0x" + "ab".repeat(65)),
  };

  mockHWWallet = {
    signTx: vi.fn().mockResolvedValue({ signature: "0x" + "cd".repeat(65) }),
  };

  signer = new MultiDeviceSigner(mockUKey, mockHWWallet);
});

// ── SIGN_POLICY / getPolicyForRisk ────────────────────────────────────────────

describe("MultiDeviceSigner.getPolicyForRisk", () => {
  it('"low" → requireUKey=true, requireHWWallet=false', () => {
    const policy = signer.getPolicyForRisk("low");
    expect(policy.requireUKey).toBe(true);
    expect(policy.requireHWWallet).toBe(false);
  });

  it('"medium" → requireUKey=true, requireHWWallet=false, hwWalletOptional=true', () => {
    const policy = signer.getPolicyForRisk("medium");
    expect(policy.requireUKey).toBe(true);
    expect(policy.requireHWWallet).toBe(false);
    expect(policy.hwWalletOptional).toBe(true);
  });

  it('"high" → requireUKey=true, requireHWWallet=true', () => {
    const policy = signer.getPolicyForRisk("high");
    expect(policy.requireUKey).toBe(true);
    expect(policy.requireHWWallet).toBe(true);
  });

  it('"critical" → requireUKey=true, requireHWWallet=true, requireBiometric=true', () => {
    const policy = signer.getPolicyForRisk("critical");
    expect(policy.requireUKey).toBe(true);
    expect(policy.requireHWWallet).toBe(true);
    expect(policy.requireBiometric).toBe(true);
  });

  it("unknown risk level → falls back to medium policy", () => {
    const policy = signer.getPolicyForRisk("unknown");
    expect(policy.requireUKey).toBe(true);
  });

  it("SIGN_POLICY exported constants match getPolicyForRisk", () => {
    expect(SIGN_POLICY.low).toEqual(signer.getPolicyForRisk("low"));
    expect(SIGN_POLICY.high).toEqual(signer.getPolicyForRisk("high"));
  });
});

// ── sign — low risk ───────────────────────────────────────────────────────────

describe("MultiDeviceSigner.sign — low risk", () => {
  it("returns { txHash, ukeySignature, hwSignature: null, combined: false }", async () => {
    const result = await signer.sign(SAMPLE_TX, "low", "123456");
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.ukeySignature).toBeTruthy();
    expect(result.hwSignature).toBeNull();
    expect(result.combined).toBe(false);
  });

  it("calls ukey.sign but NOT hwWallet.signTx", async () => {
    await signer.sign(SAMPLE_TX, "low", "123456");
    expect(mockUKey.sign).toHaveBeenCalled();
    expect(mockHWWallet.signTx).not.toHaveBeenCalled();
  });
});

// ── sign — high risk ──────────────────────────────────────────────────────────

describe("MultiDeviceSigner.sign — high risk", () => {
  it("with hwDeviceId → returns { combined: true }", async () => {
    const result = await signer.sign(SAMPLE_TX, "high", "123456", HW_DEVICE_ID);
    expect(result.combined).toBe(true);
    expect(result.ukeySignature).toBeTruthy();
    expect(result.hwSignature).toBeTruthy();
  });

  it("calls both ukey.sign and hwWallet.signTx", async () => {
    await signer.sign(SAMPLE_TX, "high", "123456", HW_DEVICE_ID);
    expect(mockUKey.sign).toHaveBeenCalled();
    expect(mockHWWallet.signTx).toHaveBeenCalledWith(
      HW_DEVICE_ID,
      "m/44'/60'/0'/0/0",
      SAMPLE_TX,
    );
  });

  it('without hwDeviceId → throws "requires hardware wallet"', async () => {
    await expect(
      signer.sign(SAMPLE_TX, "high", "123456", undefined),
    ).rejects.toThrow(/requires hardware wallet/);
  });
});

// ── sign — medium risk with optional hw ───────────────────────────────────────

describe("MultiDeviceSigner.sign — medium risk", () => {
  it("without hwDeviceId → no hw signing (optional)", async () => {
    const result = await signer.sign(SAMPLE_TX, "medium", "123456");
    expect(result.hwSignature).toBeNull();
    expect(result.combined).toBe(false);
  });

  it("with hwDeviceId → uses hw wallet (optional)", async () => {
    const result = await signer.sign(
      SAMPLE_TX,
      "medium",
      "123456",
      HW_DEVICE_ID,
    );
    expect(result.hwSignature).toBeTruthy();
    expect(result.combined).toBe(true);
  });
});

// ── step events ───────────────────────────────────────────────────────────────

describe("MultiDeviceSigner step events", () => {
  it('emits "step" events during low-risk signing', async () => {
    const steps = [];
    signer.on("step", (s) => steps.push(s.step));
    await signer.sign(SAMPLE_TX, "low", "123456");
    expect(steps).toContain("ukey-signing");
    expect(steps).toContain("ukey-done");
  });

  it("emits hw steps during high-risk signing", async () => {
    const steps = [];
    signer.on("step", (s) => steps.push(s.step));
    await signer.sign(SAMPLE_TX, "high", "123456", HW_DEVICE_ID);
    expect(steps).toContain("ukey-signing");
    expect(steps).toContain("hw-signing");
    expect(steps).toContain("hw-done");
  });

  it('emits "signed" event on completion', async () => {
    const events = [];
    signer.on("signed", (e) => events.push(e));
    await signer.sign(SAMPLE_TX, "low", "123456");
    expect(events).toHaveLength(1);
    expect(events[0].riskLevel).toBe("low");
  });
});

// ── verifyDualSignature ───────────────────────────────────────────────────────

describe("MultiDeviceSigner.verifyDualSignature", () => {
  it("returns true when both signatures are non-empty", async () => {
    const result = await signer.verifyDualSignature(
      "0x" + "aa".repeat(32),
      "0x" + "bb".repeat(65),
      "0x" + "cc".repeat(65),
    );
    expect(result).toBe(true);
  });

  it("returns false when hwSignature is empty", async () => {
    const result = await signer.verifyDualSignature(
      "0xtxhash",
      "0xukeySignature",
      "",
    );
    expect(result).toBe(false);
  });

  it("returns false when ukeySignature is empty", async () => {
    const result = await signer.verifyDualSignature(
      "0xtxhash",
      "",
      "0xhwSignature",
    );
    expect(result).toBe(false);
  });

  it("returns false when both signatures are empty", async () => {
    const result = await signer.verifyDualSignature("0xtxhash", "", "");
    expect(result).toBe(false);
  });
});

// ── fallback when ukey unavailable ───────────────────────────────────────────

describe("MultiDeviceSigner — ukey fallback", () => {
  it("falls back to simulation when ukey.sign throws", async () => {
    mockUKey.sign.mockRejectedValue(new Error("device disconnected"));
    const result = await signer.sign(SAMPLE_TX, "low", "123456");
    // Should still return a result (simulation mode)
    expect(result.txHash).toBeTruthy();
  });
});
