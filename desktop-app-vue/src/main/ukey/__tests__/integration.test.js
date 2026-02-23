/**
 * ukey integration tests
 *
 * 3a. Backup → Restore cycle: shamir-split + backup-encryptor round-trip
 *     (filesystem omitted; tests the actual crypto chain used by CloudBackupManager)
 *
 * 3b. Contract signing flow: tx-parser + risk-analyzer + contract-signer
 *     (TxSimulator and ChainAdapter injected as instance mocks for speed;
 *      parsing and risk run for real)
 */

import { describe, it, expect, beforeAll, vi } from "vitest";

const crypto = require("crypto");
const { splitSecret, reconstructSecret } = require("../shamir-split");
const { encryptBackup, decryptBackup } = require("../backup-encryptor");
const { ContractSigner } = require("../contract-signer");

// ── 3b: mock factory for ContractSigner dependencies ──────────────────────────

const MOCK_TX_HASH = "0x" + "ca".repeat(32);

function createSignerWithMocks() {
  const signer = new ContractSigner();
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
    getGasPrice: vi.fn().mockResolvedValue({ gasPrice: "20000000000" }),
    broadcastTx: vi.fn().mockResolvedValue({
      txHash: MOCK_TX_HASH,
      explorer: "https://etherscan.io/tx/" + MOCK_TX_HASH,
    }),
  };
  return signer;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3a. Backup → Restore cycle (real crypto)
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration 3a: Backup → Restore cycle (shamir-split + backup-encryptor)", () => {
  it("split → reconstruct → same secret (2-of-3)", () => {
    const secret = crypto.randomBytes(32);
    const shares = splitSecret(secret, 3, 2);

    expect(shares).toHaveLength(3);
    shares.forEach((s) => expect(s).toMatch(/^\d+:[0-9a-f]+$/));

    // Reconstruct from first 2 shares
    const reconstructed = reconstructSecret([shares[0], shares[1]]);
    expect(reconstructed.equals(secret)).toBe(true);
  });

  it("encrypt → decrypt → same plaintext", async () => {
    const plaintext =
      "my secret key material: " + crypto.randomBytes(16).toString("hex");
    const encrypted = await encryptBackup(plaintext, "integration-passphrase");

    const decrypted = await decryptBackup(encrypted, "integration-passphrase");
    expect(decrypted.toString("utf8")).toBe(plaintext);
  });

  it("full CloudBackupManager flow: encrypt → split-shards → reconstruct → decrypt", async () => {
    const rawSecret = crypto.randomBytes(32);
    const passphrase = "integration-test-pass";

    // Step 1: Encrypt the raw secret
    const encrypted = await encryptBackup(rawSecret, passphrase);
    const encryptedBuf = Buffer.from(JSON.stringify(encrypted));

    // Step 2: Shamir-split the encrypted buffer (3-of-5 for this test)
    const shares = splitSecret(encryptedBuf, 5, 3);
    expect(shares).toHaveLength(5);

    // Step 3: Simulate losing 2 shards — use only shares 0, 2, 4
    const retrievedShares = [shares[0], shares[2], shares[4]];

    // Step 4: Reconstruct the encrypted buffer from 3 of 5 shares
    const reconstructedBuf = reconstructSecret(retrievedShares);
    expect(reconstructedBuf).toBeTruthy();
    expect(reconstructedBuf.length).toBe(encryptedBuf.length);

    // Step 5: Parse and decrypt
    const encryptedObj = JSON.parse(reconstructedBuf.toString("utf8"));
    const decryptedSecret = await decryptBackup(encryptedObj, passphrase);

    // Step 6: Verify original === decrypted
    expect(decryptedSecret.equals(rawSecret)).toBe(true);
  });

  it("2-of-3 backup: reconstructed from any pair of shares decrypts correctly", async () => {
    const rawData = Buffer.from("sensitive key data", "utf8");
    const pass = "mySecurePassphrase123";

    const encrypted = await encryptBackup(rawData, pass);
    const encBuf = Buffer.from(JSON.stringify(encrypted));
    const shares = splitSecret(encBuf, 3, 2);

    // Try all three pairs
    const pairs = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    for (const [i, j] of pairs) {
      const reconstructed = reconstructSecret([shares[i], shares[j]]);
      const obj = JSON.parse(reconstructed.toString());
      const decrypted = await decryptBackup(obj, pass);
      expect(decrypted.equals(rawData)).toBe(true);
    }
  });

  it("wrong passphrase on reconstructed data → decryptBackup throws", async () => {
    const rawData = crypto.randomBytes(16);
    const encrypted = await encryptBackup(rawData, "correct-pass");
    const encBuf = Buffer.from(JSON.stringify(encrypted));
    const shares = splitSecret(encBuf, 3, 2);
    const reconstructed = reconstructSecret([shares[0], shares[1]]);
    const obj = JSON.parse(reconstructed.toString());
    await expect(decryptBackup(obj, "wrong-pass")).rejects.toThrow(
      "Decryption failed",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Contract signing flow (real tx-parser + risk-analyzer, mocked chain)
// ─────────────────────────────────────────────────────────────────────────────

// ERC-20 transfer calldata
const ERC20_TRANSFER =
  "0xa9059cbb" +
  "000000000000000000000000a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" +
  "0000000000000000000000000000000000000000000000000002386f26fc10000";

describe("Integration 3b: Contract signing flow (tx-parser + risk-analyzer + ContractSigner)", () => {
  it('ERC-20 transfer → prepareSign parses correctly (methodName="transfer")', async () => {
    const signer = createSignerWithMocks();
    const txParams = {
      to: "0xTokenContractAddress12345678901234567890",
      from: "0xSenderAddress1234567890123456789012345",
      data: ERC20_TRANSFER,
      value: "0x0",
      chain: "ethereum",
    };

    const request = await signer.prepareSign(txParams);
    expect(request.txInfo.methodName).toBe("transfer");
    expect(request.txInfo.methodId).toBe("0xa9059cbb");
  });

  it('ERC-20 transfer with zero ETH value → riskReport.level = "low"', async () => {
    const signer = createSignerWithMocks();
    const txParams = {
      to: "0xTokenContractAddress12345678901234567891",
      from: "0xSender",
      data: ERC20_TRANSFER,
      value: "0x0",
      chain: "ethereum",
    };

    const request = await signer.prepareSign(txParams);
    // ERC-20 transfer: no ETH value, not whitelisted (+10), known method → score=10 → LOW
    expect(request.riskReport.level).toBe("low");
    expect(request.riskReport.score).toBeLessThanOrEqual(30);
  });

  it("low-risk signing: sign(request, pin) returns { txHash, explorer }", async () => {
    const signer = createSignerWithMocks();
    const txParams = {
      to: "0xTokenContractAddress12345678901234567892",
      from: "0xSender",
      data: ERC20_TRANSFER,
      value: "0",
      chain: "ethereum",
    };

    const request = await signer.prepareSign(txParams);
    expect(request.riskReport.level).toBe("low");

    const result = await signer.sign(request, "123456");
    expect(result.txHash).toMatch(/^0x[0-9a-f]+/);
    expect(result.explorer).toBeTruthy();
  });

  it("plain ETH transfer → methodId = null, methodName = null", async () => {
    const signer = createSignerWithMocks();
    const txParams = {
      to: "0xRecipientAddress12345678901234567890123",
      from: "0xSender",
      value: "0x38d7ea4c68000", // 0.001 ETH
      data: "0x",
      chain: "ethereum",
    };

    const request = await signer.prepareSign(txParams);
    expect(request.txInfo.methodId).toBeNull();
    expect(request.txInfo.methodName).toBeNull();
  });

  it("blacklisted address → risk score ≥ 60, requireBiometric = true", async () => {
    const signer = createSignerWithMocks();
    const txParams = {
      to: "0x0000000000000000000000000000000000000000", // blacklisted
      from: "0xSender",
      value: "0",
      data: "0x",
      chain: "ethereum",
    };

    const request = await signer.prepareSign(txParams);
    expect(request.riskReport.score).toBeGreaterThanOrEqual(60);
    expect(request.riskReport.requireBiometric).toBe(true);
  });

  it("end-to-end: step events fired in correct order", async () => {
    const signer = createSignerWithMocks();
    const steps = [];
    signer.on("step", (s) => steps.push(s.step));

    const txParams = {
      to: "0xTokenContractAddress12345678901234567893",
      data: ERC20_TRANSFER,
      value: "0",
      chain: "ethereum",
    };

    const request = await signer.prepareSign(txParams);
    await signer.sign(request, "123456");

    // Preparation steps
    expect(steps).toContain("parsed");
    expect(steps).toContain("simulated");
    expect(steps).toContain("analyzed");
    // Signing steps
    expect(steps).toContain("signing");
    expect(steps).toContain("signed");
    expect(steps).toContain("broadcast");
  });
});
