/**
 * HWWalletBridge unit tests
 *
 * Hardware wallet adapters cannot be intercepted via vi.mock because
 * server.deps.inline bundles all src/main modules. Instead:
 *   - scan() and connect() use real adapters (all work in simulation mode)
 *   - After connect(), bridge._connected.get(id).adapter is replaced with
 *     a vi.fn() mock to verify getAddress/signTx/disconnect adapter calls
 *
 * scan() has a real 500ms delay — well within the default test timeout.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { HWWalletBridge } = require("../hw-wallet-bridge");

// Known device IDs from MOCK_DEVICES in hw-wallet-bridge.js
const LEDGER_ID = "ledger-nano-x-001";
const TREZOR_ID = "trezor-model-t-001";
const ONEKEY_ID = "onekey-classic-001";
const KEYSTONE_ID = "keystone-3-pro-001";

let bridge;

beforeEach(() => {
  bridge = new HWWalletBridge();
});

// ── scan ──────────────────────────────────────────────────────────────────────

describe("HWWalletBridge.scan", () => {
  it("returns array of device objects (≥1)", async () => {
    const devices = await bridge.scan();
    expect(Array.isArray(devices)).toBe(true);
    expect(devices.length).toBeGreaterThan(0);
  });

  it("each device has id, model, brand, transport fields", async () => {
    const devices = await bridge.scan();
    for (const d of devices) {
      expect(d).toHaveProperty("id");
      expect(d).toHaveProperty("model");
      expect(d).toHaveProperty("brand");
      expect(d).toHaveProperty("transport");
    }
  });

  it("includes Ledger, Trezor, and OneKey devices", async () => {
    const devices = await bridge.scan();
    const brands = devices.map((d) => d.brand);
    expect(brands).toContain("Ledger");
    expect(brands).toContain("Trezor");
    expect(brands).toContain("OneKey");
  });

  it('emits "devices-found" event', async () => {
    const events = [];
    bridge.on("devices-found", (e) => events.push(e));
    await bridge.scan();
    expect(events).toHaveLength(1);
    expect(events[0].devices.length).toBeGreaterThan(0);
  });
});

// ── connect ───────────────────────────────────────────────────────────────────

describe("HWWalletBridge.connect", () => {
  it("connects to Ledger device and returns device info", async () => {
    const info = await bridge.connect(LEDGER_ID);
    expect(info.id).toBe(LEDGER_ID);
    expect(info.brand).toBe("Ledger");
  });

  it("connects to Trezor device", async () => {
    const info = await bridge.connect(TREZOR_ID);
    expect(info.brand).toBe("Trezor");
  });

  it("connects to OneKey device", async () => {
    const info = await bridge.connect(ONEKEY_ID);
    expect(info.brand).toBe("OneKey");
  });

  it("connects to Keystone device", async () => {
    const info = await bridge.connect(KEYSTONE_ID);
    expect(info.brand).toBe("Keystone");
  });

  it('unknown deviceId → throws "Device not found"', async () => {
    await expect(bridge.connect("unknown-device-xyz")).rejects.toThrow(
      "Device not found",
    );
  });

  it('emits "device-connected" event', async () => {
    const events = [];
    bridge.on("device-connected", (e) => events.push(e));
    await bridge.connect(LEDGER_ID);
    expect(events[0].deviceId).toBe(LEDGER_ID);
    expect(events[0].brand).toBe("Ledger");
  });

  it("device accessible via getConnectedDevices after connect", async () => {
    await bridge.connect(LEDGER_ID);
    expect(bridge.getConnectedDevices().some((d) => d.id === LEDGER_ID)).toBe(
      true,
    );
  });
});

// ── disconnect ────────────────────────────────────────────────────────────────

describe("HWWalletBridge.disconnect", () => {
  it("removes device from connected list", async () => {
    await bridge.connect(LEDGER_ID);
    expect(bridge.getConnectedDevices()).toHaveLength(1);
    await bridge.disconnect(LEDGER_ID);
    expect(bridge.getConnectedDevices()).toHaveLength(0);
  });

  it("calls adapter.disconnect()", async () => {
    await bridge.connect(LEDGER_ID);
    // Inject mock adapter to verify disconnect() is called
    const mockAdapter = { disconnect: vi.fn().mockResolvedValue(undefined) };
    bridge._connected.get(LEDGER_ID).adapter = mockAdapter;
    await bridge.disconnect(LEDGER_ID);
    expect(mockAdapter.disconnect).toHaveBeenCalled();
  });

  it("no-op if device not connected (does not throw)", async () => {
    await expect(bridge.disconnect("not-connected")).resolves.not.toThrow();
  });

  it('emits "device-disconnected" event', async () => {
    const events = [];
    bridge.on("device-disconnected", (e) => events.push(e));
    await bridge.connect(LEDGER_ID);
    await bridge.disconnect(LEDGER_ID);
    expect(events[0].deviceId).toBe(LEDGER_ID);
  });
});

// ── getAddress ────────────────────────────────────────────────────────────────

describe("HWWalletBridge.getAddress", () => {
  it("returns { address, publicKey, derivationPath } from adapter", async () => {
    await bridge.connect(LEDGER_ID);
    // Inject mock adapter with controlled return value
    const mockAdapter = {
      getAddress: vi.fn().mockResolvedValue({
        address: "0xledger1234567890abcdef1234567890abcdef12",
        publicKey: "04" + "ab".repeat(32),
        derivationPath: "m/44'/60'/0'/0/0",
      }),
    };
    bridge._connected.get(LEDGER_ID).adapter = mockAdapter;
    const result = await bridge.getAddress(
      LEDGER_ID,
      "m/44'/60'/0'/0/0",
      "eth",
    );
    expect(result).toHaveProperty("address");
    expect(result).toHaveProperty("publicKey");
    expect(result).toHaveProperty("derivationPath");
    expect(mockAdapter.getAddress).toHaveBeenCalledWith(
      "m/44'/60'/0'/0/0",
      "eth",
    );
  });

  it('not connected → throws "not connected"', async () => {
    await expect(
      bridge.getAddress("not-connected", "m/44'/60'/0'/0/0"),
    ).rejects.toThrow("not connected");
  });
});

// ── signTx ────────────────────────────────────────────────────────────────────

describe("HWWalletBridge.signTx", () => {
  it("returns signed tx from connected device", async () => {
    await bridge.connect(LEDGER_ID);
    // Inject mock adapter to avoid 2-second real-device simulation delay
    const mockAdapter = {
      signTx: vi.fn().mockResolvedValue({
        v: 37,
        r: "0x" + "aa".repeat(32),
        s: "0x" + "bb".repeat(32),
        signature: "0x" + "cc".repeat(65),
      }),
    };
    bridge._connected.get(LEDGER_ID).adapter = mockAdapter;
    const result = await bridge.signTx(LEDGER_ID, "m/44'/60'/0'/0/0", {
      to: "0xAddr",
      value: "0",
    });
    expect(result).toHaveProperty("signature");
    expect(mockAdapter.signTx).toHaveBeenCalled();
  });

  it('not connected → throws "not connected"', async () => {
    await expect(
      bridge.signTx("not-connected", "m/44'/60'/0'/0/0", {}),
    ).rejects.toThrow("not connected");
  });
});
